/**
 * PLATAFORMA · MÓDULO A4 — LA FUNCIÓN DE MARGEN
 * =============================================
 * FUNCIÓN PURA. Todo entra por parámetro: no hay `Date.now()`, ni Supabase, ni
 * `fetch`, ni una sola cifra de negocio escondida. Se comprueba caso a caso con
 * scripts/check-margen-fbmfba.ts sin levantar nada.
 *
 *
 * =====================================================================
 *  ██  LA FÓRMULA DE LA ESPECIFICACIÓN, Y LAS CUATRO CORRECCIONES  ██
 * =====================================================================
 *
 * La especificación (§3.5) dice:
 *
 *     margen_al_FOEP = FOEP / (1 + IVA) − coste_producto − referral_fee − fba_fee
 *
 * Está bien la forma y le faltan cuatro cosas. Las cuatro sesgan EN LA MISMA
 * DIRECCIÓN —a favor de migrar a FBA— y ninguna da ningún error:
 *
 *   1. EL IVA NO ES UNA CONSTANTE, ES UN PARÁMETRO POR MARKETPLACE, Y ADEMÁS
 *      HAY QUE SABER SI EL PRECIO LO LLEVA DENTRO. En la Unión Europea el
 *      precio de listing va con impuesto; en Estados Unidos el sales tax se
 *      añade en el pago y NO está en el precio. Dividir por (1 + IVA) allí es
 *      quitarle al margen un dinero que nunca estuvo. Ver fiscal.ts.
 *
 *   2. EL FOEP NO LLEVA ENVÍO. `FeaturedOfferExpectedPrice` solo tiene
 *      `listingPrice`: no existe ningún `shippingPrice` en ese objeto, mientras
 *      que el precio de la competencia en la misma respuesta SÍ lo tiene. En un
 *      SKU que envía el cliente —FBM o Seller Fulfilled Prime— el porte lo paga
 *      él y no aparece en ninguna respuesta de la API. SIN RESTARLO, EL MARGEN
 *      DEL CANAL PROPIO SALE INFLADO justo en el cliente de 13.700 referencias,
 *      que es el que más FBM tiene, y la comparación contra FBA sale amañada.
 *
 *   3. LAS TARIFAS DE AMAZON NO INCLUYEN NI ALMACENAMIENTO NI FLETE DE ENTRADA.
 *      Product Fees devuelve la comisión de referencia y la tarifa de gestión
 *      logística, y ahí se acaba: guardar el producto mientras espera y llevarlo
 *      hasta el centro cuesta dinero antes de vender una unidad. Con esos dos a
 *      cero se le descuenta al canal propio un coste real y al de Amazon no.
 *
 *   4. LA TARIFA SE PIDE A UN PRECIO CONCRETO. La comisión de referencia es un
 *      porcentaje con mínimos y la de logística depende del tramo de tamaño:
 *      aplicar la tarifa que Amazon calculó para 30 € a una evaluación a 18 € es
 *      inventarse la cifra. Aquí, si la tarifa se pidió a otro precio, NO SE
 *      EXTRAPOLA: se dice que hace falta pedirla al precio bueno.
 *
 *
 * =====================================================================
 *  LA REGLA QUE MANDA SOBRE TODAS: SIN DATO NO HAY NÚMERO
 * =====================================================================
 *
 * En cuanto falta una pieza, `estado` es 'no_evaluable', `importe` es null y
 * `motivo` dice exactamente qué falta y dónde se rellena. NUNCA se completa un
 * hueco con cero, ni siquiera «provisionalmente»:
 *
 *   · un margen a medias sale MEJOR que el de verdad, siempre, porque lo que
 *     falta son costes;
 *   · es perfectamente creíble, así que nadie lo revisa;
 *   · y acaba en una presentación diciéndole a un cliente que gana dinero donde
 *     lo pierde.
 *
 * Un hueco se ve. Un número inflado, no.
 */

import { evaluarCoste, type CosteEvaluable, type Exigencias } from '../costes/completitud'
import { precioSinImpuesto, type ParametrosFiscales } from './fiscal'

/* ------------------------------------------------------------------ */
/* Lo que entra                                                        */
/* ------------------------------------------------------------------ */

