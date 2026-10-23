import { normalizarCostes, type ClaveDeApi, type FilaDeCoste } from './resumen'

/**
 * LEER EL GASTO DE OPENAI.
 * ========================
 * SOLO SERVIDOR. Usa una clave de ADMINISTRADOR de OpenAI (`OPENAI_ADMIN_KEY`, la que empieza por «sk-admin-»): la clave de siempre
 * (`OPENAI_API_KEY`) sirve para llamar a los modelos pero no para leer el gasto (OpenAI contesta 403 «Missing scopes: api.usage.read»). Se
 * comprueba con openai.prueba.ts con un `fetch` falso, y se comprobó el 23 oct 2026 contra la cuenta real de Raúl.
 *
 *   · `GET /v1/organization/costs`: un cubo por día (en UTC) con el gasto en dólares, desglosado por proyecto, por CLAVE DE API y por concepto.
 *     Máximo 180 cubos por página y el resto se pide con `page=<next_page>`. Los parámetros de lista van como los manda el SDK de OpenAI:
 *     `group_by[]=…`.
 *   · `GET /v1/organization/projects` y `GET /v1/organization/projects/{id}/api_keys`: los nombres de los proyectos y de las claves, solo para enseñarlos
 *     («LibertyERP», «n8n»…) y para saber cuál es la del ERP. De una clave OpenAI solo da cómo termina, nunca el valor.
 *
 * DOS LÍMITES DE OPENAI QUE SALIERON AL PROBAR CON DATOS REALES (los dos son un 400):
 *   · Solo deja mirar el ÚLTIMO AÑO («reporting_lookback_exceeded»: «Earliest supported start date: 2025-10-23»). Pedir 400 días falla entero.
 *   · Agrupar por clave solo funciona desde una fecha («group_by=api_key_id is not available for this time range. Try a start_time on or after N»).
 * En los dos casos el mensaje dice desde cuándo vale, y se vuelve a pedir desde ahí (una vez por motivo). Lo aprendido se recuerda mientras viva el proceso.
 *
 * LA CLAVE NO SALE DE AQUÍ: no se escribe en ningún mensaje de error ni en el registro. De la respuesta de OpenAI a un error solo se aprovecha la frase
 * de los permisos que faltan («Missing scopes: …») y, en un 400, su mensaje con cualquier cosa que parezca una clave tachada; un 401 repite parte de la clave
 * en su texto, así que de ese no se enseña nada.
 */

const BASE = 'https://api.openai.com/v1'

/** Los nombres con los que se acepta la clave en el servidor. El primero es el que se le dijo a Raúl que pusiera */
export const NOMBRES_DE_LA_CLAVE = ['OPENAI_ADMIN_KEY', 'OPENAI_ADMIN_API_KEY'] as const

export function claveDeAdministrador(entorno: Record<string, string | undefined> = process.env): string | null {
  for (const nombre of NOMBRES_DE_LA_CLAVE) {
    const v = entorno[nombre]?.trim()
    if (v) return v
  }
  return null
}

export type CodigoDeErrorDeGasto = 'clave_invalida' | 'sin_permiso' | 'no_encontrada' | 'limite' | 'servidor' | 'red' | 'respuesta'

export class ErrorDeGasto extends Error {
  readonly codigo: CodigoDeErrorDeGasto
  readonly estado: number | null
  /** Una frase de OpenAI que se puede enseñar (los permisos que faltan, o su mensaje de un 400 ya limpio), o null */
  readonly detalle: string | null
  constructor(codigo: CodigoDeErrorDeGasto, mensaje: string, estado: number | null = null, detalle: string | null = null) {
    super(mensaje)
    this.name = 'ErrorDeGasto'
    this.codigo = codigo
    this.estado = estado
    this.detalle = detalle
  }
}

export const MENSAJE_DE_GASTO: Record<CodigoDeErrorDeGasto, string> = {
  clave_invalida: 'OpenAI no reconoce la clave de administrador. Comprueba que está copiada entera en OPENAI_ADMIN_KEY (empieza por «sk-admin-»).',
  sin_permiso: 'La clave de administrador no tiene permiso para leer el gasto. En OpenAI hay que darle «Usage: Read» (o «Read only»).',
  no_encontrada: 'OpenAI no encuentra los costes. Suele ser que la clave no es de administrador (una clave normal no vale).',
  limite: 'OpenAI está recibiendo demasiadas peticiones. Vuelve a probar en un minuto.',
  servidor: 'OpenAI tiene un problema ahora mismo. Vuelve a probar en unos minutos.',
  red: 'No se ha podido hablar con OpenAI. Vuelve a probar en un momento.',
  respuesta: 'OpenAI ha contestado algo que no se entiende.',
}

