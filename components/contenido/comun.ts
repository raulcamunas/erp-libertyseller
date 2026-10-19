import { createClient } from '@/lib/supabase/client'
import { FileText, Film } from 'lucide-react'
import type { ContenidoPieza, TipoPieza } from '@/lib/types/contenido'

/**
 * LO QUE COMPARTEN LAS TRES VISTAS DEL CALENDARIO DE CONTENIDO (semana, agenda y
 * detalle de un día): de dónde salen las imágenes, cómo se escribe un nombre en una
 * celda y qué icono lleva cada tipo de pieza.
 */

export const BUCKET = 'contenido'

export type Perfil = { id: string; full_name: string | null; email: string | null; role?: string }

/** «Raúl Camuñas» → «Raúl». En una celda de calendario no cabe el apellido. */
export const nombreCorto = (p: { full_name: string | null; email: string | null }) =>
  (p.full_name ?? p.email ?? '—').split(' ')[0]

export const urlPublica = (path: string | null) => {
  if (!path) return null
  return createClient().storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}

export const ICONO_TIPO: Record<TipoPieza, typeof Film> = { video: Film, carrusel: FileText }

/** La primera imagen de la pieza: la lámina 1 de un carrusel, o el fotograma de
 *  portada de un vídeo. Null si todavía no se subieron (piezas de antes de la
 *  migración 218). */
export const portada = (p: ContenidoPieza) => (p.vistas?.length ? urlPublica(p.vistas[0]) : null)

/** El nombre del fichero de una imagen, sin la carpeta: «lamina-3.png» */
export const nombreDeVista = (ruta: string) => ruta.split('/').pop() ?? ruta
