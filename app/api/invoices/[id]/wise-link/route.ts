import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createWiseInvoice } from '@/lib/wise'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: invoice, error } = await supabase
    .from('invoices')
    .select('*, items:invoice_items(*)')
    .eq('id', params.id)
    .single()

  if (error || !invoice) return NextResponse.json({ error: 'Factura no encontrada' }, { status: 404 })

  if (!invoice.client_email) {
    return NextResponse.json(
      { error: 'Se necesita el email del cliente para crear la factura en Wise' },
      { status: 400 }
    )
  }

  try {
    const result = await createWiseInvoice({
      recipientEmail: invoice.client_email,
      amount: invoice.total,
      currency: invoice.currency,
      title: `Factura ${invoice.invoice_number} — Liberty Seller Hub`,
      items: (invoice.items || []).map((item: any) => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unit_price,
      })),
      dueDate: invoice.due_date,
    })

    // Save the payment link to the invoice
    await supabase
      .from('invoices')
      .update({ wise_payment_link: result.paymentLink })
      .eq('id', params.id)

    return NextResponse.json({
      paymentLink: result.paymentLink,
      method: result.method,
      invoiceId: result.invoiceId,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 })
  }
}
