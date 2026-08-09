/**
 * PLATAFORMA · MÓDULO A2 — EL MOTOR DE DIAGNÓSTICO
 * ================================================
 * FUNCIÓN PURA. Todo entra por parámetro: no hay `Date.now()`, ni Supabase, ni
 * `fetch`, ni una sola constante de negocio escondida. Es a propósito: esta es
 * la función que decide si se le baja el precio a un producto de la tienda de un
 * cliente, y tiene que poder comprobarse caso a caso sin levantar nada.
 *
 *
 * =====================================================================
 *  ██  LO PRIMERO Y LO MÁS IMPORTANTE: QUÉ ES EL FOEP  ██
 * =====================================================================
 *
 * Definición literal de Amazon:
 *
 *     «A computed listing price AT OR BELOW WHICH a seller can expect to become
 *      the featured offer (before applicable promotions).»
 *
 * O sea: EL FOEP ES EL PRECIO DE LISTING MÁXIMO al que Amazon prevé que NUESTRA
 * oferta esté destacada. ES UN TECHO, NO UN OBJETIVO. Y significa dos cosas
 * distintas según quién tenga ahora mismo la oferta destacada:
 *
 *   · NO LA TENEMOS  -> el FOEP es OFENSIVO: es el techo AL QUE HAY QUE BAJAR
 *                       para conquistarla.
 *   · SÍ LA TENEMOS  -> el FOEP es DEFENSIVO: es el techo HASTA EL QUE PODEMOS
 *                       SUBIR sin perderla. Y NORMALMENTE ESTÁ POR ENCIMA DEL
 *                       PRECIO ACTUAL.
 *
 * ---------------------------------------------------------------------
 *  ██  POR ESO LA REGLA INGENUA «precio_actual > FOEP -> bajar» ES UN FALLO  ██
 *  ██  QUE RECORTA PRECIO EXACTAMENTE EN LOS SKU QUE YA VAN BIEN.           ██
 * ---------------------------------------------------------------------
 *
 * Un SKU con la Buy Box a 24,90 € y FOEP 27,40 € NO es un SKU caro: es un SKU al
 * que le sobran 2,50 € de recorrido hacia arriba. Aplicarle la regla ingenua le
 * baja el precio a 27,40... no, peor: la regla ingenua ni siquiera dispara ahí.
 * Donde dispara es en el caso contrario, cuando el FOEP defensivo sale por
 * debajo del precio por un recálculo posterior, y entonces baja el precio de un
 * producto que tiene la Buy Box. En un catálogo grande eso son miles de euros al
 * año regalados, y NO DA NINGÚN ERROR: la pantalla se ve verde.
 *
 * NO EXISTE NINGÚN `resultStatus` QUE DISTINGA LOS DOS CASOS. La discriminación
 * es OBLIGATORIA y se hace comparando el identificador de vendedor de la oferta
 * destacada actual (`currentFeaturedOffer.offerIdentifier.sellerId`) contra el
 * nuestro. Eso ocurre en lectura.ts y llega aquí ya resuelto en
 * `entrada.buybox`. Si algún día alguien hace que ese campo se rellene por otra
 * vía, ES ESTA FUNCIÓN LA QUE SE ROMPE.
 *
 * Por eso el primer corte de todo el motor es «¿la tenemos?» y solo después se
 * comparan precios. Cualquier reordenación de los `if` de abajo que compare
 * precios antes de resolver eso vuelve a introducir el fallo.
 *
 *
 * =====================================================================
 *  LA TABLA DE LA ESPECIFICACIÓN, Y POR QUÉ ESTÁ REESCRITA
 * =====================================================================
 *
 * La tabla del §3.3 tiene siete filas y una de ellas mezcla los dos sentidos del
 * FOEP:
 *
 *     «FOEP >= precio actual -> Ya deberíamos tenerla»
 *
 * Eso es correcto SOLO si no la tenemos. Si la tenemos, «FOEP >= precio actual»
 * es el caso NORMAL y sano —el techo defensivo por encima del precio— y
 * etiquetarlo de «ya deberíamos tenerla» convierte el SKU sano en una incidencia
 * que alguien va a intentar arreglar.
 *
 * La tabla reescrita, con el corte correcto, es la lista de veredictos de
 * tipos.ts y el orden de los `if` de `diagnosticar()`. Está documentada entera
 * en el informe del módulo.
 *
 *
 * =====================================================================
 *  DOS COSAS MÁS QUE ESTA FUNCIÓN NO PUEDE HACER, Y NO DISIMULA
 * =====================================================================
 *
 * 1. NO COMPARA PRECIOS CON ENVÍO CONTRA PRECIOS SIN ENVÍO. El FOEP es precio de
 *    listing, sin envío. La competencia, en la misma respuesta, trae las dos
 *    cosas. Aquí solo se comparan importes de listing, y los «puestos en casa»
 *    (landed) viajan aparte para enseñarlos, nunca para decidir. Con un catálogo
 *    mayoritariamente FBM esa confusión lo estropea todo.
 *
 * 2. NO SE INVENTA NI UN UMBRAL. Margen mínimo, delta respecto al FOEP,
 *    redondeo, suelo, techo y MAP entran por `config` y su valor por defecto es
 *    `null` = NO ACTUAR. Cuando falta uno, el veredicto lo DICE (ver
 *    `bajable_sin_criterio`) en vez de rellenar el hueco con un número
 *    razonable. Un número razonable inventado es indistinguible de uno decidido,
 *    y este motor propone precios de tiendas ajenas.
 */

