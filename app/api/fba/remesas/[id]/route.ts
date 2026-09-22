import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { puedeEditar, requireFbaAccess } from '@/lib/fba/acceso'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * CORREGIR O BORRAR UNA REMESA.
 *
 * Corregir la fecha es lo que más se va a usar y por eso el reparto no guarda
 * contadores: se cambia la fecha aquí y TODO el histórico se recalcula solo la
 * próxima vez que alguien abra el panel. Con contadores habría que reprocesar.
 */
export const dynamic = 'force-dynamic'

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (!UUID.test(params.id)) return fail(400, 'Esa remesa no existe')

    const session = await requireFbaAccess('editar')
    if (session instanceof NextResponse) return session

    // La remesa dice de qué cliente es; y ESE cliente tiene que ser editable
    // para esta sesión. Sin esto, un usuario con acceso a un cliente podría
    // corregir remesas de otro conociendo el id.
    const servicio = createServiceClient()
    const { data: duena } = await servicio
      .from('fba_remesas')
      .select('client_id')
      .eq('id', params.id)
      .maybeSingle()
    if (!duena) return fail(404, 'Esa remesa ya no existe')
    if (!puedeEditar(session, (duena as { client_id: string }).client_id)) {
      return fail(404, 'Esa remesa ya no existe')
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const cambios: Record<string, unknown> = {}

    if (typeof body.nombre === 'string') cambios.nombre = body.nombre.trim().slice(0, 120) || null
    if (typeof body.nota === 'string') cambios.nota = body.nota.trim().slice(0, 1000) || null
    if (typeof body.referenciaEnvio === 'string') {
      cambios.referencia_envio = body.referenciaEnvio.trim().slice(0, 120) || null
    }
    if (typeof body.fechaEnvio === 'string') {
      const f = body.fechaEnvio.trim()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return fail(400, 'La fecha tiene que ser 2026-09-18')
      cambios.fecha_envio = f
    }

    if (Object.keys(cambios).length === 0) return fail(400, 'No hay nada que cambiar')
    cambios.updated_at = new Date().toISOString()

    const service = createServiceClient()
    const { data, error } = await service
      .from('fba_remesas')
      .update(cambios)
      .eq('id', params.id)
      .select('id')
      .maybeSingle()
    if (error) throw error
    if (!data) return fail(404, 'Esa remesa ya no existe')

    return NextResponse.json({ ok: true })
  } catch (error) {
    return errorResponse(error, 'No se ha podido cambiar la remesa')
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireFbaAccess('borrar')
    if (session instanceof NextResponse) return session
    if (!UUID.test(params.id)) return fail(400, 'Esa remesa no existe')

    const service = createServiceClient()
    // Las líneas caen con ella (CASCADE). Los movimientos NO se tocan: son de
    // Amazon, no de la remesa, y el día que se cree otra vuelven a contar.
    const { error } = await service.from('fba_remesas').delete().eq('id', params.id)
    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (error) {
    return errorResponse(error, 'No se ha podido borrar la remesa')
  }
}
