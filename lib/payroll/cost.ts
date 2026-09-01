import { toMadrid } from '@/lib/timezone'
import {
  WorkHourEntry,
  PayrollRate,
  ManualAppointment,
  cycleKeyForDate,
  resolveRate,
} from '@/lib/types/payroll'

/**
 * LO QUE CUESTA UNA PERSONA QUE COBRA POR HORAS
 * =============================================
 * Este cálculo estaba escrito tres veces —MonthBreakdown, ClientsCRM y
 * HoursTracker—, y las tres copias ya habían empezado a separarse: una
 * filtraba por comerciales y otra no. Con el módulo de empleados metiendo
 * la misma cifra en Tesorería habría una cuarta, y entonces la misma
 * pregunta («¿cuánto costó agosto?») tendría tres respuestas distintas en
 * tres pantallas y nadie sabría a cuál creer. De ahí este fichero: un solo
 * motor, sin React, importable desde el servidor y desde el cliente.
 *
 * LA REGLA, que es lo que hay que entender antes de tocar nada:
 *
 *   El coste de un MES NATURAL se calcula día a día, y cada día se paga a
 *   la tarifa del CICLO 15→14 al que pertenece ese día.
 *
 * Son dos calendarios que conviven a propósito y no hay que elegir uno:
 * las tarifas cambian por ciclos del 15 al 14 (así se pactaron y así lo
 * enseña «Mis Horas»), pero Tesorería y el CRM cierran por meses
 * naturales. Como cada día cae en un único mes y en un único ciclo, la
 * suma de los doce meses del año cuadra exactamente con la suma de los
 * doce ciclos. No hay que prorratear nada.
 *
 * En la práctica: dentro de agosto, los días 1 al 14 se pagan a la tarifa
 * del ciclo que abrió el 15 de julio, y del 15 en adelante a la del ciclo
 * de agosto.
 */

/** Lo mínimo de una cita cualificada para poder costearla */
export interface CostAppointment {
  comercial_id: string | null
  /** timestamptz en ISO, tal y como viene de la base */
  start_time: string
}

/** Lo devengado en un periodo, sin atribuir a nadie */
export interface CostTotals {
  hours: number
  /** horas × tarifa/hora */
  salary: number
  appointments: number
  /** citas cualificadas × comisión */
  commissions: number
  /** salary + commissions */
  total: number
}

/**
 * LA TARIFA PACTADA, que es el «sueldo establecido» de quien cobra por horas.
 * Sin esto, la única forma de saber lo que tiene pactado un comercial es
 * salirse a «Mis Horas» y abrir RateSettings, y quien mira una ficha de
 * empleado ve las horas y el importe pero no el precio al que se pagan.
 *
 * Es la tarifa del ciclo 15→14 vigente al FINAL del mes, es decir, la que se
 * está aplicando hoy. Si a mitad de mes hubo cambio de tarifa, el coste está
 * bien calculado día a día igualmente —eso lo hace monthCostForUser—; esta es
 * la que hay que enseñar cuando se pregunta «¿cuánto cobra la hora?».
 */
export interface CostRate {
  hourly: number
  commission: number
  /** De dónde sale: excepción personal, tarifa general del ciclo o la de por defecto */
  source: 'personal' | 'periodo' | 'defecto'
}

/** Coste de una persona en un periodo. SIEMPRE en dólares: payroll va en dólares */
export interface PersonCost extends CostTotals {
  userId: string
  rate: CostRate
}

