import type {
  AlcanceDeAsignar,
  FilaDeLead,
  FilaDeResumen,
  FilaDelBanco,
  FiltroDeBanco,
  FiltroDeLeads,
  ListaRegistrada,
  Movimiento,
  PersonaDelEquipo,
  ResultadoDeAnadir,
  ResultadoDeMover,
  ResumenDelBanco,
} from '@/lib/cold-calling/listas'
import type { PeticionDeSeleccion } from '@/lib/cold-calling/seleccion'

/**
 * LA PANTALLA DE LISTAS HABLA CON /api/cold-calling/listas — aquí, en un solo sitio.
 *
 * Cada función devuelve un resultado que es `{ ok: true, datos }` o `{ ok: false, error, estado }`: nunca lanza. El `error` ya es una frase para enseñar tal cual (la ruta
 * contesta con frases fijas, nunca con el texto técnico de una excepción), y `estado` es el HTTP (0 = no se pudo conectar; 503 = falta la migración 257).
 */

export interface RespuestaDelPanel {
  migracion: boolean
  registro: ListaRegistrada[]
  filas: FilaDeResumen[]
  equipo: PersonaDelEquipo[]
  /** El nombre de todas las personas, por id */
  nombres: Record<string, string>
  movimientos: Movimiento[]
  /** El id de quien mira */
  yo: string
}

export type Resultado<T> = { ok: true; datos: T } | { ok: false; error: string; estado: number }

async function pedir<T>(url: string, init?: RequestInit): Promise<Resultado<T>> {
  try {
    const r = await fetch(url, { cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } })
    const cuerpo = (await r.json().catch(() => null)) as (T & { ok?: boolean; error?: string }) | null
    if (!r.ok || !cuerpo || cuerpo.ok === false) return { ok: false, error: cuerpo?.error ?? 'No se ha podido completar. Vuelve a intentarlo.', estado: r.status }
    return { ok: true, datos: cuerpo }
  } catch {
    return { ok: false, error: 'No se ha podido conectar. Vuelve a probar.', estado: 0 }
  }
}

const post = <T>(url: string, cuerpo: Record<string, unknown>) => pedir<T>(url, { method: 'POST', body: JSON.stringify(cuerpo) })
const cambiar = <T>(cuerpo: Record<string, unknown>) => post<T>('/api/cold-calling/listas', cuerpo)

export const cargarPanel = () => pedir<RespuestaDelPanel>('/api/cold-calling/listas')

export const crearLista = (d: { nombre: string; descripcion?: string; responsable?: string | null }) => cambiar<{ id: string; nombre: string }>({ accion: 'crear', ...d })
export const renombrarLista = (id: string, nombre: string) => cambiar<{ id: string; nombre: string; leads: number }>({ accion: 'renombrar', id, nombre })
export const archivarLista = (id: string, archivada: boolean) => cambiar<{ id: string; nombre: string; archivada: boolean }>({ accion: 'archivar', id, archivada })
export const asignarLista = (id: string, dueno: string | null, alcance: AlcanceDeAsignar) => cambiar<ResultadoDeMover & { nombre: string }>({ accion: 'asignar_lista', id, dueno, alcance })
export const deshacer = (movimiento: string) => cambiar<{ deshechos: number; conservados: number; accion: string }>({ accion: 'deshacer', movimiento })

/** `lista` y `dueno`: si la clave está (aunque sea null) se cambia; null = sacarlos de toda lista / dejarlos sin dueño */
export const moverLeads = (seleccion: PeticionDeSeleccion, filtro: FiltroDeLeads, cambios: { lista?: string | null; dueno?: string | null }) =>
  cambiar<ResultadoDeMover>({ accion: 'mover', ...seleccion, filtro, ...cambios })

export const buscarLeads = (filtro: FiltroDeLeads, pagina: number) => post<{ total: number; filas: FilaDeLead[]; porPagina: number }>('/api/cold-calling/listas/leads', { filtro, pagina })

export const cargarResumenDelBanco = () => pedir<{ resumen: ResumenDelBanco }>('/api/cold-calling/listas/banco')
export const buscarEnElBanco = (filtro: FiltroDeBanco, pagina: number) =>
  post<{ total: number; filas: FilaDelBanco[]; porPagina: number }>('/api/cold-calling/listas/banco', { accion: 'buscar', filtro, pagina })
export const anadirDelBanco = (peticion: { dominios: string[] } | { filtro: FiltroDeBanco; primeras: number }, lista: string, dueno: string | null) =>
  post<ResultadoDeAnadir>('/api/cold-calling/listas/banco', { accion: 'anadir', ...peticion, lista, dueno })
