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
 * LAS CINCO COSAS QUE HAY QUE ENTENDER ANTES DE TOCAR ESTO
 * -------------------------------------------------------
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
 * 5) EL PERÍODO ES EL AÑO NATURAL, Y LO QUE SOBRA CADUCA EL 31 DE MARZO.
 *    Cada saldo habla SIEMPRE de un año concreto (1 de enero – 31 de
 *    diciembre). Lo que queda al cerrarlo se arrastra al siguiente y vive
 *    hasta el 31 de marzo; a partir del 1 de abril desaparece. Y el arrastre
 *    se gasta ANTES que el devengo del año nuevo. La explicación larga está
 *    en la sección «El período: EL AÑO NATURAL», más abajo.
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
// El período: EL AÑO NATURAL
// ---------------------------------------------------------------------------

/**
 * EL DEVENGO SE CUENTA POR AÑO NATURAL, DEL 1 DE ENERO AL 31 DE DICIEMBRE.
 *
 * Antes se contaba de corrido desde la fecha de alta de cada persona y no
 * caducaba nunca. Se cambió por tres motivos, y conviene que estén escritos
 * porque nada de lo de abajo se entiende sin ellos:
 *
 *   1) CADA PERSONA TENÍA SU PROPIO CALENDARIO. Daniella entró en marzo y
 *      Yasury en junio: eran dos períodos distintos conviviendo, y con cada
 *      alta habría uno más. Con el año natural el período es el mismo para
 *      todo el equipo y se puede hablar de «las vacaciones de 2027».
 *
 *   2) LA TARIFA YA ESTABA PENSADA PARA UN AÑO NATURAL: 1,83 × 12 = 21,96 ≈ 22
 *      días laborables, que es justo el mínimo legal español de 30 días
 *      naturales. Contando de corrido ese número no cuadraba con nada.
 *
 *   3) UN SALDO QUE NO CADUCA NUNCA NO ES UN SALDO. Lo que sobra al acabar el
 *      año se arrastra hasta el 31 DE MARZO del siguiente y ahí se pierde, que
 *      es lo habitual en España y evita que un diciembre cargado le cueste los
 *      días a alguien.
 *
 * EL PRIMER AÑO VA PROPORCIONAL: quien entra en marzo devenga de marzo a
 * diciembre, no doce meses.
 *
 * Y EL ARRASTRE SE GASTA PRIMERO. Si en febrero se piden días, salen del
 * arrastre antes que del devengo del año nuevo, porque el arrastre caduca en
 * marzo y el otro no. Al revés, alguien perdería días teniéndolos gastados y
 * sin que nada lo dijera. Está en `carriedInto` y en `vacationBalance`, no es
 * una convención de la pantalla.
 *
 * EL MES DE DEVENGO ES EL MES DE CALENDARIO, NO EL ANIVERSARIO DEL ALTA.
 * Aquí había un `monthAnniversary` que contaba ciclos del 15 al 15, y se ha
 * quitado a propósito: NO PUEDE HABER DOS NOCIONES DE «MES COMPLETO» EN ESTE
 * FICHERO. Con ciclos de aniversario, un año natural entero da once meses y
 * pico —el ciclo que arranca en diciembre se cierra en enero—, la cuenta de
 * 1,83 × 12 deja de salir, y cuántos meses cae en cada año depende del día del
 * mes en que entró cada persona. Con meses de calendario, un año completo son
 * doce y punto.
 *
 * Un mes cuenta si se ha trabajado ENTERO: quien entra el 15 de marzo no
 * devenga marzo —su primer mes es abril—, igual que el mes en curso no suma
 * hasta que termina. Es la regla de siempre («solo meses completos»), solo que
 * el mes ahora empieza el día 1. Para las tres fichas reales no cambia ni un
 * decimal: las tres altas son día 1.
 */

/** El año de una clave de día. Sigue siendo texto: ni un Date, ni un huso */
export function yearOf(key: string): number {
  return Number(dayKeyOf(key).slice(0, 4))
}

export function firstDayOfYear(year: number): string {
  return `${year}-01-01`
}

export function lastDayOfYear(year: number): string {
  return `${year}-12-31`
}

/**
 * El día 1 de un mes. `month` puede valer 13: devuelve el 1 de enero del año
 * siguiente, que es lo que hace falta para preguntar «¿ha terminado ya
 * diciembre?» sin un caso especial.
 */
export function firstDayOfMonth(year: number, month: number): string {
  const total = month - 1
  const y = year + Math.floor(total / 12)
  const m = (((total % 12) + 12) % 12) + 1
  return `${y}-${pad(m)}-01`
}

/**
 * HASTA CUÁNDO VIVE EL ARRASTRE DEL AÑO ANTERIOR: el 31 de marzo, incluido.
 * Del 1 de abril en adelante, lo que quede de él desaparece.
 */
export function carryOverDeadline(year: number): string {
  return `${year}-03-31`
}

/** ¿Sigue vivo, a fecha de `reference`, el arrastre que entró en `year`? */
export function carryOverAlive(year: number, reference: string): boolean {
  return dayKeyOf(reference) <= carryOverDeadline(year)
}

// ---------------------------------------------------------------------------
// Devengo: cuántos días genera dentro de un año
// ---------------------------------------------------------------------------

