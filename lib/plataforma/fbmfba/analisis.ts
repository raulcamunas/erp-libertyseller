/**
 * PLATAFORMA · MÓDULO A4 — EL MOTOR DEL ANÁLISIS FBM → FBA
 * ========================================================
 * FUNCIÓN PURA. Todo entra por parámetro, `ahora` incluido. Es la función que
 * decide si se le propone a un cliente meter mercancía suya en un almacén de
 * Amazon, así que tiene que poder comprobarse caso a caso sin levantar nada.
 * Ver scripts/check-margen-fbmfba.ts.
 *
 *
 * =====================================================================
 *  ██  LAS CINCO REGLAS DEL §3.5, Y LAS TRES QUE ESTÁN MAL  ██
 * =====================================================================
 *
 * REGLA 1 · COLCHÓN OBLIGATORIO. No se recomienda FBA con margen marginal. Si el
 *   margen solo funciona estando EXACTAMENTE en el precio tope, en cuanto un
 *   competidor baje un céntimo hay inventario muerto en un almacén de Amazon —y
 *   sacarlo de ahí cuesta dinero—. La especificación habla de un 10-12 %; EL
 *   NÚMERO LO PONE EL CLIENTE. Mientras no esté, este motor INFORMA Y NO
 *   RECOMIENDA.
 *
 * REGLA 2 · ROTACIÓN MÍNIMA. CORREGIDA: no hay datos de ventas con los roles
 *   concedidos. Orders API no está y el informe de ventas y tráfico necesita el
 *   rol de Análisis de marcas, que sigue pendiente. Las ventas entran por CSV y
 *   el ranking sirve de SEÑAL. Cuando no hay ninguna de las dos cosas el estado
 *   es «NO EVALUABLE», JAMÁS «no rota»: descartar por eso sería tirar catálogo
 *   bueno porque nadie importó un fichero.
 *
 * REGLA 3 · AMAZON RETAIL EN EL ASIN → DESCARTADO. CORREGIDA: es TERNARIO. No
 *   existe ningún campo que identifique la oferta de Amazon —`IsFulfilledByAmazon`
 *   significa FBA, que también devuelve un tercero, y la lista de identificadores
 *   de Amazon Retail no está publicada—. Solo se descarta con un «sí»
 *   confirmado contra la lista que se haya rellenado a mano. CON INDETERMINADO
 *   EL VEREDICTO ES «REVISAR», NO «DESCARTADO».
 *
 * REGLA 4 · MARCAR LOS SKU SIN DIMENSIONES FIABLES, CON SU PROCEDENCIA. La
 *   tarifa de FBA se calcula sobre el embalaje y no existe ninguna señal de
 *   «medida certificada por Amazon». Se deriva de dónde salió cada medida y se
 *   dice en la fila. Ver `ProcedenciaDims` en tipos.ts.
 *
 * REGLA 5 · MARCAR LOS SKU SIN FOEP COMO CASO APARTE. Sin el precio de
 *   referencia no se sabe a cuánto habría que vender de verdad, y entonces el
 *   margen que se calcula es el de HOY, no el de después de migrar.
 *
 *
 * =====================================================================
 *  ██  EL FOEP ES UN TECHO CON DOS SENTIDOS  ██
 * =====================================================================
 *
 * Y de los dos sale un precio de evaluación distinto:
 *
 *   · NO tenemos la oferta destacada → el FOEP es OFENSIVO: es el precio AL QUE
 *     HABRÍA QUE BAJAR para venderla de verdad. Ese es el precio realista.
 *   · SÍ la tenemos → el FOEP es DEFENSIVO: es el techo hasta el que se PODRÍA
 *     subir, y normalmente está POR ENCIMA del precio actual. CALCULAR EL MARGEN
 *     AHÍ ES INFLARLO: sería contar un ingreso que nadie ha decidido cobrar, y
 *     encima justo en las referencias que ya van bien.
 *
 * La regla que resuelve los dos casos a la vez es `min(precio_actual, FOEP)`, y
 * es prudente siempre:
 *   · defensivo (FOEP > precio) → se queda el precio actual. Correcto.
 *   · ofensivo (FOEP < precio) → se queda el FOEP. Correcto.
 *   · sin la oferta destacada y ya por debajo del FOEP → se queda el precio
 *     actual, que es lo que se cobra hoy. Correcto.
 * Lo que NO se puede perder por el camino es DECIR CUÁL DE LOS DOS CASOS ES, y
 * por eso `sentidoFoep` viaja en cada fila y sale en la exportación.
 *
 *
 * =====================================================================
 *  A4 RECOMIENDA. NO EJECUTA.
 * =====================================================================
 *
 * Crear un envío de entrada necesita el rol de Logística de Amazon, que la
 * aplicación NO tiene y no ha pedido. Ninguna acción de este fichero dice «crear
 * el envío» ni «mandar a Amazon»: la salida es una lista de candidatos con su
 * porqué, para decidirla con el cliente y ejecutarla a mano en Seller Central.
 */

