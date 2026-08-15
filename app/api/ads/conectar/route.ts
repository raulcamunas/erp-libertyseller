import { NextResponse, type NextRequest } from 'next/server'
import { UUID, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { faltaConfigurar, type RegionAds } from '@/lib/ads/config'
import { AdsError, urlDeAutorizacion } from '@/lib/ads/oauth'

/**
 * EMPEZAR LA AUTORIZACIÓN DE AMAZON ADS PARA UN CLIENTE.
 *
 * Devuelve la URL a la que hay que mandar al cliente. NO redirige desde aquí:
 * quien pulsa el botón es un admin del ERP, y quien tiene que autorizar es el
 * dueño de la cuenta de Amazon. A veces son la misma persona y a veces hay que
 * mandarle el enlace por correo, así que la ruta devuelve la dirección y que
 * decida la pantalla.
 *
 * Solo admin: esto abre la puerta a la cuenta de publicidad de un cliente.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const falta = faltaConfigurar()
    if (falta) return fail(400, falta)

    const body = (await request.json().catch(() => ({}))) as {
      clienteId?: string
      region?: string
    }

    if (!body.clienteId || !UUID.test(body.clienteId)) {
      return fail(400, 'Falta el cliente sobre el que conectar.')
    }
    const region: RegionAds =
      body.region === 'na' || body.region === 'fe' ? body.region : 'eu'

    const url = await urlDeAutorizacion({
      clienteId: body.clienteId,
      region,
      userId: session.userId,
    })

    return NextResponse.json({ url })
  } catch (error) {
    if (error instanceof AdsError) return fail(400, error.message)
    console.error('Error empezando la autorización de Amazon Ads:', error)
    return fail(500, 'No se ha podido empezar la autorización. Vuelve a intentarlo')
  }
}
