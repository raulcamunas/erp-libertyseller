'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Plus, RefreshCw, CheckCircle2, Clock, AlertTriangle, FileText,
  ExternalLink, Mail, MoreHorizontal, TrendingUp, Euro,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Invoice, INVOICE_STATUS_LABELS, INVOICE_STATUS_COLORS, InvoiceStatus } from '@/lib/types/invoices'
import { toast } from 'sonner'

const STATUS_ICONS: Record<InvoiceStatus, React.ReactNode> = {
  draft: <FileText className="h-3.5 w-3.5" />,
  sent: <Mail className="h-3.5 w-3.5" />,
  paid: <CheckCircle2 className="h-3.5 w-3.5" />,
  overdue: <AlertTriangle className="h-3.5 w-3.5" />,
  cancelled: <FileText className="h-3.5 w-3.5" />,
}

function daysOverdue(due_date: string) {
  const diff = Math.floor((Date.now() - new Date(due_date).getTime()) / 86400000)
  return diff
}

export function InvoicesDashboard() {
  const router = useRouter()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)
  const [filter, setFilter] = useState<InvoiceStatus | 'all'>('all')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/invoices')
      const { data } = await res.json()
      setInvoices(data || [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleCheckPayments = async () => {
    setChecking(true)
    try {
      const res = await fetch('/api/invoices/check-payments', { method: 'POST' })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      if (data.matched > 0) {
        toast.success(`✅ ${data.matched} factura(s) marcadas como pagadas automáticamente`)
        load()
      } else {
        toast.info(`Revisadas ${data.checked} facturas — sin nuevos pagos detectados`)
      }
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setChecking(false)
    }
  }

  const fmt = (n: number) =>
    n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  // Stats
  const stats = {
    total: invoices.reduce((s, i) => s + (i.status !== 'cancelled' ? i.total : 0), 0),
    paid: invoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.total, 0),
    pending: invoices.filter(i => ['sent', 'overdue'].includes(i.status)).reduce((s, i) => s + i.total, 0),
    overdue: invoices.filter(i => i.status === 'overdue').length,
    sent: invoices.filter(i => i.status === 'sent').length,
  }

  const filtered = filter === 'all' ? invoices : invoices.filter(i => i.status === filter)

  const statusFilters: (InvoiceStatus | 'all')[] = ['all', 'sent', 'overdue', 'paid', 'draft']

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-white/50 uppercase tracking-wider mb-1">Pendiente cobro</p>
                <p className="text-2xl font-bold text-[#FF6600]">€{fmt(stats.pending)}</p>
              </div>
              <div className="p-2 rounded-lg bg-[#FF6600]/10">
                <Clock className="h-4 w-4 text-[#FF6600]" />
              </div>
            </div>
            <p className="text-xs text-white/30 mt-1">{stats.sent} enviada(s)</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-white/50 uppercase tracking-wider mb-1">Cobrado</p>
                <p className="text-2xl font-bold text-green-400">€{fmt(stats.paid)}</p>
              </div>
              <div className="p-2 rounded-lg bg-green-400/10">
                <CheckCircle2 className="h-4 w-4 text-green-400" />
              </div>
            </div>
            <p className="text-xs text-white/30 mt-1">{invoices.filter(i => i.status === 'paid').length} factura(s)</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-white/50 uppercase tracking-wider mb-1">Vencidas</p>
                <p className={cn('text-2xl font-bold', stats.overdue > 0 ? 'text-red-400' : 'text-white/50')}>
                  {stats.overdue}
                </p>
              </div>
              <div className={cn('p-2 rounded-lg', stats.overdue > 0 ? 'bg-red-400/10' : 'bg-white/5')}>
                <AlertTriangle className={cn('h-4 w-4', stats.overdue > 0 ? 'text-red-400' : 'text-white/30')} />
              </div>
            </div>
            <p className="text-xs text-white/30 mt-1">requieren seguimiento</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-white/50 uppercase tracking-wider mb-1">Total facturado</p>
                <p className="text-2xl font-bold text-white">€{fmt(stats.total)}</p>
              </div>
              <div className="p-2 rounded-lg bg-white/5">
                <TrendingUp className="h-4 w-4 text-white/50" />
              </div>
            </div>
            <p className="text-xs text-white/30 mt-1">{invoices.filter(i => i.status !== 'cancelled').length} facturas</p>
          </CardContent>
        </Card>
      </div>

      {/* Actions + Filters */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          {statusFilters.map(s => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={cn(
                'px-3 py-1.5 rounded-full text-xs border transition-all',
                filter === s
                  ? 'bg-[#FF6600]/20 border-[#FF6600] text-white'
                  : 'bg-white/[0.03] border-white/10 text-white/50 hover:border-white/20'
              )}
            >
              {s === 'all' ? 'Todas' : INVOICE_STATUS_LABELS[s]}
              {s !== 'all' && invoices.filter(i => i.status === s).length > 0 && (
                <span className="ml-1.5 bg-white/10 rounded-full px-1.5 py-0.5 text-[10px]">
                  {invoices.filter(i => i.status === s).length}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button
            variant="glass"
            size="sm"
            onClick={handleCheckPayments}
            disabled={checking}
            className="gap-2"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', checking && 'animate-spin')} />
            {checking ? 'Revisando Wise...' : 'Verificar pagos'}
          </Button>
          <Button
            size="sm"
            onClick={() => router.push('/dashboard/invoices/new')}
            className="gap-2 bg-[#FF6600] hover:bg-[#FF6600]/90 text-white border-0"
          >
            <Plus className="h-3.5 w-3.5" />
            Nueva factura
          </Button>
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="py-16 text-center text-white/40">Cargando facturas...</div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center">
              <FileText className="h-10 w-10 text-white/20 mx-auto mb-3" />
              <p className="text-white/40">No hay facturas</p>
              <button
                onClick={() => router.push('/dashboard/invoices/new')}
                className="mt-4 text-[#FF6600] text-sm hover:underline"
              >
                Crear primera factura
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left py-3 px-4 text-xs text-white/40 font-medium uppercase tracking-wider">Factura</th>
                    <th className="text-left py-3 px-4 text-xs text-white/40 font-medium uppercase tracking-wider">Cliente</th>
                    <th className="text-left py-3 px-4 text-xs text-white/40 font-medium uppercase tracking-wider">Emisión</th>
                    <th className="text-left py-3 px-4 text-xs text-white/40 font-medium uppercase tracking-wider">Vencimiento</th>
                    <th className="text-right py-3 px-4 text-xs text-white/40 font-medium uppercase tracking-wider">Total</th>
                    <th className="text-center py-3 px-4 text-xs text-white/40 font-medium uppercase tracking-wider">Estado</th>
                    <th className="py-3 px-4" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(invoice => {
                    const overdueDays = invoice.status === 'overdue' ? daysOverdue(invoice.due_date) : 0
                    return (
                      <tr
                        key={invoice.id}
                        onClick={() => router.push(`/dashboard/invoices/${invoice.id}`)}
                        className="border-b border-white/5 hover:bg-white/[0.02] cursor-pointer transition-colors"
                      >
                        <td className="py-3.5 px-4">
                          <span className="font-mono text-white/80 text-xs">{invoice.invoice_number}</span>
                        </td>
                        <td className="py-3.5 px-4">
                          <span className="text-white font-medium">{invoice.client_name}</span>
                          {invoice.client_email && (
                            <div className="text-xs text-white/40">{invoice.client_email}</div>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-white/60">
                          {new Date(invoice.issue_date).toLocaleDateString('es-ES')}
                        </td>
                        <td className="py-3.5 px-4">
                          <span className={cn(
                            'text-sm',
                            invoice.status === 'overdue' ? 'text-red-400 font-medium' : 'text-white/60'
                          )}>
                            {new Date(invoice.due_date).toLocaleDateString('es-ES')}
                          </span>
                          {overdueDays > 0 && (
                            <div className="text-xs text-red-400/70">{overdueDays}d de retraso</div>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <span className="font-bold text-white">
                            €{invoice.total.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          <span className={cn(
                            'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium',
                            INVOICE_STATUS_COLORS[invoice.status]
                          )}>
                            {STATUS_ICONS[invoice.status]}
                            {INVOICE_STATUS_LABELS[invoice.status]}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-right" onClick={e => e.stopPropagation()}>
                          {invoice.wise_payment_link && (
                            <a
                              href={invoice.wise_payment_link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1.5 text-[#00B9FF]/60 hover:text-[#00B9FF] transition-colors inline-block"
                              title="Abrir link de pago"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