/**
 * LOS MESES DE `year` QUE ESA PERSONA HA TRABAJADO ENTEROS.
 *
 * Un mes de calendario cuenta si se cumplen tres cosas:
 *   - entró el día 1 o antes (quien entra el 15 no devenga ese mes),
 *   - no se había ido antes de que el mes se cerrara,
 *   - y el mes ya se ha cerrado a fecha de `reference`.
 *
 * `reference` a null quita la tercera condición, y eso es la PROYECCIÓN: «los
 * meses que este año llegará a devengar». La pantalla enseña las dos cifras,
 * lo devengado y lo que sumará al terminar el año.
 *
 * `ended_on` se lee igual que siempre —«deja de generar a partir de aquí»—, o
 * sea que el mes cuenta solo si la baja es posterior al día en que el mes se
 * cierra. Es la misma semántica que tenía el cálculo continuo.
 *
 * EL 31 DE DICIEMBRE, DICIEMBRE TODAVÍA NO CUENTA, Y ES A PROPÓSITO. Un mes se
 * cierra el día 1 del siguiente, así que ese día Daniella marca 16,47 y no
 * 18,30: aún le queda por trabajar el 31. Es exactamente la misma regla que
 * hace que hoy, 7 de agosto, agosto no sume —y la que da los 9,15 y 3,66 que se
 * validaron contra producción—, así que adelantar el cierre al último día del
 * mes para que el 31 de diciembre cuadre rompería la regla en los otros once.
 * La pantalla ya enseña las dos cifras (`generated` y `yearTotal`), el desfase
 * dura un día y se corrige solo el 1 de enero. QUEDA DECIDIDO ASÍ.
 *
 * Doce vueltas y comparaciones de texto: ni un Date, ni un huso horario.
 */
export function accrualMonthsInYear(
  startedOn: string | null,
  endedOn: string | null,
  year: number,
  reference?: string | null
): number {
  if (!startedOn) return 0
  const start = dayKeyOf(startedOn)
  const leaves = endedOn ? dayKeyOf(endedOn) : null
  const today = reference ? dayKeyOf(reference) : null

  let months = 0
  for (let m = 1; m <= 12; m += 1) {
    const opens = firstDayOfMonth(year, m)
    const closes = firstDayOfMonth(year, m + 1)
    if (start > opens) continue
    if (leaves && leaves < closes) continue
    if (today && today < closes) continue
    months += 1
  }
  return months
}

/** El mes de calendario en curso. Nunca suma al saldo hasta que se cierra */
export interface VacationAccrualInProgress {
  /** Día 1 del mes en curso ('yyyy-MM-dd') */
  from: string
  /** El día en que se cierra y se cobran los días: el 1 del mes siguiente */
  completesOn: string
  /** Días naturales ya transcurridos del mes */
  daysElapsed: number
  /** Días naturales que dura el mes entero */
  daysInCycle: number
  /** Lo que añadirá al saldo al cerrarse. 0 si ese mes no va a contar */
  willAdd: number
  /**
   * `false` cuando ese mes NO va a contar: es el mes en que entró (ya
   * empezado) o el mes en que se va. Se devuelve en vez de omitirlo para que
   * la pantalla pueda decir «este mes no cuenta, entraste el día 15» en lugar
   * de callarse y parecer que se ha perdido un mes por el camino.
   */
  counts: boolean
}

