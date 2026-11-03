import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { BUCKET } from './comun'
import type { EstadoEncargo } from '@/lib/types/contenido'

/**
 * Lo que se hace con un encargo del calendario desde cualquier vista: marcarlo como
 * publicado o saltado, o quitarlo. Devuelven si salió bien y avisan ellas mismas.
 */

export async function cambiarEstado(id: string, estado: EstadoEncargo): Promise<boolean> {
  const { error } = await createClient()
    .from('contenido_calendario')
    .update({
      estado,
      publicado_at: estado === 'publicado' ? new Date().toISOString() : null,
    })
    .eq('id', id)
  if (error) {
    toast.error('No se pudo cambiar el estado')
    return false
  }
  toast.success(estado === 'publicado' ? 'Marcado como publicado' : 'Estado actualizado')
  return true
}

export async function quitarDelCalendario(id: string): Promise<boolean> {
  const { error } = await createClient().from('contenido_calendario').delete().eq('id', id)
  if (error) {
    toast.error('No se pudo quitar del calendario')
    return false
  }
  toast.success('Quitado del calendario')
  return true
}

/* ------------------------------------------------------------------ */
/* Historias                                                           */
/* ------------------------------------------------------------------ */

/** Lo que se cuenta de una historia nueva. Cada una es una pieza propia: de ahí que no haya límite por día */
export interface DatosDeHistoria {
  fecha: string
  titulo: string
  texto: string
  responsableId: string
  usuarioId: string
  fichero: File | null
}

const CODIGO_CHECK = '23514'
const CODIGO_PERMISO = '42501'

const nombreSeguro = (n: string) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-|-$/g, '') || 'fichero'

/** Por qué falló en cristiano: lo más probable es que falte lanzar la migración 268 */
function porQueFalla(error: { code?: string; message?: string } | null): string {
  if (error?.code === CODIGO_CHECK || error?.code === CODIGO_PERMISO || /row-level security|historia/i.test(error?.message ?? '')) {
    return 'Falta lanzar la migración 268_contenido_historias.sql en Supabase'
  }
  return 'No se pudo guardar la historia'
}

/**
 * Crea una historia y la programa en su día: la pieza, su foto o vídeo si lo hay, y el encargo. Si falla a medias deja todo como estaba
 * (no queda ni una pieza huérfana ni un fichero suelto en el bucket). Devuelve si salió bien y avisa ella misma de lo que falle.
 */
export async function crearHistoria(d: DatosDeHistoria): Promise<boolean> {
  const supabase = createClient()
  const slug = `historia-${d.fecha}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  let ruta: string | null = null
  try {
    if (d.fichero) {
      ruta = `historias/${slug}/${nombreSeguro(d.fichero.name)}`
      const { error } = await supabase.storage.from(BUCKET).upload(ruta, d.fichero)
      if (error) throw error
    }
    const esImagen = d.fichero?.type.startsWith('image/') ?? false
    const { data: pieza, error: errorPieza } = await supabase
      .from('contenido_piezas')
      .insert({
        tipo: 'historia',
        titulo: d.titulo.trim(),
        slug,
        texto_post: d.texto.trim(),
        fichero_path: ruta,
        fichero_nombre: d.fichero?.name ?? null,
        fichero_bytes: d.fichero?.size ?? null,
        fichero_mime: d.fichero?.type || null,
        // Una foto es su propia portada
        vistas: esImagen && ruta ? [ruta] : [],
        creado_por: d.usuarioId,
      })
      .select('id')
      .single()
    if (errorPieza || !pieza) {
      if (ruta) await supabase.storage.from(BUCKET).remove([ruta])
      toast.error(porQueFalla(errorPieza))
      return false
    }
    const { error: errorEncargo } = await supabase
      .from('contenido_calendario')
      .insert({ fecha: d.fecha, pieza_id: (pieza as { id: string }).id, responsable_id: d.responsableId, creado_por: d.usuarioId })
    if (errorEncargo) {
      await supabase.from('contenido_piezas').delete().eq('id', (pieza as { id: string }).id)
      if (ruta) await supabase.storage.from(BUCKET).remove([ruta])
      toast.error('No se pudo programar la historia')
      return false
    }
    return true
  } catch (e) {
    console.error(e)
    if (ruta) await supabase.storage.from(BUCKET).remove([ruta]).catch(() => undefined)
    toast.error('No se pudo subir el fichero de la historia')
    return false
  }
}

/** Cambia el título y el texto de una historia (y su foto o vídeo, si se elige otro) */
export async function editarHistoria(
  piezaId: string,
  d: { titulo: string; texto: string; fichero: File | null; ficheroAnterior: string | null }
): Promise<boolean> {
  const supabase = createClient()
  let ruta: string | null = null
  try {
    const cambios: Record<string, unknown> = { titulo: d.titulo.trim(), texto_post: d.texto.trim() }
    if (d.fichero) {
      ruta = `historias/${piezaId}/${Date.now()}-${nombreSeguro(d.fichero.name)}`
      const { error } = await supabase.storage.from(BUCKET).upload(ruta, d.fichero)
      if (error) throw error
      Object.assign(cambios, {
        fichero_path: ruta,
        fichero_nombre: d.fichero.name,
        fichero_bytes: d.fichero.size,
        fichero_mime: d.fichero.type || null,
        vistas: d.fichero.type.startsWith('image/') ? [ruta] : [],
      })
    }
    const { error } = await supabase.from('contenido_piezas').update(cambios).eq('id', piezaId)
    if (error) {
      if (ruta) await supabase.storage.from(BUCKET).remove([ruta])
      toast.error(porQueFalla(error))
      return false
    }
    if (ruta && d.ficheroAnterior) await supabase.storage.from(BUCKET).remove([d.ficheroAnterior]).catch(() => undefined)
    toast.success('Historia guardada')
    return true
  } catch (e) {
    console.error(e)
    toast.error('No se pudo subir el fichero de la historia')
    return false
  }
}

/**
 * Quita una historia del todo: la pieza (y con ella su encargo) y su fichero. A diferencia de un vídeo, una historia no se reutiliza, así que
 * no tiene sentido dejarla en la lista de piezas sin día.
 */
export async function quitarHistoria(piezaId: string, ficheroPath: string | null): Promise<boolean> {
  const supabase = createClient()
  const { error } = await supabase.from('contenido_piezas').delete().eq('id', piezaId)
  if (error) {
    toast.error('No se pudo quitar la historia')
    return false
  }
  if (ficheroPath) await supabase.storage.from(BUCKET).remove([ficheroPath]).catch(() => undefined)
  toast.success('Historia quitada')
  return true
}
