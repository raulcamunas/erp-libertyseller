/**
 * PLATAFORMA · MÓDULO A4 — TIPOS DEL ANÁLISIS FBM → FBA
 * =====================================================
 * Enumeraciones, filas y etiquetas. Sin React, sin Supabase y sin `fetch`: lo
 * importan el servidor, el navegador y el script de comprobación. Misma
 * separación que lib/plataforma/buybox/tipos.ts.
 *
 *
 * ============ LAS CUATRO COSAS QUE ESTE FICHERO EXISTE PARA IMPEDIR ============
 *
 * 1. QUE «NO SE SABE» SE CONVIERTA EN UN CERO. Ni el coste, ni el FOEP, ni la
 *    rotación, ni las tarifas. Este módulo recomienda meter inventario de un
 *    cliente en un almacén de Amazon, de donde sacarlo cuesta dinero: un cero
 *    optimista aquí se paga con mercancía muerta.
 *
 * 2. QUE SE CONFUNDA SFP CON FBM. Un cliente de la cartera entrega con Seller
 *    Fulfilled Prime. Migrar a FBA algo que YA llega con Prime es una decisión
 *    completamente distinta —lo que se gana es coste operativo, no visibilidad—
 *    y con el binario FBA/FBM esa diferencia desaparece.
 *
 * 3. QUE UN VEREDICTO ESCONDA UNA DUDA. Por eso un análisis tiene VEREDICTO y
 *    SALVEDADES por separado. «Candidato» y «candidato, pero no sabemos si
 *    Amazon vende en el ASIN» son dos cosas distintas y las dos tienen que
 *    caber sin inventar diez veredictos.
 *
 * 4. QUE ALGUIEN CREA QUE DESDE AQUÍ SE MANDA ALGO A AMAZON. NO SE PUEDE: crear
 *    un envío de entrada necesita el rol de Logística de Amazon, que la
 *    aplicación no tiene. A4 RECOMIENDA; ejecutar es cosa de una persona en
 *    Seller Central.
 */

/* ------------------------------------------------------------------ */
/* 1. El canal actual — TERNARIO, MÁS EL CASO QUE DE VERDAD PASA        */
/* ------------------------------------------------------------------ */

/**
 * Cómo sale hoy el paquete de este SKU.
 *
 * Los tres primeros son el ternario de siempre (ver lib/plataforma/buybox/tipos.ts).
 * El cuarto NO es un adorno y es el que más se va a ver:
 *
 *   propio_prime_desconocido -> SABEMOS que el paquete sale de nuestro almacén
 *                               y NO sabemos si lleva insignia Prime.
 *
 * Existe porque el espejo del catálogo se construye con el informe de listings,
 * y ahí el canal de logística dice 'DEFAULT' tanto para FBM como para Seller
 * Fulfilled Prime: NO HAY NINGÚN CAMPO QUE LOS DISTINGA. La única fuente que sí
 * los separa es la lectura de ofertas (`IsFulfilledByAmazon` + `IsPrime`), y esa
 * solo existe para los SKU que ya haya barrido el monitor de Buy Box.
 *
 * Colapsarlo a 'FBM' sería mentir sobre el dato más caro de esta pantalla;
 * colapsarlo a 'desconocido' tiraría la mitad de lo que sí sabemos —que no es
 * FBA, y por tanto que es candidato—. Así que es su propio estado.
 */
export type CanalA4 = 'FBA' | 'SFP' | 'FBM' | 'propio_prime_desconocido' | 'desconocido'

export const CANAL_A4_LABELS: Record<CanalA4, string> = {
  FBA: 'FBA (lo guarda y lo envía Amazon)',
  SFP: 'Prime del vendedor (SFP)',
  FBM: 'Lo envía el cliente, sin Prime',
  propio_prime_desconocido: 'Lo envía el cliente (no sabemos si con Prime)',
  desconocido: 'Sin dato del canal',
}

