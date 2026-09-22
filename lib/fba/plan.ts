import { AmazonApiError } from '@/lib/amazon/errors'
import { spApiRequest, type AmazonCredentials } from '@/lib/amazon/sp-api'

/**
 * CREAR EL ENVÍO EN AMAZON: LA FULFILLMENT INBOUND API 2024-03-20.
 * ===============================================================
 * SOLO SERVIDOR.
 *
 * Es el «Enviar a Amazon» de Seller Central por API. Y es, de largo, lo más
 * delicado del ERP: todo lo demás lee, o como mucho cambia un precio que se
 * arregla en quince minutos. Esto CREA ENVÍOS FÍSICOS en la cuenta del cliente,
 * con sus etiquetas y su transportista.
 *
 *
 * ============ TODO LO QUE ESCRIBE ES ASÍNCRONO ============
 *
 * Las operaciones POST no hacen el trabajo: devuelven un `operationId` y lo
 * hacen por detrás. Hay que preguntar por él hasta que diga SUCCESS o FAILED.
 *
 * Y un FAILED no llega como error HTTP: llega como un 200 con estado FAILED y
 * una lista de `operationProblems`. Tratar el 200 como éxito —que es lo natural—
 * hace que el asistente siga al paso siguiente sobre un paso que no ocurrió.
 * Por eso `esperar()` es obligatorio después de cada escritura, y por eso lanza.
 *
 *
 * ============ EL ORDEN, Y POR QUÉ NO SE PUEDE SALTAR ============
 *
 *   1. createInboundPlan            qué se manda y desde dónde
 *   2. generatePackingOptions       Amazon propone cómo agrupar
 *   3. confirmPackingOption         se elige una
 *   4. setPackingInformation        NUESTRAS cajas: medidas, pesos, contenido
 *   5. generatePlacementOptions     Amazon reparte por centros, con sus tarifas
 *   6. confirmPlacementOption       IRREVERSIBLE: nacen los FBA… de verdad
 *   7. generateTransportationOptions transportista y fecha de salida
 *   8. confirmTransportationOptions  se elige uno
 *   9. updateShipmentTrackingDetails los seguimientos, si el transporte es propio
 *
 * El paso 6 es el punto de no retorno. Antes de él, `cancelInboundPlan` deshace
 * todo sin dejar rastro. Después, cancelar es cancelar un envío de verdad.
 *
 * OJO con el 4 y el 5: si se cambian las cajas después de generar las opciones
 * de reparto, HAY QUE VOLVER A GENERARLAS. Amazon lo documenta y no avisa: las
 * opciones viejas siguen ahí, se pueden confirmar, y el envío nace con unas
 * cajas que no son las que hay.
 */

const RUTA = '/inbound/fba/2024-03-20'

/* ------------------------------------------------------------------ */
/* Esperar a que una operación asíncrona termine                       */
/* ------------------------------------------------------------------ */

export interface ProblemaOperacion {
  code: string | null
  message: string
  details: string | null
  severity: string | null
}

/** Cada cuánto se pregunta y cuánto se espera como mucho */
const ESPERA_MS = 2_000
const INTENTOS = 60

/**
 * Pregunta por una operación hasta que acaba.
 *
 * Lanza si acaba en FAILED, con los problemas que haya devuelto Amazon dentro
 * del mensaje. Lanza también si se agota la espera: dos minutos es muchísimo
 * para estas operaciones, y seguir esperando en una petición web solo sirve
 * para que el navegador corte y nadie sepa en qué quedó.
 *
 * Los problemas de severidad WARNING no paran nada: Amazon los usa para cosas
 * como «la dirección parece rara pero te dejo seguir». Se devuelven para
 * poder enseñarlos.
 */
