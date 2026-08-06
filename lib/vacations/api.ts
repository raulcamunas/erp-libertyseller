import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { loadVacationsData, type VacationsServerData } from '@/lib/employees/vacations'
import {
  BLOCKING_STATUSES,
  findOverlapping,
  formatDayRange,
  todayKey,
  type VacationEmployee,
  type VacationRequest,
} from '@/lib/types/vacations'

/**
 * LO QUE COMPARTEN LAS RUTAS DE VACACIONES: QUIÉN PUEDE HACER QUÉ.
 *
 * Está aparte del cálculo (lib/types/vacations.ts) a propósito: aquello es
 * lógica pura que se puede ejecutar con dos fechas y una lista; aquí ya hay
 * cookies, sesión y base de datos.
 *
 * LA REGLA QUE SOSTIENE TODO EL MÓDULO
 * ------------------------------------
 *   QUIEN PIDE LAS VACACIONES NO PUEDE APROBÁRSELAS.
 *
 * Si eso se puede saltar, lo demás sobra. Y no basta con esconder el botón:
 * el navegador habla con PostgREST directamente y con la clave anónima, así
 * que una comprobación que solo esté en la interfaz se salta con una llamada
 * a mano desde la consola. Por eso hay dos candados independientes:
 *
 *   1) La migración 116 le RETIRA a `authenticated` el permiso de escribir en
 *      vacation_requests y no le deja ninguna política de INSERT/UPDATE. Desde
 *      el navegador la tabla solo se lee. Ese es el guardia de verdad, y
 *      protege incluso si estas rutas no existieran.
 *
 *      Hubo un intento anterior de permitir la escritura «solo de lo tuyo y
 *      solo pendiente» por RLS, y no valía: la política comprobaba de quién era
 *      la fila y en qué estado nacía, pero no `working_days`, `late_notice` ni
 *      `created_by`, que son campos DERIVADOS. Quien pedía las vacaciones podía
 *      declarar que cinco meses costaban 0,1 días.
 *
 *   2) `requireAdmin()` de aquí abajo, en el servidor, antes de tocar nada.
 *
 * Las ESCRITURAS de estas rutas van con service_role, que se salta RLS a
 * propósito: un admin tiene que poder registrar una petición EN NOMBRE de
 * Yasury o de Daniella, y esas dos fichas pueden no tener cuenta en el ERP
 * —o tenerla recién creada—, así que la política «es mía» no las alcanza. El
 * permiso se comprueba ANTES, aquí, contra la sesión: el rol nunca sale del
 * cuerpo de la petición.
 */

export type VacationsSupabase = Awaited<ReturnType<typeof createClient>>

export interface VacationSession {
  supabase: VacationsSupabase
  service: ReturnType<typeof createServiceClient>
  userId: string
  role: string
  isAdmin: boolean
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function fail(status: number, message: string): NextResponse {
  return NextResponse.json({ error: message }, { status })
}

/**
 * Convierte cualquier fallo en una respuesta que se pueda leer. El mensaje de
 * un error de Postgres no le dice nada a nadie y a veces lleva dentro nombres
 * de columnas, así que se registra y sale un 500 genérico.
 */
export function errorResponse(error: unknown, context: string): NextResponse {
  console.error(`${context}:`, error)
  return fail(
    500,
    'No se ha podido completar la operación. Vuelve a intentarlo y avisa si sigue fallando'
  )
}

/**
 * El id de la aplicación en user_app_permissions. Tiene que coincidir letra por
 * letra con lib/config/apps.ts, con el mapa de middleware.ts y con el INSERT de
 * la migración 116.
 */
const APP_ID = 'vacaciones'

/**
 * Sesión iniciada, con su rol leído de la BASE DE DATOS.
 *
 * El rol NUNCA se lee del cuerpo de la petición ni de una cabecera: un
 * `{"role":"admin"}` en el JSON no puede convertir a nadie en admin.
 *
 * Y AQUÍ SE COMPRUEBA TAMBIÉN EL PERMISO DE LA APP, que es lo que faltaba.
 * El bloque de permisos por aplicación de middleware.ts solo se evalúa sobre
 * rutas que empiezan por /dashboard, así que a /api/vacations no llegaba nunca:
 * a alguien a quien un admin le hubiera quitado el módulo desde
 * /dashboard/users se le redirigía al abrir la pantalla, pero un GET
 * /api/vacations le seguía devolviendo su saldo y un POST le seguía creando
 * peticiones que aparecían en la cola. El permiso tiene que mandar en los dos
 * caminos, pantalla y API.
 *
 * Se consulta con la SESIÓN de quien llama y no con service_role: las políticas
 * de user_app_permissions ya dejan a cada uno leer la suya, y así el permiso no
 * se puede leer de nadie más ni por error.
 */
export async function requireSession(): Promise<VacationSession | NextResponse> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail(401, 'Hay que iniciar sesión para gestionar las vacaciones')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const role = profile?.role ?? 'employee'
  const isAdmin = role === 'admin'

  // Un admin no pasa por aquí: es quien reparte los permisos, y dejarlo fuera
  // de su propio módulo por una fila que falte en una tabla sería peor que el
  // problema que se está tapando.
  if (!isAdmin) {
    const { data: permission } = await supabase
      .from('user_app_permissions')
      .select('can_access')
      .eq('user_id', user.id)
      .eq('app_id', APP_ID)
      .maybeSingle()

    if (!permission?.can_access) {
      return fail(403, 'No tienes acceso al módulo de vacaciones. Habla con dirección.')
    }
  }

  return {
    supabase,
    service: createServiceClient(),
    userId: user.id,
    role,
    isAdmin,
  }
}

