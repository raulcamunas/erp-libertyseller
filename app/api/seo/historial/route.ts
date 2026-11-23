import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { AMAZON_MARKETPLACES } from '@/lib/types/amazon'
import { historialDeConsultas, productosSeguidos } from '@/lib/seo/datos'
import { domingoDeLaSemana } from '@/lib/seo/periodo-mostrado'
import { gastoSemanalPorAsin, perfilesAdsDe } from '@/lib/seo/publicidad'
import { sinVentasPorAsin } from '@/lib/seo/sin-stock-servidor'
import { abrirCuentaSeo, errorDeRutaSeo } from '@/lib/seo/ruta'

/**
 * SEO TEST · EL HISTORIAL DE LAS BÚSQUEDAS. Mismos permisos que /api/seo/cuenta (lib/seo/ruta.ts). Solo LEE lo guardado: ni Amazon ni escrituras.
 *
 *   GET ?cuenta=&asin=&semanas=&meses=   → { filas: ConsultaHistorica[], gastoSemanal: Array<{asin, desde, gasto}> | null }
 *       · sin semanas ni meses: todas las semanas y meses leídos; con uno de los dos, solo ese tipo.
 *       · nunca pasa del periodo que se enseña (la semana a medias no entra).
 *       · sinVentas: por ASIN, los tramos de días sin ninguna venta en FBA (libro mayor) de los últimos 150 días: probable rotura de stock (lib/seo/sin-stock.ts). null si falla.
 *       · gastoSemanal: el gasto de publicidad por ASIN y semana (domingo a sábado) de las campañas con el ASIN en el nombre. null si el cliente no tiene Marketing Test en ese país.
 *
 * Va aparte de /api/seo/cuenta para no frenar la primera pintura: la pantalla lo pide después.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const entero = (v: string | null, max: number): number | null => {
  if (v == null || v.trim() === '') return null
  const x = Math.floor(Number(v))
  return Number.isFinite(x) && x > 0 ? Math.min(x, max) : null
}

export async function GET(request: NextRequest) {
  try {
    const p = request.nextUrl.searchParams
    const a = await abrirCuentaSeo(p.get('cuenta'))
    if (a instanceof NextResponse) return a
    const asinCrudo = (p.get('asin') ?? '').trim().toUpperCase()
    if (asinCrudo && !/^[A-Z0-9]{10}$/.test(asinCrudo)) return fail(400, 'Ese ASIN no es válido.')
    const asin = asinCrudo || null
    const semanas = entero(p.get('semanas'), 104)
    const meses = entero(p.get('meses'), 36)

    const filas = await historialDeConsultas(a.connectionId, a.marketplaceId, { asin, semanas, meses })

    // El gasto de publicidad no tumba el historial: si falla, se enseña sin él
    let gastoSemanal: Awaited<ReturnType<typeof gastoSemanalPorAsin>> | null = null
    try {
      const pais = AMAZON_MARKETPLACES.find((m) => m.id === a.marketplaceId)?.countryCode ?? ''
      const perfiles = await perfilesAdsDe(a.clientId, pais)
      if (perfiles.length > 0) {
        const asins = asin ? [asin] : (await productosSeguidos(a.connectionId, a.marketplaceId)).map((x) => x.asin)
        const semanasLeidas = filas.filter((f) => f.periodo === 'WEEK').map((f) => f.desde)
        const primera = semanasLeidas.length ? semanasLeidas.reduce((m, d) => (d < m ? d : m)) : domingoDeLaSemana(new Date(Date.now() - 7 * (semanas ?? 12) * 86_400_000).toISOString().slice(0, 10))
        gastoSemanal = await gastoSemanalPorAsin(perfiles, asins, primera)
      }
    } catch (e) {
      console.error('SEO: gasto semanal de publicidad:', e instanceof Error ? e.message : e)
      gastoSemanal = null
    }

    // Los días sin ventas (probable rotura de stock), del libro mayor de FBA. Tampoco tumba el historial
    let sinVentas: Awaited<ReturnType<typeof sinVentasPorAsin>> | null = null
    try {
      const asins = asin ? [asin] : (await productosSeguidos(a.connectionId, a.marketplaceId)).map((x) => x.asin)
      sinVentas = await sinVentasPorAsin(a.connectionId, asins)
    } catch (e) {
      console.error('SEO: días sin ventas:', e instanceof Error ? e.message : e)
      sinVentas = null
    }

    return NextResponse.json({ filas, gastoSemanal, sinVentas })
  } catch (error) {
    return errorDeRutaSeo(error, 'SEO: leer el historial')
  }
}
