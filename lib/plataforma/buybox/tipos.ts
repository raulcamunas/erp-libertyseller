/**
 * PLATAFORMA · MÓDULO A2 — TIPOS DEL MONITOR DE BUY BOX
 * =====================================================
 * Enumeraciones, filas y etiquetas. Sin React, sin Supabase, sin `fetch`: lo
 * puede importar el servidor, el navegador y una prueba suelta. Misma separación
 * que lib/plataforma/tipos.ts.
 *
 *
 * ============ LAS CUATRO COSAS QUE ESTE FICHERO EXISTE PARA IMPEDIR ============
 *
 * 1. QUE «NO SE SABE» SE CONVIERTA EN UN CERO O EN UN FALSE. Los cuatro estados
 *    de aquí abajo —Buy Box, canal, Amazon Retail y FOEP— son ternarios o
 *    cuaternarios A PROPÓSITO. Un `boolean` obliga a elegir entre «no» y «no lo
 *    sé», y en este módulo esa elección se paga en dinero: un SKU descartado por
 *    error es una venta perdida y uno recomendado por error es inventario muerto
 *    en un almacén de Amazon.
 *
 * 2. QUE SE CONFUNDA SFP CON FBM (`CanalOferta`). Un cliente de la cartera tiene
 *    Seller Fulfilled Prime en parte del catálogo. Con el binario FBA/FBM, una
 *    oferta SFP se lee como FBM y el diagnóstico de «por qué pierdo la Buy Box»
 *    sale al revés: se recomienda migrar a FBA algo que ya entrega con Prime.
 *
 * 3. QUE SE MEZCLE UN PRECIO CON ENVÍO CON UNO SIN ENVÍO. El FOEP es PRECIO DE
 *    LISTING, sin envío. La competencia, en la misma respuesta, trae las dos
 *    cosas. Por eso cada importe de este módulo lleva en su nombre si es de
 *    listing o «puesto en casa» (`landed`), y no hay ni un campo llamado
 *    «precio» a secas.
 *
 * 4. QUE ALGUIEN DÉ POR CERRADO UN ENUM DE AMAZON. `resultStatus`, el `status`
 *    de Pricing v0 y los códigos de canal NO están documentados como cerrados.
 *    Los tipos de aquí que vienen de Amazon se guardan como TEXTO CRUDO además
 *    de traducidos, y la traducción tiene rama por defecto.
 */

/* ------------------------------------------------------------------ */
/* 1. Canal de logística — TERNARIO                                     */
/* ------------------------------------------------------------------ */

/**
 * Cómo entrega una oferta.
 *
 *   FBA         -> lo envía Amazon desde sus centros.
 *   SFP         -> Seller Fulfilled Prime: lo envía el vendedor CON insignia
 *                  Prime. Compite de tú a tú con FBA y NO es FBM.
 *   FBM         -> lo envía el vendedor, sin Prime.
 *   desconocido -> Amazon no ha dicho el canal en esa respuesta. No es FBM.
 *
 * Se deduce, en este orden y no en otro:
 *   IsFulfilledByAmazon === true                      -> FBA
 *   IsFulfilledByAmazon === false && IsPrime === true  -> SFP
 *   IsFulfilledByAmazon === false                      -> FBM
 *   IsFulfilledByAmazon ausente                        -> desconocido
 *
 * OJO CON LA TENTACIÓN DE USAR IsFulfilledByAmazon PARA DETECTAR A AMAZON: eso
 * significa FBA, no Amazon. Un tercero con FBA también lo devuelve. Ver
 * EstadoAmazonRetail.
 */
export type CanalOferta = 'FBA' | 'SFP' | 'FBM' | 'desconocido'

export const CANAL_LABELS: Record<CanalOferta, string> = {
  FBA: 'FBA (lo envía Amazon)',
  SFP: 'Prime del vendedor (SFP)',
  FBM: 'Lo envía el vendedor',
  desconocido: 'Canal desconocido',
}

