export interface Client {
  id: string
  name: string
  base_commission_rate: number
  created_at: string
  updated_at: string
}

export interface CommissionException {
  id: string
  client_id: string
  keyword: string
  special_rate: number
  created_at: string
}

export interface CommissionReport {
  id: string
  slug: string | null
  client_id: string
  period: string | null
  data: CommissionCalculationData
  status: 'draft' | 'final' | 'archived'
  created_at: string
  updated_at: string
}

export interface CommissionCalculationData {
  summary: {
    totalSales: number
    totalRefunds: number
    realTurnover: number
    totalIva: number // IVA total descontado
    netBase: number // Base sin IVA
    totalCommission: number
    averageCommissionRate: number
    totalOrders: number
  }
  rows: CommissionRow[]
  errors: string[]
}

export interface CommissionRow {
  productTitle: string
  asin: string
  orderId?: string
  date?: string
  quantity?: number
  grossSales: number
  refunds: number
  realTurnover: number
  iva: number // IVA calculado (21%)
  netBase: number // Base sin IVA
  commissionRate: number
  commission: number
  appliedException?: string
  rowNumber: number // Número de fila original
}

