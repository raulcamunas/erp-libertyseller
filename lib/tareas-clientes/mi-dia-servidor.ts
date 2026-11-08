import { createServiceClient } from '@/lib/supabase/service'
import { esAvisoDeTareas } from '@/lib/push/aviso'
import { arrastrarPendientes, esDiaValido, limpiarPlan, limpiarTexto, MAX_NOTAS, MAX_REVISION, progresoDelPlan, sumarDiasA, type PuntoDelPlan } from './mi-dia'
import { filtrarPorCliente, type Permitidos } from './permisos'
import { ErrorDeTareas, esUuid, personasConAcceso } from './servidor'
import { estadosDe, estaHecha, type ClienteTC } from './tipos'
import { hoyEnEspana } from './filtros'

/**
 * «MI DÍA» EN EL SERVIDOR (tablas `tc_briefings` y `tc_notas_personales`, migración 279). SOLO SERVIDOR.
 *
 * Cada persona escribe SOLO en su briefing y sus anotaciones. Un administrador puede LEER el briefing de cualquiera (es lo que hacía mirando las páginas de Notion de cada
 * empleado), nunca escribirlo. Si falta la migración, la pantalla lo dice y lo demás (tareas, comentarios, avisos) sigue funcionando.
 */

export interface Quien {
  userId: string
  nombre: string
  esAdmin: boolean
  clientes: Permitidos
}

export interface BriefingDelDia {
  usuario_id: string
  dia: string
  plan: PuntoDelPlan[]
  revision: string
  actualizado_en: string | null
  /** true = es de otra persona (un administrador mirándolo): no se puede cambiar */
  solo_lectura: boolean
}

export interface ComentarioReciente {
  id: string
  tarea_id: string
  cliente_id: string
  tarea: string
  autor: string
  cuerpo: string
  creado_en: string
  me_menciona: boolean
}

export interface TareaNueva {
  tarea_id: string
  cuando: string
  quien: string
  motivo: 'asignada' | 'creada'
}

export interface AvisoDeMiDia {
  id: string
  type: string
  title: string
  message: string | null
  datos: unknown
  read: boolean
  created_at: string
}

export interface PersonaDelEquipo {
  id: string
  nombre: string
  total: number
  hechos: number
  actualizado_en: string | null
}

export interface DatosDeMiDia {
  disponible: boolean
  hoy: string
  briefing: BriefingDelDia
  notas: string
  comentarios: ComentarioReciente[]
  nuevas: TareaNueva[]
  avisos: AvisoDeMiDia[]
  equipo: PersonaDelEquipo[] | null
}

const faltaLaTabla = (e: { message?: string; code?: string } | null | undefined): boolean => Boolean(e && (e.code === '42P01' || /tc_briefings|tc_notas_personales/.test(e.message ?? '')))
const vacio = (usuario: string, dia: string, soloLectura: boolean): BriefingDelDia => ({ usuario_id: usuario, dia, plan: [], revision: '', actualizado_en: null, solo_lectura: soloLectura })

async function filaDelBriefing(usuario: string, dia: string) {
  const { data, error } = await createServiceClient().from('tc_briefings').select('usuario_id, dia, plan, revision, actualizado_en').eq('usuario_id', usuario).eq('dia', dia).maybeSingle()
  return { fila: data as { usuario_id: string; dia: string; plan: unknown; revision: string; actualizado_en: string } | null, error }
}