export interface VacationAccrual {
  /** El AÑO NATURAL del que habla este devengo */
  year: number
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
  /** Meses de ESE AÑO ya trabajados enteros a fecha de referencia */
  monthsCompleted: number
  /** Días devengados en el año = meses cerrados × tarifa */
  generated: number
  /** Meses de ese año que llegará a devengar (alta y baja incluidas) */
  monthsInYear: number
  /** Lo que devengará el año ENTERO = monthsInYear × tarifa */
  yearTotal: number
  /** yearTotal − generated: lo que le queda por devengar antes de fin de año */
  remaining: number
  /** El mes a medias. null si el año no es el de hoy, si aún no ha empezado o si está de baja */
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
 * CUÁNTAS VACACIONES DEVENGA EN ESE AÑO, y de qué fecha se está contando.
 *
 * Meses de calendario cerrados × tarifa. El mes en curso se devuelve aparte en
 * `inProgress` y NO está sumado en `generated`: aún no se ha cerrado, y un
 * saldo que se lo apuntara dejaría gastar días que todavía no existen.
 *
 * `year` por defecto es el año de `reference`, que es el caso normal. Se puede
 * pedir otro para mirar un año cerrado o para proyectar el que viene.
 */
export function vacationAccrual(
  employee: VacationEmployee,
  reference: string,
  year: number = yearOf(reference)
): VacationAccrual {
  const perMonth =
    employee.vacation_days_per_month == null ? null : Number(employee.vacation_days_per_month)
  const startedOn = employee.started_on ? dayKeyOf(employee.started_on) : null
  const endedOn = employee.ended_on ? dayKeyOf(employee.ended_on) : null
  const accrues = perMonth != null && Number.isFinite(perMonth)

  const base: VacationAccrual = {
    year,
    startedOn,
    endedOn,
    perMonth: accrues ? perMonth : null,
    monthsCompleted: 0,
    generated: 0,
    monthsInYear: 0,
    yearTotal: 0,
    remaining: 0,
    inProgress: null,
    accrues,
    missingStartDate: accrues && !startedOn,
  }

  if (!accrues || !startedOn) return base

  const today = dayKeyOf(reference)
  const rate = perMonth as number

  const monthsCompleted = accrualMonthsInYear(startedOn, endedOn, year, today)
  const monthsInYear = accrualMonthsInYear(startedOn, endedOn, year, null)
  const generated = round2(monthsCompleted * rate)
  const yearTotal = round2(monthsInYear * rate)

  // El mes a medias solo existe DENTRO DEL AÑO EN CURSO: un año ya cerrado no
  // tiene mes a medias, y uno futuro no ha empezado. Y solo si la persona ya
  // ha entrado y no se ha ido.
  let inProgress: VacationAccrualInProgress | null = null
  const stillAccruing = today >= startedOn && (!endedOn || today < endedOn)
  if (stillAccruing && year === yearOf(today)) {
    const month = Number(today.slice(5, 7))
    const from = firstDayOfMonth(year, month)
    const completesOn = firstDayOfMonth(year, month + 1)
    const counts = startedOn <= from && (!endedOn || endedOn >= completesOn)
    inProgress = {
      from,
      completesOn,
      daysElapsed: Math.max(0, daysBetween(from, today)),
      daysInCycle: Math.max(1, daysBetween(from, completesOn)),
      willAdd: counts ? round2(rate) : 0,
      counts,
    }
  }

  return {
    ...base,
    monthsCompleted,
    generated,
    monthsInYear,
    yearTotal,
    remaining: round2(yearTotal - generated),
    inProgress,
  }
}

// ---------------------------------------------------------------------------
// Repartir una petición entre años
// ---------------------------------------------------------------------------

/**
 * LA PETICIÓN A CABALLO ENTRE DOS AÑOS —del 28 de diciembre al 4 de enero—.
 *
 * Es el caso que nadie prueba y el que descuadra el saldo en enero, así que
 * queda decidido y escrito:
 *
 *   LOS DÍAS SE IMPUTAN AL AÑO EN QUE CAEN LAS FECHAS DISFRUTADAS, DÍA A DÍA.
 *   Del 28 de diciembre al 4 de enero son 4 días laborables de un año y 2 del
 *   otro. No 6 del año en que se pidió, ni 6 del año en que empieza el rango,
 *   ni 6 del año en que acaba. La fecha en que se TECLEÓ la petición no
 *   aparece en esta cuenta por ningún lado: una petición hecha en diciembre
 *   para enero gasta días de enero.
 *
 *   Y EL ÚLTIMO AÑO DEL RANGO SE QUEDA CON EL RESTO, no con lo que salga de
 *   recontarlo. `working_days` está CONGELADO en la fila desde que se pidió
 *   (migración 116: es lo que se descontó del saldo, y un calendario de
 *   festivos futuro no puede reescribir el pasado). Si al repartirlo el
 *   calendario de hoy no diera esa misma cifra, la diferencia va al ÚLTIMO
 *   año, que es el que sigue abierto y en el que todavía se puede hacer algo;
 *   los años anteriores se quedan con su cuenta de calendario, que ya está
 *   cerrada y no puede moverse sola. Así la suma de los trozos es SIEMPRE
 *   exactamente `working_days`: repartir no crea ni destruye días de nadie.
 *
 * Es la misma técnica que ya usaban `taken` y `booked`, que se deducen uno del
 * otro contra el total guardado en vez de recalcularse por separado.
 */
function cumulativeWorkingDays(
  start: string,
  end: string,
  total: number,
  day: string,
  holidays?: Holidays
): number {
  if (day < start) return 0
  // Pasado el último día del rango ya se ha consumido TODO el total congelado.
  // Este escalón es lo que hace que los trozos sumen la cifra guardada.
  if (day >= end) return total
  return Math.min(total, workingDaysBetween(start, day, holidays))
}

export interface VacationYearDays {
  year: number
  days: number
}

/**
 * Reparte por año natural los días laborables de un rango.
 * `total` es la cifra que manda: la suma de los trozos la respeta siempre.
 */
export function workingDaysByYear(
  startDate: string,
  endDate: string,
  total: number,
  holidays?: Holidays
): VacationYearDays[] {
  const start = dayKeyOf(startDate)
  const end = dayKeyOf(endDate)
  if (end < start) return []

  const from = yearOf(start)
  const to = yearOf(end)

  // Un rango de más de cinco años es un dedazo en el año, no unas vacaciones
  // (mismo tope que `dayRange`). Se imputa entero al año en que empieza en vez
  // de recorrer siglos de años vacíos.
  if (daysBetween(start, end) + 1 > MAX_RANGE_DAYS) {
    return [{ year: from, days: round2(total) }]
  }

  const out: VacationYearDays[] = []
  let previous = 0
  for (let y = from; y <= to; y += 1) {
    const upTo = cumulativeWorkingDays(start, end, total, lastDayOfYear(y), holidays)
    out.push({ year: y, days: round2(upTo - previous) })
    previous = upTo
  }
  return out
}

/** Lo mismo para una petición ya guardada, con su `working_days` congelado */
export function requestDaysByYear(
  request: VacationRequest,
  holidays?: Holidays
): VacationYearDays[] {
  return workingDaysByYear(
    request.start_date,
    request.end_date,
    Number(request.working_days) || 0,
    holidays
  )
}

// ---------------------------------------------------------------------------
// El saldo
// ---------------------------------------------------------------------------

/** Lo que una persona compromete DENTRO de un año, ya repartido por fechas */
interface YearConsumption {
  approved: number
  pending: number
  pendingCount: number
  /** De lo aprobado, lo que ya se ha disfrutado a fecha de hoy */
  taken: number
  /** De todo lo comprometido (aprobado + pendiente), lo que cae hasta el 31 de marzo */
  untilDeadline: number
  /** Y lo que cae del 1 de abril en adelante */
  afterDeadline: number
}

/**
 * Todo lo que esa persona compromete en `year`, con las peticiones ya
 * repartidas por fechas. Las rechazadas y las canceladas no reservan nada.
 */
function consumptionInYear(
  requests: VacationRequest[],
  employeeId: string,
  year: number,
  today: string,
  holidays?: Holidays
): YearConsumption {
  const yearStart = firstDayOfYear(year)
  const yearEnd = lastDayOfYear(year)
  const previousEnd = lastDayOfYear(year - 1)
  const deadline = carryOverDeadline(year)
  // Lo disfrutado es lo laborable ANTERIOR a hoy, topado al año que se mira:
  // en un año ya cerrado está todo disfrutado, y en uno futuro no hay nada.
  const enjoyedUntil = addDays(dayKeyOf(today), -1) < yearEnd ? addDays(dayKeyOf(today), -1) : yearEnd

  const out: YearConsumption = {
    approved: 0,
    pending: 0,
    pendingCount: 0,
    taken: 0,
    untilDeadline: 0,
    afterDeadline: 0,
  }

  for (const r of requests) {
    if (r.employee_id !== employeeId) continue
    if (!BLOCKING_STATUSES.includes(r.status)) continue

    const start = dayKeyOf(r.start_date)
    const end = dayKeyOf(r.end_date)
    // Una fila con el rango del revés se salta en vez de restar días negativos.
    if (end < start) continue
    if (end < yearStart || start > yearEnd) continue

    const total = Number(r.working_days) || 0
    const upToPrevious = cumulativeWorkingDays(start, end, total, previousEnd, holidays)
    const upToDeadline = cumulativeWorkingDays(start, end, total, deadline, holidays)
    const upToYearEnd = cumulativeWorkingDays(start, end, total, yearEnd, holidays)

    const inYear = Math.max(0, upToYearEnd - upToPrevious)
    if (inYear === 0) continue

    out.untilDeadline += Math.max(0, upToDeadline - upToPrevious)
    out.afterDeadline += Math.max(0, upToYearEnd - upToDeadline)

    if (r.status === 'pendiente') {
      out.pending += inYear
      out.pendingCount += 1
      continue
    }

    out.approved += inYear
    const upToToday = cumulativeWorkingDays(start, end, total, enjoyedUntil, holidays)
    out.taken += Math.max(0, upToToday - upToPrevious)
  }

  return out
}

/**
 * Tope de años que se encadenan hacia atrás al calcular el arrastre. Existe
 * por lo mismo que MAX_RANGE_DAYS: un `started_on` con un dedazo en el año
 * (0202 en vez de 2026) no puede convertir un `useMemo` en un bucle de dos mil
 * vueltas por empleado.
 */
const MAX_CARRY_YEARS = 50

/**
 * LO QUE SE ARRASTRA AL EMPEZAR `year`: el saldo con el que se cerró el
 * anterior. POSITIVO son días que sobraron; NEGATIVO, días que se gastaron de
 * más.
 *
 * Se ENCADENA año a año desde el alta en vez de mirar solo el anterior, y hace
 * falta: el arrastre caduca, así que no basta con «lo que sobró», hay que
 * saber cuánto de ello se llegó a gastar antes del 31 de marzo. Cada vuelta
 * del bucle cierra un año con las mismas reglas con las que se vive el año en
 * curso, de modo que no hay dos cuentas distintas que puedan discrepar.
 *
 * ES UN DATO CALCULADO Y NO UNA COLUMNA, A PROPÓSITO: sale entero de
 * `started_on`, de la tarifa y de las peticiones, que ya están guardadas. Una
 * columna «arrastre» habría que mantenerla al día con un proceso de fin de año
 * y se desincronizaría en cuanto alguien corrigiera una fecha de alta o
 * anulara unas vacaciones viejas. Por eso NO hay migración 118.
 *
 * EL AÑO SE CIERRA ENTERO: aquí no entra la fecha de hoy. Un año pasado
 * devengó sus doce meses, y para proyectar el arrastre del año que viene hay
 * que contar el año en curso completo, no hasta hoy.
 *
 * LA DEUDA NO CADUCA. Si alguien gastó de más —el módulo avisa pero no lo
 * impide—, esos días lastran el año siguiente en vez de perdonarse solos el 1
 * de enero. Solo lo que SOBRA caduca; regalar lo que falta sería premiar
 * pasarse.
 *
 * PENDIENTE DE DECIDIR, Y NO SE TOCA HASTA QUE SE DECIDA: A QUIEN CAUSA BAJA
 * SE LE SIGUE CADUCANDO EL SALDO EL 31 DE MARZO SIGUIENTE. El bucle cierra
 * años después de `ended_on` como si la persona siguiera en plantilla, así que
 * los días devengados y no disfrutados el día que se fue desaparecen del ERP
 * en el siguiente 31 de marzo (alta 2025-01-01 y baja 2026-07-01: los 10,98
 * que le quedaban se esfuman el 2027-03-31). Para un finiquito eso es justo lo
 * contrario de lo que hace falta —los días no disfrutados de quien se va se
 * PAGAN, no caducan—, pero «cuánto se liquida y cómo se enseña» es una
 * decisión de dirección, no del código, y no estaba en el encargo del año
 * natural. Cambiarlo por nuestra cuenta movería el saldo de las bajas sin que
 * nadie lo hubiera pedido. Hay que resolverlo ANTES de que haya una baja de
 * verdad: lo mínimo sería congelar `leftover` en cuanto `ended_on` quede por
 * detrás del año que se cierra y marcar esa cifra como «pendiente de liquidar»
 * en vez de sumarla al disponible.
 */
export function carriedInto(
  employee: VacationEmployee,
  requests: VacationRequest[],
  year: number,
  holidays?: Holidays
): number {
  const perMonth =
    employee.vacation_days_per_month == null ? null : Number(employee.vacation_days_per_month)
  if (perMonth == null || !Number.isFinite(perMonth)) return 0

  const startedOn = employee.started_on ? dayKeyOf(employee.started_on) : null
  if (!startedOn) return 0

  const endedOn = employee.ended_on ? dayKeyOf(employee.ended_on) : null

  /**
   * EL ENCADENADO ARRANCA EN EL PRIMER AÑO CON ACTIVIDAD, QUE NO SIEMPRE ES EL
   * DEL ALTA. Si hay peticiones con fechas ANTERIORES a `started_on` —alguien a
   * quien se da de alta cuando ya venía disfrutando días, o una fecha de alta
   * corregida hacia adelante después de haber metido peticiones—, esos días se
   * gastaron igual y la deuda que dejaron tiene que lastrar los años siguientes
   * como cualquier otra. Cortando en el año del alta, el consumo de esos años
   * se quedaba fuera del encadenado y la deuda SE PERDONABA SOLA, en contra de
   * la regla de aquí abajo.
   */
  let firstYear = yearOf(startedOn)
  for (const r of requests) {
    if (r.employee_id !== employee.id) continue
    if (!BLOCKING_STATUSES.includes(r.status)) continue
    const y = yearOf(r.start_date)
    if (y < firstYear) firstYear = y
  }
  // El primer año con actividad no arrastra nada de antes: ahí empieza todo.
  if (year <= firstYear) return 0

  let leftover = 0
  for (let y = Math.max(firstYear, year - MAX_CARRY_YEARS); y < year; y += 1) {
    const usable = Math.max(0, leftover)
    const debt = Math.max(0, -leftover)
    // El «hoy» que se le pasa es el fin de ese año: se está cerrando entero.
    const c = consumptionInYear(requests, employee.id, y, lastDayOfYear(y), holidays)
    // EL ARRASTRE SE GASTA PRIMERO: lo disfrutado antes del 31 de marzo sale
    // del arrastre mientras quede, y solo el exceso toca el devengo del año.
    const fromOwnYear = Math.max(0, c.untilDeadline - usable) + c.afterDeadline
    const accrued = round2(accrualMonthsInYear(startedOn, endedOn, y) * perMonth)
    leftover = round2(accrued - debt - fromOwnYear)
  }
  return leftover
}

export interface VacationBalance {
  employeeId: string
  /** EL AÑO NATURAL del que habla este saldo */
  year: number
  /** Días devengados en el año, a fecha de hoy */
  generated: number
  /** Lo que devengará el año ENTERO */
  yearTotal: number
  /** yearTotal − generated: lo que aún sumará antes de que acabe el año */
  remaining: number
  /** Lo que sobró del año anterior y entró en este */
  carriedIn: number
  /** De ese arrastre, lo ya comprometido: se gasta antes que el devengo nuevo */
  carriedUsed: number
  /** Lo que queda vivo del arrastre. CADUCA el 31 de marzo */
  carriedLeft: number
  /** Lo que se perdió por llegar el 1 de abril sin usarlo */
  carriedExpired: number
  /** 'yyyy-03-31': el día en que caduca el arrastre de este año */
  carriedExpiresOn: string
  /** El arrastre todavía se puede gastar */
  carriedAlive: boolean
  /** Días de más gastados el año anterior. Lastran este año y NO caducan */
  debt: number
  /** Días ya concedidos con fechas DE ESTE AÑO: los «canjeados» */
  approved: number
  /** Días de peticiones sin resolver con fechas de este año. RESTAN */
  pending: number
  /** generated + carriedIn − carriedExpired − debt − approved − pending */
  available: number
  /**
   * De los aprobados de este año, los que ya se han disfrutado (fecha pasada).
   * Es la diferencia entre lo gastado y lo reservado: `taken + booked === approved`.
   */
  taken: number
  /** De los aprobados, los que todavía no han llegado o están en curso */
  booked: number
  /** Cuántas peticiones de este año esperan respuesta */
  pendingCount: number
  /** El devengo con su detalle, para poder enseñar de qué fecha se cuenta */
  accrual: VacationAccrual
  /** true si `available` ha salido negativo: hay más días pedidos que disponibles */
  overdrawn: boolean
}

export interface VacationBalanceOptions {
  holidays?: Holidays
  /** El año natural del que se pregunta. Por defecto, el año de `today` */
  year?: number
}

/** Las peticiones de una persona, en orden de calendario */
export function requestsOf(requests: VacationRequest[], employeeId: string): VacationRequest[] {
  return requests
    .filter((r) => r.employee_id === employeeId)
    .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.id.localeCompare(b.id))
}

