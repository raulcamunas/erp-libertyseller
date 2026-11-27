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
export function cuerpoCrearPlan(p: { nombre: string; marketplaceId: string; origen: DireccionOrigen; lineas: LineaParaPlan[]; sinEtiqueta?: Set<string>; duenos?: Duenos }) {
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
      .map((l) => ({ msku: l.sku, quantity: l.unidades, prepOwner: p.duenos?.[l.sku]?.prep ?? 'SELLER', labelOwner: p.duenos?.[l.sku]?.label ?? (p.sinEtiqueta?.has(l.sku) ? 'NONE' : 'SELLER') })),
  }
}

/**
 * QUIÉN PREPARA Y QUIÉN ETIQUETA, POR SKU, cuando Amazon no acepta el SELLER de siempre. Amazon decide por producto si necesita preparación
 * (bolsa, plástico de burbujas…) y lo dice al crear el plan: «X does not require prepOwner but SELLER was assigned. Accepted values: [NONE]».
 * Lo que dice se apunta aquí y se manda igual en el plan y en las cajas.
 */
export type Duenos = Record<string, { prep?: string; label?: string }>

/**
 * LA PREPARACIÓN DE CADA SKU EN AMAZON (listPrepDetails / setPrepDetails). Es lo que en Seller Central sale como «Faltan detalles de preparación y
 * etiquetado» y se arregla eligiendo «No necesita preparación» y guardando. Antes de crear el plan se lee; a los que no tienen categoría se les pone
 * «No necesita preparación» (calzado, textil plegado, cajas… lo que mandan nuestros clientes), y de lo que Amazon permite se saca quién prepara y
 * quién etiqueta cada uno, para no mandarle un SELLER que va a rechazar.
 */
export interface PrepDeSku {
  msku: string
  prepCategory: string | null
  prepTypes: string[]
  prepOwnerConstraint: string | null
  labelOwnerConstraint: string | null
}

const aPrep = (x: Record<string, unknown>): PrepDeSku => ({
  msku: String(x.msku ?? ''),
  prepCategory: typeof x.prepCategory === 'string' ? x.prepCategory : null,
  prepTypes: Array.isArray(x.prepTypes) ? x.prepTypes.map(String) : [],
  prepOwnerConstraint: typeof x.prepOwnerConstraint === 'string' ? x.prepOwnerConstraint : null,
  labelOwnerConstraint: typeof x.labelOwnerConstraint === 'string' ? x.labelOwnerConstraint : null,
})

export async function leerPreparacion(creds: AmazonCredentials, marketplaceId: string, mskus: string[]): Promise<PrepDeSku[]> {
  const out: PrepDeSku[] = []
  for (let i = 0; i < mskus.length; i += 100) {
    const tanda = mskus.slice(i, i + 100)
    const leer = (path: string, query?: Record<string, string | string[]>) =>
      spApiRequest<{ mskuPrepDetails?: Array<Record<string, unknown>> }>(creds, 'listPrepDetails', { method: 'GET', path, query, maxAttempts: 2, repeatable: true })
    let r
    try {
      // La lista de SKU repitiendo el parámetro (collectionFormat multi)…
      r = await leer(`${RUTA}/items/prepDetails?marketplaceId=${enc(marketplaceId)}&${tanda.map((m) => `mskus=${enc(m)}`).join('&')}`)
    } catch (e) {
      if (!(e instanceof AmazonApiError) || e.httpStatus !== 400) throw e
      // …o separada por comas
      r = await leer(`${RUTA}/items/prepDetails`, { marketplaceId, mskus: tanda })
    }
    out.push(...(r.data?.mskuPrepDetails ?? []).map(aPrep))
  }
  return out
}

/** PURA. Sin categoría de preparación (lo que Seller Central marca con «Faltan detalles de preparación y etiquetado») */
export const sinPreparacion = (p: PrepDeSku) => !p.prepCategory || p.prepCategory === 'UNKNOWN'

