/**
 * PLATAFORMA · MÓDULO A1 — TIPOS DEL DOMINIO
 * ==========================================
 * Filas de la base, enumeraciones y etiquetas. Sin React, sin Supabase, sin
 * `fetch`: esto lo pueden importar el servidor, el navegador y una prueba
 * suelta. Es la misma separación que ya hace lib/types/amazon.ts.
 *
 *
 * POR QUÉ LAS COLUMNAS NUEVAS DE amazon_listings ESTÁN AQUÍ Y NO EN
 * lib/types/amazon.ts
 * -----------------------------------------------------------------
 * Porque `AmazonListing` es el tipo de lo que devuelve loadListings(), y
 * loadListings() pide una LISTA EXPLÍCITA de columnas (LISTING_FIELDS en
 * lib/amazon/data.ts). Si se añadieran ahí las doce columnas nuevas, el tipo
 * prometería campos que esa consulta no trae y todo el módulo de Amazon
 * empezaría a leer `undefined` creyendo que lee `null`.
 *
 * Así que se declaran aparte y se combinan donde hacen falta:
 *
 *     type ListingConCatalogo = AmazonListing & AmazonListingCatalogo
 *
 * Es UNA SOLA TABLA —eso no cambia, ver la cabecera de la migración 123— con
 * dos vistas tipadas según lo que cada consulta pida de verdad.
 */

import type { AmazonListing } from '@/lib/types/amazon'

/* ------------------------------------------------------------------ */
/* Las columnas que la 123 le añadió al espejo del catálogo            */
/* ------------------------------------------------------------------ */

/** Cómo clasifica Amazon el artículo (summaries[].itemClassification) */
export type ClasificacionItem = 'BASE_PRODUCT' | 'VARIATION_PARENT' | 'PRODUCT_BUNDLE' | 'OTHER'

/** De dónde salen las medidas de un producto */
export type OrigenDimensiones = 'amazon' | 'manual' | 'estimado'

export interface AmazonListingCatalogo {
  marca: string | null
  categoria: string | null
  categoria_id: string | null
  clasificacion_item: ClasificacionItem | null

  /** Del PRODUCTO. Nunca sin su unidad: Amazon devuelve libras en Norteamérica
      y kilos en Europa, y a veces las dos cosas en el mismo objeto */
  peso: number | null
  peso_unidad: string | null
  largo: number | null
  ancho: number | null
  alto: number | null
  dims_unidad: string | null

  /** Del EMBALAJE. Es el que usa Amazon para calcular la tarifa de FBA */
  peso_paquete: number | null
  peso_paquete_unidad: string | null
  largo_paquete: number | null
  ancho_paquete: number | null
  alto_paquete: number | null
  dims_paquete_unidad: string | null

  dims_origen: OrigenDimensiones | null

  /** EAN / UPC / GTIN del informe de listings. El puente con el mapeo de
      proveedor de A5 */
  codigo_externo: string | null
  codigo_externo_tipo: string | null

  es_marca_propia: boolean
  catalogo_visto_at: string | null

  /** Lo que decidió la regla. Lo pisa entero el trabajo de recálculo */
  activo_calculado: boolean
  /** Lo que dijo una persona. GANA SIEMPRE. null = nadie se ha pronunciado */
  activo_manual: boolean | null
  activo_motivo: string | null
  activo_evaluado_at: string | null
}

/** El espejo del catálogo con los atributos que añadió A1 */
export type ListingConCatalogo = AmazonListing & AmazonListingCatalogo

/**
 * El «SKU activo efectivo».
 *
 * Es la ÚNICA forma correcta de preguntarlo, y por eso es una función y no una
 * columna: lo que dijo una persona gana siempre sobre lo que calculó la regla,
 * en los dos sentidos. Un `WHERE activo_calculado` suelto por ahí se salta la
 * decisión manual sin que nadie lo note.
 */
export function estaEnSeguimiento(
  listing: Pick<AmazonListingCatalogo, 'activo_calculado' | 'activo_manual'>
): boolean {
  return listing.activo_manual ?? listing.activo_calculado
}

