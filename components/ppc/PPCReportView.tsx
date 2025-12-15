'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts'
import { TrendingUp, TrendingDown, Target, DollarSign, MousePointerClick } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

interface KeywordData {
  keyword: string
  operation: string
  originalBid: number
  newBid: number
  spend: number
  sales: number
  clicks: number
  orders: number
  acos: number
  cpc: number
  ctr: number
  roas: number
  matchType: string
  campaignId: string
  decisionMaker: string
  aiReasoning: string | null
  status: 'BLEEDER' | 'WINNER' | 'NORMAL'
}

interface PPCReportViewProps {
  report: {
    id: string
    client_id: string
    week_start_date: string
    report_data: any
    ai_insights: string | null
    changes_summary: {
      total: number
      updates: number
      creates: number
      negatives: number
      ai_decisions: number
    }
    metrics: {
      total_spend: number
      total_sales: number
      total_clicks: number
      avg_acos: number
      global_acos: number
      target_acos: number
      avg_cpc: number
      avg_ctr: number
      roas: number
    }
    ppc_clients?: {
      name: string
      currency: string
    }
  }
}

export function PPCReportView({ report }: PPCReportViewProps) {
  const currency = report.ppc_clients?.currency || 'EUR'
  const changes = report.report_data?.changes || []
  const bleeders = report.report_data?.bleeders || []
  const winners = report.report_data?.winners || []
  const harvestOpportunities = report.report_data?.harvest_opportunities || []

  // Datos para gráfico de distribución de cambios
  const changesDistribution = [
    { name: 'Actualizaciones', value: report.changes_summary.updates, color: '#3b82f6' },
    { name: 'Nuevas Keywords', value: report.changes_summary.creates, color: '#10b981' },
    { name: 'Negativas', value: report.changes_summary.negatives, color: '#ef4444' },
  ]

  // Preparar datos de palabras clave con todas las métricas
  const allKeywords: KeywordData[] = changes
    .filter((c: any) => c['Texto de palabra clave'] && c['Entidad'] !== 'Palabra clave negativa')
    .map((c: any): KeywordData => ({
      keyword: c['Texto de palabra clave'] || 'N/A',
      operation: c['Operación'] || 'N/A',
      originalBid: c['Puja Original'] || c['Puja'] || 0,
      newBid: c['Puja'] || 0,
      spend: c['Gasto'] || 0,
      sales: c['Ventas'] || 0,
      clicks: c['Clics'] || 0,
      orders: c['Pedidos'] || 0,
      acos: c['ACOS'] ? (c['ACOS'] * 100) : (c['Gasto'] > 0 && c['Ventas'] > 0 ? (c['Gasto'] / c['Ventas']) * 100 : 0),
      cpc: c['CPC'] || (c['Clics'] > 0 ? (c['Gasto'] / c['Clics']) : 0),
      ctr: c['CTR'] ? (c['CTR'] * 100) : 0,
      roas: c['ROAS'] || (c['Gasto'] > 0 ? (c['Ventas'] / c['Gasto']) : 0),
      matchType: c['Tipo de coincidencia'] || 'N/A',
      campaignId: c['ID de la campaña'] || 'N/A',
      decisionMaker: c['Decision Maker'] || 'ALGORITHM',
      aiReasoning: c['AI Reasoning'] || null,
      status: c['Gasto'] > 0 && c['Ventas'] === 0 ? 'BLEEDER' : 
              (c['ACOS'] && c['ACOS'] < 0.1) ? 'WINNER' : 'NORMAL'
    }))
    .sort((a: KeywordData, b: KeywordData) => b.spend - a.spend) // Ordenar por gasto descendente

  // Separar en winners y bleeders
  const keywordsWinners = allKeywords.filter(k => k.status === 'WINNER' || (k.acos > 0 && k.acos < 10))
  const keywordsBleeders = allKeywords.filter(k => k.status === 'BLEEDER' || (k.spend > 5 && k.sales === 0))

  return (
    <div className="space-y-6">
      {/* Métricas Principales - Igual que el Dashboard */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-4">
        <Card className="glass-card border-white/10">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-white/60 mb-1">Gasto Total</p>
                <p className="text-2xl font-bold text-white">
                  {report.metrics.total_spend.toLocaleString('es-ES', {
                    style: 'currency',
                    currency,
                  })}
                </p>
              </div>
              <DollarSign className="h-8 w-8 text-red-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card border-white/10">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-white/60 mb-1">Ventas Totales</p>
                <p className="text-2xl font-bold text-green-400">
                  {report.metrics.total_sales.toLocaleString('es-ES', {
                    style: 'currency',
                    currency,
                  })}
                </p>
              </div>
              <TrendingUp className="h-8 w-8 text-green-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card border-white/10">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-white/60 mb-1">ACOS Global</p>
                <p className={cn(
                  "text-2xl font-bold",
                  (report.metrics.global_acos || 0) > 35 ? "text-red-400" :
                  (report.metrics.global_acos || 0) < 10 ? "text-green-400" : "text-yellow-400"
                )}>
                  {report.metrics.global_acos !== null && report.metrics.global_acos !== undefined
                    ? Number(report.metrics.global_acos).toFixed(2)
                    : '0.00'}%
                </p>
                <p className="text-xs text-white/50 mt-1">
                  Objetivo: {report.metrics.target_acos !== null && report.metrics.target_acos !== undefined
                    ? Number(report.metrics.target_acos).toFixed(1)
                    : '0.0'}%
                </p>
              </div>
              <Target className="h-8 w-8 text-yellow-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card border-white/10">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-white/60 mb-1">ROAS</p>
                <p className="text-2xl font-bold text-blue-400">
                  {report.metrics.roas !== null && report.metrics.roas !== undefined
                    ? report.metrics.roas.toFixed(2)
                    : report.metrics.total_spend > 0
                      ? (report.metrics.total_sales / report.metrics.total_spend).toFixed(2)
                      : '0.00'}
                </p>
              </div>
              <MousePointerClick className="h-8 w-8 text-blue-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card border-white/10">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-white/60 mb-1">CPC Promedio</p>
                <p className="text-2xl font-bold text-purple-400">
                  {report.metrics.avg_cpc !== null && report.metrics.avg_cpc !== undefined
                    ? `${Number(report.metrics.avg_cpc).toFixed(2)}€`
                    : '-'}
                </p>
              </div>
              <MousePointerClick className="h-8 w-8 text-purple-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card border-white/10">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-white/60 mb-1">CTR Promedio</p>
                <p className="text-2xl font-bold text-cyan-400">
                  {report.metrics.avg_ctr !== null && report.metrics.avg_ctr !== undefined
                    ? `${Number(report.metrics.avg_ctr).toFixed(2)}%`
                    : '-'}
                </p>
              </div>
              <Target className="h-8 w-8 text-cyan-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card border-white/10">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-white/60 mb-1">Clics Totales</p>
                <p className="text-2xl font-bold text-orange-400">
                  {report.metrics.total_clicks !== null && report.metrics.total_clicks !== undefined
                    ? Number(report.metrics.total_clicks).toLocaleString('es-ES')
                    : '-'}
                </p>
              </div>
              <TrendingUp className="h-8 w-8 text-orange-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card border-white/10">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-white/60 mb-1">Cambios Totales</p>
                <p className="text-2xl font-bold text-white">
                  {report.changes_summary.total}
                </p>
                <p className="text-xs text-white/50 mt-1">
                  {report.changes_summary.ai_decisions} con IA
                </p>
              </div>
              <MousePointerClick className="h-8 w-8 text-purple-400" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Desglose Completo de Palabras Clave */}
      <Card className="glass-card border-white/10">
        <CardHeader>
          <CardTitle className="text-white">Desglose Completo de Palabras Clave</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-white/10">
                  <TableHead className="text-white/70">Palabra Clave</TableHead>
                  <TableHead className="text-white/70">Operación</TableHead>
                  <TableHead className="text-white/70">Puja Original</TableHead>
                  <TableHead className="text-white/70">Puja Nueva</TableHead>
                  <TableHead className="text-white/70">Gasto (€)</TableHead>
                  <TableHead className="text-white/70">Ventas (€)</TableHead>
                  <TableHead className="text-white/70">Clics</TableHead>
                  <TableHead className="text-white/70">Pedidos</TableHead>
                  <TableHead className="text-white/70">ACOS (%)</TableHead>
                  <TableHead className="text-white/70">CPC (€)</TableHead>
                  <TableHead className="text-white/70">CTR (%)</TableHead>
                  <TableHead className="text-white/70">ROAS</TableHead>
                  <TableHead className="text-white/70">Tipo</TableHead>
                  <TableHead className="text-white/70">Decisión</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allKeywords.map((keyword, index) => (
                  <TableRow 
                    key={index} 
                    className={cn(
                      "border-white/10",
                      keyword.status === 'BLEEDER' && "bg-red-500/5",
                      keyword.status === 'WINNER' && "bg-green-500/5"
                    )}
                  >
                    <TableCell className="text-white font-medium">{keyword.keyword}</TableCell>
                    <TableCell>
                      <span className={cn(
                        "px-2 py-1 rounded text-xs font-medium",
                        keyword.operation === 'UPDATE' && "bg-blue-500/20 text-blue-400",
                        keyword.operation === 'CREATE' && "bg-green-500/20 text-green-400",
                        keyword.operation === 'DELETE' && "bg-red-500/20 text-red-400"
                      )}>
                        {keyword.operation}
                      </span>
                    </TableCell>
                    <TableCell className="text-white/70">{keyword.originalBid.toFixed(2)}€</TableCell>
                    <TableCell className="text-white">{keyword.newBid.toFixed(2)}€</TableCell>
                    <TableCell className={cn(
                      "font-medium",
                      keyword.spend > 10 ? "text-red-400" : "text-white/70"
                    )}>
                      {keyword.spend.toFixed(2)}€
                    </TableCell>
                    <TableCell className={cn(
                      "font-medium",
                      keyword.sales > 0 ? "text-green-400" : "text-white/50"
                    )}>
                      {keyword.sales.toFixed(2)}€
                    </TableCell>
                    <TableCell className="text-white/70">{keyword.clicks}</TableCell>
                    <TableCell className="text-white/70">{keyword.orders}</TableCell>
                    <TableCell className={cn(
                      "font-medium",
                      keyword.acos > 35 ? "text-red-400" :
                      keyword.acos < 10 ? "text-green-400" : "text-yellow-400"
                    )}>
                      {keyword.acos.toFixed(2)}%
                    </TableCell>
                    <TableCell className="text-white/70">{keyword.cpc.toFixed(2)}€</TableCell>
                    <TableCell className="text-white/70">{keyword.ctr.toFixed(2)}%</TableCell>
                    <TableCell className={cn(
                      "font-medium",
                      keyword.roas > 3 ? "text-green-400" : "text-white/70"
                    )}>
                      {keyword.roas.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-white/50 text-xs">{keyword.matchType}</TableCell>
                    <TableCell>
                      {keyword.decisionMaker === 'AI' ? (
                        <span className="px-2 py-1 rounded text-xs font-medium bg-purple-500/20 text-purple-400">
                          🧠 IA
                        </span>
                      ) : (
                        <span className="px-2 py-1 rounded text-xs font-medium bg-gray-500/20 text-gray-400">
                          🧮 Algoritmo
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Palabras Clave que Funcionan (Winners) */}
      {keywordsWinners.length > 0 && (
        <Card className="glass-card border-white/10">
          <CardHeader>
            <CardTitle className="text-white">✅ Palabras Clave que Funcionan (Winners)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/10">
                    <TableHead className="text-white/70">Palabra Clave</TableHead>
                    <TableHead className="text-white/70">Gasto (€)</TableHead>
                    <TableHead className="text-white/70">Ventas (€)</TableHead>
                    <TableHead className="text-white/70">Clics</TableHead>
                    <TableHead className="text-white/70">ACOS (%)</TableHead>
                    <TableHead className="text-white/70">CPC (€)</TableHead>
                    <TableHead className="text-white/70">ROAS</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {keywordsWinners.slice(0, 20).map((keyword, index) => (
                    <TableRow key={index} className="border-white/10 bg-green-500/5">
                      <TableCell className="text-white font-medium">{keyword.keyword}</TableCell>
                      <TableCell className="text-white/70">{keyword.spend.toFixed(2)}€</TableCell>
                      <TableCell className="text-green-400 font-medium">{keyword.sales.toFixed(2)}€</TableCell>
                      <TableCell className="text-white/70">{keyword.clicks}</TableCell>
                      <TableCell className="text-green-400 font-medium">{keyword.acos.toFixed(2)}%</TableCell>
                      <TableCell className="text-white/70">{keyword.cpc.toFixed(2)}€</TableCell>
                      <TableCell className="text-green-400 font-medium">{keyword.roas.toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Palabras Clave que No Funcionan (Bleeders) */}
      {keywordsBleeders.length > 0 && (
        <Card className="glass-card border-white/10">
          <CardHeader>
            <CardTitle className="text-white">❌ Palabras Clave que No Funcionan (Bleeders)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/10">
                    <TableHead className="text-white/70">Palabra Clave</TableHead>
                    <TableHead className="text-white/70">Gasto (€)</TableHead>
                    <TableHead className="text-white/70">Ventas (€)</TableHead>
                    <TableHead className="text-white/70">Clics</TableHead>
                    <TableHead className="text-white/70">ACOS (%)</TableHead>
                    <TableHead className="text-white/70">CPC (€)</TableHead>
                    <TableHead className="text-white/70">Acción</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {keywordsBleeders.slice(0, 20).map((keyword, index) => (
                    <TableRow key={index} className="border-white/10 bg-red-500/5">
                      <TableCell className="text-white font-medium">{keyword.keyword}</TableCell>
                      <TableCell className="text-red-400 font-medium">{keyword.spend.toFixed(2)}€</TableCell>
                      <TableCell className="text-white/50">{keyword.sales.toFixed(2)}€</TableCell>
                      <TableCell className="text-white/70">{keyword.clicks}</TableCell>
                      <TableCell className="text-red-400 font-medium">
                        {keyword.acos > 0 ? `${keyword.acos.toFixed(2)}%` : 'N/A'}
                      </TableCell>
                      <TableCell className="text-white/70">{keyword.cpc.toFixed(2)}€</TableCell>
                      <TableCell className="text-red-400">
                        {keyword.operation === 'CREATE' && keyword.newBid === 0.05 ? 'Negativizada' : 
                         keyword.operation === 'UPDATE' ? 'Puja Reducida' : keyword.operation}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Resumen de Cambios */}
      <Card className="glass-card border-white/10">
        <CardHeader>
          <CardTitle className="text-white">Resumen de Cambios Realizados</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
              <p className="text-sm text-white/60 mb-1">Actualizaciones</p>
              <p className="text-2xl font-bold text-blue-400">{report.changes_summary.updates}</p>
            </div>
            <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
              <p className="text-sm text-white/60 mb-1">Nuevas Keywords</p>
              <p className="text-2xl font-bold text-green-400">{report.changes_summary.creates}</p>
            </div>
            <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
              <p className="text-sm text-white/60 mb-1">Negativas</p>
              <p className="text-2xl font-bold text-red-400">{report.changes_summary.negatives}</p>
            </div>
            <div className="p-4 bg-purple-500/10 border border-purple-500/30 rounded-lg">
              <p className="text-sm text-white/60 mb-1">Decisiones con IA</p>
              <p className="text-2xl font-bold text-purple-400">{report.changes_summary.ai_decisions}</p>
            </div>
          </div>
        </CardContent>
      </Card>

    </div>
  )
}
