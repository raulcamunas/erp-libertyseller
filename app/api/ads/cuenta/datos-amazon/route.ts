import { NextResponse, type NextRequest } from 'next/server'
import { datosDeAmazon } from '@/lib/ads/datos-amazon'
import { abrirCuenta, errorDeRuta } from '@/lib/ads/ruta'

/**
 * LO QUE AMAZON YA SABE DE UN SKU (precio, IVA del país, comisión, tarifa FBA, otros y el coste si está cargado), para rellenar solo el producto de Marketing Test. Solo administradores. Solo lee.
 *
 *   GET ?perfilId=&sku=
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const a = await abrirCuenta(request.nextUrl.searchParams.get('perfilId'))
    if (a instanceof NextResponse) return a
    const sku = (request.nextUrl.searchParams.get('sku') ?? '').trim().slice(0, 200)
    if (!sku) return NextResponse.json({ error: 'Falta el SKU.' }, { status: 400 })
    return NextResponse.json(await datosDeAmazon(a.cuenta, sku))
  } catch (error) {
    return errorDeRuta(error, 'Ads: datos de Amazon de un SKU')
  }
}
