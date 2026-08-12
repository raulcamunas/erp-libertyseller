import { NextResponse, type NextRequest } from 'next/server'
import { UUID, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { cambiosDeEjecucion } from '@/lib/growth/ejecuciones'

/**
 * LOS CAMBIOS DE UNA EJECUCIÓN: qué SKU, qué campo, de qué valor a qué valor.
 *
 * El historial se carga entero en el servidor al abrir el submódulo, pero los
 * cambios NO: un solo envío son cientos de filas y traerse los de doscientas
 * ejecuciones para enseñar los de una sería mover megas para pintar una tabla.
 * Se piden al pulsar en la ejecución.
 *
 *
 * ============ POR QUÉ VIAJA TAMBIÉN EL CLIENTE ============
 *
 * El `batch_id` es único, así que en teoría basta con él. En la práctica un id
 * suelto en una URL es lo más fácil de copiar de un sitio a otro, y sin el
 * cliente esta ruta contestaría con los cambios de CUALQUIER vendedor a quien
 * supiera un batch. Los dos van al `where` de la consulta —ver
 * cambiosDeEjecucion()—, que comprueba que ese lote sea de ese cliente antes de
 * leer una sola fila de amazon_submissions.
 *
 * El listón de acceso es el de Growth Partner: admin. No hay una versión de
 * esto para el resto de roles.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const batchId = request.nextUrl.searchParams.get('batch') ?? ''
    const clientId = request.nextUrl.searchParams.get('cliente') ?? ''

    if (!UUID.test(batchId)) return fail(400, 'Ese lote no existe')
    if (!UUID.test(clientId)) return fail(400, 'Ese cliente no existe')

    const cambios = await cambiosDeEjecucion(batchId, clientId)
    return NextResponse.json({ cambios })
  } catch (error) {
    console.error('Error cargando los cambios de una ejecución:', error)
    return fail(500, 'No se han podido cargar los cambios de esa ejecución')
  }
}
