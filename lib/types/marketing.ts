export type MarketingCampaignType =
  | 'sp_auto'
  | 'sp_manual_exacta'
  | 'sp_manual_frase'
  | 'sp_manual_amplia'
  | 'sb'
  | 'sd'

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

export interface MarketingCampaign {
  id: string
  week_id: string
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

export const CAMPAIGN_TYPES: MarketingCampaignType[] = [
  'sp_auto',
  'sp_manual_exacta',
  'sp_manual_frase',
  'sp_manual_amplia',
  'sb',
  'sd',
]

export const CAMPAIGN_TYPE_LABELS: Record<MarketingCampaignType, string> = {
  sp_auto: 'SP Automática',
  sp_manual_exacta: 'SP Exacta',
  sp_manual_frase: 'SP Frase',
  sp_manual_amplia: 'SP Amplia',
  sb: 'Sponsored Brands',
  sd: 'Sponsored Display',
}

export const CAMPAIGN_TYPE_COLORS: Record<MarketingCampaignType, string> = {
  sp_auto: '#06B6D4',
  sp_manual_exacta: '#34D399',
  sp_manual_frase: '#FBBF24',
  sp_manual_amplia: '#A855F7',
  sb: '#FF6600',
  sd: '#FB7185',
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

/** Gasto sobre la facturación total de la cuenta, en % */
export function tacos(spend: Metric, totalSales: Metric): number | null {
  return ratio(spend, totalSales)
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
