export type MarketingCampaignType =
  | 'auto'
  | 'frase_h10'
  | 'asin_h10'
  | 'exacta'
  | 'asin_exacta'
  | 'brand_defend'

export type MarketingCampaignStatus = 'activa' | 'pausada' | 'archivada'
export type MarketingReviewStatus = 'pendiente' | 'hecho'
export type MarketingWeekStatus = 'pendiente' | 'en_curso' | 'hecho'
export type MarketingMatchType = 'exacta' | 'frase' | 'amplia' | 'auto' | 'asin'
export type MarketingBidAction =
  | 'mantener'
  | 'subir'
  | 'bajar'
  | 'pausar'
  | 'negativizar'
  | 'nueva'

/** Tipos de cambio conocidos. La columna es TEXT libre, así que puede llegar cualquier otro */
export type MarketingChangeType =
  | 'puja'
  | 'presupuesto'
  | 'estado_campana'
  | 'keyword_nueva'
  | 'keyword_negativa'
  | 'campana_nueva'
  | 'segmentacion'
  | 'otro'

export interface MarketingClient {
  id: string
  name: string
  /** Hex con almohadilla */
  color: string
  amazon_seller_url: string | null
  is_active: boolean
  position: number | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface MarketingWeek {
  id: string
  client_id: string
  /** 'yyyy-MM-dd', lunes */
  week_start: string
  /** 'yyyy-MM-dd', domingo */
  week_end: string
  label: string | null
  status: MarketingWeekStatus
  notes: string | null
  created_at: string
  updated_at: string
}

export interface MarketingProduct {
  id: string
  client_id: string
  /** Clave de enlace con las campañas. Un trigger lo normaliza a mayúsculas y sin espacios */
  asin: string
  sku: string | null
  name: string | null
  is_active: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

/** Las cifras del producto en una semana de revisión: lo que se vuelca de Sellerboard */
export interface MarketingProductWeek {
  id: string
  product_id: string
  week_id: string
  /** Ventas totales del producto, orgánicas + publicidad. NULL = aún no volcado, 0 = cero real */
  total_sales: number | null
  units_sold: number | null
  /** Coste del producto esa semana, por unidad */
  unit_cost: number | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface MarketingCampaign {
  id: string
  week_id: string
  /** Producto que anuncia; se propone con extractAsin() sobre el nombre y se puede corregir a mano */
  product_id: string | null
  name: string
  campaign_type: MarketingCampaignType
  status: MarketingCampaignStatus
  daily_budget: number | null
  impressions: number | null
  clicks: number | null
  orders: number | null
  spend: number | null
  sales: number | null
  /** Porcentajes tal cual los reporta Amazon; si vienen a null se calculan con los helpers */
  ctr: number | null
  cvr: number | null
  acos: number | null
  /**
   * @deprecated Histórico de solo lectura. El TACoS no es de la campaña sino del
   * producto: se calcula con productTacos() sobre MarketingProductWeek.total_sales.
   */
  tacos: number | null
  review_status: MarketingReviewStatus
  notes: string | null
  position: number | null
  created_at: string
  updated_at: string
}

export interface MarketingKeyword {
  id: string
  campaign_id: string
  keyword: string
  match_type: MarketingMatchType
  current_bid: number | null
  suggested_bid: number | null
  action: MarketingBidAction
  /** Ya ejecutado en Seller Central */
  applied: boolean
  impressions: number | null
  clicks: number | null
  orders: number | null
  spend: number | null
  sales: number | null
  acos: number | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface MarketingChange {
  id: string
  week_id: string
  campaign_id: string | null
  keyword_id: string | null
  author_id: string | null
  change_type: string
  description: string | null
  before_value: string | null
  after_value: string | null
  created_at: string
}

/**
 * Los seis tipos que usa Liberty Seller, en el orden del embudo: primero
 * las «fábricas», que descubren términos, y luego las de cosecha, donde se
 * meten los que ya han demostrado ser rentables.
 */
export const CAMPAIGN_TYPES: MarketingCampaignType[] = [
  'auto',
  'frase_h10',
  'asin_h10',
  'exacta',
  'asin_exacta',
  'brand_defend',
]

export const CAMPAIGN_TYPE_LABELS: Record<MarketingCampaignType, string> = {
  auto: 'Auto',
  frase_h10: 'Manual Frase H10',
  asin_h10: 'Manual ASIN H10',
  exacta: 'Manual Exacta',
  asin_exacta: 'Manual ASIN Exacta',
  brand_defend: 'Manual Brand Defend',
}

/** Qué papel juega cada tipo, para que no haga falta tenerlo en la cabeza */
export const CAMPAIGN_TYPE_HINTS: Record<MarketingCampaignType, string> = {
  auto: 'Campaña automática, fábrica de keywords',
  frase_h10: 'Fábrica de keywords extraídas de H10',
  asin_h10: 'Fábrica de ASINs extraídos de H10',
  exacta: 'Exactas cosechadas y rentables',
  asin_exacta: 'ASINs cosechados y rentables',
  brand_defend: 'Estrategia de defensa de marca',
}

/**
 * Mismo código de color que el documento de estrategia: ámbar las
 * fábricas, verde lo cosechado y rentable, naranja la defensa de marca.
 */
export const CAMPAIGN_TYPE_COLORS: Record<MarketingCampaignType, string> = {
  auto: '#FBBF24',
  frase_h10: '#FBBF24',
  asin_h10: '#FBBF24',
  exacta: '#34D399',
  asin_exacta: '#34D399',
  brand_defend: '#FF6600',
}

export const CAMPAIGN_STATUSES: MarketingCampaignStatus[] = ['activa', 'pausada', 'archivada']

export const CAMPAIGN_STATUS_LABELS: Record<MarketingCampaignStatus, string> = {
  activa: 'Activa',
  pausada: 'Pausada',
  archivada: 'Archivada',
}

export const CAMPAIGN_STATUS_COLORS: Record<MarketingCampaignStatus, string> = {
  activa: '#34D399',
  pausada: '#FBBF24',
  archivada: '#64748B',
}

export const REVIEW_STATUSES: MarketingReviewStatus[] = ['pendiente', 'hecho']

export const REVIEW_STATUS_LABELS: Record<MarketingReviewStatus, string> = {
  pendiente: 'Pendiente',
  hecho: 'Hecho',
}

export const REVIEW_STATUS_COLORS: Record<MarketingReviewStatus, string> = {
  pendiente: '#FBBF24',
  hecho: '#34D399',
}

export const WEEK_STATUSES: MarketingWeekStatus[] = ['pendiente', 'en_curso', 'hecho']

export const WEEK_STATUS_LABELS: Record<MarketingWeekStatus, string> = {
  pendiente: 'Pendiente',
  en_curso: 'En curso',
  hecho: 'Hecho',
}

export const WEEK_STATUS_COLORS: Record<MarketingWeekStatus, string> = {
  pendiente: '#FBBF24',
  en_curso: '#06B6D4',
  hecho: '#34D399',
}

export const MATCH_TYPES: MarketingMatchType[] = ['exacta', 'frase', 'amplia', 'auto', 'asin']

export const MATCH_TYPE_LABELS: Record<MarketingMatchType, string> = {
  exacta: 'Exacta',
  frase: 'Frase',
  amplia: 'Amplia',
  auto: 'Automática',
  asin: 'ASIN',
}

export const MATCH_TYPE_COLORS: Record<MarketingMatchType, string> = {
  exacta: '#34D399',
  frase: '#06B6D4',
  amplia: '#A855F7',
  auto: '#94A3B8',
  asin: '#FB7185',
}

export const BID_ACTIONS: MarketingBidAction[] = [
  'mantener',
  'subir',
  'bajar',
  'pausar',
  'negativizar',
  'nueva',
]

export const BID_ACTION_LABELS: Record<MarketingBidAction, string> = {
  mantener: 'Mantener',
  subir: 'Subir puja',
  bajar: 'Bajar puja',
  pausar: 'Pausar',
  negativizar: 'Negativizar',
  nueva: 'Nueva',
}

export const BID_ACTION_COLORS: Record<MarketingBidAction, string> = {
  mantener: '#94A3B8',
  subir: '#34D399',
  bajar: '#FBBF24',
  pausar: '#FB7185',
  negativizar: '#EF4444',
  nueva: '#FF6600',
}

export const CHANGE_TYPES: MarketingChangeType[] = [
  'puja',
  'presupuesto',
  'estado_campana',
  'keyword_nueva',
  'keyword_negativa',
  'campana_nueva',
  'segmentacion',
  'otro',
]

export const CHANGE_TYPE_LABELS: Record<MarketingChangeType, string> = {
  puja: 'Puja',
  presupuesto: 'Presupuesto',
  estado_campana: 'Estado de campaña',
  keyword_nueva: 'Keyword nueva',
  keyword_negativa: 'Keyword negativa',
  campana_nueva: 'Campaña nueva',
  segmentacion: 'Segmentación',
  otro: 'Otro',
}

export const CHANGE_TYPE_COLORS: Record<MarketingChangeType, string> = {
  puja: '#FF6600',
  presupuesto: '#06B6D4',
  estado_campana: '#A855F7',
  keyword_nueva: '#34D399',
  keyword_negativa: '#EF4444',
  campana_nueva: '#FBBF24',
  segmentacion: '#FB7185',
  otro: '#64748B',
}

/** Etiqueta de un tipo de cambio; la columna es TEXT libre, así que cae al valor crudo si no se conoce */
export function changeTypeLabel(type: string): string {
  return CHANGE_TYPE_LABELS[type as MarketingChangeType] ?? type
}

const MONTHS_SHORT = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
]

const DAY_MS = 24 * 60 * 60 * 1000

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

// Toda la aritmética de fechas va en UTC: con horas locales, un cambio de hora
// a mitad de semana desplaza un día y el lunes deja de ser lunes.
function parseDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function toDay(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS)
}

/** Lunes de la semana en curso, 'yyyy-MM-dd' */
export function currentWeekStart(from = new Date()): string {
  const today = new Date(Date.UTC(from.getFullYear(), from.getMonth(), from.getDate()))
  const sinceMonday = (today.getUTCDay() + 6) % 7
  return toDay(addDays(today, -sinceMonday))
}

/** Domingo de la semana que arranca en `weekStart` */
export function weekEndFor(weekStart: string): string {
  return toDay(addDays(parseDay(weekStart), 6))
}

/** El mismo lunes desplazado `weeks` semanas (negativo hacia atrás) */
export function shiftWeek(weekStart: string, weeks: number): string {
  return toDay(addDays(parseDay(weekStart), weeks * 7))
}

/** «Semana 27 jul – 2 ago»; si no cruza de mes, «Semana 3 – 9 ago» */
export function weekLabel(weekStart: string): string {
  const start = parseDay(weekStart)
  const end = addDays(start, 6)
  const startMonth = MONTHS_SHORT[start.getUTCMonth()]
  const endMonth = MONTHS_SHORT[end.getUTCMonth()]
  return startMonth === endMonth
    ? `Semana ${start.getUTCDate()} – ${end.getUTCDate()} ${endMonth}`
    : `Semana ${start.getUTCDate()} ${startMonth} – ${end.getUTCDate()} ${endMonth}`
}

/** Número de semana ISO 8601: el «Semana 28» con el que se nombran las campañas en Amazon */
export function isoWeekNumber(day: string): number {
  // Se salta al jueves de esa semana porque el año ISO es el del jueves
  const thursday = parseDay(day)
  thursday.setUTCDate(thursday.getUTCDate() + 3 - ((thursday.getUTCDay() + 6) % 7))
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4))
  firstThursday.setUTCDate(firstThursday.getUTCDate() + 3 - ((firstThursday.getUTCDay() + 6) % 7))
  return 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * DAY_MS))
}

