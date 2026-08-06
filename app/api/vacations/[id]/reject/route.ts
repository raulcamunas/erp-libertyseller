import { NextRequest, NextResponse } from 'next/server'
import {
  currentView,
  errorResponse,
  fail,
  loadRequest,
  readText,
  requireAdmin,
} from '@/lib/vacations/api'
import type { VacationRequest } from '@/lib/types/vacations'

/**
 * RECHAZAR UNAS VACACIONES. SOLO ADMIN.
 *
 * EL MOTIVO ES OBLIGATORIO, aquí y en el CHECK de la migración 116. «Me lo
 * denegaron y no sé por qué» no puede pasar: quien lo pidió tiene que poder
 * leer la razón, y quien lo decidió tiene que poder recordarla dentro de seis
 * meses.
 *
 * Los días vuelven al saldo solos: `vacationBalance` solo cuenta lo pendiente
 * y lo aprobado, así que una rechazada deja de restar en cuanto cambia de
 * estado. No hay ningún contador que actualizar a mano, que es justo lo que
 * se acaba descuadrando.
 */

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireAdmin()
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const reason = readText(body?.reason ?? body?.rejection_reason)
    if (!reason) {
      return fail(400, 'Escribe por qué se rechaza: quien lo pidió tiene que poder leerlo')
    }

    const found = await loadRequest(session, params.id)
    if (found instanceof NextResponse) return found
    const { request: vacation, employee } = found

    if (vacation.status !== 'pendiente') {
      return fail(
        409,
        `Esa petición ya está ${vacation.status}. Recarga la pantalla para ver cómo quedó.`
      )
    }

    const { data, error } = await session.service
      .from('vacation_requests')
      .update({
        status: 'rechazada',
        rejection_reason: reason,
        resolved_by: session.userId,
        resolved_at: new Date().toISOString(),
      })
      .eq('id', vacation.id)
      .eq('status', 'pendiente')
      .select('*')

    if (error) throw error
    if (!data || data.length === 0) {
      return fail(409, 'Otra persona ha resuelto esa petición hace un momento. Recarga la pantalla.')
    }

    return NextResponse.json({
      request: data[0] as VacationRequest,
      message: `Petición de ${employee.name} rechazada`,
      ...(await currentView(session)),
    })
  } catch (error) {
    return errorResponse(error, 'Error rechazando unas vacaciones')
  }
}
