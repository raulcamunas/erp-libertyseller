import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { aplicarPropuesta, descartarPropuesta, proponerFicha, propuestasDe } from '@/lib/seo/propuesta-servidor'
import { abrirCuentaSeo, errorDeRutaSeo } from '@/lib/seo/ruta'

/**
 * SEO TEST · LAS PROPUESTAS DE FICHA CON IA DE UN PRODUCTO. Solo administradores.
 *
 *   GET  ?cuenta=&asin=                          → las últimas propuestas
 *   POST {cuenta, asin, accion: 'proponer'}      → la IA escribe una propuesta y se guarda PENDIENTE. No toca Amazon
 *   POST {cuenta, id, accion: 'aplicar'}         → ESCRIBE EN LA FICHA DEL CLIENTE (valida antes en Amazon). Solo desde el botón «Aplicar en Amazon», con confirmación
 *   POST {cuenta, id, accion: 'descartar'}
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

const SIN_MIGRACION = 'Falta lanzar la migración 299 en Supabase: sin ella no hay dónde guardar las propuestas.'

export async function GET(request: NextRequest) {
  try {
    const a = await abrirCuentaSeo(request.nextUrl.searchParams.get('cuenta'))
    if (a instanceof NextResponse) return a
    const asin = (request.nextUrl.searchParams.get('asin') ?? '').trim().toUpperCase()
    if (!/^[A-Z0-9]{10}$/.test(asin)) return fail(400, 'Falta el ASIN.')
    return NextResponse.json({ propuestas: await propuestasDe(a.connectionId, a.marketplaceId, asin) })
  } catch (error) {
    if (isMissingSchema(error)) return NextResponse.json({ propuestas: [], sinMigracion: true })
    return errorDeRutaSeo(error, 'SEO: leer las propuestas')
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { cuenta?: unknown; asin?: unknown; id?: unknown; accion?: unknown }
    const a = await abrirCuentaSeo(body.cuenta)
    if (a instanceof NextResponse) return a
    const c = { connectionId: a.connectionId, marketplaceId: a.marketplaceId, clientId: a.clientId }
    if (body.accion === 'proponer') {
      const asin = typeof body.asin === 'string' ? body.asin.trim().toUpperCase() : ''
      if (!/^[A-Z0-9]{10}$/.test(asin)) return fail(400, 'Falta el ASIN.')
      return NextResponse.json({ propuesta: await proponerFicha(c, asin, a.sesion.userId) })
    }
    const id = typeof body.id === 'string' && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : null
    if (!id) return fail(400, 'Falta la propuesta.')
    if (body.accion === 'descartar') {
      await descartarPropuesta(c, id)
      return NextResponse.json({ ok: true })
    }
    if (body.accion === 'aplicar') {
      const r = await aplicarPropuesta(c, id, a.sesion.userId)
      if (!r.ok) return NextResponse.json({ error: r.motivo, issues: r.issues }, { status: 409 })
      return NextResponse.json(r)
    }
    return fail(400, 'Acción desconocida.')
  } catch (error) {
    if (isMissingSchema(error)) return fail(409, SIN_MIGRACION)
    if (error instanceof Error && !('humanMessage' in error)) {
      console.error('SEO: propuesta de ficha:', error)
      return fail(400, error.message)
    }
    return errorDeRutaSeo(error, 'SEO: propuesta de ficha')
  }
}
