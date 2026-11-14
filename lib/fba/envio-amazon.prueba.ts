/**
 * PRUEBAS DEL ENVÍO A AMAZON DESDE EL ERP. Sin red: respuestas de Amazon de mentira.
 *   npx tsx lib/fba/envio-amazon.prueba.ts
 */
import {
  accionesPermitidas,
  cajasBloqueadas,
  cancelabilidad,
  cambiarSeleccion,
  cuantoQueda,
  emparejarCajas,
  embalajeAutomatico,
  faseDelPaso,
  fechaDeRecogida,
  hayErrores,
  OPERACION_DEL_PASO,
  PASOS_ENVIO,
  proponerTransporte,
  puedeReabrirCajas,
  repartirCajasEnGrupos,
  resumirReparto,
  validarCaja,
  validarInventario,
  type CajaParaValidar,
} from './envio-amazon'
import {
  consultaEtiquetas,
  cuerpoCajas,
  cuerpoConfirmarTransporte,
  cuerpoCrearPlan,
  cuerpoGenerarTransporte,
  interpretarOperacion,
  leerCajas,
  leerEnvio,
  leerOpcionesEmbalaje,
  leerOpcionesReparto,
  leerOpcionesTransporte,
  leerPlan,
  leerVentanas,
  primeraVentana,
} from './inbound-v2024'

let fallos = 0
function ok(nombre: string, real: unknown, esperado: unknown) {
  const bien = JSON.stringify(real) === JSON.stringify(esperado)
  if (!bien) fallos += 1
  console.log(`  ${bien ? 'OK  ' : 'FALLA'}  ${nombre}${bien ? '' : ` → ${JSON.stringify(real)} (esperado ${JSON.stringify(esperado)})`}`)
}

const AHORA = new Date('2026-11-14T10:00:00Z')

/* ------------------------------------------------------------------ */
console.log('=== OPERACIONES ASÍNCRONAS: un 200 con FAILED es un fallo ===')
ok('SUCCESS → ok', interpretarOperacion({ operationStatus: 'SUCCESS', operation: 'createInboundPlan' }).estado, 'ok')
ok('IN_PROGRESS → en curso', interpretarOperacion({ operationStatus: 'IN_PROGRESS' }).estado, 'en_curso')
const fallo = interpretarOperacion({
  operationStatus: 'FAILED',
  operationProblems: [
    { code: 'FBA_INB_0004', message: 'La caja supera el peso máximo', severity: 'ERROR' },
    { code: 'W1', message: 'Dirección rara', severity: 'WARNING' },
  ],
})
ok('FAILED → fallo', fallo.estado, 'fallo')
ok('el texto lleva solo los graves', fallo.texto, 'La caja supera el peso máximo')
ok('FAILED sin problemas tiene texto', interpretarOperacion({ operationStatus: 'FAILED' }).texto.length > 0, true)
ok('SUCCESS con aviso conserva el aviso', interpretarOperacion({ operationStatus: 'SUCCESS', operationProblems: [{ message: 'ojo', severity: 'WARNING' }] }).problemas.length, 1)
ok('respuesta vacía → en curso (se vuelve a preguntar)', interpretarOperacion(undefined).estado, 'en_curso')

/* ------------------------------------------------------------------ */
console.log('\n=== PASOS Y FASES ===')
ok('cada paso tiene fase', PASOS_ENVIO.every((p) => !!faseDelPaso(p)), true)
ok('confirmar el reparto es de la fase reparto', faseDelPaso('reparto_confirmar'), 'reparto')
ok('esperar al cliente es de transporte', faseDelPaso('transporte_cliente'), 'transporte')
ok('el reparto confirmado lanza confirmPlacementOption', OPERACION_DEL_PASO.reparto_confirmar, 'confirmPlacementOption')
ok('esperar al cliente no lanza nada', OPERACION_DEL_PASO.transporte_cliente, undefined)
ok('cajas bloqueadas desde el plan', cajasBloqueadas('api', 'plan'), true)
ok('cajas libres en manual', cajasBloqueadas('manual', 'reparto_elegir'), false)
ok('cajas libres al reabrir', cajasBloqueadas('api', 'cajas_reabiertas'), false)
ok('cajas libres tras cancelar', cajasBloqueadas('api', 'cancelado'), false)
ok('se reabren antes de confirmar el reparto', puedeReabrirCajas('reparto_elegir'), true)
ok('no se reabren con el reparto confirmado', puedeReabrirCajas('transporte_datos'), false)

