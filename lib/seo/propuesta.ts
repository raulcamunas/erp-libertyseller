/**
 * SEO · LA PROPUESTA DE FICHA CON IA: QUÉ SE LE PIDE Y CÓMO SE LIMPIA LO QUE DEVUELVE. PURO (se prueba sin IA ni Amazon).
 *
 * La IA propone; NUNCA aplica. La propuesta se guarda como «pendiente» y solo llega a Amazon cuando una persona pulsa «Aplicar en Amazon» (propuesta-servidor.ts).
 *
 * LO QUE SE LE EXIGE ES EL SOP DE LA AGENCIA (skill «seo-listing-amazon»), con los límites de 2026:
 *   · Título de 75 caracteres como mucho: marca → término de categoría con MÁS DEMANDA que describa literalmente el producto → nicho → atributo diferenciador → variante. Nunca abrir con el
 *     término de nicho (error 1 del SOP). Ninguna palabra más de dos veces; sin ! $ ? _ { } ^ ¬ ¦; sin lenguaje promocional ni precio.
 *   · Item Highlights de 125 caracteres: lo que no cupo en el título (formato, cantidad, duración). Se indexa igual que el título.
 *   · Cinco viñetas que sumen 1.000 bytes como mucho (unos 200 cada una), beneficio concreto delante y un grupo de búsquedas por viñeta.
 *   · Backend de 249 bytes como mucho (un byte de más y Amazon lo ignora entero), sin comas y SIN repetir ninguna palabra que ya esté arriba (título, highlights o viñetas).
 *   · Solo hechos que ya están en la ficha; fuera marcas ajenas, falsos amigos y búsquedas que compran a otro precio (se le pasan ya marcadas como descartadas).
 * Y la limpieza de aquí lo vuelve a comprobar con código, porque una IA se salta los límites y el SOP pide recuentos calculados, nunca a ojo.
 *
 * Antes eran 200 caracteres de título (con «los primeros 75 se ven en el móvil») y 250 bytes de backend: las reglas viejas. Con ellas la IA proponía títulos que Amazon ya reescribe.
 */

import { bytesDe, caracteresDe, LIMITE_BACKEND_BYTES, LIMITE_BULLETS_BYTES, LIMITE_HIGHLIGHTS_CARACTERES, LIMITE_TITULO_CARACTERES, normalizar, palabras } from './cobertura'
import { promocionalesEn, repetidasEnTitulo } from './norma'

export interface TextosPropuestos {
  titulo: string
  /** Item Highlights (125 caracteres). Opcional: las propuestas guardadas antes de 2026 no lo tienen, y la ficha leída de Amazon tampoco (la API no lo devuelve) */
  highlights?: string
  bullets: string[]
  backend: string
}

export interface CambioRazonado {
  campo: 'titulo' | 'highlights' | 'bullets' | 'backend'
  que: string
  porQue: string
}

export interface Razonamiento {
  resumen: string
  cambios: CambioRazonado[]
  palabrasNuevas: string[]
  /** Lo que se ha dejado fuera a propósito y por qué (marca ajena, falso amigo, otro precio…): es un entregable del SOP */
  descartado?: Array<{ termino: string; porQue: string }>
}

export interface PropuestaLimpia extends TextosPropuestos {
  razonamiento: Razonamiento
  /** Lo que se ha tenido que recortar o quitar al limpiar (se enseña: no se esconde que la IA se pasó) */
  avisos: string[]
}

/** Los caracteres que Amazon no admite en un título */
const PROHIBIDOS_TITULO = /[!$?_{}^¬¦]/g
export const MAX_BULLETS = 5

const espacios = (s: string) => s.replace(/\s+/g, ' ').trim()

/** Corta un texto en el último espacio antes del límite (no a mitad de palabra) */
export function cortarEnPalabra(texto: string, max: number): string {
  if (texto.length <= max) return texto
  const corte = texto.slice(0, max + 1).lastIndexOf(' ')
  return (corte > max * 0.6 ? texto.slice(0, corte) : texto.slice(0, max)).replace(/[\s,;:\-–|]+$/, '')
}

