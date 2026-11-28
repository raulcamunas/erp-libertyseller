/**
 * AMAZON ADS · EL AJUSTE DE PUJA POR UBICACIÓN. PURO: entran las cifras de cada campaña en cada ubicación, salen propuestas con su motivo.
 *
 * Amazon cobra y convierte distinto según dónde sale el anuncio: ARRIBA DE LA BÚSQUEDA (la primera fila), el RESTO DE LA BÚSQUEDA y las PÁGINAS DE PRODUCTO
 * (la ficha de otro). La puja de cada keyword es la misma en las tres; lo que cambia es el % de ajuste de la campaña en cada ubicación (puja × (1 + %)).
 * Lo habitual: arriba de la búsqueda convierte 2–3 veces más y aguanta un ajuste alto; las páginas de producto suelen ir peor. El motor de pujas mira el ACoS
 * de la keyword sumando las tres; esto mira cada ubicación por separado y mueve SOLO su ajuste.
 *
 *   SUBIR   ≥ 3 pedidos en esa ubicación, ACoS ≤ 0,75 × el objetivo y el producto puede subir: el multiplicador (1 + %) sube lo que deja el ACoS en el 90 %
 *           del objetivo, como mucho ×1,25 de golpe. Tope: 200 % arriba de la búsqueda, 100 % en las otras dos.
 *   BAJAR   (solo si tiene ajuste) ≥ 2 pedidos con ACoS ≥ 1,25 × el objetivo: el multiplicador baja hasta dejar el ACoS en el objetivo, como mucho ×0,75 de golpe.
 *           0 pedidos con al menos 2 ÷ CVR clics: ×0,75.
 *   Muestra: al menos la muestra mínima de la ficha y 2 ÷ CVR clics en esa ubicación. Cambios de menos de 5 puntos no se proponen.
 */

export type Ubicacion = 'PLACEMENT_TOP' | 'PLACEMENT_REST_OF_SEARCH' | 'PLACEMENT_PRODUCT_PAGE'
export const UBICACIONES: readonly Ubicacion[] = ['PLACEMENT_TOP', 'PLACEMENT_REST_OF_SEARCH', 'PLACEMENT_PRODUCT_PAGE']

export const NOMBRE_DE_UBICACION: Record<Ubicacion, string> = {
  PLACEMENT_TOP: 'Arriba de la búsqueda',
  PLACEMENT_REST_OF_SEARCH: 'Resto de la búsqueda',
  PLACEMENT_PRODUCT_PAGE: 'Páginas de producto',
}

export const TOPE_PCT: Record<Ubicacion, number> = { PLACEMENT_TOP: 200, PLACEMENT_REST_OF_SEARCH: 100, PLACEMENT_PRODUCT_PAGE: 100 }
const PASO_MIN_PCT = 5
const SUBIR_MAX_X = 1.25
const BAJAR_MAX_X = 0.75
const SUBIR_SI_ACOS_X = 0.75
const BAJAR_SI_ACOS_X = 1.25
const DESTINO_SUBIR_X = 0.9

/** La ubicación del informe de Amazon (`placementClassification`, texto libre que ha cambiado de nombre) a la del ajuste. null = fuera de Amazon u otra cosa */
export function ubicacionDeInforme(texto: string | null | undefined): Ubicacion | null {
  const t = String(texto ?? '').toLowerCase()
  if (!t || /off.?amazon/.test(t)) return null
  if (/top/.test(t)) return 'PLACEMENT_TOP'
  if (/detail|product/.test(t)) return 'PLACEMENT_PRODUCT_PAGE'
  if (/rest|other/.test(t)) return 'PLACEMENT_REST_OF_SEARCH'
  return null
}

export interface MetricasDeUbicacion {
  clics: number
  gasto: number
  ventas: number
  pedidos: number
}

export interface CampanaParaUbicaciones {
  campaignId: string
  campaignName: string
  asin: string
  acosObjetivoPct: number
  /** CVR de referencia de la campaña (0–1) */
  cvr: number
  /** El % de ajuste de AHORA en cada ubicación (sin ajuste = 0) */
  ajustes: Partial<Record<Ubicacion, number>>
  metricas: Partial<Record<Ubicacion, MetricasDeUbicacion>>
  /** El producto (o la cuenta) no deja subir: solo se proponen bajadas */
  sinSubidas?: boolean
}