export async function esperar(
  creds: AmazonCredentials,
  operationId: string
): Promise<{ avisos: ProblemaOperacion[] }> {
  for (let i = 0; i < INTENTOS; i++) {
    const { data } = await spApiRequest<{
      operationStatus?: string
      operationProblems?: Array<Record<string, unknown>>
      operation?: string
    }>(creds, 'getInboundOperationStatus', {
      method: 'GET',
      path: `${RUTA}/operations/${encodeURIComponent(operationId)}`,
    })

    const problemas: ProblemaOperacion[] = (data.operationProblems ?? []).map((p) => ({
      code: (p.code as string) ?? null,
      message: (p.message as string) ?? 'Sin mensaje',
      details: (p.details as string) ?? null,
      severity: (p.severity as string) ?? null,
    }))

    if (data.operationStatus === 'SUCCESS') {
      return { avisos: problemas.filter((p) => (p.severity ?? '').toUpperCase() !== 'ERROR') }
    }

    if (data.operationStatus === 'FAILED') {
      const graves = problemas.filter((p) => (p.severity ?? 'ERROR').toUpperCase() === 'ERROR')
      const lista = (graves.length > 0 ? graves : problemas).map((p) => p.message).join('. ')
      throw new AmazonApiError({
        kind: 'datos',
        message: `operación ${data.operation ?? ''} ${operationId} FAILED: ${lista}`,
        humanMessage:
          lista ||
          'Amazon ha rechazado el paso pero no ha dicho por qué. Vuelve a intentarlo y, si sigue, avisa.',
      })
    }

    await new Promise((r) => setTimeout(r, ESPERA_MS))
  }

  throw new AmazonApiError({
    kind: 'servidor',
    message: `operación ${operationId} sigue IN_PROGRESS tras ${(INTENTOS * ESPERA_MS) / 1000}s`,
    humanMessage:
      'Amazon está tardando más de lo normal en procesar este paso. NO lo repitas todavía: ' +
      'puede haber terminado por detrás. Refresca dentro de un minuto para ver cómo quedó.',
    retryable: true,
  })
}

/* ------------------------------------------------------------------ */
/* 1 · El plan                                                          */
/* ------------------------------------------------------------------ */

export interface Direccion {
  nombre: string
  empresa: string
  linea1: string
  linea2?: string | null
  ciudad: string
  provincia: string
  codigoPostal: string
  pais: string
  telefono: string
  email: string
}

export interface ArticuloPlan {
  msku: string
  unidades: number
}

/**
 * `prepOwner` y `labelOwner` van a SELLER, y es una decisión, no un valor por
 * defecto: significa que el preparado y el etiquetado los hace el vendedor.
 *
 * Con AMAZON, Amazon los etiqueta él y COBRA por unidad. Dado que el flujo
 * entero de aquí está montado para que el cliente imprima y pegue las etiquetas
 * antes de encajar, poner AMAZON sería pagar por algo que ya se ha hecho.
 */
export async function crearPlan(
  creds: AmazonCredentials,
  params: { nombre: string; marketplaceId: string; origen: Direccion; articulos: ArticuloPlan[] }
): Promise<{ inboundPlanId: string; avisos: ProblemaOperacion[] }> {
  const { data } = await spApiRequest<{ inboundPlanId?: string; operationId?: string }>(
    creds,
    'createInboundPlan',
    {
      method: 'POST',
      path: `${RUTA}/inboundPlans`,
      body: {
        name: params.nombre.slice(0, 40),
        destinationMarketplaces: [params.marketplaceId],
        sourceAddress: {
          name: params.origen.nombre,
          companyName: params.origen.empresa,
          addressLine1: params.origen.linea1,
          ...(params.origen.linea2 ? { addressLine2: params.origen.linea2 } : {}),
          city: params.origen.ciudad,
          stateOrProvinceCode: params.origen.provincia,
          postalCode: params.origen.codigoPostal,
          countryCode: params.origen.pais,
          phoneNumber: params.origen.telefono,
          email: params.origen.email,
        },
        items: params.articulos.map((a) => ({
          msku: a.msku,
          quantity: a.unidades,
          prepOwner: 'SELLER',
          labelOwner: 'SELLER',
        })),
      },
      repeatable: false,
      maxAttempts: 1,
    }
  )

  if (!data.inboundPlanId || !data.operationId) {
    throw new AmazonApiError({
      kind: 'servidor',
      message: 'createInboundPlan sin inboundPlanId u operationId',
      humanMessage: 'Amazon ha aceptado el plan pero no ha devuelto su identificador.',
    })
  }

  const { avisos } = await esperar(creds, data.operationId)
  return { inboundPlanId: data.inboundPlanId, avisos }
}

