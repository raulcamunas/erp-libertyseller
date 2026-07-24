export type AppointmentStatus =
  | 'scheduled'
  | 'confirmed'
  | 'completed'
  | 'cancelled'
  | 'no_show'

export type SyncStatus = 'pending' | 'synced' | 'error' | 'local'

export interface Appointment {
  id: string
  comercial_id: string
  assigned_closer_id: string | null

  lead_name: string
  lead_email: string | null
  lead_phone: string | null
  lead_company: string | null
  lead_source: string | null
  lead_ref_id: string | null

  start_time: string
  end_time: string

  status: AppointmentStatus

  title: string | null
  notes: string | null
  details: Record<string, unknown>

  google_event_id: string | null
  google_calendar_id: string | null
  google_html_link: string | null
  sync_status: SyncStatus
  sync_error: string | null
  last_synced_at: string | null
  updated_source: 'erp' | 'google'

  created_at: string
  updated_at: string
}

/** Perfil mínimo de un comercial/closer para pintar en el calendario */
export interface CalendarPerson {
  id: string
  full_name: string | null
  email: string | null
  role: 'admin' | 'employee' | 'partner'
  calendar_color: string | null
}

/** Cita enriquecida con los datos de la persona que la agendó */
export interface AppointmentWithPeople extends Appointment {
  comercial?: CalendarPerson | null
  assigned_closer?: CalendarPerson | null
}

export interface CreateAppointmentPayload {
  comercial_id?: string
  assigned_closer_id?: string | null
  lead_name: string
  lead_email?: string | null
  lead_phone?: string | null
  lead_company?: string | null
  lead_source?: string | null
  lead_ref_id?: string | null
  start_time: string
  end_time: string
  status?: AppointmentStatus
  title?: string | null
  notes?: string | null
  details?: Record<string, unknown>
}

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  scheduled: 'Agendada',
  confirmed: 'Confirmada',
  completed: 'Realizada',
  cancelled: 'Cancelada',
  no_show: 'No asistió',
}

export const APPOINTMENT_STATUS_COLORS: Record<AppointmentStatus, string> = {
  scheduled: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  confirmed: 'bg-green-500/20 text-green-300 border-green-500/30',
  completed: 'bg-emerald-600/20 text-emerald-300 border-emerald-600/30',
  cancelled: 'bg-gray-500/20 text-gray-300 border-gray-500/30',
  no_show: 'bg-red-500/20 text-red-300 border-red-500/30',
}

/**
 * Paleta de colores por comercial (fallback si no tienen calendar_color).
 * Se asigna de forma estable a partir del id.
 */
export const AGENT_COLOR_PALETTE = [
  '#FF6600', // naranja Liberty
  '#3B82F6', // azul
  '#10B981', // verde
  '#A855F7', // morado
  '#EC4899', // rosa
  '#F59E0B', // ámbar
  '#06B6D4', // cian
  '#EF4444', // rojo
  '#8B5CF6', // violeta
  '#14B8A6', // teal
]

export function colorForAgent(id: string, explicit?: string | null): string {
  if (explicit) return explicit
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash)
  }
  const idx = Math.abs(hash) % AGENT_COLOR_PALETTE.length
  return AGENT_COLOR_PALETTE[idx]
}
