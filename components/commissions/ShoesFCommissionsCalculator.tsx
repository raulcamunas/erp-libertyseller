'use client'

import { useCallback, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { AlertCircle, Calculator, FileText, Upload, X } from 'lucide-react'
import type { CommissionCalculationData } from '@/lib/types/commissions'

export function ShoesFCommissionsCalculator({ shoesClientId }: { shoesClientId: string }) {
  const [filePreviousYear, setFilePreviousYear] = useState<File | null>(null)
  const [fileCurrentYear, setFileCurrentYear] = useState<File | null>(null)
  const [manualRatePercent, setManualRatePercent] = useState<string>('3')
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState<CommissionCalculationData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [isDraggingPrevious, setIsDraggingPrevious] = useState(false)
  const [isDraggingCurrent, setIsDraggingCurrent] = useState(false)

  const canProcess = useMemo(() => {
    return Boolean(filePreviousYear && fileCurrentYear && shoesClientId)
  }, [filePreviousYear, fileCurrentYear, shoesClientId])

  const handleDropPrevious = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDraggingPrevious(false)
    const droppedFile = e.dataTransfer.files[0]
    if (droppedFile && (droppedFile.type === 'text/csv' || droppedFile.name.endsWith('.csv'))) {
      setFilePreviousYear(droppedFile)
      setError(null)
    } else {
      setError('Por favor, sube un CSV válido (Año Anterior)')
    }
  }, [])

  const handleDropCurrent = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDraggingCurrent(false)
    const droppedFile = e.dataTransfer.files[0]
    if (droppedFile && (droppedFile.type === 'text/csv' || droppedFile.name.endsWith('.csv'))) {
      setFileCurrentYear(droppedFile)
      setError(null)
    } else {
      setError('Por favor, sube un CSV válido (Año Actual)')
    }
  }, [])

  const handleProcess = async () => {
    if (!canProcess) {
      setError('Por favor, sube ambos CSV (año anterior y año actual)')
      return
    }

    setProcessing(true)
    setError(null)
    setResult(null)

    try {
      const formData = new FormData()
      formData.append('clientId', shoesClientId)
      formData.append('filePreviousYear', filePreviousYear!)
      formData.append('fileCurrentYear', fileCurrentYear!)
      formData.append('manualCommissionRate', manualRatePercent)

      const response = await fetch('/api/commissions/process', {
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

  const formatMoney = (value: number) => {
    return `€${value.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  const jurisdictionRows = useMemo(() => {
    const by = result?.summary?.byJurisdiction
    if (!by) return []
    return Object.values(by)
      .sort((a, b) => (b.excessAmount || 0) - (a.excessAmount || 0))
      .map((x) => ({
        jurisdiction: x.jurisdiction,
        previousYearNetBase: x.previousYearNetBase,
        currentYearNetBase: x.currentYearNetBase,
        excessAmount: x.excessAmount,
      }))
  }, [result])

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-white">Paso 1: Subir CSVs y configurar %</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm text-white/70">Año Anterior (CSV)</label>
              <div
                onDragOver={(e) => {
                  e.preventDefault()
                  setIsDraggingPrevious(true)
                }}
                onDragLeave={(e) => {
                  e.preventDefault()
                  setIsDraggingPrevious(false)
                }}
                onDrop={handleDropPrevious}
                className={cn(
                  'border-2 border-dashed rounded-xl p-6 text-center transition-all flex flex-col items-center justify-center min-h-[150px]',
                  isDraggingPrevious
                    ? 'border-[#FF6600] bg-[#FF6600]/[0.1]'
                    : 'border-white/20 bg-white/[0.02] hover:border-white/30'
                )}
              >
                {filePreviousYear ? (
                  <div className="flex flex-col items-center justify-center gap-2">
                    <FileText className="h-5 w-5 text-[#FF6600]" />
                    <span className="text-white text-sm">{filePreviousYear.name}</span>
                    <button
                      onClick={() => setFilePreviousYear(null)}
                      className="mt-2 p-1 hover:bg-white/[0.1] rounded"
                      type="button"
                    >
                      <X className="h-4 w-4 text-white/70" />
                    </button>
                  </div>
                ) : (
                  <>
                    <Upload className="h-6 w-6 text-white/50 mb-2" />
                    <p className="text-white/70 text-xs mb-2">Arrastra CSV aquí</p>
                    <label className="inline-block">
                      <span className="btn-glass cursor-pointer text-xs px-3 py-2">Seleccionar</span>
                      <input
                        type="file"
                        accept=".csv"
                        onChange={(e) => {
                          const selectedFile = e.target.files?.[0]
                          if (selectedFile) {
                            setFilePreviousYear(selectedFile)
                            setError(null)
                          }
                        }}
                        className="hidden"
                      />
                    </label>
                  </>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm text-white/70">Año Actual (CSV)</label>
              <div
                onDragOver={(e) => {
                  e.preventDefault()
                  setIsDraggingCurrent(true)
                }}
                onDragLeave={(e) => {
                  e.preventDefault()
                  setIsDraggingCurrent(false)
                }}
                onDrop={handleDropCurrent}
                className={cn(
                  'border-2 border-dashed rounded-xl p-6 text-center transition-all flex flex-col items-center justify-center min-h-[150px]',
                  isDraggingCurrent
                    ? 'border-[#FF6600] bg-[#FF6600]/[0.1]'
                    : 'border-white/20 bg-white/[0.02] hover:border-white/30'
                )}
              >
                {fileCurrentYear ? (
                  <div className="flex flex-col items-center justify-center gap-2">
                    <FileText className="h-5 w-5 text-[#FF6600]" />
                    <span className="text-white text-sm">{fileCurrentYear.name}</span>
                    <button
                      onClick={() => setFileCurrentYear(null)}
                      className="mt-2 p-1 hover:bg-white/[0.1] rounded"
                      type="button"
                    >
                      <X className="h-4 w-4 text-white/70" />
                    </button>
                  </div>
                ) : (
                  <>
                    <Upload className="h-6 w-6 text-white/50 mb-2" />
                    <p className="text-white/70 text-xs mb-2">Arrastra CSV aquí</p>
                    <label className="inline-block">
                      <span className="btn-glass cursor-pointer text-xs px-3 py-2">Seleccionar</span>
                      <input
                        type="file"
                        accept=".csv"
                        onChange={(e) => {
                          const selectedFile = e.target.files?.[0]
                          if (selectedFile) {
                            setFileCurrentYear(selectedFile)
                            setError(null)
                          }
                        }}
                        className="hidden"
                      />
                    </label>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div className="space-y-2">
              <label className="label-uppercase text-white/70 block">% Comisión manual</label>
              <Input
                value={manualRatePercent}
                onChange={(e) => setManualRatePercent(e.target.value)}
                placeholder="Ej: 3"
              />
              <div className="text-[11px] text-white/50">Se aplica sobre el excedente (Año Actual - Año Anterior).</div>
            </div>

            <div className="md:col-span-2 flex justify-center md:justify-end">
              <button
                onClick={handleProcess}
                disabled={processing || !canProcess}
                className={cn(
                  'px-8 py-4 rounded-xl font-semibold text-base transition-all duration-300',
                  'bg-white/[0.03] border-2 border-white/10 text-white',
                  'hover:bg-white/[0.05] hover:border-white/20 hover:scale-[1.02]',
                  'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:bg-white/[0.03] disabled:hover:border-white/10',
                  'gap-2 flex items-center justify-center'
                )}
                type="button"
              >
                {processing ? (
                  <>
                    <Calculator className="h-4 w-4 animate-spin" />
                    Procesando...
                  </>
                ) : (
                  <>
                    <Calculator className="h-4 w-4" />
                    Calcular
                  </>
                )}
              </button>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}
        </CardContent>
      </Card>

      {result && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-white/70">Base Neta Año Anterior</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-xl font-bold text-white/70">{formatMoney(result.summary.previousYearNetBase || 0)}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-white/70">Base Neta Año Actual</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-xl font-bold text-green-400">{formatMoney(result.summary.currentYearNetBase || 0)}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-white/70">Excedente</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-xl font-bold text-[#FF6600]">{formatMoney(result.summary.excessAmount || 0)}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-white/70">Comisión Total</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-2xl font-bold text-[#FF6600]">{formatMoney(result.summary.totalCommission || 0)}</div>
                <div className="text-xs text-white/50 mt-1">
                  Tasa usada: {(((result.summary.commissionRateUsed ?? result.summary.averageCommissionRate) || 0) * 100).toFixed(2)}%
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Desglose de cálculo */}
          <Card>
            <CardHeader>
              <CardTitle className="text-white">Desglose del cálculo (ERP)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="p-3 bg-white/[0.03] border border-white/10 rounded-lg">
                  <div className="text-white/70 text-xs mb-2">Qué se incluye / qué no se incluye</div>
                  <div className="text-white/60 text-xs mb-1">Incluye (Transaction Type):</div>
                  <pre className="text-[11px] text-white/70 whitespace-pre-wrap">
{JSON.stringify(result.summary.calculationBreakdown?.includedTransactionTypes || {}, null, 2)}
                  </pre>
                  <div className="text-white/60 text-xs mt-3 mb-1">Excluye (Transaction Type):</div>
                  <pre className="text-[11px] text-white/70 whitespace-pre-wrap">
{JSON.stringify(result.summary.calculationBreakdown?.excludedTransactionTypes || {}, null, 2)}
                  </pre>
                </div>

                <div className="p-3 bg-white/[0.03] border border-white/10 rounded-lg">
                  <div className="text-white/70 text-xs mb-2">Fórmula aplicada</div>
                  <div className="text-white/70">
                    <div>
                      <span className="text-white/50">Excedente</span> = max(0, BaseNetaActual - BaseNetaAnterior)
                    </div>
                    <div>
                      <span className="text-white/50">Comisión</span> = Excedente × Tasa
                    </div>
                  </div>
                  <div className="mt-3 text-white/70">
                    <div>
                      <span className="text-white/50">Excedente</span>: {formatMoney(result.summary.excessAmount || 0)}
                    </div>
                    <div>
                      <span className="text-white/50">Tasa</span>: {(((result.summary.commissionRateUsed ?? result.summary.averageCommissionRate) || 0) * 100).toFixed(2)}%
                    </div>
                    <div>
                      <span className="text-white/50">Comisión</span>: {formatMoney(result.summary.totalCommission || 0)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Desglose por jurisdicción */}
              <div className="p-3 bg-white/[0.03] border border-white/10 rounded-lg">
                <div className="text-white/70 text-xs mb-3">Desglose por país (Jurisdiction Name)</div>
                {jurisdictionRows.length === 0 ? (
                  <div className="text-white/50">No hay datos de jurisdiction en el CSV o no se han detectado.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-white/10">
                          <th className="text-left py-2 px-2 text-xs font-semibold text-white/70 uppercase">País</th>
                          <th className="text-right py-2 px-2 text-xs font-semibold text-white/70 uppercase">Base anterior</th>
                          <th className="text-right py-2 px-2 text-xs font-semibold text-white/70 uppercase">Base actual</th>
                          <th className="text-right py-2 px-2 text-xs font-semibold text-white/70 uppercase">Excedente</th>
                        </tr>
                      </thead>
                      <tbody>
                        {jurisdictionRows.map((r) => (
                          <tr key={r.jurisdiction} className="border-b border-white/5">
                            <td className="py-2 px-2 text-white/80">{r.jurisdiction}</td>
                            <td className="py-2 px-2 text-white/70 text-right">{formatMoney(r.previousYearNetBase || 0)}</td>
                            <td className="py-2 px-2 text-white/70 text-right">{formatMoney(r.currentYearNetBase || 0)}</td>
                            <td className="py-2 px-2 text-[#FF6600] text-right font-semibold">{formatMoney(r.excessAmount || 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
