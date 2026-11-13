/**
 * EL ANÁLISIS DE UNA CUENTA DE AMAZON A PARTIR DE KEEPA.
 *
 * Convierte lo que devuelve Keepa (vendedor con su catálogo, el mismo vendedor
 * en otros países y el detalle de sus mejores productos) en el modelo que pinta
 * la página pública del informe. Es una función pura: no llama a nadie, así se
 * puede probar con los JSON guardados y repetir sin gastar tokens.
 *
 * Reglas que manda la identidad de los documentos de Liberty Seller:
 *  - cada afirmación lleva su cifra;
 *  - el rojo solo aparece cuando se incumple un umbral escrito (y el umbral se
 *    enseña);
 *  - nada de promesas: se dice lo que señalan los datos y de qué depende.
 */

/* ------------------------------------------------------------------ */
/* Entrada: lo que guarda la recogida de Keepa                          */
/* ------------------------------------------------------------------ */

// Keepa devuelve objetos enormes y sin tipos estables: se leen con cuidado.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type K = any

export type EntradaAnalisis = {
  /** respuesta de /seller?domain=9&storefront=1 (o el objeto del vendedor) */
  vendedorEs: K
  /** el mismo vendedor en otros países: { fr, it, de, uk } (null si no está) */
  paises?: Partial<Record<CodigoPais, K | null>>
  /** respuesta de /product (o la lista de productos) */
  productos: K
  /** día en que se bajaron los datos (YYYY-MM-DD) */
  fecha: string
  /** competencia.json de la recogida: los que más venden en la categoría de su producto estrella */
  competencia?: K
}

export type CodigoPais = 'es' | 'fr' | 'it' | 'de' | 'uk'

/* ------------------------------------------------------------------ */
/* Salida: el modelo del informe                                        */
/* ------------------------------------------------------------------ */

export type TipoVendedor = 'marca_propia' | 'revendedor' | 'distribuidor' | 'mixto'

export type Prioridad = 'alta' | 'media'

export type Area =
  | 'stock'
  | 'buybox'
  | 'competencia'
  | 'reputacion'
  | 'resenas'
  | 'fichas'
  | 'logistica'
  | 'expansion'

export type Oportunidad = {
  area: Area
  prioridad: Prioridad
  titulo: string
  detalle: string
  /** la cifra que lo sostiene, ya escrita («79 %», «3 de 5») */
  cifra: string
  /** el umbral que se usa para decidirlo, para enseñarlo */
  umbral: string
  /** ASIN de los productos afectados */
  asins: string[]
  /** lo que significa en ventas, en palabras del cliente («≈ 71 días sin poder vender») */
  impacto?: string
  /** por dónde lo atacaríamos */
  accion?: string
}

export type CompetenciaAnalisis = {
  categoria: string | null
  /** su producto mejor posicionado, el que se compara */
  estrella: ProductoAnalisis | null
  rivales: ProductoAnalisis[]
}

export type VentasAnalisis = {
  /** productos con el dato «X compras el mes pasado» de Amazon */
  conDato: number
  /** suma de esas compras (es un mínimo: Amazon redondea hacia abajo, «+300») */
  compras: number
  /** compras × precio actual de cada producto */
  importe: number
}

export type RevisionSeo = {
  /** títulos revisados (sin libros, música ni películas) */
  revisados: number
  fueraDeNorma: number
  /** el título más largo, para enseñarlo cortado en 75 */
  ejemplo: { asin: string; titulo: string; largo: number } | null
  /** títulos con alguna palabra repetida más de dos veces */
  conRepeticiones: number
  /** títulos con símbolos que Amazon no admite */
  conSimbolos: number
  largoMedio: number | null
}

export type Fortaleza = {
  cifra: string
  titulo: string
  detalle: string
}

export type FasePlan = {
  cuando: string
  titulo: string
  pasos: string[]
}

export type ProductoAnalisis = {
  asin: string
  titulo: string
  marca: string | null
  imagen: string | null
  url: string
  precio: number | null
  estrellas: number | null
  resenas: number | null
  ranking: number | null
  categoria: string | null
  sinStock90: number | null
  /** % del tiempo que el propio vendedor tiene la Buy Box (90 días) */
  buyBoxPropia: number | null
  /** otros vendedores que han tenido la Buy Box */
  otrosEnBuyBox: number
  ofertas: number | null
  fba: boolean | null
  fotos: number
  vineta: number
  largoTitulo: number
  videos: number
  ventasMes: number | null
  /** quién tiene la Buy Box ahora mismo */
  buyBoxAhora: 'suya' | 'otro' | 'amazon' | 'nadie' | null
  /** si hay alguna oferta nueva a la venta ahora mismo */
  enStock: boolean | null
  /** umbrales incumplidos en este producto (para pintarlos) */
  alertas: Partial<Record<'stock' | 'buybox' | 'estrellas' | 'fotos' | 'titulo', true>>
}

export type PaisAnalisis = {
  codigo: CodigoPais
  nombre: string
  /** null: no se ha consultado ese país */
  presente: boolean | null
  valoraciones: number | null
  positivas: number | null
  fba: boolean | null
}

export type MarcaAnalisis = {
  marca: string
  productos: number
  cuota: number
  conAmazon: number
}

