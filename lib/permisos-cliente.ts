import type { SupabaseClient } from '@supabase/supabase-js'
import { PERMISO_CORREO_SUPERVISION, PERMISO_EQUIPO_COMERCIAL } from '@/lib/config/apps'

/**
 * LOS PERMISOS QUE DECIDEN QUÉ SE PINTA, LEÍDOS DESDE EL NAVEGADOR.
 *
 * Cold Calling y Correo se quedan montados mientras se cambia de una a otra (components/layout/AppsPersistentes.tsx): ya no las pinta una
 * página del servidor que averigua estas cosas antes de empezar, así que lo averiguan ellas con la sesión de quien mira. Es el MISMO
 * criterio que lib/equipo-comercial/acceso.ts y lib/correo/permisos.ts (los dos de servidor) y tiene que seguir siéndolo.
 *
 * NADA DE ESTO ES EL FILTRO DE VERDAD. Solo decide si se enseña el selector de comercial o el de buzones. Quien manda son las políticas
 * RLS de la base y, en el correo, las rutas de /api/correo: un permiso que aquí se leyera mal no abre ningún dato.
 */

type Lector = Pick<SupabaseClient, 'from'>

async function permisosSueltos(supabase: Lector, userId: string, ids: string[]): Promise<boolean> {
  const { data, error } = await supabase.from('user_app_permissions').select('app_id, can_access').eq('user_id', userId).in('app_id', ids)
  if (error) return false
  return ((data ?? []) as Array<{ app_id: string; can_access: boolean | null }>).some((f) => f.can_access === true)
}

/** ¿Puede ver la cartera y el trabajo de todo el equipo comercial? Administrador y partner, siempre; el resto, con el permiso suelto */
export async function puedeVerEquipoComercialEnNavegador(supabase: Lector, rol: string | null | undefined, userId: string): Promise<boolean> {
  if (rol === 'admin' || rol === 'partner') return true
  return permisosSueltos(supabase, userId, [PERMISO_EQUIPO_COMERCIAL])
}

/** ¿Puede elegir qué buzón del equipo leer? El administrador, y quien tenga uno de los dos permisos sueltos */
export async function puedeSupervisarCorreoEnNavegador(supabase: Lector, rol: string | null | undefined, userId: string): Promise<boolean> {
  if (rol === 'admin') return true
  return permisosSueltos(supabase, userId, [PERMISO_EQUIPO_COMERCIAL, PERMISO_CORREO_SUPERVISION])
}