import {
  esPrime,
  textoResultadoFoep,
  type CanalOferta,
  type DatosDelVeredicto,
  type EstadoAmazonRetail,
  type EstadoBuyBox,
  type EstadoFoepA2,
  type EstadoStock,
  type Veredicto,
} from './tipos'

/* ------------------------------------------------------------------ */
/* Lo que entra                                                        */
/* ------------------------------------------------------------------ */

/**
 * El margen que quedaría vendiendo al FOEP.
 *
 * A2 NO SABE CALCULARLO Y NO LO FINGE: hacen falta el coste de compra (módulo
 * A5) y las tarifas de Amazon (módulo A4), más el IVA del marketplace, que es
 * una tabla de configuración porque ningún endpoint lo da con nuestros roles.
 *
 * Mientras tanto llega como `no_evaluable` con su motivo, y el motor lo dice en
 * el veredicto. El día que A4 y A5 estén, se rellena aquí y los tres veredictos
 * que dependen de él (`recuperable_bajando`, `problema_logistico`,
 * `no_recuperable`) empiezan a salir sin tocar ni esta función ni a quien la
 * consume.
 */
export type MargenAlFoep =
  | { estado: 'conocido'; importe: number; porcentaje: number }
  | { estado: 'no_evaluable'; motivo: string }

export interface ConfigDiagnostico {
  /**
   * Cuánto tienen que diferenciarse dos importes para considerarlos distintos.
   *
   * TÉCNICO, no de negocio: es la unidad mínima de la divisa. Sin él, un FOEP de
   * 24,900000001 contra un precio de 24,90 dispararía «hay que bajar» por un
   * error de coma flotante.
   */
  toleranciaImporte: number

  /** % de margen mínimo aceptable vendiendo al FOEP. null = NO configurado */
  margenMinimoPct: number | null

  /**
   * Cuánto por debajo del FOEP se coloca el precio propuesto.
   *
   * null = exactamente el FOEP. Que es lo que hay que hacer mientras nadie lo
   * decida: el FOEP es un techo, así que ponerse justo en él deja la oferta
   * pegada al borde del umbral y cualquier recálculo de Amazon la tumba. Es una
   * decisión de negocio y por eso no lleva número por defecto.
   */
  deltaFoep: number | null
  deltaFoepTipo: 'absoluto' | 'porcentaje'

  /** Por debajo de aquí no se propone bajar. null = NO configurado */
  precioSuelo: number | null
  /** Por encima de aquí no se propone subir. null = NO configurado */
  precioTecho: number | null

  /** Este SKU está excluido de cualquier propuesta de precio (MAP, acuerdo de marca) */
  excluidoDePropuesta: boolean
  /** Por qué está excluido, si lo está */
  motivoExclusion: string | null
}

/** Los valores por defecto: TODO LO DE NEGOCIO A `null` = no actuar */
export const CONFIG_POR_DEFECTO: ConfigDiagnostico = {
  toleranciaImporte: 0.01,
  margenMinimoPct: null,
  deltaFoep: null,
  deltaFoepTipo: 'absoluto',
  precioSuelo: null,
  precioTecho: null,
  excluidoDePropuesta: false,
  motivoExclusion: null,
}

/** Lo que se leyó de las ofertas del ASIN */
export interface LecturaOfertas {
  /** Precio de listing NUESTRO, SIN envío. Es el comparable con el FOEP */
  precioPropio: number | null
  /** Nuestro envío, aparte. NO se suma para comparar con el FOEP */
  envioPropio: number | null
  moneda: string | null
  canalPropio: CanalOferta
  /** ¿Aparece nuestra oferta en la respuesta? */
  hayOfertaPropia: boolean
  buybox: EstadoBuyBox
  precioBuybox: number | null
  envioBuybox: number | null
  canalGanador: CanalOferta | null
  /** Ofertas ajenas. No cuenta la nuestra */
  competidores: number | null
  /** De esos, cuántos entregan con Prime (FBA o SFP) */
  competidoresPrime: number | null
  /** El precio de listing más bajo de la competencia. Comparable con el FOEP */
  precioCompetidorMin: number | null
  /** El más bajo puesto en casa. NO comparable con el FOEP */
  precioCompetidorMinLanded: number | null
  amazon: EstadoAmazonRetail
  /** Cuándo lo leímos NOSOTROS. Amazon no da instante */
  leidoAt: string | null
}