export type InformeAnalisis = {
  fecha: string
  vendedor: {
    id: string
    nombre: string
    empresa: string | null
    ciudad: string | null
    desde: string | null
    url: string
  }
  tipo: TipoVendedor
  tipoTexto: string
  tipoPorQue: string
  cifras: {
    productos: number
    buyBox: number | null
    competidoresBuyBox: number | null
    positivas12m: number | null
    valoraciones12m: number | null
    positivasTotal: number | null
    valoracionesTotal: number | null
    fba: 'si' | 'no' | 'parcial'
    mercadosActivos: number
  }
  valoraciones: {
    periodo: '30 días' | '90 días' | '12 meses' | 'Total'
    positivas: number | null
    negativas: number | null
    numero: number | null
  }[]
  ultimasOpiniones: { fecha: string; estrellas: number }[]
  marcas: MarcaAnalisis[]
  paises: PaisAnalisis[]
  productos: ProductoAnalisis[]
  oportunidades: Oportunidad[]
  fortalezas: Fortaleza[]
  plan: FasePlan[]
  seo: RevisionSeo
  /** marca propia o en exclusiva: puede tocar títulos y fotos (la píldora SEO solo tiene sentido así) */
  puedeEditarFichas: boolean
  /** La chuleta del comercial para la llamada: el tipo y 3-5 frases clave, en corto (no la ve el cliente) */
  guion: { tipo: string; frases: string[] }
  competencia: CompetenciaAnalisis | null
  ventas: VentasAnalisis
  resumen: string
}

/* ------------------------------------------------------------------ */
/* Umbrales (los mismos que se enseñan en el informe)                   */
/* ------------------------------------------------------------------ */

export const UMBRALES = {
  sinStock: 20, // % de los últimos 90 días
  sinStockGrave: 50,
  buyBox: 80, // % del tiempo con la Buy Box propia
  estrellas: 4.0,
  fotos: 7, // Amazon deja 9; por debajo de 7 se queda corta
  titulo: 75, // caracteres como máximo: norma de títulos de Amazon desde julio de 2026
  negativas: 10, // % de valoraciones negativas en 12 meses
  minValoraciones: 10, // por debajo, el porcentaje no dice nada
} as const

const NOMBRE_PAIS: Record<CodigoPais, string> = {
  es: 'España',
  fr: 'Francia',
  it: 'Italia',
  de: 'Alemania',
  uk: 'Reino Unido',
}

const DOMINIO_PAIS: Record<CodigoPais, string> = {
  es: 'amazon.es',
  fr: 'amazon.fr',
  it: 'amazon.it',
  de: 'amazon.de',
  uk: 'amazon.co.uk',
}

/* ------------------------------------------------------------------ */
/* Ayudas                                                               */
/* ------------------------------------------------------------------ */

/** Keepa cuenta el tiempo en minutos desde el 1 de enero de 2011. */
export function fechaKeepa(minutos: number | null | undefined): string | null {
  if (!minutos || minutos <= 0) return null
  return new Date((minutos + 21564000) * 60000).toISOString().slice(0, 10)
}

const num = (v: unknown): number | null => (typeof v === 'number' && v >= 0 ? v : null)

function porcentaje(n: number, total: number): number {
  return total > 0 ? Math.round((n / total) * 100) : 0
}

function recortar(t: string, n: number): string {
  const limpio = t.replace(/\s+/g, ' ').trim()
  return limpio.length <= n ? limpio : limpio.slice(0, n - 1).trimEnd() + '…'
}

function lista(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`
}

/** Amazon como vendedor, en los mercados europeos */
const AMAZON_IDS = new Set(['A1AT7YVPFBWXBL', 'A1X6FK5RDHNB96', 'A3JWKAKR8XB7XF', 'A11IL2PNWYJU7H', 'A3P5ROKL5A1OLE', 'ATVPDKIKX0DER'])

const MEDIA = /libros|música|musica|películas|peliculas|cine|dvd|blu-ray|kindle/i
const esMedia = (categoria: string | null) => Boolean(categoria && MEDIA.test(categoria))
const SIMBOLOS = /[!$?_{}^¬¦]/

/** La norma de títulos de julio de 2026 aplicada a los productos analizados. */
export function revisarSeo(productos: ProductoAnalisis[]): RevisionSeo {
  const revisables = productos.filter((p) => p.titulo && !esMedia(p.categoria))
  const fuera = revisables.filter((p) => p.largoTitulo > UMBRALES.titulo).sort((a, b) => b.largoTitulo - a.largoTitulo)
  const repetida = (t: string) => {
    const veces = new Map<string, number>()
    for (const w of t.toLowerCase().split(/[^\p{L}\p{N}]+/u)) if (w.length > 2) veces.set(w, (veces.get(w) ?? 0) + 1)
    return [...veces.values()].some((v) => v > 2)
  }
  return {
    revisados: revisables.length,
    fueraDeNorma: fuera.length,
    ejemplo: fuera[0] ? { asin: fuera[0].asin, titulo: fuera[0].titulo, largo: fuera[0].largoTitulo } : null,
    conRepeticiones: revisables.filter((p) => repetida(p.titulo)).length,
    conSimbolos: revisables.filter((p) => SIMBOLOS.test(p.titulo)).length,
    largoMedio: revisables.length ? Math.round(revisables.reduce((t, p) => t + p.largoTitulo, 0) / revisables.length) : null,
  }
}

const cifras_buyBox = (s: K): number | null => num(s?.buyBoxNewOwnershipRate)
const decimal1 = (n: number) => n.toFixed(1).replace('.', ',')

function enumerar(xs: string[]): string {
  return xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`
}

function capitalizar(t: string): string {
  return t.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase())
}

function sacarVendedor(raw: K, id?: string): K | null {
  if (!raw) return null
  if (raw.sellerId) return raw
  const sellers = raw.sellers ?? {}
  return (id && sellers[id]) || Object.values(sellers)[0] || null
}

