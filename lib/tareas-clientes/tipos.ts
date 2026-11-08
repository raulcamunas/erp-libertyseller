/**
 * TAREAS DE CLIENTES: LOS TIPOS.
 *
 * Lo que dicen las tablas `tc_*` (migración 275), en el idioma del código. Una tarea tiene un estado y un departamento que son TEXTO (el nombre de la
 * opción, tal como la llama Notion) y no un id: cada base de Notion tiene sus opciones, y escribir el nombre es lo que Notion entiende al otro lado.
 */

/** Los colores de las opciones de Notion. Se guardan con su nombre y se pintan con la paleta de colores.ts */
export type ColorNotion = 'default' | 'gray' | 'brown' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink' | 'red'

export const COLORES_NOTION: readonly ColorNotion[] = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red']

/** Dónde cae un estado en la vida de una tarea: lo que Notion llama «To-do», «In progress» y «Complete» */
export type GrupoDeEstado = 'pendiente' | 'en_curso' | 'hecho'

export interface OpcionDeEstado {
  nombre: string
  color: ColorNotion
  grupo: GrupoDeEstado
}

export interface OpcionSimple {
  nombre: string
  color: ColorNotion
}

export interface OpcionesDelCliente {
  estados: OpcionDeEstado[]
  departamentos: OpcionSimple[]
  /**
   * El orden de las columnas que ha elegido el equipo arrastrándolas (nombres de estado). Solo existe en el ERP: Notion no se entera y la sincronización no lo toca. Un estado
   * que no esté en la lista (uno nuevo de Notion) va al final, en el orden de Notion.
   */
  orden_columnas?: string[]
}

/** La portada o el fondo de una pantalla: un color liso, un degradado de la lista, una imagen subida o (solo el fondo) uno animado de la lista */
export interface Portada {
  tipo?: 'color' | 'degradado' | 'imagen' | 'animado'
  /** El nombre del color o del degradado, o la dirección de la imagen */
  valor?: string
  /** Hasta dónde se desplaza la imagen para encuadrarla, de 0 a 100 */
  y?: number
}

export type GrupoDeCliente = 'agencia' | 'marcas_eeuu' | 'otros'

export const ETIQUETA_DE_GRUPO: Record<GrupoDeCliente, string> = {
  agencia: 'Cliente Gestión Agencia',
  marcas_eeuu: 'Marcas Privadas EEUU',
  otros: 'Otros',
}

/** Qué columna de Notion es cada cosa en una base concreta (cada una las llama distinto) */
export interface PropiedadNotion {
  nombre: string
  tipo: string
}

export interface EsquemaNotion {
  titulo?: PropiedadNotion
  estado?: PropiedadNotion
  departamento?: PropiedadNotion
  responsable?: PropiedadNotion
  fecha?: PropiedadNotion
  progreso?: PropiedadNotion
  url?: PropiedadNotion
}

export interface ClienteTC {
  id: string
  nombre: string
  icono: string | null
  color: ColorNotion | string
  grupo: GrupoDeCliente
  orden: number
  descripcion: string | null
  portada: Portada
  fondo: Portada
  opciones: Partial<OpcionesDelCliente>
  notion_esquema: EsquemaNotion
  notion_db_id: string | null
  notion_ds_id: string | null
  notion_url: string | null
  vinculos: Record<string, string>
  visible_cliente: boolean
  activo: boolean
  sync_ultima: string | null
  sync_error: string | null
}

export interface ResponsableNotion {
  id: string
  nombre: string
}

export type EstadoDeSincronizacion = 'ok' | 'pendiente' | 'error' | 'solo_erp'

export interface TareaTC {
  id: string
  cliente_id: string
  titulo: string
  icono: string | null
  color: string | null
  portada: Portada
  estado: string
  departamento: string | null
  etiquetas: string[]
  fecha_inicio: string | null
  fecha_fin: string | null
  fecha_con_hora: boolean
  progreso: number
  url: string | null
  responsables: string[]
  responsables_notion: ResponsableNotion[]
  orden: number
  contenido: unknown[]
  contenido_texto: string
  checklist_total: number
  checklist_hecho: number
  comentarios: number
  visible_cliente: boolean
  archivada: boolean
  origen: 'erp' | 'notion'
  notion_page_id: string | null
  notion_url: string | null
  notion_editado: string | null
  notion_contenido_revisado: string | null
  notion_comentarios_revisados: string | null
  sync_estado: EstadoDeSincronizacion
  sync_error: string | null
  creado_por: string | null
  actualizado_por: string | null
  creado_en: string
  actualizado_en: string
}

export interface ComentarioTC {
  id: string
  tarea_id: string
  autor_id: string | null
  autor_nombre: string
  cuerpo: string
  menciones: string[]
  origen: 'erp' | 'notion'
  visible_cliente: boolean
  notion_comment_id: string | null
  editado_en: string | null
  borrado: boolean
  creado_en: string
}

export interface ActividadTC {
  id: number
  tarea_id: string | null
  cliente_id: string | null
  actor_id: string | null
  actor_nombre: string
  tipo: TipoDeActividad
  datos: Record<string, unknown>
  creado_en: string
}

