import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { APP_CHAT } from '@/lib/config/apps'
import { esCeo } from '@/lib/usuarios/ceo'

/**
 * QUIÉN PUEDE USAR EL CHAT: los administradores y quien tenga la casilla «Chat» en Gestión de Usuarios. Es el mismo corte que aplica la función SQL `puede_ver_chat()` (migración 284)
 * sobre los canales de tiempo real. Las tablas chat_* no se leen desde el navegador: este es el único control de quién ve qué. Un CEO (administrador cuyo acceso decide la casilla, lib/usuarios/ceo.ts) entra solo si la tiene marcada.
 */
export type PermisoChat = { ok: true; userId: string; nombre: string; esAdmin: boolean } | { ok: false; estado: number; mensaje: string }

export async function exigirChat(): Promise<PermisoChat> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, estado: 401, mensaje: 'Hay que iniciar sesión' }
  const perfil = await getUserProfile()
  if (!perfil) return { ok: false, estado: 401, mensaje: 'Hay que iniciar sesión' }
  const nombre = (perfil.full_name ?? '').trim() || perfil.email || 'Alguien del equipo'
  const ceo = esCeo(perfil.role, perfil.puesto)
  // Un administrador entra siempre; un CEO, como cualquier otro rol, solo con la casilla «Chat» (y entonces es administrador del chat)
  if (perfil.role === 'admin' && !ceo) return { ok: true, userId: perfil.id, nombre, esAdmin: true }
  if (perfil.role === 'employee' || perfil.role === 'partner' || ceo) {
    const { data } = await supabase.from('user_app_permissions').select('can_access').eq('user_id', user.id).eq('app_id', APP_CHAT).maybeSingle()
    if (data?.can_access) return { ok: true, userId: perfil.id, nombre, esAdmin: ceo }
  }
  return { ok: false, estado: 403, mensaje: 'No tienes acceso al chat. Pídeselo a un administrador.' }
}
