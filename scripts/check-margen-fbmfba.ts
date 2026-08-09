/**
 * COMPROBACIÓN DEL MÓDULO A4 — ¿EL MARGEN DICE LA VERDAD?
 * =======================================================
 *
 * Se ejecuta sin base de datos, sin red y sin levantar nada:
 *
 *     npx tsx scripts/check-margen-fbmfba.ts
 *
 * Sale con código 1 si algo no cuadra.
 *
 *
 * =====================================================================
 *  POR QUÉ ESTE FICHERO EXISTE
 * =====================================================================
 *
 * Porque A4 propone meter la mercancía de un cliente en un almacén de Amazon,
 * de donde sacarla cuesta dinero, y TODOS LOS ERRORES POSIBLES DE ESTE CÁLCULO
 * SESGAN EN LA MISMA DIRECCIÓN: a favor de migrar. Lo que falta siempre son
 * costes, así que un margen a medias sale MEJOR que el de verdad, es
 * perfectamente creíble y nadie lo revisa.
 *
 * Un margen mal calculado no da ningún error. Sale un número, va a una
 * presentación y el cliente manda un palé. Por eso esto se comprueba con
 * NÚMEROS EXACTOS calculados a mano en el comentario de cada caso, y no
 * comparando la función consigo misma.
 *
 * Los cuatro sesgos que se vigilan aquí, uno por bloque:
 *
 *   1. EL IMPUESTO. Dividir por (1 + IVA) donde el impuesto va FUERA (Estados
 *      Unidos) hunde el margen un 20 %; no dividir donde va dentro (Unión
 *      Europea) lo infla otro tanto. Y sin configurar, NO HAY NÚMERO.
 *   2. EL ENVÍO DEL CANAL PROPIO. El precio de referencia de Amazon es precio de
 *      listing SIN ENVÍO. Sin restar el porte, el margen de FBM sale inflado
 *      justo en el cliente que más FBM tiene, y la comparación contra FBA sale
 *      amañada antes de empezar.
 *   3. EL ALMACENAMIENTO Y EL FLETE. Las tarifas de Amazon no los incluyen. Con
 *      esos dos a cero, todo compensa migrar.
 *   4. LA TARIFA PEDIDA A OTRO PRECIO. No se reescala: la comisión es un
 *      porcentaje CON MÍNIMOS y la de logística va por tramos de tamaño.
 */

import { calcularMargen, compararEscenarios, type EntradaMargen, type TarifasEscenario } from '../lib/plataforma/fbmfba/margen'
import { precioSinImpuesto, type ParametrosFiscales } from '../lib/plataforma/fbmfba/fiscal'
import { analizar, precioDeEvaluacion, type EntradaAnalisis } from '../lib/plataforma/fbmfba/analisis'
import {
  CONFIG_A4_DEFECTO,
  SENTIDO_FOEP_LABELS,
  type ConfigFbmFba,
  type Rotacion,
} from '../lib/plataforma/fbmfba/tipos'
import { EXIGENCIAS_ESTRICTAS, type CosteEvaluable } from '../lib/plataforma/costes/completitud'

let fallos = 0

function comprobar(titulo: string, ok: boolean, detalle = ''): void {
  console.log(`${ok ? '  OK  ' : ' FALLA'}  ${titulo}${detalle ? ` — ${detalle}` : ''}`)
  if (!ok) fallos++
}

/** Igualdad con tolerancia de céntimo: la función redondea a dos decimales */
function casi(titulo: string, real: number | null, esperado: number): void {
  const ok = real !== null && Math.abs(real - esperado) < 0.005
  comprobar(titulo, ok, `${real ?? 'null'} vs ${esperado} esperado`)
}

function igualTexto(titulo: string, real: string, esperado: string): void {
  comprobar(titulo, real === esperado, `«${real}» vs «${esperado}» esperado`)
}

function seccion(titulo: string): void {
  console.log(`\n${titulo}\n${'-'.repeat(titulo.length)}`)
}

const AHORA = new Date('2026-08-09T09:00:00.000Z')

/* ------------------------------------------------------------------ */
/* Los ladrillos                                                       */
/* ------------------------------------------------------------------ */

/** España: el precio de listing lleva el IVA dentro */
const ES: ParametrosFiscales = {
  marketplaceId: 'A1RKKUPIHCS9HS',
  ivaPorcentaje: 21,
  precioIncluyeImpuesto: true,
  validoDesde: '2026-01-01',
  actualizadoPor: null,
  ambito: 'general',
  notas: null,
}

