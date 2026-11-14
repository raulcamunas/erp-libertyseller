/**
 * AMAZON ADS · LAS SEGMENTACIONES DE UNA CAMPAÑA: lo que se lee del informe «spTargeting», cómo se resume por segmentación y cómo se llama cada una en pantalla.
 *
 * Funciones PURAS (sin base de datos ni Amazon): se importan igual desde el servidor que desde la pantalla, y se prueban sin red.
 *
 * «Segmentación» es lo que Amazon llama targeting: una KEYWORD (texto + concordancia amplia, frase o exacta), un PRODUCTO o categoría al que se apunta (ASIN, categoría, marca) o una de las
 * cuatro CLÁUSULAS de la automática (coincidencia cercana, amplia, sustitutos, complementos). En el informe todas llevan su id en `keywordId`.
 */

export interface FilaDeObjetivo {
  fecha: string
  objetivoId: string
  campaignId: string
  adGroupId: string
  texto: string
  coincidencia: string | null
  tipo: string | null
  impresiones: number
  clics: number
  gasto: number
  ventas: number
  pedidos: number
  unidades: number
}

const num = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** De las filas crudas del informe spTargeting a filas limpias. Las que no traen id de segmentación o de campaña se descartan */
export function filasDeObjetivos(crudas: ReadonlyArray<Record<string, unknown>>): FilaDeObjetivo[] {
  const salida: FilaDeObjetivo[] = []
  for (const r of crudas) {
    const objetivoId = r.keywordId == null ? '' : String(r.keywordId)
    const campaignId = r.campaignId == null ? '' : String(r.campaignId)
    if (!objetivoId || !campaignId) continue
    salida.push({
      fecha: String(r.date ?? '').slice(0, 10),
      objetivoId,
      campaignId,
      adGroupId: r.adGroupId == null ? '' : String(r.adGroupId),
      texto: String(r.keyword ?? r.targeting ?? ''),
      coincidencia: r.matchType == null ? null : String(r.matchType),
      tipo: r.keywordType == null ? null : String(r.keywordType),
      impresiones: num(r.impressions),
      clics: num(r.clicks),
      gasto: num(r.cost),
      ventas: num(r.sales7d),
      pedidos: num(r.purchases7d),
      unidades: num(r.unitsSoldClicks7d),
    })
  }
  return salida
}

export interface MetricasDeObjetivo {
  impresiones: number
  clics: number
  gasto: number
  ventas: number
  pedidos: number
  unidades: number
  /** Clics ÷ impresiones */
  ctr: number | null
  /** Gasto ÷ clics */
  cpc: number | null
  /** Gasto ÷ ventas */
  acos: number | null
  roas: number | null
  /** Pedidos ÷ clics: la conversión */
  cvr: number | null
}

export const METRICAS_VACIAS: MetricasDeObjetivo = { impresiones: 0, clics: 0, gasto: 0, ventas: 0, pedidos: 0, unidades: 0, ctr: null, cpc: null, acos: null, roas: null, cvr: null }

/** Las métricas derivadas a partir de las sumas. null cuando el denominador es cero: un «0 %» inventado se leería como un dato */
export function conDerivadas(s: Pick<MetricasDeObjetivo, 'impresiones' | 'clics' | 'gasto' | 'ventas' | 'pedidos' | 'unidades'>): MetricasDeObjetivo {
  return {
    ...s,
    ctr: s.impresiones > 0 ? s.clics / s.impresiones : null,
    cpc: s.clics > 0 ? s.gasto / s.clics : null,
    acos: s.ventas > 0 ? s.gasto / s.ventas : null,
    roas: s.gasto > 0 ? s.ventas / s.gasto : null,
    cvr: s.clics > 0 ? s.pedidos / s.clics : null,
  }
}

