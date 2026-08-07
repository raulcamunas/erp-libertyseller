import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import {
  loadConnection,
  loadListings,
  loadSubmissionAuthors,
  loadSubmissions,
  pickMarketplace,
} from '@/lib/amazon/data'

/**
 * EL CATÁLOGO DE UNA CONEXIÓN EN UN MARKETPLACE.
 *
 * LEE EL ESPEJO, NO LLAMA A AMAZON. Es la diferencia con /api/amazon/sync, y es
 * deliberada: esta ruta la pide la pantalla al abrir un cliente, al cambiar de
 * país y cada quince minutos mientras esté abierta. Si cada una de esas veces
 * saliera una tanda de peticiones hacia Amazon, dos pestañas abiertas se
 * comerían el cupo del cliente sin que nadie hubiera pedido nada. Quien habla
 * con Amazon es el ciclo del cron y el botón de refrescar, que son los dos
 * sitios donde alguien ha decidido que quiere datos nuevos.
 *
 * Va por POST como el resto del módulo aunque solo lea: el cuerpo en JSON
 * evita meter identificadores de cliente en la barra de direcciones, que es
 * donde acaban quedándose en el historial del navegador y en los registros del
 * proxy.
 */
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => ({}))) as {
      connectionId?: unknown
      marketplaceId?: unknown
    }

    const connectionId = typeof body.connectionId === 'string' ? body.connectionId.trim() : ''
    if (!UUID.test(connectionId)) return fail(400, 'Elige una cuenta conectada')

    const connection = await loadConnection(connectionId)
    if (!connection) return fail(404, 'Esa cuenta ya no está conectada')

    const pedido = typeof body.marketplaceId === 'string' ? body.marketplaceId.trim() : null
    const marketplaceId = pickMarketplace(connection, pedido)
    if (!marketplaceId) {
      return fail(400, 'Este cliente no nos ha autorizado a trabajar en ese país')
    }

    const [listings, submissions] = await Promise.all([
      loadListings(connectionId, marketplaceId),
      loadSubmissions(connectionId),
    ])

    return NextResponse.json({
      connection,
      marketplaceId,
      listings,
      submissions,
      authors: await loadSubmissionAuthors(submissions),
      fetchedAt: new Date().toISOString(),
    })
  } catch (error) {
    return errorResponse(error, 'Error cargando el catálogo de Amazon')
  }
}