/** Lo que se leyó del FOEP, que puede ser de otra noche */
export interface LecturaFoep {
  estado: EstadoFoepA2
  importe: number | null
  moneda: string | null
  /** El `resultStatus` CRUDO de Amazon. Enum abierto: se guarda tal cual */
  resultado: string | null
  leidoAt: string | null
}

export const FOEP_NO_CONSULTADO: LecturaFoep = {
  estado: 'no_consultado',
  importe: null,
  moneda: null,
  resultado: null,
  leidoAt: null,
}

export interface EntradaDiagnostico {
  sku: string
  asin: string | null
  /** null = nunca se ha leído */
  ofertas: LecturaOfertas | null
  foep: LecturaFoep
  stock: EstadoStock
  margen: MargenAlFoep
  config: ConfigDiagnostico
  /** El instante en el que se diagnostica. SIEMPRE por parámetro */
  ahora: Date
}

/* ------------------------------------------------------------------ */
/* Lo que sale                                                         */
/* ------------------------------------------------------------------ */

export interface Diagnostico {
  veredicto: Veredicto
  /**
   * EL PORQUÉ EN TEXTO, con sus números dentro.
   *
   * La especificación insiste: «el equipo tiene que entender la decisión, no
   * solo obedecerla». Una etiqueta sin frase se obedece; una frase con los
   * números se discute, y discutirla es lo que hace que se detecte cuando el
   * motor se equivoca.
   */
  motivo: string
  accion: string
  /** Menor va antes en el listado accionable */
  prioridad: number
  /** SIEMPRE simulacro: A2 no escribe nada en Amazon */
  precioPropuesto: number | null
  precioPropuestoMotivo: string | null
  /** Los números con los que se decidió. Para poder auditarlo en marzo */
  datos: DatosDelVeredicto
  /** Lo que habría hecho falta y no estaba configurado */
  faltaPorDecidir: string[]
}

/* ------------------------------------------------------------------ */
/* El motor                                                            */
/* ------------------------------------------------------------------ */

/**
 * Diagnostica UN SKU.
 *
 * EL ORDEN DE LOS BLOQUES ES LA TABLA. No es una cadena de `if` cualquiera:
 *
 *   0. ¿Hay lectura?                      -> sin_datos
 *   1. ¿Está nuestra oferta en el ASIN?   -> sin_oferta_propia
 *   2. ¿Amazon vende aquí, CONFIRMADO?    -> no_competible
 *   3. ¿LA TENEMOS?  <-- EL CORTE QUE IMPORTA
 *        SÍ -> el FOEP es DEFENSIVO: cuatro casos
 *        NO -> 4. ¿hay stock?             -> sin_stock
 *              5. ¿la tiene alguien?      -> nadie_la_tiene
 *              6. ¿hay FOEP?              -> sin_foep
 *              7. FOEP >= precio          -> deberiamos_tenerla
 *              8. FOEP <  precio          -> según el margen
 *
 * El paso 3 va ANTES que cualquier comparación de precios. Ver la cabecera.
 */