export const fijarSinPreparacion = (creds: AmazonCredentials, marketplaceId: string, mskus: string[]) =>
  escribir<{ operationId?: string }>(creds, 'setPrepDetails', 'POST', `${RUTA}/items/prepDetails`, {
    marketplaceId,
    mskuPrepDetails: mskus.map((msku) => ({ msku, prepCategory: 'NONE', prepTypes: ['ITEM_NO_PREP'] })),
  })

/** PURA. Quién prepara y etiqueta según lo que Amazon permite a cada SKU (NONE_ONLY, SELLER_ONLY, AMAZON_ONLY). Sin restricción, no se apunta nada */
export function duenosDePreparacion(lista: readonly PrepDeSku[]): Duenos {
  const de = (c: string | null) => (c === 'NONE_ONLY' ? 'NONE' : c === 'SELLER_ONLY' ? 'SELLER' : c === 'AMAZON_ONLY' ? 'AMAZON' : undefined)
  const out: Duenos = {}
  for (const p of lista) {
    const prep = de(p.prepOwnerConstraint) ?? (sinPreparacion(p) || p.prepCategory === 'NONE' || p.prepTypes.includes('ITEM_NO_PREP') ? 'NONE' : undefined)
    const label = de(p.labelOwnerConstraint)
    if (prep || label) out[p.msku] = { ...(prep ? { prep } : {}), ...(label ? { label } : {}) }
  }
  return out
}

/** PURA. Los dueños que pide Amazon en el error de createInboundPlan (todos los que nombre), o null si el error no es ese */
export function duenosDelError(e: unknown): Duenos | null {
  if (!(e instanceof AmazonApiError)) return null
  const texto = [e.message, ...e.issues.map((i) => i.message ?? '')].join('\n')
  const re = /(\S+?) (?:does not require|requires) (prepOwner|labelOwner) but (\w+) was assigned\.?\s*Accepted values:\s*\[([A-Z_,\s]*)\]/g
  const out: Duenos = {}
  for (const m of Array.from(texto.matchAll(re))) {
    const validos = m[4].split(',').map((x) => x.trim()).filter(Boolean)
    if (!validos.length) continue
    // Si vale SELLER (lo nuestro: el cliente prepara y etiqueta, sin cobro de Amazon), SELLER; si no, el primero que acepte
    const valor = validos.includes('SELLER') ? 'SELLER' : validos[0]
    const sku = m[1].replace(/^ERROR:\s*/, '')
    out[sku] = { ...out[sku], [m[2] === 'prepOwner' ? 'prep' : 'label']: valor }
  }
  return Object.keys(out).length ? out : null
}

/* ------------------------------------------------------------------ */
/* La dirección que Amazon no verifica                                 */
/* ------------------------------------------------------------------ */

/** ¿Es el «WARNING: Address was unable to be verified» de createInboundPlan? */
export function esDireccionSinVerificar(e: unknown): boolean {
  return e instanceof AmazonApiError && e.httpStatus === 400 && /address was unable to be verified|address.*(invalid|not valid|could not be validated)/i.test(e.message)
}

const sinAcentos = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '')
const TIPO_DE_VIA = /^(calle|c\/|c\.|cl\.?|avenida|avda\.?|av\.?|plaza|pza\.?|pl\.?|paseo|p[ºo]\.?|camino|carretera|ctra\.?|ronda|travesía|travesia|pasaje|glorieta|rúa|rua|carrer|kalea)\s+/i
/** Ciudades con su nombre en la otra lengua oficial (el callejero de Amazon a veces solo tiene una) */
const OTRO_NOMBRE: Record<string, string[]> = {
  pamplona: ['Pamplona/Iruña', 'Iruña'],
  'san sebastian': ['Donostia-San Sebastián', 'Donostia'],
  vitoria: ['Vitoria-Gasteiz'],
  'vitoria-gasteiz': ['Vitoria'],
  bilbao: ['Bilbo'],
  'a coruna': ['La Coruña'],
  'la coruna': ['A Coruña'],
  orense: ['Ourense'],
  lerida: ['Lleida'],
  gerona: ['Girona'],
  alicante: ['Alicante/Alacant'],
  castellon: ['Castellón de la Plana'],
  valencia: ['València'],
  palma: ['Palma de Mallorca'],
}

