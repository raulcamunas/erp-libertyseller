import { AmazonApiError } from '@/lib/amazon/errors'
import { spApiRequest, type AmazonCredentials } from '@/lib/amazon/sp-api'
import type { CajaDeAmazon, CajaDeGrupo, DatosPalets, DireccionOrigen, LineaParaPlan, OpcionEmbalaje, OpcionReparto, OpcionTransporte } from './envio-amazon'

/**
 * CREAR EL ENVÍO EN AMAZON: LA FULFILLMENT INBOUND API 2024-03-20.
 * ===============================================================
 * SOLO SERVIDOR. Recuperado de lib/fba/plan.ts (borrado en eb9dfef) y completado: ventanas de entrega,
 * etiquetas de caja y de UPS (getLabels v0), getInboundPlan, listInboundPlanBoxes y una sonda de solo
 * lectura (listInboundPlans).
 *
 * Es, de largo, lo más delicado del ERP: esto CREA ENVÍOS FÍSICOS en la cuenta del cliente, con su
 * transportista y su cargo. Quien llama es SOLO el motor (lib/fba/envio-amazon-motor.ts), detrás de una
 * ruta de administradores.
 *
 *
 * ============ TODO LO QUE ESCRIBE ES ASÍNCRONO ============
 *
 * Las POST no hacen el trabajo: devuelven un `operationId` y lo hacen por detrás. A diferencia del plan.ts
 * viejo, aquí NO SE ESPERA dentro de la petición (generatePlacementOptions puede tardar minutos): cada
 * escritura devuelve su operationId, el motor lo guarda y la pantalla pregunta con `estadoDeOperacion`.
 *
 * Un FAILED no llega como error HTTP: llega como un 200 con `operationStatus: FAILED` y una lista de
 * `operationProblems`. `interpretarOperacion` lo convierte en fallo; tratar el 200 como éxito haría avanzar
 * sobre un paso que no ocurrió.
 *
 * Ninguna escritura se reintenta (repeatable: false, maxAttempts: 1): ante un fallo de red la petición
 * pudo haber llegado, y repetir un createInboundPlan crea dos planes.
 */

const RUTA = '/inbound/fba/2024-03-20'
const enc = encodeURIComponent

/* ------------------------------------------------------------------ */
/* Operaciones asíncronas                                              */
/* ------------------------------------------------------------------ */

export interface ProblemaOperacion {
  code: string | null
  message: string
  details: string | null
  severity: string | null
}

export type EstadoOperacion = 'en_curso' | 'ok' | 'fallo'

export interface ResultadoOperacion {
  estado: EstadoOperacion
  operacion: string | null
  problemas: ProblemaOperacion[]
  /** Los problemas graves en una frase, para enseñar. '' si no hay */
  texto: string
}

/** PURA. Lo que contesta getInboundOperationStatus, convertido en algo que no engaña */
export function interpretarOperacion(data: { operationStatus?: string; operationProblems?: Array<Record<string, unknown>>; operation?: string } | null | undefined): ResultadoOperacion {
  const problemas: ProblemaOperacion[] = (data?.operationProblems ?? []).map((p) => ({
    code: typeof p.code === 'string' ? p.code : null,
    message: typeof p.message === 'string' && p.message ? p.message : 'Sin mensaje',
    details: typeof p.details === 'string' ? p.details : null,
    severity: typeof p.severity === 'string' ? p.severity : null,
  }))
  const s = (data?.operationStatus ?? '').toUpperCase()
  const graves = problemas.filter((p) => (p.severity ?? 'ERROR').toUpperCase() === 'ERROR')
  if (s === 'SUCCESS') {
    return { estado: 'ok', operacion: data?.operation ?? null, problemas: problemas.filter((p) => (p.severity ?? '').toUpperCase() !== 'ERROR'), texto: '' }
  }
  if (s === 'FAILED') {
    const lista = (graves.length ? graves : problemas).map((p) => p.message).join('. ')
    return { estado: 'fallo', operacion: data?.operation ?? null, problemas, texto: lista || 'Amazon ha rechazado el paso sin decir por qué' }
  }
  return { estado: 'en_curso', operacion: data?.operation ?? null, problemas, texto: '' }
}

export async function estadoDeOperacion(creds: AmazonCredentials, operationId: string): Promise<ResultadoOperacion> {
  const { data } = await spApiRequest<{ operationStatus?: string; operationProblems?: Array<Record<string, unknown>>; operation?: string }>(creds, 'getInboundOperationStatus', {
    method: 'GET',
    path: `${RUTA}/operations/${enc(operationId)}`,
  })
  return interpretarOperacion(data)
}

