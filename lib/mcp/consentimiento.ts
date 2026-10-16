/**
 * LA PANTALLA DE CONSENTIMIENTO: A QUÉ SE LE DEJA CONECTAR Y A DÓNDE SE VUELVE.
 * PURO. Se prueba en consentimiento.prueba.ts.
 *
 *
 * ============ POR QUÉ HACE FALTA FILTRAR LA REDIRECCIÓN ============
 *
 * El servidor OAuth de Supabase deja que CUALQUIER aplicación se dé de alta sola
 * (registro dinámico de clientes): es lo que permite a Claude conectarse sin que
 * nadie le prepare un identificador. La contrapartida es que un tercero puede
 * registrar una aplicación con el nombre «Claude» y mandar a un administrador un
 * enlace de autorización. Lo único que no puede falsear es A DÓNDE se devuelve el
 * código si se aprueba, porque eso lo comprueba Supabase.
 *
 * Así que la pantalla solo deja aprobar cuando la redirección es una de las dos
 * que usa Claude de verdad:
 *
 *   · Claude en la web, el escritorio y el móvil:
 *       https://claude.ai/api/mcp/auth_callback   (y el mismo camino en claude.com)
 *   · Claude Code, que escucha en su propio ordenador:
 *       http://localhost:<puerto>/callback  o  http://127.0.0.1:<puerto>/callback
 *     con un puerto distinto cada vez, y por eso se compara sin el puerto.
 *
 * Cualquier otra se rechaza sin llegar a preguntar a la persona: no hay nada que
 * decidir.
 */

const CALLBACKS_HOSTED = new Set([
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
])

export type VeredictoRedireccion =
  | { permitida: true; destino: string }
  | { permitida: false; motivo: string }

/**
 * `conConsulta`: la dirección con la que Supabase devuelve a la persona a Claude
 * lleva `?code=…&state=…`. La que registra la aplicación NO lleva consulta. Se
 * comprueba la segunda sin consulta y la primera ignorándola: en los dos casos
 * manda el mismo destino.
 */
export function redireccionPermitida(
  uri: string | null | undefined,
  opciones: { conConsulta?: boolean } = {}
): VeredictoRedireccion {
  if (!uri) return { permitida: false, motivo: 'La aplicación no ha dicho a dónde volver.' }

  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return { permitida: false, motivo: 'La dirección de vuelta no es válida.' }
  }
  if (url.username || url.password) {
    return { permitida: false, motivo: 'La dirección de vuelta no puede llevar usuario ni contraseña.' }
  }
  if (url.hash) return { permitida: false, motivo: 'La dirección de vuelta no puede llevar fragmento.' }

  // Claude en la nube: la dirección tiene que ser EXACTA, sin consulta
  const sinConsulta = `${url.protocol}//${url.host}${url.pathname}`
  const consultaOk = opciones.conConsulta === true || !url.search
  if (CALLBACKS_HOSTED.has(sinConsulta) && consultaOk) {
    return { permitida: true, destino: url.host }
  }

  // Claude Code: bucle local, cualquier puerto, el camino /callback
  if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) {
    const puerto = url.port === '' ? null : Number(url.port)
    const puertoValido = puerto === null || (Number.isInteger(puerto) && puerto >= 1024 && puerto <= 65535)
    if (url.pathname === '/callback' && consultaOk && puertoValido) {
      return { permitida: true, destino: 'tu ordenador (Claude Code)' }
    }
  }

  return {
    permitida: false,
    motivo: `Solo se puede conectar desde Claude. Esta aplicación pide volver a «${url.host}», que no es de Claude.`,
  }
}

/**
 * A dónde se manda a la persona tras iniciar sesión.
 *
 * La página de inicio de sesión recibe un `next` y esto decide si se le hace caso.
 * SOLO se admite volver a la pantalla de consentimiento con un identificador de
 * autorización; cualquier otra cosa —una dirección externa, una ruta del ERP, un
 * `//evil.com`— cae en el escritorio. Sin esta lista cerrada, el parámetro sería
 * una redirección abierta a la salida del login.
 */
export function destinoTrasLogin(next: string | null | undefined): string {
  if (typeof next === 'string' && /^\/auth\/consent\?authorization_id=[A-Za-z0-9_-]{8,80}$/.test(next)) {
    return next
  }
  return '/dashboard'
}

/** El identificador de autorización que manda Supabase, o null si no tiene la forma esperada */
export function identificadorValido(valor: string | string[] | undefined): string | null {
  const v = Array.isArray(valor) ? valor[0] : valor
  return typeof v === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(v) ? v : null
}