export const CANAL_A4_CORTO: Record<CanalA4, string> = {
  FBA: 'FBA',
  SFP: 'SFP',
  FBM: 'FBM',
  propio_prime_desconocido: 'Propio',
  desconocido: '—',
}

/** ¿El paquete sale hoy del almacén del cliente? Los tres casos «propios» */
export function esCanalPropio(canal: CanalA4): boolean {
  return canal === 'FBM' || canal === 'SFP' || canal === 'propio_prime_desconocido'
}

/** El canal a efectos de COSTE: FBA o propio. Lo que entiende A5 */
export function canalDeCoste(canal: CanalA4): 'fba' | 'propio' {
  return canal === 'FBA' ? 'fba' : 'propio'
}

/* ------------------------------------------------------------------ */
/* 2. Las medidas: de dónde salen y cuánto valen                       */
/* ------------------------------------------------------------------ */

/**
 * DE DÓNDE SALEN LAS DIMENSIONES DE ESTE SKU, que es la regla 4 del §3.5.
 *
 * La tarifa de FBA se calcula sobre el EMBALAJE: el tramo de tamaño y de peso
 * decide el importe, y un salto de tramo son céntimos o son euros. Y no existe
 * en toda la SP-API ningún campo que diga «esta medida la comprobó Amazon» frente
 * a «esta la escribió el vendedor»: se ha buscado y no está. Así que la
 * procedencia HAY QUE DERIVARLA, y es lo que hace esta escala.
 *
 *   fee_preview  -> ALTA. Existe una estimación de tarifa que ha salido del
 *                   informe Fee Preview de Amazon, que solo cubre SKU QUE YA
 *                   ESTÁN EN FBA con oferta activa. Es la única evidencia de que
 *                   el producto ha pasado por un centro logístico.
 *   catalogo     -> MEDIA. Vienen del catálogo de Amazon (Catalog Items). Es el
 *                   dato del que Amazon parte para estimar, pero el que lo puso
 *                   en la ficha fue un vendedor.
 *   manual       -> MEDIA. Las ha medido alguien de la agencia y consta.
 *   estimado     -> BAJA. Alguien las puso a ojo.
 *   ausente      -> NINGUNA. No hay medidas. Que no es lo mismo que cero.
 *
 * LO IMPORTANTE, Y ES CONTRAINTUITIVO: el caso fiable solo se da en SKU que YA
 * ESTÁN EN FBA, o sea justo los que este análisis no tiene que evaluar. Para un
 * SKU que hoy envía el cliente, la mejor procedencia posible es «catálogo». Por
 * eso la tarifa de FBA de un candidato es SIEMPRE una estimación sobre medidas
 * declaradas, y por eso se dice en la fila en vez de darlo por bueno.
 */
export type ProcedenciaDims = 'fee_preview' | 'catalogo' | 'manual' | 'estimado' | 'ausente'

export type ConfianzaDims = 'alta' | 'media' | 'baja' | 'ninguna'

export const PROCEDENCIA_DIMS_LABELS: Record<ProcedenciaDims, string> = {
  fee_preview: 'Amazon las ha usado para cobrar (Fee Preview)',
  catalogo: 'Del catálogo de Amazon',
  manual: 'Medidas por nosotros',
  estimado: 'Estimadas a ojo',
  ausente: 'No hay medidas',
}

export const CONFIANZA_DIMS: Record<ProcedenciaDims, ConfianzaDims> = {
  fee_preview: 'alta',
  catalogo: 'media',
  manual: 'media',
  estimado: 'baja',
  ausente: 'ninguna',
}

/**
 * De la columna `dims_origen` del espejo a la escala de arriba.
 *
 * `dims_origen` la escribe el trabajo de atributos con tres valores —'amazon',
 * 'manual', 'estimado'— y ese 'amazon' significa «vino del catálogo», NO «lo
 * certificó Amazon». Traducirlo a `catalogo` en vez de a `fee_preview` es toda
 * la corrección: eran indistinguibles y no lo son.
 */