export function diagnosticar(entrada: EntradaDiagnostico): Diagnostico {
  const { ofertas, foep, stock, config } = entrada
  const falta = faltaPorDecidir(entrada)
  const datos = fotoDeLosDatos(entrada)

  /* ---------- 0. Sin lectura ---------- */
  if (!ofertas) {
    return {
      veredicto: 'sin_datos',
      motivo:
        'Nunca se ha leído la Buy Box de esta referencia, o la última lectura falló. No es que no ' +
        'la tengamos: es que no lo sabemos. Lanza el trabajo «Precios y Buy Box» sobre esta cuenta.',
      accion: 'Leer precios y Buy Box',
      prioridad: 99,
      precioPropuesto: null,
      precioPropuestoMotivo: null,
      datos,
      faltaPorDecidir: falta,
    }
  }

  const moneda = ofertas.moneda ?? foep.moneda
  const precio = ofertas.precioPropio
  const foepImporte = foep.estado === 'disponible' ? foep.importe : null

  /* ---------- 1. Nuestra oferta no está en el ASIN ---------- */
  // Antes que nada lo demás: si nuestra oferta no aparece, no hay Buy Box que
  // ganar ni precio que ajustar. Un listing suprimido vende cero, y bajarle el
  // precio no lo desuprime.
  if (!ofertas.hayOfertaPropia) {
    return {
      veredicto: 'sin_oferta_propia',
      motivo:
        `Amazon no devuelve ninguna oferta nuestra en ${textoAsin(entrada.asin)}. Eso no es un ` +
        'problema de precio: el listing está suprimido, inactivo, sin stock declarado o sin ' +
        'elegibilidad. Mientras siga así vende cero y ningún ajuste de precio lo cambia.',
      accion: 'Revisar el estado del listing en Amazon',
      prioridad: 5,
      precioPropuesto: null,
      precioPropuestoMotivo: null,
      datos,
      faltaPorDecidir: falta,
    }
  }

  /* ---------- 2. Amazon Retail, solo si está CONFIRMADO ---------- */
  // `indeterminado` NO entra aquí, y esa es la corrección más importante de este
  // bloque: colapsarlo a «sí» descarta catálogo bueno, y colapsarlo a «no»
  // recomienda migrar a FBA productos donde Amazon compite. Se sigue
  // diagnosticando y la duda se arrastra en el motivo.
  if (ofertas.amazon === 'si') {
    return {
      veredicto: 'no_competible',
      motivo:
        'Uno de los vendedores de este ASIN está en la lista de identificadores de Amazon Retail ' +
        'que se configuró a mano. Contra la propia Amazon la oferta destacada no se recupera ' +
        'bajando precio.',
      accion: 'Descartar del análisis de precio',
      prioridad: 80,
      precioPropuesto: null,
      precioPropuestoMotivo: null,
      datos,
      faltaPorDecidir: falta,
    }
  }

  /* ================================================================== */
  /* 3. ¿LA TENEMOS? — EL CORTE QUE DECIDE QUÉ SIGNIFICA EL FOEP        */
  /* ================================================================== */
  if (ofertas.buybox === 'nuestra') {
    return conBuyBox(entrada, { precio, foepImporte, moneda, datos, falta })
  }

  /* ---------- 4. Sin existencias ---------- */
  // Solo se pregunta cuando NO la tenemos, y solo cuando el stock es un dato de
  // verdad. `desconocido` no es cero: FBA Inventory omite en silencio los SKU
  // que gestiona el vendedor, y darlo por cero convierte el catálogo FBM entero
  // de un cliente en «sin stock → reponer» con el almacén lleno.
  if (stock.estado !== 'desconocido' && stock.unidades !== null && stock.unidades <= 0) {
    return {
      veredicto: 'sin_stock',
      motivo:
        `No hay existencias (${stock.estado === 'no_aplica' ? 'stock propio' : 'disponible en Amazon'}: 0 unidades` +
        `${stock.leidoAt ? `, leído ${fecha(stock.leidoAt)}` : ''}). Sin stock no hay oferta destacada ` +
        'posible, y el precio no tiene nada que ver.',
      accion: 'Reponer',
      prioridad: 15,
      precioPropuesto: null,
      precioPropuestoMotivo: null,
      datos,
      faltaPorDecidir: falta,
    }
  }

  /* ---------- 5. No la tiene nadie ---------- */
  if (ofertas.buybox === 'nadie') {
    return {
      veredicto: 'nadie_la_tiene',
      motivo:
        'Amazon no está destacando ninguna oferta en este ASIN. Suele significar que todas las ' +
        'ofertas —la nuestra incluida— están por encima del precio que Amazon considera razonable ' +
        'para el producto, o que la categoría no tiene oferta destacada. No es que la hayamos ' +
        `perdido: no la tiene nadie${ofertas.competidores !== null ? `, y hay ${ofertas.competidores} ofertas ajenas` : ''}.` +
        (foepImporte !== null
          ? ` Amazon calcula que a ${dinero(foepImporte, moneda)} sí seríamos la destacada.`
          : ''),
      accion: 'Evaluar una bajada',
      prioridad: 50,
      ...propuesta(entrada, foepImporte, moneda, 'bajar'),
      datos,
      faltaPorDecidir: falta,
    }
  }

  /* ---------- 6. Sin FOEP: no se puede decidir por precio ---------- */
  if (foepImporte === null) {
    return {
      veredicto: 'sin_foep',
      motivo:
        'La oferta destacada la tiene otro y Amazon no nos da el precio al que la recuperaríamos. ' +
        `${foep.estado === 'no_consultado' ? 'No se le ha preguntado en esta ronda (el FOEP va por rotación: es la llamada más cara que hay, una cada treinta segundos).' : textoResultadoFoep(foep.resultado)} ` +
        'Sin ese número no se puede decir si esto se arregla con precio, así que no se dice.',
      accion: foep.estado === 'no_consultado' ? 'Pedir el FOEP de este SKU' : 'Revisar a mano',
      prioridad: 70,
      precioPropuesto: null,
      precioPropuestoMotivo: null,
      datos,
      faltaPorDecidir: falta,
    }
  }

  /* ---------- 7. El techo está POR ENCIMA de nuestro precio ---------- */
  // No la tenemos y aun así Amazon dice que a nuestro precio (o más) deberíamos
  // ser la destacada. El precio NO es el problema.
  if (precio === null || foepImporte >= precio - config.toleranciaImporte) {
    return {
      veredicto: 'deberiamos_tenerla',
      motivo:
        `Amazon calcula que hasta ${dinero(foepImporte, moneda)} nuestra oferta debería ser la ` +
        `destacada${precio !== null ? `, y estamos a ${dinero(precio, moneda)}` : ''}. O sea que el ` +
        'precio NO es el problema. Las causas habituales son las métricas de la cuenta, el plazo ' +
        'de envío, la elegibilidad de la oferta o que la oferta destacada esté segmentada por ' +
        'Prime — el FOEP no se puede pedir separado para Prime y no Prime, así que un único ' +
        'número mezcla las dos realidades.' +
        (ofertas.canalGanador && ofertas.canalPropio !== ofertas.canalGanador
          ? ` El que la tiene entrega por ${ofertas.canalGanador} y nosotros por ${ofertas.canalPropio}.`
          : ''),
      accion: 'Revisar métricas de cuenta y plazo de envío',
      prioridad: 30,
      // NO se propone bajar: bajar de un precio que ya está por debajo del techo
      // es regalar margen sin ganar nada.
      precioPropuesto: null,
      precioPropuestoMotivo:
        'No se propone bajar: el precio ya está por debajo del techo que calcula Amazon, así que ' +
        'una bajada regalaría margen sin recuperar la oferta destacada.',
      datos,
      faltaPorDecidir: falta,
    }
  }

  /* ---------- 8. El techo está POR DEBAJO: se recupera bajando ---------- */
  const objetivo = precioObjetivo(foepImporte, config)
  const cuanto = precio - objetivo

  /* 8a. Sin criterio para decidir si compensa */
  if (entrada.margen.estado === 'no_evaluable') {
    return {
      veredicto: 'bajable_sin_criterio',
      motivo:
        `Amazon calcula que a ${dinero(foepImporte, moneda)} recuperaríamos la oferta destacada, y ` +
        `hoy está a ${dinero(precio, moneda)}: son ${dinero(cuanto, moneda)} de bajada. ` +
        `PERO NO SE PUEDE DECIR SI COMPENSA: ${entrada.margen.motivo} ` +
        'El motor informa y no recomienda.' +
        (ofertas.amazon === 'indeterminado'
          ? ' Y ojo: no se puede saber si Amazon vende también en este ASIN.'
          : ''),
      accion: 'Decidir con el coste delante',
      prioridad: 20,
      ...propuesta(entrada, foepImporte, moneda, 'bajar'),
      datos,
      faltaPorDecidir: falta,
    }
  }

  const margen = entrada.margen
  const umbral = config.margenMinimoPct

  /* 8b. Sin umbral configurado: se conoce el margen pero no con qué compararlo */
  if (umbral === null) {
    return {
      veredicto: 'bajable_sin_criterio',
      motivo:
        `Amazon calcula que a ${dinero(foepImporte, moneda)} recuperaríamos la oferta destacada ` +
        `(hoy ${dinero(precio, moneda)}, ${dinero(cuanto, moneda)} de bajada) y a ese precio ` +
        `quedaría un margen de ${dinero(margen.importe, moneda)} (${porcentaje(margen.porcentaje)}). ` +
        'Este cliente no tiene margen mínimo configurado, así que el motor NO dice si compensa: ' +
        'ese número lo pone una persona.',
      accion: 'Configurar el margen mínimo de este cliente',
      prioridad: 20,
      ...propuesta(entrada, foepImporte, moneda, 'bajar'),
      datos,
      faltaPorDecidir: falta,
    }
  }

  /* 8c. El margen aguanta */
  if (margen.porcentaje > umbral) {
    return {
      veredicto: 'recuperable_bajando',
      motivo:
        `Amazon calcula que a ${dinero(foepImporte, moneda)} recuperaríamos la oferta destacada ` +
        `(hoy ${dinero(precio, moneda)}: ${dinero(cuanto, moneda)} menos). A ese precio quedaría ` +
        `${dinero(margen.importe, moneda)} de margen, un ${porcentaje(margen.porcentaje)}, por ` +
        `encima del mínimo del cliente (${porcentaje(umbral)}).`,
      accion: 'Ajustar el precio (en simulacro)',
      prioridad: 10,
      ...propuesta(entrada, foepImporte, moneda, 'bajar'),
      datos,
      faltaPorDecidir: falta,
    }
  }

  /* 8d. No compensa, y el ganador entrega mejor que nosotros */
  const ganadorMejorCanal =
    ofertas.canalGanador !== null &&
    esPrime(ofertas.canalGanador) &&
    ofertas.canalPropio !== 'desconocido' &&
    !esPrime(ofertas.canalPropio)

  if (ganadorMejorCanal) {
    return {
      veredicto: 'problema_logistico',
      motivo:
        `Bajar a ${dinero(foepImporte, moneda)} dejaría ${porcentaje(margen.porcentaje)} de margen, ` +
        `por debajo del mínimo (${porcentaje(umbral)}), así que por precio no sale. Y el que tiene ` +
        `la oferta destacada entrega por ${ofertas.canalGanador} mientras nosotros vamos por ` +
        `${ofertas.canalPropio}: el problema es logístico, no de precio. Candidato a evaluar el ` +
        'paso a FBA en el módulo A4.',
      accion: 'Evaluar el paso a FBA (A4)',
      prioridad: 40,
      precioPropuesto: null,
      precioPropuestoMotivo:
        'No se propone precio: al FOEP el margen se queda por debajo del mínimo del cliente.',
      datos,
      faltaPorDecidir: falta,
    }
  }

  /* 8e. No compensa y el canal no explica nada */
  return {
    veredicto: 'no_recuperable',
    motivo:
      `Bajar a ${dinero(foepImporte, moneda)} dejaría ${porcentaje(margen.porcentaje)} de margen, ` +
      `por debajo del mínimo del cliente (${porcentaje(umbral)}), y el que la tiene entrega por el ` +
      `mismo canal que nosotros (${ofertas.canalGanador ?? 'desconocido'}). No hay palanca ni de ` +
      'precio ni de logística: o mejora el coste de compra, o esta referencia no es competitiva.',
    accion: 'Revisar el coste de compra o descartar',
    prioridad: 60,
    precioPropuesto: null,
    precioPropuestoMotivo:
      'No se propone precio: al FOEP el margen se queda por debajo del mínimo del cliente.',
    datos,
    faltaPorDecidir: falta,
  }
}

