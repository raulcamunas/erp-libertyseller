import { NextResponse, type NextRequest } from 'next/server'
import { enlaceConSesion } from '@/lib/trafico/acceso'
import { datosDelPanelPcc } from '@/lib/pccomponentes/panel-cliente'

/**
 * EL PANEL DE PCCOMPONENTES PARA ENTRAIS (enlace con clave, migración 329). SOLO LEE: desde aquí no se cambia nada de la tienda.
 *   GET ?desde=AAAA-MM-DD&hasta=AAAA-MM-DD
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

export async function GET(request: NextRequest, { params }: { params: { token: string } }) {
  try {
    const e = await enlaceConSesion(request, params.token, 'pccomponentes')
    if (e === null) return NextResponse.json({ error: 'Este enlace no existe o ya no está activo.' }, { status: 404 })
    if (e === 'clave') return NextResponse.json({ error: 'Hace falta la clave.' }, { status: 401 })
    const q = request.nextUrl.searchParams
    return NextResponse.json(await datosDelPanelPcc(q.get('desde'), q.get('hasta')), { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('[pcc-cliente]', err)
    const m = err instanceof Error && err.message === 'Fechas no válidas.' ? err.message : 'No se han podido leer los datos. Prueba otra vez en un momento.'
    return NextResponse.json({ error: m }, { status: m === 'Fechas no válidas.' ? 400 : 500 })
  }
}
