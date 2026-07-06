import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import nodemailer from 'nodemailer'
import { buildInvoiceEmailHtml, buildInvoiceEmailSubject } from '@/lib/email-templates/invoice'
import { InvoiceWithItems } from '@/lib/types/invoices'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { report_url, to_email } = await request.json().catch(() => ({}))

  const { data: invoice, error } = await supabase
    .from('invoices')
    .select('*, items:invoice_items(*)')
    .eq('id', params.id)
    .single()

  if (error || !invoice) return NextResponse.json({ error: 'Factura no encontrada' }, { status: 404 })

  const recipientEmail = to_email || invoice.client_email
  if (!recipientEmail) {
    return NextResponse.json({ error: 'No hay email del cliente configurado' }, { status: 400 })
  }

  const html = buildInvoiceEmailHtml(invoice as InvoiceWithItems, report_url)
  const subject = buildInvoiceEmailSubject(invoice as InvoiceWithItems)

  const gmailUser = process.env.GMAIL_USER
  const gmailPassword = process.env.GMAIL_APP_PASSWORD

  if (!gmailUser || !gmailPassword) {
    // Return HTML for manual sending if no SMTP configured
    return NextResponse.json({ html, subject, recipient: recipientEmail, manual: true })
  }

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: gmailUser, pass: gmailPassword },
    })

    await transporter.sendMail({
      from: `"Liberty Seller Hub" <${gmailUser}>`,
      to: recipientEmail,
      subject,
      html,
    })

    await supabase
      .from('invoices')
      .update({ email_sent_at: new Date().toISOString(), status: 'sent' })
      .eq('id', params.id)

    return NextResponse.json({ success: true, recipient: recipientEmail })
  } catch (err: any) {
    return NextResponse.json({ error: `Error al enviar email: ${err.message}` }, { status: 500 })
  }
}
