/**
 * PLATAFORMA · LAS SERIES TEMPORALES
 * ==================================
 * SOLO SERVIDOR: importa el cliente de service_role.
 *
 * SOLO SE INSERTA. NUNCA se actualiza ni se borra: un snapshot es lo que se
 * observó en un instante, y Amazon no puede volver a darnos el dato de ayer. El
 * histórico es el activo que se está construyendo y no se recupera hacia atrás.
 *
 * No es solo una convención: la migración 123 pone un trigger que revienta ante
 * UPDATE, DELETE y TRUNCATE en las cuatro tablas. Hace falta porque service_role
 * se salta RLS y los GRANT, así que lo único que le queda delante a un UPDATE
 * bienintencionado es ese trigger.
 *
 *
 * POR QUÉ CADA FILA REPITE VENDEDOR, MARKETPLACE Y SKU
 * ---------------------------------------------------
 * Porque `listing_id` y `connection_id` son referencias BLANDAS —no hay clave
 * ajena— y la fila padre se borra de verdad: purgeMissingListings borra los
 * listings que Amazon deja de devolver, y desconectar una cuenta borra su
 * conexión. Un CASCADE se llevaría el histórico justo cuando más falta hace, y
 * un SET NULL sería un UPDATE, que el trigger prohíbe. Lo que identifica una
 * serie para siempre son esos tres campos congelados.
 */

import { createServiceClient } from '@/lib/supabase/service'
import type {
  EstadoDatoInventario,
  OrigenSnapshotInventario,
  TipoRankBsr,
} from './tipos'

/**
 * Cuántas filas por inserción.
 *
 * Más alto que el de los upserts del catálogo (250) porque aquí no hay
 * ON CONFLICT: son inserciones limpias, y un barrido de BSR de un catálogo
 * grande son decenas de miles de filas por noche.
 */
const CHUNK = 500

/** Lo que identifica la observación, y sobrevive a que se borre el listing */
export interface IdentidadSerie {
  listingId: string | null
  connectionId: string
  sellingPartnerId: string
  marketplaceId: string
  sku: string
  asin: string | null
  jobId: string | null
  requestId: string | null
}

/* ------------------------------------------------------------------ */
/* BSR                                                                 */
/* ------------------------------------------------------------------ */

export interface SnapshotBsrNuevo extends IdentidadSerie {
  tipo: TipoRankBsr
  categoria: string
  categoriaId: string | null
  rank: number
}

/**
 * Guarda puestos de ranking.
 *
 * SE GUARDAN TODOS, no solo el primero. Amazon devuelve dos jerarquías —el BSR
 * grande de la categoría raíz y los de subcategoría— y varias entradas de cada
 * una. La tabla admite varias filas por SKU y fecha precisamente para eso, y el
 * campo `tipo` es lo que impide mezclarlas: un puesto 113 de subcategoría y un
 * 72.855 de categoría raíz en la misma columna sin distintivo hacen la serie
 * ininterpretable.
 *
 * `fecha` la pone la base (DEFAULT NOW()) y no se manda: es el instante de la
 * observación, y dos lecturas del mismo día son dos filas legítimas.
 */
export async function insertarBsr(filas: SnapshotBsrNuevo[]): Promise<number> {
  if (filas.length === 0) return 0

  const payload = filas
    // El CHECK de la migración exige rank > 0. Un cero es un dato roto, no un
    // producto que va primero, y colarlo tumbaría el lote entero.
    .filter((f) => Number.isFinite(f.rank) && f.rank > 0)
    .map((f) => ({
      listing_id: f.listingId,
      connection_id: f.connectionId,
      selling_partner_id: f.sellingPartnerId,
      marketplace_id: f.marketplaceId,
      sku: f.sku,
      asin: f.asin,
      tipo: f.tipo,
      categoria: f.categoria,
      categoria_id: f.categoriaId,
      rank: Math.round(f.rank),
      request_id: f.requestId,
      job_id: f.jobId,
    }))

  return insertarEnLotes('amazon_snapshots_bsr', payload)
}

/* ------------------------------------------------------------------ */
/* Tarifas de Amazon                                                   */
/* ------------------------------------------------------------------ */

/**
 * Una estimación de lo que Amazon cobra por vender un SKU a UN PRECIO CONCRETO.
 *
 * `precioReferencia` no es metadato: es parte del dato. La comisión de
 * referencia es un porcentaje con mínimos y la de logística depende del tramo de
 * tamaño, así que la tarifa calculada para 30 € no vale para evaluar una venta a
 * 18 €. Guardarla sin su precio la convierte en un número que parece útil y no
 * lo es — y el margen saldría siempre mejor del real, que es el lado peligroso.
 */
export interface TarifaEstimadaNueva extends IdentidadSerie {
  precioReferencia: number
  moneda: string
  referral: number | null
  fba: number | null
  otras: number | null
  total: number | null
  /** estimado_api / fee_preview / liquidacion. Ver el comentario de la 123 */
  origen?: string
}

