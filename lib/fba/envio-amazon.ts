/**
 * ENVIAR A AMAZON DESDE EL ERP: LA SECUENCIA Y LAS VALIDACIONES.
 * ==============================================================
 *
 * Funciones PURAS, sin base de datos ni red: se prueban con respuestas de Amazon de mentira
 * (envio-amazon.prueba.ts). El motor que habla con Amazon y guarda en la base está en
 * lib/fba/envio-amazon-motor.ts; el cliente de la API, en lib/fba/inbound-v2024.ts.
 *
 *
 * ============ LAS SEIS FASES (lo que ve la agencia) ============
 *
 *   1 Inventario   createInboundPlan con las líneas de la remesa aprobada y la dirección de origen.
 *   2 Embalaje     generate/confirm packing + setPackingInformation con NUESTRAS cajas. Desde aquí las
 *                  cajas quedan BLOQUEADAS en el ERP y en el enlace del cliente.
 *   3 Reparto      generatePlacementOptions → la agencia compara tarifa y nº de centros → confirmar.
 *                  IRREVERSIBLE: nacen los FBA… de verdad.
 *   4 Transporte   generateTransportationOptions con la fecha de recogida → UPS (transportista asociado)
 *                  → EL CLIENTE ACEPTA EL COSTE en su enlace → la agencia confirma. Desde ahí corre el
 *                  plazo de anulación sin coste (24 h en paquetería).
 *   5 Etiquetas    getLabels (v0): etiquetas de caja con la de UPS.
 *   6 Seguimiento  estado del plan y cancelar mientras se pueda.
 *
 *
 * ============ CADA PASO ES UNA OPERACIÓN ASÍNCRONA ============
 *
 * Todas las POST de la API 2024-03-20 devuelven un operationId y trabajan por detrás. El ERP NO espera
 * dentro de la petición: apunta la operación (fba_inbound_operaciones) y la pantalla pregunta cada pocos
 * segundos. Cuando una acaba en SUCCESS, el motor lanza la siguiente o se para a esperar una decisión
 * (elegir reparto, elegir transporte, la aceptación del cliente, confirmar). Un 200 con FAILED es un
 * FALLO: el paso se queda donde estaba con el error a la vista y se puede reintentar.
 */

/* ------------------------------------------------------------------ */
/* Pasos y fases                                                       */
/* ------------------------------------------------------------------ */

export type ModoEnvio = 'manual' | 'api'

export type PasoEnvio =
  | 'sin_empezar'
  | 'plan'
  | 'embalaje_generar'
  | 'embalaje_elegir'
  | 'embalaje_confirmar'
  | 'cajas'
  | 'cajas_conflicto'
  | 'cajas_reabiertas'
  | 'reparto_generar'
  | 'reparto_elegir'
  | 'reparto_confirmar'
  | 'transporte_datos'
  | 'transporte_generar'
  | 'transporte_elegir'
  | 'transporte_cliente'
  | 'transporte_listo'
  | 'ventana_generar'
  | 'ventana_confirmar'
  | 'transporte_confirmar'
  | 'etiquetas'
  | 'cancelando'
  | 'cancelado'

export const PASOS_ENVIO: PasoEnvio[] = [
  'sin_empezar',
  'plan',
  'embalaje_generar',
  'embalaje_elegir',
  'embalaje_confirmar',
  'cajas',
  'cajas_conflicto',
  'cajas_reabiertas',
  'reparto_generar',
  'reparto_elegir',
  'reparto_confirmar',
  'transporte_datos',
  'transporte_generar',
  'transporte_elegir',
  'transporte_cliente',
  'transporte_listo',
  'ventana_generar',
  'ventana_confirmar',
  'transporte_confirmar',
  'etiquetas',
  'cancelando',
  'cancelado',
]

export const esPasoEnvio = (v: unknown): v is PasoEnvio => typeof v === 'string' && (PASOS_ENVIO as string[]).includes(v)

export type FaseEnvio = 'inventario' | 'embalaje' | 'reparto' | 'transporte' | 'etiquetas' | 'seguimiento'