/**
 * Las tarifas que Amazon estimó, TAL Y COMO VINIERON.
 *
 * `precioReferencia` no es informativo: sin él las tarifas no significan nada
 * —son un porcentaje de algo— y es lo que permite saber si sirven para el precio
 * que se está evaluando.
 *
 * `fba` a null en un escenario de FBA NO ES CERO: es que Amazon no ha dado esa
 * tarifa, y sin ella el escenario no se puede calcular.
 */
export interface TarifasEscenario {
  /** A qué precio se le pidió la estimación a Amazon */
  precioReferencia: number | null
  moneda: string | null
  /** Comisión de referencia */
  referral: number | null
  /** Tarifa de gestión logística de Amazon. Solo tiene sentido en el escenario FBA */
  fba: number | null
  /** Lo demás que Amazon haya devuelto en el desglose */
  otras: number | null
  /** estimado_api = getMyFeesEstimates · fee_preview = el informe · liquidacion = lo cobrado */
  origen: 'estimado_api' | 'fee_preview' | 'liquidacion' | null
  /** Cuándo lo leímos NOSOTROS. Amazon no sella la respuesta */
  leidoAt: string | null
}

export const TARIFAS_SIN_DATO: TarifasEscenario = {
  precioReferencia: null,
  moneda: null,
  referral: null,
  fba: null,
  otras: null,
  origen: null,
  leidoAt: null,
}

/** Cuál de los dos mundos se está calculando */
export type Escenario = 'propio' | 'fba'

export const ESCENARIO_LABELS: Record<Escenario, string> = {
  propio: 'Lo envía el cliente',
  fba: 'Lo envía Amazon',
}

export interface EntradaMargen {
  escenario: Escenario
  /** Precio de LISTING, sin envío, tal y como lo ve el comprador */
  precio: number | null
  /** La divisa del precio. Es la que manda: el coste tiene que venir en la misma */
  moneda: string | null
  fiscal: ParametrosFiscales
  /** El coste vigente de A5. null = no hay ninguno en esta fecha */
  coste: CosteEvaluable | null
  /** Qué patas del coste exige este cliente (política de A5) */
  exigencias: Exigencias
  tarifas: TarifasEscenario
  /** TÉCNICO: cuánto puede alejarse el precio de la tarifa, en % */
  toleranciaTarifaPct: number
}

/* ------------------------------------------------------------------ */
/* Lo que sale                                                         */
/* ------------------------------------------------------------------ */

/**
 * De dónde sale cada euro.
 *
 * Va entero aunque se repita con la entrada porque es lo que se exporta y lo que
 * se le enseña al cliente: un margen sin desglose se obedece, uno con desglose se
 * discute, y discutirlo es lo que hace que se detecte cuando está mal.
 */
export interface DesgloseMargen {
  /** El precio tal cual, con impuesto si el marketplace lo lleva dentro */
  precioBruto: number
  /** El mismo, ya sin impuesto. Es la base sobre la que se calcula todo */
  precioBase: number
  /** Lo que se ha quitado de impuesto. 0 cuando el impuesto va fuera */
  impuesto: number
  /** Precio de compra sin IVA */
  costeCompra: number
  /** Porte que paga el cliente. Solo en el escenario propio */
  costeEnvioPropio: number
  /** Almacenamiento en Amazon. Solo en el escenario FBA */
  costeAlmacenFba: number
  /** Flete de entrada al centro logístico. Solo en el escenario FBA */
  costeFleteFba: number
  referral: number
  /** Tarifa de gestión logística. 0 en el escenario propio */
  fba: number
  otras: number
}

export interface ResultadoMargen {
  estado: 'calculado' | 'no_evaluable'
  /** Euros (o la divisa que sea) por unidad vendida. null si no se puede */
  importe: number | null
  /**
   * El margen sobre la BASE IMPONIBLE, en tanto por ciento.
   *
   * Sobre la base y no sobre el precio con impuesto a propósito: el impuesto no
   * es ingreso, es dinero que se recauda para Hacienda, y meterlo en el
   * denominador hace que el mismo producto tenga «peor margen» en Italia (22 %)
   * que en Alemania (19 %) sin que nada haya cambiado.
   */
  porcentaje: number | null
  moneda: string | null
  desglose: DesgloseMargen | null
  /** Qué falta, en español y listo para pantalla. Vacío cuando está calculado */
  faltan: string[]
  /** La frase que se enseña donde iría el número */
  motivo: string
}

