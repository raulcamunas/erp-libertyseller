'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, XCircle, AlertTriangle, TrendingUp, DollarSign, Package, BarChart3 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts'

interface ValidatorResult {
  product_name: string
  target_price: number
  unit_cost: number
  shipping_cost: number
  min_roi: number
  avg_market_price: number
  est_fba_fee: number
  market_velocity: number
  avg_reviews: number
  top_keyword: string
  search_volume: number
  referral_fee: number
  total_product_cost: number
  total_amazon_fees: number
  total_cost: number
  net_profit_unit: number
  margin_percent: number
  roi_percent: number
  monthly_profit_potential: number
  ai_analysis: {
    score: number
    verdict: 'GO' | 'NO GO' | 'CAUTION'
    pros: string[]
    cons: string[]
    financial_summary: string
  }
  top_competitors: Array<{
    asin: string
    price: number
    sales: number
    reviews: number
    title: string
  }>
}

export default function ValidatorResultPage() {
  const router = useRouter()
  const [result, setResult] = useState<ValidatorResult | null>(null)

  useEffect(() => {
    const stored = sessionStorage.getItem('validator_result')
    if (stored) {
      setResult(JSON.parse(stored))
    } else {
      router.push('/dashboard/validator/new')
    }
  }, [router])

  if (!result) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-white/50">Cargando resultados...</div>
      </div>
    )
  }

  // Datos para el gráfico de queso (desglose de costes)
  const costBreakdown = [
    { name: 'Beneficio Neto', value: result.net_profit_unit, color: '#10b981' },
    { name: 'Fees Amazon', value: result.total_amazon_fees, color: '#FF6600' },
    { name: 'Coste Producto', value: result.total_product_cost, color: '#6b7280' },
  ]

  const getVerdictColor = (verdict: string) => {
    switch (verdict) {
      case 'GO':
        return 'text-green-400'
      case 'NO GO':
        return 'text-red-400'
      case 'CAUTION':
        return 'text-yellow-400'
      default:
        return 'text-white/50'
    }
  }

  const getVerdictBg = (verdict: string) => {
    switch (verdict) {
      case 'GO':
        return 'bg-green-500/20 border-green-500/50'
      case 'NO GO':
        return 'bg-red-500/20 border-red-500/50'
      case 'CAUTION':
        return 'bg-yellow-500/20 border-yellow-500/50'
      default:
        return 'bg-white/5 border-white/10'
    }
  }

  const getVerdictIcon = (verdict: string) => {
    switch (verdict) {
      case 'GO':
        return <CheckCircle2 className="h-16 w-16 text-green-400" />
      case 'NO GO':
        return <XCircle className="h-16 w-16 text-red-400" />
      case 'CAUTION':
        return <AlertTriangle className="h-16 w-16 text-yellow-400" />
      default:
        return null
    }
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="heading-medium text-white mb-2">{result.product_name}</h1>
          <p className="text-white/50">Resultados de Validación</p>
        </div>
        <Button
          variant="ghost"
          onClick={() => router.push('/dashboard/validator/new')}
        >
          Nueva Validación
        </Button>
      </div>

      {/* Cards Superiores (Estilo Excel) */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-white/70">Coste Total</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">
              ${result.total_cost.toFixed(2)}
            </div>
            <p className="text-xs text-white/50 mt-1">
              Producto: ${result.total_product_cost.toFixed(2)} + Fees: ${result.total_amazon_fees.toFixed(2)}
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-white/70">Precio Venta</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">
              ${result.target_price.toFixed(2)}
            </div>
            <p className="text-xs text-white/50 mt-1">
              Precio objetivo de mercado
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card border-green-500/30 bg-green-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-green-400">Beneficio Neto</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-400">
              ${result.net_profit_unit.toFixed(2)}
            </div>
            <p className="text-xs text-green-400/70 mt-1">
              Margen: {result.margin_percent.toFixed(1)}%
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-white/70">ROI</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${result.roi_percent >= result.min_roi ? 'text-green-400' : 'text-red-400'}`}>
              {result.roi_percent.toFixed(1)}%
            </div>
            <p className="text-xs text-white/50 mt-1">
              Objetivo: {result.min_roi}%
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Gráfico de Queso y Semáforo IA */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Gráfico de Desglose de Costes */}
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Desglose de Costes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={costBreakdown}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {costBreakdown.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number) => `$${value.toFixed(2)}`}
                  contentStyle={{
                    backgroundColor: '#1a1a1a',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '8px',
                    color: '#fff',
                  }}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Semáforo IA */}
        <Card className={`glass-card border-2 ${getVerdictBg(result.ai_analysis.verdict)}`}>
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Análisis IA
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col items-center justify-center py-4">
              {getVerdictIcon(result.ai_analysis.verdict)}
              <div className={`mt-4 text-3xl font-bold ${getVerdictColor(result.ai_analysis.verdict)}`}>
                {result.ai_analysis.verdict}
              </div>
              <div className="text-white/70 text-sm mt-2">
                Score: {result.ai_analysis.score}/100
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <h4 className="text-sm font-semibold text-green-400 mb-2">Pros:</h4>
                <ul className="space-y-1">
                  {result.ai_analysis.pros.map((pro, idx) => (
                    <li key={idx} className="text-sm text-white/70 flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-400 mt-0.5 flex-shrink-0" />
                      <span>{pro}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-red-400 mb-2">Contras:</h4>
                <ul className="space-y-1">
                  {result.ai_analysis.cons.map((con, idx) => (
                    <li key={idx} className="text-sm text-white/70 flex items-start gap-2">
                      <XCircle className="h-4 w-4 text-red-400 mt-0.5 flex-shrink-0" />
                      <span>{con}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="pt-2 border-t border-white/10">
                <p className="text-sm text-white/80">{result.ai_analysis.financial_summary}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Métricas Adicionales */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-white/70 flex items-center gap-2">
              <Package className="h-4 w-4" />
              Potencial Mensual
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">
              ${result.monthly_profit_potential.toFixed(2)}
            </div>
            <p className="text-xs text-white/50 mt-1">
              {result.market_velocity.toFixed(0)} uds/mes × ${result.net_profit_unit.toFixed(2)}
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-white/70 flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Precio Promedio Mercado
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">
              ${result.avg_market_price.toFixed(2)}
            </div>
            <p className="text-xs text-white/50 mt-1">
              Basado en TOP 10 competidores
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-white/70">Keyword Principal</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-white">
              {result.top_keyword}
            </div>
            <p className="text-xs text-white/50 mt-1">
              {result.search_volume.toLocaleString()} búsquedas/mes
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabla de Competidores */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-white">Top 5 Competidores (Helium 10 Xray)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left py-3 px-4 text-sm font-semibold text-white/70">ASIN</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-white/70">Título</th>
                  <th className="text-right py-3 px-4 text-sm font-semibold text-white/70">Precio</th>
                  <th className="text-right py-3 px-4 text-sm font-semibold text-white/70">Ventas/mes</th>
                  <th className="text-right py-3 px-4 text-sm font-semibold text-white/70">Reviews</th>
                </tr>
              </thead>
              <tbody>
                {result.top_competitors.map((competitor, idx) => (
                  <tr key={idx} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="py-3 px-4 text-sm text-white/90 font-mono">{competitor.asin}</td>
                    <td className="py-3 px-4 text-sm text-white/70">{competitor.title}</td>
                    <td className="py-3 px-4 text-sm text-white/90 text-right">${competitor.price.toFixed(2)}</td>
                    <td className="py-3 px-4 text-sm text-white/90 text-right">{competitor.sales.toFixed(0)}</td>
                    <td className="py-3 px-4 text-sm text-white/90 text-right">{competitor.reviews.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