/* ------------------------------------------------------------------ */
console.log('\n=== ACCIONES PERMITIDAS ===')
const acc = (paso: Parameters<typeof accionesPermitidas>[0]['paso'], extra: Partial<Parameters<typeof accionesPermitidas>[0]> = {}) =>
  accionesPermitidas({ modo: 'api', paso, conError: false, clienteAcepto: false, anulableHasta: null, ahora: AHORA, ...extra })
ok('manual: ninguna', accionesPermitidas({ modo: 'manual', paso: 'sin_empezar', conError: false, clienteAcepto: false, anulableHasta: null }), [])
ok('sin empezar: iniciar', acc('sin_empezar'), ['iniciar'])
ok('en curso sin error: nada', acc('reparto_generar'), [])
ok('en curso con error: reintentar y cancelar', acc('reparto_generar', { conError: true }), ['reintentar', 'cancelar'])
ok('reparto por elegir', acc('reparto_elegir'), ['reabrir_cajas', 'confirmar_reparto', 'cancelar'])
ok('esperando al cliente: no se confirma el transporte', acc('transporte_cliente').includes('confirmar_transporte'), false)
ok('cliente aceptó: se confirma', acc('transporte_listo', { clienteAcepto: true }).includes('confirmar_transporte'), true)
ok('transporte_listo sin aceptación: no', acc('transporte_listo').includes('confirmar_transporte'), false)
ok('transporte_listo: se puede pedir otra cotización si caduca', acc('transporte_listo', { clienteAcepto: true }).includes('generar_transporte'), true)
ok('etiquetas dentro de plazo: cancelar', acc('etiquetas', { anulableHasta: '2026-11-15T08:00:00Z' }).includes('cancelar'), true)
ok('etiquetas fuera de plazo: no cancelar', acc('etiquetas', { anulableHasta: '2026-11-14T09:00:00Z' }).includes('cancelar'), false)

/* ------------------------------------------------------------------ */
console.log('\n=== CANCELAR ===')
ok('antes del reparto: gratis', cancelabilidad('reparto_elegir', null, AHORA), { puede: true, grave: false, motivo: 'Todavía no hay envíos reales: se cancela sin rastro' })
ok('con el reparto confirmado: grave', cancelabilidad('transporte_datos', null, AHORA).grave, true)
ok('con operación en curso: espera', cancelabilidad('cajas', null, AHORA).puede, false)
ok('cuánto queda: 22 h', cuantoQueda('2026-11-15T08:00:00Z', AHORA), '22 h 0 min')
ok('cuánto queda: pasado', cuantoQueda('2026-11-14T08:00:00Z', AHORA), null)

/* ------------------------------------------------------------------ */
console.log('\n=== INVENTARIO ===')
const dir = { nombre: 'Ana', empresa: 'Tienda SL', linea1: 'C/ Mayor 1', ciudad: 'Madrid', provincia: 'M', codigoPostal: '28001', pais: 'ES', telefono: '600000000', email: 'a@b.es' }
ok('todo bien', validarInventario({ conConexion: true, marketplaceId: 'A1RKKUPIHCS9HS', direccion: dir, lineas: [{ sku: 'A', unidades: 10 }], estado: 'lista' }), [])
ok('sin conexión → error', hayErrores(validarInventario({ conConexion: false, marketplaceId: 'X', direccion: dir, lineas: [{ sku: 'A', unidades: 1 }], estado: 'lista' })), true)
ok('falta teléfono', validarInventario({ conConexion: true, marketplaceId: 'X', direccion: { ...dir, telefono: '' }, lineas: [{ sku: 'A', unidades: 1 }], estado: 'lista' })[0].texto, 'A la dirección de origen le falta: teléfono')
ok('país mal escrito', hayErrores(validarInventario({ conConexion: true, marketplaceId: 'X', direccion: { ...dir, pais: 'España' }, lineas: [{ sku: 'A', unidades: 1 }], estado: 'lista' })), true)
ok('más de 10.000 unidades', hayErrores(validarInventario({ conConexion: true, marketplaceId: 'X', direccion: dir, lineas: [{ sku: 'A', unidades: 10_001 }], estado: 'lista' })), true)
ok('remesa sin terminar de encajar', hayErrores(validarInventario({ conConexion: true, marketplaceId: 'X', direccion: dir, lineas: [{ sku: 'A', unidades: 1 }], estado: 'encajando' })), true)
ok('las líneas a 0 no cuentan', hayErrores(validarInventario({ conConexion: true, marketplaceId: 'X', direccion: dir, lineas: [{ sku: 'A', unidades: 0 }], estado: 'lista' })), true)

