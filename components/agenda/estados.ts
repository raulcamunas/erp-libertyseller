import { Ban, BadgeCheck, CalendarClock, CheckCircle2, RefreshCw, UserX, XCircle, type LucideIcon } from 'lucide-react'
import type { AppointmentStatus } from '@/lib/types/appointments'
import type { TonoEstado } from '@/lib/estilo/denso'

/**
 * EL ESTADO DE UNA CITA: glifo, palabra y DESPUÉS color (lib/estilo/denso.ts, ESTADO).
 *
 * Los siete estados salen de APPOINTMENT_STATUS_LABELS y no se inventa ninguno. Lo que cambia respecto a la agenda de antes es cómo se enseñan: antes eran siete cajitas
 * de colores sueltos (azul, amarillo, cielo, gris, verde, rojo, zinc) que no se parecían a ningún otro estado del ERP; ahora usan la paleta única de estados, el mismo
 * verde que «Cita cualificada» en Cold Calling, y llevan siempre un glifo: tapa el color con la mano y el estado se sigue leyendo.
 *
 * `corto` es el que cabe dentro del bloque del calendario; `largo`, el de la ficha.
 */
export const ESTADO_DE_CITA: Record<AppointmentStatus, { icono: LucideIcon; tono: TonoEstado; corto: string; largo: string }> = {
  scheduled: { icono: CalendarClock, tono: 'azul', corto: 'Agendada', largo: 'Agendada' },
  confirmed: { icono: CheckCircle2, tono: 'ambar', corto: 'Confirmada', largo: 'Confirmada' },
  rescheduled: { icono: RefreshCw, tono: 'cian', corto: 'Reagendada', largo: 'Re-agendada' },
  no_show: { icono: UserX, tono: 'gris', corto: 'No asistió', largo: 'No asistió' },
  qualified: { icono: BadgeCheck, tono: 'verde', corto: 'Cualificada', largo: 'Cita Cualificada' },
  not_qualified: { icono: XCircle, tono: 'rojo', corto: 'No cualificada', largo: 'Cita No Cualificada' },
  cancelled: { icono: Ban, tono: 'gris', corto: 'Cancelada', largo: 'Cancelada' },
}

/** Las que ya no cuentan como una reunión que va a ocurrir: el bloque se atenúa y el nombre se tacha */
export const ESTADOS_APAGADOS: ReadonlySet<AppointmentStatus> = new Set<AppointmentStatus>(['not_qualified', 'cancelled'])

export function iniciales(nombre: string | null | undefined, respaldo: string): string {
  const fuente = (nombre || respaldo || '?').trim()
  const partes = fuente.split(/\s+/).filter(Boolean)
  if (partes.length === 0) return '?'
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase()
  return (partes[0][0] + partes[1][0]).toUpperCase()
}