export const FASES_ENVIO: Array<{ id: FaseEnvio; texto: string; pista: string }> = [
  { id: 'inventario', texto: 'Inventario', pista: 'Qué se manda y desde dónde' },
  { id: 'embalaje', texto: 'Embalaje', pista: 'Las cajas, con medidas y peso' },
  { id: 'reparto', texto: 'Reparto', pista: 'A qué centros lo manda Amazon' },
  { id: 'transporte', texto: 'Transporte', pista: 'UPS: coste y aceptación' },
  { id: 'etiquetas', texto: 'Etiquetas', pista: 'Caja y UPS, para imprimir' },
  { id: 'seguimiento', texto: 'Seguimiento', pista: 'Estado y anulación' },
]

/** La operación de Amazon que tiene en marcha cada paso. Los que no están aquí esperan a una persona */
export const OPERACION_DEL_PASO: Partial<Record<PasoEnvio, string>> = {
  plan: 'createInboundPlan',
  embalaje_generar: 'generatePackingOptions',
  embalaje_confirmar: 'confirmPackingOption',
  cajas: 'setPackingInformation',
  reparto_generar: 'generatePlacementOptions',
  reparto_confirmar: 'confirmPlacementOption',
  transporte_generar: 'generateTransportationOptions',
  ventana_generar: 'generateDeliveryWindowOptions',
  ventana_confirmar: 'confirmDeliveryWindowOptions',
  transporte_confirmar: 'confirmTransportationOptions',
  cancelando: 'cancelInboundPlan',
}

export const pasoEnCurso = (p: PasoEnvio): boolean => OPERACION_DEL_PASO[p] !== undefined

export function faseDelPaso(p: PasoEnvio): FaseEnvio {
  switch (p) {
    case 'sin_empezar':
    case 'plan':
      return 'inventario'
    case 'embalaje_generar':
    case 'embalaje_elegir':
    case 'embalaje_confirmar':
    case 'cajas':
    case 'cajas_conflicto':
    case 'cajas_reabiertas':
      return 'embalaje'
    case 'reparto_generar':
    case 'reparto_elegir':
    case 'reparto_confirmar':
      return 'reparto'
    case 'transporte_datos':
    case 'transporte_generar':
    case 'transporte_elegir':
    case 'transporte_cliente':
    case 'transporte_listo':
    case 'ventana_generar':
    case 'ventana_confirmar':
    case 'transporte_confirmar':
      return 'transporte'
    case 'etiquetas':
      return 'etiquetas'
    case 'cancelando':
    case 'cancelado':
      return 'seguimiento'
  }
}

/** Lo que pone la pantalla en cada paso: una frase, sin jerga */
export const TEXTO_DEL_PASO: Record<PasoEnvio, string> = {
  sin_empezar: 'Todavía no se ha mandado nada a Amazon',
  plan: 'Creando el plan en Amazon…',
  embalaje_generar: 'Amazon está calculando cómo agrupar la mercancía…',
  embalaje_elegir: 'Elige cómo agrupar la mercancía',
  embalaje_confirmar: 'Confirmando el agrupado…',
  cajas: 'Mandando las cajas (medidas, peso y contenido)…',
  cajas_conflicto: 'Alguna caja mezcla referencias que Amazon quiere por separado',
  cajas_reabiertas: 'Cajas reabiertas: cuando vuelvan a estar listas, se mandan otra vez y se recalcula el reparto',
  reparto_generar: 'Amazon está repartiendo el envío por centros…',
  reparto_elegir: 'Compara las opciones de reparto y confirma una',
  reparto_confirmar: 'Confirmando el reparto (nacen los envíos FBA)…',
  transporte_datos: 'Di cuándo estará lista la mercancía para la recogida',
  transporte_generar: 'Pidiendo a Amazon la cotización del transporte…',
  transporte_elegir: 'Elige el transporte',
  transporte_cliente: 'Esperando a que el cliente acepte el coste del transporte en su enlace',
  transporte_listo: 'El cliente ha aceptado el coste: falta que la agencia confirme el transporte',
  ventana_generar: 'Pidiendo la ventana de entrega…',
  ventana_confirmar: 'Confirmando la ventana de entrega…',
  transporte_confirmar: 'Confirmando el transporte con Amazon…',
  etiquetas: 'Transporte confirmado: descarga e imprime las etiquetas',
  cancelando: 'Cancelando el plan en Amazon…',
  cancelado: 'Plan cancelado en Amazon',
}