/* ------------------------------------------------------------------ */
/* Producto                                                             */
/* ------------------------------------------------------------------ */

function leerProducto(p: K, sellerId: string): ProductoAnalisis {
  const st = p.stats ?? {}
  const cur: number[] = st.current ?? []
  const imagenes: K[] = Array.isArray(p.images) ? p.images : []
  const principal = imagenes[0]?.m ?? imagenes[0]?.l ?? null
  const bb: Record<string, K> = st.buyBoxStats ?? {}
  // Si Keepa tiene el reparto de la Buy Box y él no aparece, es que no la ha tenido nunca: 0 %
  const propia = bb[sellerId]?.percentageWon ?? (sellerId && Object.keys(bb).length ? 0 : undefined)
  const bbAhora: string | null = typeof st.buyBoxSellerId === 'string' ? st.buyBoxSellerId : null
  const precios = [cur[1], cur[10], cur[7], cur[18]].filter((v) => typeof v === 'number')
  const otros = Object.keys(bb).filter((k) => k !== sellerId).length
  const oos = Array.isArray(st.outOfStockPercentage90) ? num(st.outOfStockPercentage90[1]) : null
  const estrellas = num(cur[16]) !== null && cur[16] > 0 ? cur[16] / 10 : null
  const precioCent = num(cur[18]) ?? num(cur[1])
  const arbol: K[] = p.categoryTree ?? []
  const titulo: string = p.title ?? ''

  const prod: ProductoAnalisis = {
    asin: p.asin,
    titulo,
    marca: p.brand ?? null,
    imagen: principal ? `https://m.media-amazon.com/images/I/${principal}` : null,
    url: `https://www.amazon.es/dp/${p.asin}`,
    precio: precioCent !== null ? precioCent / 100 : null,
    estrellas,
    resenas: num(cur[17]),
    ranking: num(cur[3]) && cur[3] > 0 ? cur[3] : null,
    categoria: arbol[0]?.name ?? null,
    sinStock90: oos,
    buyBoxPropia: typeof propia === 'number' ? Math.round(propia) : null,
    otrosEnBuyBox: otros,
    ofertas: num(st.totalOfferCount),
    fba: typeof st.buyBoxIsFBA === 'boolean' ? st.buyBoxIsFBA : null,
    fotos: imagenes.length,
    vineta: Array.isArray(p.features) ? p.features.length : 0,
    largoTitulo: titulo.length,
    videos: Array.isArray(p.videos) ? p.videos.length : 0,
    ventasMes: num(p.monthlySold),
    buyBoxAhora: !bbAhora || bbAhora.startsWith('-')
      ? (cur.length ? 'nadie' : null)
      : bbAhora === sellerId
        ? 'suya'
        : AMAZON_IDS.has(bbAhora)
          ? 'amazon'
          : 'otro',
    enStock: precios.length ? precios.some((v) => v > 0) : null,
    alertas: {},
  }
  if (oos !== null && oos >= UMBRALES.sinStock) prod.alertas.stock = true
  if (prod.buyBoxPropia !== null && prod.buyBoxPropia < UMBRALES.buyBox) prod.alertas.buybox = true
  if (estrellas !== null && estrellas < UMBRALES.estrellas) prod.alertas.estrellas = true
  if (prod.fotos > 0 && prod.fotos < UMBRALES.fotos) prod.alertas.fotos = true
  if (titulo && titulo.length > UMBRALES.titulo && !esMedia(prod.categoria)) prod.alertas.titulo = true
  return prod
}

/* ------------------------------------------------------------------ */
/* Construcción                                                         */
/* ------------------------------------------------------------------ */