/**
 * EL SALDO DE UNA PERSONA EN UN AÑO NATURAL.
 *
 *   devengado    meses de ESE AÑO ya cerrados × tarifa
 *   arrastrado   lo que sobró del año anterior; caduca el 31 de marzo
 *   aprobados    días concedidos cuyas FECHAS caen en ese año
 *   pendientes   días de peticiones sin resolver con fechas de ese año
 *   disponibles  devengado + arrastrado − caducado − deuda − aprobados − pendientes
 *
 * LA FÓRMULA DEL DISPONIBLE, QUE ES LA PARTE QUE SE LEE MAL SI NO SE EXPLICA:
 * el arrastre entra ENTERO y luego se resta lo que CADUCÓ SIN GASTARSE. No se
 * resta el arrastre ya usado, porque ese ya está descontado dentro de
 * `approved`/`pending`. Restar el arrastre neto Y el consumo entero lo
 * descontaría dos veces.
 *
 *   arrastrado = usado + vivo + caducado
 *
 * y de esos tres, el único que no se puede aprovechar es el caducado. Antes
 * del 31 de marzo caducado es 0 y el arrastre suma entero; después, lo que no
 * se gastó desaparece y lo que sí se gastó sigue cubriendo su consumo.
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
  options: VacationBalanceOptions = {}
): VacationBalance {
  const day = dayKeyOf(today)
  const year = options.year ?? yearOf(day)
  const holidays = options.holidays

  const accrual = vacationAccrual(employee, day, year)
  const consumption = consumptionInYear(requests, employee.id, year, day, holidays)

  const carry = carriedInto(employee, requests, year, holidays)
  const carriedIn = round2(Math.max(0, carry))
  const debt = round2(Math.max(0, -carry))

  // El arrastre se gasta ANTES que el devengo del año: de lo disfrutado hasta
  // el 31 de marzo, lo que quepa sale de aquí.
  const carriedUsed = round2(Math.min(consumption.untilDeadline, carriedIn))
  const carriedAlive = carryOverAlive(year, day)
  const unused = round2(carriedIn - carriedUsed)
  const carriedLeft = carriedAlive ? unused : 0
  const carriedExpired = carriedAlive ? 0 : unused

  const approved = round2(consumption.approved)
  const pending = round2(consumption.pending)
  const taken = round2(Math.min(consumption.taken, approved))

  const available = round2(
    accrual.generated + carriedIn - carriedExpired - debt - approved - pending
  )

  return {
    employeeId: employee.id,
    year,
    generated: accrual.generated,
    yearTotal: accrual.yearTotal,
    remaining: accrual.remaining,
    carriedIn,
    carriedUsed,
    carriedLeft,
    carriedExpired,
    carriedExpiresOn: carryOverDeadline(year),
    carriedAlive,
    debt,
    approved,
    pending,
    available,
    taken,
    booked: round2(approved - taken),
    pendingCount: consumption.pendingCount,
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
  /**
   * LAS PIDE LA PROPIA PERSONA, así que los avisos le hablan de tú.
   *
   * El mismo formulario lo usan la empleada (en «Mis vacaciones», donde todo lo
   * demás tutea: «Has elegido», «Puedes pedir en 2026») y un admin registrando
   * la petición por otra persona. Sin esta bandera, los avisos que salen de
   * aquí se pintaban tal cual y le hablaban de usted a la propia interesada.
   */
  propio?: boolean
}