/* ------------------------------------------------------------------ */
/* La rama de «sí la tenemos»: el FOEP es DEFENSIVO                    */
/* ------------------------------------------------------------------ */

/**
 * Los cuatro casos de un SKU que YA tiene la oferta destacada.
 *
 * NINGUNO DE LOS CUATRO PROPONE BAJAR EL PRECIO. Es el punto entero de separar
 * esta rama: aquí el FOEP es el techo hasta el que se puede SUBIR, y tratarlo
 * como un objetivo al que bajar es exactamente el fallo que este módulo existe
 * para no cometer.
 */
function conBuyBox(
  entrada: EntradaDiagnostico,
  ctx: {
    precio: number | null
    foepImporte: number | null
    moneda: string | null
    datos: DatosDelVeredicto
    falta: string[]
  }
): Diagnostico {
  const { precio, foepImporte, moneda, datos, falta } = ctx
  const tol = entrada.config.toleranciaImporte
  const base = { datos, faltaPorDecidir: falta }

  if (foepImporte === null) {
    return {
      veredicto: 'con_buybox_sin_foep',
      motivo:
        'Tenemos la oferta destacada. No se sabe cuánta holgura hay porque Amazon no ha dado el ' +
        `FOEP: ${entrada.foep.estado === 'no_consultado' ? 'no se le ha preguntado en esta ronda' : textoResultadoFoep(entrada.foep.resultado)}. ` +
        'Con la oferta destacada en la mano, el FOEP sería el techo hasta el que se podría subir ' +
        'sin perderla.',
      accion: 'Pedir el FOEP para saber cuánto se puede subir',
      prioridad: 95,
      precioPropuesto: null,
      precioPropuestoMotivo: null,
      ...base,
    }
  }

  if (precio === null) {
    return {
      veredicto: 'con_buybox_sin_foep',
      motivo:
        'Tenemos la oferta destacada, pero no sabemos a qué precio está nuestra propia oferta, así ' +
        'que no se puede decir cuánta holgura hay hasta el techo que calcula Amazon ' +
        `(${dinero(foepImporte, moneda)}).`,
      accion: 'Refrescar el catálogo',
      prioridad: 95,
      precioPropuesto: null,
      precioPropuestoMotivo: null,
      ...base,
    }
  }

  /* --- El caso que la regla ingenua rompía: techo POR ENCIMA del precio --- */
  if (foepImporte > precio + tol) {
    const holgura = foepImporte - precio
    return {
      veredicto: 'con_buybox_margen_arriba',
      motivo:
        `Tenemos la oferta destacada a ${dinero(precio, moneda)} y Amazon calcula que la ` +
        `mantendríamos hasta ${dinero(foepImporte, moneda)}. O sea que sobran ` +
        `${dinero(holgura, moneda)} de recorrido HACIA ARRIBA ` +
        `(${porcentaje((holgura / precio) * 100)} del precio). Aquí el FOEP es defensivo: es el ` +
        'techo hasta donde se puede subir, NO un precio al que bajar. Esta es la oportunidad que ' +
        'el repricer nativo de Amazon nunca ve, porque no sube precios.',
      accion: 'Evaluar una subida (módulo A3)',
      prioridad: 90,
      ...propuesta(entrada, foepImporte, moneda, 'subir'),
      ...base,
    }
  }

  if (foepImporte >= precio - tol) {
    return {
      veredicto: 'con_buybox_al_limite',
      motivo:
        `Tenemos la oferta destacada a ${dinero(precio, moneda)} y el techo que calcula Amazon es ` +
        'prácticamente el mismo precio. No hay recorrido hacia arriba: cualquier subida la pierde. ' +
        'No hay nada que hacer, pero conviene saberlo antes de tocar este SKU.',
      accion: 'No tocar el precio',
      prioridad: 85,
      precioPropuesto: null,
      precioPropuestoMotivo: 'No se propone precio: subir un céntimo pierde la oferta destacada.',
      ...base,
    }
  }

  /* --- Techo por DEBAJO del precio teniéndola: dato raro --- */
  return {
    veredicto: 'con_buybox_incoherente',
    motivo:
      `Tenemos la oferta destacada a ${dinero(precio, moneda)} y sin embargo Amazon calcula el ` +
      `techo en ${dinero(foepImporte, moneda)}, por debajo. Los dos datos no pueden ser ciertos a ` +
      'la vez en el mismo instante: o el FOEP se calculó antes del último cambio de precio (Amazon ' +
      'no dice cuándo lo recalcula ni sella la respuesta con una hora), o la oferta destacada está ' +
      'segmentada por Prime y el FOEP, que no se puede pedir segmentado, mezcla las dos. ' +
      'NO SE BAJA EL PRECIO POR ESTO: se vuelve a mirar en la lectura siguiente.',
    accion: 'Volver a leer y comparar',
    prioridad: 45,
    precioPropuesto: null,
    precioPropuestoMotivo:
      'No se propone precio: el dato es incoherente y una bajada aquí recortaría el precio de un ' +
      'producto que ya tiene la oferta destacada, que es justo el error que este módulo evita.',
    ...base,
  }
}

