import type { SupabaseClient } from '@supabase/supabase-js'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { hayCambio, type UltimoEvento } from './cambio'

/**
 * EL HISTORIAL DE UN ENVÍO A FBA.
 *
 * Amazon da el estado de AHORA, no cuándo cambió. Así que cada vez que se mira un
 * envío se compara con lo último que se apuntó, y solo si ha cambiado el estado o
 * las unidades recibidas se escribe una fila. La hora es la de haberlo VISTO.
 *
 * Se compara con el último EVENTO y no con las columnas de la remesa: la pasada
 * nocturna también actualiza esas columnas, y si se comparara con ellas, lo que
 * ella ve primero se perdería para el historial.
 */

export async function anotarSeguimiento(
  service: SupabaseClient,
  remesaId: string,
  ahora: { estado: string | null; enviadas: number; recibidas: number }
): Promise<'apuntado' | 'sin_cambio' | 'sin_tabla'> {
  const { data, error } = await service
    .from('fba_remesa_eventos')
    .select('estado_amazon, unidades_recibidas')
    .eq('remesa_id', remesaId)
    .order('visto_at', { ascending: false })
    .limit(1)
  if (error) {
    // La migración 224 se lanza a mano: sin ella no hay historial, y no pasa nada
    if (isMissingSchema(error)) return 'sin_tabla'
    throw error
  }

  const ultimo = ((data ?? []) as UltimoEvento[])[0] ?? null
  if (!hayCambio(ultimo, { estado: ahora.estado, recibidas: ahora.recibidas })) return 'sin_cambio'

  const { error: e2 } = await service.from('fba_remesa_eventos').insert({
    remesa_id: remesaId,
    estado_amazon: ahora.estado,
    unidades_enviadas: ahora.enviadas,
    unidades_recibidas: ahora.recibidas,
  })
  if (e2) {
    if (isMissingSchema(e2)) return 'sin_tabla'
    throw e2
  }
  return 'apuntado'
}
