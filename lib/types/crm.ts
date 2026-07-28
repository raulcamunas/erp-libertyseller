import { AppointmentWithPeople, CalendarPerson } from './appointments'

export type CrmStage =
  | 'nuevo'
  | 'seguimiento'
  | 'propuesta_enviada'
  | 'revision_propuesta'
  | 'negociacion'
  | 'ganado'
  | 'perdido'

export type CrmInteractionKind =
  | 'llamada'
  | 'email'
  | 'whatsapp'
  | 'reunion'
  | 'propuesta'
  | 'nota'

export type CrmDocumentKind = 'propuesta' | 'contrato' | 'otro'

export interface CrmClient {
  id: string
  /** null en fichas dadas de alta a mano, sin cita de origen */
  appointment_id: string | null
  stage: CrmStage
  owner_id: string | null

  /** Datos de contacto propios: solo se usan en las altas manuales.
   *  Si la ficha viene de una cita, los datos buenos son los de la cita. */
  lead_name: string | null
  lead_email: string | null
  lead_phone: string | null
  lead_company: string | null
  revenue_amount: number | null
  amazon_link: string | null

  contact_role: string | null
  website: string | null
  country: string | null
  marketplaces: string | null

  setup_budget: number | null
  maintenance_budget: number | null

  next_action: string | null
  next_action_date: string | null
  notes: string | null

  created_at: string
  updated_at: string
}

/** Ficha del CRM con la cita de origen y el responsable ya resueltos */
export interface CrmClientWithDetails extends CrmClient {
  appointment?: AppointmentWithPeople | null
  owner?: CalendarPerson | null
}

export interface CrmInteraction {
  id: string
  client_id: string
  author_id: string | null
  kind: CrmInteractionKind
  body: string
  occurred_at: string
  created_at: string
  author?: CalendarPerson | null
}

export interface CrmDocument {
  id: string
  client_id: string
  uploaded_by: string | null
  kind: CrmDocumentKind
  file_url: string
  file_path: string | null
  filename: string
  file_size: number | null
  created_at: string
}

/** Orden del pipeline, de arriba abajo en el embudo */
export const CRM_STAGES: CrmStage[] = [
  'nuevo',
  'seguimiento',
  'propuesta_enviada',
  'revision_propuesta',
  'negociacion',
  'ganado',
  'perdido',
]

export const CRM_STAGE_LABELS: Record<CrmStage, string> = {
  nuevo: 'Nuevo',
  seguimiento: 'En seguimiento',
  propuesta_enviada: 'Propuesta enviada',
  revision_propuesta: 'Revisión de propuesta',
  negociacion: 'Negociación',
  ganado: 'Cliente cerrado',
  perdido: 'Perdido',
}

export const CRM_STAGE_COLORS: Record<CrmStage, string> = {
  nuevo: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  seguimiento: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  propuesta_enviada: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  revision_propuesta: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  negociacion: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  ganado: 'bg-green-500/20 text-green-300 border-green-500/30',
  perdido: 'bg-red-500/20 text-red-300 border-red-500/30',
}

/** Punto de color sólido para la lista de la izquierda */
export const CRM_STAGE_DOTS: Record<CrmStage, string> = {
  nuevo: '#3B82F6',
  seguimiento: '#EAB308',
  propuesta_enviada: '#A855F7',
  revision_propuesta: '#F97316',
  negociacion: '#06B6D4',
  ganado: '#22C55E',
  perdido: '#EF4444',
}

/**
 * Datos de contacto de una ficha, vengan de la cita o del alta manual.
 * La cita manda cuando existe: es la fuente de verdad de la agenda.
 */
export function crmContact(client: CrmClientWithDetails) {
  const a = client.appointment
  return {
    name: a?.lead_name ?? client.lead_name ?? null,
    email: a?.lead_email ?? client.lead_email ?? null,
    phone: a?.lead_phone ?? client.lead_phone ?? null,
    company: a?.lead_company ?? client.lead_company ?? null,
    revenue: a?.revenue_amount ?? client.revenue_amount ?? null,
    amazonLink: a?.amazon_link ?? client.amazon_link ?? null,
    /** Fecha de la reunión de cualificación, o null si es alta manual */
    meetingAt: a?.start_time ?? null,
  }
}

export const CRM_INTERACTION_LABELS: Record<CrmInteractionKind, string> = {
  llamada: 'Llamada',
  email: 'Email',
  whatsapp: 'WhatsApp',
  reunion: 'Reunión',
  propuesta: 'Propuesta',
  nota: 'Nota',
}