/* ------------------------------------------------------------------ */
/* 2 y 3 · Cómo se agrupa                                               */
/* ------------------------------------------------------------------ */

export interface OpcionEmpaquetado {
  packingOptionId: string
  estado: string
  grupos: string[]
  coste: number
  descuento: number
  moneda: string | null
  caduca: string | null
}

export async function generarOpcionesEmpaquetado(
  creds: AmazonCredentials,
  planId: string
): Promise<void> {
  const { data } = await spApiRequest<{ operationId?: string }>(creds, 'generatePackingOptions', {
    method: 'POST',
    path: `${RUTA}/inboundPlans/${encodeURIComponent(planId)}/packingOptions`,
    body: {},
    repeatable: false,
    maxAttempts: 1,
  })
  if (data.operationId) await esperar(creds, data.operationId)
}

function suma(lista: Array<{ value?: { amount?: number } }> | undefined): number {
  return (lista ?? []).reduce((s, x) => s + (x.value?.amount ?? 0), 0)
}

function moneda(lista: Array<{ value?: { code?: string } }> | undefined): string | null {
  return (lista ?? []).find((x) => x.value?.code)?.value?.code ?? null
}

export async function listarOpcionesEmpaquetado(
  creds: AmazonCredentials,
  planId: string
): Promise<OpcionEmpaquetado[]> {
  const { data } = await spApiRequest<{ packingOptions?: Array<Record<string, unknown>> }>(
    creds,
    'listPackingOptions',
    { method: 'GET', path: `${RUTA}/inboundPlans/${encodeURIComponent(planId)}/packingOptions` }
  )
  return (data.packingOptions ?? []).map((o) => ({
    packingOptionId: o.packingOptionId as string,
    estado: (o.status as string) ?? 'DESCONOCIDO',
    grupos: (o.packingGroups as string[]) ?? [],
    coste: suma(o.fees as Array<{ value?: { amount?: number } }>),
    descuento: suma(o.discounts as Array<{ value?: { amount?: number } }>),
    moneda: moneda(o.fees as Array<{ value?: { code?: string } }>),
    caduca: (o.expiration as string) ?? null,
  }))
}

/**
 * QUÉ REFERENCIAS VAN EN CADA GRUPO DE EMPAQUETADO.
 *
 * Una opción de agrupado puede partir la mercancía en VARIOS grupos, y esto es
 * lo que más sorprende: Amazon decide que ciertas referencias no pueden viajar
 * juntas —por tamaño, por peligrosidad, por centro de destino— y cada grupo se
 * empaqueta por separado.
 *
 * Importa porque nuestras cajas se rellenan ANTES de saberlo. Si una caja lleva
 * referencias de dos grupos distintos, Amazon la rechaza; y sin esta llamada no
 * hay forma de avisar antes de que el cliente haya cerrado las cajas con cinta.
 */
export async function articulosDelGrupo(
  creds: AmazonCredentials,
  planId: string,
  packingGroupId: string
): Promise<Array<{ msku: string; unidades: number }>> {
  const { data } = await spApiRequest<{ items?: Array<Record<string, unknown>> }>(
    creds,
    'listPackingGroupItems',
    {
      method: 'GET',
      path: `${RUTA}/inboundPlans/${encodeURIComponent(planId)}/packingGroups/${encodeURIComponent(packingGroupId)}/items`,
    }
  )
  return (data.items ?? []).map((i) => ({
    msku: i.msku as string,
    unidades: (i.quantity as number) ?? 0,
  }))
}

/**
 * El mapa de referencia -> grupo, de una opción de agrupado entera.
 *
 * Con esto se puede comprobar, antes de mandar nada, que ninguna de nuestras
 * cajas mezcla grupos.
 */
export async function mapaDeGrupos(
  creds: AmazonCredentials,
  planId: string,
  grupos: string[]
): Promise<Map<string, string>> {
  const mapa = new Map<string, string>()
  for (const g of grupos) {
    for (const a of await articulosDelGrupo(creds, planId, g)) {
      mapa.set(a.msku, g)
    }
  }
  return mapa
}