/* ------------------------------------------------------------------ */
console.log('\n=== CAJAS CON LOS LÍMITES DE AMAZON ===')
const caja = (n: number, l: number, a: number, h: number, kg: number, contenido = [{ sku: 'A', unidades: 5 }]): CajaParaValidar => ({ numero: n, largoCm: l, anchoCm: a, altoCm: h, pesoKg: kg, contenido })
ok('caja normal', validarCaja(caja(1, 40, 30, 30, 10)), [])
ok('lado de 64 cm', validarCaja(caja(2, 64, 30, 30, 10))[0].nivel, 'error')
ok('63,5 cm justo vale', validarCaja(caja(3, 63.5, 30, 30, 10)), [])
ok('24 kg no', validarCaja(caja(4, 40, 30, 30, 24))[0].texto.includes('23 kg'), true)
ok('16 kg: aviso de pesado', validarCaja(caja(5, 40, 30, 30, 16))[0].nivel, 'aviso')
ok('sin peso', validarCaja({ ...caja(6, 40, 30, 30, 1), pesoKg: null })[0].texto, 'Caja 6: le faltan medidas o peso')
ok('vacía', validarCaja(caja(7, 40, 30, 30, 1, []))[0].texto, 'Caja 7: está vacía')

/* ------------------------------------------------------------------ */
console.log('\n=== GRUPOS DE EMBALAJE ===')
const mapa = { A: 'g1', B: 'g1', C: 'g2' }
const r1 = repartirCajasEnGrupos([caja(1, 40, 30, 30, 5, [{ sku: 'A', unidades: 3 }, { sku: 'B', unidades: 2 }]), caja(2, 40, 30, 30, 5, [{ sku: 'C', unidades: 4 }])], mapa)
ok('dos grupos', r1.ok && r1.grupos.map((g) => [g.packingGroupId, g.cajas.length]), [['g1', 1], ['g2', 1]])
const r2 = repartirCajasEnGrupos([caja(1, 40, 30, 30, 5, [{ sku: 'A', unidades: 3 }, { sku: 'C', unidades: 2 }])], mapa)
ok('una caja que mezcla grupos se para', r2.ok, false)
const r3 = repartirCajasEnGrupos([caja(1, 40, 30, 30, 5, [{ sku: 'Z', unidades: 3 }])], mapa)
ok('un SKU fuera del plan se para', r3.ok ? '' : r3.problemas[0].includes('Z'), true)

/* ------------------------------------------------------------------ */
console.log('\n=== CUERPOS DE LAS PETICIONES ===')
const cp = cuerpoCrearPlan({ nombre: 'Remesa de noviembre con un nombre larguísimo que no cabe', marketplaceId: 'A1RKKUPIHCS9HS', origen: dir, lineas: [{ sku: 'A', unidades: 3 }, { sku: 'B', unidades: 0 }, { sku: 'M', unidades: 2 }], sinEtiqueta: new Set(['M']) })
ok('nombre cortado a 40', cp.name.length, 40)
ok('sin las líneas a 0', cp.items.map((i) => i.msku), ['A', 'M'])
ok('prep y etiqueta del vendedor', [cp.items[0].prepOwner, cp.items[0].labelOwner], ['SELLER', 'SELLER'])
ok('código del fabricante → labelOwner NONE', cp.items[1].labelOwner, 'NONE')
ok('sin línea 2 vacía', 'addressLine2' in cp.sourceAddress, false)
const cc = cuerpoCajas([{ packingGroupId: 'g1', cajas: [{ numero: 1, largoCm: 40, anchoCm: 30, altoCm: 20, pesoKg: 8.5, contenido: [{ msku: 'A', unidades: 3 }] }] }])
ok('cajas en CM y KG, una a una', [cc.packageGroupings[0].boxes[0].dimensions.unitOfMeasurement, cc.packageGroupings[0].boxes[0].weight.unit, cc.packageGroupings[0].boxes[0].quantity], ['CM', 'KG', 1])
ok('contenido declarado', cc.packageGroupings[0].boxes[0].contentInformationSource, 'BOX_CONTENT_PROVIDED')
const gt = cuerpoGenerarTransporte('pl1', ['sh1', 'sh2'], '2026-11-16T09:00:00.000Z', { nombre: 'Ana', telefono: '600', email: null })
ok('transporte: un envío por configuración', gt.shipmentTransportationConfigurations.length, 2)
ok('transporte: contacto sin email vacío', 'email' in (gt.shipmentTransportationConfigurations[0].contactInformation ?? {}), false)
ok('confirmar transporte', cuerpoConfirmarTransporte([{ shipmentId: 'sh1', transportationOptionId: 'to1' }], null), { transportationSelections: [{ shipmentId: 'sh1', transportationOptionId: 'to1' }] })
ok('etiquetas: UNIQUE con las cajas', consultaEtiquetas(['FBA1U001', 'FBA1U002'], 'a4_2'), { PageType: 'PackageLabel_A4_2', LabelType: 'UNIQUE', PackageLabelsToPrint: ['FBA1U001', 'FBA1U002'] })
let sinCajas = ''
try {
  consultaEtiquetas([], 'termica')
} catch (e) {
  sinCajas = (e as Error).message
}
ok('etiquetas sin cajas: error claro', sinCajas, 'No hay cajas de Amazon para imprimir')

