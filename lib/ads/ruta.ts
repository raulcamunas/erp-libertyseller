/**
 * AMAZON ADS · LO COMÚN DE LAS RUTAS DE «MARKETING TEST».
 * SOLO SERVIDOR.
 *
 * Todas las rutas de /api/ads/cuenta/* abren igual: sesión de quien lleva cuentas (administrador, o empleado con la casilla de Marketing Test: lib/cuentas/acceso.ts) y una cuenta de anunciante que exista y esté
 * en uso. En middleware.ts todo lo de /api/ es público, así que ESTA comprobación es la que manda.
 */

import { NextResponse } from 'next/server'
import { UUID, fail, type AmazonSession } from '@/lib/amazon/api'
import { requireAppDeCuentas } from '@/lib/cuentas/acceso'
import { AdsError } from './oauth'
import { cuentaPorId, esSinMigracion } from './cuenta'

export async function abrirCuenta(perfilId: unknown): Promise<{ sesion: AmazonSession; cuenta: NonNullable<Awaited<ReturnType<typeof cuentaPorId>>> } | NextResponse> {
  const sesion = await requireAppDeCuentas('marketing-test')
  if (sesion instanceof NextResponse) return sesion
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