/** Estados Unidos: el sales tax se añade en el pago, NO está en el precio */
const US: ParametrosFiscales = {
  ...ES,
  marketplaceId: 'ATVPDKIKX0DER',
  ivaPorcentaje: 0,
  precioIncluyeImpuesto: false,
}

/** Nadie ha configurado este marketplace. Es el estado de arranque */
const SIN_FISCAL: ParametrosFiscales = {
  marketplaceId: 'A1PA6795UKMFR9',
  ivaPorcentaje: null,
  precioIncluyeImpuesto: null,
  validoDesde: null,
  actualizadoPor: null,
  ambito: 'sin_configurar',
  notas: null,
}

/**
 * Coste completo: compra 8, porte 3,55, almacén 0,40 y flete 0,60.
 *
 * Los céntimos están elegidos para que NINGÚN porcentaje de este fichero caiga
 * justo en la mitad de un redondeo (un 24,85 % que puede irse a 24,8 o a 24,9
 * según el ruido del coma flotante). Una comprobación que se apoya en eso pasa
 * hoy y falla mañana sin que nadie haya tocado la fórmula, y entonces deja de
 * creerse.
 */
const COSTE: CosteEvaluable = {
  coste: 8,
  moneda: 'EUR',
  coste_envio: 3.55,
  coste_almacen_fba: 0.4,
  coste_flete_fba: 0.6,
  iva_incluido: false,
  iva_porcentaje: null,
}

function tarifas(parcial: Partial<TarifasEscenario> = {}): TarifasEscenario {
  return {
    precioReferencia: 24.2,
    moneda: 'EUR',
    referral: 3.63,
    fba: null,
    otras: 0,
    origen: 'estimado_api',
    leidoAt: '2026-08-09T02:00:00.000Z',
    ...parcial,
  }
}

function entrada(parcial: Partial<EntradaMargen> = {}): EntradaMargen {
  return {
    escenario: 'propio',
    precio: 24.2,
    moneda: 'EUR',
    fiscal: ES,
    coste: COSTE,
    exigencias: EXIGENCIAS_ESTRICTAS,
    tarifas: tarifas(),
    toleranciaTarifaPct: 1,
    ...parcial,
  }
}

/* ================================================================== */
/* 1. EL IMPUESTO                                                      */
/* ================================================================== */

seccion('1. El impuesto del marketplace')

// 24,20 / 1,21 = 20,00 exactos. El número está elegido para que se vea a ojo.
casi('España: 24,20 con IVA del 21 % son 20,00 de base', precioSinImpuesto(24.2, ES), 20)

// El mismo precio en Estados Unidos NO se divide: el impuesto va fuera.
casi('Estados Unidos: 24,20 son 24,20 de base, no 20,00', precioSinImpuesto(24.2, US), 24.2)

comprobar(
  'Sin configurar no devuelve el precio «mientras tanto», devuelve null',
  precioSinImpuesto(24.2, SIN_FISCAL) === null
)

{
  const r = calcularMargen(entrada({ fiscal: SIN_FISCAL }))
  comprobar('Sin impuesto configurado no hay margen', r.estado === 'no_evaluable' && r.importe === null)
  comprobar(
    'y el motivo dice que el error mueve el margen un 20 %',
    r.motivo.includes('20 %'),
    r.motivo.slice(0, 60)
  )
}

/* ================================================================== */
/* 2. LA FÓRMULA, ESCENARIO POR ESCENARIO                              */
/* ================================================================== */

seccion('2. La fórmula')

// CANAL PROPIO, a 24,20 € en España:
//   base            20,00   (24,20 / 1,21)
//   − compra         8,00
//   − porte          3,55   <- lo que la especificación se dejaba
//   − comisión       3,63
//   = margen         4,82   -> 24,1 % sobre la base
{
  const r = calcularMargen(entrada())
  casi('Canal propio: margen unitario', r.importe, 4.82)
  casi('Canal propio: porcentaje sobre la BASE imponible', r.porcentaje, 24.1)
  casi('Canal propio: el desglose enseña el porte', r.desglose?.costeEnvioPropio ?? null, 3.55)
  casi('Canal propio: el desglose enseña el impuesto retirado', r.desglose?.impuesto ?? null, 4.2)
  comprobar('Canal propio: la tarifa de logística es 0, no se cuela', r.desglose?.fba === 0)
}

