import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { firmarFicha, guardarFicha, leerFicha, quitarFirma } from '@/lib/ads/cuenta'
import { fichaDesdeCuerpo } from '@/lib/ads/validar'
import { abrirCuenta, errorDeRuta } from '@/lib/ads/ruta'

/**
 * LA FICHA DE CUENTA (SOP, sección 05). Solo administradores.
 *
 *   GET  ?perfilId=   → la ficha (con los valores de arranque del SOP si todavía no se ha guardado)
 *   PUT  {perfilId, …campos}      → guarda. Si estaba firmada y cambia algún valor, pierde la firma
 *   POST {perfilId, accion: 'firmar' | 'quitar-firma'}
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const a = await abrirCuenta(request.nextUrl.searchParams.get('perfilId'))
    if (a instanceof NextResponse) return a
    return NextResponse.json({ ficha: await leerFicha(a.cuenta.id) })
  } catch (error) {
    return errorDeRuta(error, 'Ads: leer la ficha de cuenta')
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const a = await abrirCuenta(body.perfilId)
    if (a instanceof NextResponse) return a
    const campos = fichaDesdeCuerpo(body)
    if (!campos.ok) return fail(400, campos.error)
    return NextResponse.json({ ficha: await guardarFicha(a.cuenta.id, campos.campos, a.sesion.userId) })
  } catch (error) {
    return errorDeRuta(error, 'Ads: guardar la ficha de cuenta')
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { perfilId?: unknown; accion?: unknown }
    const a = await abrirCuenta(body.perfilId)
    if (a instanceof NextResponse) return a
    if (body.accion === 'firmar') return NextResponse.json({ ficha: await firmarFicha(a.cuenta.id, a.sesion.userId) })
    if (body.accion === 'quitar-firma') return NextResponse.json({ ficha: await quitarFirma(a.cuenta.id) })
    return fail(400, 'Acción desconocida.')
  } catch (error) {
    return errorDeRuta(error, 'Ads: firmar la ficha de cuenta')
  }
}
