import { createServiceClient } from '@/lib/supabase/service'
import { MAX_ADJUNTOS_POR_TAREA, motivoDeRechazo, nombreLimpio, rutaDeAdjunto, type AdjuntoTC } from './adjuntos'
import { ErrorDeTareas, exigirTarea, registrarEdicion, type Actor } from './servidor'

/**
 * LOS ARCHIVOS ADJUNTOS DE UNA TAREA (tabla `tc_adjuntos` y almacén privado `tareas-archivos`, migraciones 275 y 278). SOLO SERVIDOR.
 *
 * Se sube siempre a través del servidor (el navegador no escribe en el almacén). Para abrirlos se pide un enlace firmado que caduca a la hora: nunca hay una dirección
 * permanente que se pueda reenviar.
 */

const BUCKET = 'tareas-archivos'
const VALIDEZ_DEL_ENLACE_S = 3600
const COLUMNAS = 'id, tarea_id, nombre, tipo, tamano, subido_nombre, visible_cliente, creado_en, ruta'

const faltaLaTabla = (e: { message?: string; code?: string } | null): boolean => Boolean(e && (e.code === '42P01' || /tc_adjuntos/.test(e.message ?? '')))

/** El contador de la tarjeta; si la columna todavía no existe, se ignora */
async function recontar(tareaId: string): Promise<number> {
  const service = createServiceClient()
  const { count } = await service.from('tc_adjuntos').select('id', { count: 'exact', head: true }).eq('tarea_id', tareaId)
  await service.from('tc_tareas').update({ adjuntos_total: count ?? 0 }).eq('id', tareaId)
  return count ?? 0
}

export async function listarAdjuntos(actor: Actor, tareaId: string): Promise<{ adjuntos: AdjuntoTC[]; disponible: boolean }> {
  await exigirTarea(tareaId, actor.clientes)
  const service = createServiceClient()
  const { data, error } = await service.from('tc_adjuntos').select(COLUMNAS).eq('tarea_id', tareaId).order('creado_en', { ascending: false })
  if (error) {
    if (faltaLaTabla(error)) return { adjuntos: [], disponible: false }
    throw new ErrorDeTareas(`No se han podido leer los archivos: ${error.message}`, 500)
  }
  const filas = (data ?? []) as Array<AdjuntoTC & { ruta: string }>
  const firmadas = filas.length > 0 ? await service.storage.from(BUCKET).createSignedUrls(filas.map((f) => f.ruta), VALIDEZ_DEL_ENLACE_S) : { data: [] as Array<{ path: string | null; signedUrl: string }> }
  const enlace = new Map((firmadas.data ?? []).map((f) => [f.path, f.signedUrl]))
  return { adjuntos: filas.map(({ ruta, ...resto }) => ({ ...resto, url: enlace.get(ruta) })), disponible: true }
}

export async function subirAdjunto(actor: Actor, tareaId: string, fichero: File): Promise<{ adjunto: AdjuntoTC; total: number }> {
  const tarea = await exigirTarea(tareaId, actor.clientes)
  const nombre = nombreLimpio(fichero.name)
  const motivo = motivoDeRechazo(nombre, fichero.size)
  if (motivo) throw new ErrorDeTareas(motivo)
  const service = createServiceClient()
  const { count, error: errorDeConteo } = await service.from('tc_adjuntos').select('id', { count: 'exact', head: true }).eq('tarea_id', tareaId)
  if (errorDeConteo && faltaLaTabla(errorDeConteo)) throw new ErrorDeTareas('Falta lanzar la migración 278 en Supabase para poder adjuntar archivos.', 503)
  if ((count ?? 0) >= MAX_ADJUNTOS_POR_TAREA) throw new ErrorDeTareas(`Una tarea admite hasta ${MAX_ADJUNTOS_POR_TAREA} archivos.`)

  const id = crypto.randomUUID()
  const ruta = rutaDeAdjunto(tareaId, id, nombre)
  const { error: errorDeSubida } = await service.storage.from(BUCKET).upload(ruta, new Uint8Array(await fichero.arrayBuffer()), { contentType: fichero.type || 'application/octet-stream', upsert: false })
  if (errorDeSubida) throw new ErrorDeTareas(`No se ha podido subir el archivo: ${errorDeSubida.message}`, 500)
  const { data, error } = await service
    .from('tc_adjuntos')
    .insert({ id, tarea_id: tareaId, nombre, ruta, tipo: fichero.type || 'application/octet-stream', tamano: fichero.size, subido_por: actor.userId || null, subido_nombre: actor.nombre })
    .select(COLUMNAS)
    .single()
  if (error || !data) {
    await service.storage.from(BUCKET).remove([ruta])
    throw new ErrorDeTareas(`No se ha podido guardar el archivo: ${error?.message ?? 'sin respuesta'}`, 500)
  }
  const total = await recontar(tareaId)
  await registrarEdicion(actor, tareaId, tarea.cliente_id, ['adjuntos'])
  const { ruta: _r, ...adjunto } = data as AdjuntoTC & { ruta: string }
  void _r
  return { adjunto, total }
}

export async function borrarAdjunto(actor: Actor, tareaId: string, adjuntoId: string): Promise<number> {
  await exigirTarea(tareaId, actor.clientes)
  const service = createServiceClient()
  const { data } = await service.from('tc_adjuntos').select('id, ruta').eq('id', adjuntoId).eq('tarea_id', tareaId).maybeSingle()
  if (!data) throw new ErrorDeTareas('Ese archivo no existe.', 404)
  const { error } = await service.from('tc_adjuntos').delete().eq('id', adjuntoId)
  if (error) throw new ErrorDeTareas(`No se ha podido borrar el archivo: ${error.message}`, 500)
  await service.storage.from(BUCKET).remove([(data as { ruta: string }).ruta])
  return recontar(tareaId)
}