// FBA, al mismo precio:
//   base            20,00
//   − compra         8,00
//   − almacén        0,40   <- Amazon NO lo incluye en su estimación
//   − flete          0,60   <- Amazon NO lo incluye en su estimación
//   − comisión       3,63
//   − logística      5,17
//   = margen         2,20   -> 11,0 % sobre la base
{
  const r = calcularMargen(entrada({ escenario: 'fba', tarifas: tarifas({ fba: 5.17 }) }))
  casi('FBA: margen unitario', r.importe, 2.2)
  casi('FBA: porcentaje', r.porcentaje, 11)
  casi('FBA: el desglose enseña el almacenamiento', r.desglose?.costeAlmacenFba ?? null, 0.4)
  casi('FBA: el desglose enseña el flete de entrada', r.desglose?.costeFleteFba ?? null, 0.6)
  comprobar('FBA: el porte del canal propio NO se resta', r.desglose?.costeEnvioPropio === 0)
}

// EL SESGO QUE SE VIGILA: si el almacenamiento y el flete no se restaran, FBA
// daría 3,20 en vez de 2,20 y la diferencia contra el canal propio se recortaría
// a la mitad. Con ellos, la diferencia es −13,1 puntos y FBA no compensa.
{
  const propio = calcularMargen(entrada())
  const fba = calcularMargen(entrada({ escenario: 'fba', tarifas: tarifas({ fba: 5.17 }) }))
  const c = compararEscenarios(propio, fba)
  casi('La comparación sale en puntos porcentuales, no en «mejora un X %»', c.puntos, -13.1)
  casi('y también en dinero por unidad', c.importe, -2.62)
}

// ESTADOS UNIDOS: el mismo caso sin dividir por el impuesto.
//   base 24,20 − 8,00 − 3,55 − 3,63 = 9,02
{
  const r = calcularMargen(entrada({ fiscal: US }))
  casi('Estados Unidos: no se divide, y el margen es otro', r.importe, 9.02)
  comprobar('Estados Unidos: el impuesto retirado es 0', r.desglose?.impuesto === 0)
}

/* ================================================================== */
/* 3. SIN DATO NO HAY NÚMERO                                           */
/* ================================================================== */

seccion('3. Lo que falta no se rellena con cero')

{
  const r = calcularMargen(entrada({ coste: null }))
  comprobar('Sin coste no hay margen', r.estado === 'no_evaluable' && r.importe === null)
  comprobar('y dice dónde se rellena', r.motivo.includes('Amazon API · Costes'), r.motivo.slice(0, 50))
}

{
  // Coste de compra sí, pero sin el porte del canal propio.
  const r = calcularMargen(entrada({ coste: { ...COSTE, coste_envio: null } }))
  comprobar('Coste a medias tampoco da número', r.estado === 'no_evaluable' && r.importe === null)
}

{
  const r = calcularMargen(
    entrada({ escenario: 'fba', coste: { ...COSTE, coste_almacen_fba: null }, tarifas: tarifas({ fba: 5.2 }) })
  )
  comprobar('FBA sin almacenamiento tampoco: es el sesgo más caro', r.estado === 'no_evaluable')
}

{
  const r = calcularMargen(entrada({ precio: null }))
  comprobar('Sin precio no hay margen', r.estado === 'no_evaluable')
}

{
  const r = calcularMargen(entrada({ escenario: 'fba', tarifas: tarifas({ fba: null }) }))
  comprobar(
    'Escenario FBA sin tarifa de logística: NO se calcula con 0',
    r.estado === 'no_evaluable' && r.importe === null
  )
}

{
  const r = calcularMargen(entrada({ tarifas: tarifas({ referral: null }) }))
  comprobar('Sin comisión de referencia tampoco', r.estado === 'no_evaluable')
}

{
  // El coste en dólares y el precio en euros. Amazon no da tipos de cambio con
  // ninguno de los roles concedidos, así que convertir sería inventarse la cifra.
  const r = calcularMargen(entrada({ coste: { ...COSTE, moneda: 'USD' } }))
  comprobar('Divisas distintas: no se convierte, no hay número', r.estado === 'no_evaluable')
  comprobar('y el motivo lo explica', r.motivo.includes('tipos de cambio'))
}