/* ------------------------------------------------------------------ */
console.log('\n=== RESPUESTAS DE AMAZON (de mentira) ===')
const emb = leerOpcionesEmbalaje({ packingOptions: [{ packingOptionId: 'po1', status: 'OFFERED', packingGroups: ['g1'], fees: [], discounts: [], expiration: '2026-11-20T00:00:00Z' }] })
ok('embalaje leído', emb[0].grupos, ['g1'])
ok('una opción gratis se confirma sola', embalajeAutomatico(emb)?.packingOptionId, 'po1')
ok('dos opciones: decide la agencia', embalajeAutomatico([...emb, { ...emb[0], packingOptionId: 'po2' }]), null)
ok('una con coste: decide la agencia', embalajeAutomatico([{ ...emb[0], coste: 5 }]), null)

const rep = leerOpcionesReparto({
  placementOptions: [
    { placementOptionId: 'p-cara', status: 'OFFERED', shipmentIds: ['s1'], fees: [{ type: 'FEE', value: { amount: 12.5, code: 'EUR' } }], discounts: [], expiration: '2026-11-20T00:00:00Z' },
    { placementOptionId: 'p-barata', status: 'OFFERED', shipmentIds: ['s2', 's3', 's4'], fees: [], discounts: [], expiration: '2026-11-20T00:00:00Z' },
    { placementOptionId: 'p-caducada', status: 'OFFERED', shipmentIds: ['s5'], fees: [], discounts: [], expiration: '2026-11-13T00:00:00Z' },
  ],
})
ok('tarifa sumada', rep[0].coste, 12.5)
const resumen = resumirReparto(rep, AHORA)
ok('recomendada la más barata', resumen.find((o) => o.recomendada)?.placementOptionId, 'p-barata')
ok('la caducada al final', resumen[resumen.length - 1].placementOptionId, 'p-caducada')
ok('centros contados', resumen.find((o) => o.placementOptionId === 'p-barata')?.centros, 3)

const env = leerEnvio({ shipmentId: 's1', shipmentConfirmationId: 'FBA15ABC', status: 'WORKING', destination: { warehouseId: 'MAD4', address: { city: 'San Fernando' } }, trackingDetails: { spdTrackingDetail: { spdTrackingItems: [{ boxId: 'FBA15ABCU001', trackingId: '1Z', trackingNumberValidationStatus: 'INVALID' }] } } }, 's1')
ok('envío: FBA y centro', [env.confirmacion, env.destino, env.ciudadDestino], ['FBA15ABC', 'MAD4', 'San Fernando'])
ok('envío: seguimiento inválido visto', env.seguimientos[0].valido, 'INVALID')
ok('plan leído', leerPlan({ inboundPlanId: 'wf1', status: 'ACTIVE', shipments: [{ shipmentId: 's1', status: 'WORKING' }] }).envios.length, 1)

