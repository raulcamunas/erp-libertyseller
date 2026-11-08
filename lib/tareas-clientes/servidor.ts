import { createServiceClient } from '@/lib/supabase/service'
import { destinatariosDeAsignacion, destinatariosDeComentario, mencionesEnTexto, resumen } from './avisos'
import { contarChecklist, huellaDeContenido, progresoDeChecklist, textoPlano, TIPOS_EDITABLES, type Bloque } from './bloques'
import { fondoAnimadoId } from './colores'
import { personaPuedeVer, puedeVer, type Permitidos } from './permisos'
import { avisosDeFecha } from './vencimientos'
import { programarEnvioANotion } from './notion/pronto'
import { colocar, ordenAlFinal } from './orden'
import { departamentosDe, estadosDe, estaHecha, type ActividadTC, type ClienteTC, type ComentarioTC, type PersonaTC, type TareaTC, type TipoDeActividad } from './tipos'

/**
 * TAREAS DE CLIENTES: LEER Y ESCRIBIR.
 * SOLO SERVIDOR (clave de servicio).
 *
 * Todo cambio de una tarea pasa por aquí, y aquí se hacen las cuatro cosas que no se pueden olvidar: guardarlo, apuntarlo en el historial, avisar a la campana y dejarlo en
 * la cola para Notion. Las tablas `tc_*` no se escriben desde el navegador (migración 275), así que no hay otro camino.
 *
 * Las fechas de solo día se guardan y se enseñan como TEXTO `AAAA-MM-DD`, sin pasar por ningún huso horario: una tarea del 5 de noviembre es del 5 en España y en Colombia.
 */

export interface Actor {
  /** Los clientes que puede ver (acceso por cliente); `null` o sin decir = todos. Lo rellena `actorDe(p)`; el sistema (una plantilla que se repite) no lleva */
  clientes?: Permitidos
  /** Vacío = la hace el sistema (una plantilla que se repite): no hay persona a la que apuntarle la tarea ni el historial, y nadie se queda sin su aviso de asignación */
  userId: string
  nombre: string
}

const COLUMNAS_LIGERAS =
  'id, cliente_id, titulo, icono, color, portada, estado, departamento, etiquetas, fecha_inicio, fecha_fin, fecha_con_hora, progreso, url, responsables, responsables_notion, orden, checklist_total, checklist_hecho, comentarios, visible_cliente, archivada, origen, notion_page_id, notion_url, notion_editado, sync_estado, sync_error, creado_por, actualizado_por, creado_en, actualizado_en'

/** Una tarea sin su cuerpo: lo que hace falta para pintar tableros y tablas sin arrastrar el texto de todas */
export type TareaLigera = Omit<TareaTC, 'contenido' | 'contenido_texto'>

export class ErrorDeTareas extends Error {
  constructor(
    mensaje: string,
    public estado = 400
  ) {
    super(mensaje)
    this.name = 'ErrorDeTareas'
  }
}

/** Falla con un 403 si la persona no puede ver ese cliente */
export function exigirAcceso(permitidos: Permitidos, clienteId: string | null | undefined): void {
  if (!puedeVer(permitidos, clienteId)) throw new ErrorDeTareas('No tienes acceso a ese cliente.', 403)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const esUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)

/* ------------------------------------------------------------------ */
/* Lectura                                                             */
/* ------------------------------------------------------------------ */

/** Quién puede estar en una tarea: los administradores y quien tiene la casilla. Un `partner` solo si la tiene */
export async function personasConAcceso(clienteId?: string): Promise<PersonaTC[]> {
  const service = createServiceClient()
  const [admins, permisos, filas] = await Promise.all([
    service.from('profiles').select('id, full_name, email').eq('role', 'admin'),
    service.from('user_app_permissions').select('user_id').eq('app_id', 'tareas-clientes').eq('can_access', true),
    // Si la tabla de accesos por cliente todavía no existe, falla sin más y todos ven todo
    service.from('tc_acceso_clientes').select('usuario_id, cliente_id'),
  ])
  const limitadas = new Map<string, string[]>()
  for (const f of (filas.data ?? []) as Array<{ usuario_id: string; cliente_id: string }>) limitadas.set(f.usuario_id, [...(limitadas.get(f.usuario_id) ?? []), f.cliente_id])
  const esAdmin = new Set(((admins.data ?? []) as Array<{ id: string }>).map((a) => a.id))
  const ids = (permisos.data ?? []).map((p: { user_id: string }) => p.user_id)
  const conCasilla = ids.length > 0 ? await service.from('profiles').select('id, full_name, email').in('id', ids) : { data: [] }
  const porId = new Map<string, PersonaTC>()
  for (const p of [...(admins.data ?? []), ...(conCasilla.data ?? [])] as Array<{ id: string; full_name: string | null; email: string | null }>) {
    porId.set(p.id, { id: p.id, nombre: (p.full_name ?? '').trim() || p.email || 'Sin nombre', email: p.email, clientes: esAdmin.has(p.id) ? null : (limitadas.get(p.id) ?? null) })
  }
  const todas = [...porId.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  // Con un cliente: solo quien puede verlo (para asignar tareas, mencionar y avisar)
  return clienteId ? todas.filter((p) => personaPuedeVer(p, clienteId)) : todas
}

export interface EstadisticasDeCliente {
  total: number
  pendientes: number
  enCurso: number
  hechas: number
  vencidas: number
  responsables: string[]
}

const hoyISO = () => new Date().toISOString().slice(0, 10)

/** El día de una fecha guardada, como texto: la parte de la fecha sin convertir nada */
export const diaDe = (iso: string | null | undefined): string | null => (iso ? iso.slice(0, 10) : null)

export function estadisticasDe(cliente: Pick<ClienteTC, 'opciones'>, tareas: ReadonlyArray<Pick<TareaTC, 'estado' | 'fecha_inicio' | 'fecha_fin' | 'responsables' | 'archivada'>>): EstadisticasDeCliente {
  const estados = estadosDe(cliente)
  const hoy = hoyISO()
  const e: EstadisticasDeCliente = { total: 0, pendientes: 0, enCurso: 0, hechas: 0, vencidas: 0, responsables: [] }
  const gente = new Map<string, number>()
  for (const t of tareas) {
    if (t.archivada) continue
    e.total += 1
    const grupo = estados.find((x) => x.nombre === t.estado)?.grupo ?? 'en_curso'
    if (grupo === 'hecho') e.hechas += 1
    else {
      if (grupo === 'pendiente') e.pendientes += 1
      else e.enCurso += 1
      const limite = diaDe(t.fecha_fin ?? t.fecha_inicio)
      if (limite && limite < hoy) e.vencidas += 1
      for (const r of t.responsables) gente.set(r, (gente.get(r) ?? 0) + 1)
    }
  }
  e.responsables = [...gente.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id]) => id)
  return e
}

