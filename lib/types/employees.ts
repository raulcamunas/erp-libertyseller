import { toMadrid } from '@/lib/timezone'
import type { CalendarPerson } from '@/lib/types/appointments'

/**
 * CONTROL DE EMPLEADOS
 * ====================
 * Tipos y cálculo del módulo. Funciones puras, sin React: lo usan igual el
 * Server Component, los componentes de cliente y las rutas de API.
 *
 * LO ÚNICO QUE HAY QUE ENTENDER ANTES DE TOCAR ESTO
 * ------------------------------------------------
 * 1) EL SUELDO NO ES UN NÚMERO, ES UNA SERIE DE ESCALONES.
 *    Un campo `sueldo` obliga a editarlo cada vez que sube, y al editarlo
 *    se pierde lo que cobraba antes: el mes pasado empieza a mentir. Con
 *    escalones, el importe de un mes cualquiera es el ÚLTIMO escalón cuya
 *    fecha de efecto sea menor o igual a ese mes. Eso contesta a la vez a
 *    «cuánto cobra», «cuánto cobraba en mayo» y «cuánto va a cobrar en
 *    noviembre», y programar una subida futura es añadir una fila, no
 *    acordarse de cambiar una celda el día 1.
 *
 * 2) LA HISTORIA NO SE REESCRIBE.
 *    Un mes ya cerrado vale lo que se registró en su momento
 *    (employee_month_records), aunque el modelo diga hoy otra cosa: con esa
 *    cifra se calculó el beneficio de aquel mes y el reparto entre socios.
 *    Del mes en curso en adelante manda el cálculo. Cuando las dos cifras
 *    existen y no coinciden, aquí se devuelven LAS DOS y la diferencia, para
 *    que la interfaz la enseñe en vez de elegir en silencio. Es dinero real.
 *
 * 3) LO QUE COBRAN LOS COMERCIALES NO SE GUARDA AQUÍ.
 *    Sale de «Mis Horas» (horas × tarifa + comisiones) a través de
 *    lib/payroll/cost.ts, que es el mismo motor que usa el CRM. Si se
 *    copiara a esta tabla habría dos cifras para el mismo mes.
 */

export type PayModel = 'fijo' | 'horas'
export type HoursUnit = 'mes' | 'semana'
export type EmployeeCurrency = 'EUR' | 'USD'

/** Si se añade uno, hay que añadirlo también al CHECK de la migración 111 */
export type EmployeeNoteKind = 'nota' | 'subida' | 'revision' | 'ausencia' | 'aviso'

export interface Employee {
  id: string
  /** Perfil del ERP. null en quien cobra pero no tiene cuenta */
  user_id: string | null
  name: string
  role_label: string | null
  pay_model: PayModel
  /** Horas contratadas. null = sin jornada pactada todavía */
  contracted_hours: number | null
  hours_unit: HoursUnit
  currency: EmployeeCurrency
  /** 'yyyy-MM-dd' */
  started_on: string | null
  /** 'yyyy-MM-dd'. Es lo ÚNICO que corta la serie de escalones */
  ended_on: string | null
  is_active: boolean
  position: number | null
  notes: string | null
  created_at: string
  updated_at: string
}

/**
 * Lo mínimo de un perfil del ERP para poder enlazarlo con un empleado.
 * El enlace es lo que hace que el coste de quien cobra por horas se pueda
 * calcular: sin él, esa persona cuesta 0 en Tesorería todos los meses.
 */
export interface LinkableProfile {
  id: string
  full_name: string | null
  email: string | null
  role: string | null
}

export interface EmployeeSalaryStep {
  id: string
  employee_id: string
  /** 'yyyy-MM-01': primer mes en que se cobra este importe */
  effective_from: string
  gross_amount: number
  currency: EmployeeCurrency
  reason: string | null
  created_at: string
  updated_at: string
}

