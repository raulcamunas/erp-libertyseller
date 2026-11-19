import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { avanzar, leerGuardado } from '@/lib/ads/sincronizar'
import { rangoValido } from '@/lib/ads/rendimiento'
import { abrirCuenta, errorDeRuta } from '@/lib/ads/ruta'
import { ventasTotales } from '@/lib/ads/ventas-totales'

/**
 * EL RENDIMIENTO DE UNA CUENTA, desde lo que el proceso automático ya ha guardado (informe diario de campañas: periodo y periodo anterior). Solo administradores. Solo LEE de Amazon.
 *
 *   GET  ?perfilId=&dias=7|14|30 (o &desde=&hasta= para un periodo elegido a mano, dentro de los 90 días que se guardan) → lo guardado, al instante: {hayDatos, sincronizando, actualizadoAt, datosHasta, error, periodos, actual, anterior}
 *   POST {perfilId, accion:'actualizar'} → pide datos nuevos a Amazon ya (sin esperar a las 3 horas); la pantalla sigue preguntando con el GET
 *
 * Un GET solo da un paso de la lectura (recoger o pedir a Amazon) cuando la cuenta todavía NO tiene nada guardado (la primera vez): si ya hay cifras, las enseña y
 * deja la lectura al proceso de fondo (cada 2 minutos). Antes cada carga, y cada sondeo de la pantalla, preguntaba a Amazon y competía con el proceso.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams
    const a = await abrirCuenta(q.get('perfilId'))
    if (a instanceof NextResponse) return a
    const conRango = q.has('desde') || q.has('hasta')
    const rango = conRango ? rangoValido(q.get('desde'), q.get('hasta'), new Date().toISOString().slice(0, 10)) : null
    if (conRango && !rango) return fail(400, 'Las fechas del periodo no son válidas (desde antes que hasta, y como tarde ayer).')
    const dias = rango ? 0 : Number(q.get('dias'))
    if (!rango && ![7, 14, 30].includes(dias)) return fail(400, 'El periodo tiene que ser de 7, 14 o 30 días.')
    // Las ventas totales por ASIN (para el TACoS) solo se leen de 7, 14 y 30 días: con un periodo a mano no hay TACoS y se dice
    const sinTacos = { porAsin: {}, leidoAt: null, error: 'El TACoS solo se calcula con los periodos de 7, 14 y 30 días.' }
    const [primero, ventas] = await Promise.all([leerGuardado(a.cuenta.id, dias, rango), rango ? Promise.resolve(sinTacos) : ventasTotales(a.cuenta.id, dias).catch(() => ({ porAsin: {}, leidoAt: null, error: null }))])
    let guardado = primero
    if (!guardado.hayDatos) {
      await avanzar({ id: a.cuenta.id, conexionId: a.cuenta.conexionId, profileId: a.cuenta.profileId })
      guardado = await leerGuardado(a.cuenta.id, dias, rango)
    }
    // Las ventas TOTALES por ASIN del mismo periodo (orgánicas + publicidad), para el TACoS
    return NextResponse.json({ ...guardado, ventasTotales: ventas })
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