/** El briefing de un día. El de hoy (o futuro) de uno mismo se CREA al abrirlo, con los puntos sin hacer del último día que hubo */
async function leerBriefing(usuario: string, dia: string, propio: boolean, hoy: string): Promise<{ disponible: boolean; briefing: BriefingDelDia }> {
  const { fila, error } = await filaDelBriefing(usuario, dia)
  if (error) return { disponible: !faltaLaTabla(error), briefing: vacio(usuario, dia, !propio) }
  if (fila) return { disponible: true, briefing: { usuario_id: usuario, dia, plan: limpiarPlan(fila.plan) ?? [], revision: fila.revision ?? '', actualizado_en: fila.actualizado_en, solo_lectura: !propio } }
  if (!propio || dia < hoy) return { disponible: true, briefing: vacio(usuario, dia, !propio) }

  // Primer acceso del día: lo pendiente del último briefing de los diez días anteriores
  const service = createServiceClient()
  const { data: previo } = await service.from('tc_briefings').select('plan').eq('usuario_id', usuario).lt('dia', dia).gte('dia', sumarDiasA(dia, -10)).order('dia', { ascending: false }).limit(1).maybeSingle()
  const plan = arrastrarPendientes(limpiarPlan((previo as { plan?: unknown } | null)?.plan) ?? [])
  const { data: creado } = await service.from('tc_briefings').upsert({ usuario_id: usuario, dia, plan, revision: '' }, { onConflict: 'usuario_id,dia', ignoreDuplicates: true }).select('plan, revision, actualizado_en').maybeSingle()
  // Si otra pestaña lo creó a la vez, se lee el que ganó
  const final = creado ?? (await filaDelBriefing(usuario, dia)).fila
  return { disponible: true, briefing: { usuario_id: usuario, dia, plan: limpiarPlan(final?.plan) ?? plan, revision: final?.revision ?? '', actualizado_en: final?.actualizado_en ?? null, solo_lectura: false } }
}

async function comentariosRecientes(yo: string, permitidos: Permitidos): Promise<ComentarioReciente[]> {
  const service = createServiceClient()
  const desde = new Date(Date.now() - 14 * 86_400_000).toISOString()
  const { data: mias } = await service.from('tc_tareas').select('id').contains('responsables', [yo]).eq('archivada', false).limit(3000)
  const ids = ((mias ?? []) as Array<{ id: string }>).map((t) => t.id)
  const columnas = 'id, tarea_id, autor_id, autor_nombre, cuerpo, menciones, creado_en'
  const [deMisTareas, menciones] = await Promise.all([
    ids.length > 0 ? service.from('tc_comentarios').select(columnas).in('tarea_id', ids.slice(0, 600)).gte('creado_en', desde).eq('borrado', false).order('creado_en', { ascending: false }).limit(60) : Promise.resolve({ data: [] }),
    service.from('tc_comentarios').select(columnas).contains('menciones', [yo]).gte('creado_en', desde).eq('borrado', false).order('creado_en', { ascending: false }).limit(40),
  ])
  type Fila = { id: string; tarea_id: string; autor_id: string | null; autor_nombre: string; cuerpo: string; menciones: string[] | null; creado_en: string }
  const porId = new Map<string, Fila>()
  for (const c of [...((deMisTareas.data ?? []) as Fila[]), ...((menciones.data ?? []) as Fila[])]) if (c.autor_id !== yo) porId.set(c.id, c)
  const ordenadas = [...porId.values()].sort((a, b) => b.creado_en.localeCompare(a.creado_en)).slice(0, 40)
  if (ordenadas.length === 0) return []
  const { data: tareas } = await service.from('tc_tareas').select('id, titulo, cliente_id').in('id', [...new Set(ordenadas.map((c) => c.tarea_id))])
  const tareaDe = new Map(((tareas ?? []) as Array<{ id: string; titulo: string; cliente_id: string }>).map((t) => [t.id, t]))
  const visibles = filtrarPorCliente(ordenadas, permitidos, (c) => tareaDe.get(c.tarea_id)?.cliente_id)
  return visibles.slice(0, 25).map((c) => ({
    id: c.id,
    tarea_id: c.tarea_id,
    cliente_id: tareaDe.get(c.tarea_id)?.cliente_id ?? '',
    tarea: tareaDe.get(c.tarea_id)?.titulo || 'Tarea sin título',
    autor: c.autor_nombre || 'Alguien',
    cuerpo: c.cuerpo.length > 280 ? `${c.cuerpo.slice(0, 280)}…` : c.cuerpo,
    creado_en: c.creado_en,
    me_menciona: (c.menciones ?? []).includes(yo),
  }))
}