export interface DepsDeGasto {
  fetch: typeof fetch
  esperaMs: number
}

const POR_DEFECTO: DepsDeGasto = { fetch: (...a) => fetch(...a), esperaMs: 25_000 }

type Consulta = Array<[string, string | number]>

/** Todo lo que parezca una clave se tacha antes de enseñar una frase de OpenAI */
const sinClaves = (t: string): string => t.replace(/sk-[A-Za-z0-9_\-*.]+/g, 'sk-…')

async function pedir(clave: string, ruta: string, consulta: Consulta, deps: Partial<DepsDeGasto>): Promise<unknown> {
  const { fetch: llamar, esperaMs } = { ...POR_DEFECTO, ...deps }
  const url = new URL(`${BASE}${ruta}`)
  for (const [k, v] of consulta) url.searchParams.append(k, String(v))

  let respuesta: Response
  try {
    respuesta = await llamar(url.toString(), { method: 'GET', headers: { Authorization: `Bearer ${clave}`, Accept: 'application/json' }, signal: AbortSignal.timeout(esperaMs), cache: 'no-store' })
  } catch {
    throw new ErrorDeGasto('red', MENSAJE_DE_GASTO.red)
  }

  if (!respuesta.ok) {
    const estado = respuesta.status
    if (estado === 401) throw new ErrorDeGasto('clave_invalida', MENSAJE_DE_GASTO.clave_invalida, estado)
    // El mensaje del error de OpenAI, si lo trae (para un 403 y para un 400)
    let mensaje = ''
    try {
      const cuerpo = (await respuesta.json()) as { error?: { message?: unknown } | string }
      mensaje = typeof cuerpo?.error === 'string' ? cuerpo.error : typeof cuerpo?.error?.message === 'string' ? cuerpo.error.message : ''
    } catch {
      mensaje = ''
    }
    if (estado === 403) {
      // Solo los nombres de los permisos («api.usage.read»): el resto de la frase no se aprovecha
      const falta = /Missing scopes?:\s*([A-Za-z0-9_.:-]+(?:\s*,\s*[A-Za-z0-9_.:-]+)*)/i.exec(mensaje)
      throw new ErrorDeGasto('sin_permiso', MENSAJE_DE_GASTO.sin_permiso, estado, falta ? `Falta el permiso ${falta[1].replace(/[.\s]+$/, '')}` : null)
    }
    if (estado === 404) throw new ErrorDeGasto('no_encontrada', MENSAJE_DE_GASTO.no_encontrada, estado)
    if (estado === 429) throw new ErrorDeGasto('limite', MENSAJE_DE_GASTO.limite, estado)
    if (estado >= 500) throw new ErrorDeGasto('servidor', MENSAJE_DE_GASTO.servidor, estado)
    // Un 400 y similares: OpenAI dice qué parámetro no le gusta, y esa frase es la que hace falta para arreglarlo
    throw new ErrorDeGasto('respuesta', MENSAJE_DE_GASTO.respuesta, estado, mensaje ? sinClaves(mensaje).slice(0, 300) : null)
  }

  try {
    return await respuesta.json()
  } catch {
    throw new ErrorDeGasto('respuesta', MENSAJE_DE_GASTO.respuesta, respuesta.status)
  }
}

/** Cubos por página: el máximo que deja OpenAI */
const CUBOS_POR_PAGINA = 180
/** Páginas como mucho: 5 × 180 días son más de dos años, de sobra para el año que deja mirar OpenAI */
const MAXIMO_DE_PAGINAS = 5

/** La fecha más temprana que ha aceptado OpenAI hasta ahora (segundos UNIX). Se aprende de sus 400 y se recuerda mientras viva el proceso */
let pisoAprendido = 0

export function olvidarElPiso(): void {
  pisoAprendido = 0
}

/**
 * Si el 400 de OpenAI dice desde cuándo vale la consulta, ese instante (segundos UNIX); si no, null.
 *   «Earliest supported start date: 2025-10-23 (UTC).»   «Try a start_time on or after 1764979200.»
 */
export function inicioQueAceptaOpenAi(error: ErrorDeGasto): number | null {
  if (error.estado !== 400 || !error.detalle) return null
  const fecha = /Earliest supported start date:\s*(\d{4}-\d{2}-\d{2})/i.exec(error.detalle)
  if (fecha) {
    const t = Date.parse(`${fecha[1]}T00:00:00Z`)
    return Number.isFinite(t) ? t / 1000 : null
  }
  const unix = /start_time on or after (\d{9,11})/i.exec(error.detalle)
  return unix ? Number(unix[1]) : null
}

