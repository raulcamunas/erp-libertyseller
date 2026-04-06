'use client'

import { useState, useMemo } from 'react'
import { CommissionReport, CommissionRow } from '@/lib/types/commissions'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { 
  Search, 
  BarChart3,
  Download,
  X,
  TrendingUp,
  FileText
} from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { 
  BarChart, 
  Bar, 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from 'recharts'
import { cn } from '@/lib/utils'

/** Corta el nombre del producto en la primera coma o en el primer " - " (guion con espacios). */
function truncateProductName(title: string): string {
  if (!title || !String(title).trim()) return title || '-'
  const s = String(title).trim()
  const comma = s.indexOf(',')
  const hyphen = s.indexOf(' - ')
  let cut = -1
  if (comma >= 0 && hyphen >= 0) cut = Math.min(comma, hyphen)
  else if (comma >= 0) cut = comma
  else if (hyphen >= 0) cut = hyphen
  return cut >= 0 ? s.slice(0, cut).trim() : s
}

interface CommissionReportViewProps {
  report: CommissionReport & { clients?: { name: string } }
}

type SortField = 'productTitle' | 'grossSales' | 'commission' | 'commissionRate' | 'currentYearNetBase' | 'previousYearNetBase'
type SortDirection = 'asc' | 'desc'

export function CommissionReportView({ report }: CommissionReportViewProps) {
  const summary = report.data.summary
  const allRows = report.data.rows
  const isShoesF = summary.excessAmount !== undefined && summary.previousYearNetBase !== undefined
  // Formato Ham Master / Amazon: una fila por SHIPMENT/RETURN/REFUND con Order ID, Tipo, Base Producto/Envío
  const isAmazonLineFormat = allRows.length > 0 && allRows[0].transactionTypeLabel != null

  const forcedCurrency = isAmazonLineFormat ? 'EUR' : undefined

  const currencies = useMemo(() => {
    const set = new Set<string>()
    for (const r of allRows) {
      if (r.currency) set.add(r.currency)
    }
    return Array.from(set).sort()
  }, [allRows])

  const [selectedCurrency, setSelectedCurrency] = useState<string>('ALL')

  const effectiveCurrency = forcedCurrency ?? selectedCurrency

  const [searchTerm, setSearchTerm] = useState('')
  const [sortField, setSortField] = useState<SortField>(isShoesF ? 'currentYearNetBase' : 'commission')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [chartType, setChartType] = useState<'bar' | 'line'>('bar')

  const filteredAndSortedRows = useMemo(() => {
    let filtered = [...allRows]

    if (forcedCurrency) {
      filtered = filtered.filter(r => (r.currency || 'N/A') === forcedCurrency)
    } else if (selectedCurrency !== 'ALL') {
      filtered = filtered.filter(r => (r.currency || 'N/A') === selectedCurrency)
    }

    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      filtered = filtered.filter(row =>
        (row.asin || '').toLowerCase().includes(term) ||
        (row.orderId || '').toLowerCase().includes(term) ||
        (row.date || '').toLowerCase().includes(term) ||
        (row.productTitle || '').toLowerCase().includes(term)
      )
    }

    filtered.sort((a, b) => {
      let aVal: any
      let bVal: any
      if (isShoesF && (sortField === 'currentYearNetBase' || sortField === 'previousYearNetBase')) {
        aVal = sortField === 'currentYearNetBase' ? (a.currentYearNetBase ?? 0) : (a.previousYearNetBase ?? 0)
        bVal = sortField === 'currentYearNetBase' ? (b.currentYearNetBase ?? 0) : (b.previousYearNetBase ?? 0)
      } else {
        const key = sortField as keyof CommissionRow
        aVal = a[key]
        bVal = b[key]
        if (sortField === 'productTitle') {
          aVal = (aVal || '').toLowerCase()
          bVal = (bVal || '').toLowerCase()
        }
      }

      if (sortDirection === 'asc') return aVal > bVal ? 1 : -1
      return aVal < bVal ? 1 : -1
    })

    return filtered
  }, [allRows, searchTerm, sortField, sortDirection, isShoesF, selectedCurrency, forcedCurrency])

  const formatMoney = (value: number, currency?: string) => {
    const cur = currency || (effectiveCurrency !== 'ALL' ? effectiveCurrency : undefined)
    try {
      if (cur) {
        return new Intl.NumberFormat('es-ES', {
          style: 'currency',
          currency: cur,
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        }).format(value)
      }
    } catch {
      // fallback
    }
    return value.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  const amazonEurSummary = useMemo(() => {
    if (!isAmazonLineFormat) return null
    const rows = filteredAndSortedRows
    const totalSales = rows.reduce((sum, r) => sum + (r.grossSales ?? 0), 0)
    const totalRefunds = rows.reduce((sum, r) => sum + (r.refunds ?? 0), 0)
    const netBase = rows.reduce((sum, r) => sum + (r.netBase ?? 0), 0)
    const totalCommission = rows.reduce((sum, r) => sum + (r.commission ?? 0), 0)
    return { totalSales, totalRefunds, netBase, totalCommission }
  }, [filteredAndSortedRows, isAmazonLineFormat])

  const chartData = useMemo(() => {
    if (isShoesF) {
      return filteredAndSortedRows
        .slice(0, 20)
        .map(row => {
          const excedente = Math.max(0, (row.currentYearNetBase || 0) - (row.previousYearNetBase || 0))
          return {
            name: (row.asin || '').length > 20 ? (row.asin || '').substring(0, 20) + '...' : (row.asin || ''),
            comision: excedente,
            base: row.currentYearNetBase ?? 0,
            tasa: 0
          }
        })
    }
    return filteredAndSortedRows
      .slice(0, 20)
      .map(row => ({
        name: (row.asin || row.productTitle || '').length > 20
          ? (row.asin || row.productTitle || '').substring(0, 20) + '...'
          : (row.asin || row.productTitle || ''),
        comision: row.commission,
        base: row.netBase,
        tasa: row.commissionRate * 100
      }))
  }, [filteredAndSortedRows, isShoesF])



  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('desc')
    }
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {isAmazonLineFormat && !forcedCurrency && (currencies.length > 1 || (summary.byCurrency && Object.keys(summary.byCurrency).length > 1)) && (
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-white text-sm sm:text-base">
              Moneda del reporte
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
              <div className="text-sm text-white/60">
                Para evitar mezclar divisas, filtra el detalle por moneda.
              </div>
              <select
                value={selectedCurrency}
                onChange={(e) => setSelectedCurrency(e.target.value)}
                className="bg-white/[0.03] border border-white/10 rounded-md px-3 py-2 text-white"
              >
                <option value="ALL">Todas</option>
                {Array.from(new Set([...(currencies || []), ...(summary.byCurrency ? Object.keys(summary.byCurrency) : [])]))
                  .filter(Boolean)
                  .sort()
                  .map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
              </select>
            </div>
          </CardContent>
        </Card>
      )}

      {isAmazonLineFormat && !forcedCurrency && summary.byCurrency && Object.keys(summary.byCurrency).length > 0 && (
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-white text-sm sm:text-base">
              Resumen por moneda (transparencia)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left py-3 px-3 text-xs font-semibold text-white/70 uppercase">Currency</th>
                    <th className="text-right py-3 px-3 text-xs font-semibold text-white/70 uppercase">Unid. brutas</th>
                    <th className="text-right py-3 px-3 text-xs font-semibold text-white/70 uppercase">Unid. netas</th>
                    <th className="text-right py-3 px-3 text-xs font-semibold text-white/70 uppercase">Base imponible (Neto)</th>
                    <th className="text-right py-3 px-3 text-xs font-semibold text-white/70 uppercase">IVA real</th>
                    <th className="text-right py-3 px-3 text-xs font-semibold text-white/70 uppercase">Total cobrado</th>
                    <th className="text-right py-3 px-3 text-xs font-semibold text-white/70 uppercase">Comisión</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.values(summary.byCurrency)
                    .sort((a, b) => (a.currency || '').localeCompare(b.currency || ''))
                    .map((c) => (
                      <tr key={c.currency} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                        <td className="py-3 px-3 text-white/80 font-mono text-xs">{c.currency}</td>
                        <td className="py-3 px-3 text-white/70 text-xs text-right">{(c.unitsGross ?? 0).toLocaleString('es-ES')}</td>
                        <td className="py-3 px-3 text-white/70 text-xs text-right">{(c.unitsNet ?? 0).toLocaleString('es-ES')}</td>
                        <td className="py-3 px-3 text-green-400/80 text-xs text-right font-semibold">{formatMoney(c.netBase ?? 0, c.currency)}</td>
                        <td className="py-3 px-3 text-white/70 text-xs text-right">{formatMoney(c.iva ?? 0, c.currency)}</td>
                        <td className="py-3 px-3 text-white/80 text-xs text-right font-semibold">{formatMoney(c.totalInclusive ?? 0, c.currency)}</td>
                        <td className="py-3 px-3 text-[#FF6600] font-bold text-sm text-right">{formatMoney(c.commission ?? 0, c.currency)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Resumen: ShoesF = comparación años; resto = resumen estándar */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        {isShoesF ? (
          <>
            <Card className="glass-card animate-pulse-on-load">
              <CardHeader className="pb-1 px-2 py-1.5">
                <CardTitle className="text-xs font-semibold text-white/90 leading-tight">
                  Base Neta Año Anterior
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 px-2 pb-2">
                <div className="text-base sm:text-lg lg:text-xl font-bold text-white/90">
                  {formatMoney(summary.previousYearNetBase ?? 0, 'EUR')}
                </div>
                <div className="text-[10px] text-white/50">Sin IVA</div>
              </CardContent>
            </Card>
            <Card className="glass-card animate-pulse-on-load">
              <CardHeader className="pb-1 px-2 py-1.5">
                <CardTitle className="text-xs font-semibold text-white/90 leading-tight">
                  Base Neta Año Actual
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 px-2 pb-2">
                <div className="text-base sm:text-lg lg:text-xl font-bold text-green-400">
                  {formatMoney(summary.currentYearNetBase ?? 0, 'EUR')}
                </div>
                <div className="text-[10px] text-white/50">Sin IVA</div>
              </CardContent>
            </Card>
            <Card className="glass-card animate-pulse-on-load">
              <CardHeader className="pb-1 px-2 py-1.5">
                <CardTitle className="text-xs font-semibold text-white/90 leading-tight">
                  Excedente (Diferencia)
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 px-2 pb-2">
                <div className="text-base sm:text-lg lg:text-xl font-bold text-[#FF6600]">
                  {formatMoney(summary.excessAmount ?? 0, 'EUR')}
                </div>
                <div className="text-[10px] text-white/50">Año actual − año anterior</div>
              </CardContent>
            </Card>
            <Card className="glass-card animate-pulse-on-load">
              <CardHeader className="pb-1 px-2 py-1.5">
                <CardTitle className="text-xs font-semibold text-white/90 leading-tight">
                  Comisión Total (3%)
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 px-2 pb-2">
                <div className="text-lg sm:text-xl lg:text-2xl font-bold text-[#FF6600]">
                  {formatMoney(summary.totalCommission, 'EUR')}
                </div>
                <div className="text-[10px] text-white/50">3% sobre excedente</div>
              </CardContent>
            </Card>
          </>
        ) : (
          <>
            <Card className="glass-card animate-pulse-on-load">
              <CardHeader className="pb-1 px-2 py-1.5">
                <CardTitle className="text-xs font-semibold text-white/90 leading-tight">
                  Ventas Brutas Totales
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 px-2 pb-2">
                <div className="text-base sm:text-lg lg:text-xl font-bold text-white">
                  {formatMoney((amazonEurSummary?.totalSales ?? summary.totalSales), 'EUR')}
                </div>
              </CardContent>
            </Card>
            <Card className="glass-card animate-pulse-on-load">
              <CardHeader className="pb-1 px-2 py-1.5">
                <CardTitle className="text-xs font-semibold text-white/90 leading-tight">
                  Base Neta (SIN IVA)
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 px-2 pb-2">
                <div className="text-base sm:text-lg lg:text-xl font-bold text-green-400">
                  {formatMoney((amazonEurSummary?.netBase ?? summary.netBase), 'EUR')}
                </div>
              </CardContent>
            </Card>
            <Card className="glass-card animate-pulse-on-load">
              <CardHeader className="pb-1 px-2 py-1.5">
                <CardTitle className="text-xs font-semibold text-white/90 leading-tight">
                  Comisión Total
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 px-2 pb-2">
                <div className="text-lg sm:text-xl lg:text-2xl font-bold text-[#FF6600]">
                  {formatMoney((amazonEurSummary?.totalCommission ?? summary.totalCommission), 'EUR')}
                </div>
              </CardContent>
            </Card>
            <Card className="glass-card animate-pulse-on-load">
              <CardHeader className="pb-1 px-2 py-1.5">
                <CardTitle className="text-xs font-semibold text-white/90 leading-tight">
                  Productos Procesados
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 px-2 pb-2">
                <div className="text-base sm:text-lg lg:text-xl font-bold text-white">
                  {allRows.length}
                </div>
                <div className="text-[10px] sm:text-xs text-white/70 mt-0.5">
                  {filteredAndSortedRows.length} mostrados
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Filtros y Búsqueda */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-white text-sm sm:text-base flex items-center gap-2">
            <Search className="h-4 w-4 sm:h-5 sm:w-5" />
            {isShoesF ? 'Buscar por SKU' : isAmazonLineFormat ? 'Buscar por Order ID, fecha o ASIN' : 'Buscar por ASIN'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-white/50" />
            <Input
              placeholder={isShoesF ? 'Buscar por SKU...' : isAmazonLineFormat ? 'Order ID, fecha o ASIN...' : 'Buscar por ASIN...'}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 w-full"
            />
          </div>
          {searchTerm && (
            <Button
              onClick={() => setSearchTerm('')}
              variant="ghost"
              size="sm"
              className="gap-2 mt-3"
            >
              <X className="h-4 w-4" />
              Limpiar búsqueda
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Gráfico: ShoesF = excedente por producto; resto = comisión */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-white flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            {isShoesF ? 'Top Productos por Excedente (Año actual − año anterior)' : 'Top Productos por Comisión'}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => {
                const el = document.getElementById('detalle-productos-csv')
                if (el) {
                  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }
              }}
              variant="glass"
              size="sm"
              className="gap-1"
            >
              <FileText className="h-4 w-4" />
              Ver detalle tipo CSV
            </Button>
            <div className="flex gap-2">
              <Button
                onClick={() => setChartType('bar')}
                variant={chartType === 'bar' ? 'default' : 'outline'}
                size="sm"
                className={cn(chartType === 'bar' && "bg-[#FF6600]")}
              >
                <BarChart3 className="h-4 w-4" />
              </Button>
              <Button
                onClick={() => setChartType('line')}
                variant={chartType === 'line' ? 'default' : 'outline'}
                size="sm"
                className={cn(chartType === 'line' && "bg-[#FF6600]")}
              >
                <TrendingUp className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={400}>
            {chartType === 'bar' ? (
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.1)" />
                <XAxis 
                  dataKey="name" 
                  stroke="rgba(255, 255, 255, 0.5)"
                  style={{ fontSize: '11px' }}
                  angle={-45}
                  textAnchor="end"
                  height={80}
                />
                <YAxis 
                  stroke="rgba(255, 255, 255, 0.5)"
                  style={{ fontSize: '11px' }}
                  tickFormatter={(value) => formatMoney(value as number)}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'rgba(8, 8, 8, 0.95)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '8px',
                    color: '#fff'
                  }}
                  formatter={(value: number) => [
                    formatMoney(value),
                    isShoesF ? 'Excedente' : 'Comisión'
                  ]}
                />
                <Bar dataKey="comision" fill="#FF6600" radius={[8, 8, 0, 0]} />
              </BarChart>
            ) : (
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.1)" />
                <XAxis 
                  dataKey="name" 
                  stroke="rgba(255, 255, 255, 0.5)"
                  style={{ fontSize: '11px' }}
                  angle={-45}
                  textAnchor="end"
                  height={80}
                />
                <YAxis 
                  stroke="rgba(255, 255, 255, 0.5)"
                  style={{ fontSize: '11px' }}
                  tickFormatter={(value) => `€${value.toLocaleString()}`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'rgba(8, 8, 8, 0.95)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '8px',
                    color: '#fff'
                  }}
                  formatter={(value: number) => [
                    `€${value.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                    isShoesF ? 'Excedente' : 'Comisión'
                  ]}
                />
                <Line 
                  type="monotone" 
                  dataKey="comision" 
                  stroke="#FF6600" 
                  strokeWidth={2}
                  dot={{ fill: '#FF6600', r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            )}
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Tabla Interactiva */}
      <Card id="detalle-productos-csv">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-white">
            {isAmazonLineFormat ? 'Detalle por transacción (línea por línea)' : `Detalle de Productos (${filteredAndSortedRows.length})`}
          </CardTitle>
          <Button
            variant="glass"
            size="sm"
            className="gap-2"
            onClick={() => {
              // Exportar el CSV original subido (si existe); si no, generamos uno a partir del reporte
              const originalCsv = report.data.originalCsv
              const csvToDownload = !forcedCurrency && originalCsv && originalCsv.trim().length > 0
                ? originalCsv
                : [
                    (isAmazonLineFormat
                      ? [
                          'Fecha',
                          'Order ID',
                          'Tipo',
                          ...(forcedCurrency ? [] : ['Currency']),
                          'Base Producto (Excl.)',
                          'Envío (Excl.)',
                          'Promo (Excl.)',
                          'Neto Final (Excl.)',
                          'IVA real',
                          '% Comisión',
                          'Comisión'
                        ].join(',')
                      : ['Producto', 'ASIN', 'Ventas', 'Reembolsos', 'Base Neta', '% Comisión', 'Comisión'].join(',')),
                    ...filteredAndSortedRows.map(row => (
                      isAmazonLineFormat
                        ? [
                            `"${row.date ?? ''}"`,
                            `"${row.orderId ?? ''}"`,
                            `"${row.transactionTypeLabel ?? ''}"`,
                            ...(forcedCurrency ? [] : [row.currency ?? '']),
                            row.baseProductNet ?? 0,
                            row.baseShippingNet ?? 0,
                            row.promoNet ?? 0,
                            row.netLine ?? row.netBase,
                            row.taxAmount ?? row.iva,
                            (row.commissionRate * 100),
                            row.commission
                          ].join(',')
                        : [
                            `"${row.productTitle}"`,
                            row.asin,
                            row.grossSales,
                            row.refunds,
                            row.netBase,
                            row.commissionRate * 100,
                            row.commission
                          ].join(','))
                    )
                  ].join('\n')

              const blob = new Blob([csvToDownload], { type: 'text/csv' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = `reporte-${report.slug || 'comisiones'}.csv`
              a.click()
            }}
          >
            <Download className="h-4 w-4" />
            Exportar CSV
          </Button>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  {isShoesF ? (
                    <>
                      <th className="text-left py-3 px-3 text-xs font-semibold text-white/70 uppercase">#</th>
                      <th className="text-left py-3 px-3 text-xs font-semibold text-white/70 uppercase">SKU</th>
                      <th
                        className="text-right py-3 px-3 text-xs font-semibold text-white/70 uppercase cursor-pointer hover:text-white transition-colors"
                        onClick={() => handleSort('previousYearNetBase')}
                      >
                        Base Neta Año Anterior {sortField === 'previousYearNetBase' && (sortDirection === 'asc' ? '↑' : '↓')}
                      </th>
                      <th
                        className="text-right py-3 px-3 text-xs font-semibold text-white/70 uppercase cursor-pointer hover:text-white transition-colors"
                        onClick={() => handleSort('currentYearNetBase')}
                      >
                        Base Neta Año Actual {sortField === 'currentYearNetBase' && (sortDirection === 'asc' ? '↑' : '↓')}
                      </th>
                    </>
                  ) : isAmazonLineFormat ? (
                    <>
                      <th className="text-left py-3 px-3 text-xs font-semibold text-white/70 uppercase">Fecha</th>
                      <th className="text-left py-3 px-3 text-xs font-semibold text-white/70 uppercase">ID del Pedido</th>
                      <th className="text-left py-3 px-3 text-xs font-semibold text-white/70 uppercase">Tipo</th>
                      {!forcedCurrency && (
                        <th className="text-left py-3 px-3 text-xs font-semibold text-white/70 uppercase">Currency</th>
                      )}
                      <th className="text-right py-3 px-3 text-xs font-semibold text-white/70 uppercase">Base Producto (Neto)</th>
                      <th className="text-right py-3 px-3 text-xs font-semibold text-white/70 uppercase">Base Envío (Neto)</th>
                      <th className="text-right py-3 px-3 text-xs font-semibold text-white/70 uppercase">Promo (Neto)</th>
                      <th className="text-right py-3 px-3 text-xs font-semibold text-white/70 uppercase">IVA</th>
                      <th className="text-right py-3 px-3 text-xs font-semibold text-white/70 uppercase">Total Base</th>
                      <th className="text-right py-3 px-3 text-xs font-semibold text-white/70 uppercase">
                        Comisión ({filteredAndSortedRows[0] ? ((filteredAndSortedRows[0].commissionRate ?? 0) * 100).toFixed(0) : ''}%)
                      </th>
                    </>
                  ) : (
                    <>
                      <th className="text-left py-3 px-3 text-xs font-semibold text-white/70 uppercase">Nombre del producto</th>
                      <th className="text-left py-3 px-3 text-xs font-semibold text-white/70 uppercase">ASIN</th>
                      <th
                        className="text-right py-3 px-3 text-xs font-semibold text-white/70 uppercase cursor-pointer hover:text-white transition-colors"
                        onClick={() => handleSort('grossSales')}
                      >
                        Ventas {sortField === 'grossSales' && (sortDirection === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="text-right py-3 px-3 text-xs font-semibold text-white/70 uppercase">Reembolsos</th>
                      <th className="text-right py-3 px-3 text-xs font-semibold text-white/70 uppercase">Base Neta</th>
                      <th
                        className="text-right py-3 px-3 text-xs font-semibold text-white/70 uppercase cursor-pointer hover:text-white transition-colors"
                        onClick={() => handleSort('commissionRate')}
                      >
                        % Comisión {sortField === 'commissionRate' && (sortDirection === 'asc' ? '↑' : '↓')}
                      </th>
                      <th
                        className="text-right py-3 px-3 text-xs font-semibold text-white/70 uppercase cursor-pointer hover:text-white transition-colors"
                        onClick={() => handleSort('commission')}
                      >
                        Comisión {sortField === 'commission' && (sortDirection === 'asc' ? '↑' : '↓')}
                      </th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {isShoesF
                  ? filteredAndSortedRows.map((row, idx) => (
                      <tr key={idx} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                        <td className="py-3 px-3 text-white/50 text-xs">{row.rowNumber}</td>
                        <td className="py-3 px-3 text-white/70 text-xs font-mono">{row.asin || '-'}</td>
                        <td className="py-3 px-3 text-white/70 text-xs text-right">
                          {formatMoney(row.previousYearNetBase ?? 0, 'EUR')}
                        </td>
                        <td className="py-3 px-3 text-green-400/70 text-xs text-right font-semibold">
                          {formatMoney(row.currentYearNetBase ?? 0, 'EUR')}
                        </td>
                      </tr>
                    ))
                  : isAmazonLineFormat
                    ? filteredAndSortedRows.map((row, idx) => (
                        <tr key={idx} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                          <td className="py-3 px-3 text-white/70 text-xs">{row.date ?? '-'}</td>
                          <td className="py-3 px-3 text-white/70 text-xs font-mono">{row.orderId ?? '-'}</td>
                          <td className="py-3 px-3 text-white/70 text-xs">{row.transactionTypeLabel ?? '-'}</td>
                          {!forcedCurrency && (
                            <td className="py-3 px-3 text-white/70 text-xs font-mono">{row.currency ?? '-'}</td>
                          )}
                          <td className="py-3 px-3 text-white/70 text-xs text-right">
                            {formatMoney((row.baseProductNet ?? 0), row.currency)}
                          </td>
                          <td className="py-3 px-3 text-white/70 text-xs text-right">
                            {formatMoney((row.baseShippingNet ?? 0), row.currency)}
                          </td>
                          <td className="py-3 px-3 text-white/70 text-xs text-right">
                            {formatMoney((row.promoNet ?? 0), row.currency)}
                          </td>
                          <td className={cn(
                            'py-3 px-3 text-xs text-right',
                            (row.taxAmount ?? row.iva ?? 0) < 0 ? 'text-red-400/80' : 'text-white/70'
                          )}>
                            {formatMoney((row.taxAmount ?? row.iva ?? 0), row.currency)}
                          </td>
                          <td className={cn(
                            'py-3 px-3 text-xs text-right font-semibold',
                            (row.netBase ?? 0) < 0 ? 'text-red-400/90' : 'text-green-400/70'
                          )}>
                            {formatMoney((row.netLine ?? row.netBase ?? 0), row.currency)}
                          </td>
                          <td className="py-3 px-3 text-[#FF6600] font-bold text-sm text-right">
                            {formatMoney((row.commission ?? 0), row.currency)}
                          </td>
                        </tr>
                      ))
                    : filteredAndSortedRows.map((row, idx) => (
                      <tr key={idx} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                        <td className="py-3 px-3 text-white/70 text-xs max-w-[200px] truncate" title={row.productTitle}>
                          {truncateProductName(row.productTitle)}
                        </td>
                        <td className="py-3 px-3 text-white/70 text-xs font-mono">{row.asin}</td>
                        <td className="py-3 px-3 text-white/70 text-xs text-right">
                          {formatMoney(row.grossSales, row.currency)}
                        </td>
                        <td className="py-3 px-3 text-red-400/70 text-xs text-right">
                          {row.refunds > 0 ? (
                            <>-{formatMoney(row.refunds, row.currency)}</>
                          ) : (
                            <span className="text-white/30">-</span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-green-400/70 text-xs text-right font-semibold">
                          {formatMoney(row.netBase, row.currency)}
                        </td>
                        <td className="py-3 px-3 text-white/70 text-xs text-right">
                          <span className={row.appliedException ? 'text-[#FF6600] font-semibold' : ''}>
                            {(row.commissionRate * 100).toFixed(2)}%
                          </span>
                        </td>
                        <td className="py-3 px-3 text-[#FF6600] font-bold text-sm text-right">
                          {formatMoney(row.commission, row.currency)}
                        </td>
                      </tr>
                    ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-white/20 bg-white/[0.02]">
                  {isShoesF ? (
                    <>
                      <td colSpan={2} className="py-4 px-3 text-white font-semibold text-right">
                        TOTALES ({filteredAndSortedRows.length} productos):
                      </td>
                      <td className="py-4 px-3 text-white/70 font-semibold text-right">
                        {formatMoney(filteredAndSortedRows.reduce((sum, r) => sum + (r.previousYearNetBase ?? 0), 0), 'EUR')}
                      </td>
                      <td className="py-4 px-3 text-green-400 font-semibold text-right">
                        {formatMoney(filteredAndSortedRows.reduce((sum, r) => sum + (r.currentYearNetBase ?? 0), 0), 'EUR')}
                      </td>
                    </>
                  ) : isAmazonLineFormat ? (
                    <>
                      <td colSpan={forcedCurrency ? 3 : 4} className="py-4 px-3 text-white font-semibold">
                        TOTALES
                      </td>
                      <td className="py-4 px-3 text-white font-semibold text-right">
                        {formatMoney(filteredAndSortedRows.reduce((sum, r) => sum + (r.baseProductNet ?? 0), 0))}
                      </td>
                      <td className="py-4 px-3 text-white font-semibold text-right">
                        {formatMoney(filteredAndSortedRows.reduce((sum, r) => sum + (r.baseShippingNet ?? 0), 0))}
                      </td>
                      <td className="py-4 px-3 text-white font-semibold text-right">
                        {formatMoney(filteredAndSortedRows.reduce((sum, r) => sum + (r.promoNet ?? 0), 0))}
                      </td>
                      <td className="py-4 px-3 text-white font-semibold text-right">
                        {formatMoney(filteredAndSortedRows.reduce((sum, r) => sum + (r.taxAmount ?? r.iva ?? 0), 0))}
                      </td>
                      <td className="py-4 px-3 text-green-400 font-semibold text-right">
                        {formatMoney(filteredAndSortedRows.reduce((sum, r) => sum + (r.netLine ?? r.netBase ?? 0), 0))}
                      </td>
                      <td className="py-4 px-3 text-[#FF6600] font-bold text-lg text-right">
                        {formatMoney(filteredAndSortedRows.reduce((sum, r) => sum + (r.commission ?? 0), 0))}
                      </td>
                    </>
                  ) : (
                    <>
                      <td colSpan={2} className="py-4 px-3 text-white font-semibold text-right">
                        TOTALES ({filteredAndSortedRows.length} productos):
                      </td>
                      <td className="py-4 px-3 text-white font-semibold text-right">
                        {formatMoney(filteredAndSortedRows.reduce((sum, r) => sum + r.grossSales, 0))}
                      </td>
                      <td className="py-4 px-3 text-red-400 font-semibold text-right">
                        -{formatMoney(filteredAndSortedRows.reduce((sum, r) => sum + r.refunds, 0))}
                      </td>
                      <td className="py-4 px-3 text-green-400 font-semibold text-right">
                        {formatMoney(filteredAndSortedRows.reduce((sum, r) => sum + r.netBase, 0))}
                      </td>
                      <td className="py-4 px-3 text-white/70 text-right">-</td>
                      <td className="py-4 px-3 text-[#FF6600] font-bold text-lg text-right">
                        {formatMoney(filteredAndSortedRows.reduce((sum, r) => sum + r.commission, 0))}
                      </td>
                    </>
                  )}
                </tr>
              </tfoot>
            </table>
          </div>

          {filteredAndSortedRows.length === 0 && (
            <div className="text-center py-12 text-white/50">
              No hay productos que coincidan con los filtros
            </div>
          )}
        </CardContent>
      </Card>

      {/* Información del Reporte */}
      <Card>
        <CardHeader>
          <CardTitle className="text-white text-sm">Información del Reporte</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-white/70">
          <div className="flex justify-between">
            <span className="text-white/50">Creado:</span>
            <span>{format(new Date(report.created_at), "dd/MM/yyyy 'a las' HH:mm", { locale: es })}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/50">Estado:</span>
            <span className={report.status === 'final' ? 'text-green-400' : report.status === 'archived' ? 'text-gray-400' : 'text-yellow-400'}>
              {report.status === 'final' ? 'Final' : report.status === 'archived' ? 'Archivado' : 'Borrador'}
            </span>
          </div>
          {report.slug && (
            <div className="flex justify-between">
              <span className="text-white/50">Slug:</span>
              <code className="text-xs bg-white/[0.05] px-2 py-0.5 rounded">
                {report.slug}
              </code>
            </div>
          )}
        </CardContent>
      </Card>

      {report.data.errors.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-yellow-400">Errores de Parsing</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
              <ul className="text-yellow-300/70 text-sm space-y-1">
                {report.data.errors.map((err, idx) => (
                  <li key={idx}>• {err}</li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

