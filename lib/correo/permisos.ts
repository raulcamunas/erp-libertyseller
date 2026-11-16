import { cache } from 'react'
import { PERMISO_CORREO_SUPERVISION, PERMISO_EQUIPO_COMERCIAL } from '@/lib/config/apps'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * ¿PUEDE ESTA PERSONA ELEGIR QUÉ BUZÓN LEER? — SOLO SERVIDOR (páginas).
 *
 * Es lo que decide si la pantalla de Correo enseña los buzones del equipo. Lo es un administrador, quien tenga uno de los dos permisos sueltos que se
 * dan desde Gestión de Usuarios —«Supervisión del correo» (lee el de cualquiera del equipo) o «Supervisión del equipo comercial» (lee el de los
 * comerciales)— y, desde la migración 318, quien tenga ALGÚN BUZÓN ASIGNADO por un administrador (lo trabaja: lo lee y le avisa).
 *
 * ESTO SOLO DECIDE QUÉ SE PINTA. Quién puede abrir qué buzón lo decide lib/correo/acceso.ts en cada ruta de /api/correo, con estas mismas lecturas
 * (ver quienPide en quien-servidor.ts): un permiso que no se ve aquí tampoco abre nada allí. Un partner no entra por su rol ni por una asignación.
 *
 * Las asignaciones (correo_buzon_asignaciones) están cerradas al navegador: se leen con la clave de servicio, y solo las de esta persona. Sin la 318
 * (la tabla no existe), nadie tiene asignaciones y queda lo de siempre. Cualquier otro fallo al leerlas también cuenta como «ninguna»: esto solo
 * decide qué se pinta, y la pantalla igualmente aterriza en los buzones que GET /api/correo/buzones le devuelva.
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

  if (((data ?? []) as Array<{ app_id: string; can_access: boolean | null }>).some((f) => f.can_access === true)) return true
  if (rol === 'partner') return false
  return tieneBuzonesAsignados(userId)
})

/** ¿Tiene esta persona algún buzón asignado (318)? Sin la tabla, o si la lectura falla, no */
export async function tieneBuzonesAsignados(userId: string): Promise<boolean> {
  try {
    const service = createServiceClient()
    const { count, error } = await service.from('correo_buzon_asignaciones').select('buzon_id', { count: 'exact', head: true }).eq('persona_id', userId)
    if (error) {
      if (!isMissingSchema(error)) console.error('Correo · permisos: no se han podido comprobar los buzones asignados', { codigo: (error as { code?: unknown }).code ?? null })
      return false
    }
    return (count ?? 0) > 0
  } catch {
    return false
  }
}
