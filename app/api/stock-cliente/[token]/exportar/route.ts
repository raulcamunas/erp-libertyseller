import { NextResponse, type NextRequest } from 'next/server'
import { exportarAuditor } from '@/lib/auditor-stock/exportar'
import { enlaceConSesion } from '@/lib/trafico/acceso'

/** El historial del auditor en CSV (`?horas=`, o `?tipo=precios`), para el cliente con su enlace y clave. Solo lee lo guardado */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

export async function GET(request: NextRequest, { params }: { params: { token: string } }) {
  const e = await enlaceConSesion(request, params.token, 'stock')
  if (e === null) return NextResponse.json({ error: 'Este enlace no existe o ya no está activo.' }, { status: 404 })
  if (e === 'clave') return NextResponse.json({ error: 'Hace falta la clave.' }, { status: 401 })
  return exportarAuditor(request)
}