export async function confirmarEmpaquetado(
  creds: AmazonCredentials,
  planId: string,
  packingOptionId: string
): Promise<void> {
  const { data } = await spApiRequest<{ operationId?: string }>(creds, 'confirmPackingOption', {
    method: 'POST',
    path: `${RUTA}/inboundPlans/${encodeURIComponent(planId)}/packingOptions/${encodeURIComponent(packingOptionId)}/confirmation`,
    body: {},
    repeatable: false,
    maxAttempts: 1,
  })
  if (data.operationId) await esperar(creds, data.operationId)
}

/* ------------------------------------------------------------------ */
/* 4 · Nuestras cajas                                                   */
/* ------------------------------------------------------------------ */

export interface CajaParaAmazon {
  largoCm: number
  anchoCm: number
  altoCm: number
  pesoKg: number
  contenido: Array<{ msku: string; unidades: number }>
}

/**
 * Manda las cajas de verdad: medidas, peso y qué va dentro de cada una.
 *
 * `quantity: 1` por caja y no una caja con `quantity: 3`. Amazon admite las dos
 * formas, pero la segunda significa «tres cajas IDÉNTICAS», y aquí cada caja
 * lleva su contenido y su peso: dos cajas del mismo envío casi nunca pesan lo
 * mismo, y agruparlas perdería esa diferencia.
 *
 * `contentInformationSource: BOX_CONTENT_PROVIDED` porque decimos qué va dentro.
 * Las otras opciones —MANUAL_PROCESS y BARCODE_2D— son para quien no lo declara,
 * y Amazon cobra una tarifa por procesarlo.
 */
export async function mandarCajas(
  creds: AmazonCredentials,
  planId: string,
  grupos: Array<{ packingGroupId: string; cajas: CajaParaAmazon[] }>
): Promise<void> {
  const { data } = await spApiRequest<{ operationId?: string }>(creds, 'setPackingInformation', {
    method: 'POST',
    path: `${RUTA}/inboundPlans/${encodeURIComponent(planId)}/packingInformation`,
    body: {
      packageGroupings: grupos.map((g) => ({
        packingGroupId: g.packingGroupId,
        boxes: g.cajas.map((c) => ({
          quantity: 1,
          contentInformationSource: 'BOX_CONTENT_PROVIDED',
          dimensions: {
            unitOfMeasurement: 'CM',
            length: c.largoCm,
            width: c.anchoCm,
            height: c.altoCm,
          },
          weight: { unit: 'KG', value: c.pesoKg },
          items: c.contenido.map((x) => ({
            msku: x.msku,
            quantity: x.unidades,
            prepOwner: 'SELLER',
            labelOwner: 'SELLER',
          })),
        })),
      })),
    },
    repeatable: false,
    maxAttempts: 1,
  })
  if (data.operationId) await esperar(creds, data.operationId)
}

/* ------------------------------------------------------------------ */
/* 5 y 6 · Dónde lo quiere Amazon                                       */
/* ------------------------------------------------------------------ */

export interface OpcionReparto {
  placementOptionId: string
  estado: string
  envios: string[]
  coste: number
  descuento: number
  moneda: string | null
  caduca: string | null
}

export async function generarOpcionesReparto(creds: AmazonCredentials, planId: string): Promise<void> {
  const { data } = await spApiRequest<{ operationId?: string }>(creds, 'generatePlacementOptions', {
    method: 'POST',
    path: `${RUTA}/inboundPlans/${encodeURIComponent(planId)}/placementOptions`,
    body: {},
    repeatable: false,
    maxAttempts: 1,
  })
  if (data.operationId) await esperar(creds, data.operationId)
}

