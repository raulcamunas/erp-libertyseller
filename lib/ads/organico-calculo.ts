/**
 * AMAZON ADS · DEFENDER EL ORGÁNICO. PURO.
 *
 * Si en una búsqueda el producto ya se lleva muchos clics y compras SIN pagar (sale arriba en orgánico), pujar fuerte por esa misma keyword solo compra ventas
 * que llegarían igual. Brand Analytics (Search Query Performance, seo_consultas) da por búsqueda y ASIN los clics y compras del producto, pagados y no pagados
 * juntos; restando los de publicidad en ese término (ads_terminos_semana) queda lo orgánico.
 *
 *   BAJAR 15 %  keyword (no de marca) con muestra suficiente, ACoS ≥ 0,6 × el objetivo (si es muy barata no hace falta), y en las últimas semanas el producto
 *               se lleva en esa búsqueda ≥ 20 % de los clics SIN pagar, con ≥ 30 clics y ≥ 3 compras orgánicas.
 *
 * Es una bajada que se mide como las demás (efectos: si caen las ventas TOTALES, se ve). No sube nada.
 */

export const BAJADA_ORGANICO_PCT = 15
const CUOTA_MIN = 0.2
const CLICS_MIN = 30
const COMPRAS_MIN = 3
const ACOS_MIN_X = 0.6

export interface CuotaOrganica {
  clicsTotal: number
  clicsOrganicos: number
  comprasOrganicas: number
}

/** Lo orgánico de una búsqueda: lo del producto en Brand Analytics menos lo de publicidad en ese término (nunca negativo) */
export function cuotaOrganica(sqp: { clicsTotal: number; clicsAsin: number; comprasAsin: number }, ads: { clics: number; pedidos: number }): CuotaOrganica {
  return { clicsTotal: sqp.clicsTotal, clicsOrganicos: Math.max(0, sqp.clicsAsin - ads.clics), comprasOrganicas: Math.max(0, sqp.comprasAsin - ads.pedidos) }
}

export const normalizarConsulta = (t: string) => t.trim().toLowerCase().replace(/\s+/g, ' ')

export function proponerDefensaOrganica(
  k: { puja: number; metricas: { clics: number; gasto: number; ventas: number; pedidos: number } },
  c: CuotaOrganica | undefined,
  p: { acosObjetivoPct: number; muestraMinimaClics: number },
): { pujaNueva: number; motivo: string; metricas: { cuotaOrganicaPct: number; clicsOrganicos: number; comprasOrganicas: number; acosPct: number | null } } | null {
  if (!c || !(c.clicsTotal > 0) || !(k.puja > 0)) return null
  const m = k.metricas
  if (m.clics < p.muestraMinimaClics) return null
  const acos = m.ventas > 0 ? (m.gasto / m.ventas) * 100 : null
  if (acos != null && acos < p.acosObjetivoPct * ACOS_MIN_X) return null
  const cuota = c.clicsOrganicos / c.clicsTotal
  if (cuota < CUOTA_MIN || c.clicsOrganicos < CLICS_MIN || c.comprasOrganicas < COMPRAS_MIN) return null
  const pujaNueva = Math.round(k.puja * (1 - BAJADA_ORGANICO_PCT / 100) * 100) / 100
  if (k.puja - pujaNueva < 0.02) return null
  const pct = Math.round(cuota * 100)
  return {
    pujaNueva,
    motivo: `Defensa del orgánico: en esta búsqueda el producto ya se lleva el ${pct} % de los clics sin pagar (${c.clicsOrganicos} clics y ${c.comprasOrganicas} compras orgánicas en las últimas semanas, Brand Analytics)${acos != null ? ` y la keyword va a ACoS ${acos.toFixed(1).replace('.', ',')} %` : ''}. Se baja la puja un ${BAJADA_ORGANICO_PCT} % para no pagar ventas que llegan igual; se mide con las ventas totales`,
    metricas: { cuotaOrganicaPct: pct, clicsOrganicos: c.clicsOrganicos, comprasOrganicas: c.comprasOrganicas, acosPct: acos == null ? null : Math.round(acos * 10) / 10 },
  }
}
