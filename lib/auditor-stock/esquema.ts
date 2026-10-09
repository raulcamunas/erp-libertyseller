import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'

/**
 * ¿ESTÁ LANZADA LA MIGRACIÓN 222?
 * SOLO SERVIDOR.
 *
 * Las migraciones se lanzan a mano en el editor SQL de Supabase, así que el código
 * puede llegar desplegado ANTES que sus columnas. Y no sirve «ya se verá»: un
 * `insert` con una columna que no existe falla ENTERO, y una auditoría que se
 * acaba de pasar 140 segundos leyendo Amazon se perdería sin guardarse.
 *
 * Así que antes de usar las columnas de la tienda se pregunta si están, y si no
 * están el auditor sigue haciendo lo de siempre —ni lee la tienda ni guarda nada
 * de ella— hasta que alguien lance la migración.
 *
 * Se recuerda un minuto: lo bastante para no preguntar en cada pasada y lo justo
 * para que, al lanzar la migración, el cambio se note en la siguiente.
 */
let recuerdo: { ok: boolean; at: number } | null = null
const RECUERDO_MS = 60_000

export async function hayColumnasTienda(): Promise<boolean> {
  if (recuerdo && Date.now() - recuerdo.at < RECUERDO_MS) return recuerdo.ok

  const { error } = await createServiceClient().from('stock_auditorias').select('ps_estado').limit(1)
  if (!error) {
    recuerdo = { ok: true, at: Date.now() }
    return true
  }
  // Solo se da por «no están» si el error dice que no están. Un fallo de red no
  // es «la migración no está lanzada», y no se recuerda: se vuelve a preguntar.
  if (isMissingSchema(error)) {
    recuerdo = { ok: false, at: Date.now() }
  }
  return false
}
