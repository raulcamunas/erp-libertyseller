/**
 * SEO · EL INFORME «SEARCH QUERY PERFORMANCE» DE BRAND ANALYTICS, LEÍDO. PURO.
 *
 * Por cada ASIN y búsqueda, lo que pasó en TODO Amazon con esa búsqueda (impresiones, clics, añadidos, compras) y qué parte se llevó el ASIN. Es lo más parecido a «cómo posiciona mi producto en
 * esta keyword» que da Amazon sin pagar a nadie: si el ASIN se lleva el 15 % de las compras de una búsqueda, está bien posicionado en ella; si se lleva el 0,2 % de las impresiones, apenas sale.
 *
 * Formato oficial: github.com/amzn/selling-partner-api-models › schemas/reports/sellingPartnerSearchQueryPerformanceReport.json
 */

export interface ConsultaSqp {
  asin: string
  desde: string
  hasta: string
  consulta: string
  /** El orden de la búsqueda dentro de las del ASIN según Amazon (1 = la más importante) */
  puntuacion: number | null
  /** Cuántas veces se buscó en todo Amazon en el periodo */
  volumen: number | null
  impresionesTotal: number | null
  impresionesAsin: number | null
  /** Parte de las impresiones de la búsqueda que fueron para el ASIN, 0..1 */
  cuotaImpresiones: number | null
  clicsTotal: number | null
  clicsAsin: number | null
  cuotaClics: number | null
  carritosTotal: number | null
  carritosAsin: number | null
  cuotaCarritos: number | null
  comprasTotal: number | null
  comprasAsin: number | null
  cuotaCompras: number | null
  /** Precio mediano de compra en la búsqueda (todo Amazon) y del ASIN */
  precioMedianoTotal: number | null
  precioMedianoAsin: number | null
}

const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}

/** Amazon da las cuotas en porcentaje (15.5 = 15,5 %). Aquí se guardan como fracción */
const cuota = (v: unknown): number | null => {
  const n = num(v)
  return n === null ? null : n / 100
}

const precio = (v: unknown): number | null => {
  if (v && typeof v === 'object') return num((v as { amount?: unknown }).amount)
  return num(v)
}

/** Del JSON del informe a filas planas. Lo que no tiene ASIN o búsqueda se descarta */
export function leerInformeSqp(json: unknown): ConsultaSqp[] {
  const filas = (json && typeof json === 'object' ? (json as { dataByAsin?: unknown }).dataByAsin : null) ?? []
  if (!Array.isArray(filas)) return []
  const salida: ConsultaSqp[] = []
  for (const f of filas as Array<Record<string, unknown>>) {
    const q = (f.searchQueryData ?? {}) as Record<string, unknown>
    const consulta = typeof q.searchQuery === 'string' ? q.searchQuery.trim() : ''
    const asin = typeof f.asin === 'string' ? f.asin.trim().toUpperCase() : ''
    if (!consulta || !asin) continue
    const imp = (f.impressionData ?? {}) as Record<string, unknown>
    const cli = (f.clickData ?? {}) as Record<string, unknown>
    const car = (f.cartAddData ?? {}) as Record<string, unknown>
    const com = (f.purchaseData ?? {}) as Record<string, unknown>
    salida.push({
      asin,
      desde: String(f.startDate ?? '').slice(0, 10),
      hasta: String(f.endDate ?? '').slice(0, 10),
      consulta,
      puntuacion: num(q.searchQueryScore),
      volumen: num(q.searchQueryVolume),
      impresionesTotal: num(imp.totalQueryImpressionCount),
      impresionesAsin: num(imp.asinImpressionCount),
      cuotaImpresiones: cuota(imp.asinImpressionShare),
      clicsTotal: num(cli.totalClickCount),
      clicsAsin: num(cli.asinClickCount),
      cuotaClics: cuota(cli.asinClickShare),
      carritosTotal: num(car.totalCartAddCount),
      carritosAsin: num(car.asinCartAddCount),
      cuotaCarritos: cuota(car.asinCartAddShare),
      comprasTotal: num(com.totalPurchaseCount),
      comprasAsin: num(com.asinPurchaseCount),
      cuotaCompras: cuota(com.asinPurchaseShare),
      precioMedianoTotal: precio(com.totalMedianPurchasePrice),
      precioMedianoAsin: precio(com.asinMedianPurchasePrice),
    })
  }
  return salida
}
