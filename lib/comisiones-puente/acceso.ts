import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'

/**
 * EL LISTÓN DE ESTE MÓDULO: SOLO ADMINISTRADORES.
 * Raúl (2 nov 2026): el panel de Comisiones es solo para admin. El `exigirAdmin` de Facturación deja pasar también a los socios
 * (`partner`); aquí se endurece porque se ven el fee y la comisión de cada cliente y se escribe en Tesorería. middleware.ts declara
 * pública toda /api/, así que esta comprobación va en la primera línea de CADA ruta de /api/comisiones-puente.
 */
export async function exigirSoloAdmin(): Promise<{ ok: true } | { ok: false; estado: number; mensaje: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, estado: 401, mensaje: 'No autorizado' }

  const profile = await getUserProfile()
  if (!profile || profile.role !== 'admin') {
    return { ok: false, estado: 403, mensaje: 'Solo los administradores pueden ver y calcular comisiones' }
  }
  return { ok: true }
}
