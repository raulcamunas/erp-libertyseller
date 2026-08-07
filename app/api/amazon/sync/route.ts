import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import {
  loadConnection,
  loadListings,
  loadSubmissionAuthors,
  loadSubmissions,
  pickMarketplace,
  syncConnectionCatalog,
} from '@/lib/amazon/data'

/**
 * EL BOTÓN DE REFRESCAR: va a Amazon de verdad y vuelve con el catálogo.
 *
 * Refresca UN marketplace, el que se está mirando, y no la conexión entera. Un
 * cliente europeo puede vender en cuatro países: barrer los cuatro para
 * enseñar uno son cuatro veces más peticiones y cuatro veces más espera con la
 * persona delante mirando un botón que gira. Los otros tres los mantiene al día
 * el ciclo de cada quince minutos, que es su trabajo.
 *
 * Devuelve el catálogo ya releído además del resultado del barrido, para que la
 * pantalla no tenga que encadenar una segunda petición y enseñe siempre lo que
 * hay, no lo que había.
 *
 * Se hace un barrido COMPLETO y no incremental (fetchCatalog admite
 * `updatedAfter`). Quien pulsa este botón suele estar comprobando algo que
 * acaba de cambiar o que no cuadra: un barrido incremental le devolvería
 * exactamente el subconjunto que Amazon considera modificado, que es justo lo
 * que está en duda. Los incrementales son para el ciclo automático.
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

    if (!connection.is_active || connection.status !== 'activa') {
      return fail(
        409,
        connection.status_detail ??
          'Esta cuenta no está conectada ahora mismo, así que no se puede leer su catálogo'
      )
    }

    const pedido = typeof body.marketplaceId === 'string' ? body.marketplaceId.trim() : null
    const marketplaceId = pickMarketplace(connection, pedido)
    if (!marketplaceId) {
      return fail(400, 'Este cliente no nos ha autorizado a trabajar en ese país')
    }

    const results = await syncConnectionCatalog(connectionId, { marketplaceId })

    // Se releen la conexión y el catálogo DESPUÉS del barrido: el barrido acaba
    // de escribir last_sync_at, last_sync_error y, si el token ya no valía, el
    // estado de la conexión. Devolver la fila que se leyó antes enseñaría en
    // pantalla un «refrescado hace un momento» sobre datos que no se han
    // movido, que es la peor combinación posible.
    const [fresca, listings, submissions] = await Promise.all([
      loadConnection(connectionId),
      loadListings(connectionId, marketplaceId),
      loadSubmissions(connectionId),
    ])

    return NextResponse.json({
      connection: fresca ?? connection,
      marketplaceId,
      listings,
      submissions,
      authors: await loadSubmissionAuthors(submissions),
      results,
      fetchedAt: new Date().toISOString(),
    })
  } catch (error) {
    return errorResponse(error, 'Error refrescando el catálogo de Amazon')
  }
}
