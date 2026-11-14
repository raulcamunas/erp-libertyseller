/**
 * LOS ARCHIVOS ADJUNTOS DE UNA TAREA — PURO.
 *
 * Se guardan en el almacén privado `tareas-archivos` (25 MB por archivo) y se piden con un enlace que caduca. NO viajan a Notion: son del ERP.
 * Lo que se acepta se decide por la extensión (lo que dice el navegador del tipo no es de fiar) y se bloquea lo que se ejecuta.
 */

export const MAX_BYTES_ADJUNTO = 25 * 1024 * 1024
export const MAX_ADJUNTOS_POR_TAREA = 50

export type ClaseDeAdjunto = 'imagen' | 'pdf' | 'hoja' | 'documento' | 'presentacion' | 'comprimido' | 'texto' | 'audio' | 'video' | 'otro'

const CLASES: Record<string, ClaseDeAdjunto> = {
  jpg: 'imagen', jpeg: 'imagen', png: 'imagen', gif: 'imagen', webp: 'imagen', svg: 'imagen', heic: 'imagen',
  pdf: 'pdf',
  xls: 'hoja', xlsx: 'hoja', xlsm: 'hoja', csv: 'hoja', ods: 'hoja', tsv: 'hoja',
  doc: 'documento', docx: 'documento', odt: 'documento', rtf: 'documento', pages: 'documento',
  ppt: 'presentacion', pptx: 'presentacion', odp: 'presentacion', key: 'presentacion',
  zip: 'comprimido', rar: 'comprimido', '7z': 'comprimido', gz: 'comprimido',
  txt: 'texto', md: 'texto', json: 'texto', xml: 'texto', log: 'texto',
  mp3: 'audio', wav: 'audio', m4a: 'audio', ogg: 'audio',
  mp4: 'video', mov: 'video', webm: 'video', m4v: 'video',
}

/** Lo que se ejecuta o se instala: no entra, aunque lo pida un administrador */
const PROHIBIDAS = new Set(['exe', 'bat', 'cmd', 'com', 'scr', 'msi', 'dll', 'sh', 'command', 'app', 'jar', 'vbs', 'ps1', 'js', 'mjs', 'html', 'htm', 'php', 'apk', 'dmg', 'pkg'])

export const extensionDe = (nombre: string): string => {
  const i = nombre.lastIndexOf('.')
  return i < 0 ? '' : nombre.slice(i + 1).toLowerCase()
}

export const claseDeAdjunto = (nombre: string): ClaseDeAdjunto => CLASES[extensionDe(nombre)] ?? 'otro'

/** null = vale; si no, el motivo para enseñárselo a quien lo sube */
export function motivoDeRechazo(nombre: string, bytes: number): string | null {
  const ext = extensionDe(nombre)
  if (!nombre.trim()) return 'El archivo no tiene nombre.'
  if (PROHIBIDAS.has(ext)) return `No se pueden subir archivos .${ext}: se ejecutan o se instalan.`
  if (bytes <= 0) return 'El archivo está vacío.'
  if (bytes > MAX_BYTES_ADJUNTO) return `«${nombre}» pesa ${formatoDeTamano(bytes)}; el máximo son ${formatoDeTamano(MAX_BYTES_ADJUNTO)}.`
  return null
}

/** El nombre que se enseña: sin rutas ni caracteres raros y de hasta 140 letras (conserva la extensión) */
export function nombreLimpio(nombre: string): string {
  const base = nombre.split(/[\\/]/).pop() ?? ''
  const limpio = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').replace(/\s+/g, ' ').trim()
  if (limpio.length <= 140) return limpio || 'archivo'
  const ext = extensionDe(limpio)
  return ext ? `${limpio.slice(0, 140 - ext.length - 1)}.${ext}` : limpio.slice(0, 140)
}

/** La ruta dentro del almacén: sin el nombre original (puede tener cualquier cosa), solo una carpeta por tarea y un identificador */
export const rutaDeAdjunto = (tareaId: string, id: string, nombre: string): string => `${tareaId}/${id}${extensionDe(nombre) ? `.${extensionDe(nombre).replace(/[^a-z0-9]/g, '')}` : ''}`

export function formatoDeTamano(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0).replace('.', ',')} MB`
}

export interface AdjuntoTC {
  id: string
  tarea_id: string
  nombre: string
  tipo: string
  tamano: number
  subido_nombre: string
  visible_cliente: boolean
  creado_en: string
  /** Enlace temporal para abrirlo o bajarlo; lo pone el servidor al listar */
  url?: string
}
