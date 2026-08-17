/**
 * ENTRAIS · LA API DEL PROVEEDOR
 * ==============================
 * SOLO SERVIDOR: aquí se lee la contraseña del cliente.
 *
 * API REST propia de un proveedor (aseuropa.com), documentada con Swagger. De
 * aquí salen sus productos, sus precios, su stock y sus pedidos.
 *
 *
 * ============ DOS ENTORNOS Y DOS CONTRASEÑAS DISTINTAS ============
 *
 *   pruebas    puerto 5003
 *   producción puerto 5002
 *
 * Cada uno con SU contraseña, y ese es el detalle que hay que tener presente:
 * usar la de pruebas contra producción no da un error de «entorno equivocado»,
 * da un 401 pelado que parece una credencial caducada. Por eso el entorno viaja
 * siempre junto y de él salen la URL y la credencial a la vez.
 *
 * DE MOMENTO SOLO SE LEE. Este módulo no manda nada: `CreatePreOrder` está en su
 * API y aquí no se llama. Crear una reserva en el proveedor de un cliente es una
 * decisión aparte, con su registro y su confirmación, y no algo que aparezca de
 * paso mientras se explora qué datos hay.
 *
 *
 * ============ LAS CREDENCIALES NO ESTÁN AQUÍ ============
 *
 * Salen del entorno del servidor. Son de un CLIENTE —nos las ha dado para
 * trabajar con su proveedor— y no tienen por qué estar en el repositorio ni en
 * la base de datos.
 *
 *   ENTRAIS_LOGIN            el mismo en los dos entornos
 *   ENTRAIS_PASSWORD_PRUEBAS
 *   ENTRAIS_PASSWORD_REAL
 */

export type EntornoEntrais = 'pruebas' | 'real'

const BASES: Record<EntornoEntrais, string> = {
  pruebas: 'https://www.aseuropa.com:5003',
  real: 'https://www.aseuropa.com:5002',
}

export class EntraisError extends Error {
  readonly estado?: number
  constructor(mensaje: string, estado?: number) {
    super(mensaje)
    this.name = 'EntraisError'
    this.estado = estado
  }
}

function credenciales(entorno: EntornoEntrais): { login: string; password: string } | null {
  const login = process.env.ENTRAIS_LOGIN?.trim()
  const password = (
    entorno === 'real' ? process.env.ENTRAIS_PASSWORD_REAL : process.env.ENTRAIS_PASSWORD_PRUEBAS
  )?.trim()
  if (!login || !password) return null
  return { login, password }
}

export function faltaConfigurar(entorno: EntornoEntrais): string | null {
  if (credenciales(entorno)) return null
  return (
    `El servidor no tiene las credenciales de Entrais para el entorno «${entorno}». ` +
    'Hacen falta ENTRAIS_LOGIN y ' +
    (entorno === 'real' ? 'ENTRAIS_PASSWORD_REAL' : 'ENTRAIS_PASSWORD_PRUEBAS') +
    '.'
  )
}

/* ------------------------------------------------------------------ */
/* El token                                                            */
/* ------------------------------------------------------------------ */

/**
 * EL TOKEN DURA UNA HORA Y SE GUARDA EN MEMORIA, no en la base.
 *
 * En la base habría que cifrarlo, tener su tabla y limpiarlo; y a cambio no
 * ganaría nada, porque caduca en sesenta minutos y sacar otro cuesta UNA
 * llamada. Vive en el proceso: si el servidor se reinicia, la siguiente petición
 * pide uno nuevo y ya está.
 *
 * El margen de un minuto evita el caso de mandar una petición con un token que
 * caduca mientras viaja — un 401 que parece una credencial mala.
 */
const tokens = new Map<EntornoEntrais, { valor: string; expira: number }>()
const MARGEN_MS = 60_000

async function token(entorno: EntornoEntrais): Promise<string> {
  const guardado = tokens.get(entorno)
  if (guardado && guardado.expira - MARGEN_MS > Date.now()) return guardado.valor

  const cred = credenciales(entorno)
  if (!cred) throw new EntraisError(faltaConfigurar(entorno) ?? 'Faltan las credenciales.')

  const res = await fetch(`${BASES[entorno]}/api/v1/Login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/plain' },
    body: JSON.stringify({ login: cred.login, password: cred.password }),
  })

  const texto = (await res.text()).trim()

  if (!res.ok) {
    throw new EntraisError(
      res.status === 401
        ? `Entrais rechaza el usuario o la contraseña del entorno «${entorno}» (401). Cada entorno ` +
          'tiene la suya: comprueba que no se ha puesto la de pruebas en el real o al revés.'
        : `Entrais ha contestado ${res.status} al identificarse: ${texto.slice(0, 200)}`,
      res.status
    )
  }

  /**
   * El token llega como TEXTO PLANO, no como JSON.
   *
   * El Swagger lo declara con `text/plain`, así que un `res.json()` aquí falla
   * con un error de sintaxis que no menciona el token por ningún lado. Se
   * intenta leer como JSON por si algún día cambian —hay APIs que devuelven
   * `{"token":"..."}`— y si no, se usa el texto tal cual, quitándole las
   * comillas que algunas envuelven.
   */
  let valor = texto
  try {
    const json = JSON.parse(texto) as { token?: string } | string
    valor = typeof json === 'string' ? json : (json.token ?? texto)
  } catch {
    valor = texto.replace(/^"|"$/g, '')
  }

  if (!valor) throw new EntraisError('Entrais ha contestado al login sin dar ningún token.')

  // Una hora, según su documentación. Se guarda el momento y no la duración
  // para no tener que volver a calcularlo en cada comprobación.
  tokens.set(entorno, { valor, expira: Date.now() + 3600_000 })
  return valor
}

/* ------------------------------------------------------------------ */
/* Llamar                                                              */
/* ------------------------------------------------------------------ */

/**
 * Una llamada a la API de Entrais, con el token puesto.
 *
 * Si contesta 401 se tira el token guardado y se reintenta UNA vez: es lo que
 * pasa cuando caduca entre dos peticiones, y hacer que el usuario vea un error
 * de sesión por algo que se arregla solo con una llamada más sería absurdo. Una
 * sola vez, para que un 401 de verdad —credencial cambiada— no se convierta en
 * un bucle.
 */
export async function llamarEntrais<T>(
  entorno: EntornoEntrais,
  ruta: string,
  reintento = false
): Promise<T> {
  const res = await fetch(`${BASES[entorno]}${ruta}`, {
    headers: {
      Authorization: `Bearer ${await token(entorno)}`,
      Accept: 'application/json',
    },
  })

  if (res.status === 401 && !reintento) {
    tokens.delete(entorno)
    return await llamarEntrais<T>(entorno, ruta, true)
  }

  const texto = await res.text()

  if (!res.ok) {
    throw new EntraisError(
      `Entrais ha contestado ${res.status} a ${ruta}: ${texto.slice(0, 300) || 'sin cuerpo'}`,
      res.status
    )
  }

  return (texto ? JSON.parse(texto) : null) as T
}

export function baseDe(entorno: EntornoEntrais): string {
  return BASES[entorno]
}
