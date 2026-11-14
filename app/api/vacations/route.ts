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
import { avisoDePedida, choquesDeEmpresa, claveDeAviso, textoDeChoque } from '@/lib/vacations/calendario'
import { avisarEnLaCampana, cargarEquipo, festivosDeLaFicha, idsDeAdmins } from '@/lib/vacations/servidor'
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
 * POST -> pedir unos días. Nacen SIEMPRE pendientes. Si chocan con las de un compañero (regla de TODA la empresa,
 *         migración 308) se avisa en la respuesta, pero se guardan igual: quien decide es el admin al aprobar.
 *         Los administradores reciben el aviso en la campana ('vacaciones_pedida').
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

    // Los festivos de SU lugar no le gastan vacaciones (308). Los mismos que usan la pantalla, aprobar y el saldo.
    const festivos = await festivosDeLaFicha(session.service, employee.id)

    const check = checkVacationRequest({
      employee,
      startDate,
      endDate,
      requests: (existing ?? []) as VacationRequest[],
      today,
      holidays: festivos,
      // Estos avisos vuelven al navegador y se enseñan por toast a quien acaba
      // de pedirlas. Si las pide para sí misma se le habla de tú, igual que el
      // resto de «Mis vacaciones»; si es un admin registrando por otra persona,
      // de ella.
      propio: employee.user_id != null && employee.user_id === session.userId,
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
    const creada = data as VacationRequest

    // EL CHOQUE CON COMPAÑEROS: aviso, no bloqueo (Raúl, 14 nov 2026). Se mira con las pendientes y las aprobadas.
    const equipo = await cargarEquipo(session.service, startDate, endDate)
    const choque = choquesDeEmpresa({
      employeeId: employee.id,
      startDate,
      endDate,
      ausencias: equipo.ausencias,
      maxALaVez: equipo.maxALaVez,
      excludeId: creada.id,
      festivos,
    })
    const warnings = [...check.warnings]
    const textoChoque = textoDeChoque(choque)
    if (choque.hay && textoChoque) warnings.unshift(`${textoChoque} La petición queda guardada y dirección decide.`)

    // La campana de los administradores (menos quien la acaba de registrar, si es uno de ellos)
    const admins = (await idsDeAdmins(session.service)).filter((id) => id !== session.userId)
    const texto = avisoDePedida({ nombre: employee.name, start_date: startDate, end_date: endDate, dias: check.workingDays, choque, fueraDePlazo: creada.late_notice })
    await avisarEnLaCampana(
      session.service,
      admins.map((userId) => ({ userId, tipo: 'vacaciones_pedida', titulo: texto.titulo, mensaje: texto.mensaje, clave: claveDeAviso(creada.id, 'pedida'), requestId: creada.id }))
    )

    return NextResponse.json(
      {
        request: creada,
        warnings,
        choque,
        onBehalf: employee.user_id !== session.userId,
        ...(await currentView(session)),
      },
      { status: 201 }
    )
  } catch (error) {
    return errorResponse(error, 'Error pidiendo vacaciones')
  }
}
