import { spApiRequest, type AmazonCredentials } from '@/lib/amazon/sp-api'

/**
 * SEGUIMIENTO DE UN ENVÍO A LOS ALMACENES DE AMAZON.
 * =================================================
 * SOLO SERVIDOR. SOLO LEE.
 *
 * Le damos el número de envío —el FBA15… que se escribe en la remesa— y Amazon
 * dice en qué punto está y cuántas unidades ha recibido de cada referencia.
 *
 *
 * ============ LO QUE APORTA SOBRE EL LIBRO MAYOR ============
 *
 * El libro mayor ya dice cuándo ENTRAN las unidades (`Receipts`). Lo que no
 * dice es nada de lo de antes: si el envío sigue en tu almacén, si está de
 * camino o si Amazon lo está metiendo en estantería.
 *
 * Y sobre todo: `QuantityShipped` frente a `QuantityReceived`. Mandaste 100 y
 * Amazon ha registrado 97 — tres unidades perdidas, por SKU y con nombre. Hoy
 * eso solo se ve cuadrando a mano semanas después, si alguien lo cuadra.
 *
 *
 * ============ EL PARÁMETRO QUE SE ME OLVIDÓ ============
 *
 * `ShipmentStatusList` o `ShipmentIdList`: uno de los dos es obligatorio SIEMPRE,
 * también con QueryType DATE_RANGE. Sin ninguno, Amazon contesta 400 con
 * «At least one of ShipmentStatusList and ShipmentIdList must be provided».
 */

/** Los estados por los que pasa un envío, en orden */
export const ESTADOS_INBOUND = [
  'WORKING',
  'READY_TO_SHIP',
  'SHIPPED',
  'IN_TRANSIT',
  'DELIVERED',
  'CHECKED_IN',
  'RECEIVING',
  'CLOSED',
  'CANCELLED',
  'DELETED',
  'ERROR',
] as const

/** Los que se consultan cuando se busca por fechas: todo menos la basura */
const ESTADOS_QUE_INTERESAN = [
  'WORKING',
  'READY_TO_SHIP',
  'SHIPPED',
  'IN_TRANSIT',
  'DELIVERED',
  'CHECKED_IN',
  'RECEIVING',
  'CLOSED',
]

export interface EnvioInbound {
  shipmentId: string
  nombre: string | null
  estado: string
  centro: string | null
}

export interface LineaInbound {
  sku: string
  enviadas: number
  recibidas: number
}

interface RespuestaEnvios {
  payload?: { ShipmentData?: unknown[]; NextToken?: string }
  ShipmentData?: unknown[]
}

interface RespuestaItems {
  payload?: { ItemData?: unknown[]; NextToken?: string }
  ItemData?: unknown[]
}

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function entero(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * El estado de unos envíos concretos.
 *
 * Se piden POR IDENTIFICADOR y no por fechas: es lo que queremos —los envíos
 * que tenemos apuntados— y además evita traerse los de años anteriores.
 *
 * Amazon admite hasta 50 identificadores por llamada.
 */
export async function estadoDeEnvios(
  creds: AmazonCredentials,
  marketplaceId: string,
  shipmentIds: string[]
): Promise<Map<string, EnvioInbound>> {
  const salida = new Map<string, EnvioInbound>()
  if (shipmentIds.length === 0) return salida

  for (let i = 0; i < shipmentIds.length; i += 50) {
    const lote = shipmentIds.slice(i, i + 50)
    const { data } = await spApiRequest<RespuestaEnvios>(creds, 'getInboundShipments', {
      method: 'GET',
      path: '/fba/inbound/v0/shipments',
      query: {
        MarketplaceId: marketplaceId,
        QueryType: 'SHIPMENT',
        ShipmentIdList: lote,
        ShipmentStatusList: ESTADOS_QUE_INTERESAN,
      },
    })

    for (const crudo of (data.payload?.ShipmentData ?? data.ShipmentData ?? []) as Array<
      Record<string, unknown>
    >) {
      const id = texto(crudo.ShipmentId)
      if (!id) continue
      salida.set(id, {
        shipmentId: id,
        nombre: texto(crudo.ShipmentName),
        estado: texto(crudo.ShipmentStatus) ?? 'desconocido',
        centro: texto(crudo.DestinationFulfillmentCenterId),
      })
    }
  }

  return salida
}

/**
 * Cuántas unidades ha recibido Amazon de cada referencia de un envío.
 *
 * Una llamada por envío: la API no admite pedir varios a la vez. Por eso quien
 * llama decide de cuáles vale la pena preguntar —los cerrados ya no cambian— en
 * vez de recorrerlos todos cada noche.
 */
export async function lineasDeEnvio(
  creds: AmazonCredentials,
  marketplaceId: string,
  shipmentId: string
): Promise<LineaInbound[]> {
  const lineas: LineaInbound[] = []
  let nextToken: string | undefined
  let vueltas = 0

  do {
    const { data } = await spApiRequest<RespuestaItems>(creds, 'getInboundShipmentItems', {
      method: 'GET',
      path: `/fba/inbound/v0/shipments/${encodeURIComponent(shipmentId)}/items`,
      query: { MarketplaceId: marketplaceId, NextToken: nextToken },
    })

    for (const crudo of (data.payload?.ItemData ?? data.ItemData ?? []) as Array<
      Record<string, unknown>
    >) {
      const sku = texto(crudo.SellerSKU)
      if (!sku) continue
      lineas.push({
        sku,
        enviadas: entero(crudo.QuantityShipped),
        recibidas: entero(crudo.QuantityReceived),
      })
    }

    nextToken = data.payload?.NextToken
    vueltas++
  } while (nextToken && vueltas < 20)

  return lineas
}

/**
 * ¿Merece la pena volver a preguntar por este envío?
 *
 * Un envío CERRADO o CANCELADO ya no cambia: seguir preguntando cada noche es
 * gastar cupo de Amazon para recibir la misma respuesta. Los demás sí, porque
 * es justo mientras viajan cuando interesa saber dónde están.
 */
export function sigueVivo(estado: string | null): boolean {
  if (!estado) return true
  return !['CLOSED', 'CANCELLED', 'DELETED', 'ERROR'].includes(estado)
}

/** Para la pantalla: el estado en español y de qué color va */
export const ESTADO_INBOUND_TEXTO: Record<string, { texto: string; tono: 'espera' | 'camino' | 'ok' | 'malo' }> = {
  WORKING: { texto: 'Preparándose', tono: 'espera' },
  READY_TO_SHIP: { texto: 'Listo para salir', tono: 'espera' },
  SHIPPED: { texto: 'Enviado', tono: 'camino' },
  IN_TRANSIT: { texto: 'En tránsito', tono: 'camino' },
  DELIVERED: { texto: 'Entregado en Amazon', tono: 'camino' },
  CHECKED_IN: { texto: 'Registrado', tono: 'camino' },
  RECEIVING: { texto: 'Recibiendo', tono: 'camino' },
  CLOSED: { texto: 'Cerrado', tono: 'ok' },
  CANCELLED: { texto: 'Cancelado', tono: 'malo' },
  DELETED: { texto: 'Borrado', tono: 'malo' },
  ERROR: { texto: 'Con error', tono: 'malo' },
}
