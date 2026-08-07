import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import {
  SUBMISSIONS_PAGE,
  loadConnection,
  loadSubmissionAuthors,
  loadSubmissions,
} from '@/lib/amazon/data'

/**
 * EL HISTORIAL DE CAMBIOS DE UNA CONEXIÓN, FILTRADO (decisión D).
 *
 * Este registro es la única forma de contestar a la pregunta que algún día hará
 * un cliente: «¿por qué mi producto aparece a otro precio?». Por eso guarda el
 * valor anterior y el nuevo, quién lo mandó, cuándo, y qué contestó Amazon
 * —identificador de envío incluido— y por eso se filtra por SKU y por fecha,
 * que son las dos formas en las que se hace esa pregunta.
 *
 * El filtro se aplica en la base y no aquí. La tabla no se purga nunca, así que
 * traérsela entera para recortarla en el servidor sería exactamente el mismo
 * error que hacerlo en el navegador, un salto más tarde.
 */
export const dynamic = 'force-dynamic'

/** Fechas del formulario: «2026-08-07». Se compara contra created_at */
const DIA = /^\d{4}-\d{2}-\d{2}$/

export async function POST(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => ({}))) as {
      connectionId?: unknown
      sku?: unknown
      from?: unknown
      to?: unknown
      limit?: unknown
    }

    const connectionId = typeof body.connectionId === 'string' ? body.connectionId.trim() : ''
    if (!UUID.test(connectionId)) return fail(400, 'Elige una cuenta conectada')

    const connection = await loadConnection(connectionId)
    if (!connection) return fail(404, 'Esa cuenta ya no está conectada')

    const sku = typeof body.sku === 'string' ? body.sku.trim().slice(0, 200) : null

    const desde = typeof body.from === 'string' && DIA.test(body.from) ? body.from : null
    const hasta = typeof body.to === 'string' && DIA.test(body.to) ? body.to : null

    const limit =
      typeof body.limit === 'number' && Number.isInteger(body.limit) && body.limit > 0
        ? Math.min(body.limit, 1000)
        : SUBMISSIONS_PAGE

    const submissions = await loadSubmissions(connectionId, {
      sku: sku === '' ? null : sku,
      // El día que se elige «hasta» cuenta ENTERO. Con la fecha a pelo, Postgres
      // la lee como su medianoche y un cambio hecho esa misma tarde se queda
      // fuera: se busca «hasta el 7» y no sale lo del 7, que es la forma más
      // rápida de que alguien concluya que el cambio no se hizo.
      from: desde ? `${desde}T00:00:00.000Z` : null,
      to: hasta ? `${hasta}T23:59:59.999Z` : null,
      limit,
    })

    // Los nombres de quien mandó cada cambio. El registro guarda un UUID en
    // created_by, y un UUID en pantalla no contesta «¿quién le tocó el precio a
    // esto?», que es justo para lo que existe este historial.
    const authors = await loadSubmissionAuthors(submissions)

    return NextResponse.json({ submissions, authors, limit })
  } catch (error) {
    return errorResponse(error, 'Error cargando el historial de cambios de Amazon')
  }
}
