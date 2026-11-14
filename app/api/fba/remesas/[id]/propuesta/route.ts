import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { puedeEditar, requireFbaAccess } from '@/lib/fba/acceso'
import { devolverPropuesta, enviarPropuesta } from '@/lib/fba/portal'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * LA PROPUESTA POR ENLACE, DESDE LA AGENCIA.
 *
 * POST { accion: 'enviar' }    toma la FOTO de lo propuesto (unidades_propuestas) y se la deja al cliente
 *                              en su enlace. Volver a mandarla borra sus cambios: es otra propuesta.
 * POST { accion: 'devolver' }  quita el «Acepto» del cliente para que siga tocándola.
 *
 * Solo la agencia (admin o empleado). Aprobar va por /estado, como siempre.
 */
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (!UUID.test(params.id)) return fail(400, 'Esa propuesta no existe')
    const sesion = await requireFbaAccess('editar')
    if (sesion instanceof NextResponse) return sesion
    if (sesion.actor !== 'agencia') return fail(403, 'Esto lo hace Liberty Seller')

    const { data } = await createServiceClient().from('fba_remesas').select('client_id').eq('id', params.id).maybeSingle()
    const clienteId = (data as { client_id: string } | null)?.client_id
    if (!clienteId || !puedeEditar(sesion, clienteId)) return fail(404, 'Esa propuesta ya no existe')

    const body = (await request.json().catch(() => ({}))) as { accion?: unknown }
    if (body.accion === 'enviar') {
      const r = await enviarPropuesta(params.id, sesion.userId, sesion.actor)
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.estado })
      return NextResponse.json({ ok: true, version: r.version })
    }
    if (body.accion === 'devolver') {
      const r = await devolverPropuesta(params.id, sesion.userId, sesion.actor)
      if (!r.ok) return NextResponse.json({ error: r.error, conflicto: r.conflicto ?? false }, { status: r.estado })
      return NextResponse.json({ ok: true })
    }
    return fail(400, 'Esa acción no existe')
  } catch (error) {
    return errorResponse(error, 'No se ha podido actualizar la propuesta')
  }
}
