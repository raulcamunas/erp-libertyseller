import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { informeDe, listarVerificaciones } from '@/lib/stock-sync/verificacion-consulta'

/**
 * VERIFICACIONES DE STOCK · LO QUE USA LA PANTALLA.
 *
 *   lista     las últimas verificaciones de un cliente (sin el informe).
 *   detalle   el informe de UNA: qué SKU quedaron mal y por qué.
 *
 * Solo lee. Solo admin, como todo lo de Growth Partner. El cliente se comprueba
 * en cada consulta: un id de verificación solo no basta para pedir lo de otro.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => ({}))) as { accion?: string; clienteId?: string; id?: string }
    const clienteId = (body.clienteId ?? '').trim()
    if (!UUID.test(clienteId)) return fail(400, 'Cliente no válido.')

    if (body.accion === 'lista') {
      return NextResponse.json({ ok: true, lista: await listarVerificaciones(clienteId) })
    }
    if (body.accion === 'detalle') {
      const id = (body.id ?? '').trim()
      if (!UUID.test(id)) return fail(400, 'Verificación no válida.')
      const d = await informeDe(clienteId, id)
      if (!d) return fail(404, 'No existe esa verificación.')
      return NextResponse.json({ ok: true, ...d })
    }
    return fail(400, 'Acción desconocida.')
  } catch (error) {
    return errorResponse(error, 'Error en las verificaciones de stock')
  }
}
