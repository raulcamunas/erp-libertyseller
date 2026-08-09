import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, readText, requireAmazonAdmin } from '@/lib/amazon/api'
import { registrarEvento } from '@/lib/plataforma/eventos'
import {
  FALTAN_MIGRACIONES,
  LIMITE_CATALOGO,
  catalogoDeCliente,
  faltaEsquema,
  marcarActivoManual,
  type FiltroSeguimiento,
} from '@/lib/plataforma/pantallas'

/**
 * LA TABLA DE SKU EN SEGUIMIENTO: VERLA Y EDITARLA.
 *
 * Solo admin. Siempre de un cliente.
 *
 *
 * ============ LO ÚNICO QUE SE PUEDE ESCRIBIR DESDE AQUÍ ============
 *
 * `activo_manual` y su motivo. Nada más. Ni el precio, ni el stock, ni el
 * estado: A1 SOLO LEE de Amazon, y esta ruta ni siquiera habla con Amazon —lo
 * que cambia es de qué SKU NOS ocupamos cada día, que es una decisión nuestra
 * sobre nuestro propio proceso.
 *
 * `activo_calculado` tampoco se toca: es de la regla. Machacarlo desde aquí
 * borraría lo que decidió el último recálculo, y el día que alguien quite la
 * marca manual la fila tiene que volver a lo que dice el criterio, no a lo que
 * escribió una persona.
 */
export const dynamic = 'force-dynamic'

const FILTROS: FiltroSeguimiento[] = ['todos', 'dentro', 'fuera', 'manual']

/* ------------------------------------------------------------------ */
/* Ver                                                                 */
/* ------------------------------------------------------------------ */

export async function GET(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const q = request.nextUrl.searchParams

    const clientId = q.get('clientId') ?? ''
    if (!UUID.test(clientId)) return fail(400, 'Elige el cliente cuyo catálogo quieres ver')

    const connectionId = q.get('connectionId')
    if (connectionId && !UUID.test(connectionId)) return fail(400, 'Esa cuenta no es válida')

    const filtroPedido = q.get('filtro') as FiltroSeguimiento | null
    const filtro = filtroPedido && FILTROS.includes(filtroPedido) ? filtroPedido : 'todos'

    const desdeCrudo = Number(q.get('desde') ?? '0')
    const desde = Number.isFinite(desdeCrudo) ? Math.max(0, Math.floor(desdeCrudo)) : 0

    const resultado = await catalogoDeCliente({
      clientId,
      connectionId,
      marketplaceId: q.get('marketplaceId'),
      q: q.get('q'),
      filtro,
      desde,
      limite: LIMITE_CATALOGO,
    })

    return NextResponse.json({ ...resultado, filtro, leidoAt: new Date().toISOString() })
  } catch (error) {
    if (faltaEsquema(error)) return fail(503, FALTAN_MIGRACIONES)
    return errorResponse(error, 'Error leyendo el catálogo de la plataforma')
  }
}

/* ------------------------------------------------------------------ */
/* Marcar a mano                                                       */
/* ------------------------------------------------------------------ */

/** Tope de SKU por operación. No es la base: es que una marca manual sobre
    trescientas referencias de golpe casi nunca es lo que alguien quería hacer,
    y deshacerla es otra operación de trescientas */
const MAX_MARCAR = 200

export async function PATCH(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => ({}))) as {
      clientId?: unknown
      listingIds?: unknown
      activo?: unknown
      motivo?: unknown
    }

    const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : ''
    if (!UUID.test(clientId)) return fail(400, 'Ese cliente no es válido')

    const listingIds = Array.isArray(body.listingIds)
      ? [
          ...new Set(
            body.listingIds.filter((id): id is string => typeof id === 'string' && UUID.test(id))
          ),
        ]
      : []
    if (listingIds.length === 0) return fail(400, 'Elige al menos un SKU')
    if (listingIds.length > MAX_MARCAR) {
      return fail(400, `De una vez se pueden marcar ${MAX_MARCAR} SKU como mucho`)
    }

    // `activo` admite tres valores y los tres significan algo distinto:
    //   true  -> lo sigue a diario aunque la regla diga que no
    //   false -> no lo sigue aunque la regla diga que sí
    //   null  -> se le devuelve la decisión a la regla
    // Cualquier otra cosa se rechaza en vez de interpretarse: un `undefined` que
    // se leyera como null borraría marcas manuales por un error de tecleo.
    if (body.activo !== true && body.activo !== false && body.activo !== null) {
      return fail(400, 'Di si el SKU se sigue (true), no se sigue (false) o vuelve a la regla (null)')
    }
    const activo = body.activo as boolean | null

    const motivo = readText(body.motivo, 400)
    if (activo !== null && !motivo) {
      return fail(
        400,
        'Di por qué se decide a mano. Sin motivo, dentro de tres meses nadie sabe por qué este SKU no se refresca'
      )
    }

    const { cambiados } = await marcarActivoManual({ clientId, listingIds, activo, motivo })

    if (cambiados === 0) {
      return fail(404, 'Ninguno de esos SKU es de este cliente')
    }

    // LA CONSTANCIA DE QUIÉN LO HIZO. amazon_listings no tiene columna para el
    // autor y no se le añade una desde una pantalla; amazon_eventos sí la tiene,
    // y por el trigger de la migración 123 un evento con persona detrás NO hace
    // sonar la campana: quien lo provocó está mirando. Es un registro, no una
    // alarma.
    await registrarEvento({
      tipo: 'seguimiento_manual',
      severidad: 'info',
      clientId,
      mensaje:
        activo === null
          ? `${cambiados} SKU vuelven a decidirse por la regla del cliente.`
          : `${cambiados} SKU ${activo ? 'entran' : 'salen'} del seguimiento diario a mano: ${motivo}`,
      detalle: { listingIds, activo },
      createdBy: session.userId,
      // Sin huella estable a propósito: cada decisión manual es un suceso
      // distinto y tiene que quedar constancia de todas, no solo de la primera.
      huella: `seguimiento_manual·${Date.now()}`,
    })

    return NextResponse.json({
      cambiados,
      mensaje:
        activo === null
          ? `${cambiados} SKU vuelven a la regla. En el próximo recálculo se les escribe el motivo del criterio.`
          : `${cambiados} SKU marcados. Lo manual gana sobre la regla, así que el recálculo nocturno no lo va a deshacer.`,
    })
  } catch (error) {
    if (faltaEsquema(error)) return fail(503, FALTAN_MIGRACIONES)
    return errorResponse(error, 'Error marcando SKU en seguimiento')
  }
}