/** Corta un texto en el último espacio para que no pase de `max` bytes (las tildes cuentan doble) */
export function cortarEnBytes(texto: string, max: number): string {
  if (bytesDe(texto) <= max) return texto
  let corte = ''
  for (const w of texto.split(' ')) {
    const siguiente = corte ? `${corte} ${w}` : w
    if (bytesDe(siguiente) > max) break
    corte = siguiente
  }
  // Una sola palabra más larga que el límite: se corta por caracteres
  if (!corte) {
    for (const ch of texto) {
      if (bytesDe(corte + ch) > max) break
      corte += ch
    }
  }
  return corte.replace(/[\s,;:\-–|]+$/, '')
}

/** Recorta las viñetas para que sumen como mucho 1.000 bytes, quitando siempre de la más larga (las cortas ya están bien) */
export function recortarBullets(bullets: readonly string[], max = LIMITE_BULLETS_BYTES): { bullets: string[]; recortadas: number } {
  const salida = [...bullets]
  let recortadas = 0
  for (let vuelta = 0; vuelta < 20; vuelta++) {
    const total = salida.reduce((s, b) => s + bytesDe(b), 0)
    if (total <= max) break
    let i = 0
    for (let k = 1; k < salida.length; k++) if (bytesDe(salida[k]) > bytesDe(salida[i])) i = k
    const objetivo = Math.max(60, bytesDe(salida[i]) - (total - max))
    salida[i] = cortarEnBytes(salida[i], objetivo)
    recortadas++
  }
  return { bullets: salida, recortadas }
}

/** Recorta el backend a los bytes de Amazon, quitando palabras repetidas y las que ya están arriba (título, highlights y viñetas: el SOP no deja repetir nada de lo de arriba) */
export function limpiarBackend(backend: string, arriba: string): { texto: string; quitadas: number } {
  const enTitulo = new Set(palabras(arriba))
  const vistas = new Set<string>()
  const salida: string[] = []
  let quitadas = 0
  for (const w of espacios(backend.replace(/[,;|/]+/g, ' ')).split(' ')) {
    if (!w) continue
    const k = palabras(w)[0] ?? normalizar(w)
    if (!k || /^b0[a-z0-9]{8}$/i.test(w) || vistas.has(k) || enTitulo.has(k)) {
      quitadas++
      continue
    }
    vistas.add(k)
    const candidato = [...salida, w.toLowerCase()].join(' ')
    if (bytesDe(candidato) > LIMITE_BACKEND_BYTES) {
      quitadas++
      continue
    }
    salida.push(w.toLowerCase())
  }
  return { texto: salida.join(' '), quitadas }
}

const texto = (v: unknown) => (typeof v === 'string' ? v : '')