/* ================================================================== */
/* 4. LA TARIFA PEDIDA A OTRO PRECIO NO SE REESCALA                    */
/* ================================================================== */

seccion('4. La tarifa se pidió a un precio concreto')

{
  // La estimación se pidió a 30 € y aquí se evalúa a 24,20 €.
  const r = calcularMargen(entrada({ tarifas: tarifas({ precioReferencia: 30 }) }))
  comprobar('Tarifa de otro precio: no se estira', r.estado === 'no_evaluable')
  comprobar('y el motivo dice por qué', r.motivo.includes('NO SE REESCALA'))
}

{
  // Dentro de la tolerancia del 1 %: 24,30 sobre 24,20 es un 0,41 %.
  const r = calcularMargen(entrada({ tarifas: tarifas({ precioReferencia: 24.3 }) }))
  comprobar('Dentro de la tolerancia sí sirve', r.estado === 'calculado')
}

{
  const r = calcularMargen(entrada({ tarifas: tarifas({ precioReferencia: null }) }))
  comprobar('Una tarifa huérfana de su precio no vale', r.estado === 'no_evaluable')
}

/* ================================================================== */
/* 5. EL PRECIO DE EVALUACIÓN: EL TECHO CON DOS SENTIDOS               */
/* ================================================================== */

seccion('5. El precio de referencia de Amazon es un TECHO con dos sentidos')

{
  // NO tenemos la oferta destacada y el techo está por debajo: hay que bajar.
  const r = precioDeEvaluacion({ precioActual: 30, foep: 24.2, foepEstado: 'disponible', buybox: 'de_otro' })
  casi('Sin la oferta destacada se evalúa al techo (ofensivo)', r.precio, 24.2)
  igualTexto('y el sentido se dice', r.sentido, 'ofensivo')
}

{
  // SÍ la tenemos y el techo está POR ENCIMA del precio de hoy. Evaluar ahí
  // sería contar un ingreso que nadie ha decidido cobrar — y es el fallo más
  // caro del proyecto, porque solo afecta a las referencias que YA van bien.
  const r = precioDeEvaluacion({ precioActual: 24.2, foep: 31, foepEstado: 'disponible', buybox: 'nuestra' })
  casi('Con la oferta destacada se evalúa al precio de HOY, no al techo', r.precio, 24.2)
  igualTexto('y el sentido es defensivo', r.sentido, 'defensivo')
}

{
  const r = precioDeEvaluacion({ precioActual: 24.2, foep: null, foepEstado: 'no_consultado', buybox: 'de_otro' })
  casi('Sin techo se evalúa al precio de hoy', r.precio, 24.2)
  igualTexto('y se dice que no hay dato', r.sentido, 'sin_dato')
}

{
  // Un techo POR DEBAJO teniendo nosotros la oferta destacada es raro, pero
  // min() sigue siendo lo prudente: se queda el más bajo de los dos.
  const r = precioDeEvaluacion({ precioActual: 30, foep: 24.2, foepEstado: 'disponible', buybox: 'nuestra' })
  casi('min(actual, techo) es prudente en los cuatro casos', r.precio, 24.2)
}

/* ================================================================== */
/* 6. LOS VEREDICTOS                                                   */
/* ================================================================== */

seccion('6. Los veredictos')

const ROTACION_MEDIDA: Rotacion = {
  estado: 'medida',
  unidades: 60,
  ventanaDias: 30,
  diasConDato: 30,
  bsr: 4200,
  bsrCategoria: 'Hogar',
  bsrLeidoAt: '2026-08-08T02:00:00.000Z',
}

/** Umbrales puestos por una persona. Sin ellos el motor informa y no recomienda */
const CONFIG: ConfigFbmFba = {
  ...CONFIG_A4_DEFECTO,
  clientId: 'cliente',
  colchonMargenPct: 10,
  mejoraMinimaPuntos: 3,
  rotacionMinimaUnidades: 10,
  bsrMaximo: null,
}

/**
 * El caso en el que FBA SÍ compensa.
 *
 * Precio 24,20 € en España, coste de compra 5 €, porte propio 6,05 € (caro: es
 * un producto voluminoso), y en FBA 0,40 de almacén + 0,60 de flete + 3,05 de
 * logística.
 *
 *   propio: 20,00 − 5,00 − 6,05 − 3,63               = 5,32  -> 26,6 %
 *   fba:    20,00 − 5,00 − 0,40 − 0,60 − 3,63 − 3,05 = 7,32  -> 36,6 %
 *   diferencia: +10,0 puntos
 */