type Metric = number | null | undefined

// Denominador a cero devuelve null, no 0 ni Infinity: una campaña sin
// impresiones no tiene un CTR del 0 %, no tiene CTR, y pintar un 0 haría
// creer que rinde mal en vez de que no ha salido.
function ratio(numerator: Metric, denominator: Metric): number | null {
  if (numerator == null || denominator == null) return null
  const n = Number(numerator)
  const d = Number(denominator)
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null
  return (n / d) * 100
}

/** Clics sobre impresiones, en % */
export function ctr(clicks: Metric, impressions: Metric): number | null {
  return ratio(clicks, impressions)
}

/** Pedidos sobre clics, en % */
export function cvr(orders: Metric, clicks: Metric): number | null {
  return ratio(orders, clicks)
}

/** Gasto sobre ventas atribuidas a los anuncios, en % */
export function acos(spend: Metric, sales: Metric): number | null {
  return ratio(spend, sales)
}

/**
 * Gasto sobre la facturación total, en %.
 * @deprecated A nivel de campaña no significa nada; usa productTacos().
 */
export function tacos(spend: Metric, totalSales: Metric): number | null {
  return ratio(spend, totalSales)
}

// Las campañas se nombran «ASIN | SKU | RESUMEN TITULO | TIPO DE CAMPAÑA», así
// que el ASIN de cabeza dice qué producto anuncian.
//
// Se exige que el ASIN acabe en algo no alfanumérico (el « |», un espacio) o en
// fin de cadena para no morder los diez primeros caracteres de un código más
// largo y dar por bueno un ASIN que no existe. El segundo patrón es el ISBN-10,
// cuyo dígito de control puede ser una X.
const CAMPAIGN_ASIN = /^(B[0-9A-Z]{9}|[0-9]{9}[0-9X])([^0-9A-Z]|$)/

