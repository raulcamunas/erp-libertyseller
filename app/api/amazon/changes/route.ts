import { NextResponse, type NextRequest } from 'next/server'
import { MAX_CHANGES_PER_REQUEST, validateIncomingChange } from '@/lib/amazon/catalogo'
import { UUID, errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import {
  loadConnection,
  loadSubmissionAuthors,
  loadSubmissions,
  pickMarketplace,
  sendChanges,
  type ChangeToSend,
} from '@/lib/amazon/data'

/**
 * ENVÍA UN TRAMO DE CAMBIOS A LA TIENDA DE UN CLIENTE.
 *
 * Es la ruta que de verdad escribe fuera. Todo lo que llega aquí acaba en la
 * ficha de producto de un cliente, así que:
 *
 *   - SE VUELVE A VALIDAR TODO, con validateIncomingChange(), que es la misma
 *     función y los mismos topes que usa la pantalla. La pantalla comprueba
 *     cada número al teclearlo, pero eso corre en el navegador y el navegador
 *     no es de fiar: quien llame aquí directamente se la salta entera.
 *
 *   - EL PAÍS SE COMPRUEBA CONTRA LA AUTORIZACIÓN. Un identificador cambiado en
 *     la petición apuntaría a una tienda que este cliente no nos ha autorizado.
 *
 *   - EL LOTE VIENE PARTIDO. La pantalla manda tramos y no los cuatrocientos
 *     cambios de golpe, por dos razones: se puede enseñar progreso real, y una
 *     petición HTTP de minuto y medio la corta cualquier proxy dejando el envío
 *     a medias. `batchId` es lo que mantiene unidos los tramos en el registro.
 */
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => ({}))) as {
      connectionId?: unknown
      changes?: unknown
      batchId?: unknown
      validateOnly?: unknown
    }

    const connectionId = typeof body.connectionId === 'string' ? body.connectionId.trim() : ''
    if (!UUID.test(connectionId)) return fail(400, 'Elige una cuenta conectada')

    if (!Array.isArray(body.changes) || body.changes.length === 0) {
      return fail(400, 'No hay ningún cambio que enviar')
    }
    if (body.changes.length > MAX_CHANGES_PER_REQUEST) {
      return fail(
        400,
        `No se pueden enviar más de ${MAX_CHANGES_PER_REQUEST} cambios de una vez. La pantalla los parte sola: si estás viendo este mensaje, algo la ha saltado`
      )
    }

    const connection = await loadConnection(connectionId)
    if (!connection) return fail(404, 'Esa cuenta ya no está conectada')

    const permitido = (id: string) => pickMarketplace(connection, id) === id

    const changes: ChangeToSend[] = []
    for (const raw of body.changes) {
      const validado = validateIncomingChange(raw, permitido)
      if (!validado.ok) return fail(400, validado.error)
      changes.push(validado.change)
    }

    const batchId =
      typeof body.batchId === 'string' && UUID.test(body.batchId) ? body.batchId : null

    const resultado = await sendChanges({
      connectionId,
      changes,
      // 'manual' porque estos cambios los ha tecleado alguien en la tabla. El
      // día que la fase 2 empuje los cambios de un fichero procesado, ese
      // camino llamará a sendChanges con source:'fichero' desde su propia ruta,
      // no por aquí: el origen no puede venir del cuerpo de la petición o
      // dejaría de significar nada.
      source: 'manual',
      userId: session.userId,
      batchId,
      validateOnly: body.validateOnly === true,
    })

    // El registro recién escrito, para que la tabla pueda marcar las celdas que
    // acaban de salir y el historial se refresque sin pedirlo aparte. Con los
    // nombres de quien mandó cada uno: si no, las filas que acaban de aparecer
    // saldrían sin autor hasta la siguiente carga.
    const submissions = await loadSubmissions(connectionId)
    const authors = await loadSubmissionAuthors(submissions)

    return NextResponse.json({ ...resultado, submissions, authors })
  } catch (error) {
    return errorResponse(error, 'Error enviando cambios a Amazon')
  }
}
