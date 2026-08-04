export type ExpenseCategory = 'equipo' | 'marketing' | 'software' | 'otros'
export type Currency = 'EUR' | 'USD'

export interface TreasuryClient {
  id: string
  name: string
  tax_address: string | null
  email: string | null
  email_alt: string | null
  payment_day: number | null
  default_fee: number | null
  is_active: boolean
  position: number | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface TreasuryClientMonth {
  id: string
  client_id: string
  /** 'yyyy-MM-01' */
  period: string
  fee: number | null
  commission: number | null
  /** Factura mandada por correo */
  invoice_sent: boolean
  paid: boolean
  notes: string | null
}

export interface TreasuryExpense {
  id: string
  period: string
  category: ExpenseCategory
  concept: string
  amount: number
  currency: Currency
  is_recurring: boolean
  notes: string | null
}

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  'equipo',
  'marketing',
  'software',
  'otros',
]

export const EXPENSE_LABELS: Record<ExpenseCategory, string> = {
  equipo: 'Equipo',
  marketing: 'Marketing',
  software: 'Software',
  otros: 'Otros gastos',
}

export const EXPENSE_COLORS: Record<ExpenseCategory, string> = {
  equipo: '#3B82F6',
  marketing: '#A855F7',
  software: '#06B6D4',
  otros: '#64748B',
}

const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

function pad(n: number) {
  return String(n).padStart(2, '0')
}

/** 'yyyy-MM-01' del mes actual desplazado `offset` meses */
export function periodKey(offset = 0, from = new Date()): string {
  let y = from.getFullYear()
  let m = from.getMonth() + offset
  y += Math.floor(m / 12)
  m = ((m % 12) + 12) % 12
  return `${y}-${pad(m + 1)}-01`
}

/** «agosto 2026» a partir de la clave del periodo */
export function periodLabel(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return `${MONTHS[m - 1]} ${y}`
}

/** Mes anterior al dado */
export function previousPeriod(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return m === 1 ? `${y - 1}-12-01` : `${y}-${pad(m - 1)}-01`
}

export function euros(n: number): string {
  return `${Math.round(n).toLocaleString('es-ES')} €`
}

export function eurosPrecise(n: number): string {
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
}

/** Un gasto en euros, convirtiendo si está apuntado en dólares */
export function expenseInEuros(e: TreasuryExpense, usdEur: number): number {
  const amount = Number(e.amount) || 0
  return e.currency === 'USD' ? amount * usdEur : amount
}
