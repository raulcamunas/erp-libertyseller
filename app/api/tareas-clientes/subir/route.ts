import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { conPermiso } from '@/lib/tareas-clientes/rutas'
import { ErrorDeTareas } from '@/lib/tareas-clientes/servidor'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const TIPOS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }
const MAX_BYTES = 10 * 1024 * 1024

/**
 * Sube una imagen para una portada o un fondo. El tipo se decide por lo que dice el navegador Y se comprueba contra la cabecera del fichero (un .png que no lo es se
 * rechaza). Va a un almacén público con un nombre que no se puede adivinar; devuelve la dirección.
 */
export async function POST(request: NextRequest) {
  const formulario = await request.formData().catch(() => null)
  return conPermiso(async (p) => {
    const fichero = formulario?.get('fichero')
    if (!(fichero instanceof File)) throw new ErrorDeTareas('Falta la imagen.')
    const extension = TIPOS[fichero.type]
    if (!extension) throw new ErrorDeTareas('Solo se pueden subir imágenes JPG, PNG, WebP o GIF.')
    if (fichero.size > MAX_BYTES) throw new ErrorDeTareas('La imagen pesa más de 10 MB.')
    const bytes = new Uint8Array(await fichero.arrayBuffer())
    const cabecera = Array.from(bytes.slice(0, 12))
    const esReal =
      (extension === 'jpg' && cabecera[0] === 0xff && cabecera[1] === 0xd8) ||
      (extension === 'png' && cabecera[0] === 0x89 && cabecera[1] === 0x50) ||
      (extension === 'gif' && cabecera[0] === 0x47 && cabecera[1] === 0x49) ||
      (extension === 'webp' && cabecera[0] === 0x52 && cabecera[8] === 0x57)
    if (!esReal) throw new ErrorDeTareas('El fichero no es una imagen válida.')

    const service = createServiceClient()
    const ruta = `${p.userId}/${crypto.randomUUID()}.${extension}`
    const { error } = await service.storage.from('tareas-portadas').upload(ruta, bytes, { contentType: fichero.type, upsert: false })
    if (error) throw new ErrorDeTareas(`No se ha podido subir la imagen: ${error.message}`, 500)
    return { url: service.storage.from('tareas-portadas').getPublicUrl(ruta).data.publicUrl }
  }, 201)
}
