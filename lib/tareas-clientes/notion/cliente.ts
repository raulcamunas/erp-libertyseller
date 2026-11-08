/**
 * HABLAR CON NOTION.
 * SOLO SERVIDOR.
 *
 * La clave de la integración vive solo en el servidor (NOTION_TOKEN) y es un SECRETO: nunca se registra ni se devuelve, ni siquiera dentro de un mensaje de error.
 * Notion deja unas 3 peticiones por segundo de media: aquí se espacian a la vez (un solo hilo por proceso) y un «demasiadas peticiones» (429) se reintenta
 * esperando lo que Notion pide.
 *
 * La versión de la API es la de los «data sources» (2025-09-03): una base de datos de Notion se consulta por su data source, y las páginas nuevas cuelgan de él.
 */

const API = 'https://api.notion.com/v1'
const VERSION = '2025-09-03'
const ESPERA_MS = 25_000
const ENTRE_PETICIONES_MS = 350
const REINTENTOS_429 = 3

export class ErrorDeNotion extends Error {
  constructor(
    mensaje: string,
    public estado: number,
    public codigo?: string
  ) {
    super(mensaje)
    this.name = 'ErrorDeNotion'
  }
}

/** La clave se acepta con los dos nombres: NOTION_TOKEN y TOKEN_NOTION (así estaba ya puesta en el servidor) */
const claveDeNotion = (): string => (process.env.NOTION_TOKEN ?? process.env.TOKEN_NOTION ?? '').trim()

export const notionConfigurado = (): boolean => Boolean(claveDeNotion())

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// Un solo reloj por proceso: Next compila cada ruta por separado y una variable de módulo normal serían varias copias
const compartido = globalThis as unknown as { __notionUltima?: number; __notionCola?: Promise<void> }

/** Deja pasar las peticiones de una en una, con un hueco entre ellas */
async function turno(): Promise<void> {
  const anterior = compartido.__notionCola ?? Promise.resolve()
  const mio = anterior.then(async () => {
    const espera = (compartido.__notionUltima ?? 0) + ENTRE_PETICIONES_MS - Date.now()
    if (espera > 0) await dormir(espera)
    compartido.__notionUltima = Date.now()
  })
  compartido.__notionCola = mio.catch(() => undefined)
  await mio
}

