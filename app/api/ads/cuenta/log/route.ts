import { NextResponse, type NextRequest } from 'next/server'
import { UUID } from '@/lib/amazon/api'
import { leerLog } from '@/lib/ads/cuenta'
import { abrirCuenta, errorDeRuta } from '@/lib/ads/ruta'

/**
 * EL LOG DE CAMBIOS de una cuenta. Solo administradores.
 *
 *   GET ?perfilId=&productoId=&origen=estructura|automatico|manual&limite=
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const p = request.nextUrl.searchParams
    const a = await abrirCuenta(p.get('perfilId'))
    if (a instanceof NextResponse) return a
    const productoId = p.get('productoId')
    const origen = p.get('origen')
    const entradas = await leerLog(a.cuenta.id, {
      productoId: productoId && UUID.test(productoId) ? productoId : null,
      origen: origen === 'estructura' || origen === 'automatico' || origen === 'manual' ? origen : null,
      limite: Number(p.get('limite')) || 200,
    })
    return NextResponse.json({ entradas })
  } catch (error) {
    return errorDeRuta(error, 'Ads: leer el log')
  }
}