export async function cargarInicio(userId: string, permitidos?: Permitidos) {
  const service = createServiceClient()
  const ids = permitidos ? [...permitidos] : null
  const [clientes, tareas, preferencias, personas] = await Promise.all([
    (ids ? service.from('tc_clientes').select('*').in('id', ids) : service.from('tc_clientes').select('*')).eq('activo', true).order('grupo').order('orden').order('nombre'),
    (ids ? service.from('tc_tareas').select('cliente_id, estado, fecha_inicio, fecha_fin, responsables, archivada').in('cliente_id', ids) : service.from('tc_tareas').select('cliente_id, estado, fecha_inicio, fecha_fin, responsables, archivada')).eq('archivada', false).limit(20000),
    service.from('tc_preferencias').select('*').eq('usuario_id', userId).maybeSingle(),
    personasConAcceso(),
  ])
  if (clientes.error) throw new ErrorDeTareas(`No se han podido leer los clientes: ${clientes.error.message}`, 500)
  const lista = (clientes.data ?? []) as ClienteTC[]
  const porCliente = new Map<string, Array<Pick<TareaTC, 'estado' | 'fecha_inicio' | 'fecha_fin' | 'responsables' | 'archivada'>>>()
  for (const t of (tareas.data ?? []) as Array<{ cliente_id: string } & Pick<TareaTC, 'estado' | 'fecha_inicio' | 'fecha_fin' | 'responsables' | 'archivada'>>) {
    const l = porCliente.get(t.cliente_id) ?? []
    l.push(t)
    porCliente.set(t.cliente_id, l)
  }
  const estadisticas: Record<string, EstadisticasDeCliente> = {}
  for (const c of lista) estadisticas[c.id] = estadisticasDe(c, porCliente.get(c.id) ?? [])
  // Lo mío: las tareas sin terminar que lleva esta persona, y cuántas de ellas ya han vencido
  const hoy = hoyISO()
  const mias = { abiertas: 0, vencidas: 0 }
  for (const c of lista) {
    const hechas = new Set(estadosDe(c).filter((e) => e.grupo === 'hecho').map((e) => e.nombre))
    for (const t of porCliente.get(c.id) ?? []) {
      if (!t.responsables.includes(userId) || hechas.has(t.estado)) continue
      mias.abiertas += 1
      const limite = diaDe(t.fecha_fin ?? t.fecha_inicio)
      if (limite && limite < hoy) mias.vencidas += 1
    }
  }
  return { clientes: lista, estadisticas, preferencias: preferencias.data ?? null, personas, mias }
}

export async function cargarCliente(clienteId: string, userId: string, permitidos?: Permitidos) {
  exigirAcceso(permitidos, clienteId)
  const service = createServiceClient()
  const [cliente, tareas, otros, preferencias, personas] = await Promise.all([
    service.from('tc_clientes').select('*').eq('id', clienteId).maybeSingle(),
    service.from('tc_tareas').select(COLUMNAS_LIGERAS).eq('cliente_id', clienteId).eq('archivada', false).order('orden').limit(5000),
    service.from('tc_clientes').select('id, nombre, icono, color, grupo, orden').eq('activo', true).order('grupo').order('orden').order('nombre'),
    service.from('tc_preferencias').select('*').eq('usuario_id', userId).maybeSingle(),
    personasConAcceso(),
  ])
  if (!cliente.data) throw new ErrorDeTareas('Ese cliente no existe.', 404)
  const clientes = ((otros.data ?? []) as Array<Pick<ClienteTC, 'id' | 'nombre' | 'icono' | 'color' | 'grupo' | 'orden'>>).filter((c) => puedeVer(permitidos, c.id))
  return { cliente: cliente.data as ClienteTC, tareas: (tareas.data ?? []) as TareaLigera[], clientes, preferencias: preferencias.data ?? null, personas }
}

/** Las tareas de TODOS los clientes, para la vista «Todas» y «Mis tareas» */
export async function cargarTodas(userId: string, permitidos?: Permitidos) {
  const service = createServiceClient()
  const ids = permitidos ? [...permitidos] : null
  const [clientes, tareas, preferencias, personas] = await Promise.all([
    (ids ? service.from('tc_clientes').select('*').in('id', ids) : service.from('tc_clientes').select('*')).eq('activo', true).order('grupo').order('orden').order('nombre'),
    (ids ? service.from('tc_tareas').select(COLUMNAS_LIGERAS).in('cliente_id', ids) : service.from('tc_tareas').select(COLUMNAS_LIGERAS)).eq('archivada', false).order('orden').limit(20000),
    service.from('tc_preferencias').select('*').eq('usuario_id', userId).maybeSingle(),
    personasConAcceso(),
  ])
  return { clientes: (clientes.data ?? []) as ClienteTC[], tareas: (tareas.data ?? []) as TareaLigera[], preferencias: preferencias.data ?? null, personas }
}

