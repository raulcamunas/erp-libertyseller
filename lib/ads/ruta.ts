/**
 * AMAZON ADS · LO COMÚN DE LAS RUTAS DE «MARKETING TEST».
 * SOLO SERVIDOR.
 *
 * Todas las rutas de /api/ads/cuenta/* abren igual: sesión de ADMINISTRADOR (se escribe en la cuenta de publicidad de un cliente y se gasta su dinero) y una cuenta de anunciante que exista y esté
 * en uso. En middleware.ts todo lo de /api/ es público, así que ESTA comprobación es la que manda.
 */

import { NextResponse } from 'next/server'
import { UUID, fail, requireAmazonAdmin, type AmazonSession } from '@/lib/amazon/api'
import { AdsError } from './oauth'
import { cuentaPorId, esSinMigracion } from './cuenta'
import { APP_MARKETING_TEST, ceoSinCasilla } from './acceso'

export async function abrirCuenta(perfilId: unknown): Promise<{ sesion: AmazonSession; cuenta: NonNullable<Awaited<ReturnType<typeof cuentaPorId>>> } | NextResponse> {
  const sesion = await requireAmazonAdmin()
  if (sesion instanceof NextResponse) return sesion
  // Un CEO es un administrador cuyo acceso a cada app lo deciden las casillas: sin la de Marketing Test, no entra ni por la API
  const [{ data: perfil }, { data: permiso }] = await Promise.all([
    sesion.supabase.from('profiles').select('puesto').eq('id', sesion.userId).maybeSingle(),
    sesion.supabase.from('user_app_permissions').select('can_access').eq('user_id', sesion.userId).eq('app_id', APP_MARKETING_TEST).maybeSingle(),
  ])
  if (ceoSinCasilla(sesion.role, (perfil as { puesto: string | null } | null)?.puesto, new Set(permiso?.can_access ? [APP_MARKETING_TEST] : []))) return fail(403, 'No tienes acceso a Marketing Test')
  if (typeof perfilId !== 'string' || !UUID.test(perfilId)) return fail(400, 'Falta la cuenta de anunciante.')
  const cuenta = await cuentaPorId(perfilId)
  if (!cuenta) return fail(404, 'Esa cuenta de anunciante no existe o está apagada.')
  return { sesion, cuenta }
}

export const MENSAJE_SIN_MIGRACION = 'Falta lanzar una migración en Supabase (la 292 o la 293): las tablas de Marketing Test todavía no existen.'

/** De una excepción a una respuesta legible: migración sin lanzar, error de Amazon Ads (con su motivo) o genérico */
export function errorDeRuta(error: unknown, contexto: string): NextResponse {
  if (esSinMigracion(error)) return fail(409, MENSAJE_SIN_MIGRACION)
  if (error instanceof AdsError) {
    console.error(`${contexto}:`, error.message)
    return fail(400, error.message)
  }
  if ((error as { code?: string } | null)?.code === '23505') return fail(409, 'Ya existe un producto con ese ASIN en esta cuenta.')
  console.error(`${contexto}:`, error)
  if (error instanceof Error && error.message) return fail(400, error.message)
  return fail(500, 'No se ha podido completar la operación. Vuelve a intentarlo y avisa si sigue fallando')
}
