import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'

/**
 * QUIÉN PUEDE FACTURAR.
 *
 * Los mismos que entran en Tesorería: admin y socios. Aquí se emiten facturas
 * a nombre de la agencia y se mandan correos a clientes reales desde su
 * dirección — no es una pantalla de consulta.
 */
export async function exigirAdmin(): Promise<
  { ok: true } | { ok: false; estado: number; mensaje: string }
> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, estado: 401, mensaje: 'No autorizado' }

  const profile = await getUserProfile()
  if (!profile || (profile.role !== 'admin' && profile.role !== 'partner')) {
    return { ok: false, estado: 403, mensaje: 'Solo admin y socios pueden facturar' }
  }
  return { ok: true }
}
