export interface FinancePeriod {
  id: string
  year: number
  month: number
  created_at: string
  updated_at: string
}

export interface FinancePayment {
  id: string
  period_id: string
  client_name: string
  amount: number
  description: string | null
  payment_date: string | null
  created_at: string
  updated_at: string
  attachments?: FinanceAttachment[]
}

export interface FinanceAttachment {
  id: string
  payment_id: string
  file_name: string
  file_url: string
  file_type: string | null
  file_size: number | null
  uploaded_at: string
}

export interface MonthlySummary {
  month: string
  year: number
  monthNumber: number
  totalIncome: number
  totalExpenses: number
  profit: number
}

