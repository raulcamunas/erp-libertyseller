import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, readText, requireAmazonAdmin } from '@/lib/amazon/api'
import { createServiceClient } from '@/lib/supabase/service'
import { loadPerfiles, marcarNoSincroniza } from '@/lib/stock-sync/perfiles'

/**
 * «ESTE CLIENTE NO HACE SINCRONIZACIÓN DE STOCK» — MARCAR Y DESMARCAR.
 *
 * SOLO ADMIN, y no por costumbre: dejar de mandarle stock a un cliente es una
 * decisión comercial con consecuencias en su tienda —el stock se congela en lo
 * último que se subió— y quien la toma tiene que ser quien responde de ella.
 * Además queda firmada: la migración 127 guarda cuándo, quién y por qué.
 *
 * Cuelga de /api/stock-sync y no de /api/amazon aunque la pantalla viva en la
 * pestaña Origen de Amazon API, porque lo que escribe es `stock_clients`, que es
 * del módulo de sincronismo. La ruta sigue al dato, no a la pantalla que la
 * llama: el día que Growth Partner quiera consultar lo mismo, ya está donde le
 * toca.
 *
 * Devuelve la vista de orígenes entera recargada, como el resto de escrituras
 * del módulo, para que la pantalla no encadene una segunda petición ni se quede
 * pintando un estado que ya no es el de la base.
 */
export const dynamic = 'force-dynamic'

/** Lo que cabe en el motivo. Es una frase, no un acta */
const MOTIVO_MAX = 300

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    if (!UUID.test(params.id)) return fail(400, 'Ese cliente no existe')

    const body = (await request.json().catch(() => null)) as {
      noSincroniza?: unknown
      motivo?: unknown
    } | null

    // Booleano estricto y no `Boolean(body.noSincroniza)`: un `"false"` que
    // llegara como cadena —y llegan— marcaría al cliente justo al revés de lo
    // que se ha pulsado, sin dar ningún error.
    if (typeof body?.noSincroniza !== 'boolean') {
      return fail(400, 'Hay que decir si el cliente sincroniza o no')
    }
    const noSincroniza = body.noSincroniza

    // El cliente tiene que existir de verdad. Un UPDATE contra un id inventado
    // no da error en PostgREST: afecta a cero filas y la pantalla se quedaría
    // enseñando un cambio que no se ha guardado en ningún sitio.
    const service = createServiceClient()
    const { data: cliente, error: errorCliente } = await service
      .from('stock_clients')
      .select('id, name')
      .eq('id', params.id)
      .maybeSingle()
    if (errorCliente) throw errorCliente
    if (!cliente) return fail(404, 'Ese cliente no existe en la sincronización de stock')

    await marcarNoSincroniza(params.id, {
      noSincroniza,
      // El motivo solo se guarda al marcar. Al desmarcar se limpia entero, que
      // es lo que exige el CHECK de la 127 y lo que evita dejar una razón
      // caducada colgada de un cliente que ya vuelve a sincronizar.
      motivo: noSincroniza ? readText(body.motivo, MOTIVO_MAX) : null,
      porUsuario: noSincroniza ? session.userId : null,
    })

    return NextResponse.json(await loadPerfiles())
  } catch (error) {
    return errorResponse(error, 'Error guardando la decisión de sincronización')
  }
}
