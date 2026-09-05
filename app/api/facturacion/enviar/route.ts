import { NextResponse, type NextRequest } from 'next/server'
import nodemailer from 'nodemailer'
import { createServiceClient } from '@/lib/supabase/service'
import { exigirAdmin } from '@/lib/facturacion/acceso'
import { cargarEmisor } from '@/lib/facturacion/tablero'
import { construirFacturaPdf, nombreDelFichero } from '@/lib/facturacion/pdf'
import { buildInvoiceEmailHtml, buildInvoiceEmailSubject } from '@/lib/email-templates/invoice'
import type { InvoiceWithItems } from '@/lib/types/invoices'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

/**
 * MANDARLE LA FACTURA AL CLIENTE, CON EL PDF DENTRO.
 *
 * El último paso del recorrido y el que más tiempo comía: abrir el correo,
 * buscar la plantilla, pegar el enlace del desglose, adjuntar el PDF que
 * acabas de guardar en Descargas y acordarte de marcarlo en Tesorería.
 *
 *
 * ============ LO QUE HACE, EN ESTE ORDEN ============
 *
 *   1. Genera el PDF de la factura.
 *   2. Manda el correo con el PDF adjunto y, si lo hay, el enlace del desglose.
 *   3. Deja la factura como enviada y marca el mes en Tesorería.
 *
 * El paso 3 va DESPUÉS del envío y a propósito: si se marcara antes y el correo
 * fallara, el mes quedaría dicho como enviado sin que el cliente tenga nada. Al
 * revés el fallo es recuperable —el correo salió, la marca no— y se ve en la
 * pantalla, que sigue enseñando el cliente como pendiente.
 */
export async function POST(request: NextRequest) {
  const permiso = await exigirAdmin()
  if (!permiso.ok) {
    return NextResponse.json({ error: permiso.mensaje }, { status: permiso.estado })
  }

  const cuerpo = (await request.json().catch(() => ({}))) as {
    invoiceId?: string
    reportUrl?: string | null
    /** Para mandarla a una dirección distinta de la del cliente */
    destinatario?: string | null
    /** Solo construye el correo y lo devuelve, sin mandarlo */
    soloVistaPrevia?: boolean
  }

  if (!cuerpo.invoiceId) {
    return NextResponse.json({ error: 'Falta la factura' }, { status: 400 })
  }

  const service = createServiceClient()

  const { data: factura, error } = await service
    .from('invoices')
    .select('*, items:invoice_items(*)')
    .eq('id', cuerpo.invoiceId)
    .single()

  if (error || !factura) {
    return NextResponse.json({ error: 'Esa factura no existe' }, { status: 404 })
  }

  const conLineas = {
    ...factura,
    items: [...(factura.items ?? [])].sort(
      (a: { sort_order: number }, b: { sort_order: number }) => a.sort_order - b.sort_order
    ),
  } as InvoiceWithItems

  // Los datos fiscales del cliente viven en Tesorería, no en la factura.
  let clienteNif: string | null = null
  let clienteDireccion: string | null = null
  if (factura.treasury_client_id) {
    const { data: cli } = await service
      .from('treasury_clients')
      .select('tax_id, tax_address, email, email_alt')
      .eq('id', factura.treasury_client_id)
      .maybeSingle()
    clienteNif = (cli?.tax_id as string) ?? null
    clienteDireccion = (cli?.tax_address as string) ?? null
  }

  const emisor = await cargarEmisor()
  const reportUrl = cuerpo.reportUrl ?? factura.report_url ?? undefined

  const html = buildInvoiceEmailHtml(
    conLineas,
    reportUrl || undefined,
    emisor.iban
      ? {
          iban: emisor.iban,
          bankName: emisor.bank_name,
          bic: emisor.bic,
          legalName: emisor.legal_name,
        }
      : null
  )
  const asunto = buildInvoiceEmailSubject(conLineas)
  const destinatario = (cuerpo.destinatario || factura.client_email || '').trim()

  // ---------- Vista previa: se construye todo pero no sale nada ----------
  if (cuerpo.soloVistaPrevia) {
    return NextResponse.json({ ok: true, vistaPrevia: true, html, asunto, destinatario })
  }

  if (!destinatario) {
    return NextResponse.json(
      { error: 'Este cliente no tiene correo. Ponle uno en Tesorería o escribe uno aquí.' },
      { status: 400 }
    )
  }

  const gmailUser = process.env.GMAIL_USER
  const gmailPassword = process.env.GMAIL_APP_PASSWORD
  if (!gmailUser || !gmailPassword) {
    return NextResponse.json(
      {
        error:
          'No hay correo configurado en el servidor (GMAIL_USER y GMAIL_APP_PASSWORD). ' +
          'Sin eso el ERP no puede enviar.',
      },
      { status: 503 }
    )
  }

  let pdf: Buffer
  try {
    pdf = construirFacturaPdf(conLineas, emisor, { reportUrl, clienteNif, clienteDireccion })
  } catch (e) {
    console.error('No se ha podido generar el PDF:', e)
    return NextResponse.json(
      { error: 'No se ha podido generar el PDF de la factura' },
      { status: 500 }
    )
  }

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: gmailUser, pass: gmailPassword },
    })

    await transporter.sendMail({
      from: `"${emisor.legal_name || 'Liberty Seller Hub'}" <${gmailUser}>`,
      to: destinatario,
      subject: asunto,
      html,
      attachments: [
        {
          filename: nombreDelFichero(conLineas),
          content: pdf,
          contentType: 'application/pdf',
        },
      ],
    })
  } catch (e) {
    return NextResponse.json(
      { error: `No ha salido el correo: ${e instanceof Error ? e.message : 'error desconocido'}` },
      { status: 502 }
    )
  }

  // ---------- Ya salió: se deja el rastro ----------
  const ahora = new Date().toISOString()
  await service
    .from('invoices')
    .update({ email_sent_at: ahora, status: 'sent', report_url: reportUrl || null })
    .eq('id', factura.id)

  // Y se marca en Tesorería, que es donde se mira si un mes está mandado. Esta
  // es la casilla «Enviado» que hasta ahora se pulsaba a mano.
  if (factura.treasury_client_id && factura.period) {
    await service
      .from('treasury_client_months')
      .update({ invoice_sent: true })
      .eq('client_id', factura.treasury_client_id)
      .eq('period', factura.period)
  }

  return NextResponse.json({ ok: true, destinatario, enviadoEl: ahora })
}