export async function cargarTarea(id: string, permitidos?: Permitidos) {
  const service = createServiceClient()
  const [tarea, comentarios, actividad] = await Promise.all([
    service.from('tc_tareas').select('*').eq('id', id).maybeSingle(),
    service.from('tc_comentarios').select('*').eq('tarea_id', id).eq('borrado', false).order('creado_en'),
    service.from('tc_actividad').select('*').eq('tarea_id', id).order('creado_en', { ascending: false }).limit(60),
  ])
  if (!tarea.data) throw new ErrorDeTareas('Esa tarea no existe.', 404)
  exigirAcceso(permitidos, (tarea.data as { cliente_id: string }).cliente_id)
  return { tarea: tarea.data as TareaTC, comentarios: (comentarios.data ?? []) as ComentarioTC[], actividad: (actividad.data ?? []) as ActividadTC[] }
}

/* ------------------------------------------------------------------ */
/* Historial, avisos y cola de Notion                                  */
/* ------------------------------------------------------------------ */

async function registrar(actor: Actor | null, fila: { tareaId: string | null; clienteId: string | null; tipo: TipoDeActividad; datos?: Record<string, unknown> }) {
  try {
    await createServiceClient()
      .from('tc_actividad')
      .insert({ tarea_id: fila.tareaId, cliente_id: fila.clienteId, actor_id: actor?.userId || null, actor_nombre: actor?.nombre ?? 'Notion', tipo: fila.tipo, datos: fila.datos ?? {} })
  } catch (e) {
    console.error('No se ha podido apuntar el historial de la tarea:', e)
  }
}

export interface AvisoParaCampana {
  userId: string
  /** `task_updated` lo usan los recordatorios de fecha: la tabla de avisos solo admite una lista cerrada de tipos (migración 251) y este ya estaba */
  tipo: 'comment' | 'mention' | 'task_assigned' | 'task_updated'
  titulo: string
  mensaje: string
  clave: string
  clienteId: string
  tareaId: string | null
  /** Para los recordatorios de fecha: `vence` o `vencidas` (la campana les pone su icono) */
  motivo?: 'vence' | 'vencidas'
}

/** Escribe los avisos en la campana. NUNCA lanza: un aviso que falla no puede tumbar lo que avisaba */
async function avisar(avisos: AvisoParaCampana[]) {
  if (avisos.length === 0) return
  try {
    const { error } = await createServiceClient()
      .from('notifications')
      .upsert(
        avisos.map((a) => ({ user_id: a.userId, type: a.tipo, title: a.titulo, message: a.mensaje, clave: a.clave, datos: { app: 'tareas-clientes', clienteId: a.clienteId, tareaId: a.tareaId, ...(a.motivo ? { motivo: a.motivo } : {}) }, read: false })),
        { onConflict: 'user_id,clave', ignoreDuplicates: true }
      )
    if (error) console.error('No se han podido escribir los avisos de tareas en la campana:', error.message)
  } catch (e) {
    console.error('No se han podido escribir los avisos de tareas en la campana:', e)
  }
}

/**
 * LOS RECORDATORIOS DE FECHA DE UNA PERSONA: «vence hoy», «vence mañana» y un resumen de las vencidas (lib/tareas-clientes/vencimientos.ts). Los pide la campana de esa persona
 * al abrir el ERP y cada media hora; la clave de cada aviso es única por persona, así que pedirlos varias veces el mismo día no duplica nada ni vuelve a hacer sonar.
 */
export async function generarAvisosDeFecha(userId: string, permitidos?: Permitidos): Promise<number> {
  const service = createServiceClient()
  const [clientes, tareas] = await Promise.all([
    service.from('tc_clientes').select('id, opciones').eq('activo', true),
    service.from('tc_tareas').select('id, cliente_id, titulo, estado, fecha_inicio, fecha_fin').eq('archivada', false).contains('responsables', [userId]).limit(5000),
  ])
  const hechas = new Map((clientes.data ?? []).map((c: { id: string; opciones: ClienteTC['opciones'] }) => [c.id, new Set(estadosDe({ opciones: c.opciones }).filter((e) => e.grupo === 'hecho').map((e) => e.nombre))]))
  const abiertas = ((tareas.data ?? []) as Array<{ id: string; cliente_id: string; titulo: string; estado: string; fecha_inicio: string | null; fecha_fin: string | null }>).filter((t) => !hechas.get(t.cliente_id)?.has(t.estado) && puedeVer(permitidos, t.cliente_id))
  // El «hoy» es el de España: a las 23:30 de allí no puede ser ya mañana
  const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' })
  const avisos = avisosDeFecha(abiertas, hoy)
  await avisar(avisos.map((a) => ({ userId, tipo: 'task_updated' as const, titulo: a.titulo, mensaje: a.mensaje, clave: a.clave, clienteId: a.clienteId, tareaId: a.tareaId, motivo: a.tipo === 'tarea_vencidas' ? ('vencidas' as const) : ('vence' as const) })))
  return avisos.length
}

export type OperacionDeCola = 'crear' | 'propiedades' | 'contenido' | 'archivar' | 'comentar'

/**
 * Deja un cambio en la cola para Notion. Si el cliente no está conectado con una base de Notion no hace nada y la tarea queda como `solo_erp`.
 * Devuelve el estado de sincronización en el que queda la tarea.
 */
export async function encolar(clienteId: string, tareaId: string, operacion: OperacionDeCola, payload: Record<string, unknown> = {}): Promise<'pendiente' | 'solo_erp'> {
  const service = createServiceClient()
  const { data: cliente } = await service.from('tc_clientes').select('notion_ds_id').eq('id', clienteId).maybeSingle()
  if (!cliente?.notion_ds_id) return 'solo_erp'
  const { error } = await service.from('tc_notion_cola').insert({ tarea_id: tareaId, cliente_id: clienteId, operacion, payload })
  if (error) console.error('No se ha podido dejar el cambio en la cola de Notion:', error.message)
  else programarEnvioANotion()
  return 'pendiente'
}

