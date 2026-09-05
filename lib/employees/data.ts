import { createServiceClient } from '@/lib/supabase/service'
import {
  cycleCostForUser,
  monthCostForUser,
  type CostAppointment,
  type PersonCost,
} from '@/lib/payroll/cost'
import {
  cycleKeyPaidInMonth,
  type WorkHourEntry,
  type PayrollRate,
  type ManualAppointment,
} from '@/lib/types/payroll'
import {
  employeeMonth,
  employeesMonthTotal,
  type Employee,
  type EmployeeExtra,
  type EmployeeMonthRecord,
  type EmployeeSalaryStep,
  type EmployeesDataset,
} from '@/lib/types/employees'
import type { EmployeesCostResponse } from '@/lib/employees/payload'

/**
 * DE DÓNDE SALEN LOS DATOS DEL MÓDULO DE EMPLEADOS
 * ================================================
 * SOLO SERVIDOR: importa el cliente de service_role. Un componente de cliente
 * que importe esto se lleva la clave al navegador. Los tipos que necesita la
 * interfaz están en lib/employees/payload.ts, que no importa nada de aquí.
 *
 * Tres pantallas piden lo mismo —la ruta /api/employees/monthly-cost, la
 * página de Control empleados y el bloque «Empleados al mes» de Tesorería— y
 * si cada una montara su propia consulta acabarían discrepando en cuanto
 * alguien tocara una. Este fichero es la única carga.
 *
 * Se lee con service_role a propósito, no por comodidad: las tablas de
 * empleados son solo de admin, pero Tesorería la ve también un partner y
 * necesita que le cuadre el total de gastos. Bajo RLS, un partner recibiría
 * cero filas SIN ERROR y su Tesorería enseñaría ~2.300 € menos de gasto al
 * mes con el beneficio inflado en la misma cantidad. Lo que se controla es
 * qué se le DEVUELVE —eso lo decide `detail` en cada llamada, a partir de su
 * rol—, nunca lo que se lee.
 */

/** Supabase corta cualquier consulta a 1000 filas y un .limit() mayor no lo salta */
const PAGE = 1000

/**
 * Consulta paginada. El orden lo fija quien llama y siempre termina en una
 * columna única, porque .range() sobre un orden con empates puede repetir o
 * saltarse filas entre tramos.
 *
 * Exportada porque la página del módulo carga las notas por su cuenta —van con
 * el autor y ese JOIN solo lo sabe hacer la consulta— y sin paginar se comería
 * en silencio todo lo que pase de mil notas. Recibe el constructor de la
 * consulta, así que sirve igual con el cliente de service_role de aquí que con
 * el cliente con sesión de la página.
 */
export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) {
      // Aquí no se hace `break`: quedarse a medias no daría error visible,
      // devolvería un coste más bajo del real. Un gasto que falta es justo lo
      // que nadie detecta mirando la pantalla.
      throw error
    }
    const chunk = (data as T[]) ?? []
    out.push(...chunk)
    if (chunk.length < PAGE) break
  }
  return out
}

/**
 * ¿Es «esa tabla no existe» y no otra cosa?
 *
 * PGRST205 lo devuelve PostgREST cuando el nombre no está en su caché de
 * esquema, y 42P01 es el `undefined_table` de Postgres. Solo esos dos: un
 * fallo de permisos, de red o de sintaxis TIENE que seguir reventando. Si se
 * tragara cualquier error y devolviera cero filas, Tesorería enseñaría el mes
 * sin los sueldos —unos 2.300 € menos de gasto y el beneficio inflado en la
 * misma cantidad— sin una sola señal en pantalla. Un gasto que falta no lo
 * detecta nadie mirando; una página que no carga, sí.
 */
function isMissingTable(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  return code === 'PGRST205' || code === '42P01'
}

