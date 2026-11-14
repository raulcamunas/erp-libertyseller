import { spApiRequest, type AmazonCredentials } from '@/lib/amazon/sp-api'

export { ESTADOS_INBOUND, ESTADO_INBOUND_TEXTO, sigueVivo } from './inbound-estados'

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
 * TODOS LOS ENVÍOS QUE HAY EN LA CUENTA DE UN CLIENTE, en un mercado, tocados en los últimos `dias` días.
 *
 * Es lo que permite no teclear el número FBA a mano: se le pregunta a Amazon qué envíos tiene la cuenta y se enseñan los que el ERP todavía no conoce
 * (lib/fba/envios-nuevos.ts). Solo los que ya han salido: un borrador (WORKING) o uno con la etiqueta puesta pero sin enviar (READY_TO_SHIP) todavía no
 * traen unidades fiables, y entrarían en el ERP vacíos.
 *
 * La primera página se pide por fechas y las siguientes con el NextToken (QueryType NEXT_TOKEN: sin él Amazon contesta 400). Tope de 20 páginas, de 50 (mil envíos: de sobra para un año).
 */
export const ESTADOS_DE_ENVIO_YA_SALIDO = ['SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'CHECKED_IN', 'RECEIVING', 'CLOSED']

export async function listarEnviosDeCuenta(creds: AmazonCredentials, marketplaceId: string, dias = 90, ahora: Date = new Date()): Promise<EnvioInbound[]> {
  const salida: EnvioInbound[] = []
  let nextToken: string | undefined
  let vueltas = 0
  do {
    const query: Record<string, string | string[]> = nextToken
      ? { MarketplaceId: marketplaceId, QueryType: 'NEXT_TOKEN', NextToken: nextToken }
      : {
          MarketplaceId: marketplaceId,
          QueryType: 'DATE_RANGE',
          LastUpdatedAfter: new Date(ahora.getTime() - dias * 86_400_000).toISOString(),
          LastUpdatedBefore: ahora.toISOString(),
          ShipmentStatusList: ESTADOS_DE_ENVIO_YA_SALIDO,
        }
    const { data } = await spApiRequest<RespuestaEnvios>(creds, 'getInboundShipments', { method: 'GET', path: '/fba/inbound/v0/shipments', query })
    for (const crudo of (data.payload?.ShipmentData ?? data.ShipmentData ?? []) as Array<Record<string, unknown>>) {
      const id = texto(crudo.ShipmentId)
      if (!id) continue
      salida.push({ shipmentId: id, nombre: texto(crudo.ShipmentName), estado: texto(crudo.ShipmentStatus) ?? 'desconocido', centro: texto(crudo.DestinationFulfillmentCenterId) })
    }
    nextToken = data.payload?.NextToken
    vueltas++
  } while (nextToken && vueltas < 20)
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
  const porSku = new Map<string, LineaInbound>()
  let nextToken: string | undefined
  let vueltas = 0

  do {
    const { data } = await spApiRequest<RespuestaItems>(creds, 'getInboundShipmentItems', {
      method: 'GET',
      path: `/fba/inbound/v0/shipments/${encodeURIComponent(shipmentId)}/items`,
      query: { MarketplaceId: marketplaceId, NextToken: nextToken },
    })

    const nuevas = agregarPagina(
      porSku,
      ((data.payload?.ItemData ?? data.ItemData ?? []) as Array<Record<string, unknown>>).flatMap((crudo) => {
        const sku = texto(crudo.SellerSKU)
        return sku
          ? [{ sku, enviadas: entero(crudo.QuantityShipped), recibidas: entero(crudo.QuantityReceived) }]
          : []
      })
    )

    nextToken = data.payload?.NextToken
    vueltas++
    // UNA PÁGINA QUE NO TRAE NINGÚN SKU NUEVO ES LA MISMA DE ANTES. Este endpoint
    // devuelve un NextToken pero no admite pedirlo (no hay parámetro para ello):
    // se repetía la primera página hasta el tope de 20 vueltas y un envío de 99
    // unidades salía con 1.980. Se corta aquí.
    if (nuevas === 0) break
  } while (nextToken && vueltas < 20)

  return [...porSku.values()]
}

/**
 * Suma una página al mapa por SKU y dice cuántos SKU eran nuevos. Un SKU que ya
 * estaba SUSTITUYE al anterior, no se suma: dos veces la misma línea no son el
 * doble de unidades. Pura, para probarla sin Amazon.
 */
export function agregarPagina(porSku: Map<string, LineaInbound>, pagina: LineaInbound[]): number {
  let nuevas = 0
  for (const l of pagina) {
    if (!porSku.has(l.sku)) nuevas += 1
    porSku.set(l.sku, l)
  }
  return nuevas
}