import type { EstadoBuyBox, EstadoAmazonRetail, EstadoFoepA2 } from '../buybox/tipos'
import { textoResultadoFoep } from '../buybox/tipos'
import type { CosteEvaluable, Exigencias } from '../costes/completitud'
import { calcularMargen, compararEscenarios, type Comparacion, type ResultadoMargen, type TarifasEscenario } from './margen'
import { faltaFiscal, type ParametrosFiscales } from './fiscal'
import {
  CONFIANZA_DIMS,
  PROCEDENCIA_DIMS_LABELS,
  PRIORIDAD_VEREDICTO,
  ROTACION_DESCONOCIDA,
  canalDeCoste,
  esCanalPropio,
  type CanalA4,
  type ConfianzaDims,
  type ConfigFbmFba,
  type ProcedenciaDims,
  type Rotacion,
  type Salvedad,
  type SentidoFoep,
  type VeredictoA4,
} from './tipos'

/* ------------------------------------------------------------------ */
/* Lo que entra                                                        */
/* ------------------------------------------------------------------ */

export interface EntradaAnalisis {
  sku: string
  asin: string | null
  titulo: string | null
  marca: string | null

  /** Por dónde sale hoy el paquete. Ver CanalA4: son cinco estados, no dos */
  canal: CanalA4
  /** ¿Entra en el conjunto de SKU que se refrescan a diario? */
  enSeguimiento: boolean

  /** Precio de listing de hoy, sin envío */
  precioActual: number | null
  moneda: string | null

  /* --- El techo de Amazon, con quién tiene hoy la oferta destacada --- */
  foep: number | null
  foepEstado: EstadoFoepA2
  /** El `resultStatus` crudo. Enum abierto: se guarda y se traduce con rama por defecto */
  foepResultado: string | null
  foepLeidoAt: string | null
  /** QUIÉN TIENE HOY LA OFERTA DESTACADA. Sin esto el FOEP no se puede interpretar */
  buybox: EstadoBuyBox

  /** Ternario. `indeterminado` es el caso normal y NO descarta */
  amazon: EstadoAmazonRetail

  procedenciaDims: ProcedenciaDims
  rotacion: Rotacion

  coste: CosteEvaluable | null
  exigencias: Exigencias
  fiscal: ParametrosFiscales

  /** Tarifas del escenario de HOY (lo envía el cliente) */
  tarifasPropio: TarifasEscenario
  /** Tarifas del escenario de FBA. Hay que pedirlas marcando el canal de Amazon */
  tarifasFba: TarifasEscenario

  config: ConfigFbmFba
  /** El instante del análisis. SIEMPRE por parámetro */
  ahora: Date
}

/* ------------------------------------------------------------------ */
/* Lo que sale                                                         */
/* ------------------------------------------------------------------ */

export interface AnalisisSku {
  sku: string
  asin: string | null
  titulo: string | null
  marca: string | null
  canal: CanalA4
  enSeguimiento: boolean

  veredicto: VeredictoA4
  /** EL PORQUÉ EN TEXTO, con sus números dentro. Es la mitad del valor de A4 */
  motivo: string
  accion: string
  prioridad: number
  /** Las dudas que acompañan al veredicto sin sustituirlo */
  salvedades: Salvedad[]

  precioActual: number | null
  /** El precio con el que se ha calculado. Ver la cabecera: min(actual, FOEP) */
  precioEvaluado: number | null
  moneda: string | null

  foep: number | null
  foepEstado: EstadoFoepA2
  sentidoFoep: SentidoFoep
  /** Cuántas horas tenía el FOEP al usarlo. Con rotación semanal pueden ser días */
  foepHoras: number | null
  buybox: EstadoBuyBox
  amazon: EstadoAmazonRetail

  margenPropio: ResultadoMargen
  margenFba: ResultadoMargen
  comparacion: Comparacion

  rotacion: Rotacion
  procedenciaDims: ProcedenciaDims
  confianzaDims: ConfianzaDims

  /** Lo que habría hecho falta y nadie ha decidido */
  faltaPorDecidir: string[]
}

/* ------------------------------------------------------------------ */
/* El precio de evaluación                                             */
/* ------------------------------------------------------------------ */

/**
 * A QUÉ PRECIO SE EVALÚA, Y QUÉ SENTIDO TIENE EL FOEP EN ESTA FILA.
 *
 * Está exportada aparte porque es la decisión que más fácil se escribe mal y la
 * que más caro sale: usar el FOEP a secas infla el margen de todas las
 * referencias que YA tienen la oferta destacada, que son las que van bien.
 */