/** De lo que devuelve la IA (JSON ya interpretado) a una propuesta que cumple los límites, o un error si no sirve */
export function limpiarPropuesta(crudo: unknown): PropuestaLimpia | { error: string } {
  const o = (crudo && typeof crudo === 'object' ? crudo : {}) as Record<string, unknown>
  const avisos: string[] = []

  let titulo = espacios(texto(o.titulo).replace(PROHIBIDOS_TITULO, ' '))
  if (!titulo) return { error: 'La IA no ha devuelto un título.' }
  if (caracteresDe(titulo) > LIMITE_TITULO_CARACTERES) {
    titulo = cortarEnPalabra(titulo, LIMITE_TITULO_CARACTERES)
    avisos.push(`El título pasaba de ${LIMITE_TITULO_CARACTERES} caracteres y se ha recortado: revisa que no haya quedado cojo.`)
  }
  const repes = repetidasEnTitulo(titulo)
  if (repes.length > 0) avisos.push(`En el título hay palabras más de dos veces (${repes.join(', ')}): corrígelo antes de usarlo.`)
  const promo = promocionalesEn(titulo)
  if (promo.length > 0) avisos.push(`El título tiene lenguaje promocional (${promo.join(', ')}): quítalo antes de usarlo.`)

  let highlights = espacios(texto(o.highlights))
  if (caracteresDe(highlights) > LIMITE_HIGHLIGHTS_CARACTERES) {
    highlights = cortarEnPalabra(highlights, LIMITE_HIGHLIGHTS_CARACTERES)
    avisos.push(`Los Item Highlights pasaban de ${LIMITE_HIGHLIGHTS_CARACTERES} caracteres y se han recortado.`)
  }

  const bulletsCrudos = Array.isArray(o.bullets) ? o.bullets : []
  let bullets = bulletsCrudos.map((b) => espacios(texto(b))).filter(Boolean)
  if (bullets.length > MAX_BULLETS) {
    avisos.push(`Venían ${bullets.length} viñetas: se dejan ${MAX_BULLETS}.`)
    bullets = bullets.slice(0, MAX_BULLETS)
  }
  const recorte = recortarBullets(bullets)
  bullets = recorte.bullets
  if (recorte.recortadas > 0) avisos.push(`Las viñetas pasaban de ${LIMITE_BULLETS_BYTES.toLocaleString('es-ES')} bytes sumando las cinco y se han recortado: revisa el final de las más largas.`)

  const b = limpiarBackend(texto(o.backend), [titulo, highlights, ...bullets].join(' '))
  if (b.quitadas > 0) avisos.push(`Del backend se han quitado ${b.quitadas} palabras (repetidas, ya arriba o por pasar de ${LIMITE_BACKEND_BYTES} bytes).`)

  const r = (o.razonamiento && typeof o.razonamiento === 'object' ? o.razonamiento : {}) as Record<string, unknown>
  const cambios = (Array.isArray(r.cambios) ? r.cambios : [])
    .map((c) => (c && typeof c === 'object' ? (c as Record<string, unknown>) : {}))
    .map((c) => ({ campo: (['titulo', 'highlights', 'bullets', 'backend'].includes(texto(c.campo)) ? texto(c.campo) : 'titulo') as CambioRazonado['campo'], que: espacios(texto(c.que)).slice(0, 400), porQue: espacios(texto(c.porQue)).slice(0, 600) }))
    .filter((c) => c.que || c.porQue)
    .slice(0, 12)
  const palabrasNuevas = (Array.isArray(r.palabrasNuevas) ? r.palabrasNuevas : []).map((p) => espacios(texto(p)).slice(0, 60)).filter(Boolean).slice(0, 30)

  const descartado = (Array.isArray(r.descartado) ? r.descartado : [])
    .map((d) => (d && typeof d === 'object' ? (d as Record<string, unknown>) : {}))
    .map((d) => ({ termino: espacios(texto(d.termino)).slice(0, 80), porQue: espacios(texto(d.porQue)).slice(0, 300) }))
    .filter((d) => d.termino)
    .slice(0, 15)

  return { titulo, highlights, bullets, backend: b.texto, razonamiento: { resumen: espacios(texto(r.resumen)).slice(0, 1200), cambios, palabrasNuevas, descartado }, avisos }
}

export interface DatosParaProponer {
  idioma: string
  pais: string
  /** Nuestro precio (del listing o estimado); null si no se sabe */
  precio: number | null
  ficha: { titulo: string | null; bullets: string[]; descripcion: string | null; backend: string | null }
  /** El diagnóstico del embudo del producto entero (la «puerta de salida» del SOP), en una frase */
  embudo: string | null
  /** Las búsquedas DEL producto (sin ruido ni otro precio), ordenadas por compras en Amazon, con lo que dice el embudo de cada una */
  busquedas: Array<{ consulta: string; volumen: number | null; comprasTotal: number | null; cuotaComprasTuya: number | null; enLaFicha: boolean; diagnostico: string }>
  /** Las que se descartan antes de elegir (paso 3 del SOP) y por qué: la IA no debe usarlas */
  descartadas: Array<{ consulta: string; porQue: string }>
  palabrasQueFaltan: Array<{ palabra: string; peso: number }>
  terminosDeAds: Array<{ termino: string; pedidos: number }>
}

