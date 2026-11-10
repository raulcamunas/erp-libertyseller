import type { AmazonSession } from '@/lib/amazon/api'
import { esCeo } from '@/lib/usuarios/ceo'

/** El id de la app «Cumplimiento»: la casilla con la que entra un CEO */
export const APP_CUMPLIMIENTO = 'cumplimiento'

/**
 * ¿Es un CEO sin la casilla de Cumplimiento? Un CEO es un administrador cuyo acceso a cada app lo deciden las casillas, también por la API (en middleware.ts todo lo de /api/ es público).
 * SOLO SERVIDOR.
 */
export async function sinCasillaDeCumplimiento(sesion: AmazonSession): Promise<boolean> {
  const [{ data: perfil }, { data: permiso }] = await Promise.all([
    sesion.supabase.from('profiles').select('puesto').eq('id', sesion.userId).maybeSingle(),
    sesion.supabase.from('user_app_permissions').select('can_access').eq('user_id', sesion.userId).eq('app_id', APP_CUMPLIMIENTO).maybeSingle(),
  ])
  return esCeo(sesion.role, (perfil as { puesto: string | null } | null)?.puesto) && !permiso?.can_access
}