export async function insertarTarifas(filas: TarifaEstimadaNueva[]): Promise<number> {
  if (filas.length === 0) return 0

  const payload = filas
    // El CHECK de la migración exige precio >= 0 e importes >= 0. Una fila que
    // no lo cumpla tumbaría el lote ENTERO, así que se queda fuera aquí: es
    // preferible perder una tarifa rara a perder las diecinueve buenas.
    .filter(
      (f) =>
        Number.isFinite(f.precioReferencia) &&
        f.precioReferencia >= 0 &&
        f.moneda.trim() !== '' &&
        noNegativo(f.referral) &&
        noNegativo(f.fba) &&
        noNegativo(f.otras) &&
        noNegativo(f.total)
    )
    .map((f) => ({
      listing_id: f.listingId,
      connection_id: f.connectionId,
      selling_partner_id: f.sellingPartnerId,
      marketplace_id: f.marketplaceId,
      sku: f.sku,
      asin: f.asin,
      precio_referencia: f.precioReferencia,
      moneda: f.moneda,
      referral_fee: f.referral,
      fba_fee: f.fba,
      otras_fees: f.otras,
      total_fees: f.total,
      origen: f.origen ?? 'estimado_api',
      request_id: f.requestId,
      job_id: f.jobId,
    }))

  return insertarEnLotes('amazon_fees_estimados', payload)
}

/** null pasa: es «no lo sabemos». Un negativo no: es un dato roto */
function noNegativo(valor: number | null): boolean {
  return valor === null || (Number.isFinite(valor) && valor >= 0)
}

/* ------------------------------------------------------------------ */
/* Inventario                                                          */
/* ------------------------------------------------------------------ */

export interface SnapshotInventarioNuevo extends IdentidadSerie {
  /** El canal crudo de Amazon ('DEFAULT', 'AMAZON_NA'...) */
  canal: string | null
  estadoDato: EstadoDatoInventario
  disponible?: number | null
  reservado?: number | null
  inboundWorking?: number | null
  inboundEnviado?: number | null
  inboundRecibiendo?: number | null
  invendible?: number | null
  investigando?: number | null
  total?: number | null
  /** Stock del propio vendedor. Es el ÚNICO que tiene sentido en un SKU de FBM */
  stockPropio?: number | null
  origen: OrigenSnapshotInventario
}

/**
 * Guarda existencias.
 *
 * LOS TRES ESTADOS SON EL MOTIVO DE QUE ESTA FUNCIÓN EXISTA:
 *
 *   conocido    -> las cantidades son de verdad.
 *   no_aplica   -> este SKU lo gestiona el vendedor. Amazon no tiene existencias
 *                  suyas, y eso NO ES CERO.
 *   desconocido -> se intentó leer y no se pudo. TAMPOCO es cero.
 *
 * Cuando el estado no es 'conocido' las cantidades de Amazon se fuerzan a null
 * ANTES de escribir. El CHECK de la migración lo exigiría igualmente, pero
 * reventar el lote entero por una cantidad colada es peor que limpiarla aquí: lo
 * que se perdería es la observación de las otras trece mil referencias.
 *
 * `stockPropio` queda FUERA de esa limpieza a propósito: en un SKU de FBM el
 * dato de Amazon no aplica y el nuestro sí, y es justo el número que impide
 * diagnosticar «sin stock» un producto que tiene el almacén lleno.
 */
export async function insertarInventario(filas: SnapshotInventarioNuevo[]): Promise<number> {
  if (filas.length === 0) return 0

  const payload = filas.map((f) => {
    const conocido = f.estadoDato === 'conocido'
    return {
      listing_id: f.listingId,
      connection_id: f.connectionId,
      selling_partner_id: f.sellingPartnerId,
      marketplace_id: f.marketplaceId,
      sku: f.sku,
      asin: f.asin,
      canal: f.canal,
      estado_dato: f.estadoDato,
      disponible: conocido ? (f.disponible ?? null) : null,
      reservado: conocido ? (f.reservado ?? null) : null,
      inbound_working: conocido ? (f.inboundWorking ?? null) : null,
      inbound_enviado: conocido ? (f.inboundEnviado ?? null) : null,
      inbound_recibiendo: conocido ? (f.inboundRecibiendo ?? null) : null,
      invendible: conocido ? (f.invendible ?? null) : null,
      investigando: conocido ? (f.investigando ?? null) : null,
      total: conocido ? (f.total ?? null) : null,
      stock_propio: f.stockPropio ?? null,
      origen: f.origen,
      request_id: f.requestId,
      job_id: f.jobId,
    }
  })

  return insertarEnLotes('amazon_snapshots_inventario', payload)
}

/* ------------------------------------------------------------------ */
/* Utilidad                                                            */
/* ------------------------------------------------------------------ */

/* eslint-disable @typescript-eslint/no-explicit-any */
async function insertarEnLotes(tabla: string, filas: Record<string, any>[]): Promise<number> {
  if (filas.length === 0) return 0
  const service = createServiceClient()
  let escritas = 0
  for (let i = 0; i < filas.length; i += CHUNK) {
    const tramo = filas.slice(i, i + CHUNK)
    const { error } = await service.from(tabla).insert(tramo)
    if (error) throw error
    escritas += tramo.length
  }
  return escritas
}
/* eslint-enable @typescript-eslint/no-explicit-any */