/**
 * El gasto diario desde `desdeSeg` (segundos UNIX, UTC) hasta ahora, desglosado por proyecto, clave de API y concepto.
 * Pide las páginas que haga falta; un fallo a mitad no se disimula (mejor un error que una cifra incompleta que parezca entera).
 */
export async function leerCostes(clave: string, desdeSeg: number, deps: Partial<DepsDeGasto> = {}): Promise<FilaDeCoste[]> {
  let desde = Math.max(Math.floor(desdeSeg), pisoAprendido)
  let reintentos = 0
  const filas: FilaDeCoste[] = []
  let pagina: string | null = null
  for (let i = 0; i < MAXIMO_DE_PAGINAS; ) {
    const consulta: Consulta = [
      ['start_time', desde],
      ['bucket_width', '1d'],
      ['limit', CUBOS_POR_PAGINA],
      ['group_by[]', 'project_id'],
      ['group_by[]', 'api_key_id'],
      ['group_by[]', 'line_item'],
    ]
    if (pagina) consulta.push(['page', pagina])
    let cuerpo: unknown
    try {
      cuerpo = await pedir(clave, '/organization/costs', consulta, deps)
    } catch (e) {
      // OpenAI dice desde cuándo vale la consulta: se vuelve a pedir desde ahí, como mucho dos veces (una por cada límite) y solo en la primera página
      const mejor = e instanceof ErrorDeGasto && pagina === null && reintentos < 2 ? inicioQueAceptaOpenAi(e) : null
      if (mejor !== null && mejor > desde) {
        desde = mejor
        pisoAprendido = Math.max(pisoAprendido, mejor)
        reintentos++
        continue
      }
      throw e
    }
    i++
    const p = normalizarCostes(cuerpo)
    if (!p) throw new ErrorDeGasto('respuesta', MENSAJE_DE_GASTO.respuesta)
    filas.push(...p.filas)
    if (!p.hayMas || !p.siguiente) return filas
    pagina = p.siguiente
  }
  return filas
}

/** Una página de una lista de OpenAI («data»), o null si no se puede leer */
async function leerLista(clave: string, ruta: string, consulta: Consulta, deps: Partial<DepsDeGasto>): Promise<unknown[] | null> {
  try {
    const cuerpo = await pedir(clave, ruta, consulta, deps)
    const datos = cuerpo && typeof cuerpo === 'object' ? (cuerpo as { data?: unknown }).data : null
    return Array.isArray(datos) ? datos : null
  } catch {
    // Solo sirven para enseñar un nombre en vez de un identificador
    return null
  }
}

/** Los proyectos de la organización: su identificador y su nombre. Si no se pueden leer, una lista vacía */
export async function leerProyectos(clave: string, deps: Partial<DepsDeGasto> = {}): Promise<Array<{ id: string; nombre: string }>> {
  const datos = (await leerLista(clave, '/organization/projects', [['limit', 100]], deps)) ?? []
  const proyectos: Array<{ id: string; nombre: string }> = []
  for (const p of datos) {
    const o = p as { id?: unknown; name?: unknown }
    if (typeof o?.id === 'string' && typeof o?.name === 'string' && o.name.trim()) proyectos.push({ id: o.id, nombre: o.name.trim() })
  }
  return proyectos
}

/**
 * Las claves de API de esos proyectos, con su nombre y cómo terminan (OpenAI nunca da el valor). Sirve para ponerle nombre a cada gasto y para saber cuál es la
 * del ERP. Si no se pueden leer, una lista vacía y el gasto se enseña sin nombres de clave.
 */
export async function leerClavesDeApi(clave: string, proyectos: ReadonlyArray<{ id: string }>, deps: Partial<DepsDeGasto> = {}): Promise<ClaveDeApi[]> {
  const claves: ClaveDeApi[] = []
  for (const proyecto of proyectos) {
    const datos = (await leerLista(clave, `/organization/projects/${encodeURIComponent(proyecto.id)}/api_keys`, [['limit', 100]], deps)) ?? []
    for (const k of datos) {
      const o = k as { id?: unknown; name?: unknown; redacted_value?: unknown }
      if (typeof o?.id !== 'string') continue
      const oculto = typeof o.redacted_value === 'string' ? o.redacted_value : ''
      claves.push({ id: o.id, nombre: typeof o.name === 'string' && o.name.trim() ? o.name.trim() : 'Sin nombre', terminaEn: oculto.length >= 4 ? oculto.slice(-4) : null, proyecto: proyecto.id })
    }
  }
  return claves
}