/* ------------------------------------------------------------------ */
/* La función                                                          */
/* ------------------------------------------------------------------ */

/**
 * EL MARGEN UNITARIO DE UN SKU EN UN ESCENARIO Y A UN PRECIO.
 *
 *     margen = precio_sin_impuesto
 *              − coste_de_compra_sin_iva
 *              − (escenario propio ? envío_real : almacenamiento + flete)
 *              − comisión_de_referencia
 *              − (escenario FBA ? tarifa_de_logística : 0)
 *              − otras_tarifas
 *
 * El orden de las comprobaciones de abajo es deliberado: primero lo que impide
 * calcular NADA (precio, impuesto, divisa) y después lo que falta pieza a pieza,
 * para que el motivo diga la causa raíz y no la primera que se cruzó.
 */
export function calcularMargen(entrada: EntradaMargen): ResultadoMargen {
  const moneda = entrada.moneda ?? entrada.coste?.moneda ?? null

  /* ---------- 1. El precio ---------- */
  if (entrada.precio === null || !Number.isFinite(entrada.precio)) {
    return sinNumero(
      moneda,
      ['El precio de venta con el que evaluar'],
      'No hay precio con el que calcular: ni el catálogo ni la lectura de ofertas han dado uno para ' +
        'esta referencia. Sin precio no hay margen, y un cero aquí sería un margen negativo inventado.'
    )
  }

  /* ---------- 2. El impuesto del marketplace ---------- */
  // Antes que el coste a propósito: es lo que más caro sale de todo y lo que más
  // fácil pasa desapercibido, porque un margen con el IVA mal puesto es
  // perfectamente creíble.
  const base = precioSinImpuesto(entrada.precio, entrada.fiscal)
  if (base === null) {
    return sinNumero(
      moneda,
      [
        entrada.fiscal.precioIncluyeImpuesto === null
          ? 'Si el precio de este marketplace lleva el impuesto dentro'
          : 'El tipo de IVA de este marketplace',
      ],
      'No se puede llevar el precio a base imponible: falta configurar el impuesto de este ' +
        'marketplace. Ningún endpoint de Amazon lo da con los roles que tenemos. Y no se supone: en ' +
        'la Unión Europea el precio lleva el IVA dentro y en Estados Unidos va fuera, así que ' +
        'equivocarse mueve el margen un 20 % en el sentido que toque.'
    )
  }
  const impuesto = entrada.precio - base

  /* ---------- 3. El coste ---------- */
  const veredictoCoste = evaluarCoste(entrada.coste, entrada.escenario, entrada.exigencias)
  if (veredictoCoste.estado !== 'completo' || veredictoCoste.total === null) {
    return sinNumero(
      moneda,
      veredictoCoste.faltan.map((f) => f.etiqueta),
      `${veredictoCoste.motivo} Los costes se rellenan en Amazon API · Costes.`
    )
  }

  /* ---------- 4. La divisa ---------- */
  // Amazon NO da tipos de cambio con ningún rol, y cualquier conversión que
  // hiciéramos aquí sería un número inventado que además cambia cada día. Un
  // cliente que compra en dólares y vende en euros necesita que alguien decida
  // qué tipo se usa; mientras tanto, no hay margen.
  if (
    entrada.moneda &&
    veredictoCoste.moneda &&
    entrada.moneda.toUpperCase() !== veredictoCoste.moneda.toUpperCase()
  ) {
    return sinNumero(
      moneda,
      ['Un tipo de cambio decidido y con fecha'],
      `El precio está en ${entrada.moneda} y el coste en ${veredictoCoste.moneda}. Amazon no ` +
        'devuelve tipos de cambio con ninguno de los roles que tenemos, así que convertir aquí sería ' +
        'inventarse la cifra. Guarda el coste en la divisa del marketplace.'
    )
  }

  /* ---------- 5. Las tarifas ---------- */
  const tarifas = comprobarTarifas(entrada)
  if (tarifas.error) {
    return sinNumero(moneda, tarifas.faltan, tarifas.error)
  }

  /* ---------- 6. La resta ---------- */
  // EL COSTE TOTAL SALE DE A5, NO SE VUELVE A SUMAR AQUÍ. `veredictoCoste.total`
  // ya trae el precio de compra sin IVA más las patas del canal, y esa suma es la
  // que decide si el coste está completo. Recomponerla a mano sería tener la
  // misma regla escrita dos veces, y el día que A5 añada una pata —un arancel,
  // una tasa de importación— el margen de esta pantalla se quedaría atrás sin
  // que nada fallara. El desglose de abajo es EXACTAMENTE la descomposición de
  // ese total, para poder enseñarlo, no para volver a calcularlo.
  const costeTotal = veredictoCoste.total
  const costeCompra = veredictoCoste.base ?? 0
  const costeEnvioPropio = entrada.escenario === 'propio' ? (entrada.coste?.coste_envio ?? 0) : 0
  const costeAlmacenFba = entrada.escenario === 'fba' ? (entrada.coste?.coste_almacen_fba ?? 0) : 0
  const costeFleteFba = entrada.escenario === 'fba' ? (entrada.coste?.coste_flete_fba ?? 0) : 0

  const referral = tarifas.referral
  const fba = entrada.escenario === 'fba' ? tarifas.fba : 0
  const otras = tarifas.otras

  // El porcentaje se calcula sobre el margen SIN REDONDEAR y el importe se
  // redondea aparte. Encadenarlos —sacar el porcentaje del importe ya redondeado
  // a céntimos— arrastra el error del redondeo al segundo número y hace que dos
  // márgenes idénticos den porcentajes distintos según dónde caiga el céntimo.
  const bruto = base - costeTotal - referral - fba - otras

  return {
    estado: 'calculado',
    importe: redondear(bruto),
    // Sobre la base imponible. Ver el comentario del campo.
    porcentaje: base > 0 ? redondearPct((bruto / base) * 100) : null,
    moneda,
    desglose: {
      precioBruto: entrada.precio,
      precioBase: redondear(base),
      impuesto: redondear(impuesto),
      costeCompra: redondear(costeCompra),
      costeEnvioPropio: redondear(costeEnvioPropio),
      costeAlmacenFba: redondear(costeAlmacenFba),
      costeFleteFba: redondear(costeFleteFba),
      referral: redondear(referral),
      fba: redondear(fba),
      otras: redondear(otras),
    },
    faltan: [],
    motivo:
      entrada.escenario === 'propio'
        ? 'Precio sin impuesto menos el coste de compra, el porte que paga el cliente y las tarifas de Amazon.'
        : 'Precio sin impuesto menos el coste de compra, el almacenamiento y el flete de entrada, y las tarifas de Amazon.',
  }
}

