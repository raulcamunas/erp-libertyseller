export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled'

export interface InvoiceItem {
  id: string
  invoice_id: string
  description: string
  quantity: number
  unit_price: number
  amount: number
  sort_order: number
}

export interface Invoice {
  id: string
  client_id: string | null
  client_name: string
  client_email: string | null
  invoice_number: string
  issue_date: string
  due_date: string
  status: InvoiceStatus
  wise_payment_link: string | null
  commission_report_id: string | null
  subtotal: number
  vat_rate: number
  vat_amount: number
  total: number
  currency: string
  notes: string | null
  paid_at: string | null
  paid_amount: number | null
  bank_reference: string | null
  email_sent_at: string | null
  last_wise_check: string | null
  created_at: string
  updated_at: string
  items?: InvoiceItem[]
}

export interface InvoiceWithItems extends Invoice {
  items: InvoiceItem[]
}

export interface CreateInvoicePayload {
  client_id?: string
  client_name: string
  client_email?: string
  issue_date: string
  due_date: string
  vat_rate: number
  currency: string
  notes?: string
  wise_payment_link?: string
  commission_report_id?: string
  items: {
    description: string
    quantity: number
    unit_price: number
    sort_order: number
  }[]
}

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: 'Borrador',
  sent: 'Enviada',
  paid: 'Pagada',
  overdue: 'Vencida',
  cancelled: 'Cancelada',
}

export const INVOICE_STATUS_COLORS: Record<InvoiceStatus, string> = {
  draft: 'text-white/50 bg-white/10',
  sent: 'text-blue-400 bg-blue-400/10',
  paid: 'text-green-400 bg-green-400/10',
  overdue: 'text-red-400 bg-red-400/10',
  cancelled: 'text-white/30 bg-white/5',
}

export const DEFAULT_LINE_ITEMS = [
  { description: 'Comisiones Amazon', quantity: 1, unit_price: 0, sort_order: 0 },
  { description: 'Gestión Amazon', quantity: 1, unit_price: 0, sort_order: 1 },
  { description: 'Creatividades', quantity: 1, unit_price: 0, sort_order: 2 },
]
