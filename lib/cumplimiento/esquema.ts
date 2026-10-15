import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'

/**
 * ¿ESTÁ LANZADA LA MIGRACIÓN 227?
 * SOLO SERVIDOR.
 *
 * Las migraciones se lanzan a mano en el editor SQL de Supabase, así que el código
 * puede llegar desplegado ANTES que su tabla. Sin esta pregunta, cada pasada del
 * cron se pasaría minutos leyendo Amazon para descubrir al final que no puede
 * guardar nada, y lo repetiría cada hora hasta que alguien lanzase la migración.
 *
 * Se recuerda un minuto: lo bastante para no preguntar en cada petición y lo justo
 * para que, al lanzar la migración, el cambio se note enseguida.
 */
let recuerdo: { ok: boolean; at: number } | null = null
const RECUERDO_MS = 60_000

export const FALTA_MIGRACION_CUMPLIMIENTO =
  'Falta lanzar la migración 227_cumplimiento_listings.sql en el editor SQL de Supabase: ' +
  'no hay dónde guardar las revisiones.'

export async function hayTablaCumplimiento(): Promise<boolean> {
  if (recuerdo && Date.now() - recuerdo.at < RECUERDO_MS) return recuerdo.ok

  const { error } = await createServiceClient().from('listing_cumplimiento').select('id').limit(1)
  if (!error) {
    recuerdo = { ok: true, at: Date.now() }
    return true
  }
  // Solo se da por «no está» si el error dice que no está. Un fallo de red no es
  // «la migración no está lanzada», y no se recuerda: se vuelve a preguntar.
  if (isMissingSchema(error)) recuerdo = { ok: false, at: Date.now() }
  return false
}
