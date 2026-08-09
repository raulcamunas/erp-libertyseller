import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, readText, requireAmazonAdmin } from '@/lib/amazon/api'
import { faltaEsquema } from '@/lib/plataforma/pantallas'
import { FALTAN_MIGRACIONES_COSTES } from '@/lib/plataforma/costes/tipos'
import { borrarTramo } from '@/lib/plataforma/costes/datos'
import { fichaDeSku } from '@/lib/plataforma/costes/pantalla'
import { esFechaIso } from '@/lib/plataforma/costes/vigencia'

/**
 * LA FICHA DE COSTES DE UN SKU: sus tramos, qué rige hoy y quién tocó qué.
 *
 * Solo admin. El SKU viaja desde el navegador, así que el `clientId` va en TODAS
 * las consultas y no solo en la primera: un SKU de otro cliente devolvería los
 * costes de otra tienda.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const params = request.nextUrl.searchParams
    const clientId = params.get('clientId') ?? ''
    if (!UUID.test(clientId)) return fail(400, 'Falta el cliente')

    const sku = (params.get('sku') ?? '').trim()
    if (!sku) return fail(400, 'Falta el SKU')

    const fecha = params.get('fecha')
    if (fecha && !esFechaIso(fecha)) return fail(400, 'La fecha tiene que ser AAAA-MM-DD')

    const ficha = await fichaDeSku(clientId, sku, fecha ?? undefined)
    return NextResponse.json({ ficha })
  } catch (error) {
    if (faltaEsquema(error)) return fail(503, FALTAN_MIGRACIONES_COSTES)
    return errorResponse(error, 'Error cargando la ficha de costes')
  }
}

/**
 * Borra un TRAMO de coste.
 *
 * Existe porque un tramo metido con la fecha equivocada no se arregla metiendo
 * otro: se queda ahí rigiendo un trozo del histórico y los márgenes de esos
 * meses salen con el coste que no era. El motivo es obligatorio y queda en la
 * auditoría junto con la fila entera que se borró.
 *
 * Va por POST y no por DELETE porque necesita cuerpo —el motivo, que es
 * obligatorio— y un motivo en la barra de direcciones acaba en los registros del
 * proxy. `accion` es explícita para que una petición mal formada no borre nada
 * por descuido.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    if (body.accion !== 'borrar_tramo') return fail(400, 'Acción no reconocida')

    const clientId = typeof body.clientId === 'string' ? body.clientId : ''
    if (!UUID.test(clientId)) return fail(400, 'Falta el cliente')

    const id = typeof body.id === 'string' ? body.id : ''
    if (!UUID.test(id)) return fail(400, 'Falta el tramo que se quiere borrar')

    const motivo = readText(body.motivo, 500)
    if (!motivo) return fail(400, 'Hay que decir por qué se borra el tramo')

    const borrado = await borrarTramo(clientId, id, { userId: session.userId, motivo })
    if (!borrado) return fail(404, 'Ese tramo ya no existe, o no es de este cliente')

    return NextResponse.json({ borrado: true })
  } catch (error) {
    if (faltaEsquema(error)) return fail(503, FALTAN_MIGRACIONES_COSTES)
    return errorResponse(error, 'Error borrando el tramo de coste')
  }
}
