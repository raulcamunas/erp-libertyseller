import { mencionaFacturacion } from '../ia-ejemplos'

/**
 * ¿ES UN BUEN CORREO? — LO QUE SE PUEDE COMPROBAR DEL TEXTO ANTES DE ENVIARLO.
 * ============================================================================
 * PURO: no toca la base ni la red. Se comprueba con contenido.prueba.ts. Sirve igual en el servidor y en el navegador.
 *
 * No es una opinión sobre si el correo convence: es una lista de comprobaciones de lo que hace que un correo acabe en la carpeta de spam o que un
 * destinatario lo marque como tal —mayúsculas y signos de exclamación, palabras de promoción, muchos enlaces o enlaces acortados, un «Re:» falso
 * en el asunto, huecos sin rellenar, demasiado largo o demasiado corto— y que son baratas de evitar. Cada hallazgo resta puntos según lo grave
 * que sea; la nota (0 a 100) y el nivel se enseñan junto al botón de enviar y NUNCA bloquean: la persona decide.
 *
 * Las comprobaciones son sobre todo para correos escritos A MANO. Lo que escribe la IA ya sale revisado (ia-prompt.ts y seguimientos.ts) y casi
 * siempre puntúa 100; que no lo haga es la señal de que algo se ha colado.
 */

export type GravedadDeAviso = 'grave' | 'medio' | 'leve'
export type NivelDeContenido = 'bien' | 'mejorable' | 'arriesgado'

export interface AvisoDeContenido {
  codigo: string
  gravedad: GravedadDeAviso
  texto: string
}

export interface AnalisisDeContenido {
  /** De 0 a 100 */
  puntos: number
  nivel: NivelDeContenido
  avisos: AvisoDeContenido[]
  palabras: number
  enlaces: number
}

export interface EntradaDeContenido {
  asunto: string
  texto: string
  /** El correo es la respuesta a otro: entonces un «Re:» en el asunto es verdad */
  esRespuesta?: boolean
}

const PENALIZACION: Record<GravedadDeAviso, number> = { grave: 30, medio: 15, leve: 5 }

/** Palabras y frases que los filtros de spam (y las personas) asocian a correo basura. Con una sola ya se nota */
const PALABRAS_FUERTES: readonly RegExp[] = [
  /\bgratis\b/i,
  /\b100\s?%\s*(garantizad|gratis|seguro)/i,
  /\bgarantizad[oa]s?\b/i,
  /\bsin\s+riesgo\b/i,
  /\bdinero\s+f[aá]cil\b/i,
  /\bganar\s+dinero\b/i,
  /\bgana\s+dinero\b/i,
  /\boferta\s+limitada\b/i,
  /\b[uú]ltima\s+oportunidad\b/i,
  /\bhaz(?:\s+|\s*)clic\s+aqu[ií]\b/i,
  /\bhaga\s+clic\s+aqu[ií]\b/i,
  /\bclick\s+here\b/i,
  /\bcompra\s+ahora\b/i,
  /\bactúa\s+ya\b/i,
  /\bfelicidades\b/i,
  /\bhas\s+ganado\b/i,
  /\bsorteo\b/i,
  /\bviagra\b/i,
  /\bcasino\b/i,
  /\bpr[eé]stamos?\s+(?:f[aá]cil|r[aá]pido|inmediato)/i,
  /\bcr[eé]dito\s+f[aá]cil\b/i,
  /\bbitcoin\b/i,
  /\bcripto(?:moneda)?s?\b/i,
  /\blimited\s+time\b/i,
  /\bact\s+now\b/i,
]

/** Palabras de promoción: una sola no pasa nada, varias sí */
const PALABRAS_SUAVES: readonly RegExp[] = [/\bdescuentos?\b/i, /\bpromoci[oó]n(?:es)?\b/i, /\bofertas?\b/i, /\bbarat[oa]s?\b/i, /\brebajas?\b/i, /\bchollo\b/i, /\boportunidad [uú]nica\b/i]

