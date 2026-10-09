import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import type { Cambios, FilaDetalle } from './clasificar'
import type { FilaResumen } from './horas'

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
}

const COLUMNAS_RESUMEN =
  'id, creada_at, estado, error, duracion_ms, skus_pedidos, leidas, no_vinieron, ' +
  'con_stock, sin_stock, sin_dato, unidades, con_stock_fbm, con_stock_fba, entran, salen'

/** Cuántas horas atrás se enseñan. 72 h × 4 por hora = 288 filas: cabe en una consulta */
export const HORAS_VISIBLES = 72

export type ListaAuditorias =
  | { ok: true; filas: AuditoriaResumen[] }
  | { ok: false; faltaMigracion: true }
  | { ok: false; faltaMigracion: false; error: string }

export async function listarAuditorias(
  connectionId: string,
  marketplaceId: string,
  horas: number = HORAS_VISIBLES
): Promise<ListaAuditorias> {
  const service = createServiceClient()
  const desde = new Date(Date.now() - horas * 3_600_000).toISOString()

  const { data, error } = await service
    .from('stock_auditorias')
    .select(COLUMNAS_RESUMEN)
    .eq('connection_id', connectionId)
    .eq('marketplace_id', marketplaceId)
    .gte('creada_at', desde)
    .order('creada_at', { ascending: false })
    .limit(1000)

  if (error) {
    // Las migraciones se lanzan a mano: el código puede llegar antes que la
    // tabla. Que falte NO tumba la pantalla, que lo explica.
    if (isMissingSchema(error)) return { ok: false, faltaMigracion: true }
    return { ok: false, faltaMigracion: false, error: error.message }
  }
  return { ok: true, filas: (data ?? []) as unknown as AuditoriaResumen[] }
}

export interface DetalleAuditoria {
  resumen: AuditoriaResumen
  /** Los SKU con stock: [sku, asin, cantidad, canal] */
  detalle: FilaDetalle[]
  cambios: Cambios | null
}

export async function detalleDe(
  connectionId: string,
  id: string
): Promise<DetalleAuditoria | null> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('stock_auditorias')
    .select(`${COLUMNAS_RESUMEN}, detalle, cambios`)
    // El connection_id va SIEMPRE: el id solo no basta para que una auditoría de
    // otra cuenta no se pueda pedir por su identificador.
    .eq('connection_id', connectionId)
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return null

  const { detalle, cambios, ...resumen } = data as unknown as AuditoriaResumen & {
    detalle: FilaDetalle[] | null
    cambios: Cambios | null
  }
  return { resumen, detalle: detalle ?? [], cambios: cambios ?? null }
}