export function procedenciaDeDims(
  dimsOrigen: string | null,
  hayFeePreview: boolean,
  hayMedidas: boolean
): ProcedenciaDims {
  if (hayFeePreview) return 'fee_preview'
  if (!hayMedidas) return 'ausente'
  if (dimsOrigen === 'amazon') return 'catalogo'
  if (dimsOrigen === 'manual') return 'manual'
  if (dimsOrigen === 'estimado') return 'estimado'
  // Hay medidas y nadie apuntó de dónde salieron. No se premia el descuido.
  return 'estimado'
}

/* ------------------------------------------------------------------ */
/* 3. La rotación — TERNARIA, y el «no evaluable» es el caso normal     */
/* ------------------------------------------------------------------ */

/**
 * Cuánto se vende esta referencia.
 *
 * ============ POR QUÉ ESTO NO PUEDE SER UN NÚMERO A SECAS ============
 *
 * La regla 2 del §3.5 pide una rotación mínima, y para eso hace falta saber
 * cuántas unidades se venden. NO TENEMOS ESE DATO con los roles concedidos:
 * Orders API no está y GET_SALES_AND_TRAFFIC_REPORT necesita el rol de Análisis
 * de marcas, que está pedido y pendiente. Hoy las ventas entran por CSV, y un
 * CSV cubre lo que cubre.
 *
 * Así que:
 *   medida        -> hay unidades de verdad, de un fichero de ventas.
 *   senal_bsr     -> no hay unidades, pero sí ranking. El BSR ORDENA, NO MIDE:
 *                    dice que un producto se vende más que otro, no cuántos. Se
 *                    usa como señal y se dice que es una señal.
 *   no_evaluable  -> ni ventas ni ranking. Y ENTONCES NO ES «NO ROTA»: es que no
 *                    lo sabemos. Descartar por esto sería tirar catálogo bueno
 *                    porque nadie importó un fichero.
 */
export type EstadoRotacion = 'medida' | 'senal_bsr' | 'no_evaluable'

export const ROTACION_LABELS: Record<EstadoRotacion, string> = {
  medida: 'Unidades vendidas',
  senal_bsr: 'Solo señal de ranking',
  no_evaluable: 'Sin datos de venta',
}

export interface Rotacion {
  estado: EstadoRotacion
  /** Unidades en la ventana. null salvo en `medida` */
  unidades: number | null
  /** Cuántos días cubre la ventana mirada */
  ventanaDias: number
  /** De cuántos días distintos hay dato. Distingue «3 en 30 días» de «3 el único día que hay» */
  diasConDato: number
  /** El mejor ranking conocido del SKU (menor es mejor). null = no hay */
  bsr: number | null
  bsrCategoria: string | null
  bsrLeidoAt: string | null
}

export const ROTACION_DESCONOCIDA: Rotacion = {
  estado: 'no_evaluable',
  unidades: null,
  ventanaDias: 0,
  diasConDato: 0,
  bsr: null,
  bsrCategoria: null,
  bsrLeidoAt: null,
}

/* ------------------------------------------------------------------ */
/* 4. El sentido del FOEP — LOS DOS, SIEMPRE DICHOS                     */
/* ------------------------------------------------------------------ */

/**
 * QUÉ SIGNIFICA EL FOEP EN ESTA FILA.
 *
 * El FOEP es el precio de listing MÁXIMO al que Amazon prevé que nuestra oferta
 * esté destacada. ES UN TECHO, y significa dos cosas OPUESTAS según quién tenga
 * hoy la oferta destacada:
 *
 *   ofensivo  -> NO la tenemos. Es el techo AL QUE HABRÍA QUE BAJAR para
 *                conquistarla. Para este módulo es el precio realista con el que
 *                hay que calcular el margen: es a lo que habría que vender.
 *   defensivo -> SÍ la tenemos. Es el techo hasta el que se podría SUBIR sin
 *                perderla, y normalmente está POR ENCIMA del precio actual.
 *                CALCULAR EL MARGEN AHÍ ES INFLARLO: sería contar un ingreso que
 *                nadie ha decidido cobrar.
 *   sin_dato  -> Amazon no lo ha dado, o no se le ha preguntado en esta ronda.
 *
 * No hay ningún campo de la API que distinga ofensivo de defensivo: sale de
 * comparar el vendedor de la oferta destacada con el nuestro, y eso llega ya
 * resuelto desde el monitor de Buy Box.
 */