export function precioDeEvaluacion(entrada: {
  precioActual: number | null
  foep: number | null
  foepEstado: EstadoFoepA2
  buybox: EstadoBuyBox
}): { precio: number | null; sentido: SentidoFoep } {
  const foep = entrada.foepEstado === 'disponible' ? entrada.foep : null

  if (foep === null || !Number.isFinite(foep)) {
    return { precio: entrada.precioActual, sentido: 'sin_dato' }
  }

  // Los CUATRO estados de la oferta destacada, no dos. `desconocido` no es «de
  // otro»: es que no se ha podido leer, y decir «hay que bajar» sobre eso es
  // recomendar un recorte de precio contra una competencia que nadie comprobó.
  const sentido: SentidoFoep =
    entrada.buybox === 'nuestra'
      ? 'defensivo'
      : entrada.buybox === 'desconocido'
        ? 'sin_juicio'
        : 'ofensivo'

  if (entrada.precioActual === null || !Number.isFinite(entrada.precioActual)) {
    // Sin precio propio, el techo es lo único que hay. Con el FOEP defensivo eso
    // sería optimista, pero sin la oferta destacada nuestra no hay precio nuestro
    // que defender: el caso no se da y si se diera, el margen lo marcará el
    // motivo. Con `sin_juicio` tampoco se usa el techo como precio: no se sabe
    // si hay algo que conquistar.
    return { precio: sentido === 'ofensivo' ? foep : null, sentido }
  }

  return { precio: Math.min(entrada.precioActual, foep), sentido }
}

/* ------------------------------------------------------------------ */
/* El motor                                                            */
/* ------------------------------------------------------------------ */

/**
 * Analiza UN SKU.
 *
 * EL ORDEN DE LOS BLOQUES ES LA TABLA:
 *
 *   0. ¿hay algo leído?                    -> sin_datos
 *   1. ¿ya está en FBA?                    -> ya_en_fba
 *   2. ¿se sabe por dónde sale hoy?        -> canal_desconocido
 *   3. ¿Amazon vende aquí, CONFIRMADO?     -> descartado_amazon
 *   4. ¿se pueden calcular los dos mundos? -> no_evaluable
 *   5. ¿rota por encima del mínimo?        -> sin_rotacion
 *   6. ¿hay umbrales con los que decidir?  -> informa_sin_umbral
 *   7. ¿llega al colchón y mejora bastante?-> no_compensa
 *   8. ¿alguna salvedad frena?             -> revisar / candidato
 *
 * El paso 3 solo dispara con «sí» confirmado. El `indeterminado` NO descarta:
 * baja hasta el paso 8 y allí convierte un candidato en un «revisar».
 */
