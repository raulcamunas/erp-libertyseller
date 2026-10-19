/**
 * LAS REDES DONDE SE PUBLICA UNA PIEZA, Y LO QUE CADA UNA ADMITE.
 * PURO: sin React ni base de datos. Se prueba en redes.prueba.ts.
 *
 * El plan nació para LinkedIn (el texto del post vive en `contenido_piezas.texto_post`),
 * pero un VÍDEO se sube además a Instagram, TikTok y Facebook, y cada red pide su
 * propio texto: más corto en TikTok, con pocos hashtags en Instagram, con un salto
 * de línea más en Facebook. Esos textos viven en `contenido_textos` (migración 229).
 *
 *
 * ============ LOS LÍMITES SON ORIENTATIVOS ============
 *
 * Ninguna de estas redes publica un límite que no cambie. Los de aquí son los
 * prudentes de octubre de 2026 y sirven para AVISAR, no para impedir nada:
 *
 *   · LinkedIn: 3.000 caracteres.
 *   · Instagram: 2.200 en el pie, y como mucho 5 hashtags (la red los limita desde
 *     diciembre de 2025; las guías lo dan por hecho pero no es un dato de Meta que
 *     se haya comprobado aquí).
 *   · TikTok: 2.200. La app admite hasta 4.000 según algunas fuentes, pero las
 *     herramientas de programación se quedan en 2.200: se avisa por el más bajo.
 *   · Facebook: 2.200 para Reels.
 *
 * Se cuentan CARACTERES, no unidades UTF-16: un emoji cuenta como uno, que es como
 * lo cuentan las redes, y `.length` de JavaScript lo contaría como dos.
 */

export const REDES = ['linkedin', 'instagram', 'tiktok', 'facebook'] as const
export type Red = (typeof REDES)[number]

export interface InfoRed {
  nombre: string
  corto: string
  /** Caracteres máximos del texto publicado, hashtags incluidos */
  limite: number
  /** Cuántos hashtags admite o se recomiendan; null = sin tope */
  maxHashtags: number | null
  /** true = la red lo impone; false = solo es una recomendación */
  hashtagsDuros: boolean
  /** Lo que se le dice a quien edita ese texto */
  ayuda: string
}

export const INFO_RED: Record<Red, InfoRed> = {
  linkedin: {
    nombre: 'LinkedIn',
    corto: 'LI',
    limite: 3000,
    maxHashtags: null,
    hashtagsDuros: false,
    ayuda: 'El texto del post de LinkedIn.',
  },
  instagram: {
    nombre: 'Instagram',
    corto: 'IG',
    limite: 2200,
    maxHashtags: 5,
    hashtagsDuros: true,
    ayuda: 'El pie del Reel. Solo se ve la primera línea antes de «más»: que sea el gancho. Máximo 5 hashtags.',
  },
  tiktok: {
    nombre: 'TikTok',
    corto: 'TT',
    limite: 2200,
    maxHashtags: 5,
    hashtagsDuros: false,
    ayuda: 'Corto y con las palabras que la gente busca. Se ven unos 80-100 caracteres antes de «más». De 3 a 5 hashtags.',
  },
  facebook: {
    nombre: 'Facebook',
    corto: 'FB',
    limite: 2200,
    maxHashtags: 3,
    hashtagsDuros: false,
    ayuda: 'Se puede explicar más que en las otras. Los hashtags pesan poco: con dos o tres basta.',
  },
}

/** Dónde se publica cada tipo de pieza: un vídeo, en las cuatro; un carrusel, en LinkedIn */
export function redesEsperadas(tipo: 'video' | 'carrusel'): readonly Red[] {
  return tipo === 'video' ? REDES : ['linkedin']
}

/** Caracteres de un texto, contando cada emoji como uno */
export function caracteres(texto: string): number {
  return Array.from(texto).length
}

/**
 * Lo que de verdad se pega en la red: el texto y, debajo, los hashtags.
 * Los hashtags cuentan para el límite, por eso la longitud se mide sobre esto.
 */
export function componer(texto: string, hashtags: readonly string[]): string {
  const base = texto.replace(/\s+$/, '')
  return hashtags.length > 0 ? `${base}\n\n${hashtags.join(' ')}` : base
}

/**
 * De lo que se teclea («amazonfba, #Ecommerce  #amazonfba») a una lista limpia.
 * Se pone la almohadilla donde falta, se quita lo que no es letra, número o guion
 * bajo y se descartan los repetidos sin distinguir mayúsculas (queda el primero).
 */
export function normalizarHashtags(entrada: string | readonly string[]): string[] {
  const trozos = typeof entrada === 'string' ? entrada.split(/[\s,;]+/) : [...entrada]
  const vistos = new Set<string>()
  const salida: string[] = []
  for (const t of trozos) {
    const limpio = t.replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '')
    if (limpio === '') continue
    const clave = limpio.toLowerCase()
    if (vistos.has(clave)) continue
    vistos.add(clave)
    salida.push(`#${limpio}`)
  }
  return salida
}

/**
 * Cuántos hashtags lleva lo que se publica: los de la lista MÁS los que el propio texto
 * trae escritos dentro (el de LinkedIn los lleva al final del texto, no en una lista).
 * Cuentan una vez aunque se repitan. «#1», «C#» o el «#top» de una dirección no son
 * hashtags: tiene que haber una letra y no pegarse a otra palabra.
 */
export function contarHashtags(texto: string, hashtags: readonly string[] = []): number {
  const vistos = new Set(normalizarHashtags(hashtags).map((h) => h.toLowerCase()))
  for (const m of texto.matchAll(/(^|[^\p{L}\p{N}_&/])#([\p{L}\p{N}_]+)/gu)) {
    if (/\p{L}/u.test(m[2])) vistos.add(`#${m[2].toLowerCase()}`)
  }
  return vistos.size
}

export type NivelLongitud = 'ok' | 'cerca' | 'pasa'

/** ok hasta el 90 %; cerca hasta el límite; pasa al superarlo */
export function nivelLongitud(n: number, limite: number): NivelLongitud {
  if (n > limite) return 'pasa'
  if (n > limite * 0.9) return 'cerca'
  return 'ok'
}

export interface TextoDeRed {
  texto: string
  hashtags: readonly string[]
}

export interface EstadoRed {
  red: Red
  tiene: boolean
  caracteres: number
  limite: number
  nivel: NivelLongitud
  hashtags: number
  /** Los hashtags se pasan de lo que admite la red */
  demasiadosHashtags: boolean
}

/**
 * Cómo está el texto de una red: si existe, cuánto mide y si se pasa. Sirve para
 * pintar el resumen de un vistazo sin abrir cada texto.
 */
export function estadoDeRed(red: Red, texto: TextoDeRed | null): EstadoRed {
  const info = INFO_RED[red]
  const tiene = texto !== null && texto.texto.trim() !== ''
  const n = tiene ? caracteres(componer(texto.texto, texto.hashtags)) : 0
  const h = tiene ? contarHashtags(texto.texto, texto.hashtags) : 0
  return {
    red,
    tiene,
    caracteres: n,
    limite: info.limite,
    nivel: nivelLongitud(n, info.limite),
    hashtags: h,
    demasiadosHashtags: info.maxHashtags !== null && h > info.maxHashtags,
  }
}
