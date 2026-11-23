import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { guardarHighlightsAMano, migracion334Lanzada } from '@/lib/seo/datos'
import { abrirCuentaSeo, errorDeRutaSeo } from '@/lib/seo/ruta'

/**
 * SEO TEST · LOS ITEM HIGHLIGHTS PUESTOS A MANO (migración 334). Mismos permisos que el resto de SEO Test. No toca Amazon: es lo que hay en Seller Central, copiado
 * para que el ERP lo tenga en cuenta en las recomendaciones mientras la API no lo dé.
 *
 *   POST {cuenta, asin, texto}   → los guarda (texto vacío = los borra)
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { cuenta?: unknown; asin?: unknown; texto?: unknown }
    const a = await abrirCuentaSeo(body.cuenta)
    if (a instanceof NextResponse) return a
    const asin = typeof body.asin === 'string' ? body.asin.trim().toUpperCase() : ''
    if (!/^[A-Z0-9]{10}$/.test(asin)) return fail(400, 'Ese ASIN no es válido.')
    if (body.texto != null && typeof body.texto !== 'string') return fail(400, 'El texto no es válido.')
    const texto = typeof body.texto === 'string' ? body.texto : null
    if (texto && [...texto.trim()].length > 1000) return fail(400, 'Es demasiado largo: los Item Highlights son 125 caracteres.')
    if (!(await migracion334Lanzada())) return fail(409, 'Falta lanzar la migración 334 para guardar los Item Highlights a mano.')
    const ok = await guardarHighlightsAMano(a.connectionId, a.marketplaceId, asin, texto, a.sesion.userId)
    if (!ok) return fail(404, 'Este producto todavía no tiene la ficha leída: pulsa «Actualizar» y vuelve a intentarlo.')
    return NextResponse.json({ ok: true })
  } catch (error) {
    return errorDeRutaSeo(error, 'SEO: guardar los Item Highlights a mano')
  }
}
