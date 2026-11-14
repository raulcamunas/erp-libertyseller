import { NextResponse, type NextRequest } from 'next/server'
import { exigirAdmin } from '@/lib/facturacion/acceso'
import { cargarTablero } from '@/lib/facturacion/tablero'
import { errorComoRespuesta } from '@/lib/zoho/books'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/** Todo lo que hay que facturar de un mes, en una sola llamada */
export async function GET(request: NextRequest) {
  const permiso = await exigirAdmin()
  if (!permiso.ok) return NextResponse.json({ error: permiso.mensaje }, { status: permiso.estado })

  const period = request.nextUrl.searchParams.get('period')
  if (!period || !/^\d{4}-\d{2}-01$/.test(period)) {
    return NextResponse.json({ error: 'Falta el mes, o no viene como YYYY-MM-01' }, { status: 400 })
  }

  try {
    const tablero = await cargarTablero(period)
    return NextResponse.json({ ...tablero, zohoOrgId: process.env.ZOHO_ORGANIZATION_ID ?? null })
  } catch (error) {
    const { mensaje, estado } = errorComoRespuesta(error)
    return NextResponse.json({ error: mensaje }, { status: estado })
  }
}