/* ------------------------------------------------------------------ */
/* La propuesta de precio — SIEMPRE SIMULACRO                          */
/* ------------------------------------------------------------------ */

/**
 * El precio que se PROPONE, que no se aplica.
 *
 * A2 no escribe ni un precio en Amazon: no está autorizado y son dieciséis
 * cuentas ajenas. Esto es un número para mirar, con su explicación al lado.
 *
 * Y hay tres frenos, los tres por defecto en «no actuar»:
 *   · SKU excluido (MAP, acuerdo con la marca) -> no se propone nada.
 *   · Precio suelo -> si la propuesta lo cruza, no se propone y se dice.
 *   · Precio techo -> igual, en las subidas.
 * Cuando el suelo o el techo no están configurados, la propuesta sale IGUAL pero
 * el aviso de que no hay freno viaja en `faltaPorDecidir`.
 */
function propuesta(
  entrada: EntradaDiagnostico,
  foepImporte: number | null,
  moneda: string | null,
  sentido: 'bajar' | 'subir'
): { precioPropuesto: number | null; precioPropuestoMotivo: string | null } {
  const { config } = entrada

  if (foepImporte === null) return { precioPropuesto: null, precioPropuestoMotivo: null }

  if (config.excluidoDePropuesta) {
    return {
      precioPropuesto: null,
      precioPropuestoMotivo:
        config.motivoExclusion ??
        'Esta referencia está excluida de cualquier propuesta de precio (precio mínimo impuesto por la marca).',
    }
  }

  const objetivo = precioObjetivo(foepImporte, config)

  if (sentido === 'bajar' && config.precioSuelo !== null && objetivo < config.precioSuelo) {
    return {
      precioPropuesto: null,
      precioPropuestoMotivo:
        `Haría falta bajar a ${dinero(objetivo, moneda)} y el suelo configurado es ` +
        `${dinero(config.precioSuelo, moneda)}. No se propone: por debajo del suelo la venta ` +
        'destruye margen aunque se gane la oferta destacada.',
    }
  }

  if (sentido === 'subir' && config.precioTecho !== null && objetivo > config.precioTecho) {
    return {
      precioPropuesto: config.precioTecho,
      precioPropuestoMotivo:
        `El techo que calcula Amazon es ${dinero(foepImporte, moneda)}, pero el techo configurado ` +
        `para este cliente es ${dinero(config.precioTecho, moneda)}: manda el nuestro.`,
    }
  }

  const delta =
    config.deltaFoep === null
      ? null
      : config.deltaFoepTipo === 'porcentaje'
        ? (foepImporte * config.deltaFoep) / 100
        : config.deltaFoep

  return {
    precioPropuesto: objetivo,
    precioPropuestoMotivo:
      delta === null
        ? `Es el FOEP exacto (${dinero(foepImporte, moneda)}). SIMULACRO: no se envía nada a Amazon. ` +
          'No se le resta nada porque nadie ha decidido cuánto: el FOEP es un TECHO, así que ' +
          'ponerse justo en él deja la oferta pegada al borde del umbral y cualquier recálculo de ' +
          'Amazon la tumba. Conviene fijar ese margen de seguridad.'
        : `Es el FOEP (${dinero(foepImporte, moneda)}) menos el margen de seguridad configurado ` +
          `(${config.deltaFoepTipo === 'porcentaje' ? `${config.deltaFoep} %` : dinero(config.deltaFoep ?? 0, moneda)}). ` +
          'SIMULACRO: no se envía nada a Amazon.',
  }
}