export function analizar(entrada: EntradaAnalisis): AnalisisSku {
  const salvedades: Salvedad[] = []
  const falta = faltaPorDecidir(entrada)

  const { precio: precioEvaluado, sentido } = precioDeEvaluacion(entrada)
  const foepHoras = horasDesde(entrada.foepLeidoAt, entrada.ahora)
  const moneda = entrada.moneda ?? entrada.coste?.moneda ?? null

  /* ---------- Los dos mundos, siempre calculados ---------- */
  // Se calculan aunque el veredicto vaya a ser «ya está en FBA» o «descartado»:
  // el número es la mitad de lo que se le enseña al cliente, y esconderlo porque
  // el veredicto es negativo obliga a rehacer el análisis a mano para discutirlo.
  const comun = {
    precio: precioEvaluado,
    moneda: entrada.moneda,
    fiscal: entrada.fiscal,
    coste: entrada.coste,
    exigencias: entrada.exigencias,
    toleranciaTarifaPct: entrada.config.toleranciaTarifaPct,
  }
  const margenPropio = calcularMargen({ ...comun, escenario: 'propio', tarifas: entrada.tarifasPropio })
  const margenFba = calcularMargen({ ...comun, escenario: 'fba', tarifas: entrada.tarifasFba })
  const comparacion = compararEscenarios(margenPropio, margenFba)

  const confianzaDims = CONFIANZA_DIMS[entrada.procedenciaDims]

  const base = {
    sku: entrada.sku,
    asin: entrada.asin,
    titulo: entrada.titulo,
    marca: entrada.marca,
    canal: entrada.canal,
    enSeguimiento: entrada.enSeguimiento,
    precioActual: entrada.precioActual,
    precioEvaluado,
    moneda,
    foep: entrada.foepEstado === 'disponible' ? entrada.foep : null,
    foepEstado: entrada.foepEstado,
    sentidoFoep: sentido,
    foepHoras,
    buybox: entrada.buybox,
    amazon: entrada.amazon,
    margenPropio,
    margenFba,
    comparacion,
    rotacion: entrada.rotacion,
    procedenciaDims: entrada.procedenciaDims,
    confianzaDims,
    faltaPorDecidir: falta,
  }

  const cerrar = (
    veredicto: VeredictoA4,
    motivo: string,
    accion: string
  ): AnalisisSku => ({
    ...base,
    veredicto,
    motivo,
    accion,
    prioridad: PRIORIDAD_VEREDICTO[veredicto],
    salvedades,
  })

  /* ---------- 0. Nada leído ---------- */
  if (entrada.canal === 'desconocido' && entrada.precioActual === null) {
    return cerrar(
      'sin_datos',
      'De esta referencia no hay ni precio ni canal de envío. No es que no compense pasarla a FBA: ' +
        'es que no sabemos nada de ella. Lanza el censo del catálogo de esta cuenta.',
      'Lanzar el censo del catálogo'
    )
  }

  /* ---------- 1. Ya está en FBA ---------- */
  if (entrada.canal === 'FBA') {
    return cerrar(
      'ya_en_fba',
      'Esta referencia ya la guarda y la envía Amazon, así que aquí no hay migración que evaluar. ' +
        `El margen que aparece al lado es el que deja hoy${
          margenPropio.estado === 'calculado' && margenFba.estado === 'calculado'
            ? ', y la columna del canal propio dice lo que dejaría si el cliente volviera a enviarla él'
            : ''
        }.`,
      'Nada que hacer aquí'
    )
  }

  /* ---------- 2. No se sabe por dónde sale ---------- */
  if (!esCanalPropio(entrada.canal)) {
    return cerrar(
      'canal_desconocido',
      'No consta por dónde sale hoy el paquete de esta referencia, así que no se puede decir ni de ' +
        'dónde partiría la migración. Suele arreglarse refrescando el catálogo de la cuenta.',
      'Refrescar el catálogo'
    )
  }

  /* --- Seller Fulfilled Prime: candidato distinto, no peor --- */
  if (entrada.canal === 'SFP') {
    salvedades.push({
      clave: 'sfp',
      texto:
        'Esta referencia ya llega con insignia Prime enviándola el propio cliente (SFP). Pasarla a ' +
        'FBA no gana visibilidad: lo que se gana o se pierde es coste y trabajo de almacén, así que ' +
        'la comparación de márgenes de al lado es TODO el argumento.',
      degrada: false,
    })
  }
  if (entrada.canal === 'propio_prime_desconocido') {
    salvedades.push({
      clave: 'sfp',
      texto:
        'Sabemos que el paquete lo envía el cliente, pero no si lleva insignia Prime: el informe de ' +
        'listings no distingue Seller Fulfilled Prime de un envío normal. Si ya fuera Prime, lo que ' +
        'se gana migrando es coste, no visibilidad. Se sabrá en cuanto el monitor de Buy Box lea sus ' +
        'ofertas.',
      degrada: false,
    })
  }
  if (!entrada.enSeguimiento) {
    salvedades.push({
      clave: 'fuera_de_seguimiento',
      texto:
        'Esta referencia no está en el conjunto que se refresca a diario, así que sus datos pueden ' +
        'ser viejos.',
      degrada: false,
    })
  }

  /* ---------- 3. Amazon Retail, SOLO confirmado ---------- */
  if (entrada.amazon === 'si') {
    return cerrar(
      'descartado_amazon',
      'Uno de los vendedores de este ASIN está en la lista de identificadores de Amazon Retail que ' +
        'se configuró a mano. Contra la propia Amazon la oferta destacada no se gana con logística: ' +
        'meter inventario en su almacén para competir contra ella es pagar por perder.',
      'Descartar del análisis'
    )
  }
  if (entrada.amazon === 'indeterminado') {
    salvedades.push({
      clave: 'amazon_indeterminado',
      texto:
        'NO SE PUEDE SABER si Amazon vende también en este ASIN. No hay ningún campo de la API que ' +
        'identifique su oferta —la marca de FBA no vale, un tercero con FBA devuelve lo mismo— y la ' +
        'lista de sus identificadores de vendedor no está publicada. Se rellena a mano en la ' +
        'configuración del monitor de Buy Box; mientras esté vacía, esto es lo honesto.',
      degrada: true,
    })
  }

  /* --- El FOEP, con su sentido, antes de juzgar los márgenes --- */
  anotarFoep(entrada, sentido, foepHoras, salvedades)
  anotarDimensiones(entrada, confianzaDims, salvedades)

  /* ---------- 4. ¿Se pueden calcular los dos mundos? ---------- */
  if (margenPropio.estado !== 'calculado' || margenFba.estado !== 'calculado') {
    const cuales: string[] = []
    if (margenPropio.estado !== 'calculado') cuales.push(`Enviándolo el cliente: ${margenPropio.motivo}`)
    if (margenFba.estado !== 'calculado') cuales.push(`Enviándolo Amazon: ${margenFba.motivo}`)
    return cerrar(
      'no_evaluable',
      `No se puede comparar: falta un dato. ${cuales.join(' ')} No se rellena con cero a propósito: ` +
        'lo que falta siempre son costes, así que un margen a medias sale mejor que el de verdad y ' +
        'es indistinguible de uno bueno.',
      'Completar el dato que falta'
    )
  }

  /* ---------- 5. La rotación ---------- */
  const rotacion = juzgarRotacion(entrada, salvedades)
  if (rotacion) return cerrar('sin_rotacion', rotacion.motivo, rotacion.accion)

  /* ---------- 6. ¿Hay con qué decidir? ---------- */
  const colchon = entrada.config.colchonMargenPct
  const mejoraMinima = entrada.config.mejoraMinimaPuntos

  if (colchon === null || mejoraMinima === null) {
    return cerrar(
      'informa_sin_umbral',
      `Enviándolo el cliente deja ${pct(margenPropio.porcentaje)} (${dinero(margenPropio.importe, moneda)}) y ` +
        `enviándolo Amazon dejaría ${pct(margenFba.porcentaje)} (${dinero(margenFba.importe, moneda)}): ` +
        `${puntos(comparacion.puntos)} de diferencia, calculado a ${dinero(precioEvaluado, moneda)}. ` +
        'ESTE CLIENTE NO TIENE UMBRALES PUESTOS, así que el motor NO dice si compensa: ' +
        `falta ${colchon === null ? 'el colchón de margen mínimo en FBA' : ''}` +
        `${colchon === null && mejoraMinima === null ? ' y ' : ''}` +
        `${mejoraMinima === null ? 'la mejora mínima que justifica mover la referencia' : ''}. ` +
        'Esos números los pone una persona: con uno inventado se recomiendan migraciones sin base y ' +
        'las paga el cliente.',
      'Poner los umbrales de este cliente'
    )
  }

  /* ---------- 7. ¿Compensa? ---------- */
  const margenFbaPct = margenFba.porcentaje as number
  const diferencia = comparacion.puntos as number

  if (margenFbaPct < colchon) {
    return cerrar(
      'no_compensa',
      `Enviándolo Amazon quedaría ${pct(margenFbaPct)} de margen a ${dinero(precioEvaluado, moneda)}, por ` +
        `debajo del colchón de este cliente (${pct(colchon)}). Con un margen así la referencia solo ` +
        'funciona estando exactamente en el precio tope: en cuanto un competidor baje un céntimo, eso ' +
        'es inventario parado en un almacén de Amazon y sacarlo de ahí cuesta dinero.' +
        (diferencia > 0
          ? ` Y eso que FBA mejora ${puntos(diferencia)} sobre el canal de hoy: el problema no es la logística, es el coste de compra o el precio.`
          : ''),
      'Descartar o renegociar el coste de compra'
    )
  }

  if (diferencia < mejoraMinima) {
    return cerrar(
      'no_compensa',
      `Enviándolo Amazon quedaría ${pct(margenFbaPct)} y hoy queda ${pct(margenPropio.porcentaje)}: ` +
        `${puntos(diferencia)} de diferencia, por debajo de la mejora mínima de este cliente ` +
        `(${puntos(mejoraMinima)}). El margen aguanta, pero mover la referencia —preparar, etiquetar y ` +
        'mandar el envío— no se paga con esa diferencia.',
      'Dejarla como está'
    )
  }

  /* ---------- 8. Candidato, salvo que algo frene ---------- */
  const frenos = salvedades.filter((s) => s.degrada)
  const cifras =
    `A ${dinero(precioEvaluado, moneda)} ${textoSentido(sentido)}, enviándolo el cliente quedan ` +
    `${dinero(margenPropio.importe, moneda)} (${pct(margenPropio.porcentaje)}) y enviándolo Amazon ` +
    `quedarían ${dinero(margenFba.importe, moneda)} (${pct(margenFbaPct)}): ${puntos(diferencia)} de mejora, ` +
    `por encima del mínimo del cliente (${puntos(mejoraMinima)}), y con colchón de sobra sobre ${pct(colchon)}.` +
    `${textoRotacion(entrada.rotacion)}`

  if (frenos.length > 0) {
    return cerrar(
      'revisar',
      `${cifras} PERO ANTES DE PROPONERLO HAY QUE MIRAR ${frenos.length === 1 ? 'ESTO' : 'ESTAS COSAS'}: ` +
        frenos.map((f) => f.texto).join(' '),
      'Resolver la duda y volver'
    )
  }

  return cerrar(
    'candidato',
    `${cifras} Las tarifas incluyen almacenamiento y flete de entrada, que Amazon no cuenta en su ` +
      'estimación. Desde aquí no se crea ningún envío: esto es una propuesta para decidir con el cliente.',
    'Proponérselo al cliente'
  )
}

