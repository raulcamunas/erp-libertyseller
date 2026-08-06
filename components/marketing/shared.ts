import { createClient } from '@/lib/supabase/client'
import { MarketingChange, acos, ctr, cvr } from '@/lib/types/marketing'

type MarketingSupabase = ReturnType<typeof createClient>

// ---------- Edición en línea ----------
// Mismo lenguaje que la tabla de tesorería: el campo no parece un campo hasta
// que se pasa por encima, para que una tabla de catorce columnas no se vea
// como un formulario.
//
// El armazón deja fuera el tamaño y el color del texto y cada variante los
// pone: si se heredaran y luego se reañadieran, dos utilidades del mismo grupo
// convivirían en la misma clase y quién gana lo decidiría el orden de la hoja
// de estilos, no el del string.
const cellShell =
  'bg-transparent hover:bg-white/[0.05] focus:bg-white/[0.08] border border-transparent focus:border-[#FF6600] rounded px-1.5 py-1 outline-none transition-colors placeholder:text-white/20'

export const numInput = `w-full ${cellShell} text-[12px] text-white text-right tabular-nums`
export const textInput = `w-full ${cellShell} text-[12px] text-white`
/** Sin color de texto: los selects del módulo lo llevan en `style`, con el del enum */
export const selectInput = `${cellShell} text-[11px] font-semibold cursor-pointer appearance-none`

/** Las opciones de un <select> nativo heredan el fondo del sistema, no el del ERP */
export const optionClass = 'bg-[#1a1a1a] text-white'

/** Valor de un campo numérico opcional; vacío cuando todavía no hay dato */
export function inputValue(value: number | null | undefined): string {
  return value == null ? '' : String(value)
}

/**
 * Número tecleado en español (coma o punto decimal).
 * `null` = el campo se ha vaciado a propósito, `undefined` = no es un número
 * y hay que descartar la edición sin tocar la base de datos.
 */
export function parseDecimal(raw: string): number | null | undefined {
  const v = raw.trim()
  if (v === '') return null
  const n = Number(v.replace(',', '.'))
  return Number.isFinite(n) ? n : undefined
}

/** Igual que parseDecimal pero entero: impresiones, clics y pedidos no llevan decimales */
export function parseInteger(raw: string): number | null | undefined {
  const n = parseDecimal(raw)
  return typeof n === 'number' ? Math.round(n) : n
}

// ---------- Agregados ----------

/** Lo mínimo que hace falta para sumar: lo cumplen tanto las campañas como las keywords */
export interface MetricRow {
  impressions: number | null
  clicks: number | null
  orders: number | null
  spend: number | null
  sales: number | null
}

export interface MarketingTotals {
  impressions: number
  clicks: number
  orders: number
  spend: number
  sales: number
  ctr: number | null
  cvr: number | null
  acos: number | null
}

/**
 * Suma un conjunto de filas y recalcula los porcentajes sobre los totales.
 *
 * Los porcentajes NO se promedian: la media de los ACoS de cinco campañas no es
 * el ACoS de la cuenta, porque una campaña de 3 € pesaría lo mismo que otra de
 * 300 €. Se recalculan desde las sumas de gasto y ventas.
 *
 * Aquí ya no sale ningún TACoS. Antes se sumaba fila a fila dando por hecho que
 * cada campaña lo medía contra la misma facturación, y eso era falso: el
 * denominador son las ventas totales del PRODUCTO, así que un producto con
 * cinco campañas contaba sus ventas cinco veces. El TACoS bueno se calcula con
 * productWeekStats() / clientTacos(), que agrupan por producto antes de dividir.
 */
type RawTotals = Pick<
  MarketingTotals,
  'impressions' | 'clicks' | 'orders' | 'spend' | 'sales'
>

export function sumMetrics(rows: MetricRow[]): MarketingTotals {
  const totals = rows.reduce<RawTotals>(
    (acc, r) => ({
      impressions: acc.impressions + (Number(r.impressions) || 0),
      clicks: acc.clicks + (Number(r.clicks) || 0),
      orders: acc.orders + (Number(r.orders) || 0),
      spend: acc.spend + (Number(r.spend) || 0),
      sales: acc.sales + (Number(r.sales) || 0),
    }),
    { impressions: 0, clicks: 0, orders: 0, spend: 0, sales: 0 }
  )

  return {
    ...totals,
    ctr: ctr(totals.clicks, totals.impressions),
    cvr: cvr(totals.orders, totals.clicks),
    acos: acos(totals.spend, totals.sales),
  }
}

// ---------- Producto y semana ----------
// El cálculo del TACoS se mudó a lib/types/marketing.ts y aquí solo se
// reexporta: la route del Excel lo necesita y no puede importar un módulo de
// components/ —le bastaría con que alguien le pusiera un 'use client' a este
// fichero para romper la exportación—. Se reexporta para que los componentes
// sigan tirando de './shared' y el módulo tenga una sola puerta de entrada.
export {
  productWeekStats,
  clientTacos,
} from '@/lib/types/marketing'
export type {
  CampaignSpendRow,
  ProductWeekStats,
  ClientTacos,
} from '@/lib/types/marketing'

// ---------- Diario de cambios ----------

export interface MarketingChangeDraft {
  week_id: string
  campaign_id?: string | null
  keyword_id?: string | null
  change_type: string
  description?: string | null
  before_value?: string | null
  after_value?: string | null
}

/**
 * Apunta una línea en el diario de la semana y devuelve la fila insertada para
 * que quien llame la pinte sin recargar.
 *
 * Devuelve null en lugar de propagar el error: cuando se llama a esto el cambio
 * de verdad (la puja, el estado) ya está guardado en su tabla, así que hacer
 * fallar la edición por no poder anotarla sería peor que quedarse sin la
 * anotación. Por eso tampoco saca un toast — se queda en la consola.
 */
export async function logMarketingChange(
  supabase: MarketingSupabase,
  authorId: string | null,
  draft: MarketingChangeDraft
): Promise<MarketingChange | null> {
  const { data, error } = await supabase
    .from('marketing_changes')
    .insert({
      campaign_id: null,
      keyword_id: null,
      description: null,
      before_value: null,
      after_value: null,
      ...draft,
      author_id: authorId,
    })
    .select('*')
    .single()

  if (error) {
    console.error('Error registrando el cambio en el diario:', error)
    return null
  }
  return data as MarketingChange
}
