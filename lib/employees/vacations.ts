import { createServiceClient } from '@/lib/supabase/service'
import { fetchAll } from '@/lib/employees/data'
import {
  todayKey,
  vacationBalance,
  type VacationBalance,
  type VacationEmployee,
  type VacationRequest,
} from '@/lib/types/vacations'

/**
 * DE DÓNDE SALEN LOS DATOS DE VACACIONES
 * ======================================
 * SOLO SERVIDOR: importa el cliente de service_role. Un componente de cliente
 * que importe esto se lleva la clave al navegador. Los tipos y el cálculo
 * están en lib/types/vacations.ts, que es puro y se puede importar desde
 * cualquier sitio.
 *
 * POR QUÉ NO VA DENTRO DE loadEmployeesData()
 * -------------------------------------------
 * Aquel `Promise.all` alimenta el coste del equipo que consume TESORERÍA, y
 * su respuesta (EmployeesCostResponse) la ve también un partner. Meter aquí
 * las vacaciones encarecería la carga de Tesorería con datos que no usa y
 * arrastraría el tipo por medio ERP. Son dos preguntas distintas.
 *
 * POR QUÉ SE LEE CON service_role, IGUAL QUE data.ts
 * -------------------------------------------------
 * No por comodidad. public.employees tiene RLS de SOLO ADMIN —es la tabla de
 * los sueldos—, así que una empleada que consultara su propia ficha con su
 * sesión recibiría CERO FILAS SIN ERROR: su nombre, su fecha de alta y su
 * tarifa de vacaciones no le llegarían, y su pantalla diría «0 días
 * generados» como si fuera un dato. Un cero que parece un dato es peor que un
 * fallo.
 *
 * Lo que se controla es qué se DEVUELVE, no lo que se lee, y eso lo decide
 * cada una de estas funciones a partir del rol que ya ha comprobado quien
 * llama:
 *   - `loadVacationsData()`  -> admin: todo el equipo.
 *   - `loadMyVacations(uid)` -> la persona: SU ficha y SUS peticiones.
 *
 * Y lo que sale de aquí no lleva NI UN DATO SALARIAL: el tipo VacationEmployee
 * es un subconjunto de Employee sin sueldo, sin escalones y sin horas. La
 * pantalla del empleado (/dashboard/vacaciones) recibe exactamente esto, así
 * que ampliarlo con un campo de más es publicarlo.
 *
 * Las peticiones tienen además su propia RLS (migración 116), que es la que
 * protege el acceso directo a PostgREST desde el navegador. Esto de aquí es
 * la segunda capa, no la única.
 */

/** Las columnas de employees que necesita vacaciones. NI UNA MÁS */
const EMPLOYEE_FIELDS = 'id, name, user_id, started_on, ended_on, is_active, vacation_days_per_month'

/**
 * ¿Es «eso todavía no existe en el esquema» y no otra cosa?
 *
 * A los dos códigos de tabla inexistente que ya distingue lib/employees/data.ts
 * se suman aquí los de COLUMNA inexistente: las migraciones 111-115 están sin
 * lanzar en producción, así que la 116 tampoco lo estará, y hay un estado
 * intermedio real —111 lanzada y 116 no— en el que la tabla employees existe
 * pero `vacation_days_per_month` no. Sin esto, desplegar el código antes de
 * lanzar la 116 tiraría la pantalla de Control empleados, que hoy funciona.
 *
 * Solo esos cuatro: un fallo de permisos, de red o de sintaxis TIENE que
 * seguir reventando. Si se tragara cualquier error y devolviera cero filas,
 * la pantalla diría «no tienes vacaciones» a alguien que sí las tiene.
 */
function isMissingSchema(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  return (
    code === 'PGRST205' || // PostgREST: la tabla no está en su caché de esquema
    code === '42P01' || //    Postgres: undefined_table
    code === 'PGRST204' || // PostgREST: la columna no está en su caché
    code === '42703' //       Postgres: undefined_column
  )
}

export interface VacationsServerData {
  /** Todo el equipo, sin datos salariales. Incluye a quien NO genera vacaciones:
      la pantalla tiene que poder decir «a esta persona no se le ha puesto tarifa» */
  employees: VacationEmployee[]
  requests: VacationRequest[]
  /**
   * Nombre de cada perfil que aparece en `created_by` / `resolved_by` /
   * `cancelled_by`, para
   * poder escribir «aprobada por Raúl» sin un JOIN que Supabase no puede hacer
   * (las dos claves ajenas apuntan a la misma tabla y PostgREST no sabe cuál
   * es cuál sin desambiguar).
   */
  people: Record<string, string>
  /**
   * La migración 116 todavía no está lanzada.
   *
   * Se devuelve como dato en vez de lanzar, y es INDEPENDIENTE del
   * `missingTables` de empleados: si fuera el mismo, desplegar este código
   * antes que la migración tumbaría la pantalla de Control empleados, que hoy
   * va bien y no tiene nada que ver con las vacaciones.
   */
  missingTables: boolean
  /** 'yyyy-MM-dd' en hora de España, calculado UNA vez en el servidor.
      Baja hasta el cálculo como parámetro para que el saldo no dependa del
      huso horario del navegador de quien mire la pantalla */
  today: string
}

