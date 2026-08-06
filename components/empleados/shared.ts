import {
  addMonths,
  employeeMonth,
  type Employee,
  type EmployeesDataset,
} from '@/lib/types/employees'

/**
 * Piezas compartidas de la interfaz de Control empleados.
 *
 * SIN 'use client' A PROPÓSITO, igual que components/marketing/shared.ts: el
 * Server Component de la página importa de aquí las clases para pintar la
 * cabecera, y bastaría con que alguien le pusiera la directiva a este fichero
 * para romper esa importación.
 */

// Mismo lenguaje que marketing y tesorería: la celda no parece un campo hasta
// que se pasa por encima, para que una tabla de seis columnas editables no se
// lea como un formulario.
const cellShell =
  'bg-transparent hover:bg-white/[0.05] focus:bg-white/[0.08] border border-transparent focus:border-[#FF6600] rounded px-1.5 py-1 outline-none transition-colors placeholder:text-white/20'

export const textInput = `w-full ${cellShell} text-[12px] text-white`
export const numInput = `w-full ${cellShell} text-[12px] text-white text-right tabular-nums`

/** Campo de formulario de verdad (el de la ficha), que sí se ve siempre */
export const fieldInput =
  'w-full bg-white/[0.04] border border-white/10 rounded-lg px-2.5 py-1.5 text-[12px] text-white outline-none focus:border-[#FF6600] transition-colors placeholder:text-white/25'

/** Igual pero para fechas: sin [color-scheme:dark] el selector nativo sale blanco */
export const dateInput = `${fieldInput} [color-scheme:dark]`

export const primaryButton =
  'h-8 px-3.5 rounded-full bg-gradient-to-b from-[#FF7A1F] to-[#FF6600] text-white text-[12px] font-semibold flex items-center justify-center gap-1.5 disabled:opacity-40 transition-opacity'

export const ghostButton =
  'h-8 px-3.5 rounded-full border border-white/10 bg-white/[0.03] text-white/75 text-[12px] font-medium flex items-center justify-center gap-1.5 hover:bg-white/[0.06] hover:border-white/20 transition-colors disabled:opacity-50'

/**
 * Coma o punto, los dos valen: se teclea con el teclado que se tenga.
 * `null` = campo vacío a propósito; `undefined` = no es un número, descartar
 * la edición sin guardar nada (mismo criterio que marketing).
 */
export function parseDecimal(raw: string): number | null | undefined {
  const v = raw.trim()
  if (v === '') return null
  const n = Number(v.replace(',', '.'))
  return Number.isFinite(n) ? n : undefined
}

/** 'yyyy-MM-01' -> 'yyyy-MM', que es lo que come un <input type="month"> */
export function toMonthInput(period: string): string {
  return period.slice(0, 7)
}

/** El camino de vuelta, tolerando que el navegador devuelva el campo vacío */
export function fromMonthInput(value: string): string | null {
  return /^\d{4}-\d{2}$/.test(value) ? `${value}-01` : null
}

export interface HourlyReference {
  /** La media, en dólares */
  amount: number
  /** Sobre cuántos meses se ha calculado. Se enseña: una media de 1 mes no es una media */
  months: number
}

/**
 * REFERENCIA PARA LOS QUE COBRAN POR HORAS — Y POR QUÉ NO ES UNA PREVISIÓN
 * =======================================================================
 * A un comercial no se le puede proyectar el sueldo de noviembre: depende de
 * las horas que trabaje y de las citas que cualifique, y ninguna de las dos
 * cosas ha pasado todavía. Poner ahí un número calculado y pintarlo como el
 * resto sería inventar un dato.
 *
 * Lo que sí se puede decir con honestidad es «los tres últimos meses cerrados
 * salieron a una media de X». Eso es un hecho sobre el pasado, no una promesa
 * sobre el futuro, y por eso la interfaz lo enseña siempre con el prefijo «≈»,
 * en gris y con borde discontinuo, y NUNCA lo suma al total en firme: los
 * totales llevan la parte variable aparte, en una segunda línea.
 *
 * Vive aquí, en la capa de interfaz, y no en lib/types/employees.ts, justo
 * para que no pueda colarse en employeesMonthTotal() —lo que suma Tesorería—
 * ni por accidente ni por un «ya que estamos» dentro de seis meses.
 */
export function hourlyReference(
  employee: Employee,
  data: EmployeesDataset,
  currentPeriod: string,
  lookback = 3
): HourlyReference | null {
  const values: number[] = []
  for (let i = 1; values.length < lookback && i <= 12; i += 1) {
    const p = addMonths(currentPeriod, -i)
    const m = employeeMonth(employee, p, data)
    // Se prefiere lo calculado desde «Mis Horas» a lo registrado: es la misma
    // fórmula con la que se calculará el mes futuro, así que la media compara
    // peras con peras. Si aquel mes no hay horas, vale lo que se apuntó.
    const value = m.computed ?? m.recorded
    if (value != null && value > 0) values.push(value)
  }
  if (values.length === 0) return null
  return {
    amount: values.reduce((s, v) => s + v, 0) / values.length,
    months: values.length,
  }
}

/** Dólares en formato español y compacto, para celdas estrechas */
export function shortMoney(n: number, currency: 'EUR' | 'USD' = 'USD'): string {
  return n.toLocaleString('es-ES', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.abs(n) < 100 && n % 1 !== 0 ? 2 : 0,
  })
}
