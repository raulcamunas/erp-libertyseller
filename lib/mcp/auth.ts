/**
 * QUIÉN PUEDE USAR EL CONECTOR.
 * PURO: la comprobación contra Supabase llega por dependencias, para poder
 * probar cada rama sin red. Se prueba en auth.prueba.ts.
 *
 *
 * ============ LA REGLA ============
 *
 * Este conector es SOLO PARA EL EQUIPO DE LIBERTY SELLER: administradores. Los
 * clientes no entran nunca, y tampoco el resto de roles (partner, employee).
 * Detrás hay catálogos, precios y, más adelante, la posibilidad de cambiar cosas
 * en las cuentas de Amazon de los clientes.
 *
 * Se comprueba en CADA petición, no al conectar: un administrador al que se le
 * quita el rol pierde el acceso en su siguiente llamada, sin esperar a que le
 * caduque el token.
 *
 *
 * ============ LAS CUATRO COMPROBACIONES, EN ESTE ORDEN ============
 *
 *   1. Hay un token «Bearer». Si no, 401 con el aviso que hace que Claude abra el
 *      inicio de sesión.
 *   2. Supabase dice que el token vale y de quién es (`getUser`). Se le pregunta a
 *      Supabase y no se confía en leer el JWT: es lo que descubre un token
 *      revocado o de una sesión cerrada.
 *   3. El token trae `client_id`, o sea que salió de un flujo OAuth con pantalla de
 *      consentimiento. Una sesión normal del navegador NO sirve como llave de este
 *      conector aunque sea de un administrador.
 *   4. El rol del perfil es administrador. Se lee de la base en esta misma
 *      petición, nunca del token.
 */

export const ROLES_PERMITIDOS: readonly string[] = ['admin']

export interface UsuarioMcp {
  id: string
  email: string | null
  rol: string
  /** El cliente OAuth con el que entró: identifica la aplicación (Claude), no a la persona */
  clienteOAuth: string
}

export interface DepsAuth {
  /** Pregunta a Supabase Auth si el token vale. null = no vale. Lanza si no se ha podido preguntar */
  verificarToken(jwt: string): Promise<{ id: string; email: string | null } | null>
  /** El rol de `profiles`, o null si la persona no tiene perfil. Lanza si no se ha podido leer */
  leerRol(userId: string): Promise<string | null>
}

export type ResultadoAuth =
  | { ok: true; usuario: UsuarioMcp }
  | {
      ok: false
      status: 401 | 403 | 503
      /** Para el cuerpo de la respuesta y el log: nunca incluye el token */
      motivo: string
      /** ¿Hay que mandar el aviso WWW-Authenticate que abre el inicio de sesión? */
      reto: boolean
      /** El token venía y no valía: RFC 6750 pide decirlo en el aviso */
      tokenInvalido: boolean
    }

/** El token de «Authorization: Bearer xxx», o null */
export function extraerBearer(authorization: string | null): string | null {
  if (!authorization) return null
  const m = /^Bearer\s+([^\s]+)$/i.exec(authorization.trim())
  return m ? m[1] : null
}

/** Las afirmaciones de un JWT SIN verificar su firma. Solo vale después de `verificarToken` */
export function leerClaims(jwt: string): Record<string, unknown> | null {
  const partes = jwt.split('.')
  if (partes.length !== 3) return null
  try {
    const base64 = partes[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = Buffer.from(base64, 'base64').toString('utf8')
    const claims = JSON.parse(json) as unknown
    return typeof claims === 'object' && claims !== null && !Array.isArray(claims)
      ? (claims as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

export async function autenticar(authorization: string | null, deps: DepsAuth): Promise<ResultadoAuth> {
  const jwt = extraerBearer(authorization)
  if (!jwt) {
    return { ok: false, status: 401, motivo: 'Falta el token de acceso.', reto: true, tokenInvalido: false }
  }

  const claims = leerClaims(jwt)
  if (!claims) {
    return { ok: false, status: 401, motivo: 'El token no tiene la forma de un JWT.', reto: true, tokenInvalido: true }
  }

  let usuario: { id: string; email: string | null } | null
  try {
    usuario = await deps.verificarToken(jwt)
  } catch {
    // No se ha podido PREGUNTAR: no es lo mismo que «no vale». Un 401 haría que
    // Claude tirase una conexión buena y pidiera iniciar sesión otra vez.
    return { ok: false, status: 503, motivo: 'No se ha podido comprobar el token ahora mismo.', reto: false, tokenInvalido: false }
  }
  if (!usuario || (typeof claims.sub === 'string' && claims.sub !== usuario.id)) {
    return { ok: false, status: 401, motivo: 'El token no es válido o ha caducado.', reto: true, tokenInvalido: true }
  }

  const clienteOAuth = claims.client_id
  if (typeof clienteOAuth !== 'string' || clienteOAuth === '') {
    return {
      ok: false,
      status: 403,
      motivo: 'Este token no viene de una conexión autorizada desde Claude. Conecta el servidor desde Claude para iniciar sesión.',
      reto: false,
      tokenInvalido: false,
    }
  }

  let rol: string | null
  try {
    rol = await deps.leerRol(usuario.id)
  } catch {
    return { ok: false, status: 503, motivo: 'No se ha podido comprobar tu rol ahora mismo.', reto: false, tokenInvalido: false }
  }
  if (!rol || !ROLES_PERMITIDOS.includes(rol)) {
    return {
      ok: false,
      status: 403,
      motivo: 'Este conector es solo para el equipo de Liberty Seller (administradores).',
      reto: false,
      tokenInvalido: false,
    }
  }

  return { ok: true, usuario: { id: usuario.id, email: usuario.email, rol, clienteOAuth } }
}
