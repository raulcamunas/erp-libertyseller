import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { avanzarSeo, leerEstadoSeo } from '@/lib/seo/lectura'
import { consultasDelAnterior, consultasGuardadas, evolucionDeCuenta, fichasGuardadas, productosSeguidos } from '@/lib/seo/datos'
import { abrirCuentaSeo, errorDeRutaSeo } from '@/lib/seo/ruta'

/**
 * SEO TEST · TODO LO DE UNA CUENTA Y PAÍS. Solo administradores. Solo LEE de Amazon.
 *
 *   GET  ?cuenta=connectionId~marketplaceId   → estado de la lectura (y del acceso a Brand Analytics), productos seguidos, búsquedas del último mes y semana, y fichas; con la migración 299,
 *                                              también la evolución de cada producto y las búsquedas del periodo anterior (para comparar)
 *   POST {cuenta, accion: 'actualizar'}         → vuelve a leer ya (fichas e informe), sin esperar al proceso de fondo
 *
 * Cada GET da también UN paso de la lectura (como Marketing Test): la pantalla no depende de que el proceso de fondo haya pasado justo ahora.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  try {
    const a = await abrirCuentaSeo(request.nextUrl.searchParams.get('cuenta'))
    if (a instanceof NextResponse) return a
    const c = { connectionId: a.connectionId, marketplaceId: a.marketplaceId }
    await avanzarSeo(c).catch((e) => console.error('SEO: paso de lectura desde la pantalla:', e instanceof Error ? e.message : e))
    const [estado, productos, mes, semana, fichas, evolucion, mesAnterior, semanaAnterior] = await Promise.all([
      leerEstadoSeo(c),
      productosSeguidos(c.connectionId, c.marketplaceId),
      consultasGuardadas(c.connectionId, c.marketplaceId, 'MONTH'),
      consultasGuardadas(c.connectionId, c.marketplaceId, 'WEEK'),
      fichasGuardadas(c.connectionId, c.marketplaceId),
      evolucionDeCuenta(c.connectionId, c.marketplaceId),
      consultasDelAnterior(c.connectionId, c.marketplaceId, 'MONTH'),
      consultasDelAnterior(c.connectionId, c.marketplaceId, 'WEEK'),
    ])
    return NextResponse.json({
      lectura: {
        acceso: estado?.acceso ?? 'desconocido',
        error: estado?.error ?? null,
        sincronizando: estado?.estado === 'esperando',
        periodoEnCurso: estado?.estado === 'esperando' ? estado.periodo : null,
        fichaLeidaAt: estado?.ficha_leida_at ?? null,
        mesOk: estado?.mes_ok ?? null,
        semanaOk: estado?.semana_ok ?? null,
        mejoras: Boolean(estado?.mejoras),
        competenciaOk: estado?.top_ok ?? null,
        competenciaError: estado?.top_error ?? null,
        competenciaEnCurso: Boolean(estado?.top_report_id),
        periodosLeidos: estado?.periodos_leidos?.length ?? 0,
      },
      productos,
      consultas: { MONTH: mes, WEEK: semana },
      anteriores: { MONTH: mesAnterior, WEEK: semanaAnterior },
      evolucion,
      fichas,
    })
  } catch (error) {
    return errorDeRutaSeo(error, 'SEO: leer la cuenta')
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { cuenta?: unknown; accion?: unknown }
    const a = await abrirCuentaSeo(body.cuenta)
    if (a instanceof NextResponse) return a
    if (body.accion !== 'actualizar') return fail(400, 'Acción desconocida.')
    const r = await avanzarSeo({ connectionId: a.connectionId, marketplaceId: a.marketplaceId }, { forzar: true })
    return NextResponse.json({ ok: true, paso: r })
  } catch (error) {
    return errorDeRutaSeo(error, 'SEO: actualizar la cuenta')
  }
}