/** Lo que se apuntó de verdad en un mes concreto. No es lo mismo que el escalón */
export interface EmployeeMonthRecord {
  id: string
  employee_id: string
  /** 'yyyy-MM-01' */
  period: string
  amount: number
  currency: EmployeeCurrency
  source: 'manual' | 'tesoreria'
  paid: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

export interface EmployeeNote {
  id: string
  employee_id: string
  author_id: string | null
  kind: EmployeeNoteKind
  body: string
  occurred_at: string
  created_at: string
  author?: CalendarPerson | null
}

// ---------------------------------------------------------------------------
// Etiquetas y colores
// ---------------------------------------------------------------------------

export const PAY_MODELS: PayModel[] = ['fijo', 'horas']

export const PAY_MODEL_LABELS: Record<PayModel, string> = {
  fijo: 'Sueldo fijo',
  horas: 'Por horas',
}

export const PAY_MODEL_HINTS: Record<PayModel, string> = {
  fijo: 'Cobra el importe de su escalón vigente',
  horas: 'Sale de «Mis Horas»: horas × tarifa + comisiones',
}

export const PAY_MODEL_COLORS: Record<PayModel, string> = {
  fijo: '#3B82F6',
  horas: '#22C55E',
}

export const HOURS_UNIT_LABELS: Record<HoursUnit, string> = {
  mes: 'al mes',
  semana: 'a la semana',
}

export const NOTE_KINDS: EmployeeNoteKind[] = [
  'nota',
  'subida',
  'revision',
  'ausencia',
  'aviso',
]

export const NOTE_KIND_LABELS: Record<EmployeeNoteKind, string> = {
  nota: 'Nota',
  subida: 'Subida de sueldo',
  revision: 'Revisión',
  ausencia: 'Ausencia',
  aviso: 'Aviso',
}

export const NOTE_KIND_COLORS: Record<EmployeeNoteKind, string> = {
  nota: '#94A3B8',
  subida: '#22C55E',
  revision: '#FF6600',
  ausencia: '#EAB308',
  aviso: '#EF4444',
}

/**
 * El azul que tenía la categoría «Equipo» en Tesorería
 * (EXPENSE_COLORS.equipo). El bloque de empleados lo hereda para no romper
 * el código de color que el equipo ya tiene aprendido.
 */
export const EMPLOYEES_COLOR = '#3B82F6'

/** De dónde sale el importe de un mes. Lo pinta la interfaz tal cual */
export type MonthAmountSource =
  /** Del histórico: mes cerrado, vale lo que se apuntó entonces */
  | 'registrado'
  /** Del escalón de sueldo vigente */
  | 'escalon'
  /** Calculado desde «Mis Horas» */
  | 'horas'
  /** Mes pasado sin ningún apunte. Suma 0 para no inventar historia */
  | 'sin_registro'
  /** Antes del alta o después de la baja: no cobra y no debe sumar */
  | 'fuera_de_alta'
  /**
   * Cobra por horas y no tiene perfil del ERP enlazado, así que no hay de
   * dónde sacar el coste. NO es lo mismo que «no cobra»: es un cero que hay
   * que arreglar, y por eso tiene fuente propia y cuenta como aviso.
   */
  | 'sin_perfil'
  /** No hay ni registro ni con qué calcularlo */
  | 'sin_datos'

export const MONTH_SOURCE_LABELS: Record<MonthAmountSource, string> = {
  registrado: 'Registrado',
  escalon: 'Según su escalón',
  horas: 'Calculado de Mis Horas',
  sin_registro: 'Sin registrar',
  fuera_de_alta: 'Fuera de alta',
  sin_perfil: 'Sin perfil enlazado',
  sin_datos: 'Sin datos',
}

// ---------------------------------------------------------------------------
// Meses
// ---------------------------------------------------------------------------

const MONTHS_SHORT = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
]

const MONTHS_LONG = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

function pad(n: number) {
  return String(n).padStart(2, '0')
}

/**
 * 'yyyy-MM-01' de cualquier fecha en texto ('yyyy-MM-dd', 'yyyy-MM' o un
 * ISO completo). Se trocea el texto en vez de pasar por `new Date()`:
 * `new Date('2026-08-01')` se interpreta en UTC y en España a última hora
 * del día 31 devolvería el mes anterior.
 */