/* ------------------------------------------------------------------ */
/* REGLA 5 — el FOEP como caso aparte                                  */
/* ------------------------------------------------------------------ */

/**
 * Las salvedades del techo de Amazon.
 *
 * Que falte el FOEP frena o no SEGÚN QUIÉN TENGA LA OFERTA DESTACADA, y esa
 * distinción es la que hace que la regla 5 sea útil en vez de marcar medio
 * catálogo:
 *
 *   · Si NO la tenemos y no hay FOEP, no se sabe a cuánto habría que vender para
 *     venderla de verdad. El margen calculado es el del precio de hoy, que es un
 *     precio al que no se vende. Eso SÍ frena.
 *   · Si SÍ la tenemos, el precio de hoy es el precio al que se vende: el FOEP
 *     solo diría cuánto se podría subir. Se anota y no frena.
 */
function anotarFoep(
  entrada: EntradaAnalisis,
  sentido: SentidoFoep,
  foepHoras: number | null,
  salvedades: Salvedad[]
): void {
  if (sentido === 'sin_dato') {
    const tenemos = entrada.buybox === 'nuestra'
    salvedades.push({
      clave: 'sin_foep',
      texto: tenemos
        ? 'No hay precio de referencia de Amazon para esta referencia, pero la oferta destacada ya es ' +
          'nuestra: el precio de hoy es el precio al que se vende, así que el margen calculado es real. ' +
          `Lo que no se sabe es cuánto se podría subir. ${motivoFoep(entrada)}`
        : 'NO HAY PRECIO DE REFERENCIA DE AMAZON y la oferta destacada no es nuestra. El margen de al ' +
          'lado está calculado al precio de hoy, que es un precio al que hoy no se vende: para vender ' +
          `de verdad habría que bajar a un número que no conocemos. ${motivoFoep(entrada)}`,
      degrada: !tenemos,
    })
    return
  }

  // El techo se leyó, pero NO se sabe de quién es la oferta destacada. El margen
  // se ha calculado al menor de los dos precios, que es lo conservador, pero no
  // se puede afirmar ni que haya que bajar ni que no haga falta. Degrada: una
  // fila así no puede salir como «candidato» a secas, porque la decisión de
  // migrar se tomaría sobre una competencia que nadie ha mirado.
  if (sentido === 'sin_juicio') {
    salvedades.push({
      clave: 'foep_sin_juicio',
      texto:
        'HAY PRECIO DE REFERENCIA DE AMAZON, PERO NO SE SABE DE QUIÉN ES LA OFERTA DESTACADA en esta ' +
        'referencia. El margen de al lado está calculado al menor entre el precio de hoy y ese techo, ' +
        'que es lo prudente, pero no se puede decir si es un techo AL QUE BAJAR para conquistarla o un ' +
        'techo HASTA EL QUE SUBIR porque ya es nuestra: son dos decisiones opuestas. Antes de mover el ' +
        'precio hay que mirar la oferta destacada en el monitor de Buy Box.',
      degrada: true,
    })
  }

  if (sentido === 'defensivo') {
    salvedades.push({
      clave: 'foep_defensivo',
      texto:
        'La oferta destacada ya es nuestra, así que el precio de referencia de Amazon es un TECHO ' +
        'HACIA ARRIBA —hasta cuánto se podría subir sin perderla— y NO un precio al que bajar. Por eso ' +
        'el margen se ha calculado al precio de hoy: contarlo al techo sería sumar un ingreso que ' +
        'nadie ha decidido cobrar.',
      degrada: false,
    })
  }

  // Con la rotación semanal del FOEP, un techo de seis días es lo normal y no es
  // un fallo: es el diseño que hace que la ventana nocturna quepa. Lo que no
  // puede pasar es que quien lea el veredicto no lo sepa.
  if (foepHoras !== null && foepHoras >= 48) {
    salvedades.push({
      clave: 'foep_viejo',
      texto:
        `El precio de referencia con el que se ha calculado tiene ${Math.round(foepHoras / 24)} días. ` +
        'El FOEP se pide por rotación porque es la llamada más cara de la API (una cada treinta ' +
        'segundos), así que esto es normal; simplemente vale menos que uno de esta noche.',
      degrada: false,
    })
  }
}

