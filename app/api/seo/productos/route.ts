import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { catalogoSeo, dejarDeSeguir, productosDeMarketingTest, seguirProductos } from '@/lib/seo/datos'
import { reiniciarLectura } from '@/lib/seo/lectura'
import { abrirCuentaSeo, errorDeRutaSeo } from '@/lib/seo/ruta'
import { AMAZON_MARKETPLACES } from '@/lib/types/amazon'

/**
 * SEO TEST · LOS PRODUCTOS QUE SE SIGUEN EN UNA CUENTA Y PAÍS. Solo administradores.
 *
 *   GET    ?cuenta=&q=                                → catálogo de la cuenta en ese país, para elegir
 *   POST   {cuenta, productos: [{asin, sku, nombre}]}  → seguir esos productos
 *   POST   {cuenta, accion: 'importar-marketing'}      → seguir los mismos que en Marketing Test (mismo cliente y país)
 *   DELETE {cuenta, id}                                → dejar de seguir uno
 *
 * Añadir o quitar productos vuelve a pedir el mes y la semana a Amazon, ya con la lista nueva.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams
    const a = await abrirCuentaSeo(q.get('cuenta'))
    if (a instanceof NextResponse) return a
    return NextResponse.json({ productos: await catalogoSeo(a.connectionId, a.marketplaceId, q.get('q') ?? '') })
  } catch (error) {
    return errorDeRutaSeo(error, 'SEO: catálogo')
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { cuenta?: unknown; accion?: unknown; productos?: unknown }
    const a = await abrirCuentaSeo(body.cuenta)
    if (a instanceof NextResponse) return a
    let lista: Array<{ asin: string; sku: string | null; nombre: string | null }> = []
    if (body.accion === 'importar-marketing') {
      const pais = AMAZON_MARKETPLACES.find((m) => m.id === a.marketplaceId)?.countryCode ?? ''
      lista = await productosDeMarketingTest(a.clientId, pais)
      if (lista.length === 0) return fail(404, 'No hay productos de este cliente y país en Marketing Test.')
    } else if (Array.isArray(body.productos)) {
      lista = (body.productos as Array<Record<string, unknown>>).slice(0, 100).map((p) => ({ asin: String(p.asin ?? ''), sku: typeof p.sku === 'string' ? p.sku : null, nombre: typeof p.nombre === 'string' ? p.nombre : null }))
    } else return fail(400, 'Faltan los productos.')
    const n = await seguirProductos(a.connectionId, a.marketplaceId, lista, a.sesion.userId)
    await reiniciarLectura({ connectionId: a.connectionId, marketplaceId: a.marketplaceId })
    return NextResponse.json({ ok: true, anadidos: n })
  } catch (error) {
    return errorDeRutaSeo(error, 'SEO: seguir productos')
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { cuenta?: unknown; id?: unknown }
    const a = await abrirCuentaSeo(body.cuenta)
    if (a instanceof NextResponse) return a
    if (typeof body.id !== 'string') return fail(400, 'Falta el producto.')
    await dejarDeSeguir(a.connectionId, a.marketplaceId, body.id)
    await reiniciarLectura({ connectionId: a.connectionId, marketplaceId: a.marketplaceId })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return errorDeRutaSeo(error, 'SEO: dejar de seguir')
  }
}
