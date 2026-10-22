/**
 * EL TEXTO Y EL HTML DE LOS CORREOS: ESCRIBIR, CITAR Y ENSEÑAR.
 * =============================================================
 * PURO y SIN DEPENDENCIAS: lo importan tanto el servidor como el navegador. La limpieza del HTML que llega de
 * fuera (que sí lleva una librería) está aparte, en limpiar.ts, para que no viaje al navegador.
 * Se comprueba con html.prueba.ts.
 */

export function escaparHtml(texto: string): string {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** Un enlace que acaba en punto, coma o paréntesis de cierre no lo lleva dentro: es de la frase */
const URL_EN_TEXTO = /\bhttps?:\/\/[^\s<>"']+/gi

/** Convierte las URL de un texto ya escapado en enlaces */
function enlazar(escapado: string): string {
  return escapado.replace(URL_EN_TEXTO, (url) => {
    let enlace = url
    let resto = ''
    while (/[.,;:!?)\]]$/.test(enlace)) {
      // Un paréntesis de cierre es del enlace si dentro hay uno de apertura (wikipedia.org/wiki/X_(y))
      if (enlace.endsWith(')') && enlace.includes('(')) break
      resto = enlace.slice(-1) + resto
      enlace = enlace.slice(0, -1)
    }
    return `<a href="${enlace}" target="_blank" rel="noopener noreferrer">${enlace}</a>${resto}`
  })
}

/**
 * El HTML con el que sale un correo escrito como texto: párrafos con los saltos de línea de lo escrito y los
 * enlaces pulsables. Tipografía normal de correo, nada de lo que se pueda notar que viene de un programa.
 */
export function textoAHtml(texto: string): string {
  const cuerpo = enlazar(escaparHtml(texto.replace(/\r\n?/g, '\n'))).replace(/\n/g, '<br>')
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;color:#222222">${cuerpo}</div>`
}

/** Cada línea con «> » delante, que es como se cita un texto */
export function citarTexto(texto: string): string {
  return texto
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => (l ? `> ${l}` : '>'))
    .join('\n')
}

const FORMATO_DE_CITA = new Intl.DateTimeFormat('es-ES', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Madrid' })

/** «El 21 de octubre de 2026, 10:15, Ana López <ana@x.es> escribió:» */
export function encabezadoDeCita(fecha: Date, quien: string): string {
  return `El ${FORMATO_DE_CITA.format(fecha)}, ${quien} escribió:`
}

/** El HTML de un correo que contesta: lo escrito, y debajo lo citado en un bloque con su raya al margen */
export function htmlDeRespuesta(cuerpo: string, cita?: { encabezado: string; texto: string }): string {
  const nuestro = textoAHtml(cuerpo)
  if (!cita) return nuestro
  const citado = escaparHtml(cita.texto.replace(/\r\n?/g, '\n')).replace(/\n/g, '<br>')
  return (
    `${nuestro}<br><div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#555555">${escaparHtml(cita.encabezado)}</div>` +
    `<blockquote style="margin:6px 0 0 4px;padding:0 0 0 10px;border-left:2px solid #cccccc;color:#555555;font-family:Arial,Helvetica,sans-serif;font-size:13px">${citado}</blockquote>`
  )
}

/** El texto plano de un correo que contesta: lo escrito y debajo lo citado con «> » */
export function textoDeRespuesta(cuerpo: string, cita?: { encabezado: string; texto: string }): string {
  if (!cita) return cuerpo
  return `${cuerpo}\n\n${cita.encabezado}\n${citarTexto(cita.texto)}`
}

/** Líneas que son el encabezado de una cita («El … escribió:», «On … wrote:») y no el mensaje */
const ES_ENCABEZADO_DE_CITA = /^(?:el .{5,200}escribi[óo]:?|on .{5,200}wrote:?|le .{5,200}a [ée]crit ?:?|am .{5,200}schrieb.*:?|-{2,} ?(?:original message|mensaje original|forwarded message|mensaje reenviado) ?-{2,}.*|de:\s.*|from:\s.*)$/i

/**
 * Un trozo del correo para la lista: sin lo citado, sin saltos de línea y con tope. Lo citado (líneas con «>») y su
 * encabezado no dicen nada nuevo; si el correo es SOLO una cita, se enseña la cita antes que nada.
 */
export function vistaPrevia(texto: string, maximo = 160): string {
  const lineas = texto.replace(/\r\n?/g, '\n').split('\n')
  const propias: string[] = []
  for (const l of lineas) {
    const t = l.trim()
    if (!t) continue
    if (t.startsWith('>')) continue
    if (ES_ENCABEZADO_DE_CITA.test(t)) break
    propias.push(t)
  }
  const base = (propias.length > 0 ? propias : lineas.map((l) => l.replace(/^[>\s]+/, '').trim()).filter(Boolean)).join(' ')
  const limpio = base.replace(/\s+/g, ' ').trim()
  return limpio.length <= maximo ? limpio : `${limpio.slice(0, maximo - 1).trimEnd()}…`
}

/** Convierte un HTML en texto a la fuerza bruta: solo para cuando el correo no trae parte de texto y la librería no lo dio */
export function htmlATextoBasico(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|h[1-6]|blockquote|tr|table)>/gi, '\n\n')
    .replace(/<br\s*\/?>|<\/(div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * El documento que va dentro del iframe de un correo.
 *
 * El HTML que llega aquí YA está limpio (limpiar.ts), pero se enseña además con tres cierres más, por si alguno
 * fallara: el iframe va sin permiso de scripts ni de mismo origen (lo pone quien lo pinta), y este documento
 * lleva su propia política de contenido:
 *
 *   · sin scripts, sin formularios, sin marcos y sin ninguna conexión;
 *   · imágenes solo las que vienen dentro del propio correo (data:), salvo que la persona pida las de fuera.
 *     Una imagen de fuera avisa a quien envía de que se ha abierto el correo, desde dónde y cuándo: por defecto no
 *     se carga ninguna.
 *
 * Los correos están hechos para fondo blanco, así que se enseñan sobre blanco también en el tema oscuro.
 */
export function documentoDeCorreo(contenidoHtml: string, opciones: { imagenesDeFuera: boolean }): string {
  const imagenes = opciones.imagenesDeFuera ? "img-src data: https: http:" : 'img-src data:'
  const politica = `default-src 'none'; ${imagenes}; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'`
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${politica}">` +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<style>html,body{margin:0;padding:0;background:#ffffff;color:#222222}' +
    'body{padding:12px 14px;font:14px/1.5 Arial,Helvetica,sans-serif;overflow-wrap:anywhere;word-break:break-word}' +
    'img{max-width:100%;height:auto}table{max-width:100%}a{color:#1a56c4}' +
    'blockquote{margin:6px 0 6px 4px;padding:0 0 0 10px;border-left:2px solid #cccccc;color:#555555}' +
    'pre{white-space:pre-wrap;font:inherit;margin:0}</style>' +
    `</head><body>${contenidoHtml}</body></html>`
  )
}

/** El documento de un correo que solo trae texto: el texto, respetando saltos de línea y con sus enlaces */
export function documentoDeTexto(texto: string, opciones: { imagenesDeFuera: boolean }): string {
  return documentoDeCorreo(`<div style="white-space:normal">${enlazar(escaparHtml(texto)).replace(/\r\n?|\n/g, '<br>')}</div>`, opciones)
}
