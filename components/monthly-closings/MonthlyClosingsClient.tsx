'use client'

import { useCallback, useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { Upload, Trash2 } from 'lucide-react'

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

type MonthRowData = {
  status: 'idle' | 'processing' | 'done' | 'error'
  error?: string
  sourceFileName?: string
  result?: MonthlyClosingProcessResult
}

type MonthExcelRow = {
  monthLabel: string
  monthNumber: number
  ventasES: number
  ventasDE: number
  ventasIT: number
  ventasPT: number
  ventasFR: number
  devosES: number
  devosDE: number
  devosIT: number
  devosPT: number
  devosFR: number
  pctDevoluciones: number
  pctDiferencia: number | null
  sumaEnvios: number
  devsEnvios: number
  brutoTotal: number
  netoTotal: number
  excedente: number | null
  comisionesLS: number | null
  pagoLS: number | null
}

const MONTHS: Array<{ label: string; number: number; quarter: 'Q1' | 'Q2' | 'Q3' | 'Q4' }> = [
  { label: 'ENERO', number: 1, quarter: 'Q1' },
  { label: 'FEBRERO', number: 2, quarter: 'Q1' },
  { label: 'MARZO', number: 3, quarter: 'Q1' },
  { label: 'ABRIL', number: 4, quarter: 'Q2' },
  { label: 'MAYO', number: 5, quarter: 'Q2' },
  { label: 'JUNIO', number: 6, quarter: 'Q2' },
  { label: 'JULIO', number: 7, quarter: 'Q3' },
  { label: 'AGOSTO', number: 8, quarter: 'Q3' },
  { label: 'SEPTIEMBRE', number: 9, quarter: 'Q3' },
  { label: 'OCTUBRE', number: 10, quarter: 'Q4' },
  { label: 'NOVIEMBRE', number: 11, quarter: 'Q4' },
  { label: 'DICIEMBRE', number: 12, quarter: 'Q4' },
]

const HEADER_COLUMNS: Array<{ key: keyof MonthExcelRow | 'attach'; label: string; align?: 'left' | 'right' }> = [
  { key: 'attach', label: '' },
  { key: 'monthLabel', label: '' },
  { key: 'ventasES', label: 'VENTAS ES 🇪🇸', align: 'right' },
  { key: 'ventasDE', label: 'VENTAS DE 🇩🇪', align: 'right' },
  { key: 'ventasIT', label: 'VENTAS IT 🇮🇹', align: 'right' },
  { key: 'ventasPT', label: 'VENTAS PT 🇵🇹', align: 'right' },
  { key: 'ventasFR', label: 'VENTAS FR 🇫🇷', align: 'right' },
  { key: 'devosES', label: 'DEVOS ES 🇪🇸', align: 'right' },
  { key: 'devosDE', label: 'DEVOS DE 🇩🇪', align: 'right' },
  { key: 'devosIT', label: 'DEVOS IT 🇮🇹', align: 'right' },
  { key: 'devosPT', label: 'DEVOS PT 🇵🇹', align: 'right' },
  { key: 'devosFR', label: 'DEVOS FR 🇫🇷', align: 'right' },
  { key: 'pctDevoluciones', label: '% DEVOLUCIONES', align: 'right' },
  { key: 'pctDiferencia', label: '% Diferencia', align: 'right' },
  { key: 'sumaEnvios', label: 'SUMA ENVÍOS', align: 'right' },
  { key: 'devsEnvios', label: 'DEVS ENVÍOS', align: 'right' },
  { key: 'brutoTotal', label: 'BRUTO TOTAL', align: 'right' },
  { key: 'netoTotal', label: 'NETO TOTAL', align: 'right' },
  { key: 'excedente', label: 'Excedente', align: 'right' },
  { key: 'comisionesLS', label: 'Comisiones LS', align: 'right' },
  { key: 'pagoLS', label: 'Pago LS', align: 'right' },
]

export function MonthlyClosingsClient({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [year, setYear] = useState<string>(() => String(new Date().getFullYear()))

  const [monthData, setMonthData] = useState<Record<string, MonthRowData>>({})

  const formatMoney = (value: number) => {
    return `€${value.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  const formatPercent = (value: number | null) => {
    if (value === null || !Number.isFinite(value)) return ''
    const sign = value > 0 ? '' : ''
    return `${sign}${value.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
  }

  const getCountryAgg = (res: MonthlyClosingProcessResult | undefined, code: string) => {
    if (!res) return null
    return res.byJurisdiction.find((r) => r.jurisdiction === code) || null
  }

  const computeExcelRow = useCallback((monthLabel: string, monthNumber: number, rowYear: number): MonthExcelRow => {
    const entry = monthData[`${rowYear}-${monthNumber}`]
    const res = entry?.result

    const prevEntry = monthData[`${rowYear - 1}-${monthNumber}`]
    const prevRes = prevEntry?.result

    const es = getCountryAgg(res, 'ES')
    const de = getCountryAgg(res, 'DE')
    const it = getCountryAgg(res, 'IT')
    const pt = getCountryAgg(res, 'PT')
    const fr = getCountryAgg(res, 'FR')

    const ventasES = es?.grossProduct ?? 0
    const ventasDE = de?.grossProduct ?? 0
    const ventasIT = it?.grossProduct ?? 0
    const ventasPT = pt?.grossProduct ?? 0
    const ventasFR = fr?.grossProduct ?? 0

    const devosES = -(es?.refundsProduct ?? 0)
    const devosDE = -(de?.refundsProduct ?? 0)
    const devosIT = -(it?.refundsProduct ?? 0)
    const devosPT = -(pt?.refundsProduct ?? 0)
    const devosFR = -(fr?.refundsProduct ?? 0)

    const sumaEnvios = res?.totals.grossShipping ?? 0
    const devsEnvios = -(res?.totals.refundsShipping ?? 0)

    const brutoTotal = res?.totals.grossSales ?? 0
    const netoTotal = res?.totals.netBase ?? 0

    const pctDevoluciones = brutoTotal > 0 ? -((res?.totals.refunds ?? 0) / brutoTotal) * 100 : 0

    const prevNeto = prevRes?.totals.netBase ?? null
    const pctDiferencia = prevNeto && prevNeto !== 0 ? ((netoTotal - prevNeto) / prevNeto) * 100 : null

    return {
      monthLabel,
      monthNumber,
      ventasES,
      ventasDE,
      ventasIT,
      ventasPT,
      ventasFR,
      devosES,
      devosDE,
      devosIT,
      devosPT,
      devosFR,
      pctDevoluciones,
      pctDiferencia,
      sumaEnvios,
      devsEnvios,
      brutoTotal,
      netoTotal,
      excedente: null,
      comisionesLS: null,
      pagoLS: null,
    }
  }, [monthData])

  const handleAttachAndProcess = useCallback(
    async (monthNumber: number, rowYear: number, file: File) => {
      if (!clientId || !Number.isFinite(rowYear) || rowYear < 2000) {
        setMonthData((prev) => ({
          ...prev,
          [`${rowYear}-${monthNumber}`]: { status: 'error', error: 'Año inválido' },
        }))
        return
      }

      setMonthData((prev) => ({
        ...prev,
        [`${rowYear}-${monthNumber}`]: {
          status: 'processing',
          sourceFileName: file.name,
        },
      }))

      try {
        const formData = new FormData()
        formData.append('clientId', clientId)
        formData.append('month', String(monthNumber))
        formData.append('year', String(rowYear))
        formData.append('file', file)

        const response = await fetch('/api/monthly-closings/process', {
          method: 'POST',
          body: formData,
        })

        const data = await response.json()
        if (!response.ok) {
          throw new Error(data.error || 'Error al procesar el archivo')
        }

        setMonthData((prev) => ({
          ...prev,
          [`${rowYear}-${monthNumber}`]: {
            status: 'done',
            sourceFileName: file.name,
            result: data.data,
          },
        }))
      } catch (err: any) {
        setMonthData((prev) => ({
          ...prev,
          [`${rowYear}-${monthNumber}`]: {
            status: 'error',
            sourceFileName: file.name,
            error: err?.message || 'Error al procesar el archivo',
          },
        }))
      }
    },
    [clientId]
  )

  const handleDelete = useCallback((monthNumber: number, rowYear: number) => {
    setMonthData((prev) => {
      const next = { ...prev }
      delete next[`${rowYear}-${monthNumber}`]
      return next
    })
  }, [])

  const selectedYearNumber = useMemo(() => {
    const y = Number(year)
    return Number.isFinite(y) ? y : new Date().getFullYear()
  }, [year])

  return (
    <div className="space-y-6 w-full">
      <div>
        <h1 className="heading-medium text-white mb-2">Cuadro Mensual - {clientName}</h1>
        <p className="text-white/50">Adjunta el CSV por mes y el ERP rellenará la tabla automáticamente.</p>
      </div>

      <div className="glass-card p-4 overflow-auto w-full">
        <div className="flex items-center gap-3 mb-4">
          <div className="text-white/60 text-xs">Año</div>
          <Input value={year} onChange={(e) => setYear(e.target.value)} inputMode="numeric" className="input-glass w-32" />
          <div className="text-white/40 text-xs">Adjunta el tax report en cada fila (año/mes) para rellenar la tabla.</div>
        </div>

        <table className="min-w-[1800px] w-full text-xs">
          <thead>
            <tr className="border-b border-white/10 text-white/70">
              {HEADER_COLUMNS.map((c) => (
                <th
                  key={c.label + String(c.key)}
                  className={cn(
                    'py-2 px-2 font-semibold whitespace-nowrap',
                    c.align === 'right' ? 'text-right' : 'text-left'
                  )}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {(['Q1', 'Q2', 'Q3', 'Q4'] as const).map((q) => {
              const months = MONTHS.filter((m) => m.quarter === q)
              return (
                <>
                  <tr key={q} className="bg-white/[0.03]">
                    <td colSpan={HEADER_COLUMNS.length} className="py-2 px-2 text-white font-semibold">
                      {q}
                    </td>
                  </tr>

                  {months.flatMap((m) => {
                    const yearTop = selectedYearNumber
                    const yearBottom = selectedYearNumber - 1

                    const buildRow = (rowYear: number, rowKeySuffix: string) => {
                      const row = computeExcelRow(m.label, m.number, rowYear)
                      const state = monthData[`${rowYear}-${m.number}`]
                      const hasData = Boolean(state?.result)
                      const rowTone = hasData ? 'text-white/80' : 'text-white/40'

                      return (
                        <tr key={`${q}-${m.number}-${rowKeySuffix}`} className={cn('border-b border-white/5', rowTone)}>
                          <td className="py-2 px-2">
                            <div className="flex items-center gap-1">
                              <label
                                className={cn(
                                  'inline-flex items-center justify-center h-7 w-7 rounded-md border border-white/10 cursor-pointer',
                                  state?.status === 'processing'
                                    ? 'bg-[#FF6600]/10 border-[#FF6600]/30'
                                    : 'hover:bg-white/[0.03]'
                                )}
                                title={state?.sourceFileName ? state.sourceFileName : `Adjuntar tax report (${rowYear})`}
                              >
                                <input
                                  type="file"
                                  accept=".csv,text/csv"
                                  className="hidden"
                                  onChange={(e) => {
                                    const f = e.target.files?.[0]
                                    if (f) {
                                      handleAttachAndProcess(m.number, rowYear, f)
                                      e.currentTarget.value = ''
                                    }
                                  }}
                                />
                                <Upload
                                  className={cn(
                                    'h-4 w-4',
                                    state?.status === 'processing' ? 'text-[#FF6600]' : 'text-white/60'
                                  )}
                                />
                              </label>

                              <button
                                type="button"
                                className={cn(
                                  'inline-flex items-center justify-center h-7 w-7 rounded-md border border-white/10',
                                  hasData ? 'hover:bg-white/[0.03] cursor-pointer' : 'opacity-40 cursor-not-allowed'
                                )}
                                disabled={!hasData}
                                onClick={() => handleDelete(m.number, rowYear)}
                                title={hasData ? 'Eliminar carga' : 'Nada que eliminar'}
                              >
                                <Trash2 className="h-4 w-4 text-white/60" />
                              </button>
                            </div>
                          </td>

                          <td className="py-2 px-2 font-semibold text-white whitespace-nowrap">
                            {m.label} {rowYear}
                            {state?.status === 'processing' && (
                              <div className="text-[10px] text-white/40 font-normal">Procesando…</div>
                            )}
                            {state?.status === 'done' && state.result?.meta && (
                              <div className="text-[10px] text-white/40 font-normal">
                                {state.result.meta.rowsProcessed}/{state.result.meta.rowsTotal}
                                {state.result.meta.excludedTransactionTypes?.length
                                  ? ` | excl: ${state.result.meta.excludedTransactionTypes.join(', ')}`
                                  : ''}
                              </div>
                            )}
                            {state?.status === 'error' && (
                              <div className="text-[10px] text-red-400 font-normal">{state.error}</div>
                            )}
                          </td>

                          <td className="py-2 px-2 text-right">{row.ventasES ? formatMoney(row.ventasES) : ''}</td>
                          <td className="py-2 px-2 text-right">{row.ventasDE ? formatMoney(row.ventasDE) : ''}</td>
                          <td className="py-2 px-2 text-right">{row.ventasIT ? formatMoney(row.ventasIT) : ''}</td>
                          <td className="py-2 px-2 text-right">{row.ventasPT ? formatMoney(row.ventasPT) : ''}</td>
                          <td className="py-2 px-2 text-right">{row.ventasFR ? formatMoney(row.ventasFR) : ''}</td>

                          <td className="py-2 px-2 text-right">{row.devosES ? formatMoney(row.devosES) : ''}</td>
                          <td className="py-2 px-2 text-right">{row.devosDE ? formatMoney(row.devosDE) : ''}</td>
                          <td className="py-2 px-2 text-right">{row.devosIT ? formatMoney(row.devosIT) : ''}</td>
                          <td className="py-2 px-2 text-right">{row.devosPT ? formatMoney(row.devosPT) : ''}</td>
                          <td className="py-2 px-2 text-right">{row.devosFR ? formatMoney(row.devosFR) : ''}</td>

                          <td className="py-2 px-2 text-right">{hasData ? formatPercent(row.pctDevoluciones) : ''}</td>
                          <td className="py-2 px-2 text-right">
                            {rowYear === yearTop && row.pctDiferencia !== null ? formatPercent(row.pctDiferencia) : ''}
                          </td>

                          <td className="py-2 px-2 text-right">{row.sumaEnvios ? formatMoney(row.sumaEnvios) : ''}</td>
                          <td className="py-2 px-2 text-right">{row.devsEnvios ? formatMoney(row.devsEnvios) : ''}</td>
                          <td className="py-2 px-2 text-right">{row.brutoTotal ? formatMoney(row.brutoTotal) : ''}</td>
                          <td className="py-2 px-2 text-right">{row.netoTotal ? formatMoney(row.netoTotal) : ''}</td>

                          <td className="py-2 px-2 text-right"></td>
                          <td className="py-2 px-2 text-right"></td>
                          <td className="py-2 px-2 text-right"></td>
                        </tr>
                      )
                    }

                    return [buildRow(yearTop, 'y1'), buildRow(yearBottom, 'y0')]
                  })}
                </>
              )
            })}
          </tbody>
        </table>

        {Object.values(monthData).some((m) => m.status === 'error') && (
          <div className="mt-4 text-xs text-red-400">
            {Object.entries(monthData)
              .filter(([, v]) => v.status === 'error')
              .map(([key, v]) => {
                const [y, m] = key.split('-')
                return `Mes ${m}/${y}: ${v.error}`
              })
              .join(' | ')}
          </div>
        )}
      </div>
    </div>
  )
}