/**
 * PURA. Las formas de escribir la MISMA dirección que se prueban, por orden, cuando Amazon no verifica la que hay guardada: sin provincia, sin acentos,
 * con el número tras coma, sin el tipo de vía, con «C/», con el nombre de la ciudad en la otra lengua. Nunca cambia la calle, el número ni el código
 * postal: solo cómo se escriben. Sin repetidas y como mucho `max`.
 */
export function variantesDeDireccion(o: DireccionOrigen, max = 14): DireccionOrigen[] {
  const linea = (o.linea1 ?? '').trim()
  const ciudad = (o.ciudad ?? '').trim()
  const m = linea.match(/^(.*?)[,\s]+(\d+[a-zA-Z]?)\s*$/)
  const calle = m ? m[1].trim() : linea
  const numero = m ? m[2] : ''
  const nombreCalle = calle.replace(TIPO_DE_VIA, '').trim()
  const junta = (c: string, coma: boolean) => (numero ? `${c}${coma ? ', ' : ' '}${numero}` : c)
  const lineas = [
    linea,
    junta(calle, true),
    sinAcentos(linea),
    junta(sinAcentos(calle), true),
    nombreCalle !== calle ? junta(nombreCalle, false) : '',
    nombreCalle !== calle ? junta(nombreCalle, true) : '',
    nombreCalle !== calle ? junta(`C/ ${nombreCalle}`, false) : '',
    nombreCalle !== calle ? junta(sinAcentos(nombreCalle), false) : '',
  ].filter(Boolean)
  const ciudades = [ciudad, ...(OTRO_NOMBRE[sinAcentos(ciudad).toLowerCase()] ?? [])]
  const provincias = [...new Set([o.provincia?.trim() ? o.provincia.trim() : null, null])]
  const salida: DireccionOrigen[] = []
  const vistas = new Set<string>()
  const meter = (l: string, c: string, p: string | null) => {
    const k = `${l}|${c}|${p ?? ''}`
    if (vistas.has(k) || salida.length >= max) return
    vistas.add(k)
    salida.push({ ...o, linea1: l, ciudad: c, provincia: p })
  }
  // Primero lo guardado (con y sin provincia), luego las formas de la calle, y al final la ciudad en la otra lengua
  for (const p of provincias) meter(linea, ciudad, p)
  for (const l of lineas) meter(l, ciudad, null)
  for (const c of ciudades.slice(1)) for (const l of lineas.slice(0, 3)) meter(l, c, null)
  return salida
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
export function cuerpoCajas(grupos: Array<{ packingGroupId: string; cajas: CajaDeGrupo[] }>, sinEtiqueta?: Set<string>, duenos?: Duenos) {
  return {
    packageGroupings: grupos.map((g) => ({
      packingGroupId: g.packingGroupId,
      boxes: g.cajas.map((c) => ({
        quantity: 1,
        contentInformationSource: 'BOX_CONTENT_PROVIDED',
        dimensions: { unitOfMeasurement: 'CM', length: c.largoCm, width: c.anchoCm, height: c.altoCm },
        weight: { unit: 'KG', value: c.pesoKg },
        items: c.contenido.map((x) => ({ msku: x.msku, quantity: x.unidades, prepOwner: duenos?.[x.msku]?.prep ?? 'SELLER', labelOwner: duenos?.[x.msku]?.label ?? (sinEtiqueta?.has(x.msku) ? 'NONE' : 'SELLER') })),
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
