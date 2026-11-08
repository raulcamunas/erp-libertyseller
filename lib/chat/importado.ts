/**
 * LO QUE TRAE UN MENSAJE IMPORTADO DE SLACK, PARA PINTARLO BIEN — PURO. El importador deja los archivos como líneas «📎 nombre (archivo de Slack, no importado)» y los avisos de «se ha unido al canal»
 * como mensajes sueltos. Aquí se separan para que la pantalla los enseñe como etiquetas discretas y como una línea de aviso, no como texto de verdad. Se comprueba en importado.prueba.ts.
 */

export interface ArchivoDeSlack {
  /** El nombre tal cual venía (suele ser una cifra larga) */
  nombre: string
  /** Lo que es, para enseñarlo en vez del nombre */
  tipo: 'imagen' | 'pdf' | 'audio' | 'video' | 'hoja' | 'archivo'
  /** La extensión en mayúsculas, si tiene */
  extension: string
}

const LINEA_DE_ARCHIVO = /^📎 (.+?) \(archivo de Slack, no importado\)\s*$/
const IMAGENES = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'svg'])
const AUDIOS = new Set(['mp3', 'm4a', 'wav', 'ogg', 'aac'])
const VIDEOS = new Set(['mp4', 'mov', 'webm', 'avi', 'mkv'])
const HOJAS = new Set(['xlsx', 'xls', 'csv'])

export function archivoDeSlack(nombre: string): ArchivoDeSlack {
  const punto = nombre.lastIndexOf('.')
  const ext = punto > 0 ? nombre.slice(punto + 1).toLowerCase() : ''
  const tipo = IMAGENES.has(ext) ? 'imagen' : ext === 'pdf' ? 'pdf' : AUDIOS.has(ext) ? 'audio' : VIDEOS.has(ext) ? 'video' : HOJAS.has(ext) ? 'hoja' : 'archivo'
  return { nombre, tipo, extension: ext.toUpperCase() }
}

/** El texto sin las líneas de archivos, y los archivos aparte */
export function separarArchivosDeSlack(cuerpo: string): { texto: string; archivos: ArchivoDeSlack[] } {
  const archivos: ArchivoDeSlack[] = []
  const lineas = cuerpo.split('\n').filter((l) => {
    const m = LINEA_DE_ARCHIVO.exec(l)
    if (m) archivos.push(archivoDeSlack(m[1]))
    return !m
  })
  return { texto: lineas.join('\n').trim(), archivos }
}

/** «@Ana se ha unido al canal»: lo escribe Slack cuando alguien entra, no es un mensaje de la persona */
export function esAvisoDeUnion(cuerpo: string): boolean {
  return /^@?[^\n]{1,80} (se ha unido|ha abandonado|se ha ido de)l? ?(al |del |a la |de la )?(canal|grupo|conversación)\.?$/i.test(cuerpo.trim())
}
