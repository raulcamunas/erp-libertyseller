import { cache } from 'react'
import { PERMISO_CRM_PROPIOS, PERMISO_EQUIPO_COMERCIAL } from '@/lib/config/apps'
import { createClient } from '@/lib/supabase/server'
import { alcanceDelCrm, type AlcanceDelCrm } from './acceso'

/**
 * EL ALCANCE DE ESTA PERSONA EN EL CRM, LEÍDO DE SUS PERMISOS — SOLO SERVIDOR.
 * ============================================================================
 * Lee de `user_app_permissions` los dos permisos sueltos que abren el CRM (`equipo-comercial`: ve todos los clientes; `crm-propios`: ve solo los suyos) y se los da a la regla pura
 * de lib/crm/acceso.ts. Dirección (admin y partner) no necesita la consulta: entra siempre.
 *
 * Va envuelto en `cache()`, como puedeVerEquipoComercial: la página lo llama una vez por petición. Y no es el filtro de verdad (ese es la RLS de las migraciones 212 y 261):
 * solo decide qué se pide y qué se pinta.
 */
export const alcanceDelCrmDe = cache(async (rol: string | null | undefined, userId: string): Promise<AlcanceDelCrm> => {
  if (rol === 'admin' || rol === 'partner') return alcanceDelCrm({ role: rol, equipoComercial: false, crmPropios: false })

  const supabase = await createClient()
  const { data } = await supabase.from('user_app_permissions').select('app_id, can_access').eq('user_id', userId).in('app_id', [PERMISO_EQUIPO_COMERCIAL, PERMISO_CRM_PROPIOS])
  const tiene = (id: string) => ((data ?? []) as Array<{ app_id: string; can_access: boolean | null }>).some((f) => f.app_id === id && f.can_access === true)
  return alcanceDelCrm({ role: rol, equipoComercial: tiene(PERMISO_EQUIPO_COMERCIAL), crmPropios: tiene(PERMISO_CRM_PROPIOS) })
})
