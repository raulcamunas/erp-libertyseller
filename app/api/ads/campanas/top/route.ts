import { NextResponse, type NextRequest } from 'next/server'
import { UUID, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { AdsError } from '@/lib/ads/oauth'
import { perfilParaLlamar } from '@/lib/ads/datos'
import { cambiarTopDeBusquedas } from '@/lib/ads/campanas'

/**
 * CAMBIAR EL AJUSTE DE PUJA DEL TOP DE BÚSQUEDAS.
 *
 * ESTO ESCRIBE EN LA CUENTA DEL CLIENTE Y GASTA SU DINERO. Es la única escritura
 * que tiene hoy el módulo de Marketing, y por eso lleva sus propias cautelas en
 * vez de fiarse de las de la ruta.
 *
 *
 * ============ EL TOPE DE 900 NO ES DECORACIÓN ============
 *
 * Amazon admite hasta un 900 %, y un dedazo —escribir 500 donde iban 50— hace
 * que cada clic desde la primera posición cueste diez veces más. Con
 * presupuestos diarios de diez dólares eso se agota en una mañana, y lo gastado
 * no se recupera.
 *
 * Aquí se comprueba el rango y se rechaza lo que no cuadre. Que la pantalla
 * también lo haga está bien, pero la pantalla se puede saltar.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => ({}))) as {
      perfilId?: string
      campaignId?: string
      porcentaje?: number
    }

    if (!body.perfilId || !UUID.test(body.perfilId)) return fail(400, 'Falta la cuenta.')
    if (!body.campaignId) return fail(400, 'Falta la campaña.')

    const pct = Number(body.porcentaje)
    if (!Number.isFinite(pct) || pct < 0 || pct > 900) {
      return fail(
        400,
        'El ajuste tiene que estar entre 0 y 900 %. Amazon no admite más, y por encima de 100 ' +
          'cada clic desde la primera posición ya cuesta el doble.'
      )
    }

    const perfil = await perfilParaLlamar(body.perfilId)
    if (!perfil) return fail(404, 'Esa cuenta ya no existe.')
    if (!perfil.enUso) return fail(400, `«${perfil.nombre}» está apagada.`)

    await cambiarTopDeBusquedas(perfil.conexionId, perfil.profileId, body.campaignId, pct)
    return NextResponse.json({ ok: true, porcentaje: Math.round(pct) })
  } catch (error) {
    if (error instanceof AdsError) return fail(400, error.message)
    console.error('Error cambiando el ajuste de top de búsquedas:', error)
    return fail(500, 'No se ha podido cambiar el ajuste')
  }
}
