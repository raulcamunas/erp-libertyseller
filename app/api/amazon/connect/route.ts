import { NextResponse, type NextRequest } from 'next/server'
import { AMAZON_REGIONS, type AmazonRegion } from '@/lib/types/amazon'
import { UUID, errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { createConsentLink } from '@/lib/amazon/oauth'

/**
 * GENERA EL ENLACE DE AUTORIZACIÓN QUE SE LE MANDA A UN CLIENTE.
 *
 * Aquí es donde nace el `state`: se guarda en la base ATADO al cliente del ERP
 * y a la región ANTES de que la URL exista, porque cuando el cliente vuelva por
 * /callback, ese `state` va a ser lo único que diga de quién es la autorización
 * que acaba de llegar — Amazon no nos devuelve ni un dato nuestro.
 *
 * Solo admin: quien tenga este enlace puede enganchar una cuenta de Amazon a
 * una ficha de cliente del ERP.
 */
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => ({}))) as {
      clientId?: unknown
      region?: unknown
    }

    const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : ''
    if (!UUID.test(clientId)) return fail(400, 'Elige un cliente antes de generar el enlace')

    const region = typeof body.region === 'string' ? (body.region as AmazonRegion) : null
    if (!region || !AMAZON_REGIONS[region]) {
      return fail(400, 'Elige la región desde la que va a autorizar el cliente')
    }

    // La región de Extremo Oriente no tiene dirección de consentimiento
    // configurada. buildConsentUrl corta con un mensaje que lo explica, y se
    // deja que suba: es mejor que inventarse una URL que fallaría con el
    // cliente delante.
    const link = await createConsentLink({ clientId, region, userId: session.userId })

    return NextResponse.json(link)
  } catch (error) {
    return errorResponse(error, 'Error generando el enlace de autorización de Amazon')
  }
}
