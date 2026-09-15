import { toMadrid, fromMadrid } from '@/lib/timezone'

/** Valores por defecto si un periodo no tiene tarifa guardada */
export const DEFAULT_HOURLY_RATE = 3.5
export const DEFAULT_COMMISSION = 15

export interface WorkHourEntry {
  id: string
  user_id: string
  /** 'yyyy-MM-dd' */
  work_date: string
  hours: number
  note: string | null
  created_at: string
  updated_at: string
}

export interface PayrollRate {
  id: string
  /** 'yyyy-MM-dd', siempre un día 15 */
  period_start: string
  /** null = tarifa general del periodo para todo el equipo */
  user_id: string | null
  hourly_rate: number
  commission_per_appointment: number
  created_at: string
  updated_at: string
}

/** Cita cualificada que un admin suma a mano, fuera de la agenda */
export interface ManualAppointment {
  id: string
  user_id: string
  lead_name: string
  /** 'yyyy-MM-dd' */
  appointment_date: string
  /** null = se aplica la comisión del periodo */
  commission: number | null
  notes: string | null
  created_by: string | null
  created_at: string
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

export interface PayrollPeriod {
  /** 'yyyy-MM-dd' del día 15 que abre el ciclo */
  key: string
  /** Instante real del inicio (15 a las 00:00 en España) */
  start: Date
  /** Instante real del fin, exclusivo (15 del mes siguiente a las 00:00) */
  end: Date
}

/**
 * Ciclo del 15 al 14 del mes siguiente, igual que el desglose de citas y
 * que los Excel de horas. El "15" es el 15 en España, no en el huso de
 * quien lo mire: los comerciales están en Latinoamérica.
 * `offset` desplaza el ciclo en meses (0 = el actual).
 */
export function payrollPeriod(offset: number): PayrollPeriod {
  const madridNow = toMadrid(new Date())
  let y = madridNow.getFullYear()
  let m = madridNow.getMonth()
  if (madridNow.getDate() < 15) m -= 1
  m += offset
  y += Math.floor(m / 12)
  m = ((m % 12) + 12) % 12

  let endY = y
  let endM = m + 1
  if (endM > 11) {
    endM = 0
    endY += 1
  }

  return {
    key: `${y}-${pad(m + 1)}-15`,
    start: fromMadrid(`${y}-${pad(m + 1)}-15T00:00:00`),
    end: fromMadrid(`${endY}-${pad(endM + 1)}-15T00:00:00`),
  }
}

/**
 * A qué ciclo del 15 al 14 pertenece un día suelto ('yyyy-MM-dd').
 * Devuelve la clave del ciclo, que es siempre un día 15.
 */
export function cycleKeyForDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  let yy = y
  let mm = m
  if (d < 15) {
    mm -= 1
    if (mm === 0) {
      mm = 12
      yy -= 1
    }
  }
  return `${yy}-${pad(mm)}-15`
}

/** Los días del ciclo como 'yyyy-MM-dd', del 15 al 14 del mes siguiente */
export function periodDays(period: PayrollPeriod): string[] {
  const days: string[] = []
  const [y, m] = period.key.split('-').map(Number)
  const cursor = new Date(Date.UTC(y, m - 1, 15))
  const last = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 15))
  while (cursor < last) {
    days.push(
      `${cursor.getUTCFullYear()}-${pad(cursor.getUTCMonth() + 1)}-${pad(cursor.getUTCDate())}`
    )
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return days
}

