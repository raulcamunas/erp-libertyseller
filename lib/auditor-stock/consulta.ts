import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import type { Cambios, FilaDetalle } from './clasificar'
import type { FilaResumen } from './horas'
import type { ContrasteGuardado } from '@/lib/prestashop/informe'
import type { TuplaPrecio } from './precios'

/**
 * AUDITOR DE STOCK: LO QUE LEE LA PANTALLA.
 * SOLO SERVIDOR.
 *
 * El listado NO trae el detalle. Cada auditoría guarda ~2.000 SKU con su
 * cantidad, y 288 auditorías (tres días a cuatro por hora) serían decenas de
 * megas para enseñar una tabla de cifras. El detalle se pide de una en una,
 * cuando se abre.
 */

export interface AuditoriaResumen extends FilaResumen {
  error: string | null
  duracion_ms: number | null
  skus_pedidos: number
  leidas: number
  no_vinieron: number
  con_stock_fbm: number
  con_stock_fba: number
  /** Columnas de la migración 222. Ausentes si no está lanzada; null si no se miró */
  ps_estado?: 'ok' | 'error' | 'omitida' | null
  ps_error?: string | null
  ps_tallas?: number | null
  ps_con_stock?: number | null
  ps_unidades?: number | null
  cruce_cruzados?: number | null
  cruce_sin_pareja?: number | null
  cruce_ambiguos?: number | null
  cruce_amz_con_stock?: number | null
  cruce_ps_con_stock?: number | null
  div_sobreventa?: number | null
  div_venta_perdida?: number | null
  div_distinta?: number | null
  div_iguales?: number | null
  /** Columnas de la migración 223 (precios) */
  precios_leidos?: number | null
  precio_cambios?: number | null
  precio_suben?: number | null
  precio_bajan?: number | null
}

const COLUMNAS_RESUMEN =
  'id, creada_at, estado, error, duracion_ms, skus_pedidos, leidas, no_vinieron, ' +
  'con_stock, sin_stock, sin_dato, unidades, con_stock_fbm, con_stock_fba, entran, salen'

const COLUMNAS_TIENDA =
  'ps_estado, ps_error, ps_tallas, ps_con_stock, ps_unidades, cruce_cruzados, cruce_sin_pareja, ' +
  'cruce_ambiguos, cruce_amz_con_stock, cruce_ps_con_stock, div_sobreventa, div_venta_perdida, ' +
  'div_distinta, div_iguales'

const COLUMNAS_PRECIO = 'precios_leidos, precio_cambios, precio_suben, precio_bajan'

/**
 * Las migraciones 222 (tienda) y 223 (precios) se lanzan a mano y cada una por su
 * lado. Nombrar una columna que no existe rompe la consulta ENTERA, así que se
 * prueba con todas y se va quitando grupos hasta que Postgres las acepta.
 */
function combinaciones(base: string, extraTienda: string, extraPrecio: string) {
  return [
    { tienda: true, precio: true, cols: [base, COLUMNAS_TIENDA, COLUMNAS_PRECIO, extraTienda, extraPrecio] },
    { tienda: true, precio: false, cols: [base, COLUMNAS_TIENDA, extraTienda] },
    { tienda: false, precio: true, cols: [base, COLUMNAS_PRECIO, extraPrecio] },
    { tienda: false, precio: false, cols: [base] },
  ].map((c) => ({ ...c, cols: c.cols.filter(Boolean).join(', ') }))
}

/** Cuántas horas atrás se enseñan. 72 h × 4 por hora = 288 filas: cabe en una consulta */
export const HORAS_VISIBLES = 72

export type ListaAuditorias =
  | { ok: true; filas: AuditoriaResumen[]; conTienda: boolean; conPrecios: boolean }
  | { ok: false; faltaMigracion: true }
  | { ok: false; faltaMigracion: false; error: string }

export async function listarAuditorias(
  connectionId: string,
  marketplaceId: string,
  horas: number = HORAS_VISIBLES
): Promise<ListaAuditorias> {
  const service = createServiceClient()
  const desde = new Date(Date.now() - horas * 3_600_000).toISOString()

  const pedir = (columnas: string) =>
    service
      .from('stock_auditorias')
      .select(columnas)
      .eq('connection_id', connectionId)
      .eq('marketplace_id', marketplaceId)
      .gte('creada_at', desde)
      .order('creada_at', { ascending: false })
      .limit(1000)

  let conTienda = false
  let conPrecios = false
  let data: unknown = null
  let error: { message: string } | null = null
  for (const c of combinaciones(COLUMNAS_RESUMEN, '', '')) {
    const r = await pedir(c.cols)
    data = r.data
    error = r.error
    conTienda = c.tienda
    conPrecios = c.precio
    if (!error || !isMissingSchema(error)) break
  }

  if (error) {
    // Las migraciones se lanzan a mano: el código puede llegar antes que la
    // tabla. Que falte NO tumba la pantalla, que lo explica.
    if (isMissingSchema(error)) return { ok: false, faltaMigracion: true }
    return { ok: false, faltaMigracion: false, error: error.message }
  }
  return { ok: true, filas: (data ?? []) as unknown as AuditoriaResumen[], conTienda, conPrecios }
}

export interface DetalleAuditoria {
  resumen: AuditoriaResumen
  /** Los SKU con stock: [sku, asin, cantidad, canal] */
  detalle: FilaDetalle[]
  cambios: Cambios | null
  contraste: ContrasteGuardado | null
  cambiosPrecio: TuplaPrecio[] | null
}

export async function detalleDe(
  connectionId: string,
  id: string
): Promise<DetalleAuditoria | null> {
  const service = createServiceClient()
  const pedir = (columnas: string) =>
    service
      .from('stock_auditorias')
      .select(columnas)
      // El connection_id va SIEMPRE: el id solo no basta para que una auditoría de
      // otra cuenta no se pueda pedir por su identificador.
      .eq('connection_id', connectionId)
      .eq('id', id)
      .maybeSingle()

  let data: unknown = null
  let error: { message: string } | null = null
  for (const c of combinaciones(`${COLUMNAS_RESUMEN}, detalle, cambios`, 'contraste', 'cambios_precio')) {
    const r = await pedir(c.cols)
    data = r.data
    error = r.error
    if (!error || !isMissingSchema(error)) break
  }
  if (error || !data) return null

  const { detalle, cambios, contraste, cambios_precio, ...resumen } = data as unknown as AuditoriaResumen & {
    detalle: FilaDetalle[] | null
    cambios: Cambios | null
    contraste?: ContrasteGuardado | null
    cambios_precio?: TuplaPrecio[] | null
  }
  return {
    resumen,
    detalle: detalle ?? [],
    cambios: cambios ?? null,
    contraste: contraste ?? null,
    cambiosPrecio: cambios_precio ?? null,
  }
}