export const CANAL_CORTO: Record<CanalOferta, string> = {
  FBA: 'FBA',
  SFP: 'SFP',
  FBM: 'FBM',
  desconocido: '—',
}

/** Los canales que compiten con insignia Prime. SFP cuenta; FBM no */
export function esPrime(canal: CanalOferta): boolean {
  return canal === 'FBA' || canal === 'SFP'
}

/* ------------------------------------------------------------------ */
/* 2. Quién tiene la oferta destacada — CUATERNARIO                     */
/* ------------------------------------------------------------------ */

/**
 *   nuestra     -> la oferta destacada es la nuestra.
 *   de_otro     -> la tiene otro vendedor.
 *   nadie       -> Amazon no está destacando ninguna oferta en ese ASIN.
 *   desconocido -> no se pudo leer. NUNCA se colapsa a `de_otro`.
 *
 * La diferencia entre `nadie` y `de_otro` no es cosmética: son dos diagnósticos
 * distintos con dos acciones distintas, y la especificación los separa (§3.3).
 * Y `desconocido` existe porque un fallo de lectura que se cuente como «la hemos
 * perdido» dispara una alerta falsa y mueve el porcentaje del cliente.
 */
export type EstadoBuyBox = 'nuestra' | 'de_otro' | 'nadie' | 'desconocido'

export const BUYBOX_LABELS: Record<EstadoBuyBox, string> = {
  nuestra: 'La tenemos',
  de_otro: 'La tiene otro',
  nadie: 'No la tiene nadie',
  desconocido: 'Sin dato',
}

/* ------------------------------------------------------------------ */
/* 3. Amazon Retail en el ASIN — TERNARIO OBLIGATORIO                   */
/* ------------------------------------------------------------------ */

/**
 * ¿Está Amazon vendiendo en este ASIN?
 *
 * ============ POR QUÉ ESTO NO PUEDE SER UN BOOLEANO ============
 *
 * La especificación pide (§3.5, regla 3) «Amazon retail en el ASIN → descartado
 * automático» y lo trata como un booleano. NO SE PUEDE con los roles que
 * tenemos, y darlo por booleano es la clase de error que descarta catálogo
 * bueno sin que nadie lo revise:
 *
 *   · `IsFulfilledByAmazon: true` significa FBA, NO Amazon. Un tercero con FBA
 *     devuelve exactamente lo mismo.
 *   · La lista de identificadores de vendedor de Amazon Retail NO está
 *     publicada.
 *   · `getCompetitiveSummary.referencePrices.retailOfferPrice` aparece definido
 *     en la FAQ de Pricing pero NO está en la tabla de campos de esa operación,
 *     y que llegue de verdad está sin verificar.
 *
 * Así que:
 *   si            -> uno de los vendedores del ASIN está en la lista de
 *                    identificadores de Amazon Retail que se haya configurado a
 *                    mano para ese marketplace. Es el único «sí» honesto.
 *   no            -> no hay NINGUNA oferta ajena en el ASIN. Si no vende nadie
 *                    más, tampoco vende Amazon. Es el único «no» honesto.
 *   indeterminado -> hay competencia y no se puede saber si alguno es Amazon.
 *                    Es el caso NORMAL, y se enseña como tal.
 */
export type EstadoAmazonRetail = 'si' | 'no' | 'indeterminado'

export const AMAZON_RETAIL_LABELS: Record<EstadoAmazonRetail, string> = {
  si: 'Amazon vende en este ASIN',
  no: 'Amazon no vende en este ASIN',
  indeterminado: 'No se puede saber si Amazon vende aquí',
}

