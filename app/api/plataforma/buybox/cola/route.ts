import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { conexionesDeCliente } from '@/lib/plataforma/datos'
import { encolarFoep } from '@/lib/plataforma/buybox/datos'
import { FALTAN_MIGRACIONES, faltaEsquema } from '@/lib/plataforma/buybox/pantalla'

/**
 * PEDIR EL FOEP DE UNAS REFERENCIAS SIN ESPERAR SU TURNO.
 *
 * ============ POR QUÉ HAY UNA COLA Y NO SE PIDE Y YA ============
 *
 * `getFeaturedOfferExpectedPriceBatch` va a UNA PETICIÓN CADA TREINTA SEGUNDOS.
 * Pedirlo aquí, dentro de la petición del navegador, dejaría la pantalla
 * esperando medio minuto por cada cuarenta referencias, y el proxy cortaría
 * antes. Así que esto NO llama a Amazon: mete los SKU en la cola y el barrido
 * de la noche —o el que se lance a mano— los sirve por delante de la rotación.
 *
 * Es también la puerta por la que A4 podrá pedir el techo de los candidatos que
 * esté evaluando sin barrer nada.
 */
export const dynamic = 'force-dynamic'

/** Tope por petición. Cuarenta caben en una sola llamada a Amazon */
const MAX_SKUS = 500

export async function POST(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => ({}))) as {
      clientId?: unknown
      connectionId?: unknown
      marketplaceId?: unknown
      skus?: unknown
    }

    const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : ''
    const connectionId = typeof body.connectionId === 'string' ? body.connectionId.trim() : ''
    const marketplaceId =
      typeof body.marketplaceId === 'string' ? body.marketplaceId.trim() : ''

    if (!UUID.test(clientId)) return fail(400, 'Falta el cliente')
    if (!UUID.test(connectionId)) return fail(400, 'Falta la cuenta de Amazon')
    if (marketplaceId === '') return fail(400, 'Falta el país')

    // El identificador de conexión viaja desde el navegador: se comprueba que es
    // de ESE cliente antes de escribir nada. Sin esto, cambiar un identificador
    // en la petición metería trabajo en la cuenta de otro vendedor.
    const conexiones = await conexionesDeCliente(clientId)
    const conexion = conexiones.find((c) => c.id === connectionId)
    if (!conexion) return fail(404, 'Esa cuenta de Amazon no es de este cliente')
    if (!conexion.marketplace_ids.includes(marketplaceId)) {
      return fail(404, 'Esa cuenta no vende en ese país')
    }

    const skus = Array.isArray(body.skus)
      ? [
          ...new Set(
            body.skus
              .filter((s): s is string => typeof s === 'string')
              .map((s) => s.trim())
              .filter((s) => s !== '')
          ),
        ]
      : []

    if (skus.length === 0) return fail(400, 'No has elegido ninguna referencia')
    if (skus.length > MAX_SKUS) {
      return fail(
        400,
        `Se pueden pedir ${MAX_SKUS} referencias como mucho de una vez. Para más, lanza el barrido con «FOEP de todo el ámbito»`
      )
    }

    const encolados = await encolarFoep(
      {
        connectionId,
        sellingPartnerId: conexion.selling_partner_id,
        marketplaceId,
      },
      skus,
      'peticion',
      session.userId
    )

    return NextResponse.json({
      encolados,
      mensaje:
        `${encolados} referencias en cola para pedirles el techo de Amazon. Se sirven en el ` +
        'próximo barrido de precios, por delante de la rotación. No se llama a Amazon ahora: esa ' +
        'operación admite una petición cada treinta segundos y la pantalla se quedaría esperando.',
    })
  } catch (error) {
    if (faltaEsquema(error)) return fail(503, FALTAN_MIGRACIONES)
    return errorResponse(error, 'Error encolando el FOEP')
  }
}
