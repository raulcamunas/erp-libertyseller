import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { altaRivales, bajaRival, fotografiarCompetencia, rivalesDe, type Rival } from '@/lib/seo/rivales-servidor'
import { asinsDeTexto } from '@/lib/seo/rivales'
import { abrirCuentaSeo, errorDeRutaSeo } from '@/lib/seo/ruta'

/**
 * SEO TEST · LA COMPETENCIA QUE SE SIGUE CADA DÍA. Solo LEE de Amazon.
 *
 *   GET  ?cuenta=                                                      → rivales (última foto y 30 días de precio/BSR) y los cambios detectados
 *   POST {cuenta, accion: 'alta', asins (texto o lista), asinPropio?, origen?}
 *   POST {cuenta, accion: 'baja', id}
 *   POST {cuenta, accion: 'fotografiar'}                                → la foto de hoy de los que falten de esta cuenta (como mucho 40), sin esperar al proceso
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

const SIN_MIGRACION = 'Falta lanzar la migración 312 en Supabase: sin ella no hay dónde guardar la competencia.'
const ORIGENES: Rival['origen'][] = ['manual', 'top_terms', 'cerebro']

export async function GET(request: NextRequest) {
  try {
    const a = await abrirCuentaSeo(request.nextUrl.searchParams.get('cuenta'))
    if (a instanceof NextResponse) return a
    const r = await rivalesDe(a)
    if (!r) return NextResponse.json({ sinMigracion: true, rivales: [], cambios: [] })
    return NextResponse.json(r)
  } catch (error) {
    return errorDeRutaSeo(error, 'SEO: leer la competencia seguida')
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const a = await abrirCuentaSeo(body.cuenta)
    if (a instanceof NextResponse) return a
    const c = { connectionId: a.connectionId, marketplaceId: a.marketplaceId }
    if (body.accion === 'alta') {
      const texto = Array.isArray(body.asins) ? body.asins.filter((x): x is string => typeof x === 'string').join(' ') : typeof body.asins === 'string' ? body.asins : ''
      const asins = asinsDeTexto(texto)
      if (asins.length === 0) return fail(400, 'No veo ningún ASIN: pega ASIN (B0…) o enlaces de Amazon.')
      const propio = typeof body.asinPropio === 'string' && /^[A-Z0-9]{10}$/.test(body.asinPropio) ? body.asinPropio : null
      const origen = ORIGENES.find((o) => o === body.origen) ?? 'manual'
      const n = await altaRivales(c, { asins: asins.filter((x) => x !== propio), asinPropio: propio, origen, userId: a.sesion.userId })
      return NextResponse.json({ ok: true, nuevos: n, pedidos: asins.length })
    }
    if (body.accion === 'baja') {
      const id = typeof body.id === 'string' && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : null
      if (!id) return fail(400, 'Falta el rival.')
      await bajaRival(c, id)
      return NextResponse.json({ ok: true })
    }
    if (body.accion === 'fotografiar') {
      const r = await fotografiarCompetencia(60_000, c)
      return NextResponse.json({ ok: true, ...r })
    }
    return fail(400, 'Acción desconocida.')
  } catch (error) {
    if (isMissingSchema(error)) return fail(409, SIN_MIGRACION)
    return errorDeRutaSeo(error, 'SEO: competencia seguida')
  }
}
