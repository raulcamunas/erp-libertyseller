/**
 * EL CLIENTE DE LA API DE RINKEL, SOLO PARA LEER.
 * ===============================================
 * SOLO SERVIDOR: aquí se usa la clave de la cuenta de cada comercial. Se comprueba con
 * rinkel.prueba.ts (con un `fetch` falso y con la forma de las llamadas reales).
 *
 * Rinkel es la centralita con la que llaman los comerciales. Su API (https://developers.rinkel.com)
 * deja leer el registro de llamadas (CDR) con su duración, su estado y la grabación, y es lo que
 * sustituye a exportar un Excel cada día y subirlo a mano.
 *
 *
 * ============ LO QUE SE HA COMPROBADO CONTRA LA API REAL ============
 *
 *   · Base: https://api.rinkel.com/v1  (sin el /v1 contesta «Method does not exist»).
 *   · Clave en cabecera: `Authorization: Bearer <clave>`.
 *   · GET /call-detail-records?perPage=50&page=N. 50 es el máximo (con 100 dice INVALID); la
 *     primera página es la llamada MÁS RECIENTE.
 *   · Filtro de fechas: `startDate` y `endDate` en SEGUNDOS UNIX (con una fecha ISO o con
 *     milisegundos dice INVALID). Para el 21 de octubre devuelve las mismas 52 llamadas que el
 *     Excel de la centralita.
 *   · Cada llamada trae `callRecording: { id, availableUntil, playUrl }` cuando está grabada
 *     (más del 60 %). GET /call-recordings/:id/stream devuelve una URL TEMPORAL (3 horas) a
 *     /v1/audio/call-recording/:id?token=…, que sirve el audio con rangos (206) SIN necesitar la
 *     clave: por eso el ERP puede redirigir el navegador a ella sin pasarle nada secreto.
 *   · Las grabaciones caducan a los 90 días (`availableUntil`).
 *
 * LA CLAVE NO SALE DE AQUÍ: no se escribe en ningún mensaje de error ni en ningún registro, y el
 * navegador no la ve nunca. Un error de Rinkel se traduce a una frase nuestra; su cuerpo no se reenvía.
 */

export const RINKEL_API = 'https://api.rinkel.com/v1'
const HOST_DE_RINKEL = 'api.rinkel.com'

/** Lo máximo que deja pedir por página */
export const LLAMADAS_POR_PAGINA = 50

export type CodigoErrorRinkel = 'clave_invalida' | 'sin_permiso' | 'limite' | 'no_encontrada' | 'servidor' | 'red' | 'respuesta'

export class ErrorRinkel extends Error {
  readonly codigo: CodigoErrorRinkel
  readonly estado: number | null
  constructor(codigo: CodigoErrorRinkel, mensaje: string, estado: number | null = null) {
    super(mensaje)
    this.name = 'ErrorRinkel'
    this.codigo = codigo
    this.estado = estado
  }
}

/** Lo que se le dice a quien pulsa el botón: frases nuestras, nunca el cuerpo de la respuesta de Rinkel */
export const MENSAJE_DE_ERROR: Record<CodigoErrorRinkel, string> = {
  clave_invalida: 'Rinkel no reconoce esta clave. Comprueba que está copiada entera y que es la clave de la API de Rinkel.',
  sin_permiso: 'El plan de Rinkel de esta cuenta no deja usar la API con esta clave, o la clave no tiene permiso para leer las llamadas.',
  limite: 'Rinkel está recibiendo demasiadas peticiones. Espera un minuto y vuelve a probar.',
  no_encontrada: 'Rinkel no encuentra esa grabación: puede haber caducado (se guardan 90 días).',
  servidor: 'Rinkel ha tenido un fallo. Vuelve a probar en unos minutos.',
  red: 'No se ha podido conectar con Rinkel. Vuelve a probar en un momento.',
  respuesta: 'Rinkel ha contestado algo que no se entiende. Si sigue pasando, avisa a Liberty Seller.',
}

/* ------------------------------------------------------------------ */
/* La llamada, ya en nuestra forma                                     */
/* ------------------------------------------------------------------ */

