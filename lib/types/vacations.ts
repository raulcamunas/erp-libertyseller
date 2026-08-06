import { MONTHS_LONG, MONTHS_SHORT, pad } from '@/lib/types/employees'
import { toMadrid } from '@/lib/timezone'

/**
 * VACACIONES
 * ==========
 * Tipos y cálculo del módulo. Funciones PURAS, sin React y sin Supabase: las
 * usan igual el Server Component, los componentes de cliente y las rutas de
 * API, y es lo que permite que la pantalla enseñe «te va a costar 4 días»
 * mientras se arrastra el ratón por el calendario, antes de que exista fila.
 *
 * LAS CUATRO COSAS QUE HAY QUE ENTENDER ANTES DE TOCAR ESTO
 * --------------------------------------------------------
 * 1) EL DERECHO ES UN CAMPO DE LA FICHA, NO UNA LISTA DE NOMBRES.
 *    `vacation_days_per_month` a NULL significa «esta persona no genera
 *    vacaciones», que NO es lo mismo que cero. Aquí no hay ni un nombre
 *    propio escrito: añadir a alguien es teclear un número en su ficha.
 *
 * 2) LOS DÍAS SON DE LUNES A VIERNES.
 *    Del viernes al lunes son 2 días, no 4. Vale igual para lo que consume
 *    una petición y para lo que se pinta en el calendario.
 *
 * 3) LO PENDIENTE RESTA.
 *    Mientras una petición espera respuesta esos días están comprometidos. Un
 *    saldo que solo descontara lo aprobado dejaría pedir los mismos cinco
 *    días dos veces y las dos peticiones parecerían caber.
 *
 * 4) EL MES EN CURSO NO SUMA.
 *    Se generan días por mes COMPLETO trabajado. El mes a medias se devuelve
 *    aparte (`inProgress`) para que la pantalla lo enseñe como «en curso», no
 *    sumado.
 *
 * EL DESFASE DE UN DÍA — LO QUE MÁS FÁCIL SE ROMPE AQUÍ
 * ----------------------------------------------------
 * Media plantilla está en Latinoamérica. `new Date('2026-08-01')` se
 * interpreta en UTC, así que en México ese Date es el 31 de julio por la
 * tarde y `getDate()` devuelve 31. Un módulo de vacaciones que se equivoque
 * un día le quita (o le regala) un día de vacaciones a alguien.
 *
 * Por eso, igual que ya hace lib/types/employees.ts con los meses:
 *   - una fecha es TEXTO 'yyyy-MM-dd' de punta a punta, nunca un Date;
 *   - se compara con < y > sobre la cadena, que al estar rellenada con ceros
 *     ordena igual que la fecha;
 *   - la aritmética de días pasa por Date.UTC, que es aritmética pura y no
 *     mira el huso del navegador;
 *   - y el reloj NO se lee dentro de ninguna función de dominio: «hoy» entra
 *     como parámetro. Si se leyera dentro, estas funciones darían resultados
 *     distintos en Madrid y en Bogotá a las once de la noche, y no habría
 *     forma de probarlas. `todayKey()` está abajo, aislada y marcada, para
 *     que quien llama produzca ese parámetro en un solo sitio.
 */

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type VacationStatus = 'pendiente' | 'aprobada' | 'rechazada' | 'cancelada'

/** Fila de public.vacation_requests, tal y como viene de Supabase */
export interface VacationRequest {
  id: string
  employee_id: string
  /** 'yyyy-MM-dd' */
  start_date: string
  /** 'yyyy-MM-dd', incluido */
  end_date: string
  /** Días laborables que consume, congelados al pedirla */
  working_days: number
  status: VacationStatus
  reason: string | null
  /** Quién tecleó la petición. Puede ser un admin registrándola por otra persona */
  created_by: string | null
  resolved_by: string | null
  resolved_at: string | null
  rejection_reason: string | null
  /**
   * Quién la retiró y cuándo. VAN APARTE de resolved_by/resolved_at a
   * propósito: anular unas vacaciones ya aprobadas pisando la firma de la
   * aprobación borra quién las había concedido, y las dos cosas tienen que
   * poder verse a la vez.
   */
  cancelled_by: string | null
  cancelled_at: string | null
  /** Se pidió con menos de 30 días de antelación. Avisa, no bloquea */
  late_notice: boolean
  created_at: string
  updated_at: string
}

/**
 * Lo mínimo de una ficha que necesita el cálculo de vacaciones.
 *
 * Es un subconjunto de `Employee` a propósito y SIN UN SOLO DATO SALARIAL: la
 * pantalla del empleado (/dashboard/vacaciones) recibe exactamente esto, así
 * que si algún día alguien mete aquí el sueldo, lo estará publicando. Un
 * `Employee` completo encaja en este tipo por forma, sin conversiones.
 */