/** Una escritura: POST/PUT sin reintentos que devuelve su operationId */
async function escribir<T extends { operationId?: string }>(creds: AmazonCredentials, op: Parameters<typeof spApiRequest>[1], method: 'POST' | 'PUT', path: string, body: unknown): Promise<T & { operationId: string }> {
  const { data } = await spApiRequest<T>(creds, op, { method, path, body, repeatable: false, maxAttempts: 1 })
  if (!data?.operationId) {
    throw new AmazonApiError({ kind: 'servidor', message: `${op} sin operationId`, humanMessage: 'Amazon ha aceptado el paso pero no ha devuelto su número de operación. Mira el plan en Seller Central antes de repetirlo.' })
  }
  return data as T & { operationId: string }
}

/* ------------------------------------------------------------------ */
/* Sonda de permisos (solo lectura)                                    */
/* ------------------------------------------------------------------ */

/**
 * ¿Deja Amazon usar la API 2024-03-20 con esta conexión? Lista UN plan (GET): no crea ni cambia nada.
 * Si contesta 2xx, el rol «Amazon Fulfillment» está concedido para la API nueva; las escrituras siguen
 * siendo un supuesto hasta la primera prueba real.
 */
export async function sondaInbound(creds: AmazonCredentials): Promise<{ ok: true; planes: number } | { ok: false; error: string }> {
  try {
    const { data } = await spApiRequest<{ inboundPlans?: unknown[] }>(creds, 'listInboundPlans', { method: 'GET', path: `${RUTA}/inboundPlans`, query: { pageSize: 1 }, maxAttempts: 2, repeatable: true })
    return { ok: true, planes: (data.inboundPlans ?? []).length }
  } catch (e) {
    return { ok: false, error: e instanceof AmazonApiError ? e.humanMessage : e instanceof Error ? e.message : 'Fallo desconocido' }
  }
}

/* ------------------------------------------------------------------ */
/* 1 · El plan                                                          */
/* ------------------------------------------------------------------ */

/**
 * PURA. El cuerpo de createInboundPlan.
 *
 * `prepOwner` y `labelOwner` van a SELLER, y es una decisión: con AMAZON, Amazon prepara y etiqueta y
 * COBRA por unidad, y aquí el cliente ya imprime y pega las etiquetas antes de encajar. Las referencias con
 * «ASIN como FNSKU» (etiqueta del fabricante) van con labelOwner NONE.
 */
export function cuerpoCrearPlan(p: { nombre: string; marketplaceId: string; origen: DireccionOrigen; lineas: LineaParaPlan[]; sinEtiqueta?: Set<string> }) {
  const o = p.origen
  return {
    name: p.nombre.slice(0, 40),
    destinationMarketplaces: [p.marketplaceId],
    sourceAddress: {
      name: o.nombre ?? '',
      companyName: o.empresa ?? '',
      addressLine1: o.linea1 ?? '',
      ...(o.linea2 ? { addressLine2: o.linea2 } : {}),
      city: o.ciudad ?? '',
      // La provincia es opcional para Amazon: si la dirección «Enviar desde» de Seller Central no la tiene, mandarla puede hacer que no la verifique
      ...(o.provincia?.trim() ? { stateOrProvinceCode: o.provincia.trim() } : {}),
      postalCode: o.codigoPostal ?? '',
      countryCode: o.pais ?? '',
      phoneNumber: o.telefono ?? '',
      email: o.email ?? '',
    },
    items: p.lineas
      .filter((l) => l.unidades > 0)
      .map((l) => ({ msku: l.sku, quantity: l.unidades, prepOwner: 'SELLER', labelOwner: p.sinEtiqueta?.has(l.sku) ? 'NONE' : 'SELLER' })),
  }
}

export async function crearPlan(creds: AmazonCredentials, cuerpo: ReturnType<typeof cuerpoCrearPlan>): Promise<{ operationId: string; inboundPlanId: string }> {
  const data = await escribir<{ operationId?: string; inboundPlanId?: string }>(creds, 'createInboundPlan', 'POST', `${RUTA}/inboundPlans`, cuerpo)
  if (!data.inboundPlanId) throw new AmazonApiError({ kind: 'servidor', message: 'createInboundPlan sin inboundPlanId', humanMessage: 'Amazon ha aceptado el plan pero no ha devuelto su identificador.' })
  return { operationId: data.operationId, inboundPlanId: data.inboundPlanId }
}