const COSTE_BUENO: CosteEvaluable = {
  ...COSTE,
  coste: 5,
  coste_envio: 6.05,
}

function analisis(parcial: Partial<EntradaAnalisis> = {}): EntradaAnalisis {
  return {
    sku: 'SKU-1',
    asin: 'B000000001',
    titulo: 'Producto de prueba',
    marca: 'Marca',
    canal: 'FBM',
    enSeguimiento: true,
    precioActual: 24.2,
    moneda: 'EUR',
    foep: 24.2,
    foepEstado: 'disponible',
    foepResultado: 'SUCCESS',
    foepLeidoAt: '2026-08-09T02:00:00.000Z',
    buybox: 'de_otro',
    amazon: 'no',
    procedenciaDims: 'catalogo',
    rotacion: ROTACION_MEDIDA,
    coste: COSTE_BUENO,
    exigencias: EXIGENCIAS_ESTRICTAS,
    fiscal: ES,
    tarifasPropio: tarifas(),
    tarifasFba: tarifas({ fba: 3.05 }),
    config: CONFIG,
    ahora: AHORA,
    ...parcial,
  }
}

{
  const r = analizar(analisis())
  igualTexto('Caso limpio: candidato', r.veredicto, 'candidato')
  casi('  margen enviándolo el cliente', r.margenPropio.importe, 5.32)
  casi('  margen enviándolo Amazon', r.margenFba.importe, 7.32)
  casi('  diferencia en puntos', r.comparacion.puntos, 10)
  comprobar('  el motivo lleva los números dentro', r.motivo.includes('10 puntos'), r.motivo.slice(0, 80))
  comprobar('  y dice que desde aquí no se crea ningún envío', r.motivo.includes('no se crea ningún envío'))
  igualTexto('  la acción es proponérselo, no ejecutarlo', r.accion, 'Proponérselo al cliente')
}

{
  // LA PREGUNTA DEL ENUNCIADO: ¿qué sale SIN COSTE?
  const r = analizar(analisis({ coste: null }))
  igualTexto('SIN COSTE: no_evaluable (no «no compensa»)', r.veredicto, 'no_evaluable')
  comprobar('  y los dos márgenes se quedan sin número', r.margenPropio.importe === null && r.margenFba.importe === null)
  comprobar('  el motivo dice que no se rellena con cero', r.motivo.includes('cero'), r.motivo.slice(0, 60))
  igualTexto('  la acción es completar el dato', r.accion, 'Completar el dato que falta')
}

{
  // LA PREGUNTA DEL ENUNCIADO: ¿qué sale SIN FOEP?
  // Sin techo Y sin la oferta destacada: el margen está calculado a un precio al
  // que hoy NO se vende, así que la salvedad FRENA y el candidato baja a revisar.
  const r = analizar(analisis({ foep: null, foepEstado: 'no_disponible', buybox: 'de_otro' }))
  igualTexto('SIN FOEP y sin la oferta destacada: revisar', r.veredicto, 'revisar')
  igualTexto('  el sentido del techo es «sin dato»', r.sentidoFoep, 'sin_dato')
  comprobar(
    '  y la salvedad que frena es la del techo',
    r.salvedades.some((s) => s.clave === 'sin_foep' && s.degrada)
  )
  comprobar('  el margen SÍ se calcula, al precio de hoy', r.margenFba.importe !== null)
}

{
  // Sin techo pero CON la oferta destacada: el precio de hoy es el precio al que
  // se vende de verdad, así que el margen es real y esto NO frena.
  const r = analizar(analisis({ foep: null, foepEstado: 'no_disponible', buybox: 'nuestra' }))
  igualTexto('SIN FOEP pero con la oferta destacada: sigue siendo candidato', r.veredicto, 'candidato')
  comprobar(
    '  la salvedad se anota pero no frena',
    r.salvedades.some((s) => s.clave === 'sin_foep' && !s.degrada)
  )
}

{
  // LA PREGUNTA DEL ENUNCIADO: ¿qué sale con AMAZON INDETERMINADO?
  const r = analizar(analisis({ amazon: 'indeterminado' }))
  igualTexto('AMAZON INDETERMINADO: revisar, NO descartado', r.veredicto, 'revisar')
  comprobar(
    '  la salvedad dice que no se puede saber',
    r.salvedades.some((s) => s.clave === 'amazon_indeterminado' && s.degrada)
  )
  comprobar(
    '  y la lista de lo que falta pide los identificadores de Amazon Retail',
    r.faltaPorDecidir.some((f) => f.includes('Amazon Retail'))
  )
}

