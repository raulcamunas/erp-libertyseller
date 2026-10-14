import { isMissingSchema } from '@/lib/plataforma/eventos'
import { createServiceClient } from '@/lib/supabase/service'
import type { FilaInforme } from './verificacion-pura'

/**
 * LO QUE LEE LA PANTALLA DE VERIFICACIONES.
 * SOLO SERVIDOR.
 *
 * El listado NO trae el informe: puede tener miles de filas. Se pide de una en
 * una, al abrirla.
 */

export interface VerificacionResumen {
  id: string
  creada_at: string
  vence_at: string
  estado: 'pendiente' | 'en_curso' | 'hecha' | 'error'
  verificada_at: string | null
  enviados: number
  fallos: number | null
  resumen: Record<string, number | boolean | string | null> | null
  slack: string | null
  error: string | null
}

export type ListaVerificaciones =
  | { ok: true; filas: VerificacionResumen[]; activa: boolean }
  | { ok: false; faltaMigracion: true }
  | { ok: false; faltaMigracion: false; error: string }

export async function listarVerificaciones(stockClientId: string): Promise<ListaVerificaciones> {
  const service = createServiceClient()
  const [lista, cfg] = await Promise.all([
    service
      .from('stock_verificaciones')
      .select('id, creada_at, vence_at, estado, verificada_at, enviados, fallos, resumen, slack, error')
      .eq('client_id', stockClientId)
      .order('creada_at', { ascending: false })
      .limit(60),
    service.from('stock_verificacion_clientes').select('activo').eq('client_id', stockClientId).maybeSingle(),
  ])
  const error = lista.error ?? cfg.error
  if (error) {
    if (isMissingSchema(error)) return { ok: false, faltaMigracion: true }
    return { ok: false, faltaMigracion: false, error: error.message }
  }
  return {
    ok: true,
    filas: (lista.data ?? []) as unknown as VerificacionResumen[],
    activa: (cfg.data as { activo: boolean } | null)?.activo ?? false,
  }
}

export async function informeDe(
  stockClientId: string,
  id: string
): Promise<{ resumen: VerificacionResumen; informe: FilaInforme[] } | null> {
  const { data, error } = await createServiceClient()
    .from('stock_verificaciones')
    .select('id, creada_at, vence_at, estado, verificada_at, enviados, fallos, resumen, slack, error, informe')
    // El cliente va SIEMPRE: el id solo no basta para pedir lo de otro cliente
    .eq('client_id', stockClientId)
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return null
  const { informe, ...resumen } = data as unknown as VerificacionResumen & { informe: FilaInforme[] | null }
  return { resumen, informe: informe ?? [] }
}