/* ------------------------------------------------------------------ */
/* Quién puede hacer qué en cada paso                                  */
/* ------------------------------------------------------------------ */

/**
 * ¿Están bloqueadas las cajas? Desde que el plan existe en Amazon con nuestras cajas, cambiarlas en el ERP o
 * en el enlace dejaría el envío con cajas falsas (las opciones viejas siguen siendo confirmables). Se
 * desbloquean al reabrirlas (y entonces hay que mandarlas de nuevo y regenerar el reparto) o al cancelar.
 */
export function cajasBloqueadas(modo: ModoEnvio, paso: PasoEnvio): boolean {
  if (modo !== 'api') return false
  return !['sin_empezar', 'cajas_reabiertas', 'cajas_conflicto', 'cancelado'].includes(paso)
}

/** Antes de confirmar el reparto se pueden reabrir las cajas; después ya existen los FBA… con esas cajas */
export function puedeReabrirCajas(paso: PasoEnvio): boolean {
  return ['cajas_conflicto', 'reparto_elegir'].includes(paso)
}

/** ¿Hay que mandar otra vez las cajas al seguir? (vienen de reabrirlas o de un conflicto de grupos) */
export const hayQueMandarCajasOtraVez = (paso: PasoEnvio): boolean => paso === 'cajas_reabiertas' || paso === 'cajas_conflicto'

/** ¿Ya se confirmó el reparto (existen los envíos FBA de verdad)? */
export function repartoConfirmado(paso: PasoEnvio): boolean {
  return faseDelPaso(paso) === 'transporte' || paso === 'etiquetas'
}

export interface Cancelabilidad {
  puede: boolean
  /** true = cancelar ya no es gratis o deshace envíos reales: confirmación con palabra */
  grave: boolean
  motivo: string
}

/**
 * ¿Se puede cancelar el plan ahora?
 *
 *   · Antes de confirmar el reparto: sí, sin rastro.
 *   · Con el reparto confirmado y sin transporte: sí, pero cancela envíos reales.
 *   · Con el transporte de UPS confirmado: solo hasta `anulableHasta` (24 h en paquetería). Después, el
 *     cargo de UPS ya no se devuelve y se hace desde Seller Central si acaso.
 */
export function cancelabilidad(paso: PasoEnvio, anulableHasta: string | null, ahora = new Date()): Cancelabilidad {
  if (paso === 'sin_empezar' || paso === 'cancelado' || paso === 'cancelando') return { puede: false, grave: false, motivo: 'No hay ningún plan activo que cancelar' }
  if (pasoEnCurso(paso)) return { puede: false, grave: false, motivo: 'Espera a que termine la operación en curso' }
  if (paso === 'etiquetas') {
    if (!anulableHasta) return { puede: false, grave: true, motivo: 'Amazon no ha dado plazo de anulación: cancélalo desde Seller Central si hace falta' }
    if (Date.parse(anulableHasta) <= ahora.getTime()) return { puede: false, grave: true, motivo: 'Se ha pasado el plazo de anulación sin coste del transporte' }
    return { puede: true, grave: true, motivo: `Se puede anular sin coste hasta ${anulableHasta}` }
  }
  if (repartoConfirmado(paso)) return { puede: true, grave: true, motivo: 'Cancela los envíos FBA ya creados' }
  return { puede: true, grave: false, motivo: 'Todavía no hay envíos reales: se cancela sin rastro' }
}

/** Cuánto queda hasta una fecha, en palabras («3 h 20 min»). null si ya pasó */
export function cuantoQueda(hasta: string | null, ahora = new Date()): string | null {
  if (!hasta) return null
  const ms = Date.parse(hasta) - ahora.getTime()
  if (!Number.isFinite(ms) || ms <= 0) return null
  const min = Math.floor(ms / 60_000)
  if (min < 60) return `${Math.max(min, 1)} min`
  const h = Math.floor(min / 60)
  if (h < 48) return `${h} h ${min % 60} min`
  return `${Math.floor(h / 24)} días`
}