/** Lo que esta petición le cuesta a UN año concreto */
export interface VacationRequestYear {
  year: number
  /** Días laborables de la petición que caen en ese año */
  days: number
  /**
   * EL DÍA CON EL QUE SE HA MEDIDO EL SALDO DE ESTE TRAMO, que NO es hoy: es el
   * día en que esos días se van a disfrutar. Va en el resultado para que se
   * pueda ver de cuándo habla el número. La explicación larga, en `medidoEn`.
   */
  measuredOn: string
  /** Disponible de ese año SIN esta petición, medido en `measuredOn` */
  availableBefore: number
  /** Cómo le quedaría ese año si se aprobara, medido en `measuredOn` */
  availableAfter: number
  /** De `days`, cuántos salen del ARRASTRE del año anterior (se gasta primero) */
  fromCarry: number
  /**
   * Arrastre de ese año que CADUCARÁ IGUALMENTE pese a esta petición. Se mide
   * con la fecha de HOY, no con `measuredOn`: ver `checkVacationRequest`.
   */
  carryLeftAfter: number
  /** 'yyyy-03-31': el día en que caduca el arrastre de ese año */
  carryExpiresOn: string
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
  /**
   * El saldo tal y como quedaría si esta petición se aprobara, MEDIDO EL DÍA EN
   * QUE SE DISFRUTAN LOS DÍAS y no hoy (ver `medidoEn`). Cuando el rango cruza
   * el fin de año es EL PEOR de los años que toca: es el que decide si se pasa,
   * y enseñar el otro escondería justo el problema.
   */
  balanceAfter: number
  /**
   * El desglose por año natural. Con un solo elemento en el caso normal; con
   * dos cuando la petición cruza el 31 de diciembre.
   */
  byYear: VacationRequestYear[]
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

