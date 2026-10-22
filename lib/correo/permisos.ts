import { cache } from 'react'
import { PERMISO_CORREO_SUPERVISION, PERMISO_EQUIPO_COMERCIAL } from '@/lib/config/apps'
import { createClient } from '@/lib/supabase/server'

/**
 * ¿PUEDE ESTA PERSONA ELEGIR QUÉ BUZÓN LEER? — SOLO SERVIDOR (páginas).
 *
 * Es lo que decide si la pantalla de Correo enseña el selector de buzones del equipo. Lo es un administrador, y quien tenga
 * uno de los dos permisos sueltos que se dan desde Gestión de Usuarios: «Supervisión del correo» (lee el de cualquiera del
 * equipo) o «Supervisión del equipo comercial» (lee el de los comerciales).
 *
 * ESTO SOLO DECIDE QUÉ SE PINTA. Quién puede abrir qué buzón lo decide lib/correo/acceso.ts en cada ruta de /api/correo,
 * con esta misma lectura de user_app_permissions (ver quienPide en servidor.ts): un permiso que no se ve aquí tampoco abre
 * nada allí. Un partner no entra por su rol, solo por un permiso suelto explícito.
 *
 * Envuelto en `cache()` porque lo pueden pedir la página y, si hiciera falta, su layout en una misma petición.
 */
export const puedeSupervisarCorreo = cache(async (rol: string | null | undefined, userId: string): Promise<boolean> => {
  if (rol === 'admin') return true

  const supabase = await createClient()
  const { data } = await supabase
    .from('user_app_permissions')
    .select('app_id, can_access')
    .eq('user_id', userId)
    .in('app_id', [PERMISO_EQUIPO_COMERCIAL, PERMISO_CORREO_SUPERVISION])

  return ((data ?? []) as Array<{ app_id: string; can_access: boolean | null }>).some((f) => f.can_access === true)
})