/* ------------------------------------------------------------------ */
/* Las tarifas: la comprobación que no se puede saltar                 */
/* ------------------------------------------------------------------ */

interface TarifasComprobadas {
  referral: number
  fba: number
  otras: number
  error: string | null
  faltan: string[]
}

/**
 * ¿SIRVEN ESTAS TARIFAS PARA ESTE PRECIO?
 *
 * Se niega en tres casos, y los tres son un «no lo sabemos», nunca un cero:
 *
 *   · No hay ninguna estimación. El trabajo de tarifas todavía no ha corrido
 *     sobre este SKU.
 *   · La hay, pero se pidió a otro precio. La comisión de referencia es un
 *     porcentaje CON MÍNIMOS y la de logística va por tramos de tamaño: nada de
 *     eso escala de forma lineal, así que reescalarla a mano produciría una
 *     cifra plausible y falsa. Hay que volver a pedirla, y eso es una llamada de
 *     dos segundos, no un problema.
 *   · Es un escenario de FBA y no consta la tarifa de logística. Ese es
 *     precisamente EL número de la migración: sin él no hay comparación, hay una
 *     ilusión.
 */
function comprobarTarifas(entrada: EntradaMargen): TarifasComprobadas {
  const vacio = { referral: 0, fba: 0, otras: 0 }
  const t = entrada.tarifas

  if (t.referral === null) {
    return {
      ...vacio,
      error:
        'Amazon todavía no ha estimado las tarifas de esta referencia. Se piden con el trabajo ' +
        '«Tarifas estimadas» desde Amazon API · Ingesta, y hay que pedirlas al precio que se quiere ' +
        'evaluar: la comisión es un porcentaje de algo.',
      faltan: ['La estimación de tarifas de Amazon'],
    }
  }

  if (entrada.escenario === 'fba' && t.fba === null) {
    return {
      ...vacio,
      error:
        'Hay comisión de referencia pero no tarifa de gestión logística, que es justo el número que ' +
        'decide esta migración. Pide la estimación marcando el escenario de Amazon: para un SKU que ' +
        'hoy envía el cliente, Amazon estima por defecto el canal que ya tiene.',
      faltan: ['La tarifa de logística de Amazon para este SKU'],
    }
  }

  // El precio al que se pidió. Sin él no se puede saber si sirve, y en ese caso
  // NO se da por bueno: una tarifa huérfana de su precio es un número sin unidad.
  if (t.precioReferencia === null || !Number.isFinite(t.precioReferencia)) {
    return {
      ...vacio,
      error:
        'La estimación de tarifas guardada no dice a qué precio se pidió, así que no se puede saber ' +
        'si vale para este. Vuelve a pedirla.',
      faltan: ['El precio al que se pidió la estimación de tarifas'],
    }
  }

  const precio = entrada.precio as number
  const tolerancia = Math.max(0, entrada.toleranciaTarifaPct)
  const desvio = precio === 0 ? 0 : Math.abs(t.precioReferencia - precio) / Math.max(precio, 0.01)

  if (desvio * 100 > tolerancia) {
    return {
      ...vacio,
      error:
        `La tarifa que hay se pidió a ${importe(t.precioReferencia)} y aquí se evalúa a ` +
        `${importe(precio)}. NO SE REESCALA: la comisión de referencia es un porcentaje con mínimos y ` +
        'la de logística va por tramos de tamaño, así que estirar la cifra daría un número creíble y ' +
        'equivocado. Hay que volver a pedírsela a Amazon a este precio.',
      faltan: ['Una estimación de tarifas pedida al precio que se evalúa'],
    }
  }

  return {
    referral: t.referral,
    fba: t.fba ?? 0,
    otras: t.otras ?? 0,
    error: null,
    faltan: [],
  }
}