export interface EmployeesServerData {
  employees: Employee[]
  steps: EmployeeSalaryStep[]
  records: EmployeeMonthRecord[]
  /** Encargos y comisiones sueltas (migración 178) */
  extras: EmployeeExtra[]
  /**
   * Las tablas del módulo todavía no están creadas: faltan por lanzar las
   * migraciones 111, 112, 113 y 115.
   *
   * Se devuelve como dato en vez de lanzar porque hay dos pantallas detrás y
   * quieren cosas distintas: Control empleados lo explica y dice qué hay que
   * ejecutar, mientras que Tesorería —que funcionaba de sobra antes de que
   * este módulo existiera— se limita a no pintar el bloque de empleados. Que
   * una migración pendiente tire abajo una pantalla que ayer iba bien es un
   * fallo por sí mismo.
   */
  missingTables: boolean
  /** Tipo de cambio de app_settings ('usd_eur_rate'). No se inventa otro */
  usdEur: number
  /**
   * Coste de «Mis Horas» con su desglose (horas, comisiones, citas), indexado
   * por id de EMPLEADO —no de perfil— y mes. La pantalla lo necesita entero
   * para poder enseñar las horas REALES al lado de las contratadas.
   */
  hoursDetail: Record<string, Record<string, PersonCost>>
  /** Lo mismo reducido al importe, que es lo que consume el cálculo del dominio */
  dataset: EmployeesDataset
}

/**
 * Todo lo que hace falta para pintar cualquier vista del módulo, para los
 * meses que se pidan.
 *
 * `periods` son claves 'yyyy-MM-01'. El coste por horas se calcula mes a mes
 * y solo para quien cobra así: si algún día no queda nadie por horas, ni
 * siquiera se consultan las tablas de payroll.
 */
/**
 * SOBRE QUÉ TRAMO SE CUENTA EL SUELDO DE CADA MES.
 *
 * `mes`   — el mes natural, del 1 al 30. Es lo devengado en ese mes.
 * `ciclo` — el ciclo del 15 al 14 que SE PAGA ese mes. Para septiembre, del 15
 *           de agosto al 14 de septiembre.
 *
 * Tesorería usa `ciclo` porque mide dinero que sale de la cuenta, y a la gente
 * se le paga el día 15: lo que sale en septiembre es el ciclo que cerró el 14.
 * Con el mes natural el importe no correspondía a ningún pago real y además se
 * quedaba abierto hasta fin de mes, cuando en realidad ya no puede cambiar
 * desde el día 14.
 *
 * Control empleados sigue con `mes`, y no es un descuido: esa pantalla enseña
 * lo que cada persona gana en cada mes, no lo que se le transfiere. Las dos
 * cifras salen del MISMO motor —cost.ts, día a día—, así que no pueden
 * discrepar por accidente: miden dos cosas distintas a propósito.
 */
export type BaseDeCoste = 'mes' | 'ciclo'

export async function loadEmployeesData(
  periods: string[],
  opciones: { base?: BaseDeCoste } = {}
): Promise<EmployeesServerData> {
  const service = createServiceClient()
  const base = opciones.base ?? 'mes'

  try {
    return await loadFromTables(service, periods, base)
  } catch (error) {
    if (!isMissingTable(error)) throw error
    // Sin tablas no hay nada que enseñar, pero tampoco hay nada que ocultar:
    // el coste de empleados es cero de verdad mientras el módulo no exista.
    return {
      employees: [],
      steps: [],
      records: [],
      extras: [],
      missingTables: true,
      usdEur: 0.92,
      hoursDetail: {},
      dataset: { employees: [], steps: [], records: [], extras: [], hoursCost: {}, baseCoste: base },
    }
  }
}