/**
 * ASIN con el que empieza el nombre de una campaña, para proponer con qué
 * producto enlazarla. `null` si el nombre no sigue la convención.
 *
 * OJO: es la misma regla que la función SQL `public.marketing_campaign_asin`
 * (migración 109), que es la que enlaza de verdad en base de datos. Las dos
 * implementaciones tienen que mantenerse idénticas: si divergen, la interfaz
 * propondrá un producto distinto del que acabará guardado.
 */
export function extractAsin(campaignName: string): string | null {
  if (!campaignName) return null
  const match = CAMPAIGN_ASIN.exec(campaignName.trim().toUpperCase())
  return match ? match[1] : null
}

/**
 * TACoS del producto, en %: gasto publicitario de TODAS sus campañas de la
 * semana sobre las ventas totales de Sellerboard (orgánicas + publicidad).
 *
 * A diferencia del ACoS, no se puede calcular por campaña: las ventas totales
 * son del producto entero y repartirlas entre sus campañas las contaría varias
 * veces.
 */
export function productTacos(adSpend: Metric, totalSales: Metric): number | null {
  return ratio(adSpend, totalSales)
}

/**
 * Margen bruto de la semana en euros: ventas totales menos el coste de las
 * unidades vendidas. `null` si falta cualquiera de los tres datos.
 *
 * Es bruto de verdad: no descuenta ni la publicidad ni las comisiones de
 * Amazon, solo el coste del producto que se documenta semana a semana.
 */