/* ------------------------------------------------------------------ */
/* Comparar los dos escenarios                                         */
/* ------------------------------------------------------------------ */

export interface Comparacion {
  /** Puntos porcentuales que gana FBA sobre el canal propio. null si falta uno */
  puntos: number | null
  /** La misma diferencia en dinero por unidad */
  importe: number | null
  moneda: string | null
}

/**
 * La diferencia entre los dos mundos.
 *
 * En PUNTOS PORCENTUALES y no en porcentaje de mejora: «pasa del 4 % al 9 %» son
 * cinco puntos y se entiende; «mejora un 125 %» es la misma cosa dicha de una
 * forma que hace que parezca enorme. Y la mejora relativa se dispara hasta el
 * infinito cuando el margen de partida es casi cero, que es justo el caso en el
 * que hay que ser más prudente.
 */
export function compararEscenarios(
  propio: ResultadoMargen,
  fba: ResultadoMargen
): Comparacion {
  if (
    propio.estado !== 'calculado' ||
    fba.estado !== 'calculado' ||
    propio.porcentaje === null ||
    fba.porcentaje === null ||
    propio.importe === null ||
    fba.importe === null
  ) {
    return { puntos: null, importe: null, moneda: fba.moneda ?? propio.moneda }
  }
  return {
    puntos: redondearPct(fba.porcentaje - propio.porcentaje),
    importe: redondear(fba.importe - propio.importe),
    moneda: fba.moneda ?? propio.moneda,
  }
}

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

function sinNumero(moneda: string | null, faltan: string[], motivo: string): ResultadoMargen {
  return {
    estado: 'no_evaluable',
    importe: null,
    porcentaje: null,
    moneda,
    desglose: null,
    faltan,
    motivo,
  }
}

/** Dos decimales. La divisa se pinta donde se enseña, no aquí */
function redondear(n: number): number {
  return Math.round(n * 100) / 100
}

/** Un decimal para los porcentajes: más precisión es ruido en una tabla */
function redondearPct(n: number): number {
  return Math.round(n * 10) / 10
}

function importe(n: number): string {
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