/**
 * QUÉ SIGNIFICA EL TECHO EN ESTA FILA.
 *
 * Son CUATRO y no tres porque el estado de la oferta destacada son cuatro
 * (`EstadoBuyBox`), y colapsar «no se sabe» dentro de «no la tenemos» es
 * afirmar como hecho algo que nunca se comprobó. `buybox_estado` es NOT NULL
 * DEFAULT 'desconocido', y el FOEP sale del mismo diagnóstico, así que una fila
 * con techo leído y ganador indeterminado es un estado NORMAL, no un raro.
 *
 * Con `desconocido` metido en `ofensivo`, la pantalla pintaba flecha hacia abajo
 * y decía «la oferta destacada no es nuestra: este número es el techo AL QUE
 * HABRÍA QUE BAJAR» sobre una competencia que no se había mirado. Es exactamente
 * la recomendación de recortar precio a ciegas contra la que avisa la
 * investigación de la SP-API.
 *
 * `nadie` SÍ se queda en `ofensivo`: si la oferta destacada no la tiene nadie,
 * «no la tenemos» es cierto y el techo es el precio al que se conquistaría.
 */
export type SentidoFoep = 'ofensivo' | 'defensivo' | 'sin_juicio' | 'sin_dato'

export const SENTIDO_FOEP_LABELS: Record<SentidoFoep, string> = {
  ofensivo: 'Techo al que habría que bajar (no tenemos la oferta destacada)',
  defensivo: 'Techo hasta el que se podría subir (ya la tenemos)',
  sin_juicio: 'Techo leído, pero no se sabe de quién es la oferta destacada',
  sin_dato: 'Sin precio de referencia',
}

/* ------------------------------------------------------------------ */
/* 5. Los veredictos                                                    */
/* ------------------------------------------------------------------ */

/**
 * DIEZ VEREDICTOS Y NI UNO MÁS. Las dudas van en `salvedades`.
 *
 * La tentación es hacer un veredicto por combinación —«candidato pero sin
 * ranking», «candidato pero Amazon indeterminado»— y acabar con cuarenta
 * etiquetas que nadie distingue. Aquí el veredicto contesta UNA pregunta —¿qué
 * hago con esta referencia?— y todo lo demás viaja al lado.
 */
export type VeredictoA4 =
  /** Nunca se ha leído nada de este SKU */
  | 'sin_datos'
  /** Ya está en FBA: aquí no hay migración que evaluar */
  | 'ya_en_fba'
  /** No se sabe por dónde sale hoy el paquete, así que no se sabe ni de dónde parte */
  | 'canal_desconocido'
  /** Falta un dato para poder calcular (coste, tarifas, impuesto, precio) */
  | 'no_evaluable'
  /** Amazon vende en el ASIN, CONFIRMADO con la lista de identificadores */
  | 'descartado_amazon'
  /** Rota por debajo del mínimo que ha puesto el cliente */
  | 'sin_rotacion'
  /** Los dos márgenes se conocen, pero no hay umbral con el que decidir */
  | 'informa_sin_umbral'
  /** FBA no mejora lo suficiente, o no deja colchón */
  | 'no_compensa'
  /** Todo apunta a que sí, pero hay una duda que hay que mirar antes */
  | 'revisar'
  /** Candidato limpio */
  | 'candidato'

export const VEREDICTO_A4_LABELS: Record<VeredictoA4, string> = {
  sin_datos: 'Sin datos',
  ya_en_fba: 'Ya está en FBA',
  canal_desconocido: 'Canal desconocido',
  no_evaluable: 'No evaluable',
  descartado_amazon: 'Descartado: Amazon vende aquí',
  sin_rotacion: 'No rota lo suficiente',
  informa_sin_umbral: 'Falta criterio',
  no_compensa: 'No compensa',
  revisar: 'Revisar antes de decidir',
  candidato: 'Candidato a FBA',
}

