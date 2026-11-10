import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { avanzar, leerGuardado } from '@/lib/ads/sincronizar'
import { abrirCuenta, errorDeRuta } from '@/lib/ads/ruta'

/**
 * EL RENDIMIENTO DE UNA CUENTA, desde lo que el proceso automático ya ha guardado (informe diario de campañas: periodo y periodo anterior). Solo administradores. Solo LEE de Amazon.
 *
 *   GET  ?perfilId=&dias=7|14|30      → lo guardado, al instante: {hayDatos, sincronizando, actualizadoAt, datosHasta, error, periodos, actual, anterior}
 *   POST {perfilId, accion:'actualizar'} → pide datos nuevos a Amazon ya (sin esperar a las 3 horas); la pantalla sigue preguntando con el GET
 *
 * Cada GET también da UN paso de la lectura: si hay informes pedidos que Amazon ya ha terminado, los recoge; si nunca se ha leído esta cuenta o han pasado más de 3 horas, empieza una lectura nueva. Así la
 * pantalla no depende de que el proceso de fondo haya pasado justo ahora. Mientras tanto devuelve lo que ya hay, sin esperar.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams
    const a = await abrirCuenta(q.get('perfilId'))
    if (a instanceof NextResponse) return a
    const dias = Number(q.get('dias'))
    if (![7, 14, 30].includes(dias)) return fail(400, 'El periodo tiene que ser de 7, 14 o 30 días.')
    await avanzar({ id: a.cuenta.id, conexionId: a.cuenta.conexionId, profileId: a.cuenta.profileId })
    return NextResponse.json(await leerGuardado(a.cuenta.id, dias))
  } catch (error) {
    return errorDeRuta(error, 'Ads: leer el rendimiento de la cuenta')
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { perfilId?: unknown; accion?: unknown }
    const a = await abrirCuenta(body.perfilId)
    if (a instanceof NextResponse) return a
    if (body.accion !== 'actualizar') return fail(400, 'Acción desconocida.')
    const r = await avanzar({ id: a.cuenta.id, conexionId: a.cuenta.conexionId, profileId: a.cuenta.profileId }, { forzar: true })
    return NextResponse.json({ ok: true, accion: r.accion, detalle: r.detalle ?? null })
  } catch (error) {
    return errorDeRuta(error, 'Ads: actualizar el rendimiento de la cuenta')
  }
}