/** Suma las filas diarias por segmentación */
export function sumarPorObjetivo(filas: readonly FilaDeObjetivo[]): Map<string, MetricasDeObjetivo & { texto: string; coincidencia: string | null; adGroupId: string }> {
  const m = new Map<string, { impresiones: number; clics: number; gasto: number; ventas: number; pedidos: number; unidades: number; texto: string; coincidencia: string | null; adGroupId: string }>()
  for (const f of filas) {
    const x = m.get(f.objetivoId) ?? { impresiones: 0, clics: 0, gasto: 0, ventas: 0, pedidos: 0, unidades: 0, texto: f.texto, coincidencia: f.coincidencia, adGroupId: f.adGroupId }
    x.impresiones += f.impresiones
    x.clics += f.clics
    x.gasto += f.gasto
    x.ventas += f.ventas
    x.pedidos += f.pedidos
    x.unidades += f.unidades
    m.set(f.objetivoId, x)
  }
  return new Map([...m].map(([id, x]) => [id, { ...conDerivadas(x), texto: x.texto, coincidencia: x.coincidencia, adGroupId: x.adGroupId }]))
}

/* ------------------------------------------------------------------ */
/* Cómo se llama cada segmentación                                     */
/* ------------------------------------------------------------------ */

/** Las cuatro cláusulas de la automática, en castellano */
export const CLAUSULA_AUTO: Record<string, string> = {
  QUERY_HIGH_REL_MATCHES: 'Coincidencia cercana',
  QUERY_BROAD_REL_MATCHES: 'Coincidencia amplia',
  ASIN_SUBSTITUTE_RELATED: 'Sustitutos',
  ASIN_ACCESSORY_RELATED: 'Complementos',
}

export const COINCIDENCIA_ES: Record<string, string> = { EXACT: 'Exacta', PHRASE: 'Frase', BROAD: 'Amplia' }

/** Un predicado de la expresión de una segmentación por producto, en castellano */
function predicadoEnTexto(p: { type?: string; value?: string }): string {
  const v = p.value ?? ''
  switch (p.type) {
    case 'ASIN_SAME_AS':
      return `ASIN ${v}`
    case 'ASIN_EXPANDED_FROM':
      return `ASIN ${v} y parecidos`
    case 'ASIN_CATEGORY_SAME_AS':
      return `Categoría ${v}`
    case 'ASIN_BRAND_SAME_AS':
      return `Marca ${v}`
    case 'ASIN_PRICE_LESS_THAN':
      return `precio < ${v}`
    case 'ASIN_PRICE_BETWEEN':
      return `precio ${v}`
    case 'ASIN_PRICE_GREATER_THAN':
      return `precio > ${v}`
    case 'ASIN_REVIEW_RATING_LESS_THAN':
      return `valoración < ${v}`
    case 'ASIN_REVIEW_RATING_BETWEEN':
      return `valoración ${v}`
    case 'ASIN_REVIEW_RATING_GREATER_THAN':
      return `valoración > ${v}`
    case 'ASIN_IS_PRIME_SHIPPING_ELIGIBLE':
      return 'con Prime'
    case 'ASIN_AGE_RANGE_SAME_AS':
      return `edad ${v}`
    case 'ASIN_GENRE_SAME_AS':
      return `género ${v}`
    default:
      return p.type && CLAUSULA_AUTO[p.type] ? CLAUSULA_AUTO[p.type] : [p.type, v].filter(Boolean).join(' ')
  }
}

/** El nombre de una segmentación por producto o de una cláusula automática, a partir de su expresión (la resuelta si la hay: lleva los nombres de categoría y marca) */
export function textoDeExpresion(expresion: ReadonlyArray<{ type?: string; value?: string }> | null | undefined): string {
  if (!expresion || expresion.length === 0) return '(sin expresión)'
  return expresion.map(predicadoEnTexto).join(' · ')
}

/* ------------------------------------------------------------------ */
/* Pujas                                                               */
/* ------------------------------------------------------------------ */

/** Amazon no acepta pujas por debajo de 0,02 (en la mayoría de mercados) */
export const PUJA_MINIMA = 0.02

/** Una puja tecleada o calculada, redondeada a céntimos y con el mínimo de Amazon. null si no es un número positivo */
export function pujaValida(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v)
  if (!Number.isFinite(n) || n <= 0) return null
  // + 1e-9: 0,5 × 1,15 da 0,57499999… en coma flotante y tiene que redondear a 0,58
  return Math.max(PUJA_MINIMA, Math.round(n * 100 + 1e-9) / 100)
}

/** La puja tras subirla o bajarla un tanto por ciento (+10 → ×1,10) */
export function pujaConCambio(puja: number, pct: number): number {
  return pujaValida(puja * (1 + pct / 100)) ?? PUJA_MINIMA
}
