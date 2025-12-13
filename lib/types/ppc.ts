export interface PPCClient {
  id: string
  name: string
  logo_url: string | null
  currency: string
  status: 'active' | 'paused'
  created_at: string
  updated_at: string
}

export interface PPCWeeklySnapshot {
  id: string
  client_id: string
  week_start_date: string
  total_spend: number
  total_sales: number
  global_acos: number
  top_products: any[]
  ai_summary: string | null
  created_at: string
  updated_at: string
}