/* ------------------------------------------------------------------ */
/* Validaciones: inventario                                            */
/* ------------------------------------------------------------------ */

export interface Problema {
  nivel: 'error' | 'aviso'
  texto: string
}

export const LIMITES_PLAN = {
  /** Referencias por plan (Amazon) */
  maxSkus: 1500,
  /** Unidades de una referencia en un plan */
  maxUnidadesPorSku: 10_000,
}

export interface DireccionOrigen {
  nombre: string | null
  empresa: string | null
  linea1: string | null
  linea2?: string | null
  ciudad: string | null
  provincia: string | null
  codigoPostal: string | null
  pais: string | null
  telefono: string | null
  email: string | null
}

export interface LineaParaPlan {
  sku: string
  unidades: number
}

export function validarInventario(p: {
  conConexion: boolean
  marketplaceId: string | null
  direccion: DireccionOrigen | null
  lineas: LineaParaPlan[]
  estado: string
}): Problema[] {
  const out: Problema[] = []
  if (!p.conConexion) out.push({ nivel: 'error', texto: 'Este cliente no tiene la cuenta de Amazon conectada: el envío se hace a mano en Seller Central (modo manual)' })
  if (!p.marketplaceId) out.push({ nivel: 'error', texto: 'La remesa no tiene marketplace' })
  if (p.estado !== 'lista') out.push({ nivel: 'error', texto: 'La remesa tiene que estar «Lista para enviar» (cajas cuadradas, con medidas y peso)' })
  if (!p.direccion) {
    out.push({ nivel: 'error', texto: 'Falta la dirección de origen del cliente' })
  } else {
    const d = p.direccion
    const faltan = (
      [
        ['nombre', d.nombre],
        ['empresa', d.empresa],
        ['dirección', d.linea1],
        ['ciudad', d.ciudad],
        ['provincia', d.provincia],
        ['código postal', d.codigoPostal],
        ['país', d.pais],
        ['teléfono', d.telefono],
        ['email', d.email],
      ] as Array<[string, string | null]>
    )
      .filter(([, v]) => !v || !String(v).trim())
      .map(([k]) => k)
    if (faltan.length) out.push({ nivel: 'error', texto: `A la dirección de origen le falta: ${faltan.join(', ')}` })
    if (d.pais && !/^[A-Z]{2}$/.test(d.pais)) out.push({ nivel: 'error', texto: 'El país de la dirección de origen tiene que ser el código de dos letras (ES, FR…)' })
  }
  const lineas = p.lineas.filter((l) => l.unidades > 0)
  if (lineas.length === 0) out.push({ nivel: 'error', texto: 'La remesa no tiene ninguna referencia con unidades' })
  if (lineas.length > LIMITES_PLAN.maxSkus) out.push({ nivel: 'error', texto: `Amazon admite ${LIMITES_PLAN.maxSkus} referencias por plan y aquí hay ${lineas.length}` })
  const vistas = new Set<string>()
  for (const l of lineas) {
    if (!l.sku.trim()) out.push({ nivel: 'error', texto: 'Hay una línea sin SKU' })
    if (vistas.has(l.sku)) out.push({ nivel: 'error', texto: `El SKU ${l.sku} está repetido` })
    vistas.add(l.sku)
    if (l.unidades > LIMITES_PLAN.maxUnidadesPorSku) out.push({ nivel: 'error', texto: `${l.sku}: ${l.unidades} unidades, más de las ${LIMITES_PLAN.maxUnidadesPorSku} que admite Amazon por referencia` })
    if (!Number.isInteger(l.unidades)) out.push({ nivel: 'error', texto: `${l.sku}: las unidades tienen que ser enteras` })
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Validaciones: cajas con los límites de Amazon                       */
/* ------------------------------------------------------------------ */

/**
 * LÍMITES DE UNA CAJA EN PAQUETERÍA (Amazon UE).
 * Ningún lado de más de 63,5 cm y no más de 23 kg. Desde 15 kg la caja lleva la etiqueta de «pesado»
 * (Team lift / Heavy package). Si una caja se pasa, setPackingInformation acaba en FAILED, y es mejor
 * decirlo antes de mandar nada.
 */
export const LIMITES_CAJA = { maxLadoCm: 63.5, maxPesoKg: 23, pesadoDesdeKg: 15, minPesoKg: 0.1 }

export interface CajaParaValidar {
  numero: number
  largoCm: number | null
  anchoCm: number | null
  altoCm: number | null
  pesoKg: number | null
  contenido: Array<{ sku: string; unidades: number }>
}

const es = (n: number): string => n.toLocaleString('es-ES', { maximumFractionDigits: 2 })

export function validarCaja(c: CajaParaValidar): Problema[] {
  const out: Problema[] = []
  const lados = [c.largoCm, c.anchoCm, c.altoCm]
  if (lados.some((x) => x === null || !(x > 0)) || c.pesoKg === null || !(c.pesoKg > 0)) {
    out.push({ nivel: 'error', texto: `Caja ${c.numero}: le faltan medidas o peso` })
    return out
  }
  const mayor = Math.max(...(lados as number[]))
  if (mayor > LIMITES_CAJA.maxLadoCm) out.push({ nivel: 'error', texto: `Caja ${c.numero}: un lado mide ${es(mayor)} cm y Amazon admite ${es(LIMITES_CAJA.maxLadoCm)} cm como mucho` })
  if (c.pesoKg > LIMITES_CAJA.maxPesoKg) out.push({ nivel: 'error', texto: `Caja ${c.numero}: pesa ${es(c.pesoKg)} kg y Amazon admite ${LIMITES_CAJA.maxPesoKg} kg como mucho` })
  else if (c.pesoKg >= LIMITES_CAJA.pesadoDesdeKg) out.push({ nivel: 'aviso', texto: `Caja ${c.numero}: ${es(c.pesoKg)} kg. Lleva la etiqueta de «pesado» (desde ${LIMITES_CAJA.pesadoDesdeKg} kg)` })
  if (c.pesoKg < LIMITES_CAJA.minPesoKg) out.push({ nivel: 'error', texto: `Caja ${c.numero}: un peso de ${es(c.pesoKg)} kg no es real` })
  const unidades = c.contenido.reduce((s, x) => s + x.unidades, 0)
  if (unidades <= 0) out.push({ nivel: 'error', texto: `Caja ${c.numero}: está vacía` })
  return out
}

export function validarCajas(cajas: CajaParaValidar[]): Problema[] {
  if (cajas.length === 0) return [{ nivel: 'error', texto: 'No hay cajas' }]
  return cajas.flatMap(validarCaja)
}

export const hayErrores = (ps: Problema[]): boolean => ps.some((p) => p.nivel === 'error')

/* ------------------------------------------------------------------ */
/* Cajas por grupo de embalaje                                          */
/* ------------------------------------------------------------------ */

export interface CajaDeGrupo {
  numero: number
  largoCm: number
  anchoCm: number
  altoCm: number
  pesoKg: number
  contenido: Array<{ msku: string; unidades: number }>
}

export type RepartoEnGrupos =
  | { ok: true; grupos: Array<{ packingGroupId: string; cajas: CajaDeGrupo[] }> }
  | { ok: false; problemas: string[] }

/**
 * Pone cada caja en su grupo de embalaje. Amazon puede partir la mercancía en varios grupos (por tamaño,
 * peligrosidad…) y una caja que mezcle referencias de dos grupos se rechaza. Aquí se detecta ANTES de
 * mandar nada, con el mapa SKU → grupo que dio listPackingGroupItems.
 */
export function repartirCajasEnGrupos(cajas: CajaParaValidar[], skuAGrupo: Record<string, string>): RepartoEnGrupos {
  const problemas: string[] = []
  const porGrupo = new Map<string, CajaDeGrupo[]>()
  for (const c of cajas) {
    const contenido = c.contenido.filter((x) => x.unidades > 0)
    const grupos = new Set<string>()
    for (const x of contenido) {
      const g = skuAGrupo[x.sku]
      if (!g) problemas.push(`Caja ${c.numero}: Amazon no ha puesto ${x.sku} en ningún grupo (¿no está en el plan?)`)
      else grupos.add(g)
    }
    if (grupos.size > 1) {
      problemas.push(`Caja ${c.numero}: mezcla referencias que Amazon quiere en grupos distintos (${contenido.map((x) => x.sku).join(', ')})`)
      continue
    }
    const g = [...grupos][0]
    if (!g) continue
    const lista = porGrupo.get(g) ?? []
    lista.push({
      numero: c.numero,
      largoCm: c.largoCm ?? 0,
      anchoCm: c.anchoCm ?? 0,
      altoCm: c.altoCm ?? 0,
      pesoKg: c.pesoKg ?? 0,
      contenido: contenido.map((x) => ({ msku: x.sku, unidades: x.unidades })),
    })
    porGrupo.set(g, lista)
  }
  if (problemas.length) return { ok: false, problemas }
  return { ok: true, grupos: [...porGrupo.entries()].map(([packingGroupId, cs]) => ({ packingGroupId, cajas: cs })) }
}

/* ------------------------------------------------------------------ */
/* Opciones: embalaje, reparto y transporte                            */
/* ------------------------------------------------------------------ */

export interface OpcionEmbalaje {
  packingOptionId: string
  estado: string
  grupos: string[]
  coste: number
  descuento: number
  moneda: string | null
  caduca: string | null
}

/** Se confirma sola si solo hay una opción y no cuesta nada (el caso normal). Si no, decide la agencia */
export function embalajeAutomatico(opciones: OpcionEmbalaje[]): OpcionEmbalaje | null {
  const vivas = opciones.filter((o) => o.estado !== 'EXPIRED')
  if (vivas.length !== 1) return null
  return vivas[0].coste - vivas[0].descuento > 0 ? null : vivas[0]
}

export interface OpcionReparto {
  placementOptionId: string
  estado: string
  envios: string[]
  coste: number
  descuento: number
  moneda: string | null
  caduca: string | null
}

export interface OpcionRepartoResumida extends OpcionReparto {
  /** coste − descuento */
  neto: number
  centros: number
  /** La más barata (y, a igualdad, la de menos centros) */
  recomendada: boolean
  caducada: boolean
}

export function resumirReparto(opciones: OpcionReparto[], ahora = new Date()): OpcionRepartoResumida[] {
  const filas = opciones.map((o) => ({
    ...o,
    neto: Math.round((o.coste - o.descuento) * 100) / 100,
    centros: o.envios.length,
    recomendada: false,
    caducada: o.estado === 'EXPIRED' || (o.caduca ? Date.parse(o.caduca) <= ahora.getTime() : false),
  }))
  filas.sort((a, b) => Number(a.caducada) - Number(b.caducada) || a.neto - b.neto || a.centros - b.centros)
  const mejor = filas.find((f) => !f.caducada)
  if (mejor) mejor.recomendada = true
  return filas
}

export interface OpcionTransporte {
  transportationOptionId: string
  shipmentId: string
  transportista: string | null
  codigoTransportista: string | null
  /** SMALL_PARCEL (paquetería) o FREIGHT_LTL/FTL (palés) */
  modo: string
  /** AMAZON_PARTNERED_CARRIER o USE_YOUR_OWN_CARRIER */
  solucion: string
  coste: number | null
  moneda: string | null
  caduca: string | null
  anulableHasta: string | null
  /** Requisitos previos: CONFIRMED_DELIVERY_WINDOW = hay que confirmar la ventana de entrega antes */
  precondiciones: string[]
  deAmazon: boolean
}

export interface SeleccionTransporte {
  shipmentId: string
  transportationOptionId: string
  transportista: string | null
  solucion: string
  modo: string
  coste: number | null
  moneda: string | null
  caduca: string | null
  anulableHasta: string | null
  necesitaVentana: boolean
}

export interface PropuestaTransporte {
  ok: boolean
  selecciones: SeleccionTransporte[]
  /** Envíos sin opción de transportista asociado de Amazon (UPS) */
  sinAsociado: string[]
  total: number
  moneda: string | null
  /** La cotización que caduca antes */
  caduca: string | null
  anulableHasta: string | null
}

const aSeleccion = (o: OpcionTransporte): SeleccionTransporte => ({
  shipmentId: o.shipmentId,
  transportationOptionId: o.transportationOptionId,
  transportista: o.transportista,
  solucion: o.solucion,
  modo: o.modo,
  coste: o.coste,
  moneda: o.moneda,
  caduca: o.caduca,
  anulableHasta: o.anulableHasta,
  necesitaVentana: o.precondiciones.includes('CONFIRMED_DELIVERY_WINDOW'),
})

const minIso = (xs: Array<string | null>): string | null => {
  const v = xs.filter((x): x is string => !!x).sort((a, b) => Date.parse(a) - Date.parse(b))
  return v[0] ?? null
}

/**
 * La propuesta de transporte por defecto: en cada envío, el transportista ASOCIADO de Amazon en paquetería
 * (UPS) más barato. Si algún envío no lo tiene, se dice y no se propone nada para él (la agencia decide).
 */
export function proponerTransporte(opciones: OpcionTransporte[], envios: string[], ahora = new Date()): PropuestaTransporte {
  const selecciones: SeleccionTransporte[] = []
  const sinAsociado: string[] = []
  for (const sid of envios) {
    const candidatas = opciones
      .filter((o) => o.shipmentId === sid && o.deAmazon && o.modo === 'SMALL_PARCEL' && o.coste !== null)
      .filter((o) => !o.caduca || Date.parse(o.caduca) > ahora.getTime())
      .sort((a, b) => (a.coste ?? 0) - (b.coste ?? 0))
    if (candidatas[0]) selecciones.push(aSeleccion(candidatas[0]))
    else sinAsociado.push(sid)
  }
  return resumirSelecciones(selecciones, sinAsociado)
}

export function resumirSelecciones(selecciones: SeleccionTransporte[], sinAsociado: string[] = []): PropuestaTransporte {
  const total = Math.round(selecciones.reduce((s, x) => s + (x.coste ?? 0), 0) * 100) / 100
  return {
    ok: sinAsociado.length === 0 && selecciones.length > 0,
    selecciones,
    sinAsociado,
    total,
    moneda: selecciones.find((s) => s.moneda)?.moneda ?? null,
    caduca: minIso(selecciones.map((s) => s.caduca)),
    anulableHasta: minIso(selecciones.map((s) => s.anulableHasta)),
  }
}

/** Escoge una opción concreta para un envío, a mano. Devuelve las selecciones nuevas o un error */
export function cambiarSeleccion(actuales: SeleccionTransporte[], opciones: OpcionTransporte[], transportationOptionId: string): SeleccionTransporte[] | string {
  const o = opciones.find((x) => x.transportationOptionId === transportationOptionId)
  if (!o) return 'Esa opción de transporte ya no existe: vuelve a pedir la cotización'
  return [...actuales.filter((s) => s.shipmentId !== o.shipmentId), aSeleccion(o)]
}

/** ¿Sigue valiendo la cotización? Caducada hay que volver a generarla antes de que el cliente la acepte */
export const cotizacionVigente = (caduca: string | null, ahora = new Date()): boolean => !caduca || Date.parse(caduca) > ahora.getTime()

/* ------------------------------------------------------------------ */
/* Ventana de recogida                                                  */
/* ------------------------------------------------------------------ */

/**
 * La fecha en que la mercancía está lista para que la recojan (readyToShipWindow.start). Amazon la pide
 * en ISO con hora; se acepta 'YYYY-MM-DD' (hoy o después, como mucho a 30 días) y se pone a las 09:00 UTC.
 */
export function fechaDeRecogida(dia: string, ahora = new Date()): { ok: true; iso: string } | { ok: false; error: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return { ok: false, error: 'La fecha de recogida tiene que ser un día (AAAA-MM-DD)' }
  const t = Date.parse(`${dia}T09:00:00Z`)
  if (!Number.isFinite(t)) return { ok: false, error: 'Esa fecha no existe' }
  const hoy = Date.parse(`${ahora.toISOString().slice(0, 10)}T00:00:00Z`)
  if (t < hoy) return { ok: false, error: 'La recogida no puede ser en el pasado' }
  if (t > hoy + 30 * 86_400_000) return { ok: false, error: 'La recogida no puede ser a más de 30 días' }
  return { ok: true, iso: new Date(t).toISOString() }
}

/* ------------------------------------------------------------------ */
/* Cajas de Amazon ↔ nuestras cajas                                     */
/* ------------------------------------------------------------------ */

export interface CajaDeAmazon {
  boxId: string
  items: Array<{ msku: string; unidades: number }>
  pesoKg: number | null
}

const firma = (items: Array<{ msku: string; unidades: number }>): string =>
  items
    .filter((x) => x.unidades > 0)
    .map((x) => `${x.msku}×${x.unidades}`)
    .sort()
    .join('|')

/**
 * Empareja cada caja de Amazon (boxId FBA…U000001) con la nuestra por su contenido; a igualdad de contenido,
 * por peso y luego por orden. Así la etiqueta de la caja 3 del ERP se pega en la caja 3.
 */
export function emparejarCajas(nuestras: Array<{ numero: number; pesoKg: number | null; contenido: Array<{ sku: string; unidades: number }> }>, deAmazon: CajaDeAmazon[]): Array<{ numero: number; boxId: string }> {
  const libres = [...deAmazon]
  const out: Array<{ numero: number; boxId: string }> = []
  for (const c of [...nuestras].sort((a, b) => a.numero - b.numero)) {
    const f = firma(c.contenido.map((x) => ({ msku: x.sku, unidades: x.unidades })))
    const candidatas = libres.filter((a) => firma(a.items) === f)
    if (!candidatas.length) continue
    candidatas.sort((a, b) => Math.abs((a.pesoKg ?? 0) - (c.pesoKg ?? 0)) - Math.abs((b.pesoKg ?? 0) - (c.pesoKg ?? 0)))
    const elegida = candidatas[0]
    libres.splice(libres.indexOf(elegida), 1)
    out.push({ numero: c.numero, boxId: elegida.boxId })
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Lo que puede hacer la agencia ahora                                  */
/* ------------------------------------------------------------------ */

export type AccionEnvio =
  | 'iniciar'
  | 'elegir_embalaje'
  | 'reenviar_cajas'
  | 'reabrir_cajas'
  | 'confirmar_reparto'
  | 'generar_transporte'
  | 'elegir_transporte'
  | 'confirmar_transporte'
  | 'reintentar'
  | 'cancelar'

/**
 * Qué acciones admite cada paso. La pantalla enseña solo estas y la ruta lo vuelve a comprobar con lo que
 * hay en la base en ese instante.
 */
export function accionesPermitidas(p: { modo: ModoEnvio; paso: PasoEnvio; conError: boolean; clienteAcepto: boolean; anulableHasta: string | null; ahora?: Date }): AccionEnvio[] {
  if (p.modo !== 'api') return []
  const out: AccionEnvio[] = []
  const { paso } = p
  if (paso === 'sin_empezar' || paso === 'cancelado') out.push('iniciar')
  if (paso === 'embalaje_elegir') out.push('elegir_embalaje')
  if (hayQueMandarCajasOtraVez(paso)) out.push('reenviar_cajas')
  if (puedeReabrirCajas(paso)) out.push('reabrir_cajas')
  if (paso === 'reparto_elegir') out.push('confirmar_reparto')
  if (paso === 'transporte_datos' || paso === 'transporte_elegir' || paso === 'transporte_cliente') out.push('generar_transporte')
  if (paso === 'transporte_elegir' || paso === 'transporte_cliente') out.push('elegir_transporte')
  if (paso === 'transporte_listo' && p.clienteAcepto) out.push('confirmar_transporte')
  if (p.conError && pasoEnCurso(paso)) out.push('reintentar')
  if (cancelabilidad(paso, p.anulableHasta, p.ahora).puede || (p.conError && pasoEnCurso(paso) && paso !== 'cancelando')) out.push('cancelar')
  if (p.conError && paso === 'cancelando') out.push('reintentar')
  return [...new Set(out)]
}
