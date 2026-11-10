import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { descargarFilas, estadoDeInforme, pedirInforme, periodosDe, type Periodo } from '@/lib/ads/rendimiento'
import { abrirCuenta, errorDeRuta } from '@/lib/ads/ruta'

/**
 * EL RENDIMIENTO DE UNA CUENTA (informe diario de campañas, periodo actual y anterior). Solo administradores. Solo LEE.
 *
 *   POST {perfilId, dias: 7|14|30}      → pide los dos informes a Amazon: {actual: {id, desde, hasta}, anterior: {…}}
 *   GET  ?perfilId=&a=<id>&b=<id>       → pregunta por ellos. Si los dos están listos, trae las filas de cada uno; si no, dice cómo van
 *
 * Amazon tarda de segundos a minutos en generarlos: la pantalla pregunta cada pocos segundos hasta que están. No se guarda nada.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const ID = /^[0-9a-zA-Z-]{8,64}$/

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { perfilId?: unknown; dias?: unknown }
    const a = await abrirCuenta(body.perfilId)
    if (a instanceof NextResponse) return a
    const dias = Number(body.dias)
    if (![7, 14, 30].includes(dias)) return fail(400, 'El periodo tiene que ser de 7, 14 o 30 días.')
    const p = periodosDe(new Date().toISOString().slice(0, 10), dias)
    const [ida, idb] = await Promise.all([pedirInforme(a.cuenta.conexionId, a.cuenta.profileId, p.actual), pedirInforme(a.cuenta.conexionId, a.cuenta.profileId, p.anterior)])
    const con = (periodo: Periodo, id: string) => ({ id, desde: periodo.desde, hasta: periodo.hasta })
    return NextResponse.json({ actual: con(p.actual, ida), anterior: con(p.anterior, idb) })
  } catch (error) {
    return errorDeRuta(error, 'Ads: pedir el rendimiento de la cuenta')
  }
}

export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams
    const a = await abrirCuenta(q.get('perfilId'))
    if (a instanceof NextResponse) return a
    const ida = q.get('a') ?? ''
    const idb = q.get('b') ?? ''
    if (!ID.test(ida) || !ID.test(idb)) return fail(400, 'Faltan los informes.')

    const [ea, eb] = await Promise.all([estadoDeInforme(a.cuenta.conexionId, a.cuenta.profileId, ida), estadoDeInforme(a.cuenta.conexionId, a.cuenta.profileId, idb)])
    const fallido = [ea, eb].find((e) => e.estado === 'FAILED')
    if (fallido) return fail(502, `Amazon no ha podido generar el informe${fallido.detalle ? `: ${fallido.detalle}` : '.'}`)
    if (ea.estado !== 'COMPLETED' || eb.estado !== 'COMPLETED' || !ea.url || !eb.url) return NextResponse.json({ listo: false, estados: [ea.estado, eb.estado] })

    const [actual, anterior] = await Promise.all([descargarFilas(ea.url), descargarFilas(eb.url)])
    return NextResponse.json({ listo: true, actual, anterior })
  } catch (error) {
    return errorDeRuta(error, 'Ads: leer el rendimiento de la cuenta')
  }
}