{
  // Solo el «sí» confirmado descarta.
  const r = analizar(analisis({ amazon: 'si' }))
  igualTexto('AMAZON CONFIRMADO: descartado', r.veredicto, 'descartado_amazon')
  comprobar('  y dice que se confirmó con la lista rellenada a mano', r.motivo.includes('a mano'))
}

{
  const r = analizar(analisis({ config: { ...CONFIG, colchonMargenPct: null } }))
  igualTexto('Sin colchón puesto: informa y NO recomienda', r.veredicto, 'informa_sin_umbral')
  comprobar('  pero enseña los dos márgenes', r.margenPropio.importe !== null && r.margenFba.importe !== null)
  comprobar('  y dice que el número lo pone una persona', r.motivo.includes('una persona'))
}

{
  // El colchón es lo que impide recomendar una migración con margen marginal.
  // Con el coste caro del bloque 2, FBA deja un 11 %: por debajo de un colchón
  // del 15 % no se recomienda, y da igual que mejorase.
  const r = analizar(
    analisis({ coste: COSTE, tarifasFba: tarifas({ fba: 5.17 }), config: { ...CONFIG, colchonMargenPct: 15 } })
  )
  igualTexto('Margen por debajo del colchón: no compensa', r.veredicto, 'no_compensa')
  comprobar('  y explica el riesgo del inventario parado', r.motivo.includes('inventario parado'))
}

{
  const r = analizar(analisis({ config: { ...CONFIG, mejoraMinimaPuntos: 20 } }))
  igualTexto('Mejora por debajo del mínimo: no compensa', r.veredicto, 'no_compensa')
}

{
  const r = analizar(
    analisis({ rotacion: { ...ROTACION_MEDIDA, unidades: 2 }, config: { ...CONFIG, rotacionMinimaUnidades: 10 } })
  )
  igualTexto('Rota por debajo del mínimo: sin_rotacion', r.veredicto, 'sin_rotacion')
}

{
  // LA CORRECCIÓN DE LA REGLA 2: sin datos NO es «no rota».
  const r = analizar(
    analisis({
      rotacion: { estado: 'no_evaluable', unidades: null, ventanaDias: 30, diasConDato: 0, bsr: null, bsrCategoria: null, bsrLeidoAt: null },
    })
  )
  comprobar('Sin datos de venta NO se descarta por rotación', r.veredicto !== 'sin_rotacion')
  igualTexto('  se degrada a revisar', r.veredicto, 'revisar')
  comprobar(
    '  y la salvedad dice que «sin datos» no es «no rota»',
    r.salvedades.some((s) => s.clave === 'rotacion_no_evaluable' && s.texto.includes('NO es'))
  )
}

{
  // El ranking ORDENA, NO MIDE: puede descartar, pero es revisable.
  const r = analizar(
    analisis({
      rotacion: { estado: 'senal_bsr', unidades: null, ventanaDias: 30, diasConDato: 0, bsr: 900000, bsrCategoria: 'Hogar', bsrLeidoAt: null },
      config: { ...CONFIG, bsrMaximo: 100000 },
    })
  )
  igualTexto('Ranking peor que el máximo: sin_rotacion', r.veredicto, 'sin_rotacion')
  comprobar('  pero el motivo avisa de que el ranking ordena y no mide', r.motivo.includes('ORDENA, NO MIDE'))
  igualTexto('  y la acción es confirmar, no descartar', r.accion, 'Confirmar con ventas antes de descartar')
}

{
  // REGLA 4: medidas de mala procedencia.
  const r = analizar(analisis({ procedenciaDims: 'ausente' }))
  igualTexto('Sin medidas y con el freno activado: revisar', r.veredicto, 'revisar')
  comprobar(
    '  y la salvedad dice de dónde salen las medidas',
    r.salvedades.some((s) => s.clave === 'dimensiones' && s.degrada)
  )
}

{
  const r = analizar(analisis({ procedenciaDims: 'ausente', config: { ...CONFIG, exigirDimensionesFiables: false } }))
  igualTexto('Con el freno de medidas apagado: candidato, pero con la salvedad', r.veredicto, 'candidato')
  comprobar('  la salvedad sigue estando', r.salvedades.some((s) => s.clave === 'dimensiones'))
}