export const AMAZON_RETAIL_AYUDA =
  'Amazon no publica ningún campo que identifique su propia oferta, y la marca de FBA no sirve: ' +
  'un tercero que envía por FBA devuelve exactamente lo mismo. Solo se puede afirmar que Amazon ' +
  'está en un ASIN si uno de los identificadores de vendedor que salen en las ofertas está en la ' +
  'lista que se haya rellenado a mano. Todo lo demás es «no se puede saber», y se enseña así en ' +
  'vez de darlo por «no».'

/* ------------------------------------------------------------------ */
/* 4. El FOEP                                                           */
/* ------------------------------------------------------------------ */

/**
 * QUÉ ES EL FOEP, Y POR QUÉ ESTA DEFINICIÓN ESTÁ AQUÍ Y NO EN UN COMENTARIO
 * SUELTO.
 *
 * Definición literal de Amazon: «A computed listing price at or below which a
 * seller can expect to become the featured offer (before applicable
 * promotions)».
 *
 * O sea: EL PRECIO DE LISTING MÁXIMO al que Amazon prevé que NUESTRA oferta esté
 * destacada. Es un TECHO, no un objetivo. Ver el comentario grande de
 * diagnostico.ts, que es donde se usa.
 *
 *   disponible    -> Amazon ha dado un número.
 *   no_disponible -> Amazon ha contestado y NO ha dado número (no hay
 *                    competencia, la oferta no es elegible, el ASIN no
 *                    corresponde...). El motivo crudo va en `foep_resultado`.
 *   no_consultado -> no se le ha preguntado en esta lectura. NO es lo mismo:
 *                    con la rotación semanal, la mayoría de los SKU de una noche
 *                    están en este estado y no en el anterior.
 *
 * Ninguno de los tres es un cero. El CHECK amazon_snapshots_precio_foep_ok de la
 * migración 123 lo remata: importe y estado tienen que cuadrar o la base rechaza
 * la fila.
 */
export type EstadoFoepA2 = 'disponible' | 'no_disponible' | 'no_consultado'

export const FOEP_LABELS: Record<EstadoFoepA2, string> = {
  disponible: 'Amazon da precio',
  no_disponible: 'Amazon no da precio',
  no_consultado: 'No preguntado en esta lectura',
}

/**
 * Los `resultStatus` que hemos visto documentados.
 *
 * LA LISTA NO ES CERRADA y por eso el tipo es `string`. Amazon puede añadir
 * valores sin avisar, y una traducción sin rama por defecto convertiría un valor
 * nuevo en `undefined` y de ahí, con un `?? 0`, en un cero. La constante existe
 * solo para traducir a español lo que sí conocemos.
 *
 * Las DOS GRAFÍAS de «no hay competencia» están las dos a propósito: la
 * documentación de Amazon usa las dos y no dice cuál manda.
 */
export const FOEP_RESULTADO_LABELS: Record<string, string> = {
  VALID_FOEP: 'Amazon ha calculado el precio',
  NO_COMPETING_OFFER: 'No hay ninguna oferta compitiendo por la destacada',
  NO_COMPETING_OFFERS: 'No hay ninguna oferta compitiendo por la destacada',
  OFFER_NOT_ELIGIBLE: 'Esta oferta no es elegible para la oferta destacada',
  FEATURED_OFFER_NOT_AVAILABLE: 'Ahora mismo no hay oferta destacada en este ASIN',
  ASIN_NOT_ELIGIBLE: 'Este ASIN no es elegible para oferta destacada',
  ASIN_NOT_FOUND: 'Amazon no encuentra este ASIN',
  OFFER_NOT_FOUND: 'Amazon no encuentra esta oferta nuestra',
}

/** La frase para un resultado, incluida la rama por defecto */
export function textoResultadoFoep(resultado: string | null): string {
  if (!resultado) return 'Amazon no ha dicho por qué'
  return (
    FOEP_RESULTADO_LABELS[resultado] ??
    `Amazon ha devuelto un estado que no conocíamos («${resultado}»). Se trata como «sin dato», nunca como cero.`
  )
}

