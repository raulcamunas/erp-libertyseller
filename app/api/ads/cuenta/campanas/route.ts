import { NextResponse, type NextRequest } from 'next/server'
import { campanasDe } from '@/lib/ads/campanas'
import { abrirCuenta, errorDeRuta } from '@/lib/ads/ruta'

/**
 * LAS CAMPAÑAS QUE YA HAY EN LA CUENTA, en vivo contra Amazon (activas, pausadas y archivadas). Solo administradores. Solo LEE.
 *
 *   GET ?perfilId=   → {campanas: [{campaignId, nombre, estado, segmentacion, presupuesto, estrategiaPuja, topDeBusquedas}], total, truncado}
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  try {
    const a = await abrirCuenta(request.nextUrl.searchParams.get('perfilId'))
    if (a instanceof NextResponse) return a
    const r = await campanasDe(a.cuenta.conexionId, a.cuenta.profileId)
    return NextResponse.json({
      campanas: r.campanas.map((c) => ({ campaignId: c.campaignId, nombre: c.nombre, estado: c.estado, segmentacion: c.segmentacion, presupuesto: c.presupuesto, estrategiaPuja: c.estrategiaPuja, topDeBusquedas: c.topDeBusquedas })),
      total: r.total,
      truncado: r.truncado,
    })
  } catch (error) {
    return errorDeRuta(error, 'Ads: leer las campañas de la cuenta')
  }
}