async function tareasNuevas(yo: string, permitidos: Permitidos): Promise<TareaNueva[]> {
  const service = createServiceClient()
  const desde = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const [asignaciones, creadas] = await Promise.all([
    service.from('tc_actividad').select('tarea_id, cliente_id, actor_nombre, datos, creado_en').eq('tipo', 'asignada').gte('creado_en', desde).order('creado_en', { ascending: false }).limit(300),
    service.from('tc_tareas').select('id, cliente_id, creado_en, creado_por').contains('responsables', [yo]).gte('creado_en', desde).eq('archivada', false).order('creado_en', { ascending: false }).limit(50),
  ])
  const salida = new Map<string, TareaNueva & { cliente: string }>()
  for (const a of (asignaciones.data ?? []) as Array<{ tarea_id: string | null; cliente_id: string | null; actor_nombre: string; datos: { anadidos?: string[] }; creado_en: string }>) {
    if (!a.tarea_id || !(a.datos?.anadidos ?? []).includes(yo) || salida.has(a.tarea_id)) continue
    salida.set(a.tarea_id, { tarea_id: a.tarea_id, cuando: a.creado_en, quien: a.actor_nombre || 'Alguien', motivo: 'asignada', cliente: a.cliente_id ?? '' })
  }
  for (const t of (creadas.data ?? []) as Array<{ id: string; cliente_id: string; creado_en: string; creado_por: string | null }>) {
    if (!salida.has(t.id)) salida.set(t.id, { tarea_id: t.id, cuando: t.creado_en, quien: '', motivo: 'creada', cliente: t.cliente_id })
  }
  const lista = filtrarPorCliente([...salida.values()], permitidos, (x) => x.cliente || null).sort((a, b) => b.cuando.localeCompare(a.cuando)).slice(0, 15)
  return lista.map(({ cliente: _c, ...resto }) => (void _c, resto))
}

/** Solo los avisos del módulo de tareas (asignaciones, menciones, comentarios, vencimientos, tareas propuestas): los fallos del catálogo, el correo y demás se quedan en la campana */
async function avisosRecientes(yo: string): Promise<AvisoDeMiDia[]> {
  const { data } = await createServiceClient().from('notifications').select('id, type, title, message, datos, read, created_at').eq('user_id', yo).order('created_at', { ascending: false }).limit(150)
  return ((data ?? []) as AvisoDeMiDia[]).filter((a) => esAvisoDeTareas(a)).slice(0, 15)
}