/** Todos, en el orden en el que se enseñan y se filtran */
export const VEREDICTOS_A4: VeredictoA4[] = [
  'candidato',
  'revisar',
  'informa_sin_umbral',
  'no_compensa',
  'sin_rotacion',
  'no_evaluable',
  'descartado_amazon',
  'canal_desconocido',
  'ya_en_fba',
  'sin_datos',
]

export const VEREDICTO_A4_TONO: Record<
  VeredictoA4,
  'verde' | 'ambar' | 'rojo' | 'gris' | 'azul' | 'violeta'
> = {
  candidato: 'verde',
  revisar: 'ambar',
  informa_sin_umbral: 'azul',
  no_compensa: 'rojo',
  sin_rotacion: 'rojo',
  no_evaluable: 'gris',
  descartado_amazon: 'violeta',
  canal_desconocido: 'gris',
  ya_en_fba: 'gris',
  sin_datos: 'gris',
}

/** Menor va antes en el listado: primero lo accionable */
export const PRIORIDAD_VEREDICTO: Record<VeredictoA4, number> = {
  candidato: 10,
  revisar: 20,
  informa_sin_umbral: 30,
  no_compensa: 50,
  sin_rotacion: 55,
  no_evaluable: 70,
  descartado_amazon: 80,
  canal_desconocido: 85,
  ya_en_fba: 90,
  sin_datos: 95,
}

/* ------------------------------------------------------------------ */
/* 6. Las salvedades                                                    */
/* ------------------------------------------------------------------ */

/**
 * Una duda que acompaña al veredicto sin sustituirlo.
 *
 * `degrada` es lo que convierte un `candidato` en un `revisar`. Va como campo y
 * no como una lista aparte porque quien lea la fila tiene que ver EN LA MISMA
 * LÍNEA la duda y si esa duda es de las que frenan.
 */
export interface Salvedad {
  clave:
    | 'amazon_indeterminado'
    | 'sin_foep'
    | 'foep_defensivo'
    /** Hay techo, pero no se sabe de quién es la oferta destacada */
    | 'foep_sin_juicio'
    | 'foep_viejo'
    | 'dimensiones'
    | 'rotacion_no_evaluable'
    | 'rotacion_sin_minimo'
    | 'sfp'
    | 'tarifa_otro_precio'
    | 'coste_incompleto'
    | 'fuera_de_seguimiento'
  texto: string
  /** ¿Impide dar un «candidato» limpio? */
  degrada: boolean
}

/* ------------------------------------------------------------------ */
/* 7. La configuración del cliente                                      */
/* ------------------------------------------------------------------ */

/**
 * LOS UMBRALES. TODOS DEL CLIENTE, NINGUNO DEL PROGRAMA.
 *
 * La especificación es literal: «los umbrales, los costes, las reglas de margen
 * y las excepciones por cliente las pongo yo». Así que aquí todo lo de negocio
 * nace en `null` y `null` significa NO RECOMENDAR, nunca «usa un valor
 * razonable». Un número razonable inventado es indistinguible de uno decidido, y
 * este motor propone meter mercancía ajena en un almacén del que sacarla cuesta
 * dinero.
 *
 * Lo único con número por defecto es TÉCNICO y está marcado como tal.
 */
export interface ConfigFbmFba {
  clientId: string
  id: string | null

  /**
   * REGLA 1 — EL COLCHÓN. Margen mínimo (%) que tiene que quedar en FBA para
   * recomendar la migración.
   *
   * No es lo mismo que «que dé más margen que hoy»: un SKU puede mejorar y aun
   * así quedarse en un 2 %, y un 2 % vendiendo al techo de Amazon significa que
   * en cuanto un competidor baje un céntimo hay inventario muerto en un almacén
   * de Amazon. La especificación habla de un 10-12 %; ese número lo pone el
   * cliente, no el programa. null = NO SE RECOMIENDA NADA.
   */
  colchonMargenPct: number | null

