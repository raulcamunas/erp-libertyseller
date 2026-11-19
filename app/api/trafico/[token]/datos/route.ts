import { NextResponse, type NextRequest } from 'next/server'
import { datosDelPanel, enlaceDelToken, nombreDeCookie, sesionValida } from '@/lib/trafico/servidor'

/**
 * Los datos de la página de tráfico de un cliente: `?desde=&hasta=` (el periodo) y `?compDesde=&compHasta=` (con qué se compara). Hace falta el enlace Y la cookie
 * que deja la clave; sin ella, 401 y la página vuelve a pedir la clave.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest, { params }: { params: { token: string } }) {
  try {
    const e = await enlaceDelToken(params.token)
    if (!e) return NextResponse.json({ error: 'Este enlace no existe o ya no está activo.' }, { status: 404 })
    if (!sesionValida(e, request.cookies.get(nombreDeCookie(e.id))?.value)) return NextResponse.json({ error: 'Hace falta la clave.' }, { status: 401 })
    const q = request.nextUrl.searchParams
    const datos = await datosDelPanel(e, { desde: q.get('desde'), hasta: q.get('hasta'), compDesde: q.get('compDesde'), compHasta: q.get('compHasta') })
    return NextResponse.json(datos, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('[trafico] datos', err)
    return NextResponse.json({ error: 'No se han podido leer los datos. Prueba otra vez en un momento.' }, { status: 500 })
  }
}
