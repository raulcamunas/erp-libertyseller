/**
 * PLATAFORMA · A5 — TIPOS DEL MÓDULO DE COSTES
 * ============================================
 * Filas de la base, enumeraciones y etiquetas. Sin React, sin Supabase y sin
 * `fetch`: esto lo importan el servidor, el navegador y una prueba suelta.
 *
 *
 * POR QUÉ ESTE DIRECTORIO CONVIVE CON lib/plataforma/costes.ts
 * -----------------------------------------------------------
 * Ese fichero es de A1 y contiene el dominio puro de la VIGENCIA: costeVigente()
 * y costesVigentesPorSku(). No se ha movido aquí dentro a propósito. Node y
 * TypeScript resuelven `@/lib/plataforma/costes` al FICHERO —el fichero gana a
 * la carpeta— así que todo lo que ya lo importa sigue funcionando sin tocar una
 * línea, y este directorio no declara ningún `index.ts` para que no haya
 * ninguna ambigüedad sobre cuál de los dos se está pidiendo.
 *
 * Lo de A1 se USA, no se copia: ver vigencia.ts.
 */

import type { CosteProducto, OrigenCoste } from '../tipos'

export type { OrigenCoste }

/* ------------------------------------------------------------------ */
/* El coste, con lo que le añadió la migración 126                     */
/* ------------------------------------------------------------------ */

/**
 * Las columnas que A5 le añadió a `amazon_costes_producto`.
 *
 * LAS TRES PRIMERAS SON LA RAZÓN DE SER DE ESTE BLOQUE. Con solo el precio de
 * compra el margen sale inflado y, peor, SESGADO A FAVOR DE FBA:
 *
 *   · `coste_envio` — el FOEP de Amazon es precio de listing SIN ENVÍO. En un
 *     SKU que mandamos nosotros (FBM o Seller Fulfilled Prime) el porte lo
 *     pagamos y no aparece en ninguna respuesta de la SP-API. Sin esta cifra,
 *     enviar sale gratis en el cálculo.
 *   · `coste_almacen_fba` y `coste_flete_fba` — Product Fees NO incluye ni el
 *     almacenamiento ni el flete de entrada. Sin ellas, al canal FBM se le
 *     descuenta un coste real y al canal FBA no, así que la recomendación
 *     «pásalo a FBA» de A4 sale ganando siempre.
 *
 * Todas son ANULABLES y ninguna se rellena con cero cuando falta: un coste al
 * que le falta una pata se marca INCOMPLETO y no da número. Ver completitud.ts.
 */
export interface CosteProductoExtra {
  coste_envio: number | null
  coste_almacen_fba: number | null
  coste_flete_fba: number | null
  /** ¿El importe de `coste` viene con IVA? Casi nunca, pero pasa */
  iva_incluido: boolean
  /** El tipo, en tanto por ciento. Sin él, un coste con IVA no se puede llevar
      a base imponible: no hay ningún endpoint que dé el tipo del país */
  iva_porcentaje: number | null
  updated_by: string | null
  /** De qué importación salió. Referencia blanda */
  import_id: string | null
}

export type CosteA5 = CosteProducto & CosteProductoExtra

/* ------------------------------------------------------------------ */
/* El canal, a efectos de coste                                        */
/* ------------------------------------------------------------------ */

/**
 * CANAL BINARIO AQUÍ, Y TERNARIO EN EL RESTO DE LA PLATAFORMA.
 *
 * El canal de verdad son tres —FBA, Seller Fulfilled Prime y FBM— y confundir
 * SFP con FBM da un diagnóstico equivocado de por qué se pierde la Buy Box, que
 * es cosa de A2. Para el COSTE, en cambio, SFP y FBM son el mismo caso: en los
 * dos el paquete sale de nuestro almacén y el porte lo pagamos nosotros. Por eso
 * aquí se llama 'propio' a los dos juntos, y el nombre lo dice.
 *
 * Y hay un motivo práctico encima del conceptual: Amazon NO devuelve ningún
 * campo que distinga SFP de FBM. `is_fba` del espejo sale del canal de logística
 * del informe de listings, que dice 'DEFAULT' para los dos.
 */
export type CanalCoste = 'fba' | 'propio'

export const CANAL_COSTE_LABELS: Record<CanalCoste, string> = {
  fba: 'Logística de Amazon',
  propio: 'Envío propio (FBM o SFP)',
}

/** Del espejo del catálogo al canal a efectos de coste */
export function canalDeListing(listing: { is_fba: boolean }): CanalCoste {
  return listing.is_fba ? 'fba' : 'propio'
}