export function grossMargin(totalSales: Metric, unitCost: Metric, unitsSold: Metric): number | null {
  if (totalSales == null || unitCost == null || unitsSold == null) return null
  const sales = Number(totalSales)
  const cost = Number(unitCost)
  const units = Number(unitsSold)
  if (!Number.isFinite(sales) || !Number.isFinite(cost) || !Number.isFinite(units)) return null
  return sales - cost * units
}

/** Porcentaje en formato español, «—» si no hay dato */
export function formatPct(value: Metric, decimals = 2): string {
  if (value == null || !Number.isFinite(Number(value))) return '—'
  return `${Number(value).toLocaleString('es-ES', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })} %`
}

/** Importe en euros con céntimos, «—» si no hay dato */
export function formatEuros(value: Metric, decimals = 2): string {
  if (value == null || !Number.isFinite(Number(value))) return '—'
  return `${Number(value).toLocaleString('es-ES', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })} €`
}

/** Entero con separador de miles, «—» si no hay dato */
export function formatInt(value: Metric): string {
  if (value == null || !Number.isFinite(Number(value))) return '—'
  return Math.round(Number(value)).toLocaleString('es-ES')
}

// =====================================================
// Agregados de producto y semana
// =====================================================
// Vive aquí y no junto a la tabla porque ya son tres los sitios que pintan el
// TACoS —la tabla de productos, el KPI de cabecera y la hoja de Excel— y el
// informe del cliente no puede decir un número distinto del que se ve en
// pantalla. `lib/types` es lo único que importan a la vez el componente de
// cliente, el server component y la route: dejarlo en components/ obligaría a
// la API a importar un módulo de interfaz.

/** Lo que hace falta de una campaña para repartir su gasto entre productos */
export interface CampaignSpendRow {
  product_id: string | null
  spend: number | null
}