/* ------------------------------------------------------------------ */
/* El criterio de «SKU activo» (amazon_tracking_rules)                 */
/* ------------------------------------------------------------------ */

/** Con qué criterio se recorta cuando se pasa del tope */
export type OrdenTope = 'ventas' | 'bsr' | 'precio' | 'sku'

export interface ReglaActivos {
  id: string
  client_id: string
  name: string
  /** Vacío = todos los marketplaces del cliente */
  marketplace_ids: string[]

  incluir_fba: boolean
  incluir_fbm: boolean
  incluir_marca_propia: boolean

  /** null = la vía de la rotación está apagada */
  min_unidades: number | null
  ventana_dias: number

  solo_listados_activos: boolean
  excluir_sin_precio: boolean
  excluir_variacion_padre: boolean
  marcas_excluidas: string[]
  skus_excluidos: string[]
  skus_incluidos: string[]

  /** El freno: tope duro de SKU en seguimiento diario */
  tope_skus: number
  orden_tope: OrdenTope

  is_active: boolean
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

/* ------------------------------------------------------------------ */
/* Costes de producto                                                  */
/* ------------------------------------------------------------------ */

export type OrigenCoste = 'manual' | 'fichero' | 'erp'

export interface CosteProducto {
  id: string
  client_id: string
  sku: string
  coste: number
  moneda: string
  /** Fecha ISO 'YYYY-MM-DD'. El coste vigente en una fecha es el de la fila con
      el valido_desde más alto que no la supere */
  valido_desde: string
  origen: OrigenCoste
  fuente_ref: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

/* ------------------------------------------------------------------ */
/* Ventas externas                                                     */
/* ------------------------------------------------------------------ */

/**
 * De dónde sale la velocidad de ventas.
 *
 * 'sp_api' es GET_SALES_AND_TRAFFIC_REPORT y hoy NO se puede pedir: hace falta
 * el rol de Análisis de marcas, que está solicitado y pendiente. Está declarado
 * desde ahora para que el día que llegue no haya que tocar ni la tabla ni a
 * quien la consulta. Ver ventas.ts.
 */
export type OrigenVentas = 'csv_sellerboard' | 'csv_business_reports' | 'csv_manual' | 'sp_api'

export interface VentaExterna {
  id: string
  client_id: string
  marketplace_id: string
  sku: string
  asin: string | null
  /** 'YYYY-MM-DD': es un día de negocio, no un instante */
  fecha: string
  unidades: number | null
  sesiones: number | null
  page_views: number | null
  /** Ratio 0..1, NO porcentaje */
  conversion: number | null
  ingresos: number | null
  moneda: string | null
  origen: OrigenVentas
  fuente_ref: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

/* ------------------------------------------------------------------ */
/* Trabajos                                                            */
/* ------------------------------------------------------------------ */

export type AmazonJobTipo =
  | 'censo_catalogo'
  | 'enriquecer_catalogo'
  | 'snapshot_bsr'
  | 'inventario_fba'
  | 'snapshot_precios'
  | 'tarifas'
  | 'recalcular_activos'
  | 'importar_costes'
  | 'importar_ventas'

export const AMAZON_JOB_TIPOS: AmazonJobTipo[] = [
  'censo_catalogo',
  'enriquecer_catalogo',
  'snapshot_bsr',
  'inventario_fba',
  'snapshot_precios',
  'tarifas',
  'recalcular_activos',
  'importar_costes',
  'importar_ventas',
]

export const AMAZON_JOB_TIPO_LABELS: Record<AmazonJobTipo, string> = {
  censo_catalogo: 'Censo del catálogo',
  enriquecer_catalogo: 'Atributos de catálogo',
  snapshot_bsr: 'Ranking de ventas (BSR)',
  inventario_fba: 'Inventario en Amazon',
  snapshot_precios: 'Precios y Buy Box',
  tarifas: 'Tarifas estimadas',
  recalcular_activos: 'Recalcular SKU en seguimiento',
  importar_costes: 'Importar costes',
  importar_ventas: 'Importar ventas',
}

/**
 * Los tipos que NO hablan con Amazon y por tanto no necesitan conexión ni
 * marketplace. Tiene que coincidir con el CHECK amazon_jobs_destino_ok de la
 * migración 123: si baila, el INSERT falla y no se puede crear el trabajo.
 */
export const JOB_TIPOS_SIN_CONEXION: AmazonJobTipo[] = [
  'recalcular_activos',
  'importar_costes',
  'importar_ventas',
]

export function jobNecesitaConexion(tipo: AmazonJobTipo): boolean {
  return !JOB_TIPOS_SIN_CONEXION.includes(tipo)
}

/**
 * Estado de un trabajo.
 *
 * 'en_curso' significa «empezó y no ha terminado», NO «lo está trabajando
 * alguien ahora mismo»: eso lo dice running_since. La distinción es lo que
 * permite que un trabajo de cinco horas sobreviva a veinte pasadas del cron.
 */
export type AmazonJobEstado =
  | 'pendiente'
  | 'en_curso'
  | 'pausado'
  | 'terminado'
  | 'error'
  | 'cancelado'

export const AMAZON_JOB_ESTADO_LABELS: Record<AmazonJobEstado, string> = {
  pendiente: 'En cola',
  en_curso: 'En marcha',
  pausado: 'Pausado',
  terminado: 'Terminado',
  error: 'Con error',
  cancelado: 'Cancelado',
}

/** Estados en los que un trabajo todavía cuenta como vivo */
export const JOB_ESTADOS_VIVOS: AmazonJobEstado[] = ['pendiente', 'en_curso', 'pausado']

export function jobEstaVivo(estado: AmazonJobEstado): boolean {
  return JOB_ESTADOS_VIVOS.includes(estado)
}

export interface AmazonJob {
  id: string
  tipo: AmazonJobTipo
  client_id: string
  connection_id: string | null
  marketplace_id: string | null
  estado: AmazonJobEstado
  prioridad: number

