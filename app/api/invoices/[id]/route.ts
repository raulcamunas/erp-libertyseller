import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('invoices')
    .select('*, items:invoice_items(*)')
    .eq('id', params.id)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 404 })
  return NextResponse.json({ data })
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { items, ...invoiceFields } = body

  // Recalculate totals if items provided
  if (items) {
    const subtotal = items.reduce((s: number, i: any) => s + i.quantity * i.unit_price, 0)
    const vat_amount = subtotal * (invoiceFields.vat_rate || 0)
    invoiceFields.subtotal = subtotal
    invoiceFields.vat_amount = vat_amount
    invoiceFields.total = subtotal + vat_amount

    // Replace items
    await supabase.from('invoice_items').delete().eq('invoice_id', params.id)
    if (items.length > 0) {
      await supabase.from('invoice_items').insert(
        items.map((item: any, idx: number) => ({
          invoice_id: params.id,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
          amount: item.quantity * item.unit_price,
          sort_order: idx,
        }))
      )
    }
  }

  const { data, error } = await supabase
    .from('invoices')
    .update(invoiceFields)
    .eq('id', params.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase.from('invoices').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