async function equipoDeHoy(hoy: string): Promise<PersonaDelEquipo[]> {
  const personas = await personasConAcceso()
  const { data } = await createServiceClient().from('tc_briefings').select('usuario_id, plan, actualizado_en').eq('dia', hoy).in('usuario_id', personas.map((p) => p.id))
  const porPersona = new Map(((data ?? []) as Array<{ usuario_id: string; plan: unknown; actualizado_en: string }>).map((b) => [b.usuario_id, b]))
  return personas
    .map((p) => {
      const b = porPersona.get(p.id)
      const prog = progresoDelPlan(limpiarPlan(b?.plan) ?? [])
      return { id: p.id, nombre: p.nombre, total: prog.total, hechos: prog.hechos, actualizado_en: b?.actualizado_en ?? null }
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

export async function leerMiDia(quien: Quien, dia: string | null, usuario: string | null): Promise<DatosDeMiDia> {
  const hoy = hoyEnEspana()
  const diaFinal = dia && esDiaValido(dia) ? dia : hoy
  const de = usuario && esUuid(usuario) && usuario !== quien.userId ? usuario : quien.userId
  if (de !== quien.userId && !quien.esAdmin) throw new ErrorDeTareas('Solo un administrador puede ver el briefing de otra persona.', 403)

  const service = createServiceClient()
  const [lectura, notas, comentarios, nuevas, avisos, equipo] = await Promise.all([
    leerBriefing(de, diaFinal, de === quien.userId, hoy),
    service.from('tc_notas_personales').select('texto').eq('usuario_id', quien.userId).maybeSingle(),
    comentariosRecientes(quien.userId, quien.clientes).catch(() => []),
    tareasNuevas(quien.userId, quien.clientes).catch(() => []),
    avisosRecientes(quien.userId).catch(() => []),
    quien.esAdmin ? equipoDeHoy(hoy).catch(() => null) : Promise.resolve(null),
  ])
  return { disponible: lectura.disponible, hoy, briefing: lectura.briefing, notas: (notas.data as { texto?: string } | null)?.texto ?? '', comentarios, nuevas, avisos, equipo }
}

export async function guardarBriefing(quien: Quien, dia: unknown, cambios: Record<string, unknown>): Promise<BriefingDelDia> {
  if (!esDiaValido(dia)) throw new ErrorDeTareas('Ese día no es válido.')
  const fila: Record<string, unknown> = { usuario_id: quien.userId, dia }
  if ('plan' in cambios) {
    const plan = limpiarPlan(cambios.plan)
    if (!plan) throw new ErrorDeTareas('El plan no es una lista.')
    fila.plan = plan
  }
  if ('revision' in cambios) {
    const r = limpiarTexto(cambios.revision, MAX_REVISION)
    if (r === null) throw new ErrorDeTareas('La revisión no es un texto.')
    fila.revision = r
  }
  const { data, error } = await createServiceClient().from('tc_briefings').upsert(fila, { onConflict: 'usuario_id,dia' }).select('usuario_id, dia, plan, revision, actualizado_en').single()
  if (error || !data) throw new ErrorDeTareas(faltaLaTabla(error) ? 'Falta lanzar la migración 279 en Supabase para guardar el briefing.' : `No se ha podido guardar: ${error?.message ?? 'sin respuesta'}`, faltaLaTabla(error) ? 503 : 500)
  return { usuario_id: quien.userId, dia, plan: limpiarPlan(data.plan) ?? [], revision: data.revision ?? '', actualizado_en: data.actualizado_en, solo_lectura: false }
}

export async function guardarNotas(userId: string, texto: unknown): Promise<void> {
  const t = limpiarTexto(texto, MAX_NOTAS)
  if (t === null) throw new ErrorDeTareas('Las anotaciones no son un texto.')
  const { error } = await createServiceClient().from('tc_notas_personales').upsert({ usuario_id: userId, texto: t }, { onConflict: 'usuario_id' })
  if (error) throw new ErrorDeTareas(faltaLaTabla(error) ? 'Falta lanzar la migración 279 en Supabase para guardar las anotaciones.' : `No se ha podido guardar: ${error.message}`, faltaLaTabla(error) ? 503 : 500)
}

/** Lo que hizo esa persona ese día: las tareas que movió a una columna de «hecho» y cuántos comentarios escribió. Alimenta el borrador de la revisión */
export async function actividadDelDia(userId: string, dia: unknown): Promise<{ cerradas: string[]; comentarios: number }> {
  if (!esDiaValido(dia)) throw new ErrorDeTareas('Ese día no es válido.')
  const desde = new Date(Date.parse(`${dia}T00:00:00Z`) - 2 * 3_600_000).toISOString()
  const hasta = new Date(Date.parse(`${dia}T00:00:00Z`) + 22 * 3_600_000).toISOString()
  const service = createServiceClient()
  const [movidas, comentarios] = await Promise.all([
    service.from('tc_actividad').select('tarea_id, datos').eq('actor_id', userId).eq('tipo', 'movida').gte('creado_en', desde).lt('creado_en', hasta).limit(200),
    service.from('tc_comentarios').select('id', { count: 'exact', head: true }).eq('autor_id', userId).gte('creado_en', desde).lt('creado_en', hasta),
  ])
  const filas = ((movidas.data ?? []) as Array<{ tarea_id: string | null; datos: { a?: string } }>).filter((m) => m.tarea_id)
  const ids = [...new Set(filas.map((m) => m.tarea_id as string))]
  if (ids.length === 0) return { cerradas: [], comentarios: comentarios.count ?? 0 }
  const { data: tareas } = await service.from('tc_tareas').select('id, titulo, estado, cliente_id').in('id', ids)
  const clientes = new Map(((await service.from('tc_clientes').select('*').in('id', [...new Set(((tareas ?? []) as Array<{ cliente_id: string }>).map((t) => t.cliente_id))])).data as ClienteTC[] | null ?? []).map((c) => [c.id, c]))
  const cerradas = ((tareas ?? []) as Array<{ id: string; titulo: string; estado: string; cliente_id: string }>)
    .filter((t) => estaHecha({ estado: t.estado }, estadosDe(clientes.get(t.cliente_id))))
    .map((t) => `${clientes.get(t.cliente_id)?.nombre ? `${clientes.get(t.cliente_id)?.nombre} ⇒ ` : ''}${t.titulo || 'Tarea sin título'}`)
  return { cerradas, comentarios: comentarios.count ?? 0 }
}
