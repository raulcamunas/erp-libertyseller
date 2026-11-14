import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { competenciaDe, consultasGuardadas } from '@/lib/seo/datos'
import { abrirCuentaSeo, errorDeRutaSeo } from '@/lib/seo/ruta'

/**
 * SEO TEST · QUIÉN SE LLEVA LOS CLICS EN LAS BÚSQUEDAS DE UN PRODUCTO (informe «Top Search Terms» de Brand Analytics, migración 299). Solo administradores. Solo LEE (lo guardado).
 *
 *   GET ?cuenta=&asin=   → {desde, filas: [{consulta, posicion 1-3, asin, cuotaClics, cuotaConversion}]}  · {sinMigracion: true} si falta la 299
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const a = await abrirCuentaSeo(request.nextUrl.searchParams.get('cuenta'))
    if (a instanceof NextResponse) return a
    const asin = (request.nextUrl.searchParams.get('asin') ?? '').trim().toUpperCase()
    if (!/^[A-Z0-9]{10}$/.test(asin)) return fail(400, 'Falta el ASIN.')
    const [mes, semana] = await Promise.all([consultasGuardadas(a.connectionId, a.marketplaceId, 'MONTH'), consultasGuardadas(a.connectionId, a.marketplaceId, 'WEEK')])
    const consultas = [...mes, ...semana].filter((c) => c.asin === asin).map((c) => c.consulta)
    const r = await competenciaDe(a.connectionId, a.marketplaceId, consultas)
    if (!r) return NextResponse.json({ sinMigracion: true, desde: null, filas: [] })
    return NextResponse.json(r)
  } catch (error) {
    return errorDeRutaSeo(error, 'SEO: leer la competencia')
  }
}
