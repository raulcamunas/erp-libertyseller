import { NextRequest, NextResponse } from 'next/server'
import {
  currentView,
  errorResponse,
  fail,
  loadRequest,
  overlapConflict,
  requireAdmin,
} from '@/lib/vacations/api'
import {
  formatDayRange,
  workingDaysBetween,
  type VacationRequest,
} from '@/lib/types/vacations'

/**
 * APROBAR UNAS VACACIONES. SOLO ADMIN.
 *
 * `requireAdmin()` lee el rol de la base de datos a partir de la sesión, así
 * que quien pidió los días no puede aprobárselos ni llamando a esta ruta a
 * mano: le contesta 403 antes de mirar nada. Y aunque esta ruta no existiera,
 * las políticas RLS de la migración 116 impiden que una empleada mueva una
 * fila suya a 'aprobada' desde el navegador.
 *
 * Se comprueban los solapes OTRA VEZ, y no por desconfianza del código que
 * creó la petición: entre pedir y aprobar pueden pasar días, y en ese hueco
 * cabe otra petición sobre los mismos días. Aprobar las dos descontaría el
 * saldo por duplicado.
 */

export const dynamic = 'force-dynamic'

export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireAdmin()
    if (session instanceof NextResponse) return session

    const found = await loadRequest(session, params.id)
    if (found instanceof NextResponse) return found
    const { request, employee } = found

    if (request.status !== 'pendiente') {
      return fail(
        409,
        `Esa petición ya está ${request.status}. Recarga la pantalla para ver cómo quedó.`
      )
    }

    const clash = await overlapConflict(session, request)
    if (clash) return clash

    /**
     * LOS DÍAS QUE SE VAN A DESCONTAR SE VUELVEN A CONTAR AQUÍ.
     *
     * `working_days` es un campo DERIVADO de start_date/end_date, y aprobar es
     * el momento en que ese número deja de ser una estimación y pasa a ser lo
     * que se le resta del saldo a alguien. Congelar sin mirar lo que trae la
     * fila significa fiarse de quien la escribió; y aunque la migración 116 ya
     * no deja escribir esta tabla desde el navegador, el saldo es lo último que
     * debería depender de que ese candado siga puesto dentro de un año.
     *
     * Es la MISMA función que usó el POST al crearla, así que en una petición
     * normal el número no se mueve. Si se mueve, hay que enterarse: significa
     * que la fila se ha tocado por fuera de estas rutas.
     *
     * `late_notice` NO se recalcula, y eso es deliberado: es un hecho sobre el
     * momento en que se PIDIÓ, no sobre el momento en que se aprueba.
     * Recalculándolo contra hoy, una petición hecha con tres meses de
     * antelación aparecería como fuera de plazo por el mero hecho de aprobarse
     * una semana antes de empezar.
     */
    const workingDays = workingDaysBetween(request.start_date, request.end_date)
    if (Number(request.working_days) !== workingDays) {
      console.warn(
        `[vacaciones] La petición ${request.id} traía working_days=${request.working_days} y de ${request.start_date} a ${request.end_date} salen ${workingDays} laborables. Se aprueba con el recalculado; revisa quién ha tocado esa fila.`
      )
    }

    // El .eq('status','pendiente') del UPDATE cierra la carrera con otro admin
    // que esté resolviendo la misma petición en ese momento: el segundo no
    // encuentra fila y se entera, en vez de pisar la decisión del primero.
    const { data, error } = await session.service
      .from('vacation_requests')
      .update({
        status: 'aprobada',
        working_days: workingDays,
        resolved_by: session.userId,
        resolved_at: new Date().toISOString(),
        // Se limpia por si venía de un rechazo anterior reabierto: un motivo
        // de rechazo colgando de una petición aprobada no lo entiende nadie.
        rejection_reason: null,
      })
      .eq('id', request.id)
      .eq('status', 'pendiente')
      // .select() para saber si ha cambiado algo de verdad: un UPDATE que no
      // toca ninguna fila NO da error, y sin esto la pantalla diría «aprobada»
      // sobre una petición que sigue pendiente.
      .select('*')

    if (error) throw error
    if (!data || data.length === 0) {
      return fail(409, 'Otra persona ha resuelto esa petición hace un momento. Recarga la pantalla.')
    }

    return NextResponse.json({
      request: data[0] as VacationRequest,
      message: `Vacaciones de ${employee.name} aprobadas (${formatDayRange(
        request.start_date,
        request.end_date
      )})`,
      ...(await currentView(session)),
    })
  } catch (error) {
    return errorResponse(error, 'Error aprobando unas vacaciones')
  }
}