export interface MonthCostInput {
  /** 'yyyy-MM', 'yyyy-MM-01' o 'yyyy-MM-dd': se normaliza dentro */
  month: string
  hours: WorkHourEntry[]
  rates: PayrollRate[]
  qualified: CostAppointment[]
  /**
   * Citas que un admin suma a mano (payroll_manual_appointments).
   * Es OPCIONAL y esa es la única razón de que hoy el CRM enseñe menos
   * comisiones que «Mis Horas»: la página del CRM no llega a consultar esa
   * tabla, así que no las pasa. Quien las pase, las cobra.
   */
  manual?: ManualAppointment[]
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

/** 'yyyy-MM-01' | 'yyyy-MM-dd' | 'yyyy-MM'  ->  'yyyy-MM' */
export function monthPrefix(period: string): string {
  return period.slice(0, 7)
}

/**
 * 'yyyy-MM-dd' del día CIVIL EN ESPAÑA de un instante.
 * Importa: media plantilla está en Latinoamérica, y una cita de las 23:00
 * en España es del día siguiente para quien la atiende. El mes de una cita
 * es el que era en España, que es donde se cierra la contabilidad.
 */
export function madridDayKey(iso: string): string {
  const d = toMadrid(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function emptyTotals(): CostTotals {
  return { hours: 0, salary: 0, appointments: 0, commissions: 0, total: 0 }
}

/**
 * Coste devengado de UNA persona en un mes natural.
 * Devuelve ceros si esa persona no tiene ni horas ni citas ese mes, que no
 * es lo mismo que un error: significa que no ha costado nada.
 */
export function monthCostForUser(userId: string, input: MonthCostInput): PersonCost {
  const { hours, rates, qualified, manual } = input
  const prefix = monthPrefix(input.month)
  const acc = emptyTotals()

  for (const h of hours) {
    if (h.user_id !== userId) continue
    // work_date es un DATE: fecha civil pura, sin huso que convertir
    if (!h.work_date.startsWith(prefix)) continue
    const rate = resolveRate(rates, h.work_date, userId)
    acc.hours += Number(h.hours)
    acc.salary += Number(h.hours) * rate.hourly
  }

  for (const a of qualified) {
    if (a.comercial_id !== userId) continue
    const day = madridDayKey(a.start_time)
    if (!day.startsWith(prefix)) continue
    acc.appointments += 1
    acc.commissions += resolveRate(rates, day, userId).commission
  }

  for (const m of manual ?? []) {
    if (m.user_id !== userId) continue
    // appointment_date también es DATE: se compara como texto y ya está
    if (!m.appointment_date.startsWith(prefix)) continue
    acc.appointments += 1
    acc.commissions +=
      m.commission != null
        ? Number(m.commission)
        : resolveRate(rates, m.appointment_date, m.user_id).commission
  }

  acc.total = acc.salary + acc.commissions
  /**
   * La tarifa que se ENSEÑA es la del último día del mes: la que está en vigor
   * al cerrarlo. Si a mitad de mes hubo cambio, el coste está bien calculado día
   * a día de todos modos —eso es el bucle de arriba—; esta es solo la que hay
   * que contestar cuando alguien pregunta «¿a cuánto va la hora?».
   */
  const [ay, am] = prefix.split('-').map(Number)
  const ultimoDia = new Date(Date.UTC(ay, am, 0)).getUTCDate()
  return {
    userId,
    ...acc,
    rate: resolveRate(rates, `${prefix}-${String(ultimoDia).padStart(2, '0')}`, userId),
  }
}

/**
 * Lo mismo para todo el que aparezca en los datos, indexado por user_id.
 * Ojo: incluye a CUALQUIERA con horas apuntadas, sea comercial o no. Si
 * solo interesan los comerciales, hay que llamar a monthCostForUser por
 * cada uno; no filtra por su cuenta.
 */
export function monthCostByUser(input: MonthCostInput): Map<string, PersonCost> {
  const ids = new Set<string>()
  const prefix = monthPrefix(input.month)

  for (const h of input.hours) {
    if (h.work_date.startsWith(prefix)) ids.add(h.user_id)
  }
  for (const a of input.qualified) {
    if (a.comercial_id && madridDayKey(a.start_time).startsWith(prefix)) ids.add(a.comercial_id)
  }
  for (const m of input.manual ?? []) {
    if (m.appointment_date.startsWith(prefix)) ids.add(m.user_id)
  }

  const out = new Map<string, PersonCost>()
  for (const id of ids) out.set(id, monthCostForUser(id, input))
  return out
}

/**
 * Total del mes de un grupo concreto de personas.
 * Se le pasa la lista porque «el equipo» no significa lo mismo en todas
 * las pantallas: el CRM suma a los cuatro comerciales y Tesorería suma a
 * los empleados que cobran por horas. Decidirlo aquí dentro sería adivinar.
 */
export function monthCostForUsers(userIds: string[], input: MonthCostInput): CostTotals {
  const acc = emptyTotals()
  for (const id of userIds) {
    const c = monthCostForUser(id, input)
    acc.hours += c.hours
    acc.salary += c.salary
    acc.appointments += c.appointments
    acc.commissions += c.commissions
  }
  acc.total = acc.salary + acc.commissions
  return acc
}

/**
 * Total del mes de TODO el que tenga horas o citas, sin lista de personas.
 * Es lo que enseña la cabecera del CRM, que cuenta las horas de cualquiera
 * que las haya apuntado aunque no esté marcado como comercial.
 *
 * Recorre las filas del tirón en vez de sumar por persona y luego juntar,
 * y no es por gusto: los importes salen de multiplicar horas con decimales
 * por tarifas con decimales, así que cambiar el ORDEN de las sumas cambia
 * el último bit del resultado. Con un total que se pinta redondeado, eso
 * basta para que aparezca un euro de diferencia respecto a lo que enseñaba
 * ayer la misma pantalla. Sumando en el mismo orden, no hay diferencia.
 */
export function monthCostTotal(input: MonthCostInput): CostTotals {
  const { hours, rates, qualified, manual } = input
  const prefix = monthPrefix(input.month)
  const acc = emptyTotals()

  for (const h of hours) {
    if (!h.work_date.startsWith(prefix)) continue
    const rate = resolveRate(rates, h.work_date, h.user_id)
    acc.hours += Number(h.hours)
    acc.salary += Number(h.hours) * rate.hourly
  }

  for (const a of qualified) {
    if (!a.comercial_id) continue
    const day = madridDayKey(a.start_time)
    if (!day.startsWith(prefix)) continue
    acc.appointments += 1
    acc.commissions += resolveRate(rates, day, a.comercial_id).commission
  }

  for (const m of manual ?? []) {
    if (!m.appointment_date.startsWith(prefix)) continue
    acc.appointments += 1
    acc.commissions +=
      m.commission != null
        ? Number(m.commission)
        : resolveRate(rates, m.appointment_date, m.user_id).commission
  }

  acc.total = acc.salary + acc.commissions
  return acc
}

/**
 * Coste de un CICLO del 15 al 14, que es como lo enseña «Mis Horas».
 * Misma fórmula por día: un día pertenece al ciclo si cycleKeyForDate lo
 * dice. Así el ciclo y el mes salen del mismo motor y no pueden discrepar.
 */
export function cycleCostForUser(
  userId: string,
  input: Omit<MonthCostInput, 'month'> & { periodKey: string }
): PersonCost {
  const { hours, rates, qualified, manual, periodKey } = input
  const acc = emptyTotals()

  for (const h of hours) {
    if (h.user_id !== userId) continue
    if (cycleKeyForDate(h.work_date) !== periodKey) continue
    // POR DÍA, no por ciclo: desde que las tarifas son mensuales, una puede
    // arrancar el día 1 y partir este ciclo por la mitad. Ver resolveRate().
    const rate = resolveRate(rates, h.work_date, userId)
    acc.hours += Number(h.hours)
    acc.salary += Number(h.hours) * rate.hourly
  }

  for (const a of qualified) {
    if (a.comercial_id !== userId) continue
    const day = madridDayKey(a.start_time)
    if (cycleKeyForDate(day) !== periodKey) continue
    acc.appointments += 1
    acc.commissions += resolveRate(rates, day, userId).commission
  }

  for (const m of manual ?? []) {
    if (m.user_id !== userId) continue
    if (cycleKeyForDate(m.appointment_date) !== periodKey) continue
    acc.appointments += 1
    acc.commissions +=
      m.commission != null
        ? Number(m.commission)
        : resolveRate(rates, m.appointment_date, userId).commission
  }

  acc.total = acc.salary + acc.commissions
  /**
   * La que se enseña es la del ÚLTIMO día del ciclo, que es la que está rigiendo
   * cuando se cierra. Si dentro del ciclo hubo cambio de tarifa —que es
   * justamente lo que permiten las tarifas mensuales— el importe de arriba ya
   * está bien: se ha calculado día a día.
   */
  const [py, pm] = periodKey.split('-').map(Number)
  const finCiclo = new Date(Date.UTC(py, pm - 1, 14))
  finCiclo.setUTCMonth(finCiclo.getUTCMonth() + 1)
  return { userId, ...acc, rate: resolveRate(rates, finCiclo.toISOString().slice(0, 10), userId) }
}

/**
 * Coste por mes de una persona, para varios meses de golpe, indexado por
 * 'yyyy-MM-01'. Es la forma en que lo pide el módulo de empleados: una
 * tabla de «cuánto cobra y cuánto va a cobrar» necesita doce meses, y
 * recorrer las horas doce veces por persona es innecesario.
 */
export function monthCostSeriesForUser(
  userId: string,
  periods: string[],
  data: Omit<MonthCostInput, 'month'>
): Record<string, PersonCost> {
  const out: Record<string, PersonCost> = {}
  for (const period of periods) {
    out[period] = monthCostForUser(userId, { ...data, month: period })
  }
  return out
}
