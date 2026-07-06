import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getTransactions } from '@/lib/wise'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Get all unpaid sent/overdue invoices
  const { data: pendingInvoices, error } = await supabase
    .from('invoices')
    .select('*')
    .in('status', ['sent', 'overdue'])

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!pendingInvoices || pendingInvoices.length === 0) {
    return NextResponse.json({ matched: 0, message: 'No hay facturas pendientes' })
  }

  // Fetch last 90 days of transactions from Wise
  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - 90)

  let transactions: any[] = []
  try {
    transactions = await getTransactions(startDate, endDate)
  } catch (e: any) {
    return NextResponse.json({ error: `Wise API: ${e.message}` }, { status: 502 })
  }

  // Only positive (incoming) transactions
  const incomingTx = transactions.filter(tx => tx.amount.value > 0)

  const matched: string[] = []

  for (const invoice of pendingInvoices) {
    const invoiceTotal = Math.round(invoice.total * 100) // cents

    // Find a transaction matching the amount (±1€ tolerance) within date range
    const match = incomingTx.find(tx => {
      const txAmount = Math.round(Math.abs(tx.amount.value) * 100)
      const diff = Math.abs(txAmount - invoiceTotal)
      const txDate = new Date(tx.date)
      const issueDate = new Date(invoice.issue_date)
      return diff <= 100 && txDate >= issueDate
    })

    if (match) {
      await supabase
        .from('invoices')
        .update({
          status: 'paid',
          paid_at: match.date,
          paid_amount: Math.abs(match.amount.value),
          bank_reference: match.details?.paymentReference || match.id,
          last_wise_check: new Date().toISOString(),
        })
        .eq('id', invoice.id)

      matched.push(invoice.invoice_number)
    } else {
      // Update last_wise_check timestamp
      await supabase
        .from('invoices')
        .update({ last_wise_check: new Date().toISOString() })
        .eq('id', invoice.id)
    }
  }

  return NextResponse.json({
    matched: matched.length,
    invoices: matched,
    checked: pendingInvoices.length,
  })
}