/* ------------------------------------------------------------------ */
/* Tareas: crear, cambiar, mover                                       */
/* ------------------------------------------------------------------ */

const tope = (v: unknown, largo: number): string | null => (typeof v === 'string' ? v.trim().slice(0, largo) : null)

/** Una fecha que llega del navegador: `AAAA-MM-DD` o una fecha con hora; cualquier otra cosa no se acepta */
function fechaValida(v: unknown): string | null | undefined {
  if (v === null || v === '') return null
  if (typeof v !== 'string') return undefined
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? undefined : v
  return Number.isNaN(Date.parse(v)) ? undefined : new Date(v).toISOString()
}

const TIPOS_DE_BLOQUE: ReadonlySet<string> = new Set([...TIPOS_EDITABLES, 'imagen', 'notion'])

export function bloquesValidos(v: unknown): Bloque[] | null {
  if (!Array.isArray(v) || v.length > 3000) return null
  for (const b of v as Array<Partial<Bloque>>) {
    if (!b || typeof b.id !== 'string' || !TIPOS_DE_BLOQUE.has(b.tipo as string) || !Array.isArray(b.texto)) return null
    for (const s of b.texto) if (typeof s?.t !== 'string') return null
    if (b.tipo === 'tabla') {
      // Una tabla: hasta 200 filas de 30 celdas, cada celda una lista de trozos de texto
      const filas = b.filas
      if (!Array.isArray(filas) || filas.length > 200 || filas.some((f) => !Array.isArray(f) || f.length > 30 || f.some((c) => !Array.isArray(c) || c.length > 200 || c.some((s) => typeof s?.t !== 'string' || s.t.length > 2000)))) return null
    }
    if (b.tipo === 'imagen' && b.url !== undefined && (typeof b.url !== 'string' || !/^https:\/\/[^\s"'()]+$/.test(b.url) || b.url.length > 2000)) return null
  }
  return v as Bloque[]
}

export interface CambiosDeTarea {
  titulo?: unknown
  icono?: unknown
  color?: unknown
  portada?: unknown
  estado?: unknown
  departamento?: unknown
  etiquetas?: unknown
  fecha_inicio?: unknown
  fecha_fin?: unknown
  progreso?: unknown
  url?: unknown
  responsables?: unknown
  visible_cliente?: unknown
  archivada?: unknown
  contenido?: unknown
}

const CAMPOS_QUE_VAN_A_NOTION = ['titulo', 'icono', 'estado', 'departamento', 'fecha_inicio', 'fecha_fin', 'progreso', 'url', 'responsables'] as const

/** Un cambio del navegador, comprobado y limpio. Lo que no se reconoce se ignora; lo que está mal, falla con el motivo */
function limpiarCambios(cambios: CambiosDeTarea, personas: ReadonlySet<string>): Record<string, unknown> {
  const l: Record<string, unknown> = {}
  if ('titulo' in cambios) l.titulo = tope(cambios.titulo, 500) ?? ''
  if ('icono' in cambios) l.icono = cambios.icono ? tope(cambios.icono, 16) : null
  if ('color' in cambios) l.color = cambios.color ? tope(cambios.color, 24) : null
  if ('portada' in cambios) l.portada = cambios.portada && typeof cambios.portada === 'object' ? cambios.portada : {}
  if ('estado' in cambios) {
    const e = tope(cambios.estado, 80)
    if (!e) throw new ErrorDeTareas('La tarea necesita un estado.')
    l.estado = e
  }
  if ('departamento' in cambios) l.departamento = cambios.departamento ? tope(cambios.departamento, 80) : null
  if ('etiquetas' in cambios) l.etiquetas = Array.isArray(cambios.etiquetas) ? cambios.etiquetas.filter((x): x is string => typeof x === 'string').map((x) => x.trim().slice(0, 40)).filter(Boolean).slice(0, 20) : []
  for (const campo of ['fecha_inicio', 'fecha_fin'] as const) {
    if (campo in cambios) {
      const f = fechaValida(cambios[campo])
      if (f === undefined) throw new ErrorDeTareas('Esa fecha no es válida.')
      l[campo] = f
    }
  }
  if ('fecha_inicio' in l || 'fecha_fin' in l) {
    const f = (l.fecha_inicio ?? l.fecha_fin) as string | null | undefined
    // Si la fecha lleva hora se guarda con hora; una de solo día, como día
    l.fecha_con_hora = Boolean(f && f.length > 10)
  }
  if ('progreso' in cambios) {
    const n = Number(cambios.progreso)
    if (!Number.isFinite(n)) throw new ErrorDeTareas('El progreso tiene que ser un número.')
    l.progreso = Math.max(0, Math.min(100, Math.round(n)))
  }
  if ('url' in cambios) {
    const u = tope(cambios.url, 2000)
    if (u && !/^https?:\/\//i.test(u)) throw new ErrorDeTareas('El enlace tiene que empezar por http:// o https://.')
    l.url = u || null
  }
  if ('responsables' in cambios) {
    if (!Array.isArray(cambios.responsables)) throw new ErrorDeTareas('Los responsables no son una lista.')
    const ids = [...new Set(cambios.responsables.filter(esUuid))]
    const ajenos = ids.filter((id) => !personas.has(id))
    if (ajenos.length > 0) throw new ErrorDeTareas('Solo se puede asignar a personas con acceso a Tareas de clientes.')
    l.responsables = ids
  }
  if ('visible_cliente' in cambios) l.visible_cliente = cambios.visible_cliente === true
  if ('archivada' in cambios) l.archivada = cambios.archivada === true
  if ('contenido' in cambios) {
    const b = bloquesValidos(cambios.contenido)
    if (!b) throw new ErrorDeTareas('El cuerpo de la tarea no es válido.')
    const c = contarChecklist(b)
    l.contenido = b
    l.contenido_texto = textoPlano(b).slice(0, 200_000)
    l.checklist_total = c.total
    l.checklist_hecho = c.hecho
    // EL PROGRESO SALE SOLO DE LA CHECKLIST (casillas hechas ÷ casillas, en %): es lo que hacía a mano una automatización de n8n sobre Notion. Con casillas manda la cuenta;
    // una tarea sin ninguna conserva el progreso que se le haya puesto a mano. Si la misma petición trae un progreso explícito, se respeta ese.
    const p = progresoDeChecklist(c)
    if (p !== null && !('progreso' in cambios)) l.progreso = p
  }
  return l
}

export interface EntradaDeTarea extends CambiosDeTarea {
  clienteId: string
}

export async function crearTarea(actor: Actor, entrada: EntradaDeTarea): Promise<TareaLigera> {
  const service = createServiceClient()
  exigirAcceso(actor.clientes, entrada.clienteId)
  const { data: cliente } = await service.from('tc_clientes').select('*').eq('id', entrada.clienteId).maybeSingle()
  if (!cliente) throw new ErrorDeTareas('Ese cliente no existe.', 404)
  const personas = new Set((await personasConAcceso(entrada.clienteId)).map((p) => p.id))
  const limpio = limpiarCambios(entrada, personas)
  const estado = (limpio.estado as string | undefined) ?? estadosDe(cliente as ClienteTC)[0]?.nombre ?? 'Backlog'
  if (limpio.estado) await exigirEstadoDelCliente(entrada.clienteId, estado)

  const { data: hermanas } = await service.from('tc_tareas').select('orden').eq('cliente_id', entrada.clienteId).eq('estado', estado).eq('archivada', false)
  const orden = ordenAlFinal((hermanas ?? []).map((h: { orden: number }) => Number(h.orden)))
  const conNotion = Boolean((cliente as ClienteTC).notion_ds_id)

  const { data, error } = await service
    .from('tc_tareas')
    .insert({ titulo: '', ...limpio, estado, cliente_id: entrada.clienteId, orden, origen: 'erp', creado_por: actor.userId || null, actualizado_por: actor.userId || null, sync_estado: conNotion ? 'pendiente' : 'solo_erp' })
    .select(COLUMNAS_LIGERAS)
    .single()
  if (error || !data) throw new ErrorDeTareas(`No se ha podido crear la tarea: ${error?.message ?? 'sin respuesta'}`, 500)
  const tarea = data as TareaLigera

  await registrar(actor, { tareaId: tarea.id, clienteId: tarea.cliente_id, tipo: 'creada', datos: { titulo: tarea.titulo, estado } })
  await encolar(tarea.cliente_id, tarea.id, 'crear')
  const nuevos = destinatariosDeAsignacion([], tarea.responsables, actor.userId)
  await avisar(nuevos.map((userId) => ({ userId, tipo: 'task_assigned' as const, titulo: `${actor.nombre} te ha asignado una tarea`, mensaje: resumen(`${(cliente as ClienteTC).nombre}: ${tarea.titulo || 'Sin título'}`), clave: `tc:asig:${tarea.id}:${userId}`, clienteId: tarea.cliente_id, tareaId: tarea.id })))
  return tarea
}

/** Cambia lo que se pida de una tarea, y deja constancia y cola de Notion de lo que haya cambiado de verdad */
export async function actualizarTarea(actor: Actor, id: string, cambios: CambiosDeTarea): Promise<TareaLigera> {
  const service = createServiceClient()
  const { data: antes } = await service.from('tc_tareas').select(`${COLUMNAS_LIGERAS}, contenido`).eq('id', id).maybeSingle()
  if (!antes) throw new ErrorDeTareas('Esa tarea no existe.', 404)
  const previa = antes as unknown as TareaTC
  exigirAcceso(actor.clientes, previa.cliente_id)
  const personas = new Set((await personasConAcceso(previa.cliente_id)).map((p) => p.id))
  const limpio = limpiarCambios(cambios, personas)

  // Solo cuenta lo que ha cambiado de verdad: guardar dos veces lo mismo no ensucia el historial ni la cola
  const reales: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(limpio)) {
    const anterior = (previa as unknown as Record<string, unknown>)[k]
    const igual = k === 'contenido' ? huellaDeContenido(v as Bloque[]) === huellaDeContenido((anterior as Bloque[]) ?? []) : JSON.stringify(v) === JSON.stringify(anterior)
    if (!igual) reales[k] = v
  }
  if (Object.keys(reales).length === 0) {
    const { contenido: _c, ...ligera } = previa as TareaTC & { contenido: unknown }
    void _c
    return ligera as TareaLigera
  }

  if (typeof reales.estado === 'string') await exigirEstadoDelCliente(previa.cliente_id, reales.estado)
  const conNotion = Boolean(previa.notion_page_id) || (await tieneBaseDeNotion(previa.cliente_id))
  const { data, error } = await service
    .from('tc_tareas')
    .update({ ...reales, actualizado_por: actor.userId, ...(conNotion ? { sync_estado: 'pendiente', sync_error: null } : {}) })
    .eq('id', id)
    .select(COLUMNAS_LIGERAS)
    .single()
  if (error || !data) throw new ErrorDeTareas(`No se ha podido guardar la tarea: ${error?.message ?? 'sin respuesta'}`, 500)
  const tarea = data as TareaLigera

  // Historial
  if ('estado' in reales) await registrar(actor, { tareaId: id, clienteId: tarea.cliente_id, tipo: 'movida', datos: { de: previa.estado, a: tarea.estado } })
  if ('responsables' in reales) {
    const anadidos = tarea.responsables.filter((r) => !previa.responsables.includes(r))
    const quitados = previa.responsables.filter((r) => !tarea.responsables.includes(r))
    await registrar(actor, { tareaId: id, clienteId: tarea.cliente_id, tipo: 'asignada', datos: { anadidos, quitados } })
    const nuevos = destinatariosDeAsignacion(previa.responsables, tarea.responsables, actor.userId)
    const { data: cli } = await service.from('tc_clientes').select('nombre').eq('id', tarea.cliente_id).maybeSingle()
    await avisar(nuevos.map((userId) => ({ userId, tipo: 'task_assigned' as const, titulo: `${actor.nombre} te ha asignado una tarea`, mensaje: resumen(`${cli?.nombre ?? 'Cliente'}: ${tarea.titulo || 'Sin título'}`), clave: `tc:asig:${id}:${userId}`, clienteId: tarea.cliente_id, tareaId: id })))
  }
  if ('archivada' in reales) await registrar(actor, { tareaId: id, clienteId: tarea.cliente_id, tipo: tarea.archivada ? 'archivada' : 'restaurada' })
  const otros = Object.keys(reales).filter((k) => !['estado', 'responsables', 'archivada'].includes(k))
  if (otros.length > 0) await registrarEdicion(actor, id, tarea.cliente_id, otros)

  // Notion
  const paraNotion = (CAMPOS_QUE_VAN_A_NOTION as readonly string[]).filter((k) => k in reales)
  if (conNotion) {
    if ('archivada' in reales) await encolar(tarea.cliente_id, id, 'archivar', { archivada: tarea.archivada })
    if (paraNotion.length > 0) await encolar(tarea.cliente_id, id, previa.notion_page_id ? 'propiedades' : 'crear', { campos: paraNotion })
    if ('contenido' in reales) await encolar(tarea.cliente_id, id, previa.notion_page_id ? 'contenido' : 'crear')
  }
  return tarea
}

/**
 * Una columna que la base de Notion de ese cliente no tiene no se puede escribir allí: Notion rechaza un estado que no existe en su lista. Se comprueba aquí para dar un
 * motivo claro en vez de dejar la tarea «pendiente» para siempre. Un cliente sin estados guardados (todavía sin leer su base) acepta cualquiera.
 */
async function exigirEstadoDelCliente(clienteId: string, estado: string): Promise<void> {
  const { data } = await createServiceClient().from('tc_clientes').select('nombre, notion_ds_id, opciones').eq('id', clienteId).maybeSingle()
  const propios = (data?.opciones as { estados?: Array<{ nombre: string }> } | undefined)?.estados ?? []
  if (data?.notion_ds_id && propios.length > 0 && !propios.some((e) => e.nombre === estado)) {
    throw new ErrorDeTareas(`${data.nombre} no tiene la columna «${estado}» en Notion. Las que tiene: ${propios.map((e) => e.nombre).join(', ')}.`, 422)
  }
}

async function tieneBaseDeNotion(clienteId: string): Promise<boolean> {
  const { data } = await createServiceClient().from('tc_clientes').select('notion_ds_id').eq('id', clienteId).maybeSingle()
  return Boolean(data?.notion_ds_id)
}

/** Las ediciones seguidas de la misma persona en la misma tarea (escribir un cuerpo genera decenas) se apuntan como UNA cada diez minutos */
async function registrarEdicion(actor: Actor, tareaId: string, clienteId: string, campos: string[]) {
  const service = createServiceClient()
  const desde = new Date(Date.now() - 10 * 60_000).toISOString()
  const { data } = await service.from('tc_actividad').select('id').eq('tarea_id', tareaId).eq('actor_id', actor.userId).eq('tipo', 'editada').gte('creado_en', desde).limit(1)
  if ((data ?? []).length > 0) return
  await registrar(actor, { tareaId, clienteId, tipo: 'editada', datos: { campos } })
}

export interface DestinoDeMovimiento {
  estado: string
  /** La tarea que queda justo ANTES de la movida en su columna nueva; null = la primera */
  despuesDe: string | null
  /** Al final de la columna (lo que hace «Mover a…» con varias tareas): manda sobre `despuesDe` */
  alFinal?: boolean
}

/** Arrastrar una tarjeta: cambia de columna y/o de sitio. Es lo único que se hace cientos de veces, así que va por un camino corto */
export async function moverTarea(actor: Actor, id: string, destino: DestinoDeMovimiento): Promise<{ tarea: TareaLigera; renumeradas: Array<{ id: string; orden: number }> | null }> {
  const service = createServiceClient()
  const { data: previa } = await service.from('tc_tareas').select('id, cliente_id, estado, orden, notion_page_id, titulo').eq('id', id).maybeSingle()
  if (!previa) throw new ErrorDeTareas('Esa tarea no existe.', 404)
  exigirAcceso(actor.clientes, previa.cliente_id)
  const estado = tope(destino.estado, 80)
  if (!estado) throw new ErrorDeTareas('Falta la columna de destino.')

  if (estado !== previa.estado) await exigirEstadoDelCliente(previa.cliente_id, estado)
  const { data: columna } = await service.from('tc_tareas').select('id, orden').eq('cliente_id', previa.cliente_id).eq('estado', estado).eq('archivada', false).neq('id', id).order('orden')
  const ids = (columna ?? []).map((c: { id: string }) => c.id)
  const ordenes = new Map((columna ?? []).map((c: { id: string; orden: number }) => [c.id, Number(c.orden)] as const))
  const i = destino.alFinal ? ids.length - 1 : destino.despuesDe ? ids.indexOf(destino.despuesDe) : -1
  if (!destino.alFinal && destino.despuesDe && i < 0) throw new ErrorDeTareas('La tarea que va antes ya no está en esa columna. Recarga el tablero.', 409)
  const { orden, renumeradas } = colocar(ids, ordenes, i + 1)

  if (renumeradas) {
    for (const r of renumeradas) await service.from('tc_tareas').update({ orden: r.orden }).eq('id', r.id)
  }
  const cambiaDeColumna = previa.estado !== estado
  const conNotion = cambiaDeColumna && (Boolean(previa.notion_page_id) || (await tieneBaseDeNotion(previa.cliente_id)))
  const { data, error } = await service
    .from('tc_tareas')
    .update({ estado, orden, actualizado_por: actor.userId, ...(conNotion ? { sync_estado: 'pendiente', sync_error: null } : {}) })
    .eq('id', id)
    .select(COLUMNAS_LIGERAS)
    .single()
  if (error || !data) throw new ErrorDeTareas(`No se ha podido mover la tarea: ${error?.message ?? 'sin respuesta'}`, 500)

  if (cambiaDeColumna) {
    await registrar(actor, { tareaId: id, clienteId: previa.cliente_id, tipo: 'movida', datos: { de: previa.estado, a: estado } })
    if (conNotion) await encolar(previa.cliente_id, id, previa.notion_page_id ? 'propiedades' : 'crear', { campos: ['estado'] })
  }
  return { tarea: data as TareaLigera, renumeradas }
}

/* ------------------------------------------------------------------ */
/* Comentarios                                                         */
/* ------------------------------------------------------------------ */

async function recontarComentarios(tareaId: string) {
  const service = createServiceClient()
  const { count } = await service.from('tc_comentarios').select('id', { count: 'exact', head: true }).eq('tarea_id', tareaId).eq('borrado', false)
  await service.from('tc_tareas').update({ comentarios: count ?? 0 }).eq('id', tareaId)
  return count ?? 0
}

export async function crearComentario(actor: Actor, tareaId: string, cuerpoBruto: unknown): Promise<ComentarioTC> {
  const cuerpo = tope(cuerpoBruto, 8000)
  if (!cuerpo) throw new ErrorDeTareas('El comentario está vacío.')
  const service = createServiceClient()
  const { data: tarea } = await service.from('tc_tareas').select('id, cliente_id, titulo, responsables, creado_por, notion_page_id').eq('id', tareaId).maybeSingle()
  if (!tarea) throw new ErrorDeTareas('Esa tarea no existe.', 404)
  exigirAcceso(actor.clientes, tarea.cliente_id)
  // Solo se puede mencionar, y solo se avisa, a quien ve ese cliente
  const personas = await personasConAcceso(tarea.cliente_id)
  const conAcceso = new Set(personas.map((p) => p.id))
  const menciones = mencionesEnTexto(cuerpo, personas)

  const { data, error } = await service
    .from('tc_comentarios')
    .insert({ tarea_id: tareaId, autor_id: actor.userId, autor_nombre: actor.nombre, cuerpo, menciones, origen: 'erp' })
    .select('*')
    .single()
  if (error || !data) throw new ErrorDeTareas(`No se ha podido guardar el comentario: ${error?.message ?? 'sin respuesta'}`, 500)
  const comentario = data as ComentarioTC

  await recontarComentarios(tareaId)
  await registrar(actor, { tareaId, clienteId: tarea.cliente_id, tipo: 'comentario', datos: { comentarioId: comentario.id } })
  const { data: cli } = await service.from('tc_clientes').select('nombre').eq('id', tarea.cliente_id).maybeSingle()
  const destinatarios = destinatariosDeComentario({ actorId: actor.userId, responsables: tarea.responsables ?? [], creadoPor: tarea.creado_por, menciones }).filter((d) => conAcceso.has(d.userId))
  await avisar(
    destinatarios.map((d) => ({
      userId: d.userId,
      tipo: d.tipo,
      titulo: d.tipo === 'mention' ? `${actor.nombre} te ha mencionado` : `${actor.nombre} ha comentado`,
      mensaje: resumen(`${cli?.nombre ?? 'Cliente'} · ${tarea.titulo || 'Sin título'}: ${cuerpo}`),
      clave: `tc:${d.tipo}:${comentario.id}:${d.userId}`,
      clienteId: tarea.cliente_id,
      tareaId,
    }))
  )
  await encolar(tarea.cliente_id, tareaId, 'comentar', { comentarioId: comentario.id })
  return comentario
}

/** Lo mismo que `exigirAcceso`, partiendo de una tarea: se mira de qué cliente es */
async function exigirAccesoDeTarea(permitidos: Permitidos, tareaId: string): Promise<void> {
  if (!permitidos) return
  const { data } = await createServiceClient().from('tc_tareas').select('cliente_id').eq('id', tareaId).maybeSingle()
  exigirAcceso(permitidos, data?.cliente_id)
}

export async function borrarComentario(actor: Actor & { esAdmin: boolean }, id: string): Promise<void> {
  const service = createServiceClient()
  const { data } = await service.from('tc_comentarios').select('id, tarea_id, autor_id').eq('id', id).maybeSingle()
  if (!data) throw new ErrorDeTareas('Ese comentario no existe.', 404)
  await exigirAccesoDeTarea(actor.clientes, data.tarea_id)
  if (data.autor_id !== actor.userId && !actor.esAdmin) throw new ErrorDeTareas('Solo puede borrar un comentario quien lo escribió o un administrador.', 403)
  await service.from('tc_comentarios').update({ borrado: true }).eq('id', id)
  await recontarComentarios(data.tarea_id)
}

export async function editarComentario(actor: Actor, id: string, cuerpoBruto: unknown): Promise<ComentarioTC> {
  const cuerpo = tope(cuerpoBruto, 8000)
  if (!cuerpo) throw new ErrorDeTareas('El comentario está vacío.')
  const service = createServiceClient()
  const { data } = await service.from('tc_comentarios').select('id, tarea_id, autor_id').eq('id', id).maybeSingle()
  if (!data) throw new ErrorDeTareas('Ese comentario no existe.', 404)
  await exigirAccesoDeTarea(actor.clientes, data.tarea_id)
  if (data.autor_id !== actor.userId) throw new ErrorDeTareas('Solo puede editar un comentario quien lo escribió.', 403)
  const { data: nuevo, error } = await service.from('tc_comentarios').update({ cuerpo, editado_en: new Date().toISOString() }).eq('id', id).select('*').single()
  if (error || !nuevo) throw new ErrorDeTareas('No se ha podido editar el comentario.', 500)
  return nuevo as ComentarioTC
}

/* ------------------------------------------------------------------ */
/* Clientes y preferencias                                             */
/* ------------------------------------------------------------------ */

export interface CambiosDeCliente {
  /** El orden de las columnas (nombres de estado): se guarda dentro de `opciones` y solo vale en el ERP */
  orden_columnas?: unknown
  nombre?: unknown
  icono?: unknown
  color?: unknown
  descripcion?: unknown
  portada?: unknown
  fondo?: unknown
  grupo?: unknown
  visible_cliente?: unknown
  activo?: unknown
}

/** Un valor de portada o fondo: solo la forma que entiende fondoCss, nada más */
function portadaLimpia(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object') return {}
  const p = v as { tipo?: unknown; valor?: unknown; y?: unknown }
  if (p.tipo !== 'color' && p.tipo !== 'degradado' && p.tipo !== 'imagen' && p.tipo !== 'animado') return {}
  const valor = tope(p.valor, 600)
  if (!valor) return {}
  // Un fondo animado es uno de la lista cerrada: cualquier otro nombre no se guarda
  if (p.tipo === 'animado' && !fondoAnimadoId({ tipo: 'animado', valor })) return {}
  const y = Number(p.y)
  return { tipo: p.tipo, valor, ...(Number.isFinite(y) ? { y: Math.max(0, Math.min(100, Math.round(y))) } : {}) }
}

export async function actualizarCliente(actor: Actor & { esAdmin: boolean }, id: string, cambios: CambiosDeCliente): Promise<ClienteTC> {
  exigirAcceso(actor.clientes, id)
  const l: Record<string, unknown> = {}
  if ('nombre' in cambios) {
    const n = tope(cambios.nombre, 120)
    if (!n) throw new ErrorDeTareas('El cliente necesita un nombre.')
    l.nombre = n
  }
  if ('icono' in cambios) l.icono = cambios.icono ? tope(cambios.icono, 16) : null
  if ('color' in cambios) l.color = tope(cambios.color, 24) || 'orange'
  if ('descripcion' in cambios) l.descripcion = cambios.descripcion ? tope(cambios.descripcion, 2000) : null
  if ('portada' in cambios) l.portada = portadaLimpia(cambios.portada)
  if ('fondo' in cambios) l.fondo = portadaLimpia(cambios.fondo)
  if ('grupo' in cambios) {
    if (cambios.grupo !== 'agencia' && cambios.grupo !== 'marcas_eeuu' && cambios.grupo !== 'otros') throw new ErrorDeTareas('Ese grupo no existe.')
    l.grupo = cambios.grupo
  }
  // Lo que decide qué ve un cliente de verdad, y desactivar uno, es de administradores
  if ('visible_cliente' in cambios) {
    if (!actor.esAdmin) throw new ErrorDeTareas('Solo un administrador decide qué ve el cliente.', 403)
    l.visible_cliente = cambios.visible_cliente === true
  }
  if ('activo' in cambios) {
    if (!actor.esAdmin) throw new ErrorDeTareas('Solo un administrador puede activar o desactivar un cliente.', 403)
    l.activo = cambios.activo !== false
  }
  if ('orden_columnas' in cambios) {
    const lista = Array.isArray(cambios.orden_columnas) ? [...new Set(cambios.orden_columnas.filter((x): x is string => typeof x === 'string').map((x) => x.trim().slice(0, 80)).filter(Boolean))].slice(0, 40) : []
    const { data: actual } = await createServiceClient().from('tc_clientes').select('opciones').eq('id', id).maybeSingle()
    l.opciones = { ...((actual?.opciones as Record<string, unknown> | null) ?? {}), orden_columnas: lista }
  }
  if (Object.keys(l).length === 0) throw new ErrorDeTareas('No hay nada que cambiar.')
  const { data, error } = await createServiceClient().from('tc_clientes').update(l).eq('id', id).select('*').single()
  if (error || !data) throw new ErrorDeTareas(`No se ha podido guardar el cliente: ${error?.message ?? 'no existe'}`, error ? 500 : 404)
  return data as ClienteTC
}

/** El orden de las tarjetas de clientes dentro de su grupo: el que se ve al arrastrarlas */
export async function reordenarClientes(ids: unknown): Promise<void> {
  if (!Array.isArray(ids) || !ids.every(esUuid) || ids.length > 200) throw new ErrorDeTareas('La lista de clientes no es válida.')
  const service = createServiceClient()
  for (let i = 0; i < ids.length; i++) await service.from('tc_clientes').update({ orden: (i + 1) * 10 }).eq('id', ids[i])
}

export async function guardarPreferencias(userId: string, cambios: { fondo?: unknown; portada?: unknown; favoritos?: unknown }): Promise<void> {
  const fila: Record<string, unknown> = { usuario_id: userId, actualizado_en: new Date().toISOString() }
  if ('fondo' in cambios) fila.fondo = portadaLimpia(cambios.fondo)
  if ('portada' in cambios) fila.portada = portadaLimpia(cambios.portada)
  if ('favoritos' in cambios) fila.favoritos = Array.isArray(cambios.favoritos) ? [...new Set(cambios.favoritos.filter(esUuid))].slice(0, 50) : []
  const { error } = await createServiceClient().from('tc_preferencias').upsert(fila, { onConflict: 'usuario_id' })
  if (error) throw new ErrorDeTareas(`No se han podido guardar tus preferencias: ${error.message}`, 500)
}

/** Para las pruebas y para los nombres de opciones al validar: ¿tiene esta tarea el estado de hecho? */
export const tareaEstaHecha = (t: Pick<TareaTC, 'estado'>, c: Pick<ClienteTC, 'opciones'>) => estaHecha(t, estadosDe(c))
export const departamentosDelCliente = departamentosDe
