import type { SupabaseClient } from '@supabase/supabase-js'
import { PERMISO_GESTION_LISTAS } from '@/lib/config/apps'

/**
 * QUIÉN PUEDE GESTIONAR LAS LISTAS DE LEADS DE COLD CALLING — SOLO SERVIDOR.
 *
 * Administrador y partner, siempre (son quienes reparten los permisos: dejarlos fuera por una fila que falte sería peor que el problema que se tapa); el resto, solo con
 * el permiso suelto 'gestion-listas'. Es el mismo criterio que la función SQL `puede_gestionar_listas` de la migración 257, y tiene que seguir siéndolo: las funciones SQL
 * lo vuelven a comprobar por dentro, así que si aquí se abre de más la base cierra, y si aquí se cierra de más nadie puede trabajar.
 *
 * Se lee con la sesión de quien llama (no con la clave de servicio): las políticas de user_app_permissions ya dejan a cada uno leer lo suyo.
 */
export async function puedeGestionarListas(supabase: Pick<SupabaseClient, 'from'>, rol: string | null | undefined, userId: string): Promise<boolean> {
  if (rol === 'admin' || rol === 'partner') return true
  const { data, error } = await supabase.from('user_app_permissions').select('can_access').eq('user_id', userId).eq('app_id', PERMISO_GESTION_LISTAS).maybeSingle()
  if (error) return false
  return (data as { can_access?: boolean } | null)?.can_access === true
}