export interface PlanDeAmazon {
  inboundPlanId: string
  estado: string
  nombre: string | null
  envios: Array<{ shipmentId: string; estado: string | null }>
  actualizado: string | null
}

/** PURA */
export function leerPlan(data: Record<string, unknown>): PlanDeAmazon {
  const envios = Array.isArray(data.shipments) ? (data.shipments as Array<Record<string, unknown>>) : []
  return {
    inboundPlanId: String(data.inboundPlanId ?? ''),
    estado: typeof data.status === 'string' ? data.status : 'DESCONOCIDO',
    nombre: typeof data.name === 'string' ? data.name : null,
    envios: envios.map((s) => ({ shipmentId: String(s.shipmentId ?? ''), estado: typeof s.status === 'string' ? s.status : null })),
    actualizado: typeof data.lastUpdatedAt === 'string' ? data.lastUpdatedAt : null,
  }
}

export async function verPlan(creds: AmazonCredentials, planId: string): Promise<PlanDeAmazon> {
  const { data } = await spApiRequest<Record<string, unknown>>(creds, 'getInboundPlan', { method: 'GET', path: `${RUTA}/inboundPlans/${enc(planId)}` })
  return leerPlan(data)
}

/* ------------------------------------------------------------------ */
/* 2 · Embalaje                                                         */
/* ------------------------------------------------------------------ */

type Dinero = { value?: { amount?: number; code?: string } }
const suma = (l: Dinero[] | undefined): number => Math.round((l ?? []).reduce((s, x) => s + (Number(x.value?.amount) || 0), 0) * 100) / 100
const moneda = (l: Dinero[] | undefined): string | null => (l ?? []).find((x) => x.value?.code)?.value?.code ?? null

/** PURA */
export function leerOpcionesEmbalaje(data: { packingOptions?: Array<Record<string, unknown>> }): OpcionEmbalaje[] {
  return (data.packingOptions ?? []).map((o) => ({
    packingOptionId: String(o.packingOptionId ?? ''),
    estado: typeof o.status === 'string' ? o.status : 'DESCONOCIDO',
    grupos: Array.isArray(o.packingGroups) ? (o.packingGroups as string[]) : [],
    coste: suma(o.fees as Dinero[]),
    descuento: suma(o.discounts as Dinero[]),
    moneda: moneda(o.fees as Dinero[]) ?? moneda(o.discounts as Dinero[]),
    caduca: typeof o.expiration === 'string' ? o.expiration : null,
  }))
}

export const generarOpcionesEmbalaje = (creds: AmazonCredentials, planId: string) =>
  escribir<{ operationId?: string }>(creds, 'generatePackingOptions', 'POST', `${RUTA}/inboundPlans/${enc(planId)}/packingOptions`, {})

export async function listarOpcionesEmbalaje(creds: AmazonCredentials, planId: string): Promise<OpcionEmbalaje[]> {
  const { data } = await spApiRequest<{ packingOptions?: Array<Record<string, unknown>> }>(creds, 'listPackingOptions', { method: 'GET', path: `${RUTA}/inboundPlans/${enc(planId)}/packingOptions`, query: { pageSize: 20 } })
  return leerOpcionesEmbalaje(data)
}

/** Qué SKU van en un grupo de embalaje. Con esto se comprueba que ninguna caja mezcla grupos */
export async function articulosDelGrupo(creds: AmazonCredentials, planId: string, grupoId: string): Promise<Array<{ msku: string; unidades: number }>> {
  // A4.6: todas las páginas (antes solo la primera: un grupo con más de 100 SKU dejaba fuera los demás y sus cajas acababan en «conflicto»)
  const out: Array<{ msku: string; unidades: number }> = []
  let token: string | undefined
  for (let i = 0; i < 20; i++) {
    const { data } = await spApiRequest<{ items?: Array<Record<string, unknown>>; pagination?: { nextToken?: string } }>(creds, 'listPackingGroupItems', {
      method: 'GET',
      path: `${RUTA}/inboundPlans/${enc(planId)}/packingGroups/${enc(grupoId)}/items`,
      query: { pageSize: 100, paginationToken: token },
    })
    out.push(...(data.items ?? []).map((x) => ({ msku: String(x.msku ?? ''), unidades: Number(x.quantity) || 0 })))
    token = data.pagination?.nextToken
    if (!token) break
  }
  return out
}