/**
 * Igual, pero cortando en seco a quien no es admin.
 *
 * Aprobar y rechazar pasan por aquí. Un partner tampoco entra: ve Tesorería,
 * pero quién se va de vacaciones y cuándo lo decide dirección.
 */
export async function requireAdmin(): Promise<VacationSession | NextResponse> {
  const session = await requireSession()
  if (session instanceof NextResponse) return session
  if (!session.isAdmin) {
    return fail(403, 'Solo un administrador puede resolver una petición de vacaciones')
  }
  return session
}

/**
 * La ficha sobre la que se va a actuar.
 *
 * Un admin puede indicar `employeeId` y actuar sobre cualquiera —hace falta:
 * las dos personas para las que se ha pedido este módulo pueden no tener
 * cuenta en el ERP y alguien tiene que poder registrar sus peticiones—.
 * Cualquier otro rol se queda con su propia ficha, se pida lo que se pida en
 * el cuerpo: ahí está el intento evidente de pedir vacaciones a nombre de
 * otro.
 */
export async function resolveEmployee(
  session: VacationSession,
  employeeId: unknown
): Promise<VacationEmployee | NextResponse> {
  const service = session.service

  if (session.isAdmin && typeof employeeId === 'string' && employeeId.trim() !== '') {
    const id = employeeId.trim()
    if (!UUID.test(id)) return fail(400, 'El empleado indicado no es un identificador válido')

    const { data, error } = await service
      .from('employees')
      .select('id, name, user_id, started_on, ended_on, is_active, vacation_days_per_month')
      .eq('id', id)
      .maybeSingle()
    if (error) throw error
    if (!data) return fail(404, 'Esa persona no está en el control de empleados')
    return data as VacationEmployee
  }

  const { data, error } = await service
    .from('employees')
    .select('id, name, user_id, started_on, ended_on, is_active, vacation_days_per_month')
    .eq('user_id', session.userId)
    .maybeSingle()
  if (error) throw error
  if (!data) {
    return fail(
      403,
      'Tu usuario no está enlazado a ninguna ficha de empleado, así que no puede pedir vacaciones. Pídeselo a dirección.'
    )
  }
  return data as VacationEmployee
}

/** La petición y la ficha a la que pertenece, o el error ya montado */
export async function loadRequest(
  session: VacationSession,
  requestId: string
): Promise<{ request: VacationRequest; employee: VacationEmployee } | NextResponse> {
  if (!UUID.test(requestId)) return fail(400, 'Esa petición no existe')

  const { data, error } = await session.service
    .from('vacation_requests')
    .select('*')
    .eq('id', requestId)
    .maybeSingle()
  if (error) throw error
  if (!data) return fail(404, 'Esa petición de vacaciones ya no existe')

  const request = data as VacationRequest

  const { data: emp, error: empError } = await session.service
    .from('employees')
    .select('id, name, user_id, started_on, ended_on, is_active, vacation_days_per_month')
    .eq('id', request.employee_id)
    .maybeSingle()
  if (empError) throw empError
  if (!emp) return fail(404, 'La ficha de esa persona ya no existe')

  return { request, employee: emp as VacationEmployee }
}

/**
 * Vuelve a comprobar los solapes JUSTO ANTES de aprobar.
 *
 * No es una comprobación repetida por si acaso: entre que se pide y que se
 * aprueba pueden pasar días, y en ese hueco cabe otra petición sobre los
 * mismos días —o la misma persona pidiendo dos veces mientras nadie
 * contestaba—. Aprobar las dos dejaría el saldo descontado por duplicado y el
 * calendario con dos bloques encima del otro.
 *
 * Solo miran las peticiones VIVAS (pendientes y aprobadas) que no sean ella
 * misma.
 */
export async function overlapConflict(
  session: VacationSession,
  request: VacationRequest,
  onlyApproved = true
): Promise<NextResponse | null> {
  const { data, error } = await session.service
    .from('vacation_requests')
    .select('*')
    .eq('employee_id', request.employee_id)
    .in('status', onlyApproved ? ['aprobada'] : [...BLOCKING_STATUSES])
  if (error) throw error

  const clash = findOverlapping(
    (data ?? []) as VacationRequest[],
    request.employee_id,
    request.start_date,
    request.end_date,
    request.id
  )
  if (clash.length === 0) return null

  return fail(
    409,
    `Esos días se pisan con otras vacaciones ya aprobadas (${formatDayRange(
      clash[0].start_date,
      clash[0].end_date
    )}). Resuelve una de las dos antes de aprobar esta.`
  )
}

/**
 * Lo que se devuelve tras escribir: los datos que le tocan a quien preguntó.
 * Así la pantalla no tiene que hacer una segunda llamada para refrescar el
 * saldo, que es justo lo que acaba de cambiar.
 */
export async function currentView(session: VacationSession): Promise<VacationsServerData> {
  if (session.isAdmin) return loadVacationsData()

  const { data } = await session.service
    .from('employees')
    .select('id')
    .eq('user_id', session.userId)
    .maybeSingle()

  const employeeId = (data as { id: string } | null)?.id
  if (!employeeId) {
    // `today` con su valor de verdad aunque no haya nada que enseñar: una
    // cadena vacía aquí se propagaría al cálculo del saldo de quien consuma
    // esto y compararía fechas contra ''.
    return { employees: [], requests: [], people: {}, missingTables: false, today: todayKey() }
  }
  return loadVacationsData(employeeId)
}

/** Texto de un campo opcional del cuerpo, recortado y con tope de longitud */
export function readText(value: unknown, max = 500): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim().slice(0, max)
  return v === '' ? null : v
}
