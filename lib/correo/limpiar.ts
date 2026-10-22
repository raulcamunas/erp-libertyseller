import sanitizeHtml from 'sanitize-html'

/**
 * LIMPIAR EL HTML QUE LLEGA DE FUERA — SOLO SERVIDOR.
 * ===================================================
 * Un correo es HTML escrito por un desconocido que se va a enseñar dentro del ERP. Antes de guardarlo se limpia
 * con una lista de lo PERMITIDO (no con una de lo prohibido): lo que no esté en la lista, no pasa.
 *
 *   · Fuera: scripts, formularios, marcos, objetos, SVG, vídeo, audio, metaetiquetas, enlaces a hojas de estilo,
 *     manejadores como onclick/onerror y cualquier URL que no sea http, https, mailto o tel.
 *   · Se quedan las etiquetas de maquetar un correo (tablas, párrafos, listas, tipografía, imágenes, citas) y los
 *     estilos en línea de toda la vida, pero solo las propiedades de aspecto, sin url() ni expresiones.
 *   · Los enlaces abren en una pestaña nueva, sin pasar quién los abrió.
 *   · Las imágenes que van DENTRO del correo (cid:) se sustituyen por su contenido (data:) cuando caben; las
 *     demás se quitan. Las de fuera se conservan, pero el visor no las carga hasta que la persona lo pide.
 *   · Las imágenes de 1×1 píxel (las de seguimiento) se quitan.
 *
 * Esto NO es la única defensa: el visor lo enseña en un iframe sin scripts ni mismo origen y con su propia política
 * de contenido (ver documentoDeCorreo en html.ts). Son capas, y cada una funciona aunque la otra falle.
 */

/** Más de esto de HTML no se limpia: es un boletín enorme y se quedaría el texto */
export const MAX_HTML_ENTRADA = 1_500_000
/** Lo que se guarda de HTML ya limpio. Más grande, se descarta y se queda el texto */
export const MAX_HTML_GUARDADO = 400_000

const ETIQUETAS = [
  'a', 'abbr', 'address', 'article', 'aside', 'b', 'bdi', 'bdo', 'big', 'blockquote', 'br', 'caption', 'center', 'cite', 'code',
  'col', 'colgroup', 'dd', 'del', 'details', 'dfn', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'font', 'footer', 'h1', 'h2',
  'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'main', 'mark', 'nav', 'ol', 'p', 'pre', 'q', 's', 'samp',
  'section', 'small', 'span', 'strike', 'strong', 'style', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead',
  'time', 'tr', 'tt', 'u', 'ul', 'var', 'wbr',
]

const GENERALES = ['class', 'id', 'dir', 'lang', 'title', 'style', 'align', 'valign', 'bgcolor', 'width', 'height']

/** Un valor de estilo vale si no trae nada que cargue o ejecute algo */
const VALOR_SEGURO = /^(?![\s\S]*(?:url\s*\(|expression\s*\(|javascript:|@import|behavior|binding|\\))[\s\S]{0,400}$/i

const PROPIEDADES_DE_ESTILO = [
  'color', 'background', 'background-color', 'font', 'font-family', 'font-size', 'font-style', 'font-weight', 'line-height',
  'letter-spacing', 'text-align', 'text-decoration', 'text-indent', 'text-transform', 'vertical-align', 'white-space',
  'word-break', 'overflow-wrap', 'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'border', 'border-top', 'border-right', 'border-bottom',
  'border-left', 'border-color', 'border-style', 'border-width', 'border-collapse', 'border-spacing', 'border-radius',
  'width', 'max-width', 'min-width', 'height', 'max-height', 'min-height', 'display', 'list-style', 'list-style-type',
  'table-layout', 'float', 'clear',
]

const ESTILOS_PERMITIDOS: Record<string, Record<string, RegExp[]>> = {
  '*': Object.fromEntries(PROPIEDADES_DE_ESTILO.map((p) => [p, [VALOR_SEGURO]])),
}

const IMAGEN_EN_LINEA = /^data:image\/(?:png|jpe?g|gif|webp|bmp);base64,[a-z0-9+/=\s]+$/i

/** Lo que cabe de imágenes incrustadas en un correo */
export const MAX_IMAGEN_INCRUSTADA = 400_000
export const MAX_IMAGENES_INCRUSTADAS_TOTAL = 1_500_000

export interface OpcionesDeLimpieza {
  /** Las imágenes del propio correo, por su Content-ID (sin < >), ya convertidas a data: */
  imagenesPorCid?: Map<string, string>
}

const esUnPixel = (v: string | undefined): boolean => v !== undefined && /^\s*[01](?:px)?\s*$/.test(v)

/** Un enlace aceptable: web, correo, teléfono o un ancla del propio correo. Un enlace relativo apuntaría a nuestro ERP */
const ENLACE_ACEPTABLE = /^\s*(?:https?:|mailto:|tel:|#)/i
/** Una imagen aceptable: de la web o incrustada. Una imagen relativa pediría algo a nuestro ERP con la sesión de quien lee */
const IMAGEN_ACEPTABLE = /^\s*(?:https?:\/\/|data:image\/)/i

/** Quita de una hoja de estilos lo que carga o ejecuta algo */
function limpiarCss(css: string): string {
  return css
    .replace(/@import[^;]*;?/gi, '')
    // Un url() solo vale si es de la web o una imagen incrustada: uno relativo pediría algo a nuestro ERP
    .replace(/url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi, (todo, _comilla: string, destino: string) => (IMAGEN_ACEPTABLE.test(destino) ? todo : 'none'))
    .replace(/expression\s*\([^)]*\)/gi, '')
    .replace(/behavior\s*:[^;}]*/gi, '')
    .replace(/-moz-binding\s*:[^;}]*/gi, '')
    .replace(/javascript:/gi, '')
}