export type TipoDeActividad = 'creada' | 'movida' | 'editada' | 'asignada' | 'comentario' | 'archivada' | 'restaurada' | 'notion'

/** Una persona del equipo, tal como la necesitan las tarjetas y los selectores */
export interface PersonaTC {
  id: string
  nombre: string
  email: string | null
  /** Los clientes que ve (acceso por cliente, migración 277); `null` o sin decir = todos */
  clientes?: string[] | null
}

export interface EtiquetaDeVista {
  id: string
  nombre: string
}

export type TipoDeVista = 'tablero' | 'tabla' | 'cronograma' | 'calendario'

export const VISTAS: ReadonlyArray<{ id: TipoDeVista; nombre: string }> = [
  { id: 'tablero', nombre: 'Tablero' },
  { id: 'tabla', nombre: 'Tabla' },
  { id: 'cronograma', nombre: 'Cronograma' },
  { id: 'calendario', nombre: 'Calendario' },
]

/** Los filtros y el orden que se aplican a las tareas que se ven */
export interface FiltrosDeTareas {
  busqueda: string
  responsables: string[]
  departamentos: string[]
  /** Las tareas que ya están hechas se esconden con esto; por defecto se ven */
  ocultarHechas: boolean
  soloMias: boolean
  agruparPor: 'estado' | 'departamento' | 'responsable' | 'cliente'
}

export const FILTROS_VACIOS: FiltrosDeTareas = {
  busqueda: '',
  responsables: [],
  departamentos: [],
  ocultarHechas: false,
  soloMias: false,
  agruparPor: 'estado',
}

/** Los estados de una tarea nueva cuando la base de Notion todavía no ha dicho cuáles tiene */
export const ESTADOS_POR_DEFECTO: OpcionDeEstado[] = [
  { nombre: 'Backlog', color: 'yellow', grupo: 'pendiente' },
  { nombre: 'Recurrentes', color: 'purple', grupo: 'en_curso' },
  { nombre: 'En progreso', color: 'blue', grupo: 'en_curso' },
  { nombre: 'En revisión', color: 'orange', grupo: 'en_curso' },
  { nombre: 'Completadas', color: 'green', grupo: 'hecho' },
  { nombre: 'Hitos', color: 'brown', grupo: 'hecho' },
  { nombre: 'Cierres Sprint', color: 'gray', grupo: 'hecho' },
]

export const DEPARTAMENTOS_POR_DEFECTO: OpcionSimple[] = [
  { nombre: 'MARKETING', color: 'green' },
  { nombre: 'INFORMES', color: 'red' },
  { nombre: 'PRODUCTO', color: 'orange' },
  { nombre: 'GROWTH', color: 'blue' },
  { nombre: 'STOCK', color: 'pink' },
  { nombre: 'PRICING', color: 'brown' },
  { nombre: 'OPERATIVA', color: 'brown' },
  { nombre: 'ANALITICA', color: 'purple' },
]

export function estadosDe(cliente: Pick<ClienteTC, 'opciones'> | null | undefined): OpcionDeEstado[] {
  const propios = cliente?.opciones?.estados
  const base = propios && propios.length > 0 ? propios : ESTADOS_POR_DEFECTO
  const orden = cliente?.opciones?.orden_columnas
  if (!orden || orden.length === 0) return base
  return ordenarSegun(base, orden)
}

/** Las opciones en el orden de `orden` (por nombre); las que no estén en ella, al final y como venían */
export function ordenarSegun<T extends { nombre: string }>(lista: readonly T[], orden: readonly string[]): T[] {
  const sitio = new Map(orden.map((n, i) => [n, i]))
  return lista
    .map((o, i) => ({ o, k: sitio.has(o.nombre) ? (sitio.get(o.nombre) as number) : orden.length + i }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.o)
}

export function departamentosDe(cliente: Pick<ClienteTC, 'opciones'> | null | undefined): OpcionSimple[] {
  const propios = cliente?.opciones?.departamentos
  return propios && propios.length > 0 ? propios : DEPARTAMENTOS_POR_DEFECTO
}

/** ¿Está la tarea acabada? Lo dice el grupo de su estado, que es lo que Notion llama «Complete» */
export function estaHecha(tarea: Pick<TareaTC, 'estado'>, estados: readonly OpcionDeEstado[]): boolean {
  return estados.find((e) => e.nombre === tarea.estado)?.grupo === 'hecho'
}

/** Una plantilla de tarea: el molde de una tarea que se usa a mano o se repite sola (lib/tareas-clientes/recurrencia.ts) */
export interface PlantillaTC {
  id: string
  cliente_id: string | null
  nombre: string
  icono: string | null
  titulo: string
  estado: string | null
  departamento: string | null
  responsables: string[]
  dias_para_vencer: number | null
  contenido: unknown[]
  recurrencia: { tipo: string; diaSemana?: number; diaMes?: number }
  activa: boolean
  proxima_en: string | null
  ultima_en: string | null
  creado_por: string | null
  creado_en: string
  actualizado_en: string
}
