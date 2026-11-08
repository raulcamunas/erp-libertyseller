import { claseDeAdjunto, extensionDe, formatoDeTamano, motivoDeRechazo, nombreLimpio, MAX_BYTES_ADJUNTO } from '@/lib/tareas-clientes/adjuntos'

/**
 * LOS ARCHIVOS DE LOS MENSAJES — PURO. Las mismas reglas que los archivos de las tareas (lib/tareas-clientes/adjuntos.ts: lo que se ejecuta no entra, 25 MB como mucho) y la forma de la
 * ruta dentro del almacén privado `chat-archivos`: `<id de quien lo sube>/<identificador>.<extensión>`. Así el servidor sabe, sin preguntar a nadie, que un archivo que viene en un
 * mensaje lo subió quien lo envía.
 */

export { claseDeAdjunto, extensionDe, formatoDeTamano, motivoDeRechazo, nombreLimpio, MAX_BYTES_ADJUNTO }

export const MAX_ARCHIVOS_POR_MENSAJE = 10
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

export const rutaDeArchivo = (usuarioId: string, id: string, nombre: string): string => {
  const ext = extensionDe(nombre).replace(/[^a-z0-9]/g, '')
  return `${usuarioId}/${id}${ext ? `.${ext}` : ''}`
}

/** ¿Es esta ruta de un archivo subido por esta persona? (con esa forma exacta, sin barras de más ni «..») */
export function esRutaDe(ruta: unknown, usuarioId: string): ruta is string {
  return typeof ruta === 'string' && new RegExp(`^${usuarioId}/${UUID}(\\.[a-z0-9]{1,10})?$`, 'i').test(ruta)
}

export const esImagen = (tipo: string, nombre = ''): boolean => /^image\/(jpeg|png|webp|gif)$/i.test(tipo) || (!tipo && ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(extensionDe(nombre)))
