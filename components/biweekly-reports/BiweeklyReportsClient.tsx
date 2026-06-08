'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { Line, Scatter } from 'react-chartjs-2'
import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  ScatterController,
  Title,
  Tooltip,
} from 'chart.js'
import { CheckCircle2, Download, Euro, FileUp, Megaphone, TrendingDown, TrendingUp, Wallet } from 'lucide-react'
import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'
import Papa from 'papaparse'
import { getVal, parseEuroNumber, parseCSV } from '@/lib/utils/csv-parser'
import { cn } from '@/lib/utils'
import { StrategicInsights } from '@/components/biweekly-reports/StrategicInsights'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler, ScatterController)

type UploadState = {
  file?: File
  rows?: Array<Record<string, any>>
  error?: string
}

type DailyMixPoint = {
  date: string
  organicSales: number
  ppcSales: number
}

type DailyPerfPoint = {
  date: string
  netProfit: number
  adSpend: number
}

type TopProductRow = {
  sku: string
  title: string
  profit: number
  units: number
  sessions: number
  conversionRate: number
}

type ProcessedReport = {
  totals: {
    totalSales: number
    netProfit: number
    avgMarginPct: number
  }
  ads: {
    roas: number
    tacosPct: number
  }
  dailyMix: DailyMixPoint[]
  topProducts: TopProductRow[]
  insights: string[]
}

const money = (v: number) => `${v.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
const pct = (v: number) => `${v.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`

const normalizeDay = (raw: any) => {
  const s = String(raw || '').replace(/"/g, '').trim()
  if (!s) return ''

  // Sellerboard suele venir como dd/mm/yyyy
  const dm = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (dm) {
    const dd = String(dm[1]).padStart(2, '0')
    const mm = String(dm[2]).padStart(2, '0')
    const yyyy = dm[3]
    return `${yyyy}-${mm}-${dd}`
  }

  const ms = Date.parse(s)
  if (Number.isFinite(ms)) {
    const d = new Date(ms)
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}`
  }

  return s
}

const sumBy = (rows: Array<Record<string, any>>, colNames: Array<string | RegExp>) => {
  return rows.reduce((acc, r) => acc + parseEuroNumber(getVal(r, colNames)), 0)
}