  /** null = todo el ámbito del trabajo. Nunca un array vacío: eso sería un
      filtro que no selecciona nada y el trabajo acabaría en verde sin hacer nada */
  skus_filtro: string[] | null
  parametros: Record<string, unknown>

  cursor_clave: string | null
  cursor_pagina: number | null
  cursor_externo: string | null

  total_estimado: number | null
  procesados: number
  omitidos: number
  errores: number
  /** Fallidos SEGUIDOS. Es lo que decide si el trabajo se rinde; `errores` es
      la cuenta total y solo es estadística. Ver la columna en la 123 */
  lotes_fallidos_seguidos: number
  lotes: number
  pasadas: number

  running_since: string | null
  running_token: string | null

  cancel_solicitado: boolean
  cancel_por: string | null
  cancel_motivo: string | null

  progreso_at: string | null
  iniciado_at: string | null
  terminado_at: string | null
  error_message: string | null
  error_detalle: unknown
  request_id: string | null
  resumen: string | null

  created_by: string | null
  created_at: string
  updated_at: string
}

/**
 * Cuánto lleva hecho, de 0 a 1. null cuando no se sabe el total.
 *
 * Devuelve null y NO 0 cuando `total_estimado` es null, a propósito: una barra
 * de progreso a cero es indistinguible de una parada, y un trabajo cuyo total
 * todavía no se conoce está trabajando, no parado.
 */
export function progresoDeJob(job: Pick<AmazonJob, 'procesados' | 'total_estimado'>): number | null {
  if (job.total_estimado === null || job.total_estimado <= 0) return null
  return Math.min(1, job.procesados / job.total_estimado)
}

/* ------------------------------------------------------------------ */
/* Eventos                                                             */
/* ------------------------------------------------------------------ */

export type EventoSeveridad = 'info' | 'aviso' | 'error' | 'critico'

export const EVENTO_SEVERIDAD_LABELS: Record<EventoSeveridad, string> = {
  info: 'Informativo',
  aviso: 'Aviso',
  error: 'Error',
  critico: 'Grave',
}

/** Las que suenan por la campana. Tiene que coincidir con el trigger
    create_amazon_evento_notification() de la migración 123 */
export const SEVERIDADES_QUE_AVISAN: EventoSeveridad[] = ['error', 'critico']

export type ResolucionEvento = 'arreglado' | 'ignorado' | 'caducado'

export interface AmazonEvento {
  id: string
  tipo: string
  severidad: EventoSeveridad
  client_id: string | null
  connection_id: string | null
  marketplace_id: string | null
  sku: string | null
  asin: string | null
  job_id: string | null
  mensaje: string
  detalle: unknown
  request_id: string | null
  huella: string | null
  created_by: string | null
  resuelto: boolean
  resuelto_at: string | null
  resuelto_por: string | null
  resolucion: ResolucionEvento | null
  resuelto_motivo: string | null
  created_at: string
}

/* ------------------------------------------------------------------ */
/* Series temporales                                                   */
/* ------------------------------------------------------------------ */

/**
 * LO QUE COMPARTEN LAS CUATRO SERIES, y es lo importante de este bloque.
 *
 * `listing_id` y `connection_id` son referencias BLANDAS: no hay clave ajena,
 * porque la fila padre se borra de verdad (purgeMissingListings borra los
 * listings que Amazon deja de devolver, disconnectConnection borra la conexión)
 * y el histórico tiene que sobrevivir a eso. Lo que identifica la serie para
 * siempre son los tres campos congelados: vendedor, marketplace y SKU.
 *
 * `fecha` es el INSTANTE de la observación, no el día. Dos lecturas del mismo
 * día son dos filas legítimas.
 */
export interface SnapshotBase {
  id: string
  listing_id: string | null
  connection_id: string | null
  selling_partner_id: string
  marketplace_id: string
  sku: string
  asin: string | null
  fecha: string
  request_id: string | null
  job_id: string | null
  created_at: string
}

/** disponible / no_disponible / no_consultado: un SKU sin FOEP es un caso
    aparte, nunca un cero (regla 5 del §3.5 de la especificación) */
export type EstadoFoep = 'disponible' | 'no_disponible' | 'no_consultado'

export type OrigenSnapshotPrecio = 'listings' | 'pricing' | 'foep' | 'informe' | 'manual'

export interface SnapshotPrecio extends SnapshotBase {
  precio_propio: number | null
  moneda: string
  tiene_buybox: boolean | null
  precio_buybox: number | null
  canal_ganador: string | null
  n_competidores: number | null
  amazon_en_asin: boolean | null
  precio_competidor_min: number | null
  foep: number | null
  foep_estado: EstadoFoep
  origen: OrigenSnapshotPrecio
}

/** 'grupo' = displayGroupRanks (el BSR grande). 'categoria' = classificationRanks
    (la subcategoría de la ficha). Mezclarlos hace la serie ininterpretable */
export type TipoRankBsr = 'grupo' | 'categoria'

export interface SnapshotBsr extends SnapshotBase {
  tipo: TipoRankBsr
  categoria: string
  categoria_id: string | null
  rank: number
}

/**
 * conocido / no_aplica / desconocido.
 *
 * FBA Inventory OMITE EN SILENCIO los SKU gestionados por el vendedor. Sin los
 * tres estados, «no vino en la respuesta» se confunde con «stock 0» y el
 * catálogo FBM entero de un cliente aparece sin existencias.
 */
export type EstadoDatoInventario = 'conocido' | 'no_aplica' | 'desconocido'

export type OrigenSnapshotInventario = 'informe' | 'fba_inventory' | 'listings' | 'manual'

export interface SnapshotInventario extends SnapshotBase {
  canal: string | null
  estado_dato: EstadoDatoInventario
  disponible: number | null
  reservado: number | null
  inbound_working: number | null
  inbound_enviado: number | null
  inbound_recibiendo: number | null
  invendible: number | null
  investigando: number | null
  total: number | null
  stock_propio: number | null
  origen: OrigenSnapshotInventario
}

export type OrigenFee = 'estimado_api' | 'fee_preview' | 'liquidacion'

export interface FeeEstimado extends SnapshotBase {
  precio_referencia: number
  moneda: string
  referral_fee: number | null
  fba_fee: number | null
  otras_fees: number | null
  total_fees: number | null
  origen: OrigenFee
}