/** El mensaje de sistema: las reglas del SOP, que no cambian */
export function instruccionesDeSistema(idioma: string): string {
  return [
    'Eres especialista senior en SEO de Amazon en la agencia Liberty Seller. Reescribes los cuatro campos indexables de una ficha (título, Item Highlights, viñetas y backend) siguiendo el SOP de la agencia, sin cambiar lo que es el producto.',
    '',
    'PRINCIPIO: Amazon indexa palabras sueltas, no frases. Repetir no suma. La posición influye en el clic, no en la indexación. Aprovecha frases que contienen otra búsqueda mayor.',
    '',
    'REGLAS QUE NO SE PUEDEN ROMPER (límites de 2026):',
    '1. Solo hechos que ya estén en la ficha actual. Nunca inventas materiales, medidas, cantidades, certificados, garantías, compatibilidades, usos ni declaraciones de salud.',
    `2. TÍTULO de ${LIMITE_TITULO_CARACTERES} caracteres COMO MÁXIMO (cuenta los caracteres; si te pasas, Amazon lo reescribe). Orden: marca (escrita igual que en el título actual) → el término de categoría con MÁS DEMANDA que describa literalmente el producto → el grupo de nicho → el atributo diferenciador → la variante. Nunca abras con el término de nicho por delante del de demanda.`,
    '3. En el título: ninguna palabra más de dos veces; sin ! $ ? _ { } ^ ¬ ¦; sin lenguaje promocional (oferta, mejor, nº1, gratis, barato, top ventas) ni precio; sin palabras enteras en mayúsculas salvo la marca y siglas.',
    `4. ITEM HIGHLIGHTS de ${LIMITE_HIGHLIGHTS_CARACTERES} caracteres como máximo: lo que no cupo en el título (formato, cantidad, duración, uso). Se indexa igual que el título.`,
    `5. Exactamente ${MAX_BULLETS} VIÑETAS que sumen ${LIMITE_BULLETS_BYTES} bytes como máximo (unos 180-200 cada una; las tildes y la ñ ocupan 2 bytes). Cada una empieza con un beneficio concreto en MAYÚSCULAS seguido de dos puntos y cubre un grupo de búsquedas distinto.`,
    `6. BACKEND de ${LIMITE_BACKEND_BYTES} bytes como máximo (un byte de más y Amazon lo ignora entero): palabras separadas por espacios, sin comas, en minúsculas, SIN repetir ninguna palabra que ya esté en el título, los highlights o las viñetas. Sinónimos, variantes, el segundo idioma si procede y errores frecuentes de escritura.`,
    '7. Usa solo las búsquedas de «busquedasDelProducto». Las de «descartadas» NO entran en ningún campo: son ruido, falsos amigos (otra categoría con palabras parecidas) o compran a menos de la mitad de nuestro precio. Fuera también las marcas de otros y los ASIN.',
    '8. Elige por demanda: primero las búsquedas que más COMPRAS mueven en Amazon, después el volumen. No priorices un hueco de poca competencia por encima de la búsqueda de cabecera.',
    `9. Todo en el idioma del marketplace: ${idioma}.`,
    '',
    'Devuelves SOLO un JSON con esta forma:',
    '{"titulo": "...", "highlights": "...", "bullets": ["...", "...", "...", "...", "..."], "backend": "...", "razonamiento": {"resumen": "2-4 frases en español: la estrategia y qué búsqueda abre el título", "cambios": [{"campo": "titulo|highlights|bullets|backend", "que": "qué has cambiado", "porQue": "por qué, con las cifras de las búsquedas"}], "palabrasNuevas": ["..."], "descartado": [{"termino": "...", "porQue": "marca ajena / falso amigo / otro precio / no describe el producto"}]}}',
    'El razonamiento va SIEMPRE en español (lo lee la agencia), aunque la ficha esté en otro idioma.',
  ].join('\n')
}

