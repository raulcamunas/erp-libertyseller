import type { EmployeeMonthAmount, PayModel } from '@/lib/types/employees'

/**
 * LO QUE VIAJA DEL SERVIDOR AL NAVEGADOR
 * ======================================
 * Estos tipos están en su propio fichero, separados de lib/employees/data.ts,
 * a propósito: data.ts arrastra el cliente de service_role de Supabase, y un
 * componente de cliente que importara los tipos desde allí se traería esa
 * dependencia al bundle. Aquí solo hay formas, ningún import de servidor.
 *
 * Es el mismo contrato que devuelve GET /api/employees/monthly-cost y el que
 * arma la página de Tesorería sin pasar por HTTP.
 */

export interface EmployeesMonthTotalWire {
  /** 'yyyy-MM-01' */
  period: string
  /** Lo que suma ese mes en el total de gastos de Tesorería */
  eur: number
  usd: number
  /** Cuántas personas suman algo ese mes */
  headcount: number
  /** Meses pasados sin registrar, desfases y ceros por arreglar */
  warnings: number
  /**
   * Cuánta gente sigue devengando este mes (cobra por horas y el mes está en
   * curso). Mientras sea > 0 el total todavía va a subir, y Tesorería tiene
   * que decirlo: el beneficio del mes en curso no es definitivo.
   */
  accruing: number
}

export interface EmployeesMonthRowWire {
  employeeId: string
  name: string
  payModel: PayModel
  /** Alineado uno a uno con `periods` de la respuesta */
  months: EmployeeMonthAmount[]
}

export interface EmployeesCostResponse {
  periods: string[]
  usdEur: number
  /**
   * false = quien pregunta es un partner y solo recibe los totales.
   * El desglose de lo que cobra cada persona es solo para admin, así que la
   * interfaz tiene que saber que no le falta un dato: es que no le toca.
   */
  detail: boolean
  /**
   * Las tablas del módulo aún no existen (migraciones 111-115 sin lanzar).
   *
   * Va en la respuesta porque un cero sin explicar es peor que un hueco: el
   * bloque diría «nadie en nómina este mes», que es falso —la gente cobra
   * igual— y encima el total de gastos del mes sale corto sin que nada lo
   * cuente. Con esto, se dice lo que pasa.
   */
  pendingSetup?: boolean
  totals: EmployeesMonthTotalWire[]
  rows?: EmployeesMonthRowWire[]
}

/** El desglose de un mes suelto, que es como lo consume el bloque de Tesorería */
export interface EmployeeMonthCell {
  employeeId: string
  name: string
  payModel: PayModel
  month: EmployeeMonthAmount
}

/**
 * Da la vuelta a la respuesta: de «una fila por persona con todos sus meses»
 * a «un mes con todas sus personas», que es como se pinta.
 */
export function cellsForPeriod(
  data: EmployeesCostResponse | null,
  period: string
): EmployeeMonthCell[] {
  if (!data?.rows) return []
  const idx = data.periods.indexOf(period)
  if (idx < 0) return []
  return data.rows
    .map((r) => ({
      employeeId: r.employeeId,
      name: r.name,
      payModel: r.payModel,
      month: r.months[idx],
    }))
    .filter((c) => c.month != null)
}
