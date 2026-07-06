import { InvoiceWithItems } from '@/lib/types/invoices'

export function buildInvoiceEmailHtml(invoice: InvoiceWithItems, reportUrl?: string): string {
  const fmt = (n: number) =>
    n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const itemRows = invoice.items
    .map(
      item => `
      <tr>
        <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;color:#333;font-size:14px;">${item.description}</td>
        <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;text-align:center;color:#666;font-size:14px;">${item.quantity}</td>
        <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;text-align:right;color:#666;font-size:14px;">€${fmt(item.unit_price)}</td>
        <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:600;color:#111;font-size:14px;">€${fmt(item.amount)}</td>
      </tr>`
    )
    .join('')

  const vatRow =
    invoice.vat_rate > 0
      ? `<tr>
          <td colspan="3" style="padding:8px 16px;text-align:right;color:#666;font-size:13px;">IVA (${(invoice.vat_rate * 100).toFixed(0)}%)</td>
          <td style="padding:8px 16px;text-align:right;color:#666;font-size:13px;">€${fmt(invoice.vat_amount)}</td>
        </tr>`
      : ''

  const reportButton = reportUrl
    ? `<a href="${reportUrl}" style="display:inline-block;background:#f5f5f5;color:#333;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:500;border:1px solid #e0e0e0;">
        📊 Ver detalle de comisiones
      </a>`
    : ''

  const paymentButton = invoice.wise_payment_link
    ? `<a href="${invoice.wise_payment_link}" style="display:inline-block;background:#00B9FF;color:#fff;padding:14px 32px;border-radius:10px;text-decoration:none;font-size:15px;font-weight:700;letter-spacing:0.3px;">
        💳 Pagar ahora — €${fmt(invoice.total)}
      </a>`
    : `<p style="color:#555;font-size:14px;">Por favor, realiza el pago por transferencia bancaria.</p>`

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#FF6600 0%,#FF4500 100%);border-radius:16px 16px 0 0;padding:36px 40px;">
            <table width="100%">
              <tr>
                <td>
                  <div style="color:#fff;font-size:22px;font-weight:800;letter-spacing:-0.5px;">Liberty Seller Hub</div>
                  <div style="color:rgba(255,255,255,0.75);font-size:13px;margin-top:2px;">Agencia Amazon</div>
                </td>
                <td align="right">
                  <div style="background:rgba(255,255,255,0.15);border-radius:10px;padding:12px 20px;display:inline-block;">
                    <div style="color:rgba(255,255,255,0.8);font-size:11px;text-transform:uppercase;letter-spacing:1px;">Factura</div>
                    <div style="color:#fff;font-size:18px;font-weight:700;">${invoice.invoice_number}</div>
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="background:#fff;padding:36px 40px;">

            <p style="margin:0 0 8px;color:#888;font-size:13px;text-transform:uppercase;letter-spacing:1px;">Para</p>
            <p style="margin:0 0 28px;color:#111;font-size:18px;font-weight:700;">${invoice.client_name}</p>

            <!-- Dates -->
            <table width="100%" style="margin-bottom:32px;">
              <tr>
                <td style="background:#fafafa;border-radius:10px;padding:14px 18px;width:48%;">
                  <div style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Fecha emisión</div>
                  <div style="color:#222;font-size:14px;font-weight:600;margin-top:4px;">${new Date(invoice.issue_date).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
                </td>
                <td width="4%"></td>
                <td style="background:#fafafa;border-radius:10px;padding:14px 18px;width:48%;">
                  <div style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Fecha límite</div>
                  <div style="color:#222;font-size:14px;font-weight:600;margin-top:4px;">${new Date(invoice.due_date).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
                </td>
              </tr>
            </table>

            <!-- Items Table -->
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #f0f0f0;border-radius:10px;overflow:hidden;margin-bottom:0;">
              <thead>
                <tr style="background:#fafafa;">
                  <th style="padding:12px 16px;text-align:left;color:#888;font-size:11px;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Concepto</th>
                  <th style="padding:12px 16px;text-align:center;color:#888;font-size:11px;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Ud.</th>
                  <th style="padding:12px 16px;text-align:right;color:#888;font-size:11px;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Precio</th>
                  <th style="padding:12px 16px;text-align:right;color:#888;font-size:11px;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Total</th>
                </tr>
              </thead>
              <tbody>${itemRows}</tbody>
              <tfoot>
                <tr style="background:#fafafa;">
                  <td colspan="3" style="padding:10px 16px;text-align:right;color:#666;font-size:13px;">Subtotal</td>
                  <td style="padding:10px 16px;text-align:right;color:#333;font-size:13px;">€${fmt(invoice.subtotal)}</td>
                </tr>
                ${vatRow}
                <tr style="background:linear-gradient(135deg,#FF6600,#FF4500);">
                  <td colspan="3" style="padding:14px 16px;text-align:right;color:rgba(255,255,255,0.9);font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">TOTAL</td>
                  <td style="padding:14px 16px;text-align:right;color:#fff;font-size:18px;font-weight:800;">€${fmt(invoice.total)}</td>
                </tr>
              </tfoot>
            </table>

            ${invoice.notes ? `<div style="margin-top:20px;padding:14px 18px;background:#fffbf5;border-left:3px solid #FF6600;border-radius:0 8px 8px 0;color:#555;font-size:13px;">${invoice.notes}</div>` : ''}

            <!-- Payment CTA -->
            <div style="margin-top:36px;text-align:center;">
              ${paymentButton}
              ${reportUrl ? `<div style="margin-top:14px;">${reportButton}</div>` : ''}
            </div>

          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f9f9f9;border-radius:0 0 16px 16px;padding:24px 40px;text-align:center;border-top:1px solid #f0f0f0;">
            <p style="margin:0;color:#aaa;font-size:12px;">Liberty Seller Hub · business@libertyseller.com</p>
            <p style="margin:6px 0 0;color:#ccc;font-size:11px;">Si tienes alguna duda sobre esta factura, responde a este email.</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
}

export function buildInvoiceEmailSubject(invoice: InvoiceWithItems): string {
  return `Factura ${invoice.invoice_number} — Liberty Seller Hub`
}