/** El mapa SKU → grupo de una opción de embalaje entera */
export async function mapaDeGrupos(creds: AmazonCredentials, planId: string, grupos: string[]): Promise<Record<string, string>> {
  const mapa: Record<string, string> = {}
  for (const g of grupos) for (const a of await articulosDelGrupo(creds, planId, g)) mapa[a.msku] = g
  return mapa
}

export const confirmarEmbalaje = (creds: AmazonCredentials, planId: string, packingOptionId: string) =>
  escribir<{ operationId?: string }>(creds, 'confirmPackingOption', 'POST', `${RUTA}/inboundPlans/${enc(planId)}/packingOptions/${enc(packingOptionId)}/confirmation`, {})

/**
 * PURA. El cuerpo de setPackingInformation.
 *
 * `quantity: 1` por caja: cada caja lleva su contenido y su peso (dos cajas del mismo envío casi nunca pesan
 * lo mismo). `BOX_CONTENT_PROVIDED` porque decimos qué va dentro; las otras fuentes tienen tarifa.
 */
export function cuerpoCajas(grupos: Array<{ packingGroupId: string; cajas: CajaDeGrupo[] }>, sinEtiqueta?: Set<string>) {
  return {
    packageGroupings: grupos.map((g) => ({
      packingGroupId: g.packingGroupId,
      boxes: g.cajas.map((c) => ({
        quantity: 1,
        contentInformationSource: 'BOX_CONTENT_PROVIDED',
        dimensions: { unitOfMeasurement: 'CM', length: c.largoCm, width: c.anchoCm, height: c.altoCm },
        weight: { unit: 'KG', value: c.pesoKg },
        items: c.contenido.map((x) => ({ msku: x.msku, quantity: x.unidades, prepOwner: 'SELLER', labelOwner: sinEtiqueta?.has(x.msku) ? 'NONE' : 'SELLER' })),
      })),
    })),
  }
}

export const mandarCajas = (creds: AmazonCredentials, planId: string, cuerpo: ReturnType<typeof cuerpoCajas>) =>
  escribir<{ operationId?: string }>(creds, 'setPackingInformation', 'POST', `${RUTA}/inboundPlans/${enc(planId)}/packingInformation`, cuerpo)

/* ------------------------------------------------------------------ */
/* 3 · Reparto                                                          */
/* ------------------------------------------------------------------ */

/** PURA */
export function leerOpcionesReparto(data: { placementOptions?: Array<Record<string, unknown>> }): OpcionReparto[] {
  return (data.placementOptions ?? []).map((o) => ({
    placementOptionId: String(o.placementOptionId ?? ''),
    estado: typeof o.status === 'string' ? o.status : 'DESCONOCIDO',
    envios: Array.isArray(o.shipmentIds) ? (o.shipmentIds as string[]) : [],
    coste: suma(o.fees as Dinero[]),
    descuento: suma(o.discounts as Dinero[]),
    moneda: moneda(o.fees as Dinero[]) ?? moneda(o.discounts as Dinero[]),
    caduca: typeof o.expiration === 'string' ? o.expiration : null,
  }))
}

export const generarOpcionesReparto = (creds: AmazonCredentials, planId: string) =>
  escribir<{ operationId?: string }>(creds, 'generatePlacementOptions', 'POST', `${RUTA}/inboundPlans/${enc(planId)}/placementOptions`, {})

export async function listarOpcionesReparto(creds: AmazonCredentials, planId: string): Promise<OpcionReparto[]> {
  const { data } = await spApiRequest<{ placementOptions?: Array<Record<string, unknown>> }>(creds, 'listPlacementOptions', { method: 'GET', path: `${RUTA}/inboundPlans/${enc(planId)}/placementOptions`, query: { pageSize: 20 } })
  return leerOpcionesReparto(data)
}

/** EL PUNTO DE NO RETORNO: nacen los FBA… de verdad y se aceptan las tarifas de reparto de la opción */
export const confirmarReparto = (creds: AmazonCredentials, planId: string, placementOptionId: string) =>
  escribir<{ operationId?: string }>(creds, 'confirmPlacementOption', 'POST', `${RUTA}/inboundPlans/${enc(planId)}/placementOptions/${enc(placementOptionId)}/confirmation`, {})

