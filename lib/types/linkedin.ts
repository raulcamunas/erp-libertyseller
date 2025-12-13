export type CompanyStatus = 'active' | 'discarded'

export type ProspectStatus = 'identified' | 'connected' | 'messaged' | 'replied'

export type Agent = 'Raul' | 'Mario'

export interface TargetCompany {
  id: string
  name: string
  created_at: string
  status: CompanyStatus
}

export interface CompanyProspect {
  id: string
  company_id: string
  full_name: string
  role: string | null
  linkedin_url: string | null
  phone: string | null
  email: string | null
  notes: string | null
  status: ProspectStatus
  agent: Agent
  created_at: string
  updated_at: string
}

export interface ProspectStatusHistory {
  id: string
  prospect_id: string
  status: ProspectStatus
  changed_at: string
  created_at: string
}

export interface CompanyWithProspects extends TargetCompany {
  prospects: CompanyProspect[]
}

export interface CompanyFormData {
  name: string
  status?: CompanyStatus
}

export interface ProspectFormData {
  company_id: string
  full_name: string
  role?: string
  linkedin_url?: string
  phone?: string
  email?: string
  notes?: string
  status?: ProspectStatus
  agent?: Agent
}