/** El precio objetivo a partir del FOEP y del delta configurado */
export function precioObjetivo(foepImporte: number, config: ConfigDiagnostico): number {
  if (config.deltaFoep === null) return redondear(foepImporte)
  const delta =
    config.deltaFoepTipo === 'porcentaje'
      ? (foepImporte * config.deltaFoep) / 100
      : config.deltaFoep
  return redondear(Math.max(0, foepImporte - delta))
}

/** Dos decimales. NO hay redondeo psicológico: eso es una decisión de negocio */
function redondear(n: number): number {
  return Math.round(n * 100) / 100
}

/* ------------------------------------------------------------------ */
/* Lo que falta por decidir                                            */
/* ------------------------------------------------------------------ */

/**
 * La lista de lo que no está configurado y hace falta.
 *
 * Va en cada diagnóstico y se enseña en la pantalla. Que se vea que FALTA, no
 * que parezca decidido: un motor que calla lo que no sabe es indistinguible de
 * uno que lo sabe todo.
 */
export function faltaPorDecidir(entrada: EntradaDiagnostico): string[] {
  const falta: string[] = []
  const { config } = entrada

  if (config.margenMinimoPct === null) {
    falta.push('Margen mínimo aceptable del cliente (sin él el motor informa pero no recomienda)')
  }
  if (entrada.margen.estado === 'no_evaluable') {
    falta.push(entrada.margen.motivo)
  }
  if (config.deltaFoep === null) {
    falta.push(
      'Margen de seguridad por debajo del FOEP: hoy se propone el FOEP exacto, que es el borde del umbral'
    )
  }
  if (config.precioSuelo === null) {
    falta.push('Precio suelo: sin él nada impide que una propuesta baje por debajo del coste')
  }
  if (config.precioTecho === null) {
    falta.push('Precio techo: sin él nada acota una subida')
  }
  if (entrada.ofertas?.amazon === 'indeterminado') {
    falta.push(
      'Identificadores de vendedor de Amazon Retail de este marketplace: sin ellos no se puede saber si Amazon compite en el ASIN'
    )
  }
  return falta
}