  /**
   * REGLA 1 (continuación) — cuánto tiene que MEJORAR el margen para que mover
   * la referencia merezca el trabajo. En puntos porcentuales.
   *
   * null = no se recomienda. Con 0 se recomendaría por una décima de mejora, que
   * no paga ni el tiempo de preparar el envío.
   */
  mejoraMinimaPuntos: number | null

  /** REGLA 2 — unidades mínimas en la ventana. null = la rotación no filtra */
  rotacionMinimaUnidades: number | null
  /** La ventana de la regla 2, en días. TÉCNICO: 30 días es el mes natural */
  rotacionVentanaDias: number

  /**
   * REGLA 2 (señal) — ranking a partir del cual se considera que NO rota, cuando
   * no hay ventas. null = el ranking no descarta a nadie, solo informa.
   *
   * Un BSR ORDENA, NO MIDE: no dice cuántas unidades se venden y no es
   * comparable entre categorías. Por eso su umbral es aparte del de unidades y
   * por eso el motivo dice siempre que es una señal.
   */
  bsrMaximo: number | null

  /** REGLA 4 — ¿frenar los SKU cuyas medidas no son de fiar? */
  exigirDimensionesFiables: boolean

  /**
   * TÉCNICO, no de negocio: cuánto puede alejarse el precio al que se pidió una
   * tarifa del precio que se está evaluando para seguir sirviendo, en tanto por
   * ciento.
   *
   * Las tarifas de Amazon se piden A UN PRECIO CONCRETO y la comisión de
   * referencia es un porcentaje con mínimos: aplicar la de 30 € a una evaluación
   * a 18 € es inventarse la cifra. Con 1 % se admite el ruido del redondeo y
   * nada más.
   */
  toleranciaTarifaPct: number

  notas: string | null
  updatedAt: string | null
}

/**
 * Los valores de arranque. TODO LO DE NEGOCIO A `null`.
 *
 * `rotacionVentanaDias` y `toleranciaTarifaPct` sí llevan número porque no son
 * decisiones de negocio: una es la unidad natural en la que se habla de ventas y
 * la otra es el ruido admisible de un redondeo.
 */
export const CONFIG_A4_DEFECTO: Omit<ConfigFbmFba, 'clientId'> = {
  id: null,
  colchonMargenPct: null,
  mejoraMinimaPuntos: null,
  rotacionMinimaUnidades: null,
  rotacionVentanaDias: 30,
  bsrMaximo: null,
  exigirDimensionesFiables: true,
  toleranciaTarifaPct: 1,
  notas: null,
  updatedAt: null,
}

/**
 * Lo que la ESPECIFICACIÓN propone para el colchón, para que rellenarlo sea un
 * clic y no una búsqueda.
 *
 * NO ES UN VALOR POR DEFECTO y el motor no lo consulta: lo enseña la pantalla al
 * lado del campo vacío. La diferencia importa — un número que se aplica solo es
 * indistinguible de uno decidido; uno que hay que guardar tiene dueño y fecha.
 */
export const COLCHON_SUGERIDO = { min: 10, max: 12 }

/* ------------------------------------------------------------------ */
/* 8. Etiquetas para los avisos                                         */
/* ------------------------------------------------------------------ */

export const FALTAN_MIGRACIONES_A4 =
  'Faltan las tablas del análisis FBM → FBA: lanza 131_plataforma_a4_fbm_fba.sql y después ' +
  '132_plataforma_a4_pantalla.sql en el editor SQL de Supabase, en ese orden. La 129 trae los ' +
  'umbrales del cliente y los parámetros de impuesto por marketplace —sin el impuesto no hay ' +
  'margen que calcular—; la 130 trae plataforma_fbmfba_datos, que es de donde lee esta pantalla. ' +
  'Las dos leen amazon_buybox_diagnostico, así que 130_plataforma_a2_buybox.sql va antes.'