export interface PropuestaDeUbicacion {
  campaignId: string
  campaignName: string
  asin: string
  ubicacion: Ubicacion
  pctActual: number
  pctNuevo: number
  direccion: 'subir' | 'bajar'
  motivo: string
  metricas: { clics: number; gasto: number; ventas: number; pedidos: number; acosPct: number | null; acosObjetivoPct: number; cvrPct: number }
}

const coma = (n: number, d = 1) => n.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d })
const r2 = (n: number) => Math.round(n * 100) / 100

export function proponerUbicaciones(campanas: readonly CampanaParaUbicaciones[], muestraMinimaClics: number, bloqueadas: ReadonlySet<string> = new Set()): PropuestaDeUbicacion[] {
  const salida: PropuestaDeUbicacion[] = []
  for (const c of campanas) {
    if (!(c.acosObjetivoPct > 0)) continue
    const cvr = c.cvr > 0 ? c.cvr : 0.1
    const unPedido = 1 / cvr
    for (const u of UBICACIONES) {
      if (bloqueadas.has(`${c.campaignId}:${u}`)) continue
      const m = c.metricas[u]
      if (!m || m.clics < Math.max(muestraMinimaClics, 2 * unPedido)) continue
      const pct = Math.max(0, Math.round(c.ajustes[u] ?? 0))
      const mult = 1 + pct / 100
      const acos = m.ventas > 0 ? (m.gasto / m.ventas) * 100 : null
      const base = { campaignId: c.campaignId, campaignName: c.campaignName, asin: c.asin, ubicacion: u, pctActual: pct }
      const metricas = { clics: m.clics, gasto: r2(m.gasto), ventas: r2(m.ventas), pedidos: m.pedidos, acosPct: acos == null ? null : Math.round(acos * 10) / 10, acosObjetivoPct: c.acosObjetivoPct, cvrPct: Math.round(cvr * 1000) / 10 }
      const donde = NOMBRE_DE_UBICACION[u].toLowerCase()

      if (!c.sinSubidas && acos != null && m.pedidos >= 3 && acos <= c.acosObjetivoPct * SUBIR_SI_ACOS_X) {
        const x = Math.min(SUBIR_MAX_X, (c.acosObjetivoPct * DESTINO_SUBIR_X) / acos)
        const nuevo = Math.min(TOPE_PCT[u], Math.round((mult * x - 1) * 100))
        if (nuevo - pct < PASO_MIN_PCT) continue
        salida.push({
          ...base,
          pctNuevo: nuevo,
          direccion: 'subir',
          metricas,
          motivo: `En ${donde} lleva ${m.pedidos} pedidos con ACoS ${coma(acos)} %, muy por debajo del objetivo (${coma(c.acosObjetivoPct)} %): se sube el ajuste de ${pct} % a ${nuevo} % para salir más ahí, donde rinde`,
        })
        continue
      }
      if (pct <= 0) continue
      let nuevoMult: number | null = null
      let motivo = ''
      if (acos != null && m.pedidos >= 2 && acos >= c.acosObjetivoPct * BAJAR_SI_ACOS_X) {
        nuevoMult = Math.max(mult * BAJAR_MAX_X, mult * (c.acosObjetivoPct / acos))
        motivo = `En ${donde} el ACoS es ${coma(acos)} % con ${m.pedidos} pedidos, por encima del objetivo (${coma(c.acosObjetivoPct)} %)`
      } else if (m.pedidos === 0 && m.ventas === 0 && m.clics >= 2 * unPedido) {
        nuevoMult = mult * BAJAR_MAX_X
        motivo = `En ${donde} lleva ${m.clics} clics y ${coma(m.gasto, 2)} gastados sin ningún pedido`
      }
      if (nuevoMult == null) continue
      const nuevo = Math.max(0, Math.round((nuevoMult - 1) * 100))
      if (pct - nuevo < PASO_MIN_PCT) continue
      salida.push({ ...base, pctNuevo: nuevo, direccion: 'bajar', metricas, motivo: `${motivo}: se baja el ajuste de ${pct} % a ${nuevo} %` })
    }
  }
  return salida
}