export async function notion<T = unknown>(ruta: string, opciones: { metodo?: string; cuerpo?: unknown; query?: Record<string, string | number | undefined> } = {}): Promise<T> {
  const token = claveDeNotion()
  if (!token) throw new ErrorDeNotion('Falta la clave de Notion (NOTION_TOKEN) en el servidor.', 503, 'sin_clave')

  const url = new URL(`${API}/${ruta.replace(/^\//, '')}`)
  for (const [k, v] of Object.entries(opciones.query ?? {})) if (v !== undefined && v !== '') url.searchParams.set(k, String(v))

  for (let intento = 0; ; intento++) {
    await turno()
    let res: Response
    try {
      res = await fetch(url, {
        method: opciones.metodo ?? 'GET',
        headers: { Authorization: `Bearer ${token}`, 'Notion-Version': VERSION, ...(opciones.cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: opciones.cuerpo !== undefined ? JSON.stringify(opciones.cuerpo) : undefined,
        signal: AbortSignal.timeout(ESPERA_MS),
        cache: 'no-store',
      })
    } catch (e) {
      // El mensaje de error de fetch puede llevar la dirección: no se devuelve tal cual
      throw new ErrorDeNotion(e instanceof Error && e.name === 'TimeoutError' ? 'Notion no ha contestado a tiempo.' : 'No se ha podido contactar con Notion.', 504, 'red')
    }
    if (res.status === 429 && intento < REINTENTOS_429) {
      const pide = Number(res.headers.get('retry-after'))
      await dormir((Number.isFinite(pide) && pide > 0 ? Math.min(pide, 30) : 2 ** intento) * 1000)
      continue
    }
    const datos = (await res.json().catch(() => null)) as (T & { message?: string; code?: string }) | null
    if (!res.ok) throw new ErrorDeNotion(textoDeError(res.status, datos?.code, datos?.message), res.status, datos?.code)
    return datos as T
  }
}

function textoDeError(estado: number, codigo?: string, mensaje?: string): string {
  if (estado === 401) return 'Notion no acepta la clave (NOTION_TOKEN): puede estar mal copiada o haberse revocado.'
  if (estado === 403 || codigo === 'restricted_resource') return 'Notion no deja a la integración tocar esto: hay que compartir la página «Tareas Clientes» con ella.'
  if (estado === 404 || codigo === 'object_not_found') return 'Notion no encuentra la página o la base: se ha borrado o no está compartida con la integración.'
  if (estado === 429) return 'Notion pide ir más despacio. Se reintenta solo.'
  return `Notion ha contestado ${estado}${codigo ? ` (${codigo})` : ''}${mensaje ? `: ${mensaje.slice(0, 200)}` : ''}.`
}

/* ------------------------------------------------------------------ */
/* Lo que se pide a Notion, con los tipos de lo que se usa             */
/* ------------------------------------------------------------------ */

export interface PaginaNotion {
  id: string
  url?: string
  created_time?: string
  last_edited_time: string
  archived?: boolean
  in_trash?: boolean
  icon?: { type?: string; emoji?: string } | null
  parent?: { type?: string; database_id?: string; data_source_id?: string; page_id?: string }
  properties: Record<string, PropiedadDePagina>
}

export interface PropiedadDePagina {
  id?: string
  type: string
  [clave: string]: unknown
}

export interface DataSourceNotion {
  id: string
  title?: Array<{ plain_text?: string }>
  parent?: { type?: string; database_id?: string }
  properties: Record<string, PropiedadDelEsquema>
}

export interface PropiedadDelEsquema {
  id?: string
  name: string
  type: string
  status?: { options?: Array<{ id?: string; name: string; color?: string }>; groups?: Array<{ id?: string; name: string; color?: string; option_ids?: string[] }> }
  select?: { options?: Array<{ id?: string; name: string; color?: string }> }
  multi_select?: { options?: Array<{ id?: string; name: string; color?: string }> }
}

export interface ComentarioNotion {
  id: string
  discussion_id?: string
  created_time: string
  created_by?: { id?: string; name?: string }
  rich_text: Array<{ plain_text?: string; text?: { content?: string } }>
  parent?: { type?: string; page_id?: string; block_id?: string }
}

export interface UsuarioNotion {
  id: string
  name?: string
  type?: string
  person?: { email?: string }
}

type Lista<T> = { results: T[]; next_cursor: string | null; has_more: boolean }

/** Recorre todas las páginas de un resultado de Notion (100 en 100) */
async function todo<T>(pedir: (cursor: string | undefined) => Promise<Lista<T>>, tope = 5000): Promise<T[]> {
  const salida: T[] = []
  let cursor: string | undefined
  do {
    const r = await pedir(cursor)
    salida.push(...r.results)
    cursor = r.has_more && r.next_cursor ? r.next_cursor : undefined
  } while (cursor && salida.length < tope)
  return salida
}

export const leerDataSource = (id: string) => notion<DataSourceNotion>(`data_sources/${id}`)

/** Las páginas de una base editadas después de `desde` (todas si no se dice), de la más antigua a la más reciente */
export function paginasDeLaBase(dataSourceId: string, desde?: string): Promise<PaginaNotion[]> {
  return todo<PaginaNotion>((cursor) =>
    notion<Lista<PaginaNotion>>(`data_sources/${dataSourceId}/query`, {
      metodo: 'POST',
      cuerpo: {
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
        ...(desde ? { filter: { timestamp: 'last_edited_time', last_edited_time: { after: desde } } } : {}),
        sorts: [{ timestamp: 'last_edited_time', direction: 'ascending' }],
      },
    })
  )
}

export const leerPagina = (id: string) => notion<PaginaNotion>(`pages/${id}`)

export const crearPagina = (dataSourceId: string, propiedades: Record<string, unknown>, extra: { icon?: unknown; children?: unknown[] } = {}) =>
  notion<PaginaNotion>('pages', { metodo: 'POST', cuerpo: { parent: { type: 'data_source_id', data_source_id: dataSourceId }, properties: propiedades, ...extra } })

export const actualizarPagina = (id: string, cambios: { properties?: Record<string, unknown>; icon?: unknown; in_trash?: boolean }) => notion<PaginaNotion>(`pages/${id}`, { metodo: 'PATCH', cuerpo: cambios })

/** Los bloques de una página (o de otro bloque), con sus hijos ya traídos hasta `profundidad` niveles */
export async function bloquesDe(id: string, profundidad = 4): Promise<import('../bloques').BloqueNotion[]> {
  const lista = await todo<import('../bloques').BloqueNotion>((cursor) => notion<Lista<import('../bloques').BloqueNotion>>(`blocks/${id}/children`, { query: { page_size: 100, start_cursor: cursor } }), 2000)
  if (profundidad > 0) {
    for (const b of lista) {
      // Los bloques que no sabemos editar no se abren: se enseñan enteros y no hace falta su interior
      if (b.has_children && SE_ABREN.has(b.type)) b.children = await bloquesDe(b.id, profundidad - 1)
    }
  }
  return lista
}

const SE_ABREN: ReadonlySet<string> = new Set(['paragraph', 'heading_1', 'heading_2', 'heading_3', 'bulleted_list_item', 'numbered_list_item', 'to_do', 'quote', 'callout', 'toggle', 'table'])

export const anadirBloques = (padreId: string, hijos: unknown[], despues?: string) =>
  notion<Lista<{ id: string }>>(`blocks/${padreId}/children`, { metodo: 'PATCH', cuerpo: { children: hijos, ...(despues ? { after: despues } : {}) } })

export const actualizarBloque = (id: string, cuerpo: Record<string, unknown>) => notion<{ id: string }>(`blocks/${id}`, { metodo: 'PATCH', cuerpo })

export const borrarBloque = (id: string) => notion<{ id: string }>(`blocks/${id}`, { metodo: 'DELETE' })

export const comentariosDe = (paginaId: string) => todo<ComentarioNotion>((cursor) => notion<Lista<ComentarioNotion>>('comments', { query: { block_id: paginaId, page_size: 100, start_cursor: cursor } }), 1000)

export const crearComentario = (paginaId: string, richText: unknown[]) => notion<ComentarioNotion>('comments', { metodo: 'POST', cuerpo: { parent: { page_id: paginaId }, rich_text: richText } })

export const leerUsuario = (id: string) => notion<UsuarioNotion>(`users/${id}`)

export const listarUsuarios = () => todo<UsuarioNotion>((cursor) => notion<Lista<UsuarioNotion>>('users', { query: { page_size: 100, start_cursor: cursor } }), 500)

export const quienSoy = () => notion<{ id: string; name?: string; bot?: { workspace_name?: string } }>('users/me')