/* ------------------------------------------------------------------ */
/* 5. Existencias, tal y como las ve A2                                 */
/* ------------------------------------------------------------------ */

/**
 * El stock que usa el diagnóstico, con su estado.
 *
 * Se apoya en los tres estados que ya distingue A1 (`amazon_snapshots_inventario.estado_dato`)
 * y por el mismo motivo: FBA Inventory OMITE EN SILENCIO los SKU que gestiona el
 * vendedor, así que «no vino en la respuesta» NO es «stock 0». Con dos estados,
 * el 90 % del catálogo de un cliente mayoritariamente FBM se diagnosticaría
 * «Sin stock → Reponer» con el almacén lleno.
 */
export interface EstadoStock {
  /**
   *   conocido    -> `unidades` es de verdad.
   *   no_aplica   -> es un SKU de FBM: Amazon no tiene existencias suyas y eso
   *                  no es cero. `unidades` es entonces el stock del propio
   *                  listing, si se sabe.
   *   desconocido -> no se ha podido leer. TAMPOCO es cero.
   */
  estado: 'conocido' | 'no_aplica' | 'desconocido'
  unidades: number | null
  /** Cuándo se leyó. Un stock de hace una semana no decide una reposición */
  leidoAt: string | null
}

export const STOCK_DESCONOCIDO: EstadoStock = {
  estado: 'desconocido',
  unidades: null,
  leidoAt: null,
}

/* ------------------------------------------------------------------ */
/* 6. Los veredictos                                                    */
/* ------------------------------------------------------------------ */

/**
 * LA TABLA DE DIAGNÓSTICO, REESCRITA.
 *
 * La de la especificación (§3.3) está mal en una fila y esa fila es la más cara
 * del proyecto. El razonamiento entero está en diagnostico.ts; aquí solo va la
 * lista, agrupada por el primer corte, que es «¿la tenemos o no?».
 */
export type Veredicto =
  /* ---- No se puede diagnosticar ---- */
  /** Nunca se ha leído este SKU, o la lectura falló */
  | 'sin_datos'
  /** Nuestra oferta no aparece en el ASIN: listing suprimido, inactivo o sin elegibilidad */
  | 'sin_oferta_propia'

  /* ---- La tenemos: el FOEP es DEFENSIVO ---- */
  /** La tenemos y el techo de Amazon está POR ENCIMA del precio: hay margen para subir */
  | 'con_buybox_margen_arriba'
  /** La tenemos y el techo coincide con el precio: cualquier subida la pierde */
  | 'con_buybox_al_limite'
  /** La tenemos pero el techo sale por DEBAJO del precio actual. Dato raro, se vigila */
  | 'con_buybox_incoherente'
  /** La tenemos y no hay FOEP: no se puede decir cuánta holgura hay */
  | 'con_buybox_sin_foep'

  /* ---- No la tenemos ---- */
  /** Amazon vende en el ASIN (confirmado, no supuesto) */
  | 'no_competible'
  /** Sin existencias. El precio no es el problema */
  | 'sin_stock'
  /** Nadie tiene la oferta destacada en este ASIN */
  | 'nadie_la_tiene'
  /** No la tenemos y no hay FOEP con el que decidir */
  | 'sin_foep'
  /** El techo está por ENCIMA de nuestro precio y aun así no la tenemos */
  | 'deberiamos_tenerla'
  /** Bajando a X se recupera, y el margen aguanta */
  | 'recuperable_bajando'
  /** Bajando a X se recupera, pero no sabemos si compensa: falta coste o umbral */
  | 'bajable_sin_criterio'
  /** No compensa bajar, y el ganador entrega mejor que nosotros */
  | 'problema_logistico'
  /** No compensa bajar y el ganador entrega igual que nosotros */
  | 'no_recuperable'