export interface EnvioDelPlan {
  shipmentId: string
  /** El FBA… de verdad. Solo existe DESPUÉS de confirmar el reparto */
  confirmacion: string | null
  nombre: string | null
  estado: string | null
  /** El centro (warehouseId) y su ciudad */
  destino: string | null
  ciudadDestino: string | null
  saleDesde: string | null
  entregaDesde: string | null
  entregaHasta: string | null
  /** La opción de transporte ya confirmada en Amazon (selectedTransportationOptionId), o null */
  transporteElegido: string | null
  seguimientos: Array<{ boxId: string | null; numero: string | null; valido: string | null }>
}

/** PURA */
export function leerEnvio(data: Record<string, unknown>, shipmentId: string): EnvioDelPlan {
  const destino = (data.destination ?? {}) as { warehouseId?: string; address?: { city?: string } }
  const fechas = (data.dates ?? {}) as { readyToShipWindow?: { start?: string } }
  const ventana = (data.selectedDeliveryWindow ?? {}) as { startDate?: string; endDate?: string }
  const seg = (data.trackingDetails ?? {}) as { spdTrackingDetail?: { spdTrackingItems?: Array<Record<string, unknown>> } }
  return {
    shipmentId: typeof data.shipmentId === 'string' ? data.shipmentId : shipmentId,
    confirmacion: typeof data.shipmentConfirmationId === 'string' ? data.shipmentConfirmationId : null,
    nombre: typeof data.name === 'string' ? data.name : null,
    estado: typeof data.status === 'string' ? data.status : null,
    destino: destino.warehouseId ?? null,
    ciudadDestino: destino.address?.city ?? null,
    saleDesde: fechas.readyToShipWindow?.start ?? null,
    entregaDesde: ventana.startDate ?? null,
    entregaHasta: ventana.endDate ?? null,
    transporteElegido: typeof data.selectedTransportationOptionId === 'string' ? data.selectedTransportationOptionId : null,
    seguimientos: (seg.spdTrackingDetail?.spdTrackingItems ?? []).map((t) => ({
      boxId: typeof t.boxId === 'string' ? t.boxId : null,
      numero: typeof t.trackingId === 'string' ? t.trackingId : null,
      valido: typeof t.trackingNumberValidationStatus === 'string' ? t.trackingNumberValidationStatus : null,
    })),
  }
}

export async function verEnvio(creds: AmazonCredentials, planId: string, shipmentId: string): Promise<EnvioDelPlan> {
  const { data } = await spApiRequest<Record<string, unknown>>(creds, 'getShipment', { method: 'GET', path: `${RUTA}/inboundPlans/${enc(planId)}/shipments/${enc(shipmentId)}` })
  return leerEnvio(data, shipmentId)
}

/* ------------------------------------------------------------------ */
/* 4 · Transporte                                                       */
/* ------------------------------------------------------------------ */

export interface Contacto {
  nombre: string
  telefono: string
  email?: string | null
}

/** PURA. El cuerpo de generateTransportationOptions */
export function cuerpoGenerarTransporte(placementOptionId: string, envios: string[], saleEl: string, contacto: Contacto | null, palets: DatosPalets | null = null) {
  return {
    placementOptionId,
    shipmentTransportationConfigurations: envios.map((shipmentId) => ({
      shipmentId,
      readyToShipWindow: { start: saleEl },
      // Palés (FREIGHT_LTL): cuántos, qué miden y cuánto pesa cada uno. Sin esto Amazon solo cotiza paquetería
      ...(palets
        ? {
            pallets: [
              {
                quantity: palets.cantidad,
                dimensions: { length: palets.largoCm, width: palets.anchoCm, height: palets.altoCm, unitOfMeasurement: 'CM' },
                weight: { unit: 'KG', value: palets.pesoKg },
                stackability: palets.apilable ? 'STACKABLE' : 'NON_STACKABLE',
              },
            ],
          }
        : {}),
      ...(contacto ? { contactInformation: { name: contacto.nombre, phoneNumber: contacto.telefono, ...(contacto.email ? { email: contacto.email } : {}) } } : {}),
    })),
  }
}

export const generarOpcionesTransporte = (creds: AmazonCredentials, planId: string, cuerpo: ReturnType<typeof cuerpoGenerarTransporte>) =>
  escribir<{ operationId?: string }>(creds, 'generateTransportationOptions', 'POST', `${RUTA}/inboundPlans/${enc(planId)}/transportationOptions`, cuerpo)

