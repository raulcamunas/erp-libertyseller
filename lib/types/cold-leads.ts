import { CalendarPerson } from './appointments'

export type ColdLeadStatus =
  | 'pendiente'
  | 'no_contesta'
  | 'programado'
  | 'email_enviado'
  | 'seguimiento'
  | 'cita_cualificada'
  | 'no_interesa'

export type ColdNoteKind = 'llamada' | 'email' | 'whatsapp' | 'linkedin' | 'nota'

export interface ColdLead {
  id: string
  store_name: string
  company: string | null
  revenue_monthly: number | null
  amazon_start: string | null
  phone: string | null
  directors: string | null
  email: string | null
  province: string | null
  category: string | null
  subcategory: string | null
  seller_url: string | null
  mercantile_registry: string | null
  business_address: string | null

  assigned_to: string | null
  status: ColdLeadStatus
  follow_up: string | null
  action_label: string | null
  /** Pestaña del Excel de la que salió: «1a lista», «Alejandro V2»... */
  source_list: string | null
  next_call_date: string | null
  last_contacted_at: string | null
  call_attempts: number

  created_at: string
  updated_at: string
}

export interface ColdLeadNote {
  id: string
  lead_id: string
  author_id: string | null
  kind: ColdNoteKind
  body: string
  occurred_at: string
  created_at: string
  author?: CalendarPerson | null
}

/** Orden del embudo: de lo que no se ha tocado a lo cerrado o descartado */
export const COLD_STATUSES: ColdLeadStatus[] = [
  'pendiente',
  'no_contesta',
  'programado',
  'email_enviado',
  'seguimiento',
  'cita_cualificada',
  'no_interesa',
]

export const COLD_STATUS_LABELS: Record<ColdLeadStatus, string> = {
  pendiente: 'Sin contactar',
  no_contesta: 'No contesta',
  programado: 'Rellamada programada',
  email_enviado: 'Info enviada',
  seguimiento: 'En seguimiento',
  cita_cualificada: 'Cita cualificada',
  no_interesa: 'No le interesa',
}

/** Qué significa cada estado, para que nadie dude al elegir */
export const COLD_STATUS_HINTS: Record<ColdLeadStatus, string> = {
  pendiente: 'Todavía no se ha llamado',
  no_contesta: 'No coge, buzón o cuelga: hay que reintentar',
  programado: 'Nos ha dado día y hora para volver a llamar',
  email_enviado: 'Pidió la información por correo y se la mandamos',
  seguimiento: 'Muestra interés, hay que insistir',
  cita_cualificada: 'Sesión de consultoría agendada',
  no_interesa: 'Descartado: no quiere, ya tiene agencia o no encaja',
}

/**
 * Los mismos colores que usaban en el Excel, para que el equipo no tenga
 * que reaprender nada: amarillo = no contesta, cian = programado,
 * magenta = info enviada, naranja = seguimiento, verde = cualificada,
 * rojo = descartado.
 */
export const COLD_STATUS_DOTS: Record<ColdLeadStatus, string> = {
  pendiente: '#6B7280',
  no_contesta: '#EAB308',
  programado: '#06B6D4',
  email_enviado: '#D946EF',
  seguimiento: '#F97316',
  cita_cualificada: '#22C55E',
  no_interesa: '#EF4444',
}

export const COLD_STATUS_CLASSES: Record<ColdLeadStatus, string> = {
  pendiente: 'bg-gray-500/15 text-gray-300 border-gray-500/30',
  no_contesta: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/35',
  programado: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/35',
  email_enviado: 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/35',
  seguimiento: 'bg-orange-500/20 text-orange-300 border-orange-500/35',
  cita_cualificada: 'bg-green-500/20 text-green-300 border-green-500/35',
  no_interesa: 'bg-red-500/20 text-red-300 border-red-500/35',
}

export const COLD_NOTE_LABELS: Record<ColdNoteKind, string> = {
  llamada: 'Llamada',
  email: 'Email',
  whatsapp: 'WhatsApp',
  linkedin: 'LinkedIn',
  nota: 'Nota',
}

export const COLD_NOTE_COLORS: Record<ColdNoteKind, string> = {
  llamada: '#3B82F6',
  email: '#D946EF',
  whatsapp: '#22C55E',
  linkedin: '#0A66C2',
  nota: '#94A3B8',
}

/** Teléfono listo para un enlace tel: — el Excel trae formatos variados */
export function telHref(phone: string | null): string | null {
  if (!phone) return null
  const first = phone.split(/[/;]|\s-\s|\/\//)[0]
  const cleaned = first.replace(/[^\d+]/g, '')
  if (cleaned.replace(/\D/g, '').length < 7) return null
  return cleaned.startsWith('+') ? cleaned : `+34${cleaned}`
}

/** Criterios de orden de la lista de trabajo */
export type ColdSort = 'revenue_desc' | 'revenue_asc' | 'due_first' | 'name'

export const COLD_SORT_LABELS: Record<ColdSort, string> = {
  revenue_desc: 'Más facturación',
  revenue_asc: 'Menos facturación',
  due_first: 'Rellamadas primero',
  name: 'Nombre A-Z',
}

/**
 * Color estable por lista de origen, para distinguirlas de un vistazo sin
 * tener que leer la etiqueta.
 */
const LIST_PALETTE = ['#8B5CF6', '#0EA5E9', '#F59E0B', '#EC4899', '#14B8A6', '#64748B']

export function colorForList(name: string | null): string {
  if (!name) return '#64748B'
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return LIST_PALETTE[Math.abs(hash) % LIST_PALETTE.length]
}

export function formatRevenue(n: number | null): string {
  if (n == null) return '—'
  return `${Math.round(n).toLocaleString('es-ES')} €`
}
