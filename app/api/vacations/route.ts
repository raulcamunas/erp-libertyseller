import { NextRequest, NextResponse } from 'next/server'
import {
  currentView,
  errorResponse,
  fail,
  readText,
  requireSession,
  resolveEmployee,
} from '@/lib/vacations/api'
import { loadVacationsData, loadMyVacations } from '@/lib/employees/vacations'
import {
  BLOCKING_STATUSES,
  checkVacationRequest,
  isDayKey,
  isLateNotice,
  todayKey,
  type VacationRequest,
} from '@/lib/types/vacations'

/**
 * VACACIONES: LEER Y PEDIR
 * ========================
 * GET  -> lo que le toca ver a quien pregunta.
 *         admin  = todo el equipo (la cola de aprobación y el saldo de cada
 *                  persona). El resto = SU ficha y SUS peticiones, sin un solo
 *                  dato salarial y sin saber nada de nadie más.
 * POST -> pedir unos días. Nacen SIEMPRE pendientes.
 *
 * La comprobación de quién es quién sale de la sesión, nunca del cuerpo de la
 * petición. Ver la cabecera de lib/vacations/api.ts.
 */

// Depende de la sesión de quien llama, así que no se puede prerenderizar.
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const session = await requireSession()
    if (session instanceof NextResponse) return session

    if (session.isAdmin) {
      return NextResponse.json({ scope: 'equipo', ...(await loadVacationsData()) })
    }
    return NextResponse.json({ scope: 'propio', ...(await loadMyVacations(session.userId)) })
  } catch (error) {
    return errorResponse(error, 'Error cargando las vacaciones')
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireSession()
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return fail(400, 'No se ha recibido la petición')

    // Un admin puede pedirlas EN NOMBRE de otra persona —hace falta: las dos
    // personas para las que se ha hecho esto pueden no tener cuenta en el ERP—.
    // Cualquier otro rol se queda con su propia ficha aunque mande un
    // employeeId en el cuerpo.
    const employee = await resolveEmployee(session, body.employee_id ?? body.employeeId)
    if (employee instanceof NextResponse) return employee

    const startDate = body.start_date ?? body.startDate
    const endDate = body.end_date ?? body.endDate
    if (!isDayKey(startDate) || !isDayKey(endDate)) {
      return fail(400, 'Faltan las fechas de las vacaciones, o no son fechas válidas')
    }

    // «Hoy» lo pone el SERVIDOR, en hora de España. Si viniera del cliente,
    // bastaría con cambiar la hora del ordenador para que una petición para
    // mañana no saliera marcada como fuera de plazo.
    const today = todayKey()

    // Las peticiones vivas de esa persona, que son las únicas que pueden
    // pisarse con estas fechas y las únicas que descuentan saldo.
    const { data: existing, error: existingError } = await session.service
      .from('vacation_requests')
      .select('*')
      .eq('employee_id', employee.id)
      .in('status', [...BLOCKING_STATUSES])
    if (existingError) throw existingError

    const check = checkVacationRequest({
      employee,
      startDate,
      endDate,
      requests: (existing ?? []) as VacationRequest[],
      today,
    })
    if (!check.ok) {
      return NextResponse.json(
        { error: check.errors[0], errors: check.errors, warnings: check.warnings },
        { status: 409 }
      )
    }

    const { data, error } = await session.service
      .from('vacation_requests')
      .insert({
        employee_id: employee.id,
        start_date: startDate,
        end_date: endDate,
        working_days: check.workingDays,
        status: 'pendiente',
        reason: readText(body.reason),
        // Quién la tecleó. Cuando un admin la registra por otra persona, esto
        // es lo que deja dicho que no la pidió ella.
        created_by: session.userId,
        // Fuera de plazo NO bloquea: se guarda marcada para quien aprueba.
        // Se congela aquí porque es un hecho sobre el momento de pedirla.
        late_notice: isLateNotice(startDate, today),
      })
      .select('*')
      .single()

    // 23P01 = exclusion_violation: la restricción de solapes de la migración
    // 116. Llegar aquí significa que otra petición entró entre la comprobación
    // de arriba y este INSERT. La base es el último guardia y hace bien.
    if ((error as { code?: string } | null)?.code === '23P01') {
      return fail(409, 'Alguien ha pedido esos mismos días mientras se guardaba. Vuelve a mirar el calendario.')
    }
    if (error) throw error

    return NextResponse.json(
      {
        request: data as VacationRequest,
        warnings: check.warnings,
        onBehalf: employee.user_id !== session.userId,
        ...(await currentView(session)),
      },
      { status: 201 }
    )
  } catch (error) {
    return errorResponse(error, 'Error pidiendo vacaciones')
  }
}