async function loadFromTables(
  service: ReturnType<typeof createServiceClient>,
  periods: string[],
  base: BaseDeCoste
): Promise<EmployeesServerData> {
  const [employees, steps, records, settings, extras] = await Promise.all([
    fetchAll<Employee>((a, b) =>
      service
        .from('employees')
        .select('*')
        .order('position', { ascending: true, nullsFirst: false })
        .order('id')
        .range(a, b)
    ),
    fetchAll<EmployeeSalaryStep>((a, b) =>
      service
        .from('employee_salary_steps')
        .select('*')
        .order('effective_from', { ascending: true })
        .order('id')
        .range(a, b)
    ),
    fetchAll<EmployeeMonthRecord>((a, b) =>
      service.from('employee_month_records').select('*').order('period').order('id').range(a, b)
    ),
    service.from('app_settings').select('key, value').eq('key', 'usd_eur_rate').maybeSingle(),
    /**
     * Los encargos van en su propia llamada y con su propio catch: la 178 se
     * lanza a mano, y hasta que se lance esta tabla no existe. Si el fallo
     * subiera, tumbaría Control empleados y el bloque de Tesorería enteros por
     * una función que hasta ayer no estaba.
     */
    fetchAll<EmployeeExtra>((a, b) =>
      service.from('employee_extras').select('*').order('period').order('id').range(a, b)
    ).catch((error) => {
      if (isMissingTable(error)) return [] as EmployeeExtra[]
      throw error
    }),
  ])

  const usdEur = Number(settings.data?.value ?? 0.92)

  const hourly = employees.filter((e) => e.pay_model === 'horas' && e.user_id)
  const hoursDetail: Record<string, Record<string, PersonCost>> = {}
  const hoursCost: Record<string, Record<string, number>> = {}

  if (hourly.length > 0 && periods.length > 0) {
    const [workHours, rates, qualified, manual] = await Promise.all([
      fetchAll<WorkHourEntry>((a, b) =>
        service.from('work_hours').select('*').order('id').range(a, b)
      ),
      fetchAll<PayrollRate>((a, b) =>
        service.from('payroll_rates').select('*').order('id').range(a, b)
      ),
      fetchAll<CostAppointment>((a, b) =>
        service
          .from('appointments')
          .select('comercial_id, start_time')
          .eq('status', 'qualified')
          .eq('is_external', false)
          .order('id')
          .range(a, b)
      ),
      fetchAll<ManualAppointment>((a, b) =>
        service.from('payroll_manual_appointments').select('*').order('id').range(a, b)
      ),
    ])

    for (const e of hourly) {
      const byPeriod: Record<string, PersonCost> = {}
      const totals: Record<string, number> = {}
      for (const p of periods) {
        // Las dos ramas llaman al mismo motor con distinto recorte de días: lo
        // único que cambia es qué días entran, no cómo se calcula ninguno.
        const cost =
          base === 'ciclo'
            ? cycleCostForUser(e.user_id!, {
                periodKey: cycleKeyPaidInMonth(p),
                hours: workHours,
                rates,
                qualified,
                manual,
              })
            : monthCostForUser(e.user_id!, {
                month: p,
                hours: workHours,
                rates,
                qualified,
                manual,
              })
        byPeriod[p] = cost
        totals[p] = cost.total
      }
      hoursDetail[e.id] = byPeriod
      hoursCost[e.id] = totals
    }
  }

  return {
    employees,
    steps,
    records,
    extras,
    missingTables: false,
    usdEur,
    hoursDetail,
    dataset: { employees, steps, records, extras, hoursCost, baseCoste: base },
  }
}

/**
 * La respuesta que consume la interfaz: totales por mes y, si quien pregunta
 * es admin, el desglose por persona.
 *
 * `detail` NO se deduce aquí de nada que venga del cliente: lo pasa quien ya
 * ha comprobado el rol contra la sesión.
 */
export function buildCostResponse(
  data: EmployeesServerData,
  periods: string[],
  detail: boolean
): EmployeesCostResponse {
  const totals = periods.map((p) => {
    const t = employeesMonthTotal(p, data.dataset, data.usdEur)
    return {
      period: p,
      eur: t.eur,
      usd: t.usd,
      headcount: t.headcount,
      warnings: t.warnings,
      accruing: t.accruing,
    }
  })

  if (!detail) {
    return { periods, usdEur: data.usdEur, detail: false, pendingSetup: data.missingTables, totals }
  }

  const rows = data.employees.map((e) => ({
    employeeId: e.id,
    name: e.name,
    payModel: e.pay_model,
    months: periods.map((p) => employeeMonth(e, p, data.dataset)),
  }))

  return { periods, usdEur: data.usdEur, detail: true, pendingSetup: data.missingTables, totals, rows }
}
