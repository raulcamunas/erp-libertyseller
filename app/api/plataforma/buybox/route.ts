import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { contarSkus } from '@/lib/plataforma/buybox/datos'
import {
  DIAS_VIGENCIA,
  FALTAN_MIGRACIONES,
  configPantalla,
  faltaEsquema,
  listadoBuyBox,
  resumenBuyBox,
} from '@/lib/plataforma/buybox/pantalla'
import { VEREDICTOS, VEREDICTO_LABELS, type Veredicto } from '@/lib/plataforma/buybox/tipos'

/**
 * EL MONITOR DE BUY BOX DE UN CLIENTE.
 *
 * SOLO ADMIN. Y UN CLIENTE POR PETICIÓN, sin excepción: lo que devuelve esta
 * ruta son los precios, la competencia y los diagnósticos del catálogo de una
 * tienda ajena, que es exactamente el dato que el compromiso firmado ante Amazon
 * obliga a mantener separado por cuenta. No hay ninguna variante que devuelva
 * varios clientes, ni medias, ni comparativas, y si algún día alguien la pide
 * hay que pararse y decirlo en vez de buscar un rodeo.
 *
 * En middleware.ts todo lo que empieza por /api/ está en la lista de rutas
 * públicas, así que una ruta de API que no comprueba nada contesta a cualquiera:
 * requireAmazonAdmin() no es una formalidad, es la única puerta que hay.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const params = request.nextUrl.searchParams
    const clientId = params.get('clientId') ?? ''
    if (!UUID.test(clientId)) return fail(400, 'Elige el cliente cuyo monitor de Buy Box quieres ver')

    const connectionId = limpio(params.get('connectionId'))
    if (connectionId && !UUID.test(connectionId)) return fail(400, 'Esa cuenta no es válida')

    const marketplaceId = limpio(params.get('marketplaceId'))
    const busqueda = limpio(params.get('busqueda'))

    // Los veredictos que no existen se descartan en vez de rechazar la petición:
    // un filtro guardado en un enlace no puede tumbar la pantalla el día que se
    // renombre un veredicto.
    const veredictos = (params.get('veredictos') ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter((v): v is Veredicto => VEREDICTOS.includes(v as Veredicto))

    const desdeCrudo = Number(params.get('desde') ?? '0')
    const desde = Number.isFinite(desdeCrudo) ? Math.max(0, Math.floor(desdeCrudo)) : 0
    const limiteCrudo = Number(params.get('limite') ?? '200')
    const limite = Number.isFinite(limiteCrudo) ? Math.min(1000, Math.max(1, limiteCrudo)) : 200

    const resumen = await resumenBuyBox(clientId)
    const listado = await listadoBuyBox({
      clientId,
      connectionId,
      marketplaceId,
      veredictos,
      busqueda,
      desde,
      limite,
    })

    // El coste del barrido se calcula sobre el ámbito REAL: los SKU en
    // seguimiento de la unidad elegida, o de la primera si no hay ninguna. Es lo
    // que permite que la pantalla diga «tu rotación de 7 días son 25 minutos por
    // noche» con el catálogo de este cliente y no con un número de ejemplo.
    const unidad = resumen.find(
      (r) =>
        (!connectionId || r.connection_id === connectionId) &&
        (!marketplaceId || r.marketplace_id === marketplaceId)
    )
    const skusAmbito = unidad
      ? await contarSkus(
          {
            connectionId: unidad.connection_id,
            sellingPartnerId: unidad.selling_partner_id,
            marketplaceId: unidad.marketplace_id,
          },
          { soloActivos: true }
        )
      : 0

    return NextResponse.json({
      resumen,
      filas: listado.filas,
      total: listado.total,
      desde,
      limite,
      config: await configPantalla(clientId, skusAmbito),
      etiquetas: VEREDICTO_LABELS,
      diasVigencia: DIAS_VIGENCIA,
      leidoAt: new Date().toISOString(),
    })
  } catch (error) {
    if (faltaEsquema(error)) return fail(503, FALTAN_MIGRACIONES)
    return errorResponse(error, 'Error leyendo el monitor de Buy Box')
  }
}

function limpio(valor: string | null): string | null {
  if (!valor) return null
  const texto = valor.trim()
  return texto === '' ? null : texto
}