export interface VacationEmployee {
  id: string
  name: string
  /** Perfil del ERP. null = no tiene cuenta y no puede pedirlas ella misma */
  user_id: string | null
  /** 'yyyy-MM-dd'. De esta fecha depende TODO el saldo */
  started_on: string | null
  /** 'yyyy-MM-dd'. Deja de generar a partir de aquí */
  ended_on: string | null
  is_active: boolean
  /** Días por mes completo trabajado. null = no genera vacaciones */
  vacation_days_per_month: number | null
}

// ---------------------------------------------------------------------------
// Constantes de negocio
// ---------------------------------------------------------------------------

/**
 * Antelación con la que hay que avisar. Es un AVISO, no un bloqueo: una
 * petición más corta se guarda igual y se marca (ver `late_notice`).
 */
export const NOTICE_DAYS = 30

/**
 * Los estados que RESERVAN días: una pendiente y una aprobada ocupan el
 * calendario y descuentan del saldo. Una rechazada o cancelada no ocupa nada,
 * y por eso puede solaparse con la petición que la sustituye.
 */
export const BLOCKING_STATUSES: readonly VacationStatus[] = ['pendiente', 'aprobada']

export const VACATION_STATUS_LABELS: Record<VacationStatus, string> = {
  pendiente: 'Pendiente',
  aprobada: 'Aprobada',
  rechazada: 'Rechazada',
  cancelada: 'Cancelada',
}

/** Mismo patrón que APPOINTMENT_STATUS_COLORS: clases completas, no fragmentos */
export const VACATION_STATUS_COLORS: Record<VacationStatus, string> = {
  pendiente: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  aprobada: 'bg-green-500/20 text-green-300 border-green-500/30',
  rechazada: 'bg-red-500/20 text-red-300 border-red-500/30',
  cancelada: 'bg-zinc-600/25 text-zinc-300 border-zinc-500/30',
}

/** Lunes primero, como el resto de calendarios del ERP */
export const WEEKDAYS_SHORT = ['L', 'M', 'X', 'J', 'V', 'S', 'D']

export const WEEKDAYS_LONG = [
  'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo',
]

// ---------------------------------------------------------------------------
// Días: aritmética sobre 'yyyy-MM-dd'
// ---------------------------------------------------------------------------

/**
 * Los milisegundos UTC de una clave de día.
 *
 * Date.UTC es aritmética de calendario pura: no mira el huso del navegador,
 * así que este número es el mismo en Madrid, en Bogotá y en el servidor. Es
 * el único punto de todo el fichero donde una fecha deja de ser texto, y sale
 * de aquí convertida otra vez en texto.
 */
