import { createServiceClient } from '@/lib/supabase/service'
import { esUrlDeNotion, type Bloque } from '../bloques'

/**
 * LAS IMÁGENES DE NOTION SE COPIAN A NUESTRO ALMACÉN. Una imagen que sube alguien a Notion se sirve con una dirección firmada que caduca a la hora: guardada tal cual, a la
 * hora se ve rota. Aquí se descarga y se sube al almacén público de las tareas, y el bloque se queda con la dirección nuestra (que no caduca). Si algo falla (la imagen no se
 * descarga, no es de un tipo que se acepte, pesa demasiado), el bloque se deja como está: se ve mientras dure la dirección y se vuelve a intentar en la próxima lectura.
 */

const TIPOS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }
const MAX_BYTES = 10 * 1024 * 1024
const BUCKET = 'tareas-portadas'

async function copiar(url: string, ruta: string): Promise<string | null> {
  const control = new AbortController()
  const reloj = setTimeout(() => control.abort(), 20_000)
  try {
    const r = await fetch(url, { signal: control.signal })
    if (!r.ok) return null
    const tipo = (r.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    const extension = TIPOS[tipo]
    if (!extension) return null
    const bytes = new Uint8Array(await r.arrayBuffer())
    if (bytes.length === 0 || bytes.length > MAX_BYTES) return null
    const service = createServiceClient()
    const destino = `${ruta}.${extension}`
    const { error } = await service.storage.from(BUCKET).upload(destino, bytes, { contentType: tipo, upsert: true })
    if (error) return null
    return service.storage.from(BUCKET).getPublicUrl(destino).data.publicUrl
  } catch {
    return null
  } finally {
    clearTimeout(reloj)
  }
}

/** Devuelve los bloques con las imágenes de Notion ya copiadas. Cuántas se han copiado en `copiadas` */
export async function rehospedarImagenes(bloques: Bloque[], tareaId: string): Promise<{ bloques: Bloque[]; copiadas: number }> {
  let copiadas = 0
  const salida: Bloque[] = []
  for (const b of bloques) {
    if (b.tipo === 'imagen' && esUrlDeNotion(b.url)) {
      const nueva = await copiar(b.url as string, `notion/${tareaId}/${b.notion_id ?? b.id}`)
      if (nueva) {
        copiadas += 1
        salida.push({ ...b, url: nueva })
        continue
      }
    }
    salida.push(b)
  }
  return { bloques: salida, copiadas }
}