export interface ProductWeekStats {
  product: MarketingProduct
  /** Fila de cifras de Sellerboard; null mientras nadie la haya abierto esa semana */
  row: MarketingProductWeek | null
  /** Gasto sumado de TODAS las campañas de la semana enlazadas a este producto */
  adSpend: number
  /** Cuántas campañas de la semana lo anuncian */
  campaigns: number
  totalSales: number | null
  unitsSold: number | null
  unitCost: number | null
  tacos: number | null
  margin: number | null
  /**
   * Se está gastando dinero en él y nadie ha volcado sus ventas totales: es
   * justo el producto que deja el TACoS de la semana a ciegas.
   */
  blind: boolean
}

/**
 * Cruza el catálogo de productos con sus cifras de la semana y con el gasto de
 * las campañas que los anuncian.
 *
 * `campaigns` tienen que ser SOLO las de la semana que se está mirando: el
 * gasto de otra semana entraría en el numerador contra unas ventas que no le
 * corresponden.
 */
export function productWeekStats(
  products: MarketingProduct[],
  rows: MarketingProductWeek[],
  campaigns: CampaignSpendRow[]
): ProductWeekStats[] {
  const byProduct = new Map<string, MarketingProductWeek>()
  for (const r of rows) byProduct.set(r.product_id, r)

  const spend = new Map<string, { spend: number; campaigns: number }>()
  for (const c of campaigns) {
    if (!c.product_id) continue
    const entry = spend.get(c.product_id) ?? { spend: 0, campaigns: 0 }
    entry.spend += Number(c.spend) || 0
    entry.campaigns += 1
    spend.set(c.product_id, entry)
  }

  return products.map((product) => {
    const row = byProduct.get(product.id) ?? null
    const ads = spend.get(product.id) ?? { spend: 0, campaigns: 0 }
    const totalSales = row?.total_sales ?? null

    return {
      product,
      row,
      adSpend: ads.spend,
      campaigns: ads.campaigns,
      totalSales,
      unitsSold: row?.units_sold ?? null,
      unitCost: row?.unit_cost ?? null,
      tacos: productTacos(ads.spend, totalSales),
      margin: grossMargin(totalSales, row?.unit_cost ?? null, row?.units_sold ?? null),
      blind: totalSales == null && ads.spend > 0,
    }
  })
}

export interface ClientTacos {
  /** TACoS de los productos que SÍ tienen ventas volcadas; null si no hay ninguno */
  tacos: number | null
  /** Gasto que entra en el numerador */
  spend: number
  /** Ventas totales que entran en el denominador */
  totalSales: number
  /** Gasto de la semana que se queda fuera del cálculo */
  uncoveredSpend: number
  /** Productos con gasto y sin ventas totales volcadas */
  blindProducts: number
  /** Campañas con gasto y sin producto enlazado */
  unlinkedCampaigns: number
  /** El número es real pero no cubre toda la cuenta: hay que decirlo */
  partial: boolean
}

/**
 * TACoS agregado del cliente en la semana.
 *
 * Numerador y denominador se restringen a los MISMOS productos: solo entran los
 * que tienen ventas totales volcadas. Meter todo el gasto de la semana sobre las
 * ventas de la mitad de los productos daría un TACoS inflado con pinta de dato
 * bueno, que es peor que no dar ninguno. Lo que queda fuera se devuelve aparte
 * para poder avisar de que la cifra es parcial.
 */
export function clientTacos(
  stats: ProductWeekStats[],
  campaigns: CampaignSpendRow[]
): ClientTacos {
  let spend = 0
  let totalSales = 0
  let blindProducts = 0

  for (const s of stats) {
    if (s.totalSales == null) {
      if (s.blind) blindProducts += 1
      continue
    }
    spend += s.adSpend
    totalSales += Number(s.totalSales) || 0
  }

  const weekSpend = campaigns.reduce((acc, c) => acc + (Number(c.spend) || 0), 0)
  const unlinkedCampaigns = campaigns.filter(
    (c) => !c.product_id && (Number(c.spend) || 0) > 0
  ).length

  // Céntimo arriba o abajo por el redondeo de los flotantes no es un agujero.
  const uncoveredSpend = Math.max(0, weekSpend - spend)

  return {
    tacos: productTacos(spend, totalSales),
    spend,
    totalSales,
    uncoveredSpend: uncoveredSpend < 0.005 ? 0 : uncoveredSpend,
    blindProducts,
    unlinkedCampaigns,
    partial: blindProducts > 0 || unlinkedCampaigns > 0,
  }
}