function motivoFoep(entrada: EntradaAnalisis): string {
  if (entrada.foepEstado === 'no_consultado') {
    return 'No se le ha preguntado en esta ronda: el precio de referencia va por rotación porque es la llamada más cara que hay.'
  }
  return textoResultadoFoep(entrada.foepResultado)
}

/* ------------------------------------------------------------------ */
/* REGLA 4 — las dimensiones                                           */
/* ------------------------------------------------------------------ */

/**
 * LA PROCEDENCIA DE LAS MEDIDAS, SIEMPRE DICHA.
 *
 * Y una cosa que hay que entender para no volverse loco leyendo esta columna: la
 * única procedencia FIABLE —que Amazon haya cobrado con esas medidas— solo se da
 * en SKU QUE YA ESTÁN EN FBA, o sea justo los que este análisis no evalúa. Para
 * un candidato de verdad, lo mejor a lo que se puede aspirar es «del catálogo de
 * Amazon». Por eso la media NO frena y la baja sí: frenar la media dejaría el
 * módulo entero en «revisar» y la columna dejaría de significar nada.
 */
function anotarDimensiones(
  entrada: EntradaAnalisis,
  confianza: ConfianzaDims,
  salvedades: Salvedad[]
): void {
  if (confianza === 'alta') return

  const etiqueta = PROCEDENCIA_DIMS_LABELS[entrada.procedenciaDims]
  const frena = entrada.config.exigirDimensionesFiables && (confianza === 'baja' || confianza === 'ninguna')

  salvedades.push({
    clave: 'dimensiones',
    texto:
      `Las medidas de esta referencia son «${etiqueta.toLowerCase()}». La tarifa de FBA se calcula ` +
      'sobre el embalaje y un salto de tramo de tamaño cambia el importe, así que la estimación de ' +
      'arriba vale lo que valgan esas medidas. No existe ningún campo en toda la API que diga si una ' +
      'medida la comprobó Amazon o la escribió el vendedor: la única evidencia posible es que Amazon ' +
      'ya haya cobrado por ese SKU, y eso solo pasa cuando ya está en FBA.' +
      (frena ? ' Con esta procedencia no se da un candidato limpio.' : ''),
    degrada: frena,
  })
}

