import { NextResponse, type NextRequest } from 'next/server'
import { UUID, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { cambiosDeEjecucion, cambiosDeLotePrecio } from '@/lib/growth/ejecuciones'

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

    /**
     * DOS CAMINOS, PORQUE LA PROPIEDAD SE COMPRUEBA DE DOS FORMAS.
     *
     * Un lote de stock se valida contra `stock_profile_runs`, que sabe de qué
     * cliente era. Los precios del motor de Entrais NO pasan por esa tabla, así
     * que ese mismo camino los daría siempre por ajenos y devolvería una lista
     * vacía: se comprueban por la conexión de Amazon del cliente.
     *
     * El tipo lo dice quien llama, pero NO es lo que autoriza: las dos funciones
     * comprueban la propiedad por su cuenta. Un `tipo` falseado en la URL cambia
     * por qué tabla se pregunta, no de quién se pueden leer los datos.
     */
    const cambios =
      request.nextUrl.searchParams.get('tipo') === 'precio'
        ? await cambiosDeLotePrecio(batchId, clientId)
        : await cambiosDeEjecucion(batchId, clientId)
    return NextResponse.json({ cambios })
  } catch (error) {
    console.error('Error cargando los cambios de una ejecución:', error)
    return fail(500, 'No se han podido cargar los cambios de esa ejecución')
  }
}
