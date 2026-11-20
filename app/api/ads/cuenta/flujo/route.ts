import { NextResponse, type NextRequest } from 'next/server'
import { DIAS_DEL_FLUJO, leerFlujo, type DiasDelFlujo } from '@/lib/ads/flujo'
import { abrirCuenta, errorDeRuta } from '@/lib/ads/ruta'

/**
 * EL FLUJO DE TÉRMINOS ENTRE CAMPAÑAS Y EL DIARIO POR DÍAS de una cuenta. Quien lleva la cuenta. Solo lee.
 *
 *   GET ?perfilId=&dias=7|14|30&asin=B0…|auto&propuestas=0|1
 *       → { periodo, asin, productos, campanas, flujo, diario, cortado }
 *   Sin `asin`: el diario de toda la cuenta y `flujo` a null. Con `asin=auto`: el producto con más cambios del periodo.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const p = request.nextUrl.searchParams
    const a = await abrirCuenta(p.get('perfilId'))
    if (a instanceof NextResponse) return a
    const diasPedidos = Number(p.get('dias'))
    const dias: DiasDelFlujo = (DIAS_DEL_FLUJO as readonly number[]).includes(diasPedidos) ? (diasPedidos as DiasDelFlujo) : 7
    const asinPedido = (p.get('asin') ?? '').trim().toUpperCase()
    const asin = asinPedido === 'AUTO' || /^B0[A-Z0-9]{8}$/.test(asinPedido) ? asinPedido : null
    const conPropuestas = p.get('propuestas') !== '0'
    return NextResponse.json(await leerFlujo(a.cuenta.id, { dias, asin, conPropuestas }))
  } catch (error) {
    return errorDeRuta(error, 'Ads: leer el flujo')
  }
}
