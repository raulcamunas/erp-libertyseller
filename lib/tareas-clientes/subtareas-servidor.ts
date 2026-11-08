import { createServiceClient } from '@/lib/supabase/service'
import { ErrorDeTareas, esUuid, exigirTarea, personasConAcceso, type Actor } from './servidor'
import { contarSubtareas, limpiarSubtarea, MAX_SUBTAREAS, validarBloqueos, type SubtareaTC } from './subtareas'

/**
 * LAS SUBTAREAS (tabla `tc_subtareas`) Y LOS BLOQUEOS ENTRE TAREAS (columna `bloqueada_por`), migración 278. SOLO SERVIDOR.
 *
 * Nada de esto viaja a Notion: es del ERP. El contador de la tarjeta (`subtareas_total`/`subtareas_hechas`) lo recalcula el servidor cada vez que cambia una subtarea.
 */

const COLUMNAS = 'id, tarea_id, titulo, hecha, responsable_id, fecha, orden'
const faltaLaTabla = (e: { message?: string; code?: string } | null): boolean => Boolean(e && (e.code === '42P01' || /tc_subtareas|bloqueada_por/.test(e.message ?? '')))
const SIN_MIGRACION = 'Falta lanzar la migración 278 en Supabase para usar subtareas y bloqueos.'

export interface Contadores {
  subtareas_total: number
  subtareas_hechas: number
}

async function recontar(tareaId: string): Promise<Contadores> {
  const service = createServiceClient()
  const { data } = await service.from('tc_subtareas').select('hecha').eq('tarea_id', tareaId)
  const { total, hechas } = contarSubtareas((data ?? []) as Array<{ hecha: boolean }>)
  await service.from('tc_tareas').update({ subtareas_total: total, subtareas_hechas: hechas }).eq('id', tareaId)
  return { subtareas_total: total, subtareas_hechas: hechas }
}

export async function listarSubtareas(actor: Actor, tareaId: string): Promise<{ subtareas: SubtareaTC[]; disponible: boolean }> {
  await exigirTarea(tareaId, actor.clientes)
  const { data, error } = await createServiceClient().from('tc_subtareas').select(COLUMNAS).eq('tarea_id', tareaId).order('orden').order('creado_en')
  if (error) {
    if (faltaLaTabla(error)) return { subtareas: [], disponible: false }
    throw new ErrorDeTareas(`No se han podido leer las subtareas: ${error.message}`, 500)
  }
  return { subtareas: (data ?? []) as SubtareaTC[], disponible: true }
}

async function exigirResponsable(clienteId: string, responsableId: string | null | undefined): Promise<void> {
  if (!responsableId) return
  const gente = await personasConAcceso(clienteId)
  if (!gente.some((p) => p.id === responsableId)) throw new ErrorDeTareas('Solo se puede asignar a personas con acceso a este cliente.')
}

export async function crearSubtarea(actor: Actor, tareaId: string, entrada: Record<string, unknown>): Promise<{ subtarea: SubtareaTC } & Contadores> {
  const tarea = await exigirTarea(tareaId, actor.clientes)
  const limpio = limpiarSubtarea(entrada, true)
  if (!limpio?.titulo) throw new ErrorDeTareas('Escribe qué hay que hacer (hasta 300 letras).')
  await exigirResponsable(tarea.cliente_id, limpio.responsable_id)
  const service = createServiceClient()
  const { data: ultimas, error: errorDeLectura } = await service.from('tc_subtareas').select('orden').eq('tarea_id', tareaId).order('orden', { ascending: false }).limit(1)
  if (errorDeLectura) throw new ErrorDeTareas(faltaLaTabla(errorDeLectura) ? SIN_MIGRACION : errorDeLectura.message, faltaLaTabla(errorDeLectura) ? 503 : 500)
  const { count } = await service.from('tc_subtareas').select('id', { count: 'exact', head: true }).eq('tarea_id', tareaId)
  if ((count ?? 0) >= MAX_SUBTAREAS) throw new ErrorDeTareas(`Una tarea admite hasta ${MAX_SUBTAREAS} subtareas.`)
  const orden = ((ultimas ?? [])[0] as { orden: number } | undefined)?.orden ?? 0
  const { data, error } = await service.from('tc_subtareas').insert({ tarea_id: tareaId, ...limpio, orden: orden + 1 }).select(COLUMNAS).single()
  if (error || !data) throw new ErrorDeTareas(`No se ha podido crear la subtarea: ${error?.message ?? 'sin respuesta'}`, 500)
  return { subtarea: data as SubtareaTC, ...(await recontar(tareaId)) }
}

export async function cambiarSubtarea(actor: Actor, tareaId: string, subtareaId: string, entrada: Record<string, unknown>): Promise<{ subtarea: SubtareaTC } & Contadores> {
  const tarea = await exigirTarea(tareaId, actor.clientes)
  if (!esUuid(subtareaId)) throw new ErrorDeTareas('Esa subtarea no existe.', 404)
  const limpio = limpiarSubtarea(entrada, false)
  if (!limpio || Object.keys(limpio).length === 0) throw new ErrorDeTareas('No hay nada válido que cambiar.')
  await exigirResponsable(tarea.cliente_id, limpio.responsable_id)
  const { data, error } = await createServiceClient().from('tc_subtareas').update(limpio).eq('id', subtareaId).eq('tarea_id', tareaId).select(COLUMNAS).maybeSingle()
  if (error) throw new ErrorDeTareas(`No se ha podido guardar la subtarea: ${error.message}`, 500)
  if (!data) throw new ErrorDeTareas('Esa subtarea no existe.', 404)
  return { subtarea: data as SubtareaTC, ...(await recontar(tareaId)) }
}

export async function borrarSubtarea(actor: Actor, tareaId: string, subtareaId: string): Promise<Contadores> {
  await exigirTarea(tareaId, actor.clientes)
  if (!esUuid(subtareaId)) throw new ErrorDeTareas('Esa subtarea no existe.', 404)
  const { error } = await createServiceClient().from('tc_subtareas').delete().eq('id', subtareaId).eq('tarea_id', tareaId)
  if (error) throw new ErrorDeTareas(`No se ha podido borrar la subtarea: ${error.message}`, 500)
  return recontar(tareaId)
}

/** Pone de qué tareas depende ésta (sustituye la lista). Solo del mismo cliente y sin círculos */
export async function fijarBloqueos(actor: Actor, tareaId: string, ids: unknown): Promise<{ bloqueada_por: string[] }> {
  const tarea = await exigirTarea(tareaId, actor.clientes)
  const service = createServiceClient()
  const { data, error } = await service.from('tc_tareas').select('id, bloqueada_por').eq('cliente_id', tarea.cliente_id).eq('archivada', false)
  if (error) throw new ErrorDeTareas(faltaLaTabla(error) ? SIN_MIGRACION : `No se han podido leer las tareas: ${error.message}`, faltaLaTabla(error) ? 503 : 500)
  const otras = new Map(((data ?? []) as Array<{ id: string; bloqueada_por: string[] | null }>).map((t) => [t.id, t.bloqueada_por ?? []]))
  const v = validarBloqueos(tareaId, ids, otras)
  if (!v.ok) throw new ErrorDeTareas(v.motivo)
  const { error: errorAlGuardar } = await service.from('tc_tareas').update({ bloqueada_por: v.ids }).eq('id', tareaId)
  if (errorAlGuardar) throw new ErrorDeTareas(`No se ha podido guardar: ${errorAlGuardar.message}`, 500)
  return { bloqueada_por: v.ids }
}