/**
 * El HTML de un correo, limpio. null si no hay nada que enseñar o si no cabe (en ese caso el correo se enseña con su texto).
 */
export function limpiarHtml(html: string, opciones: OpcionesDeLimpieza = {}): string | null {
  if (!html || html.length > MAX_HTML_ENTRADA) return null
  const cids = opciones.imagenesPorCid ?? new Map<string, string>()

  const limpio = sanitizeHtml(html, {
    allowedTags: ETIQUETAS,
    allowVulnerableTags: true,
    allowedAttributes: {
      '*': GENERALES,
      a: ['href', 'name', 'target', 'rel', ...GENERALES],
      img: ['src', 'alt', 'title', 'width', 'height', 'align', 'border', 'referrerpolicy', ...GENERALES],
      td: ['colspan', 'rowspan', ...GENERALES],
      th: ['colspan', 'rowspan', ...GENERALES],
      table: ['border', 'cellpadding', 'cellspacing', ...GENERALES],
      col: ['span', ...GENERALES],
      colgroup: ['span', ...GENERALES],
      font: ['color', 'face', 'size', ...GENERALES],
      ol: ['start', 'type', ...GENERALES],
      li: ['value', ...GENERALES],
    },
    allowedStyles: ESTILOS_PERMITIDOS,
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['http', 'https', 'data'] },
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    parser: { lowerCaseTags: true, lowerCaseAttributeNames: true },
    transformTags: {
      a: (_nombre, atributos) => {
        const salida: Record<string, string> = { ...atributos, target: '_blank', rel: 'noopener noreferrer nofollow' }
        if (salida.href !== undefined && !ENLACE_ACEPTABLE.test(salida.href)) delete salida.href
        return { tagName: 'a', attribs: salida }
      },
      img: (_nombre, atributos) => {
        const salida: Record<string, string> = { ...atributos, referrerpolicy: 'no-referrer' }
        const origen = (atributos.src ?? '').trim()
        if (/^cid:/i.test(origen)) {
          const cid = origen.slice(4).replace(/^<|>$/g, '').trim().toLowerCase()
          const dentro = cids.get(cid)
          if (dentro) salida.src = dentro
          else delete salida.src
        } else if (/^data:/i.test(origen)) {
          if (!IMAGEN_EN_LINEA.test(origen) || origen.length > MAX_IMAGEN_INCRUSTADA * 1.4) delete salida.src
        } else if (!IMAGEN_ACEPTABLE.test(origen)) {
          delete salida.src
        }
        return { tagName: 'img', attribs: salida }
      },
    },
    // Una imagen sin dirección no enseña nada, y una de un píxel es una baliza de seguimiento
    exclusiveFilter: (marco) => {
      if (marco.tag !== 'img') return false
      if (!marco.attribs.src) return true
      return esUnPixel(marco.attribs.width) && esUnPixel(marco.attribs.height)
    },
  })
    // sanitize-html deja pasar el contenido de <style> tal cual (no lo trata como texto): se limpia aquí. Dentro de un
    // <style> no puede haber otro `</style>`, así que el patrón no se puede saltar
    .replace(/<style>([\s\S]*?)<\/style>/gi, (_todo, css: string) => `<style>${limpiarCss(css)}</style>`)
    .trim()

  if (!limpio || limpio.length > MAX_HTML_GUARDADO) return null
  return limpio
}