/* ------------------------------------------------------------------ */
/* REGLA 2 — la rotación                                               */
/* ------------------------------------------------------------------ */

/**
 * ¿Rota lo suficiente?
 *
 * Devuelve el veredicto SOLO cuando hay motivo para descartar. En cualquier otro
 * caso deja una salvedad y sigue: «no lo sabemos» no es «no rota», y esa es la
 * corrección entera de esta regla.
 */
function juzgarRotacion(
  entrada: EntradaAnalisis,
  salvedades: Salvedad[]
): { motivo: string; accion: string } | null {
  const { rotacion, config } = entrada

  if (rotacion.estado === 'medida') {
    const unidades = rotacion.unidades ?? 0
    if (config.rotacionMinimaUnidades !== null && unidades < config.rotacionMinimaUnidades) {
      return {
        motivo:
          `Ha vendido ${unidades} ${unidades === 1 ? 'unidad' : 'unidades'} en ${rotacion.ventanaDias} días ` +
          `(hay dato de ${rotacion.diasConDato} ${rotacion.diasConDato === 1 ? 'día' : 'días'}), por debajo del ` +
          `mínimo de este cliente (${config.rotacionMinimaUnidades}). En FBA lo que no rota paga ` +
          'almacenamiento todos los meses y acaba pagando tarifa de inventario sobrante: una referencia ' +
          'lenta cuesta más en el almacén de Amazon que en el del cliente.',
        accion: 'Dejarla en envío propio',
      }
    }
    if (config.rotacionMinimaUnidades === null) {
      salvedades.push({
        clave: 'rotacion_sin_minimo',
        texto:
          `Vendió ${unidades} ${unidades === 1 ? 'unidad' : 'unidades'} en ${rotacion.ventanaDias} días, pero ` +
          'este cliente no tiene rotación mínima puesta, así que ese número no filtra nada. En FBA una ' +
          'referencia lenta paga almacenamiento cada mes.',
        degrada: false,
      })
    }
    return null
  }

  if (rotacion.estado === 'senal_bsr') {
    if (config.bsrMaximo !== null && rotacion.bsr !== null && rotacion.bsr > config.bsrMaximo) {
      return {
        motivo:
          `No hay datos de ventas de esta referencia. Su ranking en «${rotacion.bsrCategoria ?? 'su categoría'}» ` +
          `es ${rotacion.bsr.toLocaleString('es-ES')}, peor que el máximo que ha puesto este cliente ` +
          `(${config.bsrMaximo.toLocaleString('es-ES')}). OJO: EL RANKING ORDENA, NO MIDE — dice que se vende ` +
          'menos que otros productos de su categoría, no cuántas unidades. Es una señal, y por eso es un ' +
          'descarte revisable y no definitivo.',
        accion: 'Confirmar con ventas antes de descartar',
      }
    }
    salvedades.push({
      clave: 'rotacion_no_evaluable',
      texto:
        'NO HAY DATOS DE VENTAS de esta referencia: los roles concedidos no incluyen el informe de ' +
        'ventas y las unidades entran por CSV. Lo único que hay es el ranking' +
        (rotacion.bsr !== null ? ` (${rotacion.bsr.toLocaleString('es-ES')} en su categoría)` : '') +
        ', que ORDENA pero NO MIDE. Sin unidades no se puede saber si esta referencia rota lo bastante ' +
        'para pagar el almacenamiento de Amazon, y eso NO es lo mismo que decir que no rota.',
      degrada: true,
    })
    return null
  }

  salvedades.push({
    clave: 'rotacion_no_evaluable',
    texto:
      'NO SE SABE NADA de lo que vende esta referencia: ni unidades ni ranking. Los roles concedidos no ' +
      'incluyen el informe de ventas, así que las unidades entran por CSV. «Sin datos» NO es «no rota»: ' +
      'descartarla por esto sería tirar catálogo bueno porque nadie importó un fichero.',
    degrada: true,
  })
  return null
}

