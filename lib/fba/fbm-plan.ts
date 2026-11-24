import type { SerieSku } from './plan-tipos'

/**
 * LAS VENTAS FBM EN EL PLAN DE REPOSICIÓN — PURO (24 nov 2026). Se comprueba con fbm-plan.prueba.ts.
 * ===================================================================================================
 * El ritmo del plan sale del libro mayor de FBA. Aquí se le suman las ventas FBM del MISMO ASIN (otro SKU, el que sirve el cliente desde su almacén):
 *
 *   · Días con stock en FBA: las ventas FBM de ese día se suman. Es demanda del producto que fue a la oferta del cliente; con stock en Amazon de
 *     sobra, la oferta destacada suele ser la de FBA y esas ventas pasan a ser FBA.
 *   · Días SIN stock en FBA: antes no contaban (no había qué vender). Si ese día el ASIN vendía por FBM —hubo alguna venta FBM en 7 días alrededor—
 *     el día cuenta como día de venta y con sus ventas FBM: es justo el caso de un producto que vende 4 pares al día por FBM y 0 por FBA.
 *   · Días sin libro (atraso): no se tocan.
 *
 * Si varios SKU FBA comparten un ASIN, las ventas FBM van al primero (por orden alfabético) para no contarlas dos veces. Las ventas FBM de un ASIN
 * que no está en el plan (sin stock ni movimientos en FBA) salen aparte: «vende por FBM y no está en FBA».
 */

export interface VentaFbm {
  fecha: string
  sku: string
  asin: string | null
  unidades: number
}

export interface FbmSinFba {
  /** El ASIN (o el SKU FBM si la venta no trae ASIN) */
  asin: string | null
  skus: string[]
  ventas30: number
  ventas90: number
  ultimaVenta: string
}

/** Días alrededor de un día sin stock FBA en los que una venta FBM demuestra que la oferta del cliente estaba viva */
export const DIAS_FBM_VIVO = 7

const DIA_MS = 86_400_000
const aMs = (f: string) => Date.parse(`${f}T00:00:00Z`)
const sumarDias = (f: string, n: number) => new Date(aMs(f) + n * DIA_MS).toISOString().slice(0, 10)

/** Reparte las ventas FBM: por SKU FBA del plan (por su ASIN) y, las que no casan, la lista de «sin FBA» */
export function repartirFbm(
  ventas: readonly VentaFbm[],
  skusDelPlan: readonly string[],
  asinDeSku: ReadonlyMap<string, string | null>,
  hasta: string,
): { porSku: Map<string, Map<string, number>>; sinFba: FbmSinFba[] } {
  const skuDeAsin = new Map<string, string>()
  const delPlan = new Set(skusDelPlan)
  for (const sku of [...skusDelPlan].sort()) {
    const a = asinDeSku.get(sku)
    if (a && !skuDeAsin.has(a)) skuDeAsin.set(a, sku)
  }
  const porSku = new Map<string, Map<string, number>>()
  const sueltas = new Map<string, FbmSinFba>()
  const d30 = sumarDias(hasta, -29)
  const d90 = sumarDias(hasta, -89)
  for (const v of ventas) {
    if (!(v.unidades > 0) || v.fecha > hasta) continue
    const destino = (v.asin && skuDeAsin.get(v.asin)) || (delPlan.has(v.sku) ? v.sku : null)
    if (destino) {
      const m = porSku.get(destino) ?? new Map<string, number>()
      m.set(v.fecha, (m.get(v.fecha) ?? 0) + v.unidades)
      porSku.set(destino, m)
      continue
    }
    if (v.fecha < d90) continue
    const k = v.asin ?? `sku:${v.sku}`
    const s = sueltas.get(k) ?? { asin: v.asin, skus: [], ventas30: 0, ventas90: 0, ultimaVenta: v.fecha }
    if (!s.skus.includes(v.sku)) s.skus.push(v.sku)
    s.ventas90 += v.unidades
    if (v.fecha >= d30) s.ventas30 += v.unidades
    if (v.fecha > s.ultimaVenta) s.ultimaVenta = v.fecha
    sueltas.set(k, s)
  }
  const sinFba = [...sueltas.values()].sort((a, b) => b.ventas90 - a.ventas90 || (a.asin ?? '').localeCompare(b.asin ?? ''))
  return { porSku, sinFba }
}

/**
 * La serie de un SKU con sus ventas FBM sumadas (ver la cabecera). `desdeFbm` es desde cuándo hay pedidos leídos: antes, no se sabe si vendía por FBM
 * y la serie se queda como estaba. Devuelve una serie NUEVA (no toca la de entrada) y las unidades FBM que se han sumado.
 */
export function sumarFbmASerie(serie: SerieSku, fbm: ReadonlyMap<string, number> | undefined, desdeFbm: string | null): { serie: SerieSku; sumadas: number } {
  if (!fbm || fbm.size === 0 || !desdeFbm) return { serie, sumadas: 0 }
  const dias = [...fbm.keys()].sort()
  const vivo = (f: string): boolean => {
    const a = sumarDias(f, -DIAS_FBM_VIVO)
    const b = sumarDias(f, DIAS_FBM_VIVO)
    // Búsqueda binaria del primer día ≥ a
    let lo = 0
    let hi = dias.length
    while (lo < hi) {
      const m = (lo + hi) >> 1
      if (dias[m] < a) lo = m + 1
      else hi = m
    }
    return lo < dias.length && dias[lo] <= b
  }
  const ventas = [...serie.ventas]
  const conStock = [...serie.conStock]
  let sumadas = 0
  for (let i = 0; i < serie.fechas.length; i++) {
    const f = serie.fechas[i]
    if (f < desdeFbm) continue
    const c = conStock[i]
    if (c === null) continue
    const u = fbm.get(f) ?? 0
    if (c) {
      ventas[i] += u
      sumadas += u
    } else if (vivo(f)) {
      conStock[i] = true
      ventas[i] += u
      sumadas += u
    }
  }
  return { serie: { ...serie, ventas, conStock }, sumadas }
}

/** Las unidades FBM de un SKU en un tramo [desde, hasta] (para la frase y las estadísticas) */
export function fbmEntre(fbm: ReadonlyMap<string, number> | undefined, desde: string, hasta: string): number {
  if (!fbm) return 0
  let s = 0
  for (const [f, u] of fbm) if (f >= desde && f <= hasta) s += u
  return s
}