export const VEREDICTO_LABELS: Record<Veredicto, string> = {
  sin_datos: 'Sin datos',
  sin_oferta_propia: 'Nuestra oferta no está',
  con_buybox_margen_arriba: 'Con Buy Box y margen para subir',
  con_buybox_al_limite: 'Con Buy Box, al límite',
  con_buybox_incoherente: 'Con Buy Box, dato incoherente',
  con_buybox_sin_foep: 'Con Buy Box, sin techo conocido',
  no_competible: 'No competible',
  sin_stock: 'Sin stock',
  nadie_la_tiene: 'Nadie la tiene',
  sin_foep: 'Sin FOEP',
  deberiamos_tenerla: 'Deberíamos tenerla ya',
  recuperable_bajando: 'Recuperable bajando precio',
  bajable_sin_criterio: 'Recuperable, falta criterio',
  problema_logistico: 'Problema logístico, no de precio',
  no_recuperable: 'No recuperable',
}

/** Todos, en el orden en el que se enseñan */
export const VEREDICTOS: Veredicto[] = [
  'recuperable_bajando',
  'bajable_sin_criterio',
  'deberiamos_tenerla',
  'problema_logistico',
  'no_recuperable',
  'sin_stock',
  'nadie_la_tiene',
  'no_competible',
  'sin_oferta_propia',
  'sin_foep',
  'con_buybox_al_limite',
  'con_buybox_incoherente',
  'con_buybox_margen_arriba',
  'con_buybox_sin_foep',
  'sin_datos',
]

/** Los que significan «la tenemos». Es lo que cuenta para el porcentaje */
export const VEREDICTOS_CON_BUYBOX: Veredicto[] = [
  'con_buybox_margen_arriba',
  'con_buybox_al_limite',
  'con_buybox_incoherente',
  'con_buybox_sin_foep',
]

export function tieneBuyBox(veredicto: Veredicto): boolean {
  return VEREDICTOS_CON_BUYBOX.includes(veredicto)
}

/** Los que no se pueden ni juzgar. NO cuentan como «perdida» */
export const VEREDICTOS_SIN_JUICIO: Veredicto[] = ['sin_datos']

/** El tono con el que se pinta cada veredicto. Un solo mapa, no nueve */
export const VEREDICTO_TONO: Record<Veredicto, 'verde' | 'ambar' | 'rojo' | 'gris' | 'azul' | 'violeta'> = {
  sin_datos: 'gris',
  sin_oferta_propia: 'rojo',
  con_buybox_margen_arriba: 'verde',
  con_buybox_al_limite: 'verde',
  con_buybox_incoherente: 'ambar',
  con_buybox_sin_foep: 'verde',
  no_competible: 'gris',
  sin_stock: 'rojo',
  nadie_la_tiene: 'violeta',
  sin_foep: 'gris',
  deberiamos_tenerla: 'ambar',
  recuperable_bajando: 'azul',
  bajable_sin_criterio: 'azul',
  problema_logistico: 'ambar',
  no_recuperable: 'rojo',
}

/* ------------------------------------------------------------------ */
/* 7. Las filas de la base                                              */
/* ------------------------------------------------------------------ */

/** Cómo llegó la fila del snapshot. Amplía el `origen` que ya tenía A1 */
export type OrigenSnapshotA2 = 'listings' | 'pricing' | 'foep' | 'informe' | 'manual'

/**
 * Una oferta, recortada a lo que hace falta para reconstruir el histórico de
 * competencia.
 *
 * Se guarda como JSONB dentro del snapshot, NO como una tabla aparte. El motivo
 * está escrito en la migración: una tabla de ofertas son 13.700 SKU × ~5
 * competidores × 365 noches, y esto es una décima parte del tamaño porque no
 * repite la identidad del SKU en cada fila.
 *
 * `precio` es SIEMPRE precio de listing (sin envío) y `envio` va aparte, para
 * que nadie compare un «puesto en casa» contra el FOEP.
 */