/** PURA */
export function leerOpcionesTransporte(data: { transportationOptions?: Array<Record<string, unknown>> }): OpcionTransporte[] {
  return (data.transportationOptions ?? []).map((o) => {
    const carrier = (o.carrier ?? {}) as { name?: string; alphaCode?: string }
    const quote = (o.quote ?? {}) as { cost?: { amount?: number; code?: string }; expiration?: string; voidableUntil?: string }
    const solucion = typeof o.shippingSolution === 'string' ? o.shippingSolution : ''
    const coste = quote.cost?.amount
    return {
      transportationOptionId: String(o.transportationOptionId ?? ''),
      shipmentId: String(o.shipmentId ?? ''),
      transportista: carrier.name ?? null,
      codigoTransportista: carrier.alphaCode ?? null,
      modo: typeof o.shippingMode === 'string' ? o.shippingMode : '',
      solucion,
      coste: typeof coste === 'number' && Number.isFinite(coste) ? coste : null,
      moneda: quote.cost?.code ?? null,
      caduca: quote.expiration ?? null,
      anulableHasta: quote.voidableUntil ?? null,
      precondiciones: Array.isArray(o.preconditions) ? (o.preconditions as string[]) : [],
      deAmazon: solucion.toUpperCase() === 'AMAZON_PARTNERED_CARRIER',
    }
  })
}

/** Todas las opciones de transporte de un reparto (pagina: puede haber muchas por envío) */
export async function listarOpcionesTransporte(creds: AmazonCredentials, planId: string, placementOptionId: string): Promise<OpcionTransporte[]> {
  const out: OpcionTransporte[] = []
  let token: string | undefined
  for (let i = 0; i < 20; i++) {
    const { data } = await spApiRequest<{ transportationOptions?: Array<Record<string, unknown>>; pagination?: { nextToken?: string } }>(creds, 'listTransportationOptions', {
      method: 'GET',
      path: `${RUTA}/inboundPlans/${enc(planId)}/transportationOptions`,
      query: { placementOptionId, pageSize: 20, paginationToken: token },
    })
    out.push(...leerOpcionesTransporte(data))
    token = data.pagination?.nextToken
    if (!token) break
  }
  return out
}

/* --- Ventana de entrega (solo transporte propio: precondición CONFIRMED_DELIVERY_WINDOW) --- */

export interface VentanaEntrega {
  deliveryWindowOptionId: string
  desde: string | null
  hasta: string | null
  tipo: string | null
  valeHasta: string | null
}

/** PURA */
export function leerVentanas(data: { deliveryWindowOptions?: Array<Record<string, unknown>> }): VentanaEntrega[] {
  return (data.deliveryWindowOptions ?? []).map((v) => ({
    deliveryWindowOptionId: String(v.deliveryWindowOptionId ?? ''),
    desde: typeof v.startDate === 'string' ? v.startDate : null,
    hasta: typeof v.endDate === 'string' ? v.endDate : null,
    tipo: typeof v.availabilityType === 'string' ? v.availabilityType : null,
    valeHasta: typeof v.validUntil === 'string' ? v.validUntil : null,
  }))
}

/** PURA. La primera ventana que sigue valiendo, la más temprana */
export function primeraVentana(vs: VentanaEntrega[], ahora = new Date()): VentanaEntrega | null {
  return [...vs].filter((v) => !v.valeHasta || Date.parse(v.valeHasta) > ahora.getTime()).sort((a, b) => Date.parse(a.desde ?? '') - Date.parse(b.desde ?? ''))[0] ?? null
}

export const generarVentanas = (creds: AmazonCredentials, planId: string, shipmentId: string) =>
  escribir<{ operationId?: string }>(creds, 'generateDeliveryWindowOptions', 'POST', `${RUTA}/inboundPlans/${enc(planId)}/shipments/${enc(shipmentId)}/deliveryWindowOptions`, {})

export async function listarVentanas(creds: AmazonCredentials, planId: string, shipmentId: string): Promise<VentanaEntrega[]> {
  const { data } = await spApiRequest<{ deliveryWindowOptions?: Array<Record<string, unknown>> }>(creds, 'listDeliveryWindowOptions', { method: 'GET', path: `${RUTA}/inboundPlans/${enc(planId)}/shipments/${enc(shipmentId)}/deliveryWindowOptions`, query: { pageSize: 20 } })
  return leerVentanas(data)
}

