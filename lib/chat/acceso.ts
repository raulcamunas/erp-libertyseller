import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { APP_CHAT } from '@/lib/config/apps'

/**
 * QUIÉN PUEDE USAR EL CHAT: los administradores y quien tenga la casilla «Chat» en Gestión de Usuarios. Es el mismo corte que aplica la función SQL `puede_ver_chat()` (migración 284)
 * sobre los canales de tiempo real. Las tablas chat_* no se leen desde el navegador: este es el único control de quién ve qué.
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
  if (perfil.role === 'admin') return { ok: true, userId: perfil.id, nombre, esAdmin: true }
  if (perfil.role === 'employee' || perfil.role === 'partner') {
    const { data } = await supabase.from('user_app_permissions').select('can_access').eq('user_id', user.id).eq('app_id', APP_CHAT).maybeSingle()
    if (data?.can_access) return { ok: true, userId: perfil.id, nombre, esAdmin: false }
  }
  return { ok: false, estado: 403, mensaje: 'No tienes acceso al chat. Pídeselo a un administrador.' }
}
