import 'server-only'
import { createServiceClient } from '@/lib/supabase/service'
import { esFormatoProducto, esHojaCaja, type PreferenciasEtiquetas } from './formatos-etiqueta'

/**
 * EN QUÉ HOJA IMPRIME CADA CLIENTE (migración 327). Sin la tabla, sin fila o con un valor que ya no existe: null, y
 * la pantalla usa la hoja de siempre. Nunca rompe la impresión.
 */
type Service = ReturnType<typeof createServiceClient>

export async function preferenciasDe(clienteId: string, service: Service = createServiceClient()): Promise<PreferenciasEtiquetas> {
  const { data, error } = await service.from('fba_preferencias_etiquetas').select('formato_producto, hoja_caja').eq('client_id', clienteId).maybeSingle()
  if (error || !data) return { producto: null, caja: null }
  const f = data as { formato_producto: string | null; hoja_caja: string | null }
  return { producto: esFormatoProducto(f.formato_producto) ? f.formato_producto : null, caja: esHojaCaja(f.hoja_caja) ? f.hoja_caja : null }
}

/** Fija una de las dos (o las dos). `undefined` = no se toca; null = vuelve a la de siempre */
export async function guardarPreferencias(
  clienteId: string,
  cambios: { producto?: string | null; caja?: string | null },
  userId: string,
  service: Service = createServiceClient()
): Promise<PreferenciasEtiquetas> {
  const fila: Record<string, unknown> = { client_id: clienteId, actualizado_at: new Date().toISOString(), actualizado_por: userId }
  if (cambios.producto !== undefined) {
    if (cambios.producto !== null && !esFormatoProducto(cambios.producto)) throw new Error('Esa hoja de etiquetas no existe')
    fila.formato_producto = cambios.producto
  }
  if (cambios.caja !== undefined) {
    if (cambios.caja !== null && !esHojaCaja(cambios.caja)) throw new Error('Esa hoja de cajas no existe')
    fila.hoja_caja = cambios.caja
  }
  const { error } = await service.from('fba_preferencias_etiquetas').upsert(fila, { onConflict: 'client_id' })
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') throw new Error('Falta lanzar la migración 327 (preferencias de etiquetas)')
    throw error
  }
  return preferenciasDe(clienteId, service)
}
