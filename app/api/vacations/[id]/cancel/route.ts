import { NextRequest, NextResponse } from 'next/server'
import {
  currentView,
  errorResponse,
  fail,
  loadRequest,
  readText,
  requireSession,
} from '@/lib/vacations/api'
import type { VacationRequest } from '@/lib/types/vacations'
import { avisoDeResolucion, claveDeAviso } from '@/lib/vacations/calendario'
import { avisarEnLaCampana, faltaEsquema } from '@/lib/vacations/servidor'

/**
 * RETIRAR UNA PETICIÓN.
 *
 * Es la única acción que puede hacer quien NO es admin sobre una fila ya
 * creada, y por eso la comprobación de propiedad se hace a mano aquí: la
 * petición tiene que ser de una ficha cuyo `user_id` sea el de la sesión.
 *
 * Quién puede y hasta dónde:
 *   - quien la pidió -> solo mientras esté PENDIENTE. Una vez aprobada, esos
 *     días ya están contados por quien organiza el trabajo, así que
 *     descancelarlos por su cuenta no le toca.
 *   - un admin -> también las ya aprobadas. Los planes cambian, y sin esto
 *     unos días concedidos que al final no se cogen se quedarían gastados
 *     para siempre; la única salida sería borrar la fila y perder el rastro.
 *
 * Se CANCELA, no se borra. Una petición borrada no deja constancia de que
 * existió, y la mitad del sentido de este módulo es que quede constancia.
 * Borrar solo lo puede hacer un admin, y directamente contra la tabla.
 */

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireSession()
    if (session instanceof NextResponse) return session

    const found = await loadRequest(session, params.id)
    if (found instanceof NextResponse) return found
    const { request: vacation, employee } = found

    // La ficha tiene que ser suya. `user_id` puede ser null (quien no tiene
    // cuenta en el ERP): un null nunca puede coincidir con un id de sesión, y
    // el `&&` lo deja explícito en vez de fiarlo a la comparación.
    const isOwner = employee.user_id != null && employee.user_id === session.userId
    if (!session.isAdmin && !isOwner) {
      return fail(403, 'Esa petición de vacaciones no es tuya')
    }

    if (vacation.status === 'cancelada') {
      return fail(409, 'Esa petición ya estaba retirada')
    }
    if (vacation.status === 'rechazada') {
      return fail(409, 'Esa petición ya fue rechazada, no hay nada que retirar')
    }
    if (vacation.status === 'aprobada' && !session.isAdmin) {
      return fail(
        403,
        'Esas vacaciones ya están aprobadas: para anularlas habla con dirección, que las tiene apuntadas'
      )
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const note = readText(body?.reason)

    const previous = vacation.status
    const cambios: Record<string, unknown> = {
      status: 'cancelada',
      // Quién y cuándo la retiró, EN SUS PROPIAS COLUMNAS (no en resolved_*), para no borrar la firma de quien
      // las aprobó. El CHECK vacation_requests_resuelta_ok de la 116 acepta cualquiera de las dos fechas.
      cancelled_by: session.userId,
      cancelled_at: new Date().toISOString(),
    }
    // El motivo se GUARDA (308). Antes se leía y se perdía.
    if (note) cambios.cancel_reason = note

    const anular = (c: Record<string, unknown>) =>
      session.service
        .from('vacation_requests')
        .update(c)
        .eq('id', vacation.id)
        // Solo desde el estado en que estaba: si otro admin la ha resuelto
        // mientras tanto, este UPDATE no toca nada y se avisa.
        .eq('status', previous)
        .select('*')

    let { data, error } = await anular(cambios)
    // Sin la 308 lanzada no hay dónde guardar el motivo: se anula igual, como siempre
    if (error && faltaEsquema(error) && 'cancel_reason' in cambios) {
      delete cambios.cancel_reason
      ;({ data, error } = await anular(cambios))
    }

    if (error) throw error
    if (!data || data.length === 0) {
      return fail(409, 'Esa petición ha cambiado hace un momento. Recarga la pantalla.')
    }

    // Si no la ha retirado la propia persona (la ha anulado un admin), se entera en su campana
    if (employee.user_id && employee.user_id !== session.userId) {
      const texto = avisoDeResolucion({ evento: 'cancelada', start_date: vacation.start_date, end_date: vacation.end_date, motivo: note })
      await avisarEnLaCampana(session.service, [
        { userId: employee.user_id, tipo: 'vacaciones_resuelta', titulo: texto.titulo, mensaje: texto.mensaje, clave: claveDeAviso(vacation.id, 'cancelada'), requestId: vacation.id },
      ])
    }

    return NextResponse.json({
      request: data[0] as VacationRequest,
      message:
        previous === 'aprobada'
          ? `Vacaciones de ${employee.name} anuladas: los días vuelven a su saldo`
          : 'Petición retirada',
      note,
      ...(await currentView(session)),
    })
  } catch (error) {
    return errorResponse(error, 'Error retirando una petición de vacaciones')
  }
}
