import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { createServiceClient } from '@/lib/supabase/service'
import { marketplaceById } from '@/lib/types/amazon'

/**
 * EN QUÉ MERCADOS DE ESTA CUENTA SE TRABAJA.
 *
 * Guarda `amazon_connections.marketplaces_activos` (migración 134).
 *
 *
 * ============ PARA QUÉ SIRVE ============
 *
 * `marketplace_ids` es lo que dice AMAZON que el vendedor tiene, y dice de más.
 * En la cuenta piloto devuelve OCHO y cuatro son de sandbox —salen en pantalla
 * con el código en crudo porque el ERP no sabe nombrarlos—. Barrerlos es cupo
 * gastado en sitios donde no se vende nada.
 *
 * Y aparte del sandbox está lo normal: un cliente puede vender en España,
 * Francia, Italia y Alemania y a nosotros interesarnos solo España. Hasta esta
 * ruta no había forma de decirlo.
 *
 *
 * ============ VACÍO SIGNIFICA TODOS ============
 *
 * No ninguno. Es lo que hace que la migración no cambie el comportamiento de las
 * conexiones que ya funcionaban: hasta que alguien elige, se sigue trabajando
 * como antes. Quien consume esto es `unidadesDe()` en lib/plataforma/datos.ts.
 *
 * Por eso mandar una lista vacía es una operación legítima —«vuelve a todos»— y
 * no un error de validación.
 *
 *
 * ============ SOLO SE ADMITEN MERCADOS QUE TENGA ESTA CUENTA ============
 *
 * Se cruza contra `marketplace_ids` de la fila. Sin eso se podría guardar un
 * marketplace en el que el cliente no participa, y el resultado no sería un
 * error: sería un trabajo que se encola cada noche, falla contra Amazon y nadie
 * entiende por qué. Un valor imposible se rechaza aquí, que es donde se puede
 * explicar.
 */
export const dynamic = 'force-dynamic'

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    if (!UUID.test(params.id)) return fail(400, 'Esa cuenta no existe')

    const body = (await request.json().catch(() => ({}))) as { mercados?: unknown }
    if (!Array.isArray(body.mercados)) {
      return fail(400, 'Hay que mandar la lista de mercados, aunque sea vacía')
    }

    const pedidos = [...new Set(body.mercados.filter((m): m is string => typeof m === 'string'))]

    const service = createServiceClient()
    const { data: conexion, error: errorLectura } = await service
      .from('amazon_connections')
      .select('id, marketplace_ids')
      .eq('id', params.id)
      .maybeSingle()
    if (errorLectura) throw errorLectura
    if (!conexion) return fail(404, 'Esa cuenta ya no existe')

    const suyos = new Set((conexion.marketplace_ids ?? []) as string[])
    const ajenos = pedidos.filter((m) => !suyos.has(m))
    if (ajenos.length > 0) {
      const nombres = ajenos.map((m) => marketplaceById(m)?.label ?? m).join(', ')
      return fail(
        400,
        `Esta cuenta no participa en ${nombres}, así que no se puede trabajar ahí. ` +
          'Si el cliente ha abierto un mercado nuevo, primero hay que refrescar sus datos de Amazon.'
      )
    }

    const { data, error } = await service
      .from('amazon_connections')
      .update({ marketplaces_activos: pedidos })
      .eq('id', params.id)
      .select('id, marketplace_ids, marketplaces_activos')
      .single()
    if (error) throw error

    return NextResponse.json({ conexion: data })
  } catch (error) {
    return errorResponse(error, 'No se han podido guardar los mercados')
  }
}