export function monthKeyOf(date: string): string {
  return `${date.slice(0, 7)}-01`
}

/** El mes en curso, en hora de España, como 'yyyy-MM-01' */
export function currentMonthKey(): string {
  const d = toMadrid(new Date())
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`
}

/** Desplaza una clave de mes n meses (n negativo va hacia atrás) */
export function addMonths(period: string, n: number): string {
  const [y, m] = period.split('-').map(Number)
  let yy = y
  let mm = m - 1 + n
  yy += Math.floor(mm / 12)
  mm = ((mm % 12) + 12) % 12
  return `${yy}-${pad(mm + 1)}-01`
}

/**
 * La serie de meses de la tabla «cuánto cobra y cuánto va a cobrar».
 * Devuelve `count` claves consecutivas empezando en `from`.
 */
export function monthSeries(from: string, count: number): string[] {
  const out: string[] = []
  for (let i = 0; i < count; i += 1) out.push(addMonths(from, i))
  return out
}

/**
 * La serie centrada en un mes: `back` meses hacia atrás y `forward` hacia
 * adelante, incluido el propio. Es la vista natural del módulo — lo que ya
 * se cobró a la izquierda y lo que se va a cobrar a la derecha.
 */
export function monthSeriesAround(center: string, back: number, forward: number): string[] {
  return monthSeries(addMonths(center, -back), back + forward + 1)
}

/** «ago 26», para cabeceras de columna estrechas */
export function monthShortLabel(period: string): string {
  const [y, m] = period.split('-').map(Number)
  return `${MONTHS_SHORT[m - 1]} ${String(y).slice(2)}`
}

/**
 * «agosto 2026», para títulos y avisos. Mismo formato que periodLabel() de
 * Tesorería, pero escrito aquí para que el módulo no dependa de otro: los dos
 * hablan de meses naturales y la clave es idéntica.
 */
export function monthLongLabel(period: string): string {
  const [y, m] = period.split('-').map(Number)
  return `${MONTHS_LONG[m - 1]} ${y}`
}

/**
 * Las claves 'yyyy-MM-01' están rellenadas con ceros, así que comparar los
 * textos en orden alfabético ordena igual que comparar fechas. Se usa en
 * todo el módulo para saber si un mes es pasado.
 */
export function isPastMonth(period: string, current = currentMonthKey()): boolean {
  return period < current
}

// ---------------------------------------------------------------------------
// Escalones
// ---------------------------------------------------------------------------

/**
 * El escalón que manda en un mes: el último cuya fecha de efecto sea menor
 * o igual a ese mes. Si se pasan escalones de varias personas hay que
 * indicar `employeeId`, o se mezclarían sueldos de gente distinta.
 */
export function stepForMonth(
  steps: EmployeeSalaryStep[],
  period: string,
  employeeId?: string
): EmployeeSalaryStep | null {
  let best: EmployeeSalaryStep | null = null
  for (const s of steps) {
    if (employeeId && s.employee_id !== employeeId) continue
    const from = monthKeyOf(s.effective_from)
    if (from > period) continue
    if (!best || from > monthKeyOf(best.effective_from)) best = s
  }
  return best
}

/** El importe bruto pactado para ese mes, o null si aún no hay ningún escalón */
export function salaryForMonth(
  steps: EmployeeSalaryStep[],
  period: string,
  employeeId?: string
): number | null {
  const step = stepForMonth(steps, period, employeeId)
  return step ? Number(step.gross_amount) : null
}

/** El escalón vigente hoy. Atajo de lo anterior para la ficha de la persona */
export function currentStep(
  steps: EmployeeSalaryStep[],
  employeeId?: string
): EmployeeSalaryStep | null {
  return stepForMonth(steps, currentMonthKey(), employeeId)
}

/** Los escalones que aún no han entrado en vigor: las subidas ya pactadas */
export function futureSteps(
  steps: EmployeeSalaryStep[],
  employeeId?: string,
  current = currentMonthKey()
): EmployeeSalaryStep[] {
  return steps
    .filter((s) => (!employeeId || s.employee_id === employeeId) && monthKeyOf(s.effective_from) > current)
    .sort((a, b) => a.effective_from.localeCompare(b.effective_from))
}

/**
 * Si ese mes cae FUERA de las fechas del contrato, y por qué lado.
 * null = dentro. El mes de la baja cuenta como dentro: se trabajó parte de él
 * y se cobra.
 */
export function contractGap(
  employee: Employee,
  period: string
): 'antes_del_alta' | 'despues_de_la_baja' | null {
  if (employee.started_on && monthKeyOf(employee.started_on) > period) return 'antes_del_alta'
  if (employee.ended_on && monthKeyOf(employee.ended_on) < period) return 'despues_de_la_baja'
  return null
}

/**
 * Si esa persona está de alta ese mes.
 *
 * LA FECHA MANDA SOBRE LA MARCA, y el orden de estas tres líneas es dinero.
 * Poner la fecha de baja apaga `is_active` (esa persona ya no está en
 * plantilla), así que si `is_active` se mirara primero, teclear «se fue el 20
 * de agosto» pondría el sueldo de agosto a 0 —un mes que sí se cobra— y en
 * Tesorería desaparecerían esos euros del gasto, inflando el beneficio y el
 * reparto entre socios. Por eso, cuando hay fechas, deciden ellas; `is_active`
 * solo corta a quien está de baja SIN fecha, que es la única forma de decir
 * «ya no cuenta» sin poder decir desde cuándo.
 *
 * Y sigue haciendo falta cortar: sin esto, el último escalón de quien se fue
 * seguiría sumando en Tesorería para siempre, que es el fallo clásico de este
 * modelo.
 */
export function isWithinContract(employee: Employee, period: string): boolean {
  if (contractGap(employee, period)) return false
  if (employee.ended_on) return true
  return employee.is_active
}

// ---------------------------------------------------------------------------
// El importe de un mes
// ---------------------------------------------------------------------------

export interface EmployeeMonthAmount {
  employeeId: string
  /** 'yyyy-MM-01' */
  period: string
  /** Lo que suma ese mes, en `currency`. Es lo que va a Tesorería */
  amount: number
  currency: EmployeeCurrency
  source: MonthAmountSource
  /** Lo que se apuntó en su día. null si aquel mes no se registró */
  recorded: number | null
  /** Lo que dice el modelo hoy: su escalón, o el cálculo de Mis Horas */
  computed: number | null
  /**
   * computed − recorded cuando existen las dos y no coinciden. La interfaz
   * lo enseña; el módulo no elige por su cuenta cuál es la buena.
   */
  divergence: number | null
  /** El escalón que se aplicó, si el importe salió de ahí */
  step: EmployeeSalaryStep | null
}

/**
 * Todo lo que hace falta para calcular. Se pasan las tablas planas tal y
 * como vienen de Supabase, sin agrupar por persona.
 */
export interface EmployeesDataset {
  employees: Employee[]
  steps: EmployeeSalaryStep[]
  records: EmployeeMonthRecord[]
  /**
   * Coste calculado desde «Mis Horas», SIEMPRE en dólares:
   * `hoursCost[employeeId][period] = importe`.
   * Lo produce lib/payroll/cost.ts — aquí no se recalcula nada de payroll,
   * justo para que no haya dos motores dando cifras distintas.
   */
  hoursCost?: Record<string, Record<string, number>>
  /** Mes en curso. Lo anterior es historia y no se reescribe */
  currentPeriod?: string
}

/** El importe de una persona en un mes, con su procedencia y su desfase */
export function employeeMonth(
  employee: Employee,
  period: string,
  data: EmployeesDataset
): EmployeeMonthAmount {
  const current = data.currentPeriod ?? currentMonthKey()

  const record =
    data.records.find((r) => r.employee_id === employee.id && monthKeyOf(r.period) === period) ??
    null
  const recorded = record ? Number(record.amount) : null

  const inContract = isWithinContract(employee, period)
  const step = employee.pay_model === 'fijo' ? stepForMonth(data.steps, period, employee.id) : null

  let computed: number | null = null
  if (inContract) {
    computed =
      employee.pay_model === 'horas'
        ? data.hoursCost?.[employee.id]?.[period] ?? null
        : step
        ? Number(step.gross_amount)
        : null
  }

  const divergence =
    computed != null && recorded != null && Math.abs(computed - recorded) > 0.005
      ? computed - recorded
      : null

  const base = {
    employeeId: employee.id,
    period,
    recorded,
    computed,
    divergence,
    step,
  }

  // Mes cerrado: manda lo que se apuntó. Aunque el modelo diga otra cosa,
  // con esa cifra se cerró aquel mes.
  if (isPastMonth(period, current)) {
    if (record) {
      return { ...base, amount: recorded ?? 0, currency: record.currency, source: 'registrado' }
    }
    // Nadie lo apuntó. Suma 0 a propósito: rellenarlo con el escalón
    // cambiaría el beneficio de un mes ya cerrado. `computed` sigue ahí
    // para que la interfaz pueda enseñar «esto se quedó sin registrar».
    return {
      ...base,
      amount: 0,
      currency: employee.currency,
      source: inContract ? 'sin_registro' : 'fuera_de_alta',
    }
  }

  // Mes en curso o futuro: manda el cálculo.
  if (!inContract) {
    return { ...base, amount: 0, currency: employee.currency, source: 'fuera_de_alta' }
  }
  if (computed != null) {
    return {
      ...base,
      amount: computed,
      // Payroll va en dólares: lo que sale de «Mis Horas» es dólares
      currency: employee.pay_model === 'horas' ? 'USD' : step?.currency ?? employee.currency,
      source: employee.pay_model === 'horas' ? 'horas' : 'escalon',
    }
  }
  // No hay con qué calcular. Si al menos hay un apunte de ese mes, vale.
  if (record) {
    return { ...base, amount: recorded ?? 0, currency: record.currency, source: 'registrado' }
  }
  // Cobra por horas pero no tiene perfil enlazado: su coste sale de «Mis
  // Horas» y sin user_id no hay a quién mirar. Se distingue de 'sin_datos'
  // porque no es que no tenga sueldo, es que falta el enlace — y mientras
  // falte, esa persona cuesta 0 en Tesorería todos los meses.
  if (employee.pay_model === 'horas' && !employee.user_id) {
    return { ...base, amount: 0, currency: employee.currency, source: 'sin_perfil' }
  }
  return { ...base, amount: 0, currency: employee.currency, source: 'sin_datos' }
}

/**
 * La fila de una persona en la tabla de «cuánto cobra y cuánto va a
 * cobrar»: su importe en cada uno de los meses pedidos.
 */
export function employeeMonthSeries(
  employee: Employee,
  periods: string[],
  data: EmployeesDataset
): EmployeeMonthAmount[] {
  return periods.map((p) => employeeMonth(employee, p, data))
}

export interface EmployeeMonthRow {
  employee: Employee
  month: EmployeeMonthAmount
}

/** Todos los empleados en un mes, en el orden en que se pintan */
export function employeesMonth(period: string, data: EmployeesDataset): EmployeeMonthRow[] {
  return [...data.employees]
    .sort(
      (a, b) =>
        (a.position ?? 9999) - (b.position ?? 9999) || a.name.localeCompare(b.name, 'es')
    )
    .map((employee) => ({ employee, month: employeeMonth(employee, period, data) }))
}

// ---------------------------------------------------------------------------
// Divisa
// ---------------------------------------------------------------------------

/**
 * A euros con el tipo de cambio de app_settings ('usd_eur_rate').
 * Mismo criterio que expenseInEuros de Tesorería: se guarda en la divisa
 * en que se paga y se convierte al enseñarlo, nunca al guardarlo. Si se
 * convirtiera al guardar, cambiar el tipo de cambio reescribiría el pasado.
 */
export function toEuros(amount: number, currency: EmployeeCurrency, usdEur: number): number {
  const n = Number(amount) || 0
  return currency === 'USD' ? n * usdEur : n
}

/** El camino inverso, para enseñar en dólares un importe apuntado en euros */
export function toDollars(amount: number, currency: EmployeeCurrency, usdEur: number): number {
  const n = Number(amount) || 0
  if (currency === 'EUR') return usdEur > 0 ? n / usdEur : 0
  return n
}

export interface EmployeesMonthTotal {
  period: string
  /** Lo que suma el bloque «Empleados al mes» de Tesorería */
  eur: number
  usd: number
  rows: EmployeeMonthRow[]
  /** Cuántas personas suman algo ese mes */
  headcount: number
  /** Meses pasados sin registrar, desfases y ceros por arreglar: lo que hay que revisar */
  warnings: number
  /**
   * Cuánta gente sigue DEVENGANDO este mes: los que cobran por horas cuando el
   * mes es el que está en curso. Su importe es lo que llevan trabajado a día
   * de hoy y sube cada día que fichan, así que el total todavía no es el
   * definitivo. Va en el total —es dinero ya devengado— pero quien lo pinta
   * tiene que poder decir que aún no ha cerrado: si no, el beneficio del mes
   * en curso se lee como un hecho cuando le faltan tres semanas de sueldos.
   */
  accruing: number
}

/**
 * EL TOTAL QUE SUMA TESORERÍA.
 *
 * Se CALCULA, no se copian filas de gasto, y esa decisión es justo la que
 * alguien deshace dentro de seis meses «para simplificar». La razón está en
 * los datos que había antes de este módulo: los sueldos eran siete filas
 * copiadas a mano cada mes en treasury_expenses, y a septiembre le faltaban
 * tres personas y una estaba a cero. No por mala fe: porque copiar a mano
 * siete filas todos los meses falla. Un total calculado no se puede olvidar
 * de nadie, y una subida se refleja sola en todos los meses siguientes.
 *
 * Y suma UNA sola vez porque los sueldos ya no viven en treasury_expenses:
 * la migración 112 los sacó de ahí. Si alguien vuelve a meter filas de
 * sueldos como gasto, el mes se contará dos veces.
 */
export function employeesMonthTotal(
  period: string,
  data: EmployeesDataset,
  usdEur: number
): EmployeesMonthTotal {
  const current = data.currentPeriod ?? currentMonthKey()
  const rows = employeesMonth(period, data)
  let eur = 0
  let usd = 0
  let headcount = 0
  let warnings = 0
  let accruing = 0

  for (const { month } of rows) {
    if (month.amount !== 0) {
      eur += toEuros(month.amount, month.currency, usdEur)
      usd += toDollars(month.amount, month.currency, usdEur)
      headcount += 1
    }
    if (month.divergence != null) warnings += 1
    if (month.source === 'sin_registro') warnings += 1
    // Un «por horas» sin perfil enlazado cuesta 0 para siempre y en silencio.
    // Solo se cuenta hasta el mes en curso: contarlo también en los doce meses
    // futuros multiplicaría por trece el aviso de una sola persona.
    if (month.source === 'sin_perfil' && period <= current) warnings += 1
    if (month.source === 'horas' && period === current) accruing += 1
  }

  return { period, eur, usd, rows, headcount, warnings, accruing }
}

// ---------------------------------------------------------------------------
// Formato
// ---------------------------------------------------------------------------

/** Importe con su símbolo, en formato español. '—' cuando no hay dato */
export function formatMoney(n: number | null | undefined, currency: EmployeeCurrency): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return n.toLocaleString('es-ES', {
    style: 'currency',
    currency,
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })
}

/**
 * Horas contratadas en horas al mes, para poder compararlas con las horas
 * reales de «Mis Horas», que se cuentan por mes natural.
 * 52 semanas / 12 meses = 4,333 semanas al mes; no son 4.
 */
export function contractedHoursPerMonth(employee: Employee): number | null {
  if (employee.contracted_hours == null) return null
  const h = Number(employee.contracted_hours)
  if (!Number.isFinite(h)) return null
  return employee.hours_unit === 'semana' ? (h * 52) / 12 : h
}