export async function listarOpcionesReparto(
  creds: AmazonCredentials,
  planId: string
): Promise<OpcionReparto[]> {
  const { data } = await spApiRequest<{ placementOptions?: Array<Record<string, unknown>> }>(
    creds,
    'listPlacementOptions',
    { method: 'GET', path: `${RUTA}/inboundPlans/${encodeURIComponent(planId)}/placementOptions` }
  )
  return (data.placementOptions ?? []).map((o) => ({
    placementOptionId: o.placementOptionId as string,
    estado: (o.status as string) ?? 'DESCONOCIDO',
    envios: (o.shipmentIds as string[]) ?? [],
    coste: suma(o.fees as Array<{ value?: { amount?: number } }>),
    descuento: suma(o.discounts as Array<{ value?: { amount?: number } }>),
    moneda: moneda(o.fees as Array<{ value?: { code?: string } }>),
    caduca: (o.expiration as string) ?? null,
  }))
}

/**
 * EL PUNTO DE NO RETORNO.
 *
 * Aquí nacen los identificadores de envío de verdad —los FBA… que van en las
 * etiquetas— y Amazon deja de admitir cambios. A partir de este momento,
 * deshacer es cancelar un envío real.
 */
export async function confirmarReparto(
  creds: AmazonCredentials,
  planId: string,
  placementOptionId: string
): Promise<void> {
  const { data } = await spApiRequest<{ operationId?: string }>(creds, 'confirmPlacementOption', {
    method: 'POST',
    path: `${RUTA}/inboundPlans/${encodeURIComponent(planId)}/placementOptions/${encodeURIComponent(placementOptionId)}/confirmation`,
    body: {},
    repeatable: false,
    maxAttempts: 1,
  })
  if (data.operationId) await esperar(creds, data.operationId)
}

/* ------------------------------------------------------------------ */
/* 7 y 8 · Quién lo lleva                                               */
/* ------------------------------------------------------------------ */

export interface OpcionTransporte {
  transportationOptionId: string
  shipmentId: string
  transportista: string | null
  codigoTransportista: string | null
  modo: string
  solucion: string
  coste: number | null
  moneda: string | null
  caduca: string | null
  anulableHasta: string | null
  /** true = lo lleva el transportista asociado de Amazon y lo cobra Amazon */
  deAmazon: boolean
}

export async function generarOpcionesTransporte(
  creds: AmazonCredentials,
  planId: string,
  params: {
    placementOptionId: string
    envios: Array<{ shipmentId: string; saleEl: string; contacto?: { nombre: string; telefono: string; email?: string } }>
  }
): Promise<void> {
  const { data } = await spApiRequest<{ operationId?: string }>(
    creds,
    'generateTransportationOptions',
    {
      method: 'POST',
      path: `${RUTA}/inboundPlans/${encodeURIComponent(planId)}/transportationOptions`,
      body: {
        placementOptionId: params.placementOptionId,
        shipmentTransportationConfigurations: params.envios.map((e) => ({
          shipmentId: e.shipmentId,
          // La ventana de salida. Solo `start` es obligatorio
          readyToShipWindow: { start: e.saleEl },
          ...(e.contacto
            ? {
                contactInformation: {
                  name: e.contacto.nombre,
                  phoneNumber: e.contacto.telefono,
                  ...(e.contacto.email ? { email: e.contacto.email } : {}),
                },
              }
            : {}),
        })),
      },
      repeatable: false,
      maxAttempts: 1,
    }
  )
  if (data.operationId) await esperar(creds, data.operationId)
}

export async function listarOpcionesTransporte(
  creds: AmazonCredentials,
  planId: string,
  placementOptionId?: string
): Promise<OpcionTransporte[]> {
  const { data } = await spApiRequest<{ transportationOptions?: Array<Record<string, unknown>> }>(
    creds,
    'listTransportationOptions',
    {
      method: 'GET',
      path: `${RUTA}/inboundPlans/${encodeURIComponent(planId)}/transportationOptions`,
      query: placementOptionId ? { placementOptionId } : undefined,
    }
  )
  return (data.transportationOptions ?? []).map((o) => {
    const carrier = (o.carrier ?? {}) as { name?: string; alphaCode?: string }
    const quote = (o.quote ?? {}) as { cost?: { amount?: number; code?: string }; expiration?: string; voidableUntil?: string }
    const solucion = (o.shippingSolution as string) ?? ''
    return {
      transportationOptionId: o.transportationOptionId as string,
      shipmentId: o.shipmentId as string,
      transportista: carrier.name ?? null,
      codigoTransportista: carrier.alphaCode ?? null,
      modo: (o.shippingMode as string) ?? '',
      solucion,
      coste: quote.cost?.amount ?? null,
      moneda: quote.cost?.code ?? null,
      caduca: quote.expiration ?? null,
      anulableHasta: quote.voidableUntil ?? null,
      // Amazon lo marca en `shippingSolution`. Si es suyo, él genera los
      // seguimientos y los cobra; si no, los tenemos que mandar nosotros.
      deAmazon: solucion.toUpperCase().includes('AMAZON'),
    }
  })
}

