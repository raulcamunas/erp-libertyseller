export interface Lead {
  id: string
  created_at: string
  updated_at: string
  name: string
  phone: string | null
  email: string | null
  revenue_range: string | null
  is_amazon_seller: boolean
  status: 'nuevo' | 'contactado' | 'perdido'
  notes: string | null
  assigned_to: string | null
}

export interface LeadFormData {
  name: string
  phone?: string
  email?: string
  revenue_range?: string
  is_amazon_seller?: boolean
  status?: 'nuevo' | 'contactado' | 'perdido'
  notes?: string
}