{
  const r = analizar(analisis({ canal: 'FBA' }))
  igualTexto('Ya está en FBA: no hay migración que evaluar', r.veredicto, 'ya_en_fba')
}

{
  const r = analizar(analisis({ canal: 'SFP' }))
  igualTexto('Prime del vendedor: sigue siendo candidato', r.veredicto, 'candidato')
  comprobar(
    '  pero avisa de que lo que se gana es coste, no visibilidad',
    r.salvedades.some((s) => s.clave === 'sfp' && !s.degrada)
  )
}

{
  const r = analizar(analisis({ canal: 'desconocido', precioActual: null }))
  igualTexto('Nada leído: sin_datos', r.veredicto, 'sin_datos')
}

{
  const r = analizar(analisis({ canal: 'desconocido' }))
  igualTexto('Canal sin leer pero con precio: canal_desconocido', r.veredicto, 'canal_desconocido')
}

{
  // El techo viejo se anota y no frena: la rotación semanal del FOEP es el
  // diseño que hace que la ventana nocturna quepa, no una avería.
  const r = analizar(analisis({ foepLeidoAt: '2026-08-03T02:00:00.000Z' }))
  igualTexto('Techo de hace seis días: sigue siendo candidato', r.veredicto, 'candidato')
  comprobar('  pero se anota la edad', r.salvedades.some((s) => s.clave === 'foep_viejo'))
  comprobar('  y viaja en horas', (r.foepHoras ?? 0) > 100)
}

/* ------------------------------------------------------------------ */
/* 5. EL SENTIDO DEL TECHO — los CUATRO estados, no dos                 */
/* ------------------------------------------------------------------ */
//
// `buybox_estado` es NOT NULL DEFAULT 'desconocido' y el FOEP sale del mismo
// diagnóstico: una fila con techo leído y ganador indeterminado es NORMAL. Si
// «desconocido» se cuela en el lado ofensivo, la pantalla afirma «la oferta
// destacada no es nuestra» y recomienda BAJAR EL PRECIO contra una competencia
// que nunca se comprobó. Es el fallo más caro de esta capa y no da ningún error:
// sale un número, va a una presentación y alguien recorta el precio.

{
  const r = analizar(analisis({ buybox: 'nuestra' }))
  igualTexto('Techo con la oferta destacada NUESTRA: defensivo', r.sentidoFoep, 'defensivo')
  comprobar(
    '  y se anota que es un techo hacia arriba, sin frenar',
    r.salvedades.some((s) => s.clave === 'foep_defensivo' && !s.degrada)
  )
}

{
  const r = analizar(analisis({ buybox: 'de_otro' }))
  igualTexto('Techo con la oferta destacada DE OTRO: ofensivo', r.sentidoFoep, 'ofensivo')
}

{
  // Si no la tiene nadie, «no la tenemos» es cierto: ofensivo es correcto aquí.
  const r = analizar(analisis({ buybox: 'nadie' }))
  igualTexto('Techo sin oferta destacada de NADIE: ofensivo', r.sentidoFoep, 'ofensivo')
}

{
  const r = analizar(analisis({ buybox: 'desconocido' }))
  igualTexto('Techo con ganador DESCONOCIDO: sin_juicio, no ofensivo', r.sentidoFoep, 'sin_juicio')
  comprobar(
    '  y NO afirma que la oferta destacada no sea nuestra',
    !SENTIDO_FOEP_LABELS[r.sentidoFoep].includes('no tenemos')
  )
  comprobar(
    '  la salvedad frena: no puede salir como candidato a secas',
    r.salvedades.some((s) => s.clave === 'foep_sin_juicio' && s.degrada)
  )
  igualTexto('  el veredicto se degrada a revisar', r.veredicto, 'revisar')
  comprobar(
    '  pero el margen sigue usando el menor de los dos precios (prudente)',
    r.precioEvaluado === 24.2
  )
}

/* ================================================================== */

console.log(
  fallos === 0
    ? '\nTodo cuadra.\n'
    : `\n${fallos} comprobación${fallos === 1 ? '' : 'es'} no cuadra${fallos === 1 ? '' : 'n'}.\n`
)
process.exit(fallos === 0 ? 0 : 1)