function utcMs(key: string): number {
  const [y, m, d] = key.slice(0, 10).split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

function keyFromUtcMs(ms: number): string {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** 'yyyy-MM-dd' de cualquier fecha en texto (recorta un ISO completo) */
export function dayKeyOf(date: string): string {
  return date.slice(0, 10)
}

/**
 * EL ÚNICO SITIO DE TODO EL MÓDULO QUE MIRA EL RELOJ.
 *
 * «Hoy» en hora de España, como 'yyyy-MM-dd'. Se serializa a mano y NO con
 * `toISOString().slice(0,10)`: eso daría el día UTC, que a partir de las 22:00
 * en España ya es el día siguiente y adelantaría el calendario entero.
 *
 * Ninguna función de dominio la llama por dentro: quien pinta o quien atiende
 * una petición HTTP la invoca una vez y pasa el resultado hacia abajo.
 */
export function todayKey(): string {
  const d = toMadrid(new Date())
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Lunes = 0 … Domingo = 6, leyendo la clave como fecha civil pura */
export function weekdayIndex(key: string): number {
  return (new Date(utcMs(key)).getUTCDay() + 6) % 7
}

/** Sábado o domingo */
export function isWeekend(key: string): boolean {
  return weekdayIndex(key) >= 5
}

/** El número de día del mes, sin pasar por Date */
export function dayNumber(key: string): number {
  return Number(key.slice(8, 10))
}

/** Cuántos días tiene ese mes (1-12) */
export function daysInMonth(year: number, month: number): number {
  // Día 0 del mes siguiente = último día de este. Aritmética UTC, otra vez.
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** Desplaza una clave de día n días (n negativo va hacia atrás) */
export function addDays(key: string, n: number): string {
  return keyFromUtcMs(utcMs(key) + n * 86400000)
}

/**
 * Días naturales de `from` a `to`. Positivo si `to` es posterior.
 * daysBetween(x, x) = 0, así que un rango de un solo día son 0 «de
 * diferencia» y 1 de longitud.
 */
export function daysBetween(from: string, to: string): number {
  return Math.round((utcMs(to) - utcMs(from)) / 86400000)
}

/**
 * Tope de días que se pueden enumerar de una vez (~5 años).
 *
 * Existe porque `dayRange` la llama la interfaz con lo que haya escrito
 * alguien en un `<input type="date">`, y ahí caben años de cuatro cifras
 * cualesquiera: un dedazo tipo 9999 generaría un array de tres millones de
 * cadenas y colgaría la pestaña. Se corta en seco, no se recorta en silencio.
 */
export const MAX_RANGE_DAYS = 1830

/** Todos los días del rango, ambos incluidos. Vacío si `to` es anterior a `from` */
export function dayRange(from: string, to: string): string[] {
  const span = daysBetween(from, to)
  if (span < 0) return []
  if (span + 1 > MAX_RANGE_DAYS) {
    throw new RangeError(
      `El rango va de ${from} a ${to}: son más de ${MAX_RANGE_DAYS} días y eso no es unas vacaciones, es un dedazo en el año`
    )
  }
  const out: string[] = []
  for (let i = 0; i <= span; i += 1) out.push(addDays(from, i))
  return out
}

/**
 * Los días de un mes ('yyyy-MM-01' o 'yyyy-MM-dd'), para la rejilla del
 * calendario.
 */
export function monthDayKeys(period: string): string[] {
  const [y, m] = period.slice(0, 7).split('-').map(Number)
  const last = daysInMonth(y, m)
  const out: string[] = []
  for (let d = 1; d <= last; d += 1) out.push(`${y}-${pad(m)}-${pad(d)}`)
  return out
}

// ---------------------------------------------------------------------------
// Días laborables
// ---------------------------------------------------------------------------

/**
 * FESTIVOS: DE MOMENTO NO HAY, Y ES A PROPÓSITO.
 *
 * No se inventa aquí ningún calendario de festivos nacionales ni locales. No
 * se ha pedido, y acertar el país de cada persona es imposible desde el
 * código: el equipo está repartido entre España y Latinoamérica y el 12 de
 * octubre no es festivo en los mismos sitios.
 *
 * El cálculo queda PREPARADO: todas las funciones aceptan un conjunto de
 * claves 'yyyy-MM-dd'. El día que se quieran, basta con guardarlos en una
 * tabla (por persona o por país), cargarlos y pasarlos por aquí; no hay que
 * tocar ninguna de estas cuentas.
 *
 * PREPARADO AQUÍ, PERO NO ENCHUFABLE A MEDIAS DESDE LA PANTALLA. Los
 * componentes NO aceptan un prop `holidays`, y no es un olvido: lo aceptaban, y
 * la ruta POST no lo pasaba a `checkVacationRequest`, así que el calendario
 * enseñaba «4 días» y se guardaban 5. Cuando exista la tabla, los festivos
 * tienen que cargarse en UN SOLO SITIO DEL SERVIDOR y bajar a la vez a
 * app/api/vacations/route.ts y a la pantalla. Si solo llegan a una de las dos,
 * es peor que no tenerlos.
 *
 * Cuidado con una cosa cuando llegue ese día: los días laborables de una
 * petición YA GUARDADA no se recalculan. Están congelados en
 * `working_days` porque son los que se descontaron del saldo cuando se
 * aprobó, y añadir festivos no puede reescribir el pasado.
 */
export type Holidays = Iterable<string> | null | undefined

function holidaySet(holidays: Holidays): Set<string> | null {
  if (!holidays) return null
  const s = holidays instanceof Set ? holidays : new Set(holidays)
  return s.size > 0 ? (s as Set<string>) : null
}

/** ¿Cuenta como día de trabajo? Lunes a viernes, y no festivo */
export function isWorkingDay(key: string, holidays?: Holidays): boolean {
  if (isWeekend(key)) return false
  const set = holidaySet(holidays)
  return !set || !set.has(key)
}

/**
 * DÍAS LABORABLES ENTRE DOS FECHAS, AMBAS INCLUIDAS.
 *
 * Es la cuenta que decide cuánto cuesta unas vacaciones: del viernes al lunes
 * son 2, no 4.
 *
 * No recorre el rango día a día: cuenta las semanas completas (5 laborables
 * cada una) y remata los días sueltos. Así da igual que alguien pida un mes o
 * un año, y de paso no hay bucle que pueda dispararse con una fecha absurda.
 * Los festivos —si algún día los hay— se restan solo si caen entre semana,
 * porque un festivo en sábado no descuenta nada.
 *
 * Devuelve 0 si `to` es anterior a `from`, en vez de un número negativo: un
 * rango del revés no consume días, es un error de quien lo escribió, y un
 * negativo aquí acabaría SUMANDO saldo.
 */
export function workingDaysBetween(from: string, to: string, holidays?: Holidays): number {
  const a = dayKeyOf(from)
  const b = dayKeyOf(to)
  const span = daysBetween(a, b)
  if (span < 0) return 0

  const total = span + 1
  const fullWeeks = Math.floor(total / 7)
  let days = fullWeeks * 5

  const rest = total % 7
  const startIdx = weekdayIndex(a)
  for (let i = 0; i < rest; i += 1) {
    if ((startIdx + i) % 7 <= 4) days += 1
  }

  const set = holidaySet(holidays)
  if (set) {
    for (const h of set) {
      if (h >= a && h <= b && !isWeekend(h)) days -= 1
    }
  }

  return Math.max(0, days)
}

// ---------------------------------------------------------------------------
// Devengo: cuántos días ha generado
// ---------------------------------------------------------------------------

/**
 * El aniversario mensual del alta: `startedOn` desplazado n meses.
 *
 * Se ajusta al último día del mes cuando hace falta, y ese detalle importa:
 * quien entró un 31 de enero cumple su primer mes el 28 de febrero, no el 3
 * de marzo. Sin el ajuste, a esa persona se le retrasarían tres días el
 * devengo de cada mes corto.
 */
export function monthAnniversary(startedOn: string, n: number): string {
  const [y, m, d] = dayKeyOf(startedOn).split('-').map(Number)
  const total = m - 1 + n
  const yy = y + Math.floor(total / 12)
  const mm = (((total % 12) + 12) % 12) + 1
  return `${yy}-${pad(mm)}-${pad(Math.min(d, daysInMonth(yy, mm)))}`
}

/**
 * MESES COMPLETOS TRABAJADOS entre el alta y la fecha de referencia.
 *
 * Completos: quien entró el 15 de abril tiene su primer mes el 15 de mayo. El
 * 14 de mayo lleva CERO meses, no medio. Es lo que hace que el mes en curso
 * se enseñe aparte en vez de sumar.
 *
 * `endedOn` corta la cuenta: quien se fue en junio no sigue generando días en
 * agosto. Y se cuenta contra la fecha de baja aunque sea futura, porque a
 * partir de ahí ya no devenga.
 */
export function completedMonthsWorked(
  startedOn: string | null,
  reference: string,
  endedOn?: string | null
): number {
  if (!startedOn) return 0

  const start = dayKeyOf(startedOn)
  let end = dayKeyOf(reference)
  if (endedOn && dayKeyOf(endedOn) < end) end = dayKeyOf(endedOn)
  if (end < start) return 0

  const [y1, m1, d1] = start.split('-').map(Number)
  const [y2, m2, d2] = end.split('-').map(Number)

  let months = (y2 - y1) * 12 + (m2 - m1)
  // El aniversario de ESE mes, con el ajuste de fin de mes: si entró un 31 y
  // el mes de destino tiene 30 días, cumple el 30.
  const anniversary = Math.min(d1, daysInMonth(y2, m2))
  if (d2 < anniversary) months -= 1

  return Math.max(0, months)
}

/** El tramo mensual que todavía no se ha completado. Nunca suma al saldo */
export interface VacationAccrualInProgress {
  /** Día en que empezó este tramo ('yyyy-MM-dd') */
  from: string
  /** Día en que se completará y se cobrarán los días ('yyyy-MM-dd') */
  completesOn: string
  /** Días naturales ya transcurridos del tramo */
  daysElapsed: number
  /** Días naturales que dura el tramo entero */
  daysInCycle: number
  /** Lo que se añadirá al saldo al completarlo */
  willAdd: number
}

export interface VacationAccrual {
  /**
   * La fecha de alta con la que se ha contado. Va en el resultado a propósito:
   * en varias fichas `started_on` lo dedujo la migración 112 del primer mes en
   * que la persona aparecía facturando en Tesorería, no de su contrato. De ese
   * dato depende el saldo entero, así que quien mire la pantalla tiene que
   * poder ver de qué fecha se está contando y corregirla.
   */
  startedOn: string | null
  /** Fecha de baja, si la hay: a partir de ahí deja de generar */
  endedOn: string | null
  /** Tarifa de la ficha. null = esta persona no genera vacaciones */
  perMonth: number | null
  /** Meses COMPLETOS trabajados hasta la fecha de referencia */
  monthsCompleted: number
  /** Días generados = meses completos × tarifa */
  generated: number
  /** El mes a medias. null si aún no ha empezado, si ya está de baja o si no genera */
  inProgress: VacationAccrualInProgress | null
  /** No genera vacaciones (la ficha no tiene tarifa) */
  accrues: boolean
  /** Genera vacaciones pero le falta la fecha de alta: el saldo no se puede calcular */
  missingStartDate: boolean
}

/** Dos decimales. 1,83 × 7 = 12,809999… y en pantalla eso no puede salir */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * CUÁNTAS VACACIONES HA GENERADO, y de qué fecha se está contando.
 *
 * Meses completos × tarifa. El mes en curso se devuelve aparte en
 * `inProgress` y NO está sumado en `generated`: aún no se ha completado, y un
 * saldo que se lo apuntara dejaría gastar días que todavía no existen.
 */
export function vacationAccrual(
  employee: VacationEmployee,
  reference: string
): VacationAccrual {
  const perMonth =
    employee.vacation_days_per_month == null ? null : Number(employee.vacation_days_per_month)
  const startedOn = employee.started_on ? dayKeyOf(employee.started_on) : null
  const endedOn = employee.ended_on ? dayKeyOf(employee.ended_on) : null
  const accrues = perMonth != null && Number.isFinite(perMonth)

  const base: VacationAccrual = {
    startedOn,
    endedOn,
    perMonth: accrues ? perMonth : null,
    monthsCompleted: 0,
    generated: 0,
    inProgress: null,
    accrues,
    missingStartDate: accrues && !startedOn,
  }

  if (!accrues || !startedOn) return base

  const today = dayKeyOf(reference)
  const monthsCompleted = completedMonthsWorked(startedOn, today, endedOn)
  const generated = round2(monthsCompleted * (perMonth as number))

  // El tramo en curso solo existe si la persona ya ha empezado y no ha
  // terminado. Quien tiene fecha de baja pasada ya no devenga nada más.
  let inProgress: VacationAccrualInProgress | null = null
  const stillAccruing = today >= startedOn && (!endedOn || today < endedOn)
  if (stillAccruing) {
    const from = monthAnniversary(startedOn, monthsCompleted)
    const completesOn = monthAnniversary(startedOn, monthsCompleted + 1)
    inProgress = {
      from,
      completesOn,
      daysElapsed: Math.max(0, daysBetween(from, today)),
      daysInCycle: Math.max(1, daysBetween(from, completesOn)),
      willAdd: round2(perMonth as number),
    }
  }

  return { ...base, monthsCompleted, generated, inProgress }
}

// ---------------------------------------------------------------------------
// El saldo
// ---------------------------------------------------------------------------

export interface VacationBalance {
  employeeId: string
  /** Días generados por meses completos trabajados */
  generated: number
  /** Días ya concedidos: los «canjeados» */
  approved: number
  /** Días de peticiones sin resolver. RESTAN, ver cabecera */
  pending: number
  /** generated − approved − pending. Lo que puede pedir hoy */
  available: number
  /**
   * De los aprobados, los que ya se han disfrutado (fecha pasada). Es la
   * diferencia entre lo gastado y lo reservado: `taken + booked === approved`.
   */
  taken: number
  /** De los aprobados, los que todavía no han llegado o están en curso */
  booked: number
  /** Cuántas peticiones esperan respuesta */
  pendingCount: number
  /** El devengo con su detalle, para poder enseñar de qué fecha se cuenta */
  accrual: VacationAccrual
  /** true si `available` ha salido negativo: hay más días pedidos que generados */
  overdrawn: boolean
}

/** Las peticiones de una persona, en orden de calendario */
export function requestsOf(requests: VacationRequest[], employeeId: string): VacationRequest[] {
  return requests
    .filter((r) => r.employee_id === employeeId)
    .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.id.localeCompare(b.id))
}

/**
 * EL SALDO DE UNA PERSONA. Cuatro números que hay que poder distinguir:
 *
 *   generados    meses completos × tarifa
 *   aprobados    días ya concedidos (los «canjeados»)
 *   pendientes   días de peticiones sin resolver
 *   disponibles  generados − aprobados − pendientes
 *
 * Lo PENDIENTE resta. Si no restara se podrían pedir los mismos días dos
 * veces y las dos peticiones parecerían caber; cuando el admin aprobara la
 * segunda, el saldo ya estaría en negativo sin que nada lo hubiera dicho.
 * Rechazar o cancelar devuelve esos días solo.
 *
 * `taken` y `booked` parten lo aprobado en lo que ya se gastó y lo que está
 * reservado. Una petición que está ocurriendo hoy se reparte entre las dos:
 * los días laborables anteriores a hoy cuentan como disfrutados y el resto
 * como reservados, de modo que las dos cifras siempre suman `approved`.
 */
export function vacationBalance(
  employee: VacationEmployee,
  requests: VacationRequest[],
  today: string,
  holidays?: Holidays
): VacationBalance {
  const accrual = vacationAccrual(employee, today)
  const day = dayKeyOf(today)

  let approved = 0
  let pending = 0
  let taken = 0
  let booked = 0
  let pendingCount = 0

  for (const r of requestsOf(requests, employee.id)) {
    const days = Number(r.working_days) || 0

    if (r.status === 'pendiente') {
      pending += days
      pendingCount += 1
      continue
    }
    if (r.status !== 'aprobada') continue

    approved += days

    if (r.end_date < day) {
      // Entera en el pasado: disfrutada.
      taken += days
      continue
    }
    if (r.start_date > day) {
      // Entera en el futuro: reservada.
      booked += days
      continue
    }
    // En curso. Se cuenta lo laborable que ya ha pasado, y el resto se
    // deduce del total GUARDADO para que las dos cifras sumen exactamente
    // `approved` aunque los festivos de entonces no fueran los de ahora.
    const alreadyTaken = Math.min(days, workingDaysBetween(r.start_date, addDays(day, -1), holidays))
    taken += alreadyTaken
    booked += days - alreadyTaken
  }

  const available = round2(accrual.generated - approved - pending)

  return {
    employeeId: employee.id,
    generated: accrual.generated,
    approved: round2(approved),
    pending: round2(pending),
    available,
    taken: round2(taken),
    booked: round2(booked),
    pendingCount,
    accrual,
    overdrawn: available < 0,
  }
}

// ---------------------------------------------------------------------------
// Antelación
// ---------------------------------------------------------------------------

/**
 * Días naturales que faltan desde `today` hasta el inicio. Negativo si ya
 * empezaron.
 */
export function noticeDaysAhead(startDate: string, today: string): number {
  return daysBetween(dayKeyOf(today), dayKeyOf(startDate))
}

/**
 * ¿Entra fuera de plazo? Menos de 30 días de antelación (o ya empezada).
 *
 * NO bloquea nada: se guarda igual y se marca para quien tenga que aprobarla.
 * La regla existe para poder planificar, no para que alguien con una urgencia
 * familiar no pueda ni pedirlo; y como las peticiones se aprueban una a una,
 * la decisión ya pasa por una persona. Bloquear el envío solo conseguiría que
 * se pidiera por WhatsApp y no quedara registrado en ningún sitio.
 */
export function isLateNotice(
  startDate: string,
  today: string,
  noticeDays: number = NOTICE_DAYS
): boolean {
  return noticeDaysAhead(startDate, today) < noticeDays
}

// ---------------------------------------------------------------------------
// Solapes
// ---------------------------------------------------------------------------

/**
 * ¿Se pisan dos rangos de días? Ambos extremos incluidos.
 *
 * Comparación de cadenas, que con 'yyyy-MM-dd' rellenado con ceros ordena
 * igual que la fecha y no crea ni un Date.
 */
export function rangesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string
): boolean {
  return dayKeyOf(aStart) <= dayKeyOf(bEnd) && dayKeyOf(bStart) <= dayKeyOf(aEnd)
}

export function requestsOverlap(a: VacationRequest, b: VacationRequest): boolean {
  return (
    a.employee_id === b.employee_id &&
    rangesOverlap(a.start_date, a.end_date, b.start_date, b.end_date)
  )
}

/**
 * Las peticiones vivas de esa persona que se pisan con el rango dado.
 *
 * Solo cuentan las pendientes y las aprobadas: una rechazada o cancelada no
 * reserva ningún día, así que puede solaparse con la que la sustituye —que es
 * el caso normal cuando a alguien le dicen que no y vuelve a pedir esa misma
 * semana—.
 *
 * `excludeId` sirve para editar una petición sin que choque consigo misma.
 */
export function findOverlapping(
  requests: VacationRequest[],
  employeeId: string,
  startDate: string,
  endDate: string,
  excludeId?: string | null
): VacationRequest[] {
  return requests.filter(
    (r) =>
      r.employee_id === employeeId &&
      r.id !== excludeId &&
      BLOCKING_STATUSES.includes(r.status) &&
      rangesOverlap(startDate, endDate, r.start_date, r.end_date)
  )
}

/**
 * Los días laborables ocupados por peticiones vivas, para pintar el calendario.
 *
 * Una fila con un rango imposible se SALTA en vez de reventar. `dayRange` lanza
 * por encima de MAX_RANGE_DAYS —y hace bien: enumerar tres millones de días
 * cuelga la pestaña—, pero esto se llama dentro de un `useMemo` sin red, así
 * que una sola fila mala (un dedazo en el año metido a mano en Supabase, o una
 * importación futura) tumbaría el calendario de TODO EL MUNDO, no solo el de la
 * persona afectada. La ruta de API ya no las deja entrar; esto cubre las que
 * pudieran llegar por otro camino.
 */
export function occupiedDays(
  requests: VacationRequest[],
  employeeId?: string
): Map<string, VacationRequest[]> {
  const map = new Map<string, VacationRequest[]>()
  for (const r of requests) {
    if (employeeId && r.employee_id !== employeeId) continue
    if (!BLOCKING_STATUSES.includes(r.status)) continue
    const span = daysBetween(dayKeyOf(r.start_date), dayKeyOf(r.end_date))
    if (span < 0 || span + 1 > MAX_RANGE_DAYS) continue
    for (const key of dayRange(r.start_date, r.end_date)) {
      if (isWeekend(key)) continue
      const list = map.get(key)
      if (list) list.push(r)
      else map.set(key, [r])
    }
  }
  return map
}

// ---------------------------------------------------------------------------
// La comprobación completa de una petición
// ---------------------------------------------------------------------------

export interface VacationRequestInput {
  employee: VacationEmployee
  /** 'yyyy-MM-dd' */
  startDate: string
  /** 'yyyy-MM-dd' */
  endDate: string
  /** Todas las peticiones conocidas; se filtran por persona aquí dentro */
  requests: VacationRequest[]
  /** «Hoy», en hora de España. Entra como parámetro a propósito */
  today: string
  /** Para no chocar consigo misma al reeditar o al reaprobar */
  excludeId?: string | null
  holidays?: Holidays
}

export interface VacationRequestCheck {
  /** Se puede guardar. `warnings` puede tener cosas aunque sea true */
  ok: boolean
  /** Días laborables que consumiría */
  workingDays: number
  /** Con cuántos días naturales de antelación se pide */
  noticeDays: number
  /** Menos de 30 días de antelación. AVISA, no impide guardar */
  lateNotice: boolean
  /** Peticiones vivas de esa persona que se pisan con estas fechas */
  overlapping: VacationRequest[]
  /** El saldo tal y como quedaría si esta petición se aprobara */
  balanceAfter: number
  /** Motivos por los que NO se puede guardar. Frases para enseñar tal cual */
  errors: string[]
  /** Cosas que hay que decir pero que no impiden guardar */
  warnings: string[]
}

/**
 * TODO LO QUE HAY QUE SABER DE UNA PETICIÓN ANTES DE GUARDARLA.
 *
 * La usan la pantalla (para avisar mientras se elige el rango) y la ruta de
 * API (que es quien decide de verdad). Una sola función para las dos, o
 * acabarían discrepando y la pantalla diría que sí a algo que el servidor
 * rechaza.
 *
 * Qué es error y qué es aviso, que es la parte que se discute:
 *   - ERROR lo que produciría un dato incoherente: fechas del revés, un rango
 *     que no consume ni un día laborable, un solape con otra petición viva, o
 *     una persona que no genera vacaciones.
 *   - AVISO todo lo demás, incluido pedir con poca antelación o pasarse del
 *     saldo. Las aprueba un admin una a una: la decisión ya es de una persona
 *     con toda la información delante, y bloquearlo solo conseguiría que se
 *     pidiera por fuera del ERP.
 */
export function checkVacationRequest(input: VacationRequestInput): VacationRequestCheck {
  const { employee, requests, holidays } = input
  const startDate = dayKeyOf(input.startDate)
  const endDate = dayKeyOf(input.endDate)
  const today = dayKeyOf(input.today)

  const errors: string[] = []
  const warnings: string[] = []

  const validFormat = isDayKey(startDate) && isDayKey(endDate)
  if (!validFormat) {
    return {
      ok: false,
      workingDays: 0,
      noticeDays: 0,
      lateNotice: false,
      overlapping: [],
      balanceAfter: 0,
      errors: ['Las fechas no son válidas'],
      warnings,
    }
  }

  if (endDate < startDate) {
    errors.push('El último día no puede ser anterior al primero')
  }

  // Un rango absurdamente largo es un dedazo en el año, no unas vacaciones, y
  // hay que pararlo AQUÍ: `workingDaysBetween` lo calcularía tan campante
  // (es O(1)), la petición se guardaría, y luego reventaría al pintar el
  // calendario, que sí enumera los días uno a uno.
  if (endDate >= startDate && daysBetween(startDate, endDate) + 1 > MAX_RANGE_DAYS) {
    errors.push('Ese rango son más de cinco años: revisa el año de las fechas')
  }

  const workingDays =
    endDate < startDate ? 0 : workingDaysBetween(startDate, endDate, holidays)
  if (endDate >= startDate && workingDays === 0) {
    errors.push('Esos días caen todos en fin de semana: no consumen vacaciones')
  }

  // `== null` y NO el falsy `!…`, que es lo que había: con la tarifa a 0 —un
  // valor que el CHECK de la migración 116 acepta y que la ficha deja teclear—
  // el falsy decía «no genera vacaciones: ponle los días por mes en su ficha»
  // sobre una ficha que tenía el número puesto, y a la vez el resto del módulo
  // (vacationAccrual, la lista de saldos) sí la contaba. La persona quedaba en
  // un bucle sin salida. NULL es lo único que significa «no participa»; 0
  // significa «participa y genera cero», que es un dato distinto y coherente.
  if (employee.vacation_days_per_month == null) {
    errors.push(
      `${employee.name} no genera vacaciones: ponle los días por mes en su ficha antes de pedirlas`
    )
  }

  const overlapping = findOverlapping(
    requests,
    employee.id,
    startDate,
    endDate,
    input.excludeId ?? null
  )
  if (overlapping.length > 0) {
    errors.push(
      overlapping.length === 1
        ? `Esos días se pisan con otra petición (${formatDayRange(overlapping[0].start_date, overlapping[0].end_date)})`
        : `Esos días se pisan con ${overlapping.length} peticiones que ya existen`
    )
  }

  const notice = noticeDaysAhead(startDate, today)
  const lateNotice = notice < NOTICE_DAYS
  if (lateNotice) {
    warnings.push(
      notice < 0
        ? 'Estas fechas ya han empezado: la petición queda marcada como fuera de plazo'
        : `Se pide con ${notice} día${notice === 1 ? '' : 's'} de antelación y hay que avisar con ${NOTICE_DAYS}: queda marcada como fuera de plazo`
    )
  }

  const balance = vacationBalance(employee, requests, today, holidays)
  // Si se está reeditando/reaprobando una petición que ya cuenta en el saldo,
  // sus días no se pueden descontar dos veces.
  const alreadyCounted = input.excludeId
    ? requests.find(
        (r) => r.id === input.excludeId && BLOCKING_STATUSES.includes(r.status)
      )
    : undefined
  const balanceAfter = round2(
    balance.available + Number(alreadyCounted?.working_days ?? 0) - workingDays
  )
  // Mismo motivo que arriba: con la tarifa a 0 el falsy se tragaba el aviso de
  // «se pasa del saldo», que es justo el caso en que más falta hace.
  if (balanceAfter < 0 && employee.vacation_days_per_month != null) {
    warnings.push(
      `Se pasa del saldo: le quedan ${formatDays(balance.available)} y pide ${formatDays(workingDays)}`
    )
  }

  if (employee.started_on && startDate < dayKeyOf(employee.started_on)) {
    warnings.push('Esas fechas son anteriores a su fecha de alta')
  }
  if (employee.ended_on && endDate > dayKeyOf(employee.ended_on)) {
    warnings.push('Esas fechas son posteriores a su fecha de baja')
  }
  if (balance.accrual.missingStartDate) {
    warnings.push(
      `${employee.name} no tiene fecha de alta, así que su saldo sale a cero: ponla en su ficha`
    )
  }

  return {
    ok: errors.length === 0,
    workingDays,
    noticeDays: notice,
    lateNotice,
    overlapping,
    balanceAfter,
    errors,
    warnings,
  }
}

/** 'yyyy-MM-dd' de verdad, y una fecha que existe (no un 31 de febrero) */
export function isDayKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  if (m < 1 || m > 12 || d < 1) return false
  return d <= daysInMonth(y, m)
}

// ---------------------------------------------------------------------------
// Formato
// ---------------------------------------------------------------------------

/** «12 de agosto de 2026» */
export function formatDayLong(key: string): string {
  const [y, m, d] = dayKeyOf(key).split('-').map(Number)
  return `${d} de ${MONTHS_LONG[m - 1]} de ${y}`
}

/** «12 ago» */
export function formatDayShort(key: string): string {
  const [, m, d] = dayKeyOf(key).split('-').map(Number)
  return `${d} ${MONTHS_SHORT[m - 1]}`
}

/**
 * «del 12 al 16 de agosto de 2026», y «12 de agosto de 2026» cuando es un
 * solo día. Se comprime el mes y el año cuando coinciden, que es el caso
 * normal: repetirlos hace la frase ilegible.
 */
export function formatDayRange(from: string, to: string): string {
  const a = dayKeyOf(from)
  const b = dayKeyOf(to)
  if (a === b) return formatDayLong(a)

  const [y1, m1, d1] = a.split('-').map(Number)
  const [y2, m2, d2] = b.split('-').map(Number)

  if (y1 === y2 && m1 === m2) return `del ${d1} al ${d2} de ${MONTHS_LONG[m1 - 1]} de ${y1}`
  if (y1 === y2) {
    return `del ${d1} de ${MONTHS_LONG[m1 - 1]} al ${d2} de ${MONTHS_LONG[m2 - 1]} de ${y1}`
  }
  return `del ${formatDayLong(a)} al ${formatDayLong(b)}`
}

/** «1,83 días» / «1 día». Sin decimales cuando es entero */
export function formatDays(n: number): string {
  const v = round2(n)
  const num = v.toLocaleString('es-ES', {
    minimumFractionDigits: Number.isInteger(v) ? 0 : 2,
    maximumFractionDigits: 2,
  })
  return `${num} ${Math.abs(v) === 1 ? 'día' : 'días'}`
}
