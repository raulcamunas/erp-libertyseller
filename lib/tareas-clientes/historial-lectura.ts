import { createServiceClient } from '@/lib/supabase/service'
import type { Bloque } from './bloques'
import { cuerpoParaRestaurar, type OrigenDeVersion, type ResumenDeVersion } from './historial'
import { guardarVersion } from './historial-servidor'
import { actualizarTarea, ErrorDeTareas, esUuid, exigirAcceso, type Actor, type TareaLigera } from './servidor'

/** LEER Y RESTAURAR LAS VERSIONES DEL CUERPO DE UNA TAREA. SOLO SERVIDOR. */

export interface VersionResumida {
  id: string
  titulo: string
  resumen: ResumenDeVersion
  origen: OrigenDeVersion
  usuario_nombre: string
  creado_en: string
}

const COLUMNAS = 'id, titulo, resumen, origen, usuario_nombre, creado_en'

const faltaLaTabla = (e: { message?: string; code?: string } | null): boolean => Boolean(e && (e.code === '42P01' || /tc_versiones/.test(e.message ?? '')))

async function clienteDeLaTarea(tareaId: string, actor: Actor): Promise<{ cliente_id: string; contenido: Bloque[]; titulo: string }> {
  if (!esUuid(tareaId)) throw new ErrorDeTareas('Esa tarea no existe.', 404)
  const { data } = await createServiceClient().from('tc_tareas').select('cliente_id, contenido, titulo').eq('id', tareaId).maybeSingle()
  if (!data) throw new ErrorDeTareas('Esa tarea no existe.', 404)
  exigirAcceso(actor.clientes, (data as { cliente_id: string }).cliente_id)
  return data as { cliente_id: string; contenido: Bloque[]; titulo: string }
}

export async function listarVersiones(actor: Actor, tareaId: string): Promise<{ versiones: VersionResumida[]; disponible: boolean }> {
  await clienteDeLaTarea(tareaId, actor)
  const { data, error } = await createServiceClient().from('tc_versiones').select(COLUMNAS).eq('tarea_id', tareaId).order('creado_en', { ascending: false })
  if (error) {
    if (faltaLaTabla(error)) return { versiones: [], disponible: false }
    throw new ErrorDeTareas(`No se ha podido leer el historial: ${error.message}`, 500)
  }
  return { versiones: (data ?? []) as VersionResumida[], disponible: true }
}

export async function leerVersion(actor: Actor, tareaId: string, versionId: string): Promise<VersionResumida & { contenido: Bloque[] }> {
  await clienteDeLaTarea(tareaId, actor)
  if (!esUuid(versionId)) throw new ErrorDeTareas('Esa versión no existe.', 404)
  const { data } = await createServiceClient().from('tc_versiones').select(`${COLUMNAS}, contenido`).eq('id', versionId).eq('tarea_id', tareaId).maybeSingle()
  if (!data) throw new ErrorDeTareas('Esa versión no existe.', 404)
  return data as VersionResumida & { contenido: Bloque[] }
}

/** Pone una versión como el cuerpo de ahora. Antes guarda una copia del cuerpo actual (siempre), así que restaurar también se puede deshacer */
export async function restaurarVersion(actor: Actor, tareaId: string, versionId: string): Promise<TareaLigera> {
  const tarea = await clienteDeLaTarea(tareaId, actor)
  const version = await leerVersion(actor, tareaId, versionId)
  await guardarVersion({ id: tareaId, titulo: tarea.titulo }, tarea.contenido ?? [], actor, 'restaurar', true)
  return actualizarTarea(actor, tareaId, { contenido: cuerpoParaRestaurar(version.contenido ?? [], tarea.contenido ?? []) })
}