const ACORTADORES = /\b(?:bit\.ly|tinyurl\.com|t\.co|goo\.gl|ow\.ly|is\.gd|buff\.ly|rebrand\.ly|cutt\.ly|shorturl\.at|tiny\.cc|rb\.gy)\//i
const ENLACE = /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi
const ENLACE_CON_IP = /https?:\/\/\d{1,3}(?:\.\d{1,3}){3}/i
const SALUDO_GENERICO = /^\s*(?:estimad[oa]s?\s+(?:cliente|se[ñn]or(?:es)?|se[ñn]ora|usuario|empresa)|a\s+quien\s+corresponda|dear\s+(?:sir|customer|friend))/i
const SALUDO = /^\s*(?:hola|buenos|buenas|buen\s+d[ií]a|estimad|querid|hi\b|hello|saludos|muy\s+buenas|qu[eé]\s+tal)/i

export const palabrasDe = (texto: string): number => texto.trim().split(/\s+/).filter(Boolean).length

function proporcionDeMayusculas(texto: string): number {
  const letras = texto.match(/\p{L}/gu) ?? []
  if (letras.length < 6) return 0
  const mayusculas = letras.filter((l) => l === l.toUpperCase() && l !== l.toLowerCase())
  return mayusculas.length / letras.length
}

