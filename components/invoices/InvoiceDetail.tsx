'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Send, CheckCircle2, ExternalLink, Mail, Download,
  Clock, AlertTriangle, FileText, Copy, Check, RefreshCw, Pencil,
  Euro, Calendar,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { InvoiceWithItems, INVOICE_STATUS_LABELS, INVOICE_STATUS_COLORS } from '@/lib/types/invoices'
import { toast } from 'sonner'
import { buildInvoiceEmailHtml } from '@/lib/email-templates/invoice'

function daysOverdue(due_date: string) {
  return Math.floor((Date.now() - new Date(due_date).getTime()) / 86400000)
}

export function InvoiceDetail({ invoiceId, autoSend }: { invoiceId: string; autoSend?: boolean }) {
  const router = useRouter()
  const [invoice, setInvoice] = useState<InvoiceWithItems | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [markingPaid, setMarkingPaid] = useState(false)
  const [showEmailPreview, setShowEmailPreview] = useState(false)
  const [showMarkPaid, setShowMarkPaid] = useState(false)
  const [paidAmount, setPaidAmount] = useState('')
  const [bankRef, setBankRef] = useState('')
  const [copied, setCopied] = useState(false)
  const [reportUrl, setReportUrl] = useState('')

  const load = async () => {
    const res = await fetch(`/api/invoices/${invoiceId}`)
    const { data } = await res.json()
    setInvoice(data)
    setLoading(false)
    if (data) setPaidAmount(String(data.total))
  }

  useEffect(() => {
    load()
  }, [invoiceId])

  useEffect(() => {
    if (autoSend && invoice && !invoice.email_sent_at) {
      setShowEmailPreview(true)
    }
  }, [autoSend, invoice])

  if (loading) return <div className="py-16 text-center text-white/40">Cargando factura...</div>
  if (!invoice) return <div className="py-16 text-center text-white/40">Factura no encontrada</div>

  const fmt = (n: number) =>
    n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const overdueDays = invoice.status === 'overdue' ? daysOverdue(invoice.due_date) : 0
  const emailHtml = buildInvoiceEmailHtml(invoice, reportUrl || undefined)

  const handleSendEmail = async () => {
    if (!invoice.client_email && !window.confirm('No hay email configurado. ¿Continuar de todas formas?')) return
    setSending(true)
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report_url: reportUrl || undefined }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)

      if (data.manual) {
        // No SMTP configured – copy HTML approach
        toast.info('SMTP no configurado. Copia el HTML del email de abajo.', { duration: 5000 })
      } else {
        toast.success(`Email enviado a ${data.recipient}`)
        load()
      }
      setShowEmailPreview(false)
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSending(false)
    }
  }

  const handleMarkPaid = async () => {
    setMarkingPaid(true)
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/mark-paid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paid_amount: parseFloat(paidAmount) || invoice.total,
          bank_reference: bankRef || undefined,
        }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      toast.success('Factura marcada como pagada')
      setShowMarkPaid(false)
      load()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setMarkingPaid(false)
    }
  }

  const copyPaymentLink = () => {
    if (!invoice.wise_payment_link) return
    navigator.clipboard.writeText(invoice.wise_payment_link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDownloadPDF = () => {
    // Simple HTML print to PDF
    const win = window.open('', '_blank')
    if (!win) return
    win.document.write(emailHtml)
    win.document.close()
    win.print()
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Button variant="glass" size="sm" onClick={() => router.push('/dashboard/invoices')} className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Facturas
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="heading-medium text-white">{invoice.invoice_number}</h1>
              <span className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium',
                INVOICE_STATUS_COLORS[invoice.status]
              )}>
                {INVOICE_STATUS_LABELS[invoice.status]}
              </span>
              {overdueDays > 0 && (
                <span className="text-xs text-red-400 bg-red-400/10 px-2 py-0.5 rounded-full">
                  {overdueDays}d de retraso
                </span>
              )}
            </div>
            <p className="text-white/50 text-sm mt-0.5">{invoice.client_name}</p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="glass" size="sm" onClick={handleDownloadPDF} className="gap-2">
            <Download className="h-4 w-4" />
            PDF
          </Button>
          {invoice.status !== 'paid' && invoice.status !== 'cancelled' && (
            <>
              <Button variant="glass" size="sm" onClick={() => setShowEmailPreview(!showEmailPreview)} className="gap-2">
                <Mail className="h-4 w-4" />
                {invoice.email_sent_at ? 'Reenviar' : 'Enviar'}
              </Button>
              <button
                onClick={() => setShowMarkPaid(true)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 text-sm hover:bg-green-500/20 transition-all"
              >
                <CheckCircle2 className="h-4 w-4" />
                Marcar pagada
              </button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main: Invoice preview */}
        <div className="lg:col-span-2 space-y-5">

          {/* Invoice document */}
          <Card>
            <CardContent className="p-8">
              {/* Invoice Header */}
              <div className="flex items-start justify-between mb-8">
                <div>
                  <h2 className="text-xl font-bold text-white">Liberty Seller Hub</h2>
                  <p className="text-white/40 text-sm mt-0.5">Agencia Amazon</p>
                  <p className="text-white/40 text-sm">business@libertyseller.com</p>
                </div>
                <div className="text-right">
                  <div className="text-xs text-white/40 uppercase tracking-wider mb-1">Factura N.º</div>
                  <div className="text-2xl font-bold text-[#FF6600]">{invoice.invoice_number}</div>
                </div>
              </div>

              {/* Client + Dates */}
              <div className="grid grid-cols-2 gap-6 mb-8">
                <div>
                  <div className="text-xs text-white/40 uppercase tracking-wider mb-2">Para</div>
                  <div className="text-white font-semibold">{invoice.client_name}</div>
                  {invoice.client_email && (
                    <div className="text-white/50 text-sm">{invoice.client_email}</div>
                  )}
                </div>
                <div className="space-y-2 text-right">
                  <div>
                    <div className="text-xs text-white/40 uppercase tracking-wider">Emisión</div>
                    <div className="text-white text-sm">{new Date(invoice.issue_date).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
                  </div>
                  <div>
                    <div className="text-xs text-white/40 uppercase tracking-wider">Vencimiento</div>
                    <div className={cn('text-sm', invoice.status === 'overdue' ? 'text-red-400 font-semibold' : 'text-white')}>
                      {new Date(invoice.due_date).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })}
                    </div>
                  </div>
                </div>
              </div>

              {/* Items */}
              <table className="w-full text-sm mb-6">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left py-3 text-xs text-white/40 uppercase tracking-wider font-medium">Concepto</th>
                    <th className="text-center py-3 text-xs text-white/40 uppercase tracking-wider font-medium w-16">Ud.</th>
                    <th className="text-right py-3 text-xs text-white/40 uppercase tracking-wider font-medium w-28">Precio</th>
                    <th className="text-right py-3 text-xs text-white/40 uppercase tracking-wider font-medium w-28">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.items?.map(item => (
                    <tr key={item.id} className="border-b border-white/5">
                      <td className="py-3.5 text-white">{item.description}</td>
                      <td className="py-3.5 text-white/60 text-center">{item.quantity}</td>
                      <td className="py-3.5 text-white/60 text-right">€{fmt(item.unit_price)}</td>
                      <td className="py-3.5 text-white font-semibold text-right">€{fmt(item.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-white/10">
                    <td colSpan={3} className="py-3 text-right text-white/50 text-sm">Subtotal</td>
                    <td className="py-3 text-right text-white/80">€{fmt(invoice.subtotal)}</td>
                  </tr>
                  {invoice.vat_rate > 0 && (
                    <tr>
                      <td colSpan={3} className="py-2 text-right text-white/50 text-sm">
                        IVA ({(invoice.vat_rate * 100).toFixed(0)}%)
                      </td>
                      <td className="py-2 text-right text-white/80">€{fmt(invoice.vat_amount)}</td>
                    </tr>
                  )}
                  <tr className="border-t-2 border-[#FF6600]/30">
                    <td colSpan={3} className="py-4 text-right font-bold text-white uppercase tracking-wider text-sm">Total</td>
                    <td className="py-4 text-right font-bold text-[#FF6600] text-xl">€{fmt(invoice.total)}</td>
                  </tr>
                </tfoot>
              </table>

              {invoice.notes && (
                <div className="p-4 bg-white/[0.03] border-l-2 border-[#FF6600]/40 rounded-r-lg text-white/60 text-sm">
                  {invoice.notes}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Email Compose */}
          {showEmailPreview && (
            <Card className="border-[#FF6600]/30">
              <CardHeader>
                <CardTitle className="text-white text-sm flex items-center gap-2">
                  <Mail className="h-4 w-4 text-[#FF6600]" />
                  Enviar factura por email
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-white/40 block mb-1">Para</label>
                    <div className="px-3 py-2 bg-white/[0.03] border border-white/10 rounded-lg text-white/70 text-sm">
                      {invoice.client_email || <span className="text-red-400/70">Sin email configurado</span>}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-white/40 block mb-1">Link reporte comisiones (opcional)</label>
                    <input
                      value={reportUrl}
                      onChange={e => setReportUrl(e.target.value)}
                      placeholder="https://app.libertyseller.com/..."
                      className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#FF6600]/50 placeholder:text-white/20"
                    />
                  </div>
                </div>

                {/* Email preview iframe */}
                <div>
                  <label className="text-xs text-white/40 block mb-2">Previsualización del email</label>
                  <div className="rounded-xl overflow-hidden border border-white/10" style={{ height: 420 }}>
                    <iframe
                      srcDoc={emailHtml}
                      className="w-full h-full bg-white"
                      title="Email preview"
                    />
                  </div>
                </div>

                <div className="flex gap-3 justify-end">
                  <Button variant="glass" size="sm" onClick={() => setShowEmailPreview(false)}>
                    Cancelar
                  </Button>
                  <button
                    onClick={handleSendEmail}
                    disabled={sending}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#FF6600] text-white text-sm font-semibold hover:bg-[#FF6600]/90 transition-all disabled:opacity-50"
                  >
                    <Send className="h-4 w-4" />
                    {sending ? 'Enviando...' : `Enviar a ${invoice.client_email || invoice.client_name}`}
                  </button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Payment link */}
          {invoice.wise_payment_link && (
            <Card>
              <CardHeader>
                <CardTitle className="text-white text-sm flex items-center gap-2">
                  <span className="text-[#00B9FF]">💳</span>
                  Link de pago Wise
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2">
                  <div className="flex-1 px-3 py-2 bg-white/[0.03] border border-white/10 rounded-lg text-white/50 text-xs font-mono truncate">
                    {invoice.wise_payment_link}
                  </div>
                  <button
                    onClick={copyPaymentLink}
                    className="p-2 rounded-lg bg-white/[0.05] border border-white/10 text-white/50 hover:text-white transition-colors"
                  >
                    {copied ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
                <a
                  href={invoice.wise_payment_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-[#00B9FF]/10 border border-[#00B9FF]/30 text-[#00B9FF] text-sm font-medium hover:bg-[#00B9FF]/20 transition-all"
                >
                  <ExternalLink className="h-4 w-4" />
                  Abrir en Wise
                </a>
              </CardContent>
            </Card>
          )}

          {/* Timeline */}
          <Card>
            <CardHeader>
              <CardTitle className="text-white text-sm">Historial</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <TimelineItem
                  icon={<FileText className="h-3.5 w-3.5" />}
                  label="Creada"
                  date={invoice.created_at}
                  active
                />
                <TimelineItem
                  icon={<Mail className="h-3.5 w-3.5" />}
                  label="Email enviado"
                  date={invoice.email_sent_at}
                />
                <TimelineItem
                  icon={<Calendar className="h-3.5 w-3.5" />}
                  label="Vence"
                  date={invoice.due_date + 'T23:59:00'}
                  warn={invoice.status === 'overdue'}
                />
                <TimelineItem
                  icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                  label="Pagada"
                  date={invoice.paid_at}
                  success
                  extra={invoice.paid_amount ? `€${fmt(invoice.paid_amount)}` : undefined}
                />
              </div>
            </CardContent>
          </Card>

          {/* Mark paid form */}
          {showMarkPaid && (
            <Card className="border-green-500/30">
              <CardHeader>
                <CardTitle className="text-white text-sm">Confirmar pago</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <label className="text-xs text-white/40 block mb-1">Importe recibido</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 text-sm">€</span>
                    <input
                      type="number"
                      value={paidAmount}
                      onChange={e => setPaidAmount(e.target.value)}
                      className="w-full bg-white/[0.05] border border-white/10 rounded-lg pl-7 pr-3 py-2.5 text-white text-sm focus:outline-none focus:border-green-500/50"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-white/40 block mb-1">Referencia bancaria (opcional)</label>
                  <input
                    value={bankRef}
                    onChange={e => setBankRef(e.target.value)}
                    placeholder="Ej: TXN-ABC123"
                    className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-green-500/50 placeholder:text-white/20"
                  />
                </div>
                <div className="flex gap-2 pt-1">
                  <Button variant="glass" size="sm" className="flex-1" onClick={() => setShowMarkPaid(false)}>
                    Cancelar
                  </Button>
                  <button
                    onClick={handleMarkPaid}
                    disabled={markingPaid}
                    className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-green-500/20 border border-green-500/40 text-green-400 text-sm font-medium hover:bg-green-500/30 transition-all disabled:opacity-50"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Confirmar
                  </button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Last wise check */}
          {invoice.last_wise_check && (
            <div className="text-xs text-white/30 text-center">
              Última verificación Wise: {new Date(invoice.last_wise_check).toLocaleString('es-ES')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function TimelineItem({
  icon, label, date, active, success, warn, extra,
}: {
  icon: React.ReactNode
  label: string
  date: string | null
  active?: boolean
  success?: boolean
  warn?: boolean
  extra?: string
}) {
  const color = success && date
    ? 'text-green-400 bg-green-400/10'
    : warn
    ? 'text-red-400 bg-red-400/10'
    : date
    ? 'text-white/70 bg-white/10'
    : 'text-white/20 bg-white/5'

  return (
    <div className="flex items-center gap-3">
      <div className={cn('w-7 h-7 rounded-full flex items-center justify-center shrink-0', color)}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className={cn('text-sm font-medium', date ? 'text-white' : 'text-white/30')}>{label}</div>
        {date ? (
          <div className="text-xs text-white/40">
            {new Date(date).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}
            {extra && <span className="ml-2 text-green-400 font-semibold">{extra}</span>}
          </div>
        ) : (
          <div className="text-xs text-white/20">Pendiente</div>
        )}
      </div>
    </div>
  )
}
