import { estadosDe, type ClienteTC, type OpcionDeEstado, type TareaTC } from './tipos'

/**
 * LO QUE VE EL CLIENTE EN SU PANEL — PURO.
 *
 * El cliente llega con un enlace secreto, sin entrar al ERP, y ve SOLO las tareas que alguien del equipo marcó con «Ve el cliente». De cada una se le enseña lo mínimo para saber
 * en qué punto está su cuenta: título, en qué fase está, el departamento, las fechas y el avance. NUNCA el cuerpo, los comentarios, las personas, las notas internas ni los enlaces a Notion.
 *
 * `paraElCliente` es una LISTA BLANCA: construye el objeto campo a campo, así que una columna nueva en la tabla de tareas no llega al cliente por accidente.
 */

export type FaseParaElCliente = 'en_curso' | 'pendiente' | 'hecho'

export interface TareaDelPortal {
  id: string
  titulo: string
  icono: string | null
  estado: string
  fase: FaseParaElCliente
  departamento: string | null
  fecha_inicio: string | null
  fecha_fin: string | null
  /** 0–100 */
  progreso: number
  actualizada: string
}

export type FilaParaElPortal = Pick<TareaTC, 'id' | 'titulo' | 'icono' | 'estado' | 'departamento' | 'fecha_inicio' | 'fecha_fin' | 'progreso' | 'actualizado_en'> & Partial<Pick<TareaTC, 'checklist_total' | 'checklist_hecho'>>

export const COLUMNAS_DEL_PORTAL = 'id, titulo, icono, estado, departamento, fecha_inicio, fecha_fin, progreso, checklist_total, checklist_hecho, actualizado_en'

const FASE_DE_GRUPO: Record<OpcionDeEstado['grupo'], FaseParaElCliente> = { pendiente: 'pendiente', en_curso: 'en_curso', hecho: 'hecho' }

export function paraElCliente(t: FilaParaElPortal, estados: readonly OpcionDeEstado[]): TareaDelPortal {
  const grupo = estados.find((e) => e.nombre === t.estado)?.grupo ?? 'pendiente'
  const conCasillas = (t.checklist_total ?? 0) > 0
  const progreso = grupo === 'hecho' ? 100 : conCasillas ? Math.round(((t.checklist_hecho ?? 0) / (t.checklist_total ?? 1)) * 100) : Math.max(0, Math.min(100, Math.round(Number(t.progreso) || 0)))
  return {
    id: t.id,
    titulo: t.titulo.trim() || 'Tarea sin título',
    icono: t.icono,
    estado: t.estado,
    fase: FASE_DE_GRUPO[grupo],
    departamento: t.departamento,
    fecha_inicio: t.fecha_inicio?.slice(0, 10) ?? null,
    fecha_fin: t.fecha_fin?.slice(0, 10) ?? null,
    progreso,
    actualizada: t.actualizado_en,
  }
}

/** Cuántas tareas hechas se enseñan como máximo, las más recientes: el cliente no necesita ver dos años de historia */
export const MAX_HECHAS_EN_EL_PORTAL = 30

export interface PanelDelCliente {
  cliente: { nombre: string; icono: string | null }
  enCurso: TareaDelPortal[]
  pendientes: TareaDelPortal[]
  hechas: TareaDelPortal[]
  totalHechas: number
}

/** Ordena por fecha (las que la tienen, primero; las demás, por última actualización) */
const porFecha = (a: TareaDelPortal, b: TareaDelPortal): number => {
  const x = a.fecha_fin ?? a.fecha_inicio
  const y = b.fecha_fin ?? b.fecha_inicio
  if (x && y) return x < y ? -1 : x > y ? 1 : 0
  if (x) return -1
  if (y) return 1
  return a.actualizada < b.actualizada ? 1 : -1
}

export function armarPanel(cliente: Pick<ClienteTC, 'nombre' | 'icono' | 'opciones'>, filas: readonly FilaParaElPortal[]): PanelDelCliente {
  const estados = estadosDe(cliente as ClienteTC)
  const todas = filas.map((f) => paraElCliente(f, estados))
  const hechasTodas = todas.filter((t) => t.fase === 'hecho').sort((a, b) => (a.actualizada < b.actualizada ? 1 : -1))
  return {
    cliente: { nombre: cliente.nombre, icono: cliente.icono },
    enCurso: todas.filter((t) => t.fase === 'en_curso').sort(porFecha),
    pendientes: todas.filter((t) => t.fase === 'pendiente').sort(porFecha),
    hechas: hechasTodas.slice(0, MAX_HECHAS_EN_EL_PORTAL),
    totalHechas: hechasTodas.length,
  }
}

export const FORMA_DE_TOKEN_DEL_PORTAL = /^[A-Za-z0-9_-]{43}$/