const EMPTY_DATA = (today: string): VacationsServerData => ({
  employees: [],
  requests: [],
  people: {},
  missingTables: true,
  today,
})

/**
 * TODO EL EQUIPO. Solo para quien ya ha comprobado que es admin.
 *
 * `onlyEmployeeId` limita la carga a una persona; se usa desde la vista del
 * empleado, que es la misma consulta con un filtro más.
 */
export async function loadVacationsData(
  onlyEmployeeId?: string
): Promise<VacationsServerData> {
  const today = todayKey()
  const service = createServiceClient()

  try {
    const employees = await fetchAll<VacationEmployee>((a, b) => {
      let q = service.from('employees').select(EMPLOYEE_FIELDS)
      if (onlyEmployeeId) q = q.eq('id', onlyEmployeeId)
      // El orden termina siempre en una columna única: .range() sobre un orden
      // con empates repite filas o se las salta entre tramos.
      return q.order('name', { ascending: true }).order('id').range(a, b)
    })

    const requests = await fetchAll<VacationRequest>((a, b) => {
      let q = service.from('vacation_requests').select('*')
      if (onlyEmployeeId) q = q.eq('employee_id', onlyEmployeeId)
      return q.order('start_date', { ascending: false }).order('id').range(a, b)
    })

    return {
      employees,
      requests,
      people: await loadPeople(service, requests),
      missingTables: false,
      today,
    }
  } catch (error) {
    if (!isMissingSchema(error)) throw error
    return EMPTY_DATA(today)
  }
}

export interface MyVacationsData extends VacationsServerData {
  /** La ficha de quien pregunta, o null si su perfil no está enlazado a ninguna */
  employee: VacationEmployee | null
  balance: VacationBalance | null
}

/**
 * LO DE UNA PERSONA, buscando su ficha por el perfil del ERP.
 *
 * Devuelve `employee: null` cuando ese usuario no tiene ficha enlazada, que no
 * es un error: hay gente en el ERP que no está en nómina de este módulo. Es la
 * pantalla la que decide no pintar nada.
 */
export async function loadMyVacations(userId: string): Promise<MyVacationsData> {
  const today = todayKey()
  const service = createServiceClient()

  try {
    const { data: row, error } = await service
      .from('employees')
      .select(EMPLOYEE_FIELDS)
      // maybeSingle() y no single(): que un usuario no tenga ficha es normal,
      // no la excepción de «se esperaba una fila» que acabaría en 500.
      .eq('user_id', userId)
      .maybeSingle()
    if (error) throw error

    const employee = (row as VacationEmployee | null) ?? null
    if (!employee) {
      return { ...EMPTY_DATA(today), missingTables: false, employee: null, balance: null }
    }

    const data = await loadVacationsData(employee.id)
    return {
      ...data,
      employee,
      balance: data.missingTables
        ? null
        : vacationBalance(employee, data.requests, data.today),
    }
  } catch (error) {
    if (!isMissingSchema(error)) throw error
    return { ...EMPTY_DATA(today), employee: null, balance: null }
  }
}

/** Nombre de cada perfil citado en las peticiones. Una consulta, no N */
async function loadPeople(
  service: ReturnType<typeof createServiceClient>,
  requests: VacationRequest[]
): Promise<Record<string, string>> {
  const ids = new Set<string>()
  for (const r of requests) {
    if (r.created_by) ids.add(r.created_by)
    if (r.resolved_by) ids.add(r.resolved_by)
    if (r.cancelled_by) ids.add(r.cancelled_by)
  }
  if (ids.size === 0) return {}

  const { data, error } = await service
    .from('profiles')
    .select('id, full_name, email')
    .in('id', [...ids])
  if (error) throw error

  const out: Record<string, string> = {}
  for (const p of (data ?? []) as { id: string; full_name: string | null; email: string | null }[]) {
    out[p.id] = p.full_name || p.email || 'Alguien que ya no está en el ERP'
  }
  return out
}

export interface VacationsBalanceRow {
  employee: VacationEmployee
  balance: VacationBalance
}

/**
 * El saldo de cada persona QUE GENERA VACACIONES, en el orden en que se pinta.
 *
 * Quien tiene la tarifa a NULL se queda fuera: no es que su saldo sea cero, es
 * que no participa en el módulo, y un cero en la lista se leería como «se ha
 * gastado todas».
 */
export function vacationBalances(data: VacationsServerData): VacationsBalanceRow[] {
  return data.employees
    .filter((e) => e.vacation_days_per_month != null)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
    .map((employee) => ({
      employee,
      balance: vacationBalance(employee, data.requests, data.today),
    }))
}

/** Las peticiones que esperan respuesta, las que empiezan antes primero */
export function pendingRequests(data: VacationsServerData): VacationRequest[] {
  return data.requests
    .filter((r) => r.status === 'pendiente')
    .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.id.localeCompare(b.id))
}