/** El mensaje con los datos de ESTE producto */
export function mensajeDeDatos(d: DatosParaProponer): string {
  return JSON.stringify(
    {
      marketplace: d.pais,
      idioma: d.idioma,
      nuestroPrecio: d.precio,
      fichaActual: d.ficha,
      diagnosticoDelEmbudo: d.embudo,
      busquedasDelProducto: d.busquedas.slice(0, 40),
      descartadas: d.descartadas.slice(0, 25),
      palabrasQuePesanYNoEstanEnElTitulo: d.palabrasQueFaltan.slice(0, 20),
      terminosQueTraenPedidosPorPublicidad: d.terminosDeAds.slice(0, 20),
    },
    null,
    1
  )
}

/** El idioma de cada marketplace (para la IA y para el `language_tag` de Amazon si el listing no lo trae) */
export const IDIOMA_DE_MARKETPLACE: Record<string, { tag: string; nombre: string }> = {
  A1RKKUPIHCS9HS: { tag: 'es_ES', nombre: 'español de España' },
  A1PA6795UKMFR9: { tag: 'de_DE', nombre: 'alemán' },
  A13V1IB3VIYZZH: { tag: 'fr_FR', nombre: 'francés' },
  APJ6JRA9NG5V4: { tag: 'it_IT', nombre: 'italiano' },
  A1F83G8C2ARO7P: { tag: 'en_GB', nombre: 'inglés británico' },
  ATVPDKIKX0DER: { tag: 'en_US', nombre: 'inglés de EE. UU.' },
  A2EUQ1WTGCTBG2: { tag: 'en_CA', nombre: 'inglés de Canadá' },
  A1AM78C64UM0Y8: { tag: 'es_MX', nombre: 'español de México' },
  A1805IZSGTT6HS: { tag: 'nl_NL', nombre: 'neerlandés' },
  A2NODRKZP88ZB9: { tag: 'sv_SE', nombre: 'sueco' },
  A1C3SOZRARQ6R3: { tag: 'pl_PL', nombre: 'polaco' },
  AMEN7PMS3EDWL: { tag: 'fr_BE', nombre: 'francés de Bélgica' },
  A33AVAJ2PDY3EV: { tag: 'tr_TR', nombre: 'turco' },
  A2Q3Y263D00KWC: { tag: 'pt_BR', nombre: 'portugués de Brasil' },
}

export interface OperacionDePatch {
  op: 'replace'
  path: string
  value: Array<{ value: string; language_tag: string; marketplace_id: string }>
}

/** El PATCH exacto que se manda a la Listings API al aplicar: título, bullets y backend de ESTE marketplace. El backend vacío no se manda (no se borra lo que hubiera) */
export function patchesDeFicha(p: TextosPropuestos, marketplaceId: string, languageTag: string): OperacionDePatch[] {
  const v = (value: string) => ({ value, language_tag: languageTag, marketplace_id: marketplaceId })
  const ops: OperacionDePatch[] = [
    { op: 'replace', path: '/attributes/item_name', value: [v(p.titulo)] },
    { op: 'replace', path: '/attributes/bullet_point', value: p.bullets.map(v) },
  ]
  if (p.backend.trim()) ops.push({ op: 'replace', path: '/attributes/generic_keyword', value: [v(p.backend.trim())] })
  return ops
}

/**
 * DIFERENCIA PALABRA A PALABRA entre dos textos, para pintar lo nuevo resaltado. Devuelve los trozos del texto NUEVO marcando cuáles no estaban en el viejo (por palabra normalizada, sin mirar el
 * orden: lo que interesa es qué palabras entran, no cuáles se han movido).
 */
export function trozosNuevos(viejo: string, nuevo: string): Array<{ texto: string; nuevo: boolean }> {
  const antes = new Set(palabras(viejo))
  return nuevo.split(/(\s+)/).map((t) => {
    if (!t.trim()) return { texto: t, nuevo: false }
    const p = palabras(t)
    return { texto: t, nuevo: p.length > 0 && p.some((x) => !antes.has(x)) }
  })
}
