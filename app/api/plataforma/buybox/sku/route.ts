import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { conexionesDeCliente } from '@/lib/plataforma/datos'
import { FALTAN_MIGRACIONES, faltaEsquema, historicoSku } from '@/lib/plataforma/buybox/pantalla'

/**
 * EL HISTÓRICO DE BUY BOX DE UN SKU.
 *
 * Es lo que la especificación quiere que sustituya a Keepa para nuestras
 * referencias: porcentaje del tiempo con la oferta destacada, evolución del
 * número de competidores y HASTA DÓNDE HA BAJADO CADA COMPETIDOR. Amazon no da
 * histórico de nada de esto: si no lo hemos guardado nosotros, no existe.
 *
 *
 * ============ LA COMPROBACIÓN QUE NO ES UNA FORMALIDAD ============
 *
 * El `connectionId` viaja desde el navegador, así que ANTES de leer nada se
 * comprueba que esa cuenta es de ESE cliente. Sin esa comprobación, cambiar un
 * identificador en la barra de direcciones enseñaría los precios y la
 * competencia de la tienda de otro vendedor — que es literalmente lo que prohíbe
 * el compromiso firmado ante Amazon.
 */
export const dynamic = 'force-dynamic'

/** Ventana por defecto del histórico */
const DIAS_DEFECTO = 90

export async function GET(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const params = request.nextUrl.searchParams
    const clientId = params.get('clientId') ?? ''
    const connectionId = params.get('connectionId') ?? ''
    const marketplaceId = (params.get('marketplaceId') ?? '').trim()
    const sku = (params.get('sku') ?? '').trim()

    if (!UUID.test(clientId)) return fail(400, 'Falta el cliente')
    if (!UUID.test(connectionId)) return fail(400, 'Falta la cuenta de Amazon')
    if (marketplaceId === '') return fail(400, 'Falta el país')
    if (sku === '') return fail(400, 'Falta la referencia')

    const conexiones = await conexionesDeCliente(clientId)
    const conexion = conexiones.find((c) => c.id === connectionId)
    if (!conexion) {
      return fail(404, 'Esa cuenta de Amazon no es de este cliente')
    }
    if (!conexion.marketplace_ids.includes(marketplaceId)) {
      return fail(404, 'Esa cuenta no vende en ese país')
    }

    const diasCrudo = Number(params.get('dias') ?? String(DIAS_DEFECTO))
    const dias = Number.isFinite(diasCrudo)
      ? Math.min(730, Math.max(1, Math.round(diasCrudo)))
      : DIAS_DEFECTO

    const { historico, competidores } = await historicoSku({
      connectionId,
      marketplaceId,
      sku,
      dias,
    })

    return NextResponse.json({
      historico,
      competidores,
      dias,
      leidoAt: new Date().toISOString(),
    })
  } catch (error) {
    if (faltaEsquema(error)) return fail(503, FALTAN_MIGRACIONES)
    return errorResponse(error, 'Error leyendo el histórico de Buy Box')
  }
}
