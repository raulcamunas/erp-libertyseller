/**
 * SEO TEST · LO COMÚN DE LAS RUTAS. SOLO SERVIDOR.
 *
 * Sesión de quien lleva cuentas (administrador, o empleado con la casilla de SEO Test: lib/cuentas/acceso.ts), y una cuenta (conexión × país) que exista y esté activa. En middleware.ts todo lo de
 * /api/ es público: esta comprobación es la que manda.
 */

import { NextResponse } from 'next/server'
import { fail, type AmazonSession } from '@/lib/amazon/api'
import { requireAppDeCuentas } from '@/lib/cuentas/acceso'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { AmazonApiError } from '@/lib/amazon/errors'
import { conexionActiva, partirIdDeCuenta } from './datos'

export const APP_SEO_TEST = 'seo-test'

export async function abrirCuentaSeo(id: unknown): Promise<{ sesion: AmazonSession; connectionId: string; marketplaceId: string; clientId: string } | NextResponse> {
  const sesion = await requireAppDeCuentas('seo-test')
  if (sesion instanceof NextResponse) return sesion
  const partes = typeof id === 'string' ? partirIdDeCuenta(id) : null
  if (!partes) return fail(400, 'Falta la cuenta.')
  const conexion = await conexionActiva(partes.connectionId)
  if (!conexion || !conexion.marketplaces.includes(partes.marketplaceId)) return fail(404, 'Esa cuenta de Amazon no existe, no está activa o no vende en ese país.')
  return { sesion, ...partes, clientId: conexion.clientId }
}

export function errorDeRutaSeo(error: unknown, contexto: string): NextResponse {
  if (isMissingSchema(error)) return fail(409, 'Falta lanzar la migración 296 en Supabase: las tablas de SEO Test todavía no existen.')
  if (error instanceof AmazonApiError) {
    console.error(`${contexto}:`, error.message)
    return fail(400, error.humanMessage)
  }
  console.error(`${contexto}:`, error)
  if (error instanceof Error && error.message) return fail(400, error.message)
  return fail(500, 'No se ha podido completar la operación. Vuelve a intentarlo y avisa si sigue fallando')
}