/* ------------------------------------------------------------------ */
/* La foto de los números                                              */
/* ------------------------------------------------------------------ */

function fotoDeLosDatos(entrada: EntradaDiagnostico): DatosDelVeredicto {
  const o = entrada.ofertas
  return {
    precioPropio: o?.precioPropio ?? null,
    precioPropioLanded: sumaOpcional(o?.precioPropio ?? null, o?.envioPropio ?? null),
    moneda: o?.moneda ?? entrada.foep.moneda ?? null,
    buybox: o?.buybox ?? 'desconocido',
    precioBuybox: o?.precioBuybox ?? null,
    canalGanador: o?.canalGanador ?? null,
    canalPropio: o?.canalPropio ?? null,
    competidores: o?.competidores ?? null,
    competidoresPrime: o?.competidoresPrime ?? null,
    precioCompetidorMin: o?.precioCompetidorMin ?? null,
    amazon: o?.amazon ?? 'indeterminado',
    foep: entrada.foep.estado === 'disponible' ? entrada.foep.importe : null,
    foepEstado: entrada.foep.estado,
    foepResultado: entrada.foep.resultado,
    foepHoras: horasDesde(entrada.foep.leidoAt, entrada.ahora),
    stock: entrada.stock.estado,
    stockUnidades: entrada.stock.unidades,
    faltaba: faltaPorDecidir(entrada),
  }
}

/**
 * Cuántas horas tiene el FOEP con el que se está decidiendo.
 *
 * NO es un adorno: con la rotación semanal, un FOEP puede tener seis días. Un
 * veredicto tomado con un techo de hace seis días vale menos que uno de hace una
 * hora, y quien lo lea tiene que poder saberlo.
 */
function horasDesde(iso: string | null | undefined, ahora: Date): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return Math.max(0, Math.round(((ahora.getTime() - t) / 3600000) * 10) / 10)
}

function sumaOpcional(a: number | null, b: number | null): number | null {
  if (a === null) return null
  return redondear(a + (b ?? 0))
}

/* ------------------------------------------------------------------ */
/* Formato                                                             */
/* ------------------------------------------------------------------ */

/**
 * Los importes de los motivos.
 *
 * Se formatea aquí y no en la pantalla a propósito: el motivo se GUARDA en la
 * base tal cual y se exporta al cliente. Si el número se pintara al enseñarlo,
 * el texto guardado y el texto visto podrían divergir y una auditoría no
 * cuadraría.
 */
function dinero(valor: number | null, moneda: string | null): string {
  if (valor === null || !Number.isFinite(valor)) return '—'
  const n = valor.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return moneda ? `${n} ${moneda}` : n
}

function porcentaje(valor: number | null): string {
  if (valor === null || !Number.isFinite(valor)) return '—'
  return `${valor.toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`
}

function fecha(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'en fecha desconocida'
  return `el ${d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}`
}

function textoAsin(asin: string | null): string {
  return asin ? `el ASIN ${asin}` : 'este ASIN'
}