export const confirmarVentana = (creds: AmazonCredentials, planId: string, shipmentId: string, ventanaId: string) =>
  escribir<{ operationId?: string }>(creds, 'confirmDeliveryWindowOptions', 'POST', `${RUTA}/inboundPlans/${enc(planId)}/shipments/${enc(shipmentId)}/deliveryWindowOptions/${enc(ventanaId)}/confirmation`, {})

/** PURA. El cuerpo de confirmTransportationOptions */
export function cuerpoConfirmarTransporte(selecciones: Array<{ shipmentId: string; transportationOptionId: string }>, contacto: Contacto | null) {
  return {
    transportationSelections: selecciones.map((s) => ({
      shipmentId: s.shipmentId,
      transportationOptionId: s.transportationOptionId,
      ...(contacto ? { contactInformation: { name: contacto.nombre, phoneNumber: contacto.telefono, ...(contacto.email ? { email: contacto.email } : {}) } } : {}),
    })),
  }
}

/** Acepta el cargo del transportista asociado (UPS), que Amazon cobra al vendedor. Desde aquí corre voidableUntil */
export const confirmarTransporte = (creds: AmazonCredentials, planId: string, cuerpo: ReturnType<typeof cuerpoConfirmarTransporte>) =>
  escribir<{ operationId?: string }>(creds, 'confirmTransportationOptions', 'POST', `${RUTA}/inboundPlans/${enc(planId)}/transportationOptions/confirmation`, cuerpo)

/* ------------------------------------------------------------------ */
/* Cajas de Amazon y etiquetas                                          */
/* ------------------------------------------------------------------ */

/** PURA */
export function leerCajas(data: { boxes?: Array<Record<string, unknown>> }): CajaDeAmazon[] {
  return (data.boxes ?? [])
    .map((b) => {
      const peso = (b.weight ?? {}) as { value?: number; unit?: string }
      const kg = typeof peso.value === 'number' ? (String(peso.unit).toUpperCase() === 'LB' ? peso.value * 0.4536 : peso.value) : null
      return {
        boxId: typeof b.boxId === 'string' ? b.boxId : '',
        items: (Array.isArray(b.items) ? (b.items as Array<Record<string, unknown>>) : []).map((i) => ({ msku: String(i.msku ?? ''), unidades: Number(i.quantity) || 0 })),
        pesoKg: kg,
      }
    })
    .filter((b) => b.boxId)
}

/** Las cajas de un envío ya confirmado, con su boxId (FBA…U000001) */
export async function cajasDelEnvio(creds: AmazonCredentials, planId: string, shipmentId: string): Promise<CajaDeAmazon[]> {
  const out: CajaDeAmazon[] = []
  let token: string | undefined
  for (let i = 0; i < 20; i++) {
    const { data } = await spApiRequest<{ boxes?: Array<Record<string, unknown>>; pagination?: { nextToken?: string } }>(creds, 'listShipmentBoxes', {
      method: 'GET',
      path: `${RUTA}/inboundPlans/${enc(planId)}/shipments/${enc(shipmentId)}/boxes`,
      query: { pageSize: 100, paginationToken: token },
    })
    out.push(...leerCajas(data))
    token = data.pagination?.nextToken
    if (!token) break
  }
  return out
}

/** Todas las cajas del plan (antes de confirmar el reparto no tienen envío) */
export async function cajasDelPlan(creds: AmazonCredentials, planId: string): Promise<CajaDeAmazon[]> {
  const out: CajaDeAmazon[] = []
  let token: string | undefined
  for (let i = 0; i < 20; i++) {
    const { data } = await spApiRequest<{ boxes?: Array<Record<string, unknown>>; pagination?: { nextToken?: string } }>(creds, 'listInboundPlanBoxes', {
      method: 'GET',
      path: `${RUTA}/inboundPlans/${enc(planId)}/boxes`,
      query: { pageSize: 100, paginationToken: token },
    })
    out.push(...leerCajas(data))
    token = data.pagination?.nextToken
    if (!token) break
  }
  return out
}

/** Los formatos de hoja de getLabels que se ofrecen. A4 de 2 por hoja lleva la de UPS al lado; la térmica, 10×15 */
export const HOJAS_DE_CAJA = {
  a4_2: 'PackageLabel_A4_2',
  a4_4: 'PackageLabel_A4_4',
  termica: 'PackageLabel_Thermal',
  folio: 'PackageLabel_Plain_Paper',
} as const
export type HojaDeCaja = keyof typeof HOJAS_DE_CAJA

