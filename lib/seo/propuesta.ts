/**
 * SEO · LA PROPUESTA DE FICHA CON IA: QUÉ SE LE PIDE Y CÓMO SE LIMPIA LO QUE DEVUELVE. PURO (se prueba sin IA ni Amazon).
 *
 * La IA propone; NUNCA aplica. La propuesta se guarda como «pendiente» y solo llega a Amazon cuando una persona pulsa «Aplicar en Amazon» (propuesta-servidor.ts).
 *
 * LO QUE SE LE EXIGE (el SOP de la agencia, skill «seo-listing-amazon»):
 *   · Respetar lo que es el producto: solo hechos que ya están en la ficha. Nada de materiales, medidas, certificados, cantidades o compatibilidades inventados.
 *   · La marca, igual que en el título actual y al principio.
 *   · Título de 200 caracteres como mucho, y en los PRIMEROS 75 (lo que se ve en el móvil) la marca, el tipo de producto y la búsqueda principal.
 *   · Las palabras, por lo que VENDEN (compras de la búsqueda en Amazon) y por volumen; nunca marcas de otros.
 *   · 5 bullets, con las búsquedas secundarias de forma natural.
 *   · Backend de 250 bytes como mucho, sin repetir lo que ya está en el título, sin comas, sin marcas de otros ni ASIN.
 * Y la limpieza de aquí lo vuelve a comprobar, porque una IA se salta los límites.
 */

import { bytesDe, LIMITE_BACKEND_BYTES, LIMITE_TITULO_CARACTERES, normalizar, palabras } from './cobertura'

export interface TextosPropuestos {
  titulo: string
  bullets: string[]
  backend: string
}

export interface CambioRazonado {
  campo: 'titulo' | 'bullets' | 'backend'
  que: string
  porQue: string
}

export interface Razonamiento {
  resumen: string
  cambios: CambioRazonado[]
  palabrasNuevas: string[]
}

export interface PropuestaLimpia extends TextosPropuestos {
  razonamiento: Razonamiento
  /** Lo que se ha tenido que recortar o quitar al limpiar (se enseña: no se esconde que la IA se pasó) */
  avisos: string[]
}

/** Los caracteres que Amazon no admite en un título */
const PROHIBIDOS_TITULO = /[!$?_{}^¬¦]/g
export const PRIMER_TRAMO_TITULO = 75
export const MAX_BULLETS = 5
const MAX_BULLET = 500

const espacios = (s: string) => s.replace(/\s+/g, ' ').trim()

/** Corta un texto en el último espacio antes del límite (no a mitad de palabra) */
export function cortarEnPalabra(texto: string, max: number): string {
  if (texto.length <= max) return texto
  const corte = texto.slice(0, max + 1).lastIndexOf(' ')
  return (corte > max * 0.6 ? texto.slice(0, corte) : texto.slice(0, max)).replace(/[\s,;:\-–|]+$/, '')
}