export interface OfertaGuardada {
  /** Identificador de vendedor de Amazon. Es lo único que permite seguir a un
      competidor entre noches: no hay nombre en esta respuesta */
  v: string
  /** Precio de listing, SIN envío */
  p: number | null
  /** Envío, aparte */
  e: number | null
  /** Canal, ya en el vocabulario ternario */
  c: CanalOferta
  /** ¿Es la oferta destacada? */
  g: boolean
  /** ¿Es la nuestra? */
  n: boolean
}

/** La fila de amazon_snapshots_precio, con las columnas que añade A2 */
export interface SnapshotBuyBox {
  id: string
  listing_id: string | null
  connection_id: string | null
  selling_partner_id: string
  marketplace_id: string
  sku: string
  asin: string | null
  /** NUESTRO instante de lectura. Amazon no da ninguno: ver la migración */
  fecha: string

  precio_propio: number | null
  moneda: string
  precio_propio_envio: number | null

  tiene_buybox: boolean | null
  buybox_estado: EstadoBuyBox
  precio_buybox: number | null
  precio_buybox_envio: number | null
  canal_ganador: CanalOferta | null
  canal_propio: CanalOferta | null

  n_competidores: number | null
  n_ofertas: number | null
  n_competidores_prime: number | null
  hay_oferta_propia: boolean | null

  precio_competidor_min: number | null
  precio_competidor_min_landed: number | null

  amazon_en_asin: boolean | null
  amazon_estado: EstadoAmazonRetail

  foep: number | null
  foep_estado: EstadoFoepA2
  foep_resultado: string | null
  foep_moneda: string | null

  condicion: string | null
  segmento: string | null
  ofertas: OfertaGuardada[] | null

  origen: OrigenSnapshotA2
  request_id: string | null
  job_id: string | null
  created_at: string
}

/** La fila de amazon_buybox_diagnostico */
export interface FilaDiagnostico {
  id: string
  listing_id: string | null
  connection_id: string | null
  selling_partner_id: string
  marketplace_id: string
  sku: string
  asin: string | null
  fecha: string

  veredicto: Veredicto
  /** El porqué, en español y con sus números. NO es la etiqueta */
  motivo: string
  accion: string
  /** Menor va antes en el listado accionable */
  prioridad: number

  /** Los números con los que se decidió. Sin esto no se puede auditar nada */
  datos: DatosDelVeredicto

  /** SIEMPRE simulacro. A2 no escribe precios en Amazon */
  precio_propuesto: number | null
  precio_propuesto_motivo: string | null

  snapshot_id: string | null
  foep_fecha: string | null
  job_id: string | null
  created_at: string
}

/**
 * La foto de los números en el momento del veredicto.
 *
 * Va como JSONB y no como columnas porque no se consulta: se lee cuando alguien
 * pregunta «¿por qué dijiste esto en marzo?». Y va ENTERA aunque se repita con
 * el snapshot, porque el snapshot y el diagnóstico pueden ser de instantes
 * distintos —el FOEP puede tener días— y reconstruirlo después obligaría a
 * adivinar cuál era la fila vigente.
 */
export interface DatosDelVeredicto {
  precioPropio: number | null
  precioPropioLanded: number | null
  moneda: string | null
  buybox: EstadoBuyBox
  precioBuybox: number | null
  canalGanador: CanalOferta | null
  canalPropio: CanalOferta | null
  competidores: number | null
  competidoresPrime: number | null
  precioCompetidorMin: number | null
  amazon: EstadoAmazonRetail
  foep: number | null
  foepEstado: EstadoFoepA2
  foepResultado: string | null
  /** Cuántas horas tenía el FOEP cuando se usó. Con rotación semanal puede ser
      mucho, y eso cambia cuánto fiarse del veredicto */
  foepHoras: number | null
  stock: EstadoStock['estado']
  stockUnidades: number | null
  /** Lo que faltaba por configurar cuando se decidió */
  faltaba: string[]
}
