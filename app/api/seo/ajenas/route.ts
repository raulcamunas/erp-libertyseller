import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { decidirBusqueda, FaltaMigracion333, quitarDecision } from '@/lib/seo/ajenas-servidor'
import { abrirCuentaSeo, errorDeRutaSeo } from '@/lib/seo/ruta'

/**
 * SEO TEST · «NO ES NUESTRO PRODUCTO» / «SÍ ES NUESTRO» EN UNA BÚSQUEDA. Quien lleva cuentas con SEO Test. No toca Amazon (es una nota del ERP, como una negativa apuntada).
 *
 *   POST   {cuenta, consulta, decision: 'ajena' | 'nuestra', asin?}  → guarda la decisión para toda la cuenta y país
 *   DELETE {cuenta, consulta}                                         → la quita: vuelve a decidir la heurística
 *
 * Sin la migración 333, 409 con el aviso.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { cuenta?: unknown; consulta?: unknown; decision?: unknown; asin?: unknown }
    const a = await abrirCuentaSeo(body.cuenta)
    if (a instanceof NextResponse) return a
    if (typeof body.consulta !== 'string' || !body.consulta.trim()) return fail(400, 'Falta la búsqueda.')
    if (body.decision !== 'ajena' && body.decision !== 'nuestra') return fail(400, 'Decisión desconocida.')
    const asin = typeof body.asin === 'string' && /^[A-Z0-9]{10}$/.test(body.asin) ? body.asin : null
    await decidirBusqueda(a.connectionId, a.marketplaceId, body.consulta.trim(), body.decision, asin, a.sesion.userId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof FaltaMigracion333) return fail(409, error.message)
    return errorDeRutaSeo(error, 'SEO: decidir búsqueda')
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { cuenta?: unknown; consulta?: unknown }
    const a = await abrirCuentaSeo(body.cuenta)
    if (a instanceof NextResponse) return a
    if (typeof body.consulta !== 'string' || !body.consulta.trim()) return fail(400, 'Falta la búsqueda.')
    await quitarDecision(a.connectionId, a.marketplaceId, body.consulta)
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof FaltaMigracion333) return fail(409, error.message)
    return errorDeRutaSeo(error, 'SEO: quitar decisión de búsqueda')
  }
}
