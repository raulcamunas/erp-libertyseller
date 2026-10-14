import { AmazonApiError } from '@/lib/amazon/errors'
import { spApiRequest, type AmazonCredentials } from '@/lib/amazon/sp-api'

/**
 * LO QUE SE HA VENDIDO EN UN INTERVALO, POR SKU.
 * SOLO SERVIDOR. SOLO LEE.
 *
 * Es lo que permite a la verificación decir «se mandaron 8, se vendieron 1 y hay
 * 7: correcto» en vez de «hay 7 en vez de 8: ¿fallo?». Usa la API de pedidos de
 * Amazon, solo de pedidos del propio vendedor (MFN, los que descuentan stock FBM)
 * y sin datos del comprador, así que no pide permisos de información personal.
 *
 * NO SIEMPRE SE PUEDE, y se dice en vez de adivinar. Si la aplicación no tiene el
 * permiso de pedidos, o hay tantos pedidos que contarlos uno a uno saldría
 * demasiado caro, devuelve `ok: false` con el motivo, y quien llama verifica sin
 * ventas (ver verificacion-pura.ts).
 */

export interface VentaSku {
  sku: string
  cantidad: number
  /** ISO. Cuándo se hizo el pedido */
  compradoAt: string
}

export type LecturaVentas = { ok: true; ventas: VentaSku[] } | { ok: false; motivo: string }

const MAX_PEDIDOS = 250
const MAX_PAGINAS = 3

interface RespuestaPedidos {
  payload?: {
    Orders?: Array<{ AmazonOrderId?: string; PurchaseDate?: string; OrderStatus?: string }>
    NextToken?: string
  }
}
interface RespuestaLineas {
  payload?: { OrderItems?: Array<{ SellerSKU?: string; QuantityOrdered?: number }>; NextToken?: string }
}

export async function ventasDesde(
  creds: AmazonCredentials,
  marketplaceId: string,
  desdeIso: string
): Promise<LecturaVentas> {
  try {
    // Amazon exige que CreatedAfter sea al menos dos minutos anterior a ahora
    const desde = new Date(Math.min(new Date(desdeIso).getTime(), Date.now() - 3 * 60_000)).toISOString()

    const pedidos: Array<{ id: string; compradoAt: string }> = []
    let siguiente: string | undefined
    for (let pagina = 0; pagina < MAX_PAGINAS; pagina += 1) {
      const { data } = await spApiRequest<RespuestaPedidos>(creds, 'getOrders', {
        method: 'GET',
        path: '/orders/v0/orders',
        query: siguiente
          ? { NextToken: siguiente, MarketplaceIds: [marketplaceId] }
          : {
              MarketplaceIds: [marketplaceId],
              CreatedAfter: desde,
              FulfillmentChannels: ['MFN'],
              OrderStatuses: ['Pending', 'Unshipped', 'PartiallyShipped', 'Shipped'],
              MaxResultsPerPage: 100,
            },
      })
      for (const o of data.payload?.Orders ?? []) {
        if (o.AmazonOrderId && o.PurchaseDate) pedidos.push({ id: o.AmazonOrderId, compradoAt: o.PurchaseDate })
      }
      siguiente = data.payload?.NextToken
      if (!siguiente) break
      if (pagina === MAX_PAGINAS - 1) return { ok: false, motivo: 'Hay demasiados pedidos en el intervalo para contarlos uno a uno.' }
    }

    if (pedidos.length > MAX_PEDIDOS) {
      return { ok: false, motivo: `Hay ${pedidos.length} pedidos en el intervalo: demasiados para contarlos uno a uno.` }
    }

    const ventas: VentaSku[] = []
    for (const p of pedidos) {
      const { data } = await spApiRequest<RespuestaLineas>(creds, 'getOrderItems', {
        method: 'GET',
        path: `/orders/v0/orders/${encodeURIComponent(p.id)}/orderItems`,
      })
      for (const l of data.payload?.OrderItems ?? []) {
        if (l.SellerSKU && typeof l.QuantityOrdered === 'number') {
          ventas.push({ sku: l.SellerSKU, cantidad: l.QuantityOrdered, compradoAt: p.compradoAt })
        }
      }
    }
    return { ok: true, ventas }
  } catch (e) {
    if (e instanceof AmazonApiError && e.kind === 'permisos') {
      return { ok: false, motivo: 'La aplicación de Amazon no tiene permiso para leer pedidos.' }
    }
    return { ok: false, motivo: e instanceof AmazonApiError ? e.humanMessage : 'No se han podido leer los pedidos.' }
  }
}

/** Unidades vendidas de un SKU desde un momento dado */
export function ventasDeSku(ventas: VentaSku[], sku: string, desdeIso: string): number {
  const desde = new Date(desdeIso).getTime()
  let n = 0
  for (const v of ventas) if (v.sku === sku && new Date(v.compradoAt).getTime() >= desde) n += v.cantidad
  return n
}
