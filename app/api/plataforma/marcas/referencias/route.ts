import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { registrarEvento } from '@/lib/plataforma/eventos'
import {
  FALTA_MIGRACION_MARCAS,
  buscarReferencias,
  marcarListingAMano,
  type FiltroReferencias,
} from '@/lib/plataforma/marcas'
import { faltaEsquema } from '@/lib/plataforma/pantallas'

/**
 * LA EXCEPCIÓN: UNA REFERENCIA SUELTA.
 *
 * Solo admin y siempre de un cliente, como todo lo que cuelga de este módulo.
 *
 * Existe porque ninguna regla por marca cubre el catálogo entero: una marca que
 * es del cliente salvo cuatro referencias que revende, o un producto suyo
 * listado bajo la marca del fabricante. Lo que se decide aquí queda con origen
 * 'manual' y el recálculo lo respeta, así que sobrevive a los barridos.
 *
 * Y SE PUEDE DESHACER. Devolver una referencia a la regla es un tercer valor, no
 * la ausencia de los otros dos: sin él, marcar una a mano sería un viaje de ida
 * y la fila quedaría fuera del recálculo para siempre.
 */
export const dynamic = 'force-dynamic'

const FILTROS: FiltroReferencias[] = ['todas', 'manuales', 'sin_marca', 'propias']

/* ------------------------------------------------------------------ */
/* Buscar                                                              */
/* ------------------------------------------------------------------ */

export async function GET(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const q = request.nextUrl.searchParams

    const clientId = q.get('clientId') ?? ''
    if (!UUID.test(clientId)) return fail(400, 'Elige el cliente cuyas referencias quieres buscar')

    const filtroPedido = q.get('filtro') as FiltroReferencias | null
    const filtro = filtroPedido && FILTROS.includes(filtroPedido) ? filtroPedido : 'todas'

    const limiteCrudo = Number(q.get('limite') ?? '50')
    const limite = Number.isFinite(limiteCrudo) ? Math.min(200, Math.max(1, limiteCrudo)) : 50

    const resultado = await buscarReferencias({ clientId, q: q.get('q'), filtro, limite })

    return NextResponse.json({ ...resultado, leidoAt: new Date().toISOString() })
  } catch (error) {
    if (faltaEsquema(error)) return fail(503, FALTA_MIGRACION_MARCAS)
    return errorResponse(error, 'Error buscando referencias del cliente')
  }
}

/* ------------------------------------------------------------------ */
/* Marcar una                                                          */
/* ------------------------------------------------------------------ */

export async function PATCH(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => ({}))) as {
      clientId?: unknown
      listingId?: unknown
      esMarcaPropia?: unknown
    }

    const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : ''
    if (!UUID.test(clientId)) return fail(400, 'Ese cliente no es válido')

    const listingId = typeof body.listingId === 'string' ? body.listingId.trim() : ''
    if (!UUID.test(listingId)) return fail(400, 'Esa referencia no es válida')

    // Los tres valores significan cosas distintas y ninguno se adivina:
    //   true  -> es marca propia aunque su marca no esté en la lista
    //   false -> no lo es aunque su marca sí esté
    //   null  -> se le devuelve la decisión a la lista de marcas
    // Un `undefined` interpretado como null desharía marcas manuales por un
    // error de tecleo, así que cualquier otra cosa se rechaza.
    if (body.esMarcaPropia !== true && body.esMarcaPropia !== false && body.esMarcaPropia !== null) {
      return fail(
        400,
        'Di si la referencia es marca propia (true), no lo es (false) o vuelve a la lista de marcas (null)'
      )
    }
    const pedido = body.esMarcaPropia as boolean | null

    const referencia = await marcarListingAMano({ clientId, listingId, esMarcaPropia: pedido })
    if (!referencia) return fail(404, 'Esa referencia no es de este cliente')

    const mensaje =
      pedido === null
        ? referencia.esMarcaPropia
          ? 'Vuelve a decidirlo su marca, que está en la lista: queda como marca propia.'
          : 'Vuelve a decidirlo su marca, que no está en la lista: queda como marca ajena.'
        : pedido
          ? 'Marcada como marca propia a mano. El recálculo no la va a deshacer.'
          : 'Marcada como marca ajena a mano. El recálculo no la va a deshacer.'

    await registrarEvento({
      tipo: 'marca_propia_manual',
      severidad: 'info',
      clientId,
      mensaje:
        pedido === null
          ? `Una referencia vuelve a decidirse por la lista de marcas (${referencia.marca ?? 'sin marca'}).`
          : `Una referencia se marca a mano como ${pedido ? 'marca propia' : 'marca ajena'} (${referencia.marca ?? 'sin marca'}).`,
      detalle: { listingId, esMarcaPropia: pedido, resultado: referencia.esMarcaPropia },
      createdBy: session.userId,
      huella: `marca_propia_manual·${Date.now()}`,
    })

    // Solo lo que ha cambiado. El SKU y el título ya los tiene la pantalla, y
    // devolverlos vacíos para rellenar un hueco sería inventarse un dato.
    return NextResponse.json({
      id: listingId,
      marca: referencia.marca,
      esMarcaPropia: referencia.esMarcaPropia,
      origen: referencia.origen,
      mensaje,
    })
  } catch (error) {
    if (faltaEsquema(error)) return fail(503, FALTA_MIGRACION_MARCAS)
    return errorResponse(error, 'Error marcando la referencia')
  }
}