const sanitizeEuro = (v: any) => String(v || '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim()

const parseAdvertisingCSV = (text: string) => {
  const res = Papa.parse<Record<string, any>>(text, {
    header: true,
    delimiter: ';',
    skipEmptyLines: true,
    transformHeader: (h, idx) => {
      const hh = String(h || '').replace(/"/g, '').trim()
      return hh || `col_${idx}`
    },
  })

  if (res.errors?.length) {
    throw new Error(res.errors[0]?.message || 'Error parseando Advertising CSV')
  }

  return (res.data || []).map((row) => {
    const next: Record<string, any> = {}
    for (const [k, v] of Object.entries(row || {})) {
      next[k] = sanitizeEuro(v)
    }
    return next
  })
}

const avgBy = (rows: Array<Record<string, any>>, colNames: Array<string | RegExp>) => {
  const vals = rows
    .map((r) => parseEuroNumber(getVal(r, colNames)))
    .filter((n) => Number.isFinite(n) && n !== 0)
  if (!vals.length) return 0
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

const detectTotals = (rows: Array<Record<string, any>>) => {
  const totalSales =
    sumBy(rows, ['Sales', 'Total Sales', /total\s*sales/i, /ventas\s*totales/i]) ||
    sumBy(rows, ['SalesOrganic', /sales\s*organic/i]) + sumBy(rows, ['SalesPPC', /sales\s*ppc/i])

  const netProfit = sumBy(rows, ['NetProfit', 'Net profit', /net\s*profit/i, /beneficio\s*neto/i])

  const avgMarginPct = avgBy(rows, ['Margin', /margin/i, /margen/i])

  return { totalSales, netProfit, avgMarginPct }
}

const detectDailyMix = (rows: Array<Record<string, any>>) => {
  const points: DailyMixPoint[] = []
  for (const r of rows) {
    const date = normalizeDay(getVal(r, ['Date', 'Day', /date/i, /day/i]))
    if (!date) continue

    const organicSales = parseEuroNumber(getVal(r, ['SalesOrganic', 'Organic Sales', /organic.*sales/i]))
    const ppcSales = parseEuroNumber(getVal(r, ['SalesPPC', 'PPC Sales', 'Ads Sales', /ppc.*sales/i, /ads.*sales/i]))

    if (organicSales === 0 && ppcSales === 0) continue

    points.push({ date, organicSales, ppcSales })
  }
  return points.sort((a, b) => a.date.localeCompare(b.date))
}

const detectDailyNetProfit = (rows: Array<Record<string, any>>) => {
  const map = new Map<string, number>()
  for (const r of rows) {
    const date = normalizeDay(getVal(r, ['Date', 'Day', /date/i, /day/i]))
    if (!date) continue
    const v = parseEuroNumber(getVal(r, ['NetProfit', 'Net profit', /net\s*profit/i, /beneficio\s*neto/i]))
    if (!Number.isFinite(v) || v === 0) continue
    map.set(date, (map.get(date) || 0) + v)
  }
  return map
}

const detectDailyAdSpend = (rows: Array<Record<string, any>>) => {
  const map = new Map<string, number>()
  for (const r of rows) {
    const date = normalizeDay(getVal(r, ['Date', 'Day', /date/i, /day/i]))
    if (!date) continue
    const v = parseEuroNumber(getVal(r, ['Spend', /spend/i, /cost/i, /gasto/i, /ad\s*spent/i]))
    if (!Number.isFinite(v) || v === 0) continue
    map.set(date, (map.get(date) || 0) + v)
  }
  return map
}

const detectTopProducts = (rows: Array<Record<string, any>>) => {
  const products: TopProductRow[] = []

  for (const r of rows) {
    const profit = parseEuroNumber(getVal(r, ['NetProfit', 'Net profit', /net\s*profit/i, 'Profit', /profit/i]))
    const sessions = parseEuroNumber(getVal(r, ['Sessions', /sessions/i, /sesiones/i]))
    const unitsOrganic = parseEuroNumber(getVal(r, ['UnitsOrganic', /units\s*organic/i]))
    const unitsPpc = parseEuroNumber(getVal(r, ['UnitsPPC', /units\s*ppc/i]))
    const unitsSp = parseEuroNumber(getVal(r, ['UnitsSponsoredProducts', /units\s*sponsored\s*products/i]))
    const unitsSd = parseEuroNumber(getVal(r, ['UnitsSponsoredDisplay', /units\s*sponsored\s*display/i]))
    const units = unitsOrganic + unitsPpc + unitsSp + unitsSd

    const sku = String(getVal(r, ['SKU', /sku/i, 'Child ASIN', /asin/i]) || '').trim()
    const title = String(getVal(r, ['Title', /title/i, 'Product', /product/i, 'Name', /name/i]) || '').trim()

    if (!sku && !title) continue
    if (!Number.isFinite(profit) || profit === 0) continue

    const conversionRate = sessions > 0 ? (units / sessions) * 100 : 0

    products.push({
      sku: sku || '-',
      title: title || '-',
      profit,
      units,
      sessions,
      conversionRate,
    })
  }

  products.sort((a, b) => b.profit - a.profit)
  return products.slice(0, 5)
}

const detectAds = (rows: Array<Record<string, any>>, totalsSalesFallback: number) => {
  // Intentar calcular por spend/sales si existen
  const adsSales = sumBy(rows, ['Sales', 'Attributed Sales', /attributed.*sales/i, /ads.*sales/i])
  const spend = sumBy(rows, ['Spend', /spend/i, /cost/i, /gasto/i])

  const roasDirect = avgBy(rows, ['ROAS', /roas/i])

  const roas = roasDirect > 0 ? roasDirect : spend > 0 ? adsSales / spend : 0

  const totalSales = totalsSalesFallback || sumBy(rows, ['Total Sales', /total\s*sales/i])
  const tacosDirect = avgBy(rows, ['TACOS', /tacos/i])
  const tacosPct = tacosDirect > 0 ? tacosDirect * 100 : totalSales > 0 ? (spend / totalSales) * 100 : 0

  return { roas, tacosPct }
}

const buildInsights = (report: ProcessedReport) => {
  const insights: string[] = []

  const best = report.topProducts[0]
  if (best) {
    insights.push(`Tu producto ${best.sku} es el más rentable en el periodo.`)
  }

  if (report.ads.tacosPct > 0) {
    insights.push(`Tu TACOS global del periodo es ${pct(report.ads.tacosPct)}.`)
  }

  const mix = report.dailyMix
  if (mix.length >= 2) {
    const start = mix[0]
    const end = mix[mix.length - 1]
    const startT = start.organicSales + start.ppcSales
    const endT = end.organicSales + end.ppcSales
    if (startT > 0) {
      const diffPct = ((endT - startT) / startT) * 100
      insights.push(`Tus ventas del final del periodo están ${pct(diffPct)} vs el inicio.`)
    }
  }

  while (insights.length < 3) insights.push('')
  return insights.slice(0, 3)
}

export function BiweeklyReportsClient({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [totalsState, setTotalsState] = useState<UploadState>({})
  const [goodsState, setGoodsState] = useState<UploadState>({})
  const [adsState, setAdsState] = useState<UploadState>({})

  const [completedTasksText, setCompletedTasksText] = useState<string>('')
  const [nextWeekFocusText, setNextWeekFocusText] = useState<string>('')

  const [processingError, setProcessingError] = useState<string | null>(null)

  const reportRef = useRef<HTMLDivElement | null>(null)

  const allReady = Boolean(totalsState.rows && goodsState.rows && adsState.rows)

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    setProcessingError(null)

    for (const file of acceptedFiles) {
      const name = file.name.toLowerCase()
      const text = await file.text()
      const rows = name.includes('sellerboardadvertising') ? parseAdvertisingCSV(text) : parseCSV(text)

      if (name.includes('dashboardtotals') || name.includes('sellerboarddashboardtotals')) {
        setTotalsState({ file, rows })
        continue
      }
      if (name.includes('dashboardgoods') || name.includes('sellerboarddashboardgoods')) {
        setGoodsState({ file, rows })
        continue
      }
      if (name.includes('advertising') || name.includes('performance') || name.includes('sellerboardadvertising')) {
        setAdsState({ file, rows })
        continue
      }

      // fallback: intentar detectar por columnas
      const headers = Object.keys(rows[0] || {}).join(' | ').toLowerCase()
      if (headers.includes('net profit') || headers.includes('margen') || headers.includes('total sales')) {
        setTotalsState({ file, rows })
      } else if (headers.includes('sessions') && headers.includes('units')) {
        setGoodsState({ file, rows })
      } else if (headers.includes('roas') || headers.includes('spend')) {
        setAdsState({ file, rows })
      }
    }
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: true,
    accept: { 'text/csv': ['.csv'] },
  })

  const processed: ProcessedReport | null = useMemo(() => {
    if (!allReady) return null

    try {
      const totals = detectTotals(totalsState.rows || [])
      const dailyMix = detectDailyMix(totalsState.rows || [])
      const topProducts = detectTopProducts(goodsState.rows || [])
      const ads = detectAds(adsState.rows || [], totals.totalSales)

      const report: ProcessedReport = {
        totals,
        ads,
        dailyMix,
        topProducts,
        insights: [],
      }

      report.insights = buildInsights(report)
      return report
    } catch (e: any) {
      setProcessingError(e?.message || 'Error procesando los CSV')
      return null
    }
  }, [allReady, totalsState.rows, goodsState.rows, adsState.rows])

  const reportPeriodLabel = useMemo(() => {
    if (!processed?.dailyMix?.length) return ''
    const start = processed.dailyMix[0]?.date
    const end = processed.dailyMix[processed.dailyMix.length - 1]?.date
    if (!start || !end) return ''

    const toES = (iso: string) => {
      const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/)
      if (!m) return iso
      return `${m[3]}/${m[2]}/${m[1]}`
    }

    return `Periodo del Informe: ${toES(start)} al ${toES(end)}`
  }, [processed])

  const completedTasksList = useMemo(() => {
    return completedTasksText
      .split(/\r?\n/g)
      .map((s) => s.trim())
      .filter(Boolean)
  }, [completedTasksText])

  const dailyPerf: DailyPerfPoint[] = useMemo(() => {
    if (!processed) return []
    const profitByDay = detectDailyNetProfit(totalsState.rows || [])
    const spendByDay = detectDailyAdSpend(adsState.rows || [])

    const out: DailyPerfPoint[] = []
    for (const [date, netProfit] of profitByDay.entries()) {
      const adSpend = spendByDay.get(date) || 0
      if (adSpend === 0) continue
      out.push({ date, netProfit, adSpend })
    }
    out.sort((a, b) => a.date.localeCompare(b.date))
    return out
  }, [processed, totalsState.rows, adsState.rows])

  const kpiTrends = useMemo(() => {
    if (!processed) return null
    const mix = processed.dailyMix
    const totalsDaily = mix.map((p) => p.organicSales + p.ppcSales).filter((n) => Number.isFinite(n) && n > 0)
    const meanSales = totalsDaily.length ? totalsDaily.reduce((a, b) => a + b, 0) / totalsDaily.length : 0
    const lastSales = totalsDaily.length ? totalsDaily[totalsDaily.length - 1] : 0

    const profitByDay = Array.from(detectDailyNetProfit(totalsState.rows || []).values()).filter(
      (n) => Number.isFinite(n) && n !== 0
    )
    const meanProfit = profitByDay.length ? profitByDay.reduce((a, b) => a + b, 0) / profitByDay.length : 0
    const lastProfit = profitByDay.length ? profitByDay[profitByDay.length - 1] : 0

    const trend = (value: number, mean: number) => {
      if (!Number.isFinite(value) || !Number.isFinite(mean) || mean === 0) return null
      const diffPct = ((value - mean) / mean) * 100
      return { diffPct }
    }

    return {
      sales: trend(lastSales, meanSales),
      profit: trend(lastProfit, meanProfit),
    }
  }, [processed, totalsState.rows])

  const chartData = useMemo(() => {
    if (!processed) return null

    return {
      labels: processed.dailyMix.map((p) => p.date),
      datasets: [
        {
          label: 'Ventas Orgánicas',
          data: processed.dailyMix.map((p) => p.organicSales),
          borderColor: 'rgba(16, 185, 129, 0.95)',
          backgroundColor: 'rgba(16, 185, 129, 0.22)',
          fill: true,
          tension: 0.25,
          pointRadius: 0,
          stack: 'sales',
        },
        {
          label: 'Ventas PPC',
          data: processed.dailyMix.map((p) => p.ppcSales),
          borderColor: 'rgba(139, 92, 246, 0.95)',
          backgroundColor: (ctx: any) => {
            const chart = ctx?.chart
            const { ctx: c, chartArea } = chart || {}
            if (!c || !chartArea) return 'rgba(139, 92, 246, 0.18)'
            const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom)
            g.addColorStop(0, 'rgba(139, 92, 246, 0.35)')
            g.addColorStop(1, 'rgba(139, 92, 246, 0.10)')
            return g
          },
          fill: true,
          tension: 0.25,
          pointRadius: 0,
          stack: 'sales',
        },
      ],
    }
  }, [processed])

  const scatterData = useMemo(() => {
    if (!dailyPerf.length) return null
    return {
      datasets: [
        {
          label: 'Gasto vs Beneficio (día)',
          data: dailyPerf.map((p) => ({ x: p.adSpend, y: p.netProfit })),
          backgroundColor: 'rgba(139, 92, 246, 0.55)',
          borderColor: 'rgba(139, 92, 246, 0.9)',
          pointRadius: 4,
        },
      ],
    }
  }, [dailyPerf])

  const exportPDF = useCallback(async () => {
    if (!reportRef.current) return

    const canvas = await html2canvas(reportRef.current, {
      scale: 2,
      backgroundColor: '#f8fafc',
      useCORS: true,
    })

    const imgData = canvas.toDataURL('image/png')
    const pdf = new jsPDF('p', 'mm', 'a4')

    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()

    const imgWidth = pageWidth
    const imgHeight = (canvas.height * imgWidth) / canvas.width

    let position = 0
    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)

    if (imgHeight > pageHeight) {
      let heightLeft = imgHeight - pageHeight
      while (heightLeft > 0) {
        position = position - pageHeight
        pdf.addPage()
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
        heightLeft -= pageHeight
      }
    }

    pdf.save(`reporte-15-dias-${clientName}.pdf`)
  }, [clientName])

  return (
    <div className="w-full">
      <div className="max-w-6xl mx-auto bg-slate-50 rounded-3xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold tracking-wide text-slate-500">Mini-App</div>
            <h1 className="text-2xl font-semibold text-slate-900">Reporte 15 días - {clientName}</h1>
            <p className="text-slate-500 text-sm mt-1">Sube DashboardGoods, DashboardTotals y Advertising Performance (Sellerboard).</p>
            {reportPeriodLabel && <div className="mt-2 text-xs font-semibold text-slate-700">{reportPeriodLabel}</div>}
          </div>

          <button
            type="button"
            onClick={exportPDF}
            disabled={!processed}
            className={cn(
              'inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold border',
              processed
                ? 'bg-slate-900 text-white border-slate-900 hover:bg-slate-800'
                : 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
            )}
          >
            <Download className="h-4 w-4" />
            Exportar PDF
          </button>
        </div>

        <div
          {...getRootProps()}
          className={cn(
            'mt-6 rounded-2xl border-2 border-dashed p-6 transition cursor-pointer',
            isDragActive ? 'border-slate-900 bg-slate-50' : 'border-slate-200 bg-white'
          )}
        >
          <input {...getInputProps()} />
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-slate-900 text-white flex items-center justify-center">
              <FileUp className="h-5 w-5" />
            </div>
            <div>
              <div className="text-slate-900 font-semibold">
                {isDragActive ? 'Suelta los CSV aquí…' : 'Arrastra y suelta los 3 CSV aquí'}
              </div>
              <div className="text-slate-500 text-sm">O haz click para seleccionarlos. Se procesan en tu navegador.</div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-xl border border-slate-200 p-3">
              <div className="text-xs font-semibold text-slate-500">DashboardTotals</div>
              <div className="text-sm text-slate-900 mt-1">{totalsState.file?.name || 'No subido'}</div>
            </div>
            <div className="rounded-xl border border-slate-200 p-3">
              <div className="text-xs font-semibold text-slate-500">DashboardGoods</div>
              <div className="text-sm text-slate-900 mt-1">{goodsState.file?.name || 'No subido'}</div>
            </div>
            <div className="rounded-xl border border-slate-200 p-3">
              <div className="text-xs font-semibold text-slate-500">Advertising Performance</div>
              <div className="text-sm text-slate-900 mt-1">{adsState.file?.name || 'No subido'}</div>
            </div>
          </div>

          {processingError && <div className="mt-3 text-sm text-red-600">{processingError}</div>}
        </div>

        {processed && (
          <div ref={reportRef} className="mt-8">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              <div className="rounded-2xl border border-slate-200 p-5 bg-white shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-slate-500">Ventas Totales</div>
                    <div className="text-2xl font-semibold text-slate-900 mt-2">{money(processed.totals.totalSales)}</div>
                  </div>
                  <div className="h-10 w-10 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center">
                    <Euro className="h-5 w-5 text-slate-700" />
                  </div>
                </div>
                {kpiTrends?.sales && (
                  <div className="mt-3">
                    <div
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold border',
                        kpiTrends.sales.diffPct >= 0
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                          : 'bg-red-50 text-red-700 border-red-100'
                      )}
                    >
                      {kpiTrends.sales.diffPct >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                      {`${pct(Math.abs(kpiTrends.sales.diffPct))} vs media`}
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-slate-200 p-5 bg-white shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-slate-500">Beneficio Neto</div>
                    <div className="text-2xl font-semibold text-slate-900 mt-2 text-emerald-600">{money(processed.totals.netProfit)}</div>
                  </div>
                  <div className="h-10 w-10 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center">
                    <Wallet className="h-5 w-5 text-emerald-600" />
                  </div>
                </div>
                <div className="text-xs text-slate-500 mt-2">Margen medio: {pct(processed.totals.avgMarginPct)}</div>
                {kpiTrends?.profit && (
                  <div className="mt-3">
                    <div
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold border',
                        kpiTrends.profit.diffPct >= 0
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                          : 'bg-red-50 text-red-700 border-red-100'
                      )}
                    >
                      {kpiTrends.profit.diffPct >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                      {`${pct(Math.abs(kpiTrends.profit.diffPct))} vs media`}
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-slate-200 p-5 bg-white shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-slate-500">ROAS</div>
                    <div className="text-2xl font-semibold text-slate-900 mt-2 text-violet-600">{processed.ads.roas.toFixed(2)}</div>
                  </div>
                  <div className="h-10 w-10 rounded-xl bg-violet-50 border border-violet-100 flex items-center justify-center">
                    <TrendingUp className="h-5 w-5 text-violet-600" />
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 p-5 bg-white shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-slate-500">TACOS</div>
                    <div className="text-2xl font-semibold text-slate-900 mt-2 text-violet-600">{pct(processed.ads.tacosPct)}</div>
                  </div>
                  <div className="h-10 w-10 rounded-xl bg-violet-50 border border-violet-100 flex items-center justify-center">
                    <Megaphone className="h-5 w-5 text-violet-600" />
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-8 grid grid-cols-1 xl:grid-cols-5 gap-6">
              <div className="xl:col-span-3 rounded-2xl border border-slate-200 p-4 bg-white">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Sales Mix (Áreas apiladas)</div>
                    <div className="text-xs text-slate-500">Volumen total y contribución PPC por día</div>
                  </div>
                  <div className="inline-flex items-center gap-2 text-xs text-slate-500">
                    <TrendingUp className="h-4 w-4" />
                    Área
                  </div>
                </div>

                <div className="mt-4 h-[260px]">
                  {chartData && (
                    <Line
                      data={chartData}
                      options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                          legend: { position: 'bottom' },
                        },
                        scales: {
                          y: {
                            stacked: true,
                            ticks: {
                              callback: (value: string | number) => `${Number(value).toLocaleString('es-ES')} €`,
                            },
                          },
                        },
                      }}
                    />
                  )}
                </div>
              </div>

              <div className="xl:col-span-2 rounded-2xl border border-slate-200 p-4 bg-white">
                <div className="text-sm font-semibold text-slate-900">Top 5 productos por beneficio</div>
                <div className="text-xs text-slate-500">Conversión = Units / Sessions</div>

                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-[520px] w-full text-sm">
                    <thead>
                      <tr className="text-xs text-slate-500 border-b border-slate-200">
                        <th className="text-left py-2">Name</th>
                        <th className="text-right py-2">Beneficio</th>
                        <th className="text-right py-2">Conv.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {processed.topProducts.map((p) => (
                        <tr key={p.sku + p.title} className="border-b border-slate-100">
                          <td className="py-2 pr-2">
                            <div
                              className="font-semibold text-slate-900 max-w-[340px] truncate"
                              title={p.title || p.sku}
                            >
                              {p.title || '—'}
                            </div>
                            <div className="text-xs text-slate-500">{p.sku}</div>
                          </td>
                          <td className="py-2 text-right font-semibold text-slate-900">{money(p.profit)}</td>
                          <td
                            className={cn(
                              'py-2 text-right font-semibold',
                              p.conversionRate < 7 ? 'text-red-600' : 'text-slate-900'
                            )}
                          >
                            {pct(p.conversionRate)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {scatterData && (
              <div className="mt-8 rounded-2xl border border-slate-200 p-4 bg-white shadow-sm">
                <div className="text-sm font-semibold text-slate-900">Eficiencia diaria (Gasto vs Beneficio)</div>
                <div className="text-xs text-slate-500">Detecta días con gasto alto y beneficio bajo</div>

                <div className="mt-4 h-[220px]">
                  <Scatter
                    data={scatterData}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: { legend: { position: 'bottom' } },
                      scales: {
                        x: {
                          title: { display: true, text: 'Gasto publicitario (€)' },
                          ticks: {
                            callback: (value: string | number) => `${Number(value).toLocaleString('es-ES')} €`,
                          },
                        },
                        y: {
                          title: { display: true, text: 'Beneficio neto (€)' },
                          ticks: {
                            callback: (value: string | number) => `${Number(value).toLocaleString('es-ES')} €`,
                          },
                        },
                      },
                    }}
                  />
                </div>
              </div>
            )}

            <div className="mt-8">
              <StrategicInsights
                totalNetProfit={processed.totals.netProfit}
                tacosPct={processed.ads.tacosPct}
                roas={processed.ads.roas}
                topProducts={processed.topProducts}
              />
            </div>

            <div className="mt-8 rounded-2xl border border-slate-200 bg-white shadow-sm p-5">
              <div className="text-sm font-semibold text-slate-900">Log de Actividad y Próximos Pasos</div>
              <div className="text-xs text-slate-500">Deja el informe listo para cliente y para tu seguimiento interno</div>

              <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div>
                  <div className="text-xs font-semibold text-slate-500">Tareas Completadas</div>
                  <textarea
                    value={completedTasksText}
                    onChange={(e) => setCompletedTasksText(e.target.value)}
                    rows={5}
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                    placeholder={`- Optimización de keywords\n- Nuevas fotos en el ASIN X\n- Revisión de campañas de marca`}
                  />

                  <div className="mt-3 space-y-2">
                    {completedTasksList.length ? (
                      completedTasksList.map((t, idx) => (
                        <div key={idx} className="flex items-start gap-2 text-sm text-slate-800">
                          <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5" />
                          <div className="leading-5">{t}</div>
                        </div>
                      ))
                    ) : (
                      <div className="text-sm text-slate-400">Escribe arriba para generar el checklist.</div>
                    )}
                  </div>
                </div>

                <div>
                  <div className="text-xs font-semibold text-slate-500">Enfoque Próxima Semana</div>
                  <textarea
                    value={nextWeekFocusText}
                    onChange={(e) => setNextWeekFocusText(e.target.value)}
                    rows={5}
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-200"
                    placeholder="Ej: Priorizar eficiencia: reducir ACOS en términos genéricos, reforzar posicionamiento orgánico y mejorar conversión en el listing con más tráfico."
                  />

                  <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-800">
                    {nextWeekFocusText?.trim() || <span className="text-slate-400">Escribe arriba para dejar una nota estratégica.</span>}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 text-xs text-slate-400">Cliente ID: {clientId}</div>
          </div>
        )}
      </div>
    </div>
  )
}