/* ------------------------------------------------------------------ */
/* El perfil de importación                                            */
/* ------------------------------------------------------------------ */

/**
 * La fila de `amazon_costes_perfiles`: cómo se lee el fichero de costes de UN
 * cliente.
 *
 * Tiene la misma forma que `StockReadProfile` porque lo consume EL MISMO lector
 * configurable (lib/stock-sync/lector.ts). Lo que cambia son los campos que se
 * buscan en el fichero: allí stock y precio, aquí coste, envío, almacenamiento y
 * flete.
 */
export interface PerfilCostes {
  id: string
  client_id: string
  name: string
  slug: string

  /** De qué cliente de la sincronización de stock se toma el mapeo
      referencia -> SKU. null = no se usa ninguno */
  stock_client_id: string | null

  hoja: string | null
  hoja_indice: number | null
  fila_cabecera: number | null
  fila_datos: number | null
  csv_separador: string | null
  csv_codificacion: string | null

  col_referencia: string[]
  col_sku: string[]
  col_ean: string[]
  col_descripcion: string[]
  col_coste: string[]
  col_envio: string[]
  col_almacen: string[]
  col_flete: string[]
  col_moneda: string[]
  col_valido_desde: string[]

  /** null = el fichero TIENE que traer la divisa. No hay divisa por defecto:
      un cliente que compra en dólares y vende en euros con la divisa dada por
      supuesta produce márgenes inventados */
  moneda: string | null
  iva_incluido: boolean
  iva_porcentaje: number | null

  last_run_at: string | null
  last_ok_at: string | null
  last_error: string | null

  is_active: boolean
  position: number | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

/* ------------------------------------------------------------------ */
/* La política de costes del cliente                                   */
/* ------------------------------------------------------------------ */

/**
 * Lo único de A5 que es una DECISIÓN DE NEGOCIO y no un dato.
 *
 * `dias_caducidad` nace en null y se queda así hasta que alguien lo decida. No
 * hay valor por defecto y no es pereza: cuántos días vale un coste depende del
 * proveedor y del sector, y un umbral inventado pinta de rojo costes que están
 * perfectamente vigentes —o de verde los que llevan dos años sin actualizarse—.
 * Mientras esté vacío, la pantalla enseña la ANTIGÜEDAD, que es un hecho, y dice
 * que no hay política, que también lo es.
 */
export interface PoliticaCostes {
  client_id: string
  dias_caducidad: number | null
  moneda_defecto: string | null
  exigir_envio_propio: boolean
  exigir_costes_fba: boolean
  notes: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

/** La política de un cliente que todavía no tiene fila. Nada decidido */
export function politicaPorDefecto(clientId: string): PoliticaCostes {
  return {
    client_id: clientId,
    dias_caducidad: null,
    moneda_defecto: null,
    exigir_envio_propio: true,
    exigir_costes_fba: true,
    notes: null,
    updated_by: null,
    created_at: '',
    updated_at: '',
  }
}

/* ------------------------------------------------------------------ */
/* El rastro                                                           */
/* ------------------------------------------------------------------ */

export type ModoImportacion = 'simulacro' | 'aplicado'

export const MODO_IMPORTACION_LABELS: Record<ModoImportacion, string> = {
  simulacro: 'Simulacro',
  aplicado: 'Aplicado',
}

export interface ImportacionCostes {
  id: string
  client_id: string
  profile_id: string | null
  perfil_nombre: string | null
  fichero: string | null
  huella: string | null
  bytes: number | null
  modo: ModoImportacion
  valido_desde: string
  filas_leidas: number
  filas_sin_coste: number
  filas_sin_referencia: number
  casados: number
  sin_casar: number
  altas: number
  correcciones: number
  sin_cambio: number
  avisos: string[] | null
  detalle: unknown
  estado: 'ok' | 'error'
  error_message: string | null
  created_by: string | null
  created_at: string
}

export type AccionCoste = 'alta' | 'correccion' | 'borrado'

export const ACCION_COSTE_LABELS: Record<AccionCoste, string> = {
  alta: 'Alta',
  correccion: 'Corrección',
  borrado: 'Borrado',
}

export interface AuditoriaCoste {
  id: string
  client_id: string
  sku: string
  valido_desde: string
  coste_id: string | null
  import_id: string | null
  accion: AccionCoste
  origen: OrigenCoste
  antes: Partial<CosteA5> | null
  despues: Partial<CosteA5> | null
  motivo: string | null
  created_by: string | null
  created_at: string
}