/** Recorta el backend a los bytes de Amazon, quitando palabras repetidas y las que ya están en el título */
export function limpiarBackend(backend: string, titulo: string): { texto: string; quitadas: number } {
  const enTitulo = new Set(palabras(titulo))
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
    if (bytesDe(candidato) > LIMITE_BACKEND_BYTES - 1) {
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
  if (titulo.length > LIMITE_TITULO_CARACTERES) {
    titulo = cortarEnPalabra(titulo, LIMITE_TITULO_CARACTERES)
    avisos.push(`El título pasaba de ${LIMITE_TITULO_CARACTERES} caracteres y se ha recortado.`)
  }

  const bulletsCrudos = Array.isArray(o.bullets) ? o.bullets : []
  let bullets = bulletsCrudos.map((b) => espacios(texto(b))).filter(Boolean)
  if (bullets.length > MAX_BULLETS) {
    avisos.push(`Venían ${bullets.length} bullets: se dejan ${MAX_BULLETS}.`)
    bullets = bullets.slice(0, MAX_BULLETS)
  }
  bullets = bullets.map((b) => {
    if (b.length <= MAX_BULLET) return b
    avisos.push('Un bullet pasaba de 500 caracteres y se ha recortado.')
    return cortarEnPalabra(b, MAX_BULLET)
  })

  const b = limpiarBackend(texto(o.backend), titulo)
  if (b.quitadas > 0) avisos.push(`Del backend se han quitado ${b.quitadas} palabras (repetidas, ya en el título o por pasar de ${LIMITE_BACKEND_BYTES} bytes).`)

  const r = (o.razonamiento && typeof o.razonamiento === 'object' ? o.razonamiento : {}) as Record<string, unknown>
  const cambios = (Array.isArray(r.cambios) ? r.cambios : [])
    .map((c) => (c && typeof c === 'object' ? (c as Record<string, unknown>) : {}))
    .map((c) => ({ campo: (['titulo', 'bullets', 'backend'].includes(texto(c.campo)) ? texto(c.campo) : 'titulo') as CambioRazonado['campo'], que: espacios(texto(c.que)).slice(0, 400), porQue: espacios(texto(c.porQue)).slice(0, 600) }))
    .filter((c) => c.que || c.porQue)
    .slice(0, 12)
  const palabrasNuevas = (Array.isArray(r.palabrasNuevas) ? r.palabrasNuevas : []).map((p) => espacios(texto(p)).slice(0, 60)).filter(Boolean).slice(0, 30)

  return { titulo, bullets, backend: b.texto, razonamiento: { resumen: espacios(texto(r.resumen)).slice(0, 1200), cambios, palabrasNuevas }, avisos }
}

export interface DatosParaProponer {
  idioma: string
  pais: string
  ficha: { titulo: string | null; bullets: string[]; descripcion: string | null; backend: string | null }
  /** Las búsquedas del producto, ordenadas por compras en Amazon */
  busquedas: Array<{ consulta: string; volumen: number | null; comprasTotal: number | null; cuotaComprasTuya: number | null; enLaFicha: boolean }>
  palabrasQueFaltan: Array<{ palabra: string; peso: number }>
  terminosDeAds: Array<{ termino: string; pedidos: number }>
}

/** El mensaje de sistema: las reglas, que no cambian */
export function instruccionesDeSistema(idioma: string): string {
  return [
    'Eres especialista senior en SEO de Amazon (algoritmo A9/A10) en una agencia. Reescribes fichas de producto para posicionar mejor en las búsquedas que más VENDEN, sin cambiar lo que es el producto.',
    '',
    'REGLAS QUE NO SE PUEDEN ROMPER:',
    '1. Solo usas hechos que ya estén en la ficha actual (título, bullets, descripción, backend). Nunca inventas materiales, medidas, cantidades, certificados, garantías, compatibilidades ni usos.',
    '2. La marca va al principio del título, escrita exactamente igual que en el título actual.',
    `3. Título de ${LIMITE_TITULO_CARACTERES} caracteres como máximo (ideal 120-180). En los primeros ${PRIMER_TRAMO_TITULO} caracteres: marca + tipo de producto + la búsqueda principal (lo que se ve en el móvil).`,
    '4. Nada de palabras promocionales (oferta, mejor, nº1, gratis, barato, top ventas), ni símbolos ! $ ? _ { } ^ ¬ ¦, ni palabras en mayúsculas salvo la marca y siglas. Ninguna palabra más de dos veces en el título.',
    '5. Las palabras se eligen por las compras que mueve cada búsqueda en Amazon y por su volumen. Solo búsquedas que describen ESTE producto: fuera marcas de otros, productos distintos y ASIN.',
    `6. Exactamente ${MAX_BULLETS} bullets. Cada uno empieza con un beneficio corto en MAYÚSCULAS seguido de dos puntos y mete las búsquedas secundarias de forma natural. Entre 150 y 250 caracteres cada uno.`,
    `7. Backend (palabras clave ocultas): como máximo ${LIMITE_BACKEND_BYTES} bytes, palabras separadas por espacios, sin comas, en minúsculas, sin repetir palabras que ya estén en el título, sin marcas de otros ni ASIN. Sinónimos, variantes y errores frecuentes de escritura.`,
    `8. Todo en el idioma del marketplace: ${idioma}.`,
    '',
    'Devuelves SOLO un JSON con esta forma:',
    '{"titulo": "...", "bullets": ["...", "...", "...", "...", "..."], "backend": "...", "razonamiento": {"resumen": "2-4 frases en español: la estrategia", "cambios": [{"campo": "titulo|bullets|backend", "que": "qué has cambiado", "porQue": "por qué, con las cifras de las búsquedas"}], "palabrasNuevas": ["..."]}}',
    'El razonamiento va SIEMPRE en español (lo lee la agencia), aunque la ficha esté en otro idioma.',
  ].join('\n')
}

/** El mensaje con los datos de ESTE producto */
export function mensajeDeDatos(d: DatosParaProponer): string {
  return JSON.stringify(
    {
      marketplace: d.pais,
      idioma: d.idioma,
      fichaActual: d.ficha,
      busquedasQueVenden: d.busquedas.slice(0, 40),
      palabrasDeMuchoVolumenQueNoEstanEnElTitulo: d.palabrasQueFaltan.slice(0, 20),
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
