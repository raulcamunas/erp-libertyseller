import { NextResponse, type NextRequest } from 'next/server'
import { exigirAdmin } from '@/lib/facturacion/acceso'
import { errorComoRespuesta, zohoPdfDeFactura } from '@/lib/zoho/books'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** El PDF de Zoho, exactamente el que se adjunta en el correo */
export async function GET(request: NextRequest) {
  const permiso = await exigirAdmin()
  if (!permiso.ok) return NextResponse.json({ error: permiso.mensaje }, { status: permiso.estado })

  const id = request.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Falta la factura' }, { status: 400 })

  try {
    const pdf = await zohoPdfDeFactura(id)
    return new NextResponse(pdf, {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="factura.pdf"', 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    const { mensaje, estado } = errorComoRespuesta(error)
    return NextResponse.json({ error: mensaje }, { status: estado })
  }
}
