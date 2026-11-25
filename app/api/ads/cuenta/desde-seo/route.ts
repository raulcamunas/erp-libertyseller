import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { abrirCuenta, errorDeRuta } from '@/lib/ads/ruta'
import { desdeSeo } from '@/lib/ads/desde-seo-servidor'

/**
 * LAS PALABRAS QUE VIENEN DE SEO PARA UN PRODUCTO DE MARKETING TEST (lib/ads/desde-seo*.ts). Quien lleva cuentas (lib/cuentas/acceso.ts). Solo LEE.
 *
 *   GET ?perfilId=&asin=   → { estado, periodo, palabras: PalabraDesdeSeo[] }
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  try {
    const p = request.nextUrl.searchParams
    const a = await abrirCuenta(p.get('perfilId'))
    if (a instanceof NextResponse) return a
    const asin = (p.get('asin') ?? '').trim().toUpperCase()
    if (!/^[A-Z0-9]{10}$/.test(asin)) return fail(400, 'Falta el ASIN.')
    return NextResponse.json(await desdeSeo(a.cuenta, asin))
  } catch (error) {
    return errorDeRuta(error, 'Ads: palabras desde SEO')
  }
}
