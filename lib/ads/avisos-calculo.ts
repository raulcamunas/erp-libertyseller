/**
 * AMAZON ADS · LOS AVISOS DE UNA CUENTA (Marketing Test). PURO: de los datos a la lista de avisos, cada uno con su gravedad y una frase. Lo que lee y junta los datos está en avisos.ts.
 *
 *   · Amazon dice que algo va mal con la CUENTA (fallo de pago, sin saldo, suspendida, rechazada): grave, afecta a todo.
 *   · Una campaña activa SE HA QUEDADO SIN PRESUPUESTO hoy: deja de salir el resto del día.
 *   · Una campaña activa está INCOMPLETA (sin anuncio o sin segmentación): no sale.
 *   · Una campaña activa GASTA SIN VENDER: en los últimos 7 días, gasto ≥ el umbral y ni una venta.
 *   · Un producto anunciado SIN STOCK: tiene campañas activas y no se puede vender (el anuncio deja de salir o, peor, se paga por clics que no compran).
 */

export type GravedadDeAviso = 'grave' | 'atencion' | 'info'

export interface Aviso {
  tipo: 'cuenta' | 'sin-presupuesto' | 'incompleta' | 'gasto-sin-ventas' | 'sin-stock'
  gravedad: GravedadDeAviso
  titulo: string
  detalle: string
  campaignId?: string
  asin?: string
}

const PROBLEMAS_DE_CUENTA: Record<string, string> = {
  ADVERTISER_PAYMENT_FAILURE: 'Amazon no ha podido cobrar la publicidad (fallo en el método de pago)',
  ACCOUNT_OUT_OF_BUDGET: 'La cuenta se ha quedado sin presupuesto',
  ADVERTISER_OUT_OF_BUDGET: 'La cuenta se ha quedado sin presupuesto',
  ADVERTISER_EXCEED_SPENDS_LIMIT: 'La cuenta ha superado su límite de gasto',
  ADVERTISER_POLICING_SUSPENDED: 'Amazon ha suspendido la publicidad de la cuenta',
  ADVERTISER_POLICING_PENDING_REVIEW: 'Amazon está revisando la cuenta de publicidad',
  REJECTED: 'Amazon ha rechazado la campaña',
}

export interface CampanaParaAvisos {
  campaignId: string
  nombre: string
  estado: string
  servicio: string | null
  presupuesto: number | null
  gasto7: number
  ventas7: number
}

export interface ProductoParaAvisos {
  asin: string
  nombre: string
  campanasActivas: number
  /** Unidades vendibles ahora (FBA o propias). null = no se sabe */
  stock: number | null
}

const euros = (n: number) => n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function avisosDe(campanas: readonly CampanaParaAvisos[], productos: readonly ProductoParaAvisos[], opciones: { gastoSinVentas: number }): Aviso[] {
  const avisos: Aviso[] = []
  const deCuenta = new Set<string>()
  for (const c of campanas) {
    if (c.estado !== 'ENABLED') continue
    const s = c.servicio ?? ''
    if (PROBLEMAS_DE_CUENTA[s] && !deCuenta.has(s)) {
      deCuenta.add(s)
      avisos.push({ tipo: 'cuenta', gravedad: 'grave', titulo: PROBLEMAS_DE_CUENTA[s], detalle: 'Afecta a todas las campañas de la cuenta: hay que mirarlo en la consola de Amazon Ads.' })
      continue
    }
    if (s === 'CAMPAIGN_OUT_OF_BUDGET') avisos.push({ tipo: 'sin-presupuesto', gravedad: 'atencion', titulo: 'Sin presupuesto hoy', detalle: `${c.nombre}: ha gastado sus ${c.presupuesto == null ? '' : euros(c.presupuesto) + ' '}diarios y no sale lo que queda de día.`, campaignId: c.campaignId })
    else if (s === 'CAMPAIGN_INCOMPLETE') avisos.push({ tipo: 'incompleta', gravedad: 'atencion', titulo: 'Campaña incompleta', detalle: `${c.nombre}: está activa pero no sale (le falta un anuncio o una segmentación).`, campaignId: c.campaignId })
    if (c.gasto7 >= opciones.gastoSinVentas && c.ventas7 === 0) avisos.push({ tipo: 'gasto-sin-ventas', gravedad: 'atencion', titulo: 'Gasta sin vender', detalle: `${c.nombre}: ${euros(c.gasto7)} en los últimos 7 días y ninguna venta.`, campaignId: c.campaignId })
  }
  for (const p of productos) {
    if (p.campanasActivas > 0 && p.stock === 0) avisos.push({ tipo: 'sin-stock', gravedad: 'grave', titulo: 'Anunciado sin stock', detalle: `${p.nombre} (${p.asin}) tiene ${p.campanasActivas} ${p.campanasActivas === 1 ? 'campaña activa' : 'campañas activas'} y 0 unidades a la venta: se paga por clics que no pueden comprar.`, asin: p.asin })
  }
  const peso: Record<GravedadDeAviso, number> = { grave: 0, atencion: 1, info: 2 }
  return avisos.sort((a, b) => peso[a.gravedad] - peso[b.gravedad])
}
