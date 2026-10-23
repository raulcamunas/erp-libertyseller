import { normalizarCostes, type FilaDeCoste } from './resumen'

/**
 * LEER EL GASTO DE OPENAI.
 * ========================
 * SOLO SERVIDOR. Usa una clave de ADMINISTRADOR de OpenAI (`OPENAI_ADMIN_KEY`, la que empieza por «sk-admin-»): la clave de siempre
 * (`OPENAI_API_KEY`) sirve para llamar a los modelos pero no para leer el gasto (OpenAI contesta 403 «Missing scopes: api.usage.read»). Se
 * comprueba con openai.prueba.ts con un `fetch` falso.
 *
 *   · `GET /v1/organization/costs`: un cubo por día (en UTC) con el gasto en dólares, desglosado por proyecto y por concepto. Máximo 180 cubos
 *     por página y el resto se pide con `page=<next_page>`. Los parámetros de lista van como OpenAI los manda su propio SDK: `group_by[]=…`.
 *   · `GET /v1/organization/projects`: el nombre de cada proyecto, solo para enseñarlo. Si falla, no pasa nada: se enseña el identificador.
 *
 * LA CLAVE NO SALE DE AQUÍ: no se escribe en ningún mensaje de error ni en el registro, y de la respuesta de OpenAI a un error solo se aprovecha la frase
 * de los permisos que faltan («Missing scopes: …»): un 401 repite parte de la clave en su texto, así que de ese no se enseña nada.
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
  /** Una frase de OpenAI que se puede enseñar (los permisos que faltan), o null */
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
    if (estado === 403) {
      let detalle: string | null = null
      try {
        const cuerpo = (await respuesta.json()) as { error?: { message?: unknown } | string }
        const mensaje = typeof cuerpo?.error === 'string' ? cuerpo.error : typeof cuerpo?.error?.message === 'string' ? cuerpo.error.message : ''
        // Solo los nombres de los permisos («api.usage.read»): el resto de la frase no se aprovecha
        const falta = /Missing scopes?:\s*([A-Za-z0-9_.:-]+(?:\s*,\s*[A-Za-z0-9_.:-]+)*)/i.exec(mensaje)
        detalle = falta ? `Falta el permiso ${falta[1].replace(/[.\s]+$/, '')}` : null
      } catch {
        detalle = null
      }
      throw new ErrorDeGasto('sin_permiso', MENSAJE_DE_GASTO.sin_permiso, estado, detalle)
    }
    if (estado === 404) throw new ErrorDeGasto('no_encontrada', MENSAJE_DE_GASTO.no_encontrada, estado)
    if (estado === 429) throw new ErrorDeGasto('limite', MENSAJE_DE_GASTO.limite, estado)
    if (estado >= 500) throw new ErrorDeGasto('servidor', MENSAJE_DE_GASTO.servidor, estado)
    throw new ErrorDeGasto('respuesta', MENSAJE_DE_GASTO.respuesta, estado)
  }

  try {
    return await respuesta.json()
  } catch {
    throw new ErrorDeGasto('respuesta', MENSAJE_DE_GASTO.respuesta, respuesta.status)
  }
}

/** Cubos por página: el máximo que deja OpenAI */
const CUBOS_POR_PAGINA = 180
/** Páginas como mucho: 5 × 180 días son más de dos años, de sobra para los 12 meses que se enseñan */
const MAXIMO_DE_PAGINAS = 5

/**
 * El gasto diario desde `desdeSeg` (segundos UNIX, UTC) hasta ahora, desglosado por proyecto y concepto.
 * Pide las páginas que haga falta; un fallo a mitad no se disimula (mejor un error que una cifra incompleta que parezca entera).
 */
export async function leerCostes(clave: string, desdeSeg: number, deps: Partial<DepsDeGasto> = {}): Promise<FilaDeCoste[]> {
  const filas: FilaDeCoste[] = []
  let pagina: string | null = null
  for (let i = 0; i < MAXIMO_DE_PAGINAS; i++) {
    const consulta: Consulta = [
      ['start_time', Math.floor(desdeSeg)],
      ['bucket_width', '1d'],
      ['limit', CUBOS_POR_PAGINA],
      ['group_by[]', 'project_id'],
      ['group_by[]', 'line_item'],
    ]
    if (pagina) consulta.push(['page', pagina])
    const cuerpo = await pedir(clave, '/organization/costs', consulta, deps)
    const p = normalizarCostes(cuerpo)
    if (!p) throw new ErrorDeGasto('respuesta', MENSAJE_DE_GASTO.respuesta)
    filas.push(...p.filas)
    if (!p.hayMas || !p.siguiente) return filas
    pagina = p.siguiente
  }
  return filas
}

/** El nombre de cada proyecto de la organización, por su identificador. Si no se puede leer, un mapa vacío */
export async function leerProyectos(clave: string, deps: Partial<DepsDeGasto> = {}): Promise<Map<string, string>> {
  const nombres = new Map<string, string>()
  try {
    const cuerpo = await pedir(clave, '/organization/projects', [['limit', 100]], deps)
    const datos = cuerpo && typeof cuerpo === 'object' ? (cuerpo as { data?: unknown }).data : null
    if (Array.isArray(datos)) {
      for (const p of datos) {
        const o = p as { id?: unknown; name?: unknown }
        if (typeof o?.id === 'string' && typeof o?.name === 'string' && o.name.trim()) nombres.set(o.id, o.name.trim())
      }
    }
  } catch {
    // Solo sirve para enseñar un nombre en vez de un identificador
  }
  return nombres
}
