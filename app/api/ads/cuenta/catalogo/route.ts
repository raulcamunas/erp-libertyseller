import { NextResponse, type NextRequest } from 'next/server'
import { catalogoDeCuenta } from '@/lib/ads/cuenta'
import { abrirCuenta, errorDeRuta } from '@/lib/ads/ruta'

/**
 * LOS PRODUCTOS DE LA CUENTA DE AMAZON DEL CLIENTE (en el país de esta cuenta de anunciante), para elegir cuál anunciar. Solo administradores.
 *
 *   GET ?perfilId=&q=   → hasta 60 listings con ASIN, buscando en SKU, ASIN y título
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const a = await abrirCuenta(request.nextUrl.searchParams.get('perfilId'))
    if (a instanceof NextResponse) return a
    const productos = await catalogoDeCuenta(a.cuenta, request.nextUrl.searchParams.get('q') ?? '')
    return NextResponse.json({ productos })
  } catch (error) {
    return errorDeRuta(error, 'Ads: leer el catálogo de la cuenta')
  }
}
