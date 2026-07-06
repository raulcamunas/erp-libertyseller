import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { CreateInvoicePayload } from '@/lib/types/invoices'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')

  let query = supabase
    .from('invoices')
    .select('*, items:invoice_items(*)')
    .order('created_at', { ascending: false })

  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Auto-mark overdue
  const now = new Date()
  const toMark = (data || []).filter(
    inv => inv.status === 'sent' && new Date(inv.due_date) < now
  )
  if (toMark.length > 0) {
    await supabase
      .from('invoices')
      .update({ status: 'overdue' })
      .in('id', toMark.map(i => i.id))
    toMark.forEach(i => { i.status = 'overdue' })
  }

  return NextResponse.json({ data })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body: CreateInvoicePayload = await request.json()

  // Generate invoice number
  const year = new Date().getFullYear()
  const { data: lastInvoice } = await supabase
    .from('invoices')
    .select('invoice_number')
    .ilike('invoice_number', `LS-${year}-%`)
    .order('invoice_number', { ascending: false })
    .limit(1)
    .single()

  let seq = 1
  if (lastInvoice?.invoice_number) {
    const parts = lastInvoice.invoice_number.split('-')
    seq = (parseInt(parts[2] || '0') || 0) + 1
  }
  const invoice_number = `LS-${year}-${String(seq).padStart(3, '0')}`

  const subtotal = body.items.reduce((s, i) => s + i.quantity * i.unit_price, 0)
  const vat_amount = subtotal * (body.vat_rate || 0)
  const total = subtotal + vat_amount

  const { data: invoice, error: invError } = await supabase
    .from('invoices')
    .insert({
      client_id: body.client_id || null,
      client_name: body.client_name,
      client_email: body.client_email || null,
      invoice_number,
      issue_date: body.issue_date,
      due_date: body.due_date,
      status: 'draft',
      wise_payment_link: body.wise_payment_link || null,
      commission_report_id: body.commission_report_id || null,
      subtotal,
      vat_rate: body.vat_rate || 0,
      vat_amount,
      total,
      currency: body.currency || 'EUR',
      notes: body.notes || null,
    })
    .select()
    .single()

  if (invError) return NextResponse.json({ error: invError.message }, { status: 500 })

  if (body.items.length > 0) {
    const items = body.items.map(item => ({
      invoice_id: invoice.id,
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unit_price,
      amount: item.quantity * item.unit_price,
      sort_order: item.sort_order,
    }))
    const { error: itemsError } = await supabase.from('invoice_items').insert(items)
    if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 500 })
  }

  return NextResponse.json({ data: invoice }, { status: 201 })
}
