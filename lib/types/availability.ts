export interface AvailabilityWindow {
  id: string
  owner_id: string
  /** 0=domingo .. 6=sábado (igual que Date.getDay()) */
  days_of_week: number[]
  /** "HH:MM:SS" */
  start_time: string
  /** "HH:MM:SS" */
  end_time: string
  created_at: string
}

export const WEEKDAY_LABELS: Record<number, string> = {
  0: 'Dom',
  1: 'Lun',
  2: 'Mar',
  3: 'Mié',
  4: 'Jue',
  5: 'Vie',
  6: 'Sáb',
}

export function parseTimeToHourMinute(time: string): { hour: number; minute: number } {
  const [h, m] = time.split(':').map(Number)
  return { hour: h, minute: m }
}
