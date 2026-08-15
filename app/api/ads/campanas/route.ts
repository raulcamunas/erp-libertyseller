import { NextResponse, type NextRequest } from 'next/server'
import { UUID, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { AdsError } from '@/lib/ads/oauth'
import { campanasDe } from '@/lib/ads/campanas'
import { perfilParaLlamar } from '@/lib/ads/datos'

/**
 * LAS CAMPAÑAS DE UNA CUENTA DE ANUNCIANTE.
 *
 * En vivo contra Amazon, sin guardar nada. Una campaña cambia de estado y de
 * presupuesto varias veces al día: una copia en la base sería una copia vieja en
 * cuanto alguien tocara algo en Seller Central, y la pantalla estaría mintiendo
 * sin dar ningún error.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => ({}))) as { perfilId?: string }
    if (!body.perfilId || !UUID.test(body.perfilId)) return fail(400, 'Falta la cuenta.')

    const perfil = await perfilParaLlamar(body.perfilId)
    if (!perfil) return fail(404, 'Esa cuenta ya no existe.')
    // La misma cerradura que el banco de pruebas: no se llama a la cuenta de un
    // anunciante que alguien ha decidido no trabajar, ni para leer.
    if (!perfil.enUso) return fail(400, `«${perfil.nombre}» está apagada.`)

    const datos = await campanasDe(perfil.conexionId, perfil.profileId)
    return NextResponse.json(datos)
  } catch (error) {
    if (error instanceof AdsError) return fail(400, error.message)
    console.error('Error trayendo las campañas de Amazon Ads:', error)
    return fail(500, 'No se han podido traer las campañas. Vuelve a intentarlo')
  }
}
