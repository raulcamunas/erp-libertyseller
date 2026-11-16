import { NextResponse } from 'next/server'
import { errorResponse, fail, requireAppAccess } from '@/lib/amazon/api'
import { leerPanelDeInformes } from '@/lib/analisis-amazon/panel-servidor'

/**
 * EL PANEL «INFORMES» DE COLD CALLING: cómo va la recogida de informes (ritmo, colas, turnos y el log de cada uno). SOLO ADMINISTRADORES:
 * el rol sale de la base con la sesión (requireAppAccess), nunca del navegador. Solo lee. Nunca devuelve el token de un informe.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET() {
  const sesion = await requireAppAccess('cold-calling')
  if (sesion instanceof NextResponse) return sesion
  if (sesion.role !== 'admin') return fail(403, 'Solo para administradores')
  try {
    const panel = await leerPanelDeInformes()
    return NextResponse.json(panel, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(e, 'panel de informes')
  }
}