export async function confirmarTransporte(
  creds: AmazonCredentials,
  planId: string,
  selecciones: Array<{ shipmentId: string; transportationOptionId: string; contacto?: { nombre: string; telefono: string; email?: string } }>
): Promise<void> {
  const { data } = await spApiRequest<{ operationId?: string }>(
    creds,
    'confirmTransportationOptions',
    {
      method: 'POST',
      path: `${RUTA}/inboundPlans/${encodeURIComponent(planId)}/transportationOptions/confirmation`,
      body: {
        transportationSelections: selecciones.map((s) => ({
          shipmentId: s.shipmentId,
          transportationOptionId: s.transportationOptionId,
          ...(s.contacto
            ? {
                contactInformation: {
                  name: s.contacto.nombre,
                  phoneNumber: s.contacto.telefono,
                  ...(s.contacto.email ? { email: s.contacto.email } : {}),
                },
              }
            : {}),
        })),
      },
      repeatable: false,
      maxAttempts: 1,
    }
  )
  if (data.operationId) await esperar(creds, data.operationId)
}

/* ------------------------------------------------------------------ */
/* 9 · Los seguimientos, cuando el transporte es propio                 */
/* ------------------------------------------------------------------ */

/**
 * Manda a Amazon los números de seguimiento.
 *
 * SOLO para transporte propio: si se eligió el transportista asociado de
 * Amazon, los seguimientos los pone él y mandar los nuestros los pisaría.
 *
 * Paquetería: un número por CAJA, con el `boxId` que Amazon dio.
 * Camión: el número PRO del transportista, y opcionalmente el del albarán.
 */
export async function mandarSeguimientos(
  creds: AmazonCredentials,
  planId: string,
  shipmentId: string,
  detalles:
    | { tipo: 'paquete'; porCaja: Array<{ boxId: string; seguimiento: string }> }
    | { tipo: 'camion'; numerosPro: string[]; albaran?: string | null }
): Promise<void> {
  await spApiRequest<unknown>(creds, 'updateShipmentTrackingDetails', {
    method: 'PUT',
    path: `${RUTA}/inboundPlans/${encodeURIComponent(planId)}/shipments/${encodeURIComponent(shipmentId)}/trackingDetails`,
    body: {
      trackingDetails:
        detalles.tipo === 'paquete'
          ? {
              spdTrackingDetail: {
                spdTrackingItems: detalles.porCaja.map((c) => ({
                  boxId: c.boxId,
                  trackingId: c.seguimiento,
                })),
              },
            }
          : {
              ltlTrackingDetail: {
                freightBillNumber: detalles.numerosPro,
                ...(detalles.albaran ? { billOfLadingNumber: detalles.albaran } : {}),
              },
            },
    },
    repeatable: false,
    maxAttempts: 1,
  })
}

/* ------------------------------------------------------------------ */
/* Consultas y marcha atrás                                             */
/* ------------------------------------------------------------------ */

export interface EnvioDelPlan {
  shipmentId: string
  /** El FBA… de verdad. Solo existe DESPUÉS de confirmar el reparto */
  confirmacion: string | null
  nombre: string | null
  estado: string | null
  destino: string | null
}

export async function verEnvio(
  creds: AmazonCredentials,
  planId: string,
  shipmentId: string
): Promise<EnvioDelPlan> {
  const { data } = await spApiRequest<Record<string, unknown>>(creds, 'getShipment', {
    method: 'GET',
    path: `${RUTA}/inboundPlans/${encodeURIComponent(planId)}/shipments/${encodeURIComponent(shipmentId)}`,
  })
  const destino = (data.destination ?? {}) as { warehouseId?: string }
  return {
    shipmentId: (data.shipmentId as string) ?? shipmentId,
    confirmacion: (data.shipmentConfirmationId as string) ?? null,
    nombre: (data.name as string) ?? null,
    estado: (data.status as string) ?? null,
    destino: destino.warehouseId ?? null,
  }
}

