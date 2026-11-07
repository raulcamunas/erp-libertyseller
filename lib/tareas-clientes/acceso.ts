import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { APP_TAREAS_CLIENTES } from '@/lib/config/apps'

/**
 * QUIÉN PUEDE VER LAS TAREAS DE LOS CLIENTES.
 *
 * Los administradores, y quien tenga la casilla «Tareas de clientes» en Gestión de Usuarios. Un `partner` NO entra por serlo: en este ERP el rol partner arrastra
 * cosas de más y puede ser un cliente. Es el mismo corte que aplica la función SQL `puede_ver_tareas_clientes()` de la migración 275 sobre las tablas `tc_*`.
 *
 * El id de la casilla (APP_TAREAS_CLIENTES) tiene que coincidir LETRA POR LETRA con esa función SQL: si baila, la casilla se marca y no pasa nada.
 */

export type PermisoTareas = { ok: true; userId: string; nombre: string; esAdmin: boolean; email: string | null } | { ok: false; estado: number; mensaje: string }

export async function exigirTareas(): Promise<PermisoTareas> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, estado: 401, mensaje: 'Hay que iniciar sesión' }

  const perfil = await getUserProfile()
  if (!perfil) return { ok: false, estado: 401, mensaje: 'Hay que iniciar sesión' }

  const nombre = (perfil.full_name ?? '').trim() || perfil.email || 'Alguien del equipo'
  if (perfil.role === 'admin') return { ok: true, userId: perfil.id, nombre, esAdmin: true, email: perfil.email ?? null }

  if (perfil.role === 'employee' || perfil.role === 'partner') {
    const { data } = await supabase.from('user_app_permissions').select('can_access').eq('user_id', user.id).eq('app_id', APP_TAREAS_CLIENTES).maybeSingle()
    if (data?.can_access) return { ok: true, userId: perfil.id, nombre, esAdmin: false, email: perfil.email ?? null }
  }
  return { ok: false, estado: 403, mensaje: 'No tienes acceso a las tareas de clientes. Pídeselo a un administrador.' }
}
