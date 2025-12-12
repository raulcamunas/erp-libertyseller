export type WebLeadStatus = 'registrado' | 'contactado' | 'seguimiento' | 'interesado' | 'descartado'

export interface WebLead {
  id: string
  created_at: string
  updated_at: string
  status: WebLeadStatus
  nombre: string
  email: string
  telefono: string | null
  empresa: string | null
  mensaje: string | null
  ingresos: string | null
  notas_internas: string | null
  assigned_to: string | null
}

export interface WebLeadFormData {
  nombre: string
  email: string
  telefono?: string
  empresa?: string
  mensaje?: string
  ingresos?: string
}