export interface CajaDeAmazon {
  boxId: string | null
  packageId: string
  unidades: number | null
}

export async function cajasDelEnvio(
  creds: AmazonCredentials,
  planId: string,
  shipmentId: string
): Promise<CajaDeAmazon[]> {
  const { data } = await spApiRequest<{ boxes?: Array<Record<string, unknown>> }>(
    creds,
    'listShipmentBoxes',
    {
      method: 'GET',
      path: `${RUTA}/inboundPlans/${encodeURIComponent(planId)}/shipments/${encodeURIComponent(shipmentId)}/boxes`,
    }
  )
  return (data.boxes ?? []).map((b) => ({
    boxId: (b.boxId as string) ?? null,
    packageId: b.packageId as string,
    unidades: (b.quantity as number) ?? null,
  }))
}

/**
 * Deshacer el plan. SOLO sirve antes de confirmar el reparto.
 *
 * Después, Amazon lo admite igual pero lo que se cancela es un envío de verdad,
 * con sus plazos: paquetería 24 horas, camión una hora. Quien llame a esto tiene
 * que saber en qué lado está.
 */
export async function cancelarPlan(creds: AmazonCredentials, planId: string): Promise<void> {
  const { data } = await spApiRequest<{ operationId?: string }>(creds, 'cancelInboundPlan', {
    method: 'PUT',
    path: `${RUTA}/inboundPlans/${encodeURIComponent(planId)}/cancellation`,
    body: {},
    repeatable: false,
    maxAttempts: 1,
  })
  if (data.operationId) await esperar(creds, data.operationId)
}

/* ------------------------------------------------------------------ */
/* Las etiquetas de producto, las oficiales de Amazon                   */
/* ------------------------------------------------------------------ */

/** Los formatos de hoja que admite Amazon. Los nuestros están en etiquetas.ts */
export const HOJAS_AMAZON = [
  'A4_21',
  'A4_24',
  'A4_24_64x33',
  'A4_24_66x35',
  'A4_24_70x36',
  'A4_24_70x37',
  'A4_24i',
  'A4_27',
  'A4_40_52x29',
  'A4_44_48x25',
  'Letter_30',
] as const

/**
 * Las etiquetas de producto generadas por Amazon.
 *
 * Existen las nuestras (lib/fba/etiquetas.ts) y funcionan —se comprobó que el
 * código de barras sale idéntico al suyo, barra por barra—. Esto se ofrece
 * además porque son las oficiales y llevan el título exacto del catálogo, y
 * porque hay quien prefiere no discutir con un almacén.
 *
 * Devuelve un enlace de descarga que CADUCA. Se usa al momento, no se guarda.
 */
export async function etiquetasDeAmazon(
  creds: AmazonCredentials,
  params: {
    marketplaceId: string
    articulos: Array<{ msku: string; unidades: number }>
    hoja?: (typeof HOJAS_AMAZON)[number]
    termica?: boolean
  }
): Promise<Array<{ uri: string; caduca: string | null }>> {
  const { data } = await spApiRequest<{ documentDownloads?: Array<Record<string, unknown>> }>(
    creds,
    'createMarketplaceItemLabels',
    {
      method: 'POST',
      path: `${RUTA}/items/labels`,
      body: {
        marketplaceId: params.marketplaceId,
        labelType: params.termica ? 'THERMAL_PRINTING' : 'STANDARD_FORMAT',
        ...(params.termica ? {} : { pageType: params.hoja ?? 'A4_21' }),
        mskuQuantities: params.articulos.map((a) => ({ msku: a.msku, quantity: a.unidades })),
        localeCode: 'es_ES',
      },
      repeatable: false,
      maxAttempts: 1,
    }
  )
  return (data.documentDownloads ?? []).map((d) => ({
    uri: d.uri as string,
    caduca: (d.expiration as string) ?? null,
  }))
}
