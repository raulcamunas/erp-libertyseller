'use client'

import { useCallback, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { Upload, X } from 'lucide-react'

type JurisdictionRow = {
  jurisdiction: string
  grossProduct: number
  grossShipping: number
  refundsProduct: number
  refundsShipping: number
  grossSales: number
  refunds: number
  netBase: number
}

type MonthlyClosingProcessResult = {
  byJurisdiction: JurisdictionRow[]
  totals: JurisdictionRow
  meta: {
    month: number
    year: number
    includedTransactionTypes: string[]
    excludedTransactionTypes: string[]
    rowsProcessed: number
    rowsTotal: number
  }
}

export function MonthlyClosingsClient({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [month, setMonth] = useState<string>(() => String(new Date().getMonth() + 1))
  const [year, setYear] = useState<string>(() => String(new Date().getFullYear()))
  const [file, setFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<MonthlyClosingProcessResult | null>(null)

  const canProcess = useMemo(() => {
    const m = Number(month)
    const y = Number(year)
    return Boolean(file && clientId && m >= 1 && m <= 12 && y >= 2000)
  }, [file, clientId, month, year])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const droppedFile = e.dataTransfer.files[0]
    if (droppedFile && (droppedFile.type === 'text/csv' || droppedFile.name.endsWith('.csv'))) {
      setFile(droppedFile)
      setError(null)
    } else {
      setError('Por favor, sube un CSV válido')
    }
  }, [])

  const formatMoney = (value: number) => {
    return `€${value.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  const handleProcess = async () => {
    if (!canProcess) {
      setError('Selecciona mes, año y sube el CSV')
      return
    }

    setProcessing(true)
    setError(null)
    setResult(null)

    try {
      const formData = new FormData()
      formData.append('clientId', clientId)
      formData.append('month', month)
      formData.append('year', year)
      formData.append('file', file!)

      const response = await fetch('/api/monthly-closings/process', {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Error al procesar el archivo')
      }

      setResult(data.data)
    } catch (err: any) {
      setError(err.message || 'Error al procesar el archivo')
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="heading-medium text-white mb-2">Cuadro Mensual - {clientName}</h1>
        <p className="text-white/50">Sube el CSV del mes y revisa el desglose por país.</p>
      </div>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-white">Subir CSV mensual</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-white/60">Mes</label>
              <select
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="w-full h-9 rounded-lg border border-white/10 bg-[#0a0a0a] px-3 py-1 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#FF6600]"
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={String(m)}>
                    {String(m).padStart(2, '0')}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-white/60">Año</label>
              <Input
                value={year}
                onChange={(e) => setYear(e.target.value)}
                inputMode="numeric"
                className="input-glass"
              />
            </div>
            <div className="flex items-end">
              <Button
                onClick={handleProcess}
                disabled={!canProcess || processing}
                className="bg-[#FF6600] text-white hover:bg-[#FF6600]/90 w-full"
              >
                {processing ? 'Procesando...' : 'Procesar'}
              </Button>
            </div>
          </div>

          <div
            className={cn(
              'border-2 border-dashed rounded-xl p-6 transition-all cursor-pointer',
              isDragging ? 'border-[#FF6600] bg-[#FF6600]/10' : 'border-white/20 hover:border-white/40'
            )}
            onDragOver={(e) => {
              e.preventDefault()
              setIsDragging(true)
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => document.getElementById('monthly-closing-file-input')?.click()}
          >
            <input
              id="monthly-closing-file-input"
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) {
                  setFile(f)
                  setError(null)
                }
              }}
            />

            <div className="flex items-center justify-center gap-3 text-white/70">
              <Upload className="h-5 w-5" />
              <div>
                <div className="text-sm font-medium">Arrastra tu CSV aquí o haz click para seleccionar</div>
                <div className="text-xs text-white/50">1 archivo CSV por mes</div>
              </div>
            </div>

            {file && (
              <div className="mt-4 flex items-center justify-between bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2">
                <div className="text-sm text-white/80 truncate">{file.name}</div>
                <button
                  className="text-white/50 hover:text-white"
                  onClick={(e) => {
                    e.stopPropagation()
                    setFile(null)
                    setResult(null)
                  }}
                  title="Quitar archivo"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>

          {error && <div className="text-sm text-red-400">{error}</div>}
        </CardContent>
      </Card>

      {result && (
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-white">Desglose por país</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-xs text-white/50">
              Filas procesadas: {result.meta.rowsProcessed} / {result.meta.rowsTotal} | Incluidos: {result.meta.includedTransactionTypes.join(', ') || '—'} | Excluidos:{' '}
              {result.meta.excludedTransactionTypes.join(', ') || '—'}
            </div>

            <div className="overflow-auto">
              <table className="min-w-[900px] w-full text-sm">
                <thead>
                  <tr className="text-white/60 border-b border-white/10">
                    <th className="text-left py-2 pr-4">País</th>
                    <th className="text-right py-2 px-2">Ventas Producto</th>
                    <th className="text-right py-2 px-2">Ventas Envío</th>
                    <th className="text-right py-2 px-2">Devs Producto</th>
                    <th className="text-right py-2 px-2">Devs Envío</th>
                    <th className="text-right py-2 px-2">Ventas (Total)</th>
                    <th className="text-right py-2 px-2">Devs (Total)</th>
                    <th className="text-right py-2 pl-2">Neto</th>
                  </tr>
                </thead>
                <tbody>
                  {result.byJurisdiction.map((r) => (
                    <tr key={r.jurisdiction} className="border-b border-white/5 text-white/80">
                      <td className="py-2 pr-4 font-medium">{r.jurisdiction}</td>
                      <td className="py-2 px-2 text-right">{formatMoney(r.grossProduct)}</td>
                      <td className="py-2 px-2 text-right">{formatMoney(r.grossShipping)}</td>
                      <td className="py-2 px-2 text-right">{formatMoney(r.refundsProduct)}</td>
                      <td className="py-2 px-2 text-right">{formatMoney(r.refundsShipping)}</td>
                      <td className="py-2 px-2 text-right">{formatMoney(r.grossSales)}</td>
                      <td className="py-2 px-2 text-right">{formatMoney(r.refunds)}</td>
                      <td className="py-2 pl-2 text-right">{formatMoney(r.netBase)}</td>
                    </tr>
                  ))}

                  <tr className="border-t border-white/10 text-white font-semibold">
                    <td className="py-2 pr-4">TOTAL</td>
                    <td className="py-2 px-2 text-right">{formatMoney(result.totals.grossProduct)}</td>
                    <td className="py-2 px-2 text-right">{formatMoney(result.totals.grossShipping)}</td>
                    <td className="py-2 px-2 text-right">{formatMoney(result.totals.refundsProduct)}</td>
                    <td className="py-2 px-2 text-right">{formatMoney(result.totals.refundsShipping)}</td>
                    <td className="py-2 px-2 text-right">{formatMoney(result.totals.grossSales)}</td>
                    <td className="py-2 px-2 text-right">{formatMoney(result.totals.refunds)}</td>
                    <td className="py-2 pl-2 text-right">{formatMoney(result.totals.netBase)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
