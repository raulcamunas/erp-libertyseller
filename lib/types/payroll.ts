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
 * Tarifa aplicable: primero una excepción para esa persona en ese
 * periodo, si no la general del periodo, y si tampoco, los valores por
 * defecto de siempre.
 */
export function resolveRate(
  rates: PayrollRate[],
  periodKey: string,
  userId: string
): { hourly: number; commission: number; source: 'personal' | 'periodo' | 'defecto' } {
  const personal = rates.find((r) => r.period_start === periodKey && r.user_id === userId)
  if (personal) {
    return {
      hourly: Number(personal.hourly_rate),
      commission: Number(personal.commission_per_appointment),
      source: 'personal',
    }
  }
  const general = rates.find((r) => r.period_start === periodKey && r.user_id === null)
  if (general) {
    return {
      hourly: Number(general.hourly_rate),
      commission: Number(general.commission_per_appointment),
      source: 'periodo',
    }
  }
  return { hourly: DEFAULT_HOURLY_RATE, commission: DEFAULT_COMMISSION, source: 'defecto' }
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