  /**
   * DE TÚ O DE USTED. Estos avisos se pintan tal cual en el formulario, que es
   * el mismo para la empleada y para el admin que registra por ella; y también
   * salen por toast desde la ruta de API. En «Mis vacaciones» todo lo demás
   * tutea, así que un «le quedan 12,30 días» ahí desentona y se lee como si
   * hablara de otra persona.
   */
  const propio = input.propio ?? false
  const sePasa = propio ? 'Te pasas' : 'Se pasa'
  const leQuedan = propio ? 'te quedan' : 'le quedan'
  const leGastan = propio ? 'te gastan' : 'le gastan'
  const leCaducan = propio ? 'te caducan' : 'le caducan'
  const LeCaducan = propio ? 'Te caducan' : 'Le caducan'
  const suFecha = propio ? 'tu fecha' : 'su fecha'

  const validFormat = isDayKey(startDate) && isDayKey(endDate)
  if (!validFormat) {
    return {
      ok: false,
      workingDays: 0,
      noticeDays: 0,
      lateNotice: false,
      overlapping: [],
      balanceAfter: 0,
      byYear: [],
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

  /**
   * EL SALDO SE MIRA AÑO POR AÑO, y no una sola vez.
   *
   * Una petición del 28 de diciembre al 4 de enero gasta de dos bolsas
   * distintas: unos días de un año y otros del siguiente. Con un único saldo
   * —el del año de hoy— la pantalla diría que cabe de sobra mientras deja el
   * año que viene en negativo, y nadie se enteraría hasta enero.
   *
   * Y EL «DESPUÉS» SE CALCULA METIENDO LA PETICIÓN EN LA LISTA Y VOLVIENDO A
   * PEDIR EL SALDO, en vez de restarle los días al «antes». No es lo mismo, y
   * la diferencia es justo la del caso que nos ocupa: los 4 días que se gastan
   * en diciembre salen del saldo de 2026, así que reducen en 4 lo que 2026
   * ARRASTRA a 2027. Restando a mano, 2027 saldría 4 días más alto de lo que
   * va a estar de verdad. Recalcular deja que `carriedInto` encadene el efecto
   * él solo, que es lo que hará en enero cuando la petición sea real.
   *
   * De paso resuelve gratis el caso de reeditar o reaprobar: la petición que
   * se está tocando se saca de la foto «antes», así que sus días no se
   * descuentan dos veces sin tener que compensarlos a mano.
   */
  const sinEsta = input.excludeId ? requests.filter((r) => r.id !== input.excludeId) : requests
  // La petición como si ya existiera. Nace 'pendiente' porque es lo que va a
  // ser al guardarse, y lo pendiente ya reserva días igual que lo aprobado.
  const comoSiExistiera: VacationRequest[] = [
    ...sinEsta,
    {
      id: '__simulada__',
      employee_id: employee.id,
      start_date: startDate,
      end_date: endDate,
      working_days: workingDays,
      status: 'pendiente',
      reason: null,
      created_by: null,
      resolved_by: null,
      resolved_at: null,
      rejection_reason: null,
      cancelled_by: null,
      cancelled_at: null,
      late_notice: false,
      created_at: '',
      updated_at: '',
    },
  ]

  /**
   * CON QUÉ DÍA SE MIDE EL SALDO DE CADA TRAMO. NO CON HOY.
   *
   * El devengo corre mes a mes, así que unas vacaciones de agosto pedidas en
   * abril se disfrutan con cuatro meses más de saldo del que hay hoy. Midiendo
   * a hoy, el aviso de «se pasa del saldo» saltaba en falso en CASI TODAS las
   * vacaciones de verano —justo las que se planifican con antelación— y el
   * formulario las pintaba en rojo: desde que el contador se pone a cero cada 1
   * de enero, de abril a agosto casi todo el mundo tiene devengado menos de lo
   * que pide para el verano.
   *
   * Se mide con el ÚLTIMO día del tramo de ese año —`min(fin, 31 de
   * diciembre)`—, que es cuando ya se han disfrutado todos.
   *
   * Y NUNCA ANTES DE HOY: un tramo que ya pasó se mide a hoy. Si no, el devengo
   * de hace meses haría bajar un saldo que ya está cobrado y el aviso saltaría
   * en falso otra vez, ahora al revés.
   */
  function medidoEn(year: number): string {
    const finDelTramo = endDate < lastDayOfYear(year) ? endDate : lastDayOfYear(year)
    return finDelTramo > today ? finDelTramo : today
  }

  const byYear: VacationRequestYear[] = workingDaysByYear(
    startDate,
    endDate,
    workingDays,
    holidays
  ).map(({ year, days }) => {
    const measuredOn = medidoEn(year)
    const antes = vacationBalance(employee, sinEsta, measuredOn, { holidays, year })
    const conEsta = vacationBalance(employee, comoSiExistiera, measuredOn, { holidays, year })

    /**
     * EL ARRASTRE VIVO SE MIDE CON HOY, NO CON `measuredOn`.
     *
     * La pregunta que contesta el aviso es «¿le quedan días del año pasado sin
     * gastar AHORA?», y medida en una fecha posterior al 31 de marzo la
     * respuesta es siempre que no —para entonces ya caducaron—, que es justo lo
     * que haría que no avisara nunca. `carriedIn` y `carriedUsed` no dependen de
     * la fecha de referencia (salen de la tarifa y de las fechas de las
     * peticiones); el «sigue vivo», sí. Así que se recompone a mano en vez de
     * pedir un saldo más.
     */
    const vivoHoy = carryOverAlive(year, today)

    return {
      year,
      days,
      measuredOn,
      availableBefore: antes.available,
      availableAfter: conEsta.available,
      // Lo que ESTA petición se lleva del arrastre: lo que sube el arrastre
      // usado al meterla en la foto.
      fromCarry: round2(Math.max(0, conEsta.carriedUsed - antes.carriedUsed)),
      carryLeftAfter: vivoHoy ? round2(conEsta.carriedIn - conEsta.carriedUsed) : 0,
      carryExpiresOn: conEsta.carriedExpiresOn,
    }
  })

  const currentYear = vacationBalance(employee, sinEsta, today, { holidays })
  const balanceAfter =
    byYear.length === 0
      ? round2(currentYear.available)
      : Math.min(...byYear.map((y) => y.availableAfter))

  if (byYear.length > 1) {
    warnings.push(
      `Estas fechas cruzan el fin de año: ${byYear
        .map((y) => `${formatDays(y.days)} de ${y.year}`)
        .join(' y ')}. Cada trozo sale del saldo de su año, no todo del primero.`
    )
  }

  // Mismo motivo que arriba: con la tarifa a 0 el falsy se tragaba el aviso de
  // «se pasa del saldo», que es justo el caso en que más falta hace.
  if (balanceAfter < 0 && employee.vacation_days_per_month != null) {
    const worst = byYear.find((y) => y.availableAfter === balanceAfter)
    warnings.push(
      worst
        ? `${sePasa} del saldo de ${worst.year}: ${leQuedan} ${formatDays(
            worst.availableBefore
          )} de ese año y estas fechas ${leGastan} ${formatDays(worst.days)}`
        : `${sePasa} del saldo: ${leQuedan} ${formatDays(currentYear.available)} y pide ${formatDays(workingDays)}`
    )
  }

  /**
   * EL ARRASTRE QUE SE VA A CADUCAR. Es el aviso que más falta hace y el que
   * nadie ve venir: quien tiene días del año pasado y pide sus vacaciones para
   * junio los pierde el 31 de marzo sin que nada se lo dijera.
   *
   * SE MIRA EL ARRASTRE DEL AÑO DE LAS FECHAS, NO EL DEL AÑO DE HOY. Antes se
   * leía del saldo del año en curso, y eso lo dejaba mudo justo cuando hace
   * falta: del 1 de abril al 31 de diciembre el arrastre de ESE año ya caducó,
   * así que ninguna petición hecha en esos nueve meses avisaba nunca, ni
   * siquiera las del año siguiente, que son las que pierden días. Y al revés,
   * entre enero y marzo una petición para el año que viene sacaba el aviso
   * nombrando un arrastre y una fecha de caducidad que no eran los suyos.
   *
   * Y SE COMPARA CONTRA LO QUE LA PETICIÓN RESCATA, no contra su fecha de
   * inicio. La condición anterior solo saltaba si el rango ENTERO caía después
   * del 31 de marzo, con el argumento de que «si ya está gastando el arrastre
   * no hay nada que avisar». Eso solo vale si se lo gasta ENTERO: unas
   * vacaciones del 25 de marzo al 10 de abril salvaban 5 días de los 21,96 y
   * los otros 16,96 se perdían en silencio. `carryLeftAfter` ya es lo que queda
   * sin salvar con esta petición dentro, así que basta con que sea mayor que 0.
   */
  for (const y of byYear) {
    if (y.carryLeftAfter <= 0) continue
    warnings.push(
      y.fromCarry > 0
        ? `De estas fechas, ${formatDays(y.fromCarry)} salen del arrastre de ${
            y.year - 1
          }, pero ${leCaducan} igualmente ${formatDays(y.carryLeftAfter)} el ${formatDayLong(
            y.carryExpiresOn
          )}`
        : `${LeCaducan} ${formatDays(y.carryLeftAfter)} arrastrados de ${
            y.year - 1
          } el ${formatDayLong(
            y.carryExpiresOn
          )}, y estas fechas no salen de ahí: esos días se pierden`
    )
  }

  if (employee.started_on && startDate < dayKeyOf(employee.started_on)) {
    warnings.push(`Esas fechas son anteriores a ${suFecha} de alta`)
  }
  if (employee.ended_on && endDate > dayKeyOf(employee.ended_on)) {
    warnings.push(`Esas fechas son posteriores a ${suFecha} de baja`)
  }
  if (currentYear.accrual.missingStartDate) {
    warnings.push(
      propio
        ? 'No tienes fecha de alta en tu ficha, así que tu saldo sale a cero: pídele a dirección que la ponga'
        : `${employee.name} no tiene fecha de alta, así que su saldo sale a cero: ponla en su ficha`
    )
  }

  return {
    ok: errors.length === 0,
    workingDays,
    noticeDays: notice,
    lateNotice,
    overlapping,
    balanceAfter,
    byYear,
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