/** PURA. La query de getLabels v0. Con UNIQUE hay que decir qué cajas (boxId), como mucho 999 */
export function consultaEtiquetas(boxIds: string[], hoja: HojaDeCaja) {
  if (boxIds.length === 0) throw new Error('No hay cajas de Amazon para imprimir')
  if (boxIds.length > 999) throw new Error('Amazon da como mucho 999 etiquetas de caja de una vez')
  return { PageType: HOJAS_DE_CAJA[hoja], LabelType: 'UNIQUE', PackageLabelsToPrint: boxIds }
}

/**
 * Las etiquetas de caja (y, con transportista asociado, la de UPS) de un envío. Es la API v0, y el envío se
 * identifica con el shipmentConfirmationId (FBA…). Devuelve un enlace de descarga que CADUCA: se usa al
 * momento, no se guarda.
 */
export async function etiquetasDeCaja(creds: AmazonCredentials, confirmacion: string, boxIds: string[], hoja: HojaDeCaja): Promise<string> {
  const { data } = await spApiRequest<{ payload?: { DownloadURL?: string } }>(creds, 'getLabels', {
    method: 'GET',
    path: `/fba/inbound/v0/shipments/${enc(confirmacion)}/labels`,
    query: consultaEtiquetas(boxIds, hoja),
  })
  const url = data.payload?.DownloadURL
  if (!url) throw new AmazonApiError({ kind: 'servidor', message: 'getLabels sin DownloadURL', humanMessage: 'Amazon no ha devuelto las etiquetas. Vuelve a probar en un minuto.' })
  return url
}

/**
 * Seguimiento de un envío de palés con transportista propio (LTL): el número de conocimiento de embarque (BOL).
 * Amazon lo pide para que el almacén reconozca el camión. Si el transportista no da uno, vale el nº FBA.
 */
export const guardarSeguimientoLtl = (creds: AmazonCredentials, planId: string, shipmentId: string, bol: string, fletes: string[] = []) =>
  escribir<{ operationId?: string }>(creds, 'updateShipmentTrackingDetails', 'PUT', `${RUTA}/inboundPlans/${enc(planId)}/shipments/${enc(shipmentId)}/trackingDetails`, {
    trackingDetails: { ltlTrackingDetail: { billOfLadingNumber: bol, ...(fletes.length ? { freightBillNumber: fletes } : {}) } },
  })

/** PURA. La query de getLabels v0 para etiquetas de PALÉ (una por palé, se imprimen por los 4 lados) */
export function consultaEtiquetasPalet(palets: number, hoja: HojaDeCaja) {
  if (!Number.isInteger(palets) || palets < 1) throw new Error('No hay palés para imprimir')
  if (palets > 100) throw new Error('Amazon da como mucho 100 etiquetas de palé de una vez')
  return { PageType: HOJAS_DE_CAJA[hoja], LabelType: 'PALLET', NumberOfPallets: palets }
}

export async function etiquetasDePalet(creds: AmazonCredentials, confirmacion: string, palets: number, hoja: HojaDeCaja): Promise<string> {
  const { data } = await spApiRequest<{ payload?: { DownloadURL?: string } }>(creds, 'getLabels', {
    method: 'GET',
    path: `/fba/inbound/v0/shipments/${enc(confirmacion)}/labels`,
    query: consultaEtiquetasPalet(palets, hoja),
  })
  const url = data.payload?.DownloadURL
  if (!url) throw new AmazonApiError({ kind: 'servidor', message: 'getLabels (palé) sin DownloadURL', humanMessage: 'Amazon no ha devuelto las etiquetas de palé. Vuelve a probar en un minuto o descárgalas en Seller Central.' })
  return url
}

/* ------------------------------------------------------------------ */
/* Marcha atrás                                                         */
/* ------------------------------------------------------------------ */

/**
 * Cancela el plan. Antes de confirmar el reparto no deja rastro; después cancela envíos reales, y con UPS
 * asociado solo devuelve el cargo dentro de voidableUntil (24 h en paquetería, 1 h en palés).
 */
export const cancelarPlan = (creds: AmazonCredentials, planId: string) =>
  escribir<{ operationId?: string }>(creds, 'cancelInboundPlan', 'PUT', `${RUTA}/inboundPlans/${enc(planId)}/cancellation`, {})
