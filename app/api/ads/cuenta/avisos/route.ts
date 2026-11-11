import { NextResponse, type NextRequest } from 'next/server'
import { avisosDeCuenta } from '@/lib/ads/avisos'
import { abrirCuenta, errorDeRuta } from '@/lib/ads/ruta'

/** LOS AVISOS DE UNA CUENTA (Marketing Test): sin presupuesto, gasto sin ventas, sin stock, problemas de la cuenta. Solo administradores. Solo lee.  GET ?perfilId= */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const a = await abrirCuenta(request.nextUrl.searchParams.get('perfilId'))
    if (a instanceof NextResponse) return a
    return NextResponse.json({ avisos: await avisosDeCuenta(a.cuenta) })
  } catch (error) {
    return errorDeRuta(error, 'Ads: leer los avisos de la cuenta')
  }
}