/**
 * LA TARIFA DE ESE MES. DE ESE MES Y DE NINGÚN OTRO.
 *
 * Una tarifa pertenece a UN mes natural. Septiembre tiene la suya, octubre la
 * suya, y tocar una no toca la otra.
 *
 *
 * ============ ANTES SE PROPAGABA, Y ESE ERA EL FALLO ============
 *
 * La versión anterior era «la más reciente que ya había empezado ese día»: una
 * tarifa regía DESDE su fecha hasta que otra la sustituyera. Con eso, poner 20 $
 * en septiembre lo ponía también en octubre, noviembre y todos los meses
 * siguientes, porque ninguno tenía fila propia y heredaban la de septiembre.
 *
 * Y al revés: un mes sin fila cogía la del mes anterior sin decirlo. Así el
 * único mes que se veía en pantalla era el que estabas mirando, pero el número
 * que enseñaba podía venir de tres meses atrás.
 *
 * Ahora la correspondencia es exacta: el día 2026-09-17 usa la fila de
 * 2026-09-01 y punto. Un mes sin fila cae a los valores por defecto, que es un
 * número que se puede ver y explicar, en vez de heredar en silencio.
 *
 *
 * ============ TODOS COBRAN LO MISMO ============
 *
 * Ya no hay excepciones por persona. Existían, y produjeron dinero distinto
 * entre junio y julio de 2026, pero el trato es que todos los comerciales van a
 * la misma tarifa. La migración 184 borra las filas personales que quedaban.
 */
export function resolveRate(
  rates: PayrollRate[],
  /** Un día 'yyyy-MM-dd', o una clave de mes, que también lo es */
  day: string
): { hourly: number; commission: number; source: 'mes' | 'defecto' } {
  const mes = monthKeyForDate(day)
  const propia = rates.find((r) => r.user_id === null && monthKeyForDate(r.period_start) === mes)

  if (propia) {
    return {
      hourly: Number(propia.hourly_rate),
      commission: Number(propia.commission_per_appointment),
      source: 'mes',
    }
  }
  return { hourly: DEFAULT_HOURLY_RATE, commission: DEFAULT_COMMISSION, source: 'defecto' }
}

/** El día 1 del mes de una fecha: la clave de una tarifa mensual */
export function monthKeyForDate(dateStr: string): string {
  return `${dateStr.slice(0, 7)}-01`
}

/** «septiembre 2026» a partir de una clave 'yyyy-MM-01' */
export function monthLabel(key: string): string {
  const meses = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ]
  const [y, m] = key.split('-').map(Number)
  return `${meses[m - 1]} ${y}`
}

export function formatDollars(n: number) {
  return n.toLocaleString('es-ES', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })
}

/** Etiqueta del ciclo: "15 jul – 14 ago 2026" */
export function periodLabel(period: PayrollPeriod): string {
  const startTxt = toMadrid(period.start)
  const endTxt = toMadrid(new Date(period.end.getTime() - 24 * 60 * 60 * 1000))
  const months = [
    'ene', 'feb', 'mar', 'abr', 'may', 'jun',
    'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
  ]
  return `15 ${months[startTxt.getMonth()]} – ${endTxt.getDate()} ${
    months[endTxt.getMonth()]
  } ${endTxt.getFullYear()}`
}

/**
 * EL CICLO QUE SE PAGA EN UN MES DADO.
 *
 * A la gente se le paga el día 15, y lo que se le paga ese día es el ciclo que
 * acaba de cerrar: del 15 del mes anterior al 14 de éste. Así que el sueldo que
 * SALE DE LA CUENTA en septiembre es el ciclo `2026-08-15`, del 15 de agosto al
 * 14 de septiembre.
 *
 * Tesorería mide dinero que sale, no dinero devengado, y por eso necesita esta
 * correspondencia: antes enseñaba el mes natural —del 1 al 30 de septiembre—,
 * que no coincide con ningún pago real y dejaba el gasto abierto hasta fin de
 * mes cuando en realidad se cierra el día 14.
 *
 *   '2026-09-01'  ->  '2026-08-15'
 */
export function cycleKeyPaidInMonth(period: string): string {
  const [y, m] = period.split('-').map(Number)
  const anterior = new Date(Date.UTC(y, m - 2, 15))
  return `${anterior.getUTCFullYear()}-${pad(anterior.getUTCMonth() + 1)}-15`
}

/**
 * El último día del ciclo que se paga ese mes: el 14.
 * Mientras no haya pasado, el importe todavía puede subir.
 */
export function cycleEndPaidInMonth(period: string): string {
  const [y, m] = period.split('-').map(Number)
  return `${y}-${pad(m)}-14`
}