export function analizarContenido(e: EntradaDeContenido): AnalisisDeContenido {
  const avisos: AvisoDeContenido[] = []
  const aviso = (codigo: string, gravedad: GravedadDeAviso, texto: string) => avisos.push({ codigo, gravedad, texto })

  const asunto = e.asunto.replace(/\s+/g, ' ').trim()
  const texto = e.texto.replace(/\r\n?/g, '\n').trim()
  const palabras = palabrasDe(texto)
  const enlaces = texto.match(ENLACE) ?? []

  /* ---- el asunto ---- */
  if (asunto === '') aviso('asunto_vacio', 'grave', 'El correo no tiene asunto.')
  else {
    if (asunto.length > 120) aviso('asunto_muy_largo', 'medio', 'El asunto es larguísimo: casi nadie lo verá entero.')
    else if (asunto.length > 78) aviso('asunto_largo', 'leve', 'El asunto es largo: en el móvil se corta.')
    if (proporcionDeMayusculas(asunto) >= 0.6) aviso('asunto_en_mayusculas', 'medio', 'El asunto está casi todo en MAYÚSCULAS: los filtros de spam lo penalizan.')
    const exclamaciones = (asunto.match(/!/g) ?? []).length
    if (exclamaciones >= 3) aviso('asunto_con_exclamaciones', 'medio', 'El asunto tiene varios signos de exclamación.')
    else if (exclamaciones >= 1) aviso('asunto_con_exclamacion', 'leve', 'Un signo de exclamación en el asunto resta credibilidad en un correo profesional.')
    if (!e.esRespuesta && /^\s*(?:re|rv|fw|fwd)\s*:/i.test(asunto)) aviso('re_falso', 'grave', 'El asunto empieza por «Re:» o «RV:» y no es una respuesta: parece un engaño y los filtros lo penalizan.')
    if (/[€$]|\d\s*%/.test(asunto)) aviso('asunto_con_dinero', 'medio', 'Cifras, % o monedas en el asunto: suena a promoción.')
    const fuertes = PALABRAS_FUERTES.filter((r) => r.test(asunto)).length
    if (fuertes > 0) aviso('asunto_con_palabras_de_spam', 'medio', 'El asunto lleva palabras típicas de correo basura («gratis», «garantizado»…).')
  }

  /* ---- el cuerpo ---- */
  if (palabras < 5) aviso('texto_vacio', 'grave', 'El texto es casi inexistente.')
  else if (palabras < 15) aviso('texto_muy_corto', 'medio', 'El texto es muy corto: un correo de una frase parece automático.')
  if (palabras > 250) aviso('texto_muy_largo', 'medio', 'El texto es muy largo: un correo en frío se lee en 30 segundos.')
  else if (palabras > 180) aviso('texto_largo', 'leve', 'El texto es algo largo: cuanto más corto, más se lee.')

  if (enlaces.length >= 5) aviso('muchos_enlaces', 'grave', `Lleva ${enlaces.length} enlaces: demasiados para un correo en frío.`)
  else if (enlaces.length >= 3) aviso('varios_enlaces', 'medio', `Lleva ${enlaces.length} enlaces: lo normal en un correo en frío es uno o ninguno.`)
  else if (enlaces.length === 2) aviso('dos_enlaces', 'leve', 'Lleva dos enlaces: con uno basta.')
  if (ACORTADORES.test(texto)) aviso('enlace_acortado', 'grave', 'Hay un enlace acortado (bit.ly y similares): los filtros de spam lo castigan mucho.')
  if (ENLACE_CON_IP.test(texto)) aviso('enlace_con_ip', 'grave', 'Hay un enlace que es una dirección numérica: parece phishing.')

  const palabrasEnMayusculas = (texto.match(/\b\p{Lu}{4,}\b/gu) ?? []).filter((w) => !/^(?:https?|www|html|ppc|acos|tacos|asin|fba|fbm|sku|seo|a\+|iva|nif|cif|sl|sa|slu)$/i.test(w)).length
  if (palabrasEnMayusculas >= 3) aviso('mayusculas', 'medio', 'Hay varias palabras en MAYÚSCULAS: suena a grito y a spam.')

  const exclamaciones = (texto.match(/!/g) ?? []).length
  if (exclamaciones >= 6) aviso('muchas_exclamaciones', 'grave', 'Hay muchísimos signos de exclamación.')
  else if (exclamaciones >= 3) aviso('exclamaciones', 'medio', 'Hay varios signos de exclamación: en un correo profesional sobran.')
  if (/[?!]{3,}|\${2,}|\.{5,}/.test(texto)) aviso('puntuacion_repetida', 'leve', 'Hay signos repetidos («???», «$$$», «.....»).')

  const fuertes = PALABRAS_FUERTES.filter((r) => r.test(texto)).length
  if (fuertes > 0) aviso('palabras_de_spam', fuertes >= 2 ? 'grave' : 'medio', `Lleva ${fuertes === 1 ? 'una palabra típica' : 'palabras típicas'} de correo basura («gratis», «garantizado», «última oportunidad»…).`)
  const suaves = PALABRAS_SUAVES.filter((r) => r.test(texto)).length
  if (suaves >= 2) aviso('palabras_de_promocion', 'leve', 'Suena a promoción comercial («oferta», «descuento»…): en un primer contacto convence más hablar de su negocio.')

  if (mencionaFacturacion(texto)) aviso('dinero', 'medio', 'Habla de dinero o de facturación: la regla del equipo es no mencionarlo en los correos.')
  if (/\{\{|\[[^\]\n]{1,60}\]|<[\p{L} ]{2,30}>/u.test(`${asunto}\n${texto}`)) aviso('hueco', 'grave', 'Deja un hueco sin rellenar ([…], {{…}} o <…>).')
  if (/<\s*(?:div|table|img|span|font|br|p)\b/i.test(texto)) aviso('html_en_texto', 'medio', 'Lleva etiquetas HTML escritas a mano: se verán tal cual.')

  if (palabras >= 5 && SALUDO_GENERICO.test(texto)) aviso('saludo_generico', 'leve', 'El saludo es genérico («Estimado cliente»…): un «Hola,» a secas resulta más cercano.')
  else if (palabras >= 15 && !SALUDO.test(texto)) aviso('sin_saludo', 'leve', 'No empieza con un saludo.')

  const puntos = Math.max(0, 100 - avisos.reduce((s, a) => s + PENALIZACION[a.gravedad], 0))
  const nivel: NivelDeContenido = puntos >= 80 ? 'bien' : puntos >= 55 ? 'mejorable' : 'arriesgado'
  return { puntos, nivel, avisos, palabras, enlaces: enlaces.length }
}