export function construirAnalisis(e: EntradaAnalisis): InformeAnalisis {
  const s = sacarVendedor(e.vendedorEs)
  if (!s) throw new Error('Keepa no devolvió datos de este vendedor')
  const sellerId: string = s.sellerId

  /* --- productos -------------------------------------------------- */
  const crudos: K[] = Array.isArray(e.productos) ? e.productos : e.productos?.products ?? []
  const productos = crudos
    .filter((p) => p && p.asin && p.title)
    .map((p) => leerProducto(p, sellerId))
    .sort((a, b) => (a.ranking ?? Infinity) - (b.ranking ?? Infinity))

  /* --- marcas y tipo de vendedor ---------------------------------- */
  const brutas: K[] = s.sellerBrandStatistics ?? []
  const totalMarcas = brutas.reduce((t, m) => t + (m.productCount ?? 0), 0)
  const marcas: MarcaAnalisis[] = brutas
    .map((m) => ({
      marca: String(m.brand ?? ''),
      productos: m.productCount ?? 0,
      cuota: porcentaje(m.productCount ?? 0, totalMarcas),
      conAmazon: m.productCountWithAmazonOffer ?? 0,
    }))
    .sort((a, b) => b.productos - a.productos)

  const competidores = typeof s.avgBuyBoxCompetitors === 'number' ? s.avgBuyBoxCompetitors : null
  const principal = marcas[0]
  // el nombre de la marca que se enseña: el de los productos (bien escrito) si coincide
  const nombreMarca = (m: MarcaAnalisis) =>
    productos.find((p) => p.marca && p.marca.toLowerCase() === m.marca.toLowerCase())?.marca ?? m.marca

  let tipo: TipoVendedor
  let tipoTexto: string
  let tipoPorQue: string
  const cuota = principal?.cuota ?? 0
  const bbVendedor = num(s.buyBoxNewOwnershipRate)
  const comp = competidores ?? 0
  const conAmazonTotal = brutas.reduce((t, m) => t + (m.productCountWithAmazonOffer ?? 0), 0)
  const cuotaAmazon = totalMarcas ? conAmazonTotal / totalMarcas : 0
  // Keepa da como mucho 10 marcas: con 10 son «10 o más»
  const nMarcas = marcas.length >= 10 ? 'más de 10' : String(marcas.length)
  const coma = (n: number) => n.toFixed(1).replace('.', ',')
  if (cuota < 50 && (comp >= 1.5 || (bbVendedor !== null && bbVendedor < 60) || cuotaAmazon >= 0.2)) {
    // Comparte sus fichas con otros vendedores (o con Amazon): vende productos de marcas ajenas
    tipo = 'revendedor'
    tipoTexto = 'Reventa de marcas ajenas'
    tipoPorQue = `Vende productos de ${nMarcas} marcas${principal ? ` (la que más pesa, ${nombreMarca(principal)}, es solo el ${cuota} % de su catálogo)` : ''}, compite de media con ${coma(comp)} vendedores en cada ficha${bbVendedor !== null ? ` y gana la Buy Box en el ${bbVendedor} % de sus ofertas` : ''}.`
  } else if (principal && cuota >= 60 && comp < 2) {
    tipo = 'marca_propia'
    tipoTexto = 'Marca propia'
    tipoPorQue = `El ${cuota} % de sus productos son de ${nombreMarca(principal)} y casi nadie más vende en sus fichas (${coma(comp)} vendedores de media por Buy Box).`
  } else if (comp < 1.5 && (bbVendedor ?? 0) >= 80) {
    tipo = 'distribuidor'
    tipoTexto = 'Varias marcas propias o en exclusiva'
    tipoPorQue = `Vende ${nMarcas} marcas y casi siempre es el único vendedor de sus fichas (Buy Box en el ${bbVendedor} % de sus ofertas): son marcas suyas o que distribuye en exclusiva.`
  } else {
    tipo = 'mixto'
    tipoTexto = 'Marca principal y reventa'
    tipoPorQue = principal
      ? `El ${cuota} % de sus productos son de ${nombreMarca(principal)} y el resto, de ${marcas.length >= 10 ? 'más de 9 marcas' : lista(marcas.length - 1, 'marca más', 'marcas más')}.`
      : 'Keepa no tiene el desglose de marcas de este vendedor.'
  }

  // Fotos y títulos solo los puede cambiar quien es dueño de la ficha
  const puedeEditarFichas = tipo === 'marca_propia' || tipo === 'distribuidor'
  if (!puedeEditarFichas)
    for (const p of productos) {
      delete p.alertas.fotos
      delete p.alertas.titulo
    }

  /* --- valoraciones ------------------------------------------------ */
  const pos: number[] = s.positiveRating ?? []
  const neg: number[] = s.negativeRating ?? []
  const cnt: number[] = s.ratingCount ?? []
  const periodos = ['30 días', '90 días', '12 meses', 'Total'] as const
  const valoraciones = periodos.map((periodo, i) => ({
    periodo,
    positivas: cnt[i] ? num(pos[i]) : null,
    negativas: cnt[i] ? num(neg[i]) : null,
    numero: num(cnt[i]),
  }))
  const ultimasOpiniones = ((s.recentFeedback ?? []) as K[])
    .filter((f) => !f.isStriked)
    .slice(0, 5)
    .map((f) => ({ fecha: fechaKeepa(f.date) ?? '', estrellas: Math.round((f.rating ?? 0) / 10) }))

  /* --- países ------------------------------------------------------ */
  const paises: PaisAnalisis[] = (['es', 'fr', 'it', 'de', 'uk'] as CodigoPais[]).map((c) => {
    const consultado = c === 'es' || (e.paises != null && c in e.paises)
    const v = c === 'es' ? s : sacarVendedor(e.paises?.[c], sellerId)
    const total = v?.ratingCount?.[3] ?? 0
    const catalogo = c === 'es' ? (s.asinList?.length ?? 0) : 0
    const presente = !consultado ? null : c === 'es' ? catalogo > 0 || total > 0 : total > 0
    return {
      codigo: c,
      nombre: NOMBRE_PAIS[c],
      presente,
      valoraciones: v ? total : null,
      positivas: v && total ? num(v.positiveRating?.[3]) : null,
      fba: v ? Boolean(v.hasFBA) : null,
    }
  })
  const mercadosActivos = paises.filter((p) => p.presente === true).length

  /* --- logística --------------------------------------------------- */
  const conDatoFba = productos.filter((p) => p.fba !== null)
  const enFba = conDatoFba.filter((p) => p.fba).length
  const fba: 'si' | 'no' | 'parcial' = !s.hasFBA
    ? 'no'
    : conDatoFba.length && enFba < conDatoFba.length
      ? 'parcial'
      : 'si'

  /* --- oportunidades ----------------------------------------------- */
  const op: Oportunidad[] = []
  const n = productos.length
  const corto = (p: ProductoAnalisis) => `«${recortar(p.titulo, 48)}»`

  const sinStock = productos.filter((p) => p.alertas.stock).sort((a, b) => (b.sinStock90 ?? 0) - (a.sinStock90 ?? 0))
  if (sinStock.length) {
    const peor = sinStock[0]
    op.push({
      area: 'stock',
      prioridad: (peor.sinStock90 ?? 0) >= UMBRALES.sinStockGrave ? 'alta' : 'media',
      titulo: 'Roturas de stock',
      cifra: `${sinStock.length} de ${n}`,
      detalle: `${lista(sinStock.length, 'producto estuvo', 'productos estuvieron')} sin stock más del ${UMBRALES.sinStock} % de los últimos 90 días. El peor, ${corto(peor)}, un ${peor.sinStock90} %. Mientras no hay stock la ficha deja de vender y pierde posiciones en la búsqueda.`,
      umbral: `Sin stock ≥ ${UMBRALES.sinStock} % de los últimos 90 días`,
      asins: sinStock.map((p) => p.asin),
    })
  }

  if (bbVendedor !== null && bbVendedor < 60) {
    op.push({
      area: 'buybox',
      prioridad: 'alta',
      titulo: 'Buy Box en pocas de sus ofertas',
      cifra: `${bbVendedor} %`,
      detalle: `Solo gana la Buy Box en el ${bbVendedor} % de sus ofertas. En el resto, el comprador que entra a la ficha compra a otro vendedor${conAmazonTotal ? `, y en ${lista(conAmazonTotal, 'producto', 'productos')} ese otro vendedor puede ser la propia Amazon` : ''}. En reventa, la Buy Box es la venta.`,
      umbral: 'Buy Box en menos del 60 % de sus ofertas',
      asins: [],
      impacto: `De cada 10 ofertas suyas, en ${10 - Math.round(bbVendedor / 10)} la venta se la lleva otro`,
    })
  }

  const pierdeBb = productos.filter((p) => p.alertas.buybox).sort((a, b) => (a.buyBoxPropia ?? 0) - (b.buyBoxPropia ?? 0))
  if (pierdeBb.length) {
    const peor = pierdeBb[0]
    op.push({
      area: 'buybox',
      prioridad: tipo === 'marca_propia' || (peor.buyBoxPropia ?? 100) < 50 ? 'alta' : 'media',
      titulo: 'Buy Box que se escapa',
      cifra: `${pierdeBb.length} de ${n}`,
      detalle: `En ${lista(pierdeBb.length, 'producto', 'productos')} tiene la Buy Box menos del ${UMBRALES.buyBox} % del tiempo. En ${corto(peor)} solo el ${peor.buyBoxPropia} %${peor.otrosEnBuyBox ? `, repartida con ${lista(peor.otrosEnBuyBox, 'vendedor más', 'vendedores más')}` : ''}. ${tipo === 'marca_propia' ? 'Sin la Buy Box, la venta se la lleva otro aunque la ficha sea suya.' : 'Sin la Buy Box no hay venta: el pedido se lo lleva el vendedor que la tiene.'}`,
      umbral: `Buy Box propia < ${UMBRALES.buyBox} % del tiempo (90 días)`,
      asins: pierdeBb.map((p) => p.asin),
    })
  }

  if (tipo === 'marca_propia') {
    const conOtros = productos.filter((p) => p.otrosEnBuyBox > 0)
    if (conOtros.length) {
      op.push({
        area: 'competencia',
        prioridad: 'alta',
        titulo: 'Otros vendedores en su marca',
        cifra: `${conOtros.length} de ${n}`,
        detalle: `En ${lista(conOtros.length, 'ficha', 'fichas')} de su propia marca otros vendedores han llegado a ganar la Buy Box en los últimos 90 días. En una marca propia eso suele ser reventa no autorizada y se puede proteger con el Registro de Marcas de Amazon.`,
        umbral: 'Algún vendedor ajeno con Buy Box en una ficha de su marca',
        asins: conOtros.map((p) => p.asin),
      })
    }
  }

  const conAmazon = marcas.reduce((t, m) => t + m.conAmazon, 0)
  if (conAmazon > 0) {
    op.push({
      area: 'competencia',
      prioridad: 'media',
      titulo: 'Amazon vende en sus productos',
      cifra: String(conAmazon),
      detalle: `Amazon tiene oferta propia en ${lista(conAmazon, 'producto', 'productos')} de su catálogo. Competir con Amazon por la Buy Box pide precio y logística FBA.`,
      umbral: 'Oferta de Amazon en el mismo producto',
      asins: [],
    })
  }

  const v12 = valoraciones[2]
  if (v12.numero !== null && v12.numero >= UMBRALES.minValoraciones && (v12.negativas ?? 0) >= UMBRALES.negativas) {
    op.push({
      area: 'reputacion',
      prioridad: (v12.negativas ?? 0) >= 2 * UMBRALES.negativas ? 'alta' : 'media',
      titulo: 'Valoraciones de vendedor negativas',
      cifra: `${v12.negativas} %`,
      detalle: `El ${v12.negativas} % de sus ${v12.numero} valoraciones de vendedor de los últimos 12 meses son negativas. Amazon lo tiene en cuenta para dar la Buy Box y el comprador lo ve antes de comprar.`,
      umbral: `Negativas ≥ ${UMBRALES.negativas} % en 12 meses (con ${UMBRALES.minValoraciones} valoraciones o más)`,
      asins: [],
    })
  }

  const flojas = productos.filter((p) => p.alertas.estrellas).sort((a, b) => (a.estrellas ?? 5) - (b.estrellas ?? 5))
  if (flojas.length) {
    const peor = flojas[0]
    op.push({
      area: 'resenas',
      prioridad: (peor.estrellas ?? 5) < 3.5 ? 'alta' : 'media',
      titulo: 'Productos por debajo de 4 estrellas',
      cifra: `${flojas.length} de ${n}`,
      detalle: `${lista(flojas.length, 'producto tiene', 'productos tienen')} menos de ${UMBRALES.estrellas.toFixed(1).replace('.', ',')} estrellas. ${corto(peor)} está en ${peor.estrellas?.toFixed(1).replace('.', ',')} ★ con ${peor.resenas ?? 0} reseñas. Por debajo de 4 estrellas baja la conversión y la publicidad sale más cara.`,
      umbral: `Valoración < ${UMBRALES.estrellas.toFixed(1).replace('.', ',')} ★`,
      asins: flojas.map((p) => p.asin),
    })
  }

  /* SEO: la norma de títulos de julio de 2026 */
  const seo = revisarSeo(productos)
  if (puedeEditarFichas && seo.fueraDeNorma > 0) {
    const ej = seo.ejemplo
    op.push({
      area: 'fichas',
      prioridad: seo.fueraDeNorma * 2 >= seo.revisados ? 'alta' : 'media',
      titulo: 'Títulos fuera de la norma de 2026',
      cifra: `${seo.fueraDeNorma} de ${seo.revisados}`,
      detalle: `Desde julio de 2026 Amazon limita el título a ${UMBRALES.titulo} caracteres. ${lista(seo.fueraDeNorma, 'título lo supera', 'títulos lo superan')}${ej ? `; el más largo tiene ${ej.largo}` : ''}. Un título fuera de norma lo reescribe la IA de Amazon y se pierde el control de las palabras por las que se posiciona.`,
      umbral: `Título de más de ${UMBRALES.titulo} caracteres (norma de Amazon desde julio de 2026)`,
      asins: productos.filter((p) => p.alertas.titulo).map((p) => p.asin),
    })
  }

  const pocasFotos = productos.filter((p) => p.alertas.fotos)
  const sinVideo = productos.filter((p) => p.videos === 0)
  if (puedeEditarFichas && pocasFotos.length) {
    op.push({
      area: 'fichas',
      prioridad: 'media',
      titulo: 'Fichas con pocas fotos',
      cifra: `${pocasFotos.length} de ${n}`,
      detalle: [
        `${lista(pocasFotos.length, 'ficha tiene', 'fichas tienen')} menos de ${UMBRALES.fotos} fotos (Amazon admite 9).`,
        sinVideo.length === n ? 'Ninguna de las fichas analizadas tiene vídeo.' : '',
        'Con pocas fotos el comprador duda más y compra menos.',
      ].filter(Boolean).join(' '),
      umbral: `Menos de ${UMBRALES.fotos} fotos`,
      asins: pocasFotos.map((p) => p.asin),
    })
  }

  if (fba === 'no') {
    op.push({
      area: 'logistica',
      prioridad: 'alta',
      titulo: 'Sin logística de Amazon (FBA)',
      cifra: '0 %',
      detalle: 'Todos sus envíos los hace por su cuenta, así que ningún producto lleva la etiqueta Prime. Con FBA el producto entra en Prime y gana peso en la Buy Box.',
      umbral: 'Ningún producto en FBA',
      asins: [],
    })
  } else if (fba === 'parcial') {
    const fuera = conDatoFba.filter((p) => !p.fba)
    op.push({
      area: 'logistica',
      prioridad: 'media',
      titulo: 'Productos fuera de FBA',
      cifra: `${fuera.length} de ${conDatoFba.length}`,
      detalle: `${lista(fuera.length, 'producto se envía', 'productos se envían')} sin la logística de Amazon y no llevan Prime. Conviene ver si es por tamaño o margen, o si se puede pasar a FBA.`,
      umbral: 'Buy Box sin FBA',
      asins: fuera.map((p) => p.asin),
    })
  }

  const sinAbrir = paises.filter((p) => p.presente === false)
  if (sinAbrir.length) {
    op.push({
      area: 'expansion',
      prioridad: 'media',
      titulo: 'Mercados europeos sin abrir',
      cifra: `${mercadosActivos} de 5`,
      detalle: `Vende en ${enumerar(paises.filter((p) => p.presente === true).map((p) => p.nombre)) || 'ningún mercado'}. En ${enumerar(sinAbrir.map((p) => p.nombre))} no tiene ventas registradas. Abrir cada país pide traducir las fichas y cumplir su normativa (por ejemplo, EPR en Alemania y Francia).`,
      umbral: 'Sin valoraciones de vendedor en el país',
      asins: [],
    })
  }

  const orden: Record<Prioridad, number> = { alta: 0, media: 1 }
  op.sort((a, b) => orden[a.prioridad] - orden[b.prioridad])

  /* --- impacto y acción de cada oportunidad ------------------------ */
  const porAsin = new Map(productos.map((p) => [p.asin, p]))
  for (const o of op) {
    const afectados = o.asins.map((a) => porAsin.get(a)).filter((p): p is ProductoAnalisis => Boolean(p))
    switch (o.area) {
      case 'stock': {
        const peor = afectados[0]
        if (peor?.sinStock90) o.impacto = `≈ ${Math.round((peor.sinStock90 / 100) * 90)} días sin poder vender su producto más afectado en los últimos 90`
        o.accion = 'Plan de reposición a FBA con la rotación de cada producto, para mandar antes de que se agote.'
        break
      }
      case 'buybox': {
        const peor = afectados[0]
        if (peor?.buyBoxPropia !== null && peor?.buyBoxPropia !== undefined)
          o.impacto = `En su peor ficha, ${100 - peor.buyBoxPropia} de cada 100 visitas compran a otro vendedor`
        o.accion = 'Revisar precio, envío y vendedores de esas fichas para recuperar la Buy Box.'
        break
      }
      case 'competencia':
        o.accion = o.titulo.startsWith('Amazon')
          ? 'Ajustar precio y logística en esos productos para no regalarle la venta a Amazon.'
          : 'Registro de Marcas y denuncia de los vendedores no autorizados.'
        break
      case 'reputacion': {
        const n = Number.parseInt(o.cifra, 10)
        if (n) o.impacto = `${Math.round(n / 10)} de cada 10 compradores que le valoran le ponen nota negativa`
        o.accion = 'Revisar los pedidos con nota negativa, pedir la retirada de las que no proceden y atajar la causa.'
        break
      }
      case 'resenas':
        o.accion = 'Vine y solicitud de reseñas en esos productos, y leer qué repiten las negativas para corregirlo en la ficha.'
        break
      case 'fichas':
        o.accion = o.titulo.startsWith('Títulos')
          ? `Reescribir cada título a ${UMBRALES.titulo} caracteres (marca + tipo + atributo + variante) y llevar el resto a Item Highlights, viñetas y backend.`
          : 'Completar las fotos que faltan (uso, medidas, detalle) y añadir vídeo en los productos que más venden.'
        break
      case 'logistica':
        o.impacto = o.titulo.startsWith('Sin') ? 'Ningún producto aparece con la etiqueta Prime' : undefined
        o.accion = 'Calcular producto a producto si sale rentable en FBA y pasar los que sí.'
        break
      case 'expansion':
        o.accion = 'Abrir país a país, empezando por el que menos cambios pide, con las fichas traducidas y su registro.'
        break
    }
  }

  /* --- lo que ya hace bien ----------------------------------------- */
  const fortalezas: Fortaleza[] = []
  if (cifras_buyBox(s) !== null && (cifras_buyBox(s) as number) >= 90)
    fortalezas.push({ cifra: `${cifras_buyBox(s)} %`, titulo: 'Buy Box en sus ofertas', detalle: 'Casi siempre es su oferta la que sale en el botón de compra.' })
  const buenas = productos.filter((p) => (p.estrellas ?? 0) >= 4.3 && (p.resenas ?? 0) >= 20)
  if (buenas.length)
    fortalezas.push({
      cifra: `${decimal1(Math.max(...buenas.map((p) => p.estrellas ?? 0)))} ★`,
      titulo: buenas.length === 1 ? 'Un producto muy bien valorado' : `${buenas.length} productos muy bien valorados`,
      detalle: `Con 4,3 estrellas o más y reseñas suficientes para que el comprador se fíe.`,
    })
  if (tipo === 'marca_propia')
    fortalezas.push({ cifra: `${cuota} %`, titulo: 'Marca propia', detalle: 'La ficha y el margen son suyos: lo que se mejora en la ficha se queda en casa.' })
  const activos = paises.filter((p) => p.presente === true).length
  if (activos >= 2) fortalezas.push({ cifra: `${activos} países`, titulo: 'Ya vende fuera de España', detalle: `Tiene ventas en ${enumerar(paises.filter((p) => p.presente === true).map((p) => p.nombre))}.` })
  const mejor = productos.find((p) => p.ranking !== null)
  if (mejor?.ranking && mejor.ranking <= 20000)
    fortalezas.push({ cifra: `#${String(mejor.ranking).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`, titulo: 'Su mejor producto', detalle: `En ${mejor.categoria ?? 'su categoría'}: hay demanda y Amazon ya le da visibilidad.` })
  const catalogo = s.asinList?.length ?? 0
  if (catalogo >= 300)
    fortalezas.push({
      cifra: String(catalogo).replace(/\B(?=(\d{3})+(?!\d))/g, '.'),
      titulo: 'Productos en su catálogo',
      detalle: 'Un catálogo grande es la mejor base para crecer: cada mejora se multiplica por muchas fichas.',
    })
  const conVentasBuenas = productos.filter((p) => (p.ventasMes ?? 0) >= 500)
  if (conVentasBuenas.length)
    fortalezas.push({
      cifra: `+${String(Math.max(...conVentasBuenas.map((p) => p.ventasMes ?? 0))).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`,
      titulo: 'Compras al mes en su producto más vendido',
      detalle: 'Dato que Amazon enseña en la propia ficha: hay demanda y la ficha ya convierte.',
    })
  const anios = s.trackedSince ? (Date.parse(e.fecha) - Date.parse(fechaKeepa(s.trackedSince) ?? e.fecha)) / (365.25 * 864e5) : 0
  if (anios >= 2) fortalezas.push({ cifra: `${Math.floor(anios)} años`, titulo: 'Vendiendo en Amazon', detalle: 'Una cuenta con historial, que es lo que más cuesta construir.' })

  /* --- por dónde empezaríamos -------------------------------------- */
  const conArea = (...areas: Area[]) => [...new Set(op.filter((o) => areas.includes(o.area)).map((o) => o.accion ?? o.titulo))]
  const plan: FasePlan[] = [
    { cuando: 'Semanas 1–2', titulo: 'Cortar lo que hoy cuesta ventas', pasos: conArea('stock', 'buybox', 'competencia') },
    { cuando: 'Mes 1–2', titulo: 'Que cada visita convierta más', pasos: conArea('reputacion', 'resenas', 'fichas', 'logistica') },
    {
      cuando: 'Mes 3 en adelante',
      titulo: 'Crecer sobre lo que ya funciona',
      pasos: [...conArea('expansion'), 'Publicidad en Amazon sobre los productos que ya convierten, medida por coste de cada venta.'],
    },
  ].filter((f) => f.pasos.length > 0)

  /* --- resumen ----------------------------------------------------- */
  // «Roturas de stock» → «roturas de stock», pero «Buy Box…» se queda como está
  const claves = op.slice(0, 3).map((o) => (/^Buy Box/.test(o.titulo) ? o.titulo : o.titulo.charAt(0).toLowerCase() + o.titulo.slice(1)))
  const queVende: Record<TipoVendedor, string> = {
    marca_propia: 'su propia marca',
    revendedor: 'productos de marcas ajenas',
    distribuidor: 'varias marcas propias o en exclusiva',
    mixto: 'una marca principal junto a productos de otras marcas',
  }
  const resumen = `${s.sellerName} vende en Amazon ${queVende[tipo]} con ${String(s.asinList?.length ?? 0).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} ${(s.asinList?.length ?? 0) === 1 ? 'producto' : 'productos'} en España${mercadosActivos > 1 ? ` y presencia en ${mercadosActivos - 1} ${mercadosActivos - 1 === 1 ? 'país más' : 'países más'}` : ''}.${claves.length ? ` Lo que más pesa ahora: ${enumerar(claves)}.` : ''}`

  /* --- competencia ------------------------------------------------ */
  let competencia: CompetenciaAnalisis | null = null
  const comp_ = e.competencia
  if (comp_ && Array.isArray(comp_.products) && comp_.products.length) {
    const rivales = (comp_.products as K[]).filter((p) => p?.asin && p.title).map((p) => leerProducto(p, ''))
    competencia = {
      categoria: comp_.categoria ?? null,
      estrella: productos.find((p) => p.asin === comp_.estrella) ?? productos[0] ?? null,
      rivales: rivales.sort((a, b) => (a.ranking ?? Infinity) - (b.ranking ?? Infinity)).slice(0, 3),
    }
  }

  /* --- lo que venden sus productos --------------------------------- */
  const conVentas = productos.filter((p) => p.ventasMes)
  const ventas: VentasAnalisis = {
    conDato: conVentas.length,
    compras: conVentas.reduce((t, p) => t + (p.ventasMes ?? 0), 0),
    importe: Math.round(conVentas.reduce((t, p) => t + (p.ventasMes ?? 0) * (p.precio ?? 0), 0)),
  }

  /* --- la chuleta para la llamada (interna) ------------------------- */
  const frases: string[] = []
  const pm = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  frases.push(
    tipo === 'marca_propia'
      ? `Marca propia: ${principal ? nombreMarca(principal) : 'su marca'} es el ${cuota} % de sus ${pm(s.asinList?.length ?? 0)} productos. La ficha es suya.`
      : tipo === 'revendedor'
        ? `Revende marcas ajenas (${principal ? `${nombreMarca(principal)} ${cuota} %` : 'varias'}) en ${pm(s.asinList?.length ?? 0)} productos. Su venta depende de ganar la Buy Box.`
        : `${tipoTexto}: ${pm(s.asinList?.length ?? 0)} productos.`,
  )
  const masVendido = [...productos].filter((p) => p.ventasMes).sort((a, b) => (b.ventasMes ?? 0) - (a.ventasMes ?? 0))[0]
  if (masVendido) frases.push(`Su producto que más vende: «${recortar(masVendido.titulo, 45)}» (+${pm(masVendido.ventasMes ?? 0)} compras/mes).`)
  for (const o of op.slice(0, 3)) frases.push(`${o.titulo}: ${o.cifra}${o.impacto ? ` (${o.impacto.charAt(0).toLowerCase()}${o.impacto.slice(1)})` : ''}.`)
  if (competencia?.rivales[0] && competencia.estrella) {
    const l = competencia.rivales[0]
    frases.push(`En ${competencia.categoria ?? 'su categoría'} lidera ${l.marca ?? 'otro'} con ${pm(l.resenas ?? 0)} reseñas (él tiene ${pm(competencia.estrella.resenas ?? 0)}).`)
  }
  const codigosActivos = paises.filter((p) => p.presente === true).map((p) => p.codigo.toUpperCase())
  const porAbrir = paises.filter((p) => p.presente === false).map((p) => p.codigo.toUpperCase())
  if (porAbrir.length) frases.push(`Vende en ${codigosActivos.join(', ') || 'ES'}; no en ${porAbrir.join(', ')}.`)
  const guion = { tipo: tipoTexto, frases: frases.slice(0, 6) }

  return {
    fecha: e.fecha,
    vendedor: {
      id: sellerId,
      nombre: s.sellerName ?? sellerId,
      empresa: s.businessName ?? null,
      ciudad: Array.isArray(s.address) && s.address.length >= 3 ? capitalizar(String(s.address[s.address.length - 3])) : null,
      desde: fechaKeepa(s.trackedSince),
      url: `https://www.${DOMINIO_PAIS.es}/sp?seller=${sellerId}`,
    },
    tipo,
    tipoTexto,
    tipoPorQue,
    cifras: {
      productos: s.asinList?.length ?? 0,
      buyBox: num(s.buyBoxNewOwnershipRate),
      competidoresBuyBox: competidores,
      positivas12m: valoraciones[2].positivas,
      valoraciones12m: valoraciones[2].numero,
      positivasTotal: valoraciones[3].positivas,
      valoracionesTotal: valoraciones[3].numero,
      fba,
      mercadosActivos,
    },
    valoraciones,
    ultimasOpiniones,
    marcas,
    paises,
    productos,
    oportunidades: op,
    fortalezas: fortalezas.slice(0, 4),
    plan,
    seo,
    puedeEditarFichas,
    guion,
    competencia,
    ventas,
    resumen,
  }
}