/* ------------------------------------------------------------------ */
/* Lo que falta por decidir                                            */
/* ------------------------------------------------------------------ */

/**
 * La lista de lo que no está configurado y hace falta.
 *
 * Va en cada análisis y se enseña en la pantalla. Que se vea que FALTA, no que
 * parezca decidido: un motor que calla lo que no sabe es indistinguible de uno
 * que lo sabe todo.
 */
export function faltaPorDecidir(
  // Un `Pick` y no la entrada entera: así la pantalla puede preguntar «¿qué le
  // falta a esta CUENTA?» sin inventarse un SKU, un precio y unas tarifas para
  // rellenar el hueco. Una entrada falsa fabricada para poder llamar a una
  // función es como se cuelan datos de mentira en una pantalla de verdad.
  entrada: Pick<EntradaAnalisis, 'config' | 'fiscal' | 'amazon'>
): string[] {
  const falta: string[] = []
  const { config } = entrada

  for (const linea of faltaFiscal(entrada.fiscal)) falta.push(linea)

  if (config.colchonMargenPct === null) {
    falta.push(
      'Colchón de margen mínimo en FBA: sin él el motor informa pero no recomienda. La especificación ' +
        'habla de un 10-12 %, pero el número lo pone el cliente.'
    )
  }
  if (config.mejoraMinimaPuntos === null) {
    falta.push(
      'Mejora mínima que justifica mover una referencia: sin ella se recomendaría migrar por una décima ' +
        'de punto, que no paga ni preparar el envío.'
    )
  }
  if (config.rotacionMinimaUnidades === null) {
    falta.push(
      'Rotación mínima: sin ella una referencia que vende dos unidades al año sale igual de candidata ' +
        'que una que vende doscientas, y en FBA la lenta paga almacenamiento cada mes.'
    )
  }
  if (config.bsrMaximo === null) {
    falta.push(
      'Ranking máximo con el que dar por buena una referencia sin datos de ventas: es lo único que ' +
        'queda cuando no hay unidades, y hoy no descarta a nadie.'
    )
  }
  if (entrada.amazon === 'indeterminado') {
    falta.push(
      'Identificadores de vendedor de Amazon Retail de este marketplace (se rellenan en el monitor de ' +
        'Buy Box): sin ellos no se puede saber si Amazon compite en el ASIN.'
    )
  }
  return falta
}

/* ------------------------------------------------------------------ */
/* Formato                                                             */
/* ------------------------------------------------------------------ */

/**
 * Los importes de los motivos se formatean AQUÍ y no en la pantalla.
 *
 * El motivo es un texto que se exporta y se le enseña al cliente: si el número
 * se pintara al enseñarlo, el texto exportado y el visto podrían divergir.
 */
function dinero(valor: number | null, moneda: string | null): string {
  if (valor === null || !Number.isFinite(valor)) return '—'
  const n = valor.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return moneda ? `${n} ${moneda}` : n
}

function pct(valor: number | null): string {
  if (valor === null || !Number.isFinite(valor)) return '—'
  return `${valor.toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`
}

function puntos(valor: number | null): string {
  if (valor === null || !Number.isFinite(valor)) return '—'
  const n = valor.toLocaleString('es-ES', { maximumFractionDigits: 1 })
  return `${valor > 0 ? '+' : ''}${n} puntos`
}

function textoSentido(sentido: SentidoFoep): string {
  if (sentido === 'ofensivo') return '(el precio al que Amazon prevé que la oferta sería la destacada)'
  if (sentido === 'defensivo') return '(el precio de hoy: la oferta destacada ya es nuestra)'
  if (sentido === 'sin_juicio') {
    return '(el menor entre el precio de hoy y el techo de Amazon; no se sabe de quién es la oferta destacada)'
  }
  return '(el precio de hoy)'
}

function textoRotacion(rotacion: Rotacion): string {
  if (rotacion.estado === 'medida') {
    const u = rotacion.unidades ?? 0
    return ` Vendió ${u} ${u === 1 ? 'unidad' : 'unidades'} en los últimos ${rotacion.ventanaDias} días.`
  }
  return ''
}

function horasDesde(iso: string | null, ahora: Date): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return Math.max(0, Math.round(((ahora.getTime() - t) / 3600000) * 10) / 10)
}

export { ROTACION_DESCONOCIDA, canalDeCoste }
