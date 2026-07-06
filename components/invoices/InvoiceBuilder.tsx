'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, GripVertical, ArrowLeft, Save, Send, ExternalLink } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { DEFAULT_LINE_ITEMS } from '@/lib/types/invoices'
import { Client } from '@/lib/types/commissions'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'

interface LineItem {
  id: string
  description: string
  quantity: number
  unit_price: number
  sort_order: number
}

interface CommissionReport {
  id: string
  client_name: string
  period: string
  total_commission: number
}

export function InvoiceBuilder({ clients }: { clients: Client[] }) {
  const router = useRouter()
  const supabase = createClient()

  const [clientId, setClientId] = useState('')
  const [clientName, setClientName] = useState('')
  const [clientEmail, setClientEmail] = useState('')
  const [issueDate, setIssueDate] = useState(new Date().toISOString().split('T')[0])
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 30); return d.toISOString().split('T')[0]
  })
  const [vatRate, setVatRate] = useState(0)
  const [notes, setNotes] = useState('')
  const [wiseLink, setWiseLink] = useState('')
  const [reportId, setReportId] = useState('')
  const [reports, setReports] = useState<CommissionReport[]>([])
  const [saving, setSaving] = useState(false)

  const [items, setItems] = useState<LineItem[]>(
    DEFAULT_LINE_ITEMS.map((item, i) => ({
      ...item,
      id: `item-${i}`,
      sort_order: i,
    }))
  )

  // Load commission reports for selected client
  useEffect(() => {
    if (!clientId) { setReports([]); return }
    supabase
      .from('commission_reports')
      .select('id, client_name, period, total_commission')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => setReports(data || []))
  }, [clientId])

  // Populate client details when selected
  const handleClientSelect = (id: string) => {
    setClientId(id)
    const client = clients.find(c => c.id === id)
    if (client) setClientName(client.name)
  }

  const addItem = () => {
    setItems(prev => [
      ...prev,
      { id: `item-${Date.now()}`, description: '', quantity: 1, unit_price: 0, sort_order: prev.length },
    ])
  }

  const removeItem = (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id))
  }

  const updateItem = (id: string, field: keyof LineItem, value: string | number) => {
    setItems(prev =>
      prev.map(item => item.id === id ? { ...item, [field]: value } : item)
    )
  }

  const subtotal = items.reduce((s, i) => s + i.quantity * i.unit_price, 0)
  const vatAmount = subtotal * vatRate
  const total = subtotal + vatAmount

  const fmt = (n: number) =>
    n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const handleSave = async (sendAfter = false) => {
    if (!clientName.trim()) { toast.error('Añade el nombre del cliente'); return }
    if (items.every(i => !i.description.trim())) { toast.error('Añade al menos un concepto'); return }

    setSaving(true)
    try {
      const payload = {
        client_id: clientId || undefined,
        client_name: clientName,
        client_email: clientEmail || undefined,
        issue_date: issueDate,
        due_date: dueDate,
        vat_rate: vatRate,
        currency: 'EUR',
        notes: notes || undefined,
        wise_payment_link: wiseLink || undefined,
        commission_report_id: reportId || undefined,
        items: items
          .filter(i => i.description.trim())
          .map((i, idx) => ({
            description: i.description,
            quantity: i.quantity,
            unit_price: i.unit_price,
            sort_order: idx,
          })),
      }

      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      toast.success(`Factura ${data.data.invoice_number} creada`)

      // Auto-generate Wise link if client email is set
      if (payload.client_email) {
        try {
          const wiseRes = await fetch(`/api/invoices/${data.data.id}/wise-link`, { method: 'POST' })
          const wiseData = await wiseRes.json()
          if (!wiseData.error) {
            toast.success(
              wiseData.method === 'api'
                ? '✅ Factura creada también en Wise'
                : '🔗 Link de pago Wise generado'
            )
          }
        } catch {}
      }

      if (sendAfter) {
        router.push(`/dashboard/invoices/${data.data.id}?send=1`)
      } else {
        router.push(`/dashboard/invoices/${data.data.id}`)
      }
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="glass" size="sm" onClick={() => router.back()} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Volver
        </Button>
        <div>
          <h1 className="heading-medium text-white">Nueva Factura</h1>
          <p className="text-white/50 text-sm">Rellena los datos y conceptos</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Form */}
        <div className="lg:col-span-2 space-y-5">

          {/* Client */}
          <Card>
            <CardHeader><CardTitle className="text-white text-sm">Cliente</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {clients.length > 0 && (
                <div>
                  <label className="text-xs text-white/50 block mb-2">Seleccionar cliente ERP</label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {clients.map(c => (
                      <button
                        key={c.id}
                        onClick={() => handleClientSelect(c.id)}
                        className={cn(
                          'p-2.5 rounded-lg border text-left text-xs transition-all',
                          clientId === c.id
                            ? 'bg-[#FF6600]/20 border-[#FF6600] text-white'
                            : 'bg-white/[0.03] border-white/10 text-white/60 hover:border-white/20'
                        )}
                      >
                        {c.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-white/50 block mb-1">Nombre del cliente *</label>
                  <input
                    value={clientName}
                    onChange={e => setClientName(e.target.value)}
                    className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-[#FF6600]/50"
                    placeholder="Nombre empresa o persona"
                  />
                </div>
                <div>
                  <label className="text-xs text-white/50 block mb-1">Email</label>
                  <input
                    value={clientEmail}
                    onChange={e => setClientEmail(e.target.value)}
                    type="email"
                    className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-[#FF6600]/50"
                    placeholder="cliente@empresa.com"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Dates + Settings */}
          <Card>
            <CardHeader><CardTitle className="text-white text-sm">Configuración</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <label className="text-xs text-white/50 block mb-1">Fecha emisión</label>
                  <input
                    type="date"
                    value={issueDate}
                    onChange={e => setIssueDate(e.target.value)}
                    className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-[#FF6600]/50"
                  />
                </div>
                <div>
                  <label className="text-xs text-white/50 block mb-1">Vencimiento</label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={e => setDueDate(e.target.value)}
                    className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-[#FF6600]/50"
                  />
                </div>
                <div>
                  <label className="text-xs text-white/50 block mb-1">IVA</label>
                  <select
                    value={vatRate}
                    onChange={e => setVatRate(Number(e.target.value))}
                    className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-[#FF6600]/50"
                  >
                    <option value={0}>0% (sin IVA)</option>
                    <option value={0.21}>21%</option>
                    <option value={0.10}>10%</option>
                    <option value={0.04}>4%</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-white/50 block mb-1">Moneda</label>
                  <div className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2.5 text-white/60 text-sm">€ EUR</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Line Items */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-white text-sm">Conceptos</CardTitle>
                <button
                  onClick={addItem}
                  className="flex items-center gap-1.5 text-xs text-[#FF6600] hover:text-[#FF6600]/80 transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Añadir línea
                </button>
              </div>
            </CardHeader>
            <CardContent>
              {/* Header */}
              <div className="grid grid-cols-12 gap-2 mb-2 px-2">
                <div className="col-span-1" />
                <div className="col-span-5 text-xs text-white/40 uppercase tracking-wider">Concepto</div>
                <div className="col-span-2 text-xs text-white/40 uppercase tracking-wider text-center">Cant.</div>
                <div className="col-span-2 text-xs text-white/40 uppercase tracking-wider text-right">Precio</div>
                <div className="col-span-2 text-xs text-white/40 uppercase tracking-wider text-right">Total</div>
              </div>

              <div className="space-y-2">
                {items.map(item => (
                  <div key={item.id} className="grid grid-cols-12 gap-2 items-center group">
                    <div className="col-span-1 flex justify-center">
                      <GripVertical className="h-4 w-4 text-white/20 group-hover:text-white/40 cursor-grab" />
                    </div>
                    <div className="col-span-5">
                      <input
                        value={item.description}
                        onChange={e => updateItem(item.id, 'description', e.target.value)}
                        placeholder="Descripción del servicio"
                        className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#FF6600]/50 placeholder:text-white/20"
                      />
                    </div>
                    <div className="col-span-2">
                      <input
                        type="number"
                        value={item.quantity}
                        onChange={e => updateItem(item.id, 'quantity', parseFloat(e.target.value) || 0)}
                        min="0"
                        step="0.1"
                        className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-2 py-2 text-white text-sm text-center focus:outline-none focus:border-[#FF6600]/50"
                      />
                    </div>
                    <div className="col-span-2">
                      <div className="relative">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30 text-xs">€</span>
                        <input
                          type="number"
                          value={item.unit_price || ''}
                          onChange={e => updateItem(item.id, 'unit_price', parseFloat(e.target.value) || 0)}
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          className="w-full bg-white/[0.03] border border-white/10 rounded-lg pl-5 pr-2 py-2 text-white text-sm text-right focus:outline-none focus:border-[#FF6600]/50 placeholder:text-white/20"
                        />
                      </div>
                    </div>
                    <div className="col-span-2 flex items-center justify-end gap-1">
                      <span className="text-sm font-semibold text-white/80">
                        €{fmt(item.quantity * item.unit_price)}
                      </span>
                      <button
                        onClick={() => removeItem(item.id)}
                        className="ml-1 p-1 opacity-0 group-hover:opacity-100 hover:text-red-400 text-white/30 transition-all rounded"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Wise + Report */}
          <Card>
            <CardHeader><CardTitle className="text-white text-sm">Pago y Referencias</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-xs text-white/50 block mb-1">Link de pago Wise</label>
                <div className="flex gap-2">
                  <input
                    value={wiseLink}
                    onChange={e => setWiseLink(e.target.value)}
                    placeholder="https://wise.com/pay/..."
                    className="flex-1 bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-[#FF6600]/50 placeholder:text-white/20"
                  />
                  <a
                    href="https://wise.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#00B9FF]/10 border border-[#00B9FF]/30 text-[#00B9FF] text-xs hover:bg-[#00B9FF]/20 transition-colors whitespace-nowrap"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Abrir Wise
                  </a>
                </div>
                <p className="text-xs text-white/30 mt-1">Crea el cobro en Wise y pega aquí el enlace</p>
              </div>
              {reports.length > 0 && (
                <div>
                  <label className="text-xs text-white/50 block mb-1">Vincular reporte de comisiones</label>
                  <select
                    value={reportId}
                    onChange={e => setReportId(e.target.value)}
                    className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-[#FF6600]/50"
                  >
                    <option value="">Sin reporte vinculado</option>
                    {reports.map(r => (
                      <option key={r.id} value={r.id}>
                        {r.period} — €{r.total_commission?.toFixed(2)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="text-xs text-white/50 block mb-1">Notas (aparecen en el email)</label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Notas o condiciones adicionales..."
                  className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-[#FF6600]/50 placeholder:text-white/20 resize-none"
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right: Preview + Actions */}
        <div className="space-y-4">
          {/* Total preview */}
          <Card className="sticky top-6">
            <CardHeader><CardTitle className="text-white text-sm">Resumen</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                {items.filter(i => i.description && i.unit_price > 0).map(item => (
                  <div key={item.id} className="flex justify-between text-sm">
                    <span className="text-white/60 truncate max-w-[160px]">{item.description}</span>
                    <span className="text-white/80 shrink-0">€{fmt(item.quantity * item.unit_price)}</span>
                  </div>
                ))}
              </div>

              {items.some(i => i.unit_price > 0) && (
                <div className="border-t border-white/10 pt-3 space-y-1.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-white/50">Subtotal</span>
                    <span className="text-white/80">€{fmt(subtotal)}</span>
                  </div>
                  {vatRate > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-white/50">IVA ({(vatRate * 100).toFixed(0)}%)</span>
                      <span className="text-white/80">€{fmt(vatAmount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-base font-bold pt-1 border-t border-white/10">
                    <span className="text-white">TOTAL</span>
                    <span className="text-[#FF6600]">€{fmt(total)}</span>
                  </div>
                </div>
              )}

              <div className="pt-2 space-y-2">
                <button
                  onClick={() => handleSave(false)}
                  disabled={saving}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-white/[0.05] border border-white/10 text-white text-sm hover:bg-white/10 transition-all disabled:opacity-50"
                >
                  <Save className="h-4 w-4" />
                  Guardar borrador
                </button>
                <button
                  onClick={() => handleSave(true)}
                  disabled={saving}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-[#FF6600] text-white text-sm font-semibold hover:bg-[#FF6600]/90 transition-all disabled:opacity-50"
                >
                  <Send className="h-4 w-4" />
                  Guardar y enviar
                </button>
              </div>

              {clientName && (
                <div className="pt-2 border-t border-white/10">
                  <p className="text-xs text-white/30">
                    Para: <span className="text-white/60">{clientName}</span>
                  </p>
                  {clientEmail && (
                    <p className="text-xs text-white/30 mt-0.5">
                      Email: <span className="text-white/60">{clientEmail}</span>
                    </p>
                  )}
                  <p className="text-xs text-white/30 mt-0.5">
                    Vence: <span className="text-white/60">{new Date(dueDate).toLocaleDateString('es-ES')}</span>
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