export interface FilaLlamada {
  /** El id del registro en Rinkel: con el usuario, es la clave que impide guardar dos veces la misma llamada */
  rinkel_id: string
  call_id: string | null
  /** ISO, en UTC. El día de Madrid se saca con diaMadrid() */
  fecha: string
  /** 'outbound' (la hace el comercial) o 'inbound' (la recibe) */
  direccion: string
  duracion_s: number
  /** 'ANSWERED' = se descolgó; cualquier otra cosa («MISSED») es que no */
  estado: string
  motivo_perdida: string | null
  /** El número del OTRO lado en E.164, o null si lo ocultó */
  numero: string | null
  numero_anonimo: boolean
  /** La línea de Rinkel desde la que se llamó o a la que llamaron, con su etiqueta */
  numero_propio: string | null
  grabacion_id: string | null
  /** Hasta cuándo se puede oír: pasada esa fecha Rinkel ya no la tiene */
  grabacion_hasta: string | null
}

type Objeto = Record<string, unknown>
const esObjeto = (x: unknown): x is Objeto => typeof x === 'object' && x !== null && !Array.isArray(x)
const texto = (x: unknown): string | null => (typeof x === 'string' && x.trim() !== '' ? x.trim() : null)
const aIso = (x: unknown): string | null => {
  const t = texto(x)
  if (!t) return null
  const ms = Date.parse(t)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

/**
 * Una llamada de la API de Rinkel -> la fila que se guarda. Devuelve null si lo que llega no es una
 * llamada (sin id o sin fecha legible): se cuenta como descartada, no se inventa.
 */
export function normalizarLlamada(crudo: unknown): FilaLlamada | null {
  if (!esObjeto(crudo)) return null
  const id = texto(crudo.id)
  const fecha = aIso(crudo.date)
  if (!id || !fecha) return null

  const externo = esObjeto(crudo.externalNumber) ? crudo.externalNumber : {}
  const interno = esObjeto(crudo.internalNumber) ? crudo.internalNumber : {}
  const grabacion = esObjeto(crudo.callRecording) ? crudo.callRecording : null
  const duracion = typeof crudo.duration === 'number' && Number.isFinite(crudo.duration) ? Math.max(0, Math.round(crudo.duration)) : 0
  const anonimo = externo.anonymous === true

  return {
    rinkel_id: id,
    call_id: texto(crudo.callId),
    fecha,
    direccion: (texto(crudo.direction) ?? 'outbound').toLowerCase(),
    duracion_s: duracion,
    estado: (texto(crudo.status) ?? 'MISSED').toUpperCase(),
    motivo_perdida: texto(crudo.missedReason),
    numero: anonimo ? null : texto(externo.e164),
    numero_anonimo: anonimo,
    numero_propio: texto(interno.label) ?? texto(interno.localizedNumber) ?? texto(interno.number),
    grabacion_id: grabacion ? texto(grabacion.id) : null,
    grabacion_hasta: grabacion ? aIso(grabacion.availableUntil) : null,
  }
}

/* ------------------------------------------------------------------ */
/* Pedir a Rinkel                                                      */
/* ------------------------------------------------------------------ */

export interface DepsRinkel {
  /** Se puede cambiar en las pruebas */
  fetch: typeof fetch
  /** Lo que se espera a Rinkel antes de darlo por caído */
  esperaMs: number
}

const POR_DEFECTO: DepsRinkel = { fetch: (...a) => fetch(...a), esperaMs: 25_000 }

export type Consulta = Record<string, string | number | undefined>

/** Una petición GET autenticada. Devuelve el JSON ya leído o lanza un ErrorRinkel con una frase que se puede enseñar */
export async function pedirRinkel(clave: string, ruta: string, consulta: Consulta = {}, deps: Partial<DepsRinkel> = {}): Promise<unknown> {
  const { fetch: pedir, esperaMs } = { ...POR_DEFECTO, ...deps }
  const url = new URL(`${RINKEL_API}${ruta}`)
  for (const [k, v] of Object.entries(consulta)) if (v !== undefined) url.searchParams.set(k, String(v))

  let respuesta: Response
  try {
    respuesta = await pedir(url.toString(), {
      method: 'GET',
      headers: { Authorization: `Bearer ${clave}`, Accept: 'application/json', 'User-Agent': 'LibertySellerERP/1.0' },
      signal: AbortSignal.timeout(esperaMs),
      cache: 'no-store',
    })
  } catch {
    throw new ErrorRinkel('red', MENSAJE_DE_ERROR.red)
  }

  if (!respuesta.ok) {
    const estado = respuesta.status
    if (estado === 401) throw new ErrorRinkel('clave_invalida', MENSAJE_DE_ERROR.clave_invalida, estado)
    if (estado === 403) throw new ErrorRinkel('sin_permiso', MENSAJE_DE_ERROR.sin_permiso, estado)
    if (estado === 404) throw new ErrorRinkel('no_encontrada', MENSAJE_DE_ERROR.no_encontrada, estado)
    if (estado === 429) throw new ErrorRinkel('limite', MENSAJE_DE_ERROR.limite, estado)
    if (estado >= 500) throw new ErrorRinkel('servidor', MENSAJE_DE_ERROR.servidor, estado)
    throw new ErrorRinkel('respuesta', MENSAJE_DE_ERROR.respuesta, estado)
  }

  try {
    return await respuesta.json()
  } catch {
    throw new ErrorRinkel('respuesta', MENSAJE_DE_ERROR.respuesta, respuesta.status)
  }
}

/* ------------------------------------------------------------------ */
/* Las llamadas, por páginas                                           */
/* ------------------------------------------------------------------ */

export interface PaginaDeLlamadas {
  filas: FilaLlamada[]
  /** Registros que llegaron y no se pudieron entender */
  descartadas: number
  /** Cuántas llamadas hay en total con el filtro pedido */
  total: number
  totalPaginas: number
  pagina: number
}

export interface OpcionesDePagina {
  pagina: number
  porPagina?: number
  /** Segundos UNIX (no milisegundos ni texto ISO: Rinkel los rechaza) */
  desdeSeg?: number
  hastaSeg?: number
}

export async function leerPaginaDeLlamadas(clave: string, op: OpcionesDePagina, deps: Partial<DepsRinkel> = {}): Promise<PaginaDeLlamadas> {
  const porPagina = Math.min(Math.max(1, op.porPagina ?? LLAMADAS_POR_PAGINA), LLAMADAS_POR_PAGINA)
  const cuerpo = await pedirRinkel(
    clave,
    '/call-detail-records',
    { page: op.pagina, perPage: porPagina, startDate: op.desdeSeg, endDate: op.hastaSeg },
    deps
  )
  if (!esObjeto(cuerpo) || !Array.isArray(cuerpo.data)) throw new ErrorRinkel('respuesta', MENSAJE_DE_ERROR.respuesta)

  const filas: FilaLlamada[] = []
  let descartadas = 0
  for (const crudo of cuerpo.data) {
    const fila = normalizarLlamada(crudo)
    if (fila) filas.push(fila)
    else descartadas += 1
  }

  const paginacion = esObjeto(cuerpo.meta) && esObjeto(cuerpo.meta.pagination) ? cuerpo.meta.pagination : {}
  const numero = (x: unknown, defecto: number) => (typeof x === 'number' && Number.isFinite(x) ? x : defecto)
  return {
    filas,
    descartadas,
    total: numero(paginacion.totalItems, filas.length),
    totalPaginas: Math.max(1, numero(paginacion.totalPages, 1)),
    pagina: numero(paginacion.currentPage, op.pagina),
  }
}

/* ------------------------------------------------------------------ */
/* Comprobar una clave                                                 */
/* ------------------------------------------------------------------ */

export interface CuentaDeRinkel {
  /** El nombre del usuario de Rinkel, si la API lo da */
  usuario: string | null
  /** La línea con su etiqueta, si la API la da */
  numero: string | null
  /** Cuántas llamadas tiene la cuenta en total */
  totalLlamadas: number
}

/**
 * ¿Es válida esta clave, y de qué cuenta es?
 *
 * Lo que la valida es leer UNA llamada: es justo lo que se va a hacer después, así que si eso falla la
 * clave no sirve para esto aunque Rinkel la reconozca. El nombre y la línea son para enseñarlos al
 * vincular; si la clave no tiene permiso para esas dos lecturas, no pasa nada y se queda sin ellos.
 */
export async function comprobarClave(clave: string, deps: Partial<DepsRinkel> = {}): Promise<CuentaDeRinkel> {
  const pagina = await leerPaginaDeLlamadas(clave, { pagina: 1, porPagina: 1 }, deps)

  let usuario: string | null = null
  let numero: string | null = null
  try {
    const u = await pedirRinkel(clave, '/users', {}, deps)
    const primero = esObjeto(u) && Array.isArray(u.data) ? u.data[0] : null
    usuario = esObjeto(primero) ? texto(primero.fullName) : null
  } catch (e) {
    if (e instanceof ErrorRinkel && e.codigo === 'clave_invalida') throw e
  }
  try {
    const n = await pedirRinkel(clave, '/numbers', {}, deps)
    const primero = esObjeto(n) && Array.isArray(n.data) ? n.data[0] : null
    if (esObjeto(primero)) numero = [texto(primero.label), texto(primero.localizedNumber)].filter(Boolean).join(' · ') || null
  } catch (e) {
    if (e instanceof ErrorRinkel && e.codigo === 'clave_invalida') throw e
  }

  return { usuario, numero, totalLlamadas: pagina.total }
}

/* ------------------------------------------------------------------ */
/* La grabación                                                        */
/* ------------------------------------------------------------------ */

/**
 * La URL temporal (3 horas) con la que el navegador puede reproducir una grabación.
 *
 * SE COMPRUEBA A DÓNDE APUNTA antes de devolverla: el ERP la usa para REDIRIGIR el navegador de quien
 * pulsa «escuchar», y una respuesta con otro destino convertiría esa redirección en un salto a donde
 * quiera quien controle la respuesta. Solo se acepta https y el propio host de Rinkel.
 */
export async function pedirUrlDeGrabacion(clave: string, idGrabacion: string, deps: Partial<DepsRinkel> = {}): Promise<string> {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(idGrabacion)) throw new ErrorRinkel('no_encontrada', MENSAJE_DE_ERROR.no_encontrada)
  const cuerpo = await pedirRinkel(clave, `/call-recordings/${idGrabacion}/stream`, {}, deps)
  const url = esObjeto(cuerpo) && esObjeto(cuerpo.data) ? texto(cuerpo.data.url) : null
  if (!url) throw new ErrorRinkel('respuesta', MENSAJE_DE_ERROR.respuesta)

  let destino: URL
  try {
    destino = new URL(url)
  } catch {
    throw new ErrorRinkel('respuesta', MENSAJE_DE_ERROR.respuesta)
  }
  if (destino.protocol !== 'https:' || destino.hostname !== HOST_DE_RINKEL) throw new ErrorRinkel('respuesta', MENSAJE_DE_ERROR.respuesta)
  return destino.toString()
}

/* ------------------------------------------------------------------ */
/* La clave que escribe una persona                                    */
/* ------------------------------------------------------------------ */

/**
 * Lo que se acepta como clave: una sola palabra de letras, números, guion y guion bajo (la de Rinkel
 * son 64 cifras hexadecimales). Se limpia lo que se cuela al copiar —espacios, saltos de línea, un
 * «Bearer » delante— y se rechaza el resto SIN adivinar.
 */
export function limpiarClave(entrada: unknown): string | null {
  if (typeof entrada !== 'string') return null
  const limpia = entrada.trim().replace(/^Bearer\s+/i, '').trim()
  return /^[A-Za-z0-9_-]{16,200}$/.test(limpia) ? limpia : null
}

/** Los cuatro últimos caracteres, para reconocer la clave en pantalla («…8f90») sin enseñarla */
export function finalDeClave(clave: string): string {
  return clave.slice(-4)
}
