import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { loadAmazonData, retryConnection } from '@/lib/amazon/data'

/**
 * REINTENTA UNA CONEXIÓN MARCADA Y, SI AMAZON RESPONDE, LA REACTIVA.
 *
 * ES EL ÚNICO CAMINO DE VUELTA QUE HAY. Sin esta ruta, una conexión que caía en
 * 'error' —basta un 403 pasajero de Amazon, o que fallara el descubrimiento de
 * marketplaces al autorizar— se quedaba muerta para siempre: el ciclo de quince
 * minutos solo barre las activas, el botón de refrescar contesta 409 y enviar
 * cambios lanza. Lo único que ofrecía la pantalla era «Desconectar», o sea
 * destruir la llave y pedirle al cliente que volviera a autorizar.
 *
 * NO REACTIVA A CIEGAS: llama a getMarketplaceParticipations, que es la prueba
 * más barata de que el token sigue valiendo y de que los permisos están. Si
 * Amazon no contesta, el estado se queda como estaba y se devuelve el motivo.
 * Un botón que dijera «arreglado» sin comprobarlo solo movería el fallo al
 * siguiente envío de precios, que es donde sale caro.
 *
 * Devuelve la vista entera recargada, como el resto de escrituras del módulo,
 * para que la pantalla no tenga que encadenar una segunda petición.
 */
export const dynamic = 'force-dynamic'

export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    if (!UUID.test(params.id)) return fail(400, 'Esa conexión no existe')

    const { ok, message } = await retryConnection(params.id)
    const data = await loadAmazonData()

    return NextResponse.json({ ...data, retried: ok, message })
  } catch (error) {
    return errorResponse(error, 'Error reintentando una conexión de Amazon')
  }
}