const tr = leerOpcionesTransporte({
  transportationOptions: [
    { transportationOptionId: 'ups-1', shipmentId: 's1', carrier: { name: 'UPS', alphaCode: 'UPSN' }, shippingMode: 'SMALL_PARCEL', shippingSolution: 'AMAZON_PARTNERED_CARRIER', quote: { cost: { amount: 18.4, code: 'EUR' }, expiration: '2026-11-15T10:00:00Z', voidableUntil: '2026-11-15T12:00:00Z' }, preconditions: [] },
    { transportationOptionId: 'ups-2', shipmentId: 's1', carrier: { name: 'UPS' }, shippingMode: 'SMALL_PARCEL', shippingSolution: 'AMAZON_PARTNERED_CARRIER', quote: { cost: { amount: 25, code: 'EUR' }, expiration: '2026-11-15T10:00:00Z' }, preconditions: [] },
    { transportationOptionId: 'propio', shipmentId: 's1', carrier: { name: 'Otro' }, shippingMode: 'SMALL_PARCEL', shippingSolution: 'USE_YOUR_OWN_CARRIER', quote: {}, preconditions: ['CONFIRMED_DELIVERY_WINDOW'] },
    { transportationOptionId: 'palet', shipmentId: 's2', carrier: { name: 'X' }, shippingMode: 'FREIGHT_LTL', shippingSolution: 'AMAZON_PARTNERED_CARRIER', quote: { cost: { amount: 90, code: 'EUR' } }, preconditions: [] },
  ],
})
ok('asociado detectado', tr.map((o) => o.deAmazon), [true, true, false, true])
ok('sin cotización → coste null', tr[2].coste, null)
const prop = proponerTransporte(tr, ['s1', 's2'], AHORA)
ok('UPS más barato en s1', prop.selecciones.map((s) => s.transportationOptionId), ['ups-1'])
ok('s2 sin paquetería asociada', prop.sinAsociado, ['s2'])
ok('propuesta incompleta no vale', prop.ok, false)
ok('total y caducidad', [prop.total, prop.caduca, prop.anulableHasta], [18.4, '2026-11-15T10:00:00Z', '2026-11-15T12:00:00Z'])
const sel2 = cambiarSeleccion(prop.selecciones, tr, 'propio')
ok('cambiar a transporte propio pide ventana', typeof sel2 !== 'string' && sel2[0].necesitaVentana, true)
ok('opción inexistente', typeof cambiarSeleccion([], tr, 'nada'), 'string')
const caducada = proponerTransporte(tr, ['s1'], new Date('2026-11-16T00:00:00Z'))
ok('cotización caducada no se propone', caducada.selecciones.length, 0)

const vs = leerVentanas({ deliveryWindowOptions: [
  { deliveryWindowOptionId: 'v2', startDate: '2026-11-20T00:00:00Z', endDate: '2026-11-27T00:00:00Z', validUntil: '2026-11-15T00:00:00Z' },
  { deliveryWindowOptionId: 'v1', startDate: '2026-11-18T00:00:00Z', endDate: '2026-11-25T00:00:00Z', validUntil: '2026-11-13T00:00:00Z' },
] })
ok('ventana caducada descartada', primeraVentana(vs, AHORA)?.deliveryWindowOptionId, 'v2')

/* ------------------------------------------------------------------ */
console.log('\n=== RECOGIDA ===')
ok('mañana vale', fechaDeRecogida('2026-11-15', AHORA), { ok: true, iso: '2026-11-15T09:00:00.000Z' })
ok('ayer no', fechaDeRecogida('2026-11-13', AHORA).ok, false)
ok('a 40 días no', fechaDeRecogida('2026-12-24', AHORA).ok, false)
ok('formato raro', fechaDeRecogida('15/11/2026', AHORA).ok, false)

/* ------------------------------------------------------------------ */
console.log('\n=== CAJAS DE AMAZON ↔ CAJAS DEL ERP ===')
const deAmazon = leerCajas({ boxes: [
  { boxId: 'FBAU2', items: [{ msku: 'A', quantity: 5 }], weight: { value: 9, unit: 'KG' } },
  { boxId: 'FBAU1', items: [{ msku: 'A', quantity: 5 }], weight: { value: 7, unit: 'KG' } },
  { boxId: 'FBAU3', items: [{ msku: 'B', quantity: 2 }, { msku: 'C', quantity: 1 }], weight: { value: 3, unit: 'KG' } },
  { items: [] },
] })
ok('sin boxId se descarta', deAmazon.length, 3)
const pares = emparejarCajas(
  [
    { numero: 1, pesoKg: 7, contenido: [{ sku: 'A', unidades: 5 }] },
    { numero: 2, pesoKg: 9, contenido: [{ sku: 'A', unidades: 5 }] },
    { numero: 3, pesoKg: 3, contenido: [{ sku: 'C', unidades: 1 }, { sku: 'B', unidades: 2 }] },
  ],
  deAmazon
)
ok('emparejadas por contenido y peso', pares, [{ numero: 1, boxId: 'FBAU1' }, { numero: 2, boxId: 'FBAU2' }, { numero: 3, boxId: 'FBAU3' }])

console.log(fallos === 0 ? '\n  TODO CORRECTO' : `\n  ${fallos} FALLOS`)
if (fallos) process.exit(1)
