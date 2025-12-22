'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { 
  TrendingUp, 
  AlertTriangle, 
  CheckCircle2, 
  Calendar,
  DollarSign,
  BarChart3,
  Target,
  Zap,
  Users,
  ShoppingCart,
  Star,
  TrendingDown,
  Activity,
  Award,
  Shield,
  ArrowUpRight,
  ArrowDownRight,
  Percent,
  Package
} from 'lucide-react'
import { Logo } from '@/components/ui/Logo'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { 
  PieChart, 
  Pie, 
  Cell, 
  ResponsiveContainer, 
  Legend, 
  Tooltip, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid,
  LineChart,
  Line,
  AreaChart,
  Area,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar
} from 'recharts'

interface AuditReport {
  id: string
  seller_url: string
  business_model: 'PRIVATE_LABEL' | 'ARBITRAGE' | 'UNKNOWN'
  input_data: any
  ai_analysis: {
    headline: string
    executive_summary: string
    money_left_on_table: string
    action_plan: Array<{
      title: string
      impact: 'High' | 'Medium' | 'Low'
      description: string
    }>
  }
  computed_metrics?: {
    total_opportunity_value: number
    risk_score: number
    top_products: Array<{
      asin: string
      title: string
      revenue: number
      estimatedShare?: number
      sales: number
      reviews: number
      activeSellers: number
    }>
    model_specific_metrics: {
      avg_sellers_per_listing?: number
      saturated_niches?: number
      buy_box_gaps?: number
      seo_gap_volume?: number
      ad_dependency_score?: number
      invisible_traffic_keywords?: number
    }
  }
  status: string
  created_at: string
}

export default function AuditSharePage() {
  const params = useParams()
  const token = params.token as string
  const [report, setReport] = useState<AuditReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [score, setScore] = useState(0)

  useEffect(() => {
    const loadReport = async () => {
      if (!token) return
      
      try {
        const response = await fetch(`/api/auditor/share/${token}`)
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))
          throw new Error(errorData.error || 'Reporte no encontrado')
        }
        const data = await response.json()
        
        if (data.error) {
          throw new Error(data.error)
        }
        
        setReport(data)
        
        // Animar el score
        const riskScore = data.computed_metrics?.risk_score || 50
        const healthScore = 100 - riskScore
        animateScore(healthScore)
      } catch (err: any) {
        console.error('Error loading report:', err)
        setError(err.message || 'Error al cargar el reporte')
      } finally {
        setLoading(false)
      }
    }

    loadReport()
  }, [token])

  const animateScore = (targetScore: number) => {
    const duration = 2000
    const steps = 60
    const increment = targetScore / steps
    let current = 0
    const interval = setInterval(() => {
      current += increment
      if (current >= targetScore) {
        setScore(targetScore)
        clearInterval(interval)
      } else {
        setScore(current)
      }
    }, duration / steps)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#080808] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#FF6600] mx-auto mb-4"></div>
          <p className="text-white/70">Cargando auditoría...</p>
        </div>
      </div>
    )
  }

  if (error || !report) {
    return (
      <div className="min-h-screen bg-[#080808] flex items-center justify-center p-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white mb-4">Auditoría no encontrada</h1>
          <p className="text-white/70">
            El enlace que buscas no existe o ha expirado.
          </p>
        </div>
      </div>
    )
  }

  const healthScore = 100 - (report.computed_metrics?.risk_score || 50)
  const opportunityValue = report.computed_metrics?.total_opportunity_value || 0
  const moneyOnTable = report.ai_analysis?.money_left_on_table || '€0 anuales estimados'

  // Extraer nombre del vendedor de la URL
  const sellerName = report.seller_url
    .replace('https://www.amazon.com/s?me=', '')
    .replace('https://www.amazon.com/seller/', '')
    .split('&')[0]
    .split('?')[0]
    .substring(0, 30) || 'Vendedor Amazon'

  // Datos para gráficos según modelo
  const isArbitrage = report.business_model === 'ARBITRAGE'
  const isPrivateLabel = report.business_model === 'PRIVATE_LABEL'

  // Gráfico de pastel para ARBITRAGE
  const arbitrageData = isArbitrage && report.computed_metrics ? (() => {
    const totalMarket = report.computed_metrics.top_products.reduce((sum, p) => sum + p.revenue, 0)
    const currentShare = report.computed_metrics.top_products.reduce((sum, p) => sum + (p.estimatedShare || 0), 0)
    const potentialShare = totalMarket * 0.3 // 30% del mercado como potencial realista
    
    return [
      { name: 'Tu Participación Actual', value: currentShare, color: '#6b7280' },
      { name: 'Tu Potencial Realista', value: potentialShare - currentShare, color: '#10b981' },
      { name: 'Mercado No Capturado', value: totalMarket - potentialShare, color: '#1f2937' },
    ]
  })() : []

  // Gráfico de barras para PRIVATE_LABEL
  const privateLabelData = isPrivateLabel && report.computed_metrics ? (() => {
    const seoGap = report.computed_metrics.model_specific_metrics.seo_gap_volume || 0
    const capturedTraffic = seoGap * 0.3 // Estimación de tráfico capturado
    
    return [
      { name: 'Tráfico Total', capturado: capturedTraffic, perdido: seoGap - capturedTraffic },
    ]
  })() : []

  // Determinar estado de productos
  const getProductStatus = (product: any) => {
    if (isArbitrage) {
      if (product.activeSellers > 5) return 'Perdiendo Buy Box'
      if (product.estimatedShare && product.estimatedShare < product.revenue * 0.2) return 'Share Bajo'
      return 'Competitivo'
    } else {
      if (product.reviews < 50) return 'SEO Débil'
      if (product.revenue < 1000) return 'Bajo Rendimiento'
      return 'Estable'
    }
  }

  const getProductAction = (product: any) => {
    if (isArbitrage) {
      if (product.activeSellers > 5) return 'Activar Repricer agresivo'
      if (product.estimatedShare && product.estimatedShare < product.revenue * 0.2) return 'Optimizar pricing'
      return 'Mantener estrategia'
    } else {
      if (product.reviews < 50) return 'Acelerar reviews y A+ Content'
      if (product.revenue < 1000) return 'Optimizar keywords y PPC'
      return 'Escalar con ads'
    }
  }

  return (
    <div className="min-h-screen bg-[#080808] relative overflow-hidden">
      {/* Background Effects */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#080808] via-[#0a0a0a] to-[#080808]"></div>
      <div className="absolute inset-0 opacity-20">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-[#FF6600]/10 rounded-full blur-3xl"></div>
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-green-500/10 rounded-full blur-3xl"></div>
      </div>

      <div className="relative z-10">
        {/* Header */}
        <div className="border-b border-white/10 bg-[#080808]/80 backdrop-blur-xl sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <Logo width={120} height={35} />
          </div>
        </div>

        {/* Hero Section */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16 lg:py-24">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-center mb-12"
          >
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-4">
              Auditoría de Estrategia para{' '}
              <span className="text-[#FF6600]">{sellerName}</span>
            </h1>
            <p className="text-white/60 text-sm sm:text-base max-w-2xl mx-auto">
              Análisis completo de oportunidades y riesgos en tu cuenta de Amazon
            </p>
          </motion.div>

          {/* Dashboard de Métricas Principales */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {/* Score Radial */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="glass-card p-6 rounded-2xl"
            >
              <h3 className="text-white/70 text-sm font-medium mb-4 text-center">Salud de la Cuenta</h3>
              <div className="relative w-28 h-28 mx-auto mb-4">
                <svg className="transform -rotate-90 w-28 h-28">
                  <circle
                    cx="56"
                    cy="56"
                    r="48"
                    stroke="#1f2937"
                    strokeWidth="10"
                    fill="none"
                  />
                  <motion.circle
                    cx="56"
                    cy="56"
                    r="48"
                    stroke={healthScore >= 70 ? '#10b981' : healthScore >= 40 ? '#f59e0b' : '#ef4444'}
                    strokeWidth="10"
                    fill="none"
                    strokeDasharray={`${2 * Math.PI * 48}`}
                    strokeDashoffset={2 * Math.PI * 48 * (1 - healthScore / 100)}
                    strokeLinecap="round"
                    initial={{ strokeDashoffset: 2 * Math.PI * 48 }}
                    animate={{ strokeDashoffset: 2 * Math.PI * 48 * (1 - healthScore / 100) }}
                    transition={{ duration: 2, ease: 'easeOut' }}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-2xl font-bold text-white">{Math.round(healthScore)}</span>
                </div>
              </div>
              <p className="text-center text-white/50 text-xs">
                {healthScore >= 70 ? 'Excelente' : healthScore >= 40 ? 'Mejorable' : 'Crítico'}
              </p>
            </motion.div>

            {/* Dinero Potencial */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="glass-card p-6 rounded-2xl border-2 border-green-500/30 bg-green-500/5"
            >
              <div className="flex items-center justify-center mb-3">
                <DollarSign className="h-6 w-6 text-green-400" />
              </div>
              <h3 className="text-white/70 text-xs font-medium mb-2 text-center">Oportunidad Anual</h3>
              <p className="text-2xl font-bold text-green-400 text-center mb-1">
                {moneyOnTable}
              </p>
              <p className="text-white/50 text-xs text-center">
                Potencial no reclamado
              </p>
            </motion.div>

            {/* Modelo de Negocio */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.6, delay: 0.4 }}
              className="glass-card p-6 rounded-2xl"
            >
              <div className="flex items-center justify-center mb-3">
                <Target className="h-6 w-6 text-[#FF6600]" />
              </div>
              <h3 className="text-white/70 text-xs font-medium mb-2 text-center">Modelo</h3>
              <p className="text-xl font-bold text-white text-center mb-1">
                {report.business_model === 'ARBITRAGE' ? 'ARBITRAGE' : 
                 report.business_model === 'PRIVATE_LABEL' ? 'PRIVATE LABEL' : 
                 'UNKNOWN'}
              </p>
              <p className="text-white/50 text-xs text-center">
                {report.business_model === 'ARBITRAGE' ? 'Reselling' : 
                 report.business_model === 'PRIVATE_LABEL' ? 'Marca Propia' : 
                 'Por determinar'}
              </p>
            </motion.div>

            {/* Risk Score */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.6, delay: 0.5 }}
              className="glass-card p-6 rounded-2xl"
            >
              <div className="flex items-center justify-center mb-3">
                <Shield className={`h-6 w-6 ${healthScore >= 70 ? 'text-green-400' : healthScore >= 40 ? 'text-yellow-400' : 'text-red-400'}`} />
              </div>
              <h3 className="text-white/70 text-xs font-medium mb-2 text-center">Nivel de Riesgo</h3>
              <p className={`text-2xl font-bold text-center mb-1 ${healthScore >= 70 ? 'text-green-400' : healthScore >= 40 ? 'text-yellow-400' : 'text-red-400'}`}>
                {report.computed_metrics?.risk_score || 50}/100
              </p>
              <p className="text-white/50 text-xs text-center">
                {healthScore >= 70 ? 'Bajo' : healthScore >= 40 ? 'Medio' : 'Alto'}
              </p>
            </motion.div>
          </div>

          {/* Segunda Fila de Métricas */}
          {report.computed_metrics && (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-12">
              {/* Total Revenue */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.6 }}
                className="glass-card p-4 rounded-xl"
              >
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="h-4 w-4 text-[#FF6600]" />
                  <h4 className="text-white/70 text-xs font-medium">Revenue Total</h4>
                </div>
                <p className="text-xl font-bold text-white">
                  ${report.computed_metrics.top_products.reduce((sum, p) => sum + p.revenue, 0).toLocaleString('es-ES', { maximumFractionDigits: 0 })}
                </p>
                <p className="text-white/50 text-xs mt-1">Top 5 productos</p>
              </motion.div>

              {/* Promedio Vendedores */}
              {isArbitrage && report.computed_metrics.model_specific_metrics.avg_sellers_per_listing && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.7 }}
                  className="glass-card p-4 rounded-xl"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Users className="h-4 w-4 text-blue-400" />
                    <h4 className="text-white/70 text-xs font-medium">Vendedores/Listing</h4>
                  </div>
                  <p className="text-xl font-bold text-white">
                    {report.computed_metrics.model_specific_metrics.avg_sellers_per_listing.toFixed(1)}
                  </p>
                  <p className="text-white/50 text-xs mt-1">Promedio mercado</p>
                </motion.div>
              )}

              {/* Buy Box Gaps */}
              {isArbitrage && report.computed_metrics.model_specific_metrics.buy_box_gaps !== undefined && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.8 }}
                  className="glass-card p-4 rounded-xl"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="h-4 w-4 text-red-400" />
                    <h4 className="text-white/70 text-xs font-medium">Buy Box Gaps</h4>
                  </div>
                  <p className="text-xl font-bold text-white">
                    {report.computed_metrics.model_specific_metrics.buy_box_gaps}
                  </p>
                  <p className="text-white/50 text-xs mt-1">Productos afectados</p>
                </motion.div>
              )}

              {/* SEO Gap Volume */}
              {isPrivateLabel && report.computed_metrics.model_specific_metrics.seo_gap_volume !== undefined && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.9 }}
                  className="glass-card p-4 rounded-xl"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingDown className="h-4 w-4 text-yellow-400" />
                    <h4 className="text-white/70 text-xs font-medium">Tráfico Perdido</h4>
                  </div>
                  <p className="text-xl font-bold text-white">
                    {report.computed_metrics.model_specific_metrics.seo_gap_volume.toLocaleString('es-ES')}
                  </p>
                  <p className="text-white/50 text-xs mt-1">Búsquedas/mes</p>
                </motion.div>
              )}

              {/* Promedio Reviews */}
              {report.computed_metrics.top_products.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 1.0 }}
                  className="glass-card p-4 rounded-xl"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Star className="h-4 w-4 text-yellow-400" />
                    <h4 className="text-white/70 text-xs font-medium">Reviews Promedio</h4>
                  </div>
                  <p className="text-xl font-bold text-white">
                    {Math.round(report.computed_metrics.top_products.reduce((sum, p) => sum + p.reviews, 0) / report.computed_metrics.top_products.length).toLocaleString('es-ES')}
                  </p>
                  <p className="text-white/50 text-xs mt-1">Por producto</p>
                </motion.div>
              )}

              {/* Total Productos */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 1.1 }}
                className="glass-card p-4 rounded-xl"
              >
                <div className="flex items-center gap-2 mb-2">
                  <Package className="h-4 w-4 text-purple-400" />
                  <h4 className="text-white/70 text-xs font-medium">Productos Analizados</h4>
                </div>
                <p className="text-xl font-bold text-white">
                  {report.computed_metrics.top_products.length}
                </p>
                <p className="text-white/50 text-xs mt-1">Top performers</p>
              </motion.div>
            </div>
          )}

          {/* Headline y Summary */}
          {report.ai_analysis?.headline && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.5 }}
              className="glass-card p-6 sm:p-8 rounded-2xl mb-12"
            >
              <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
                {report.ai_analysis.headline}
              </h2>
              {report.ai_analysis.executive_summary && (
                <div className="prose prose-invert max-w-none">
                  <p className="text-white/80 text-sm sm:text-base leading-relaxed whitespace-pre-line">
                    {report.ai_analysis.executive_summary}
                  </p>
                </div>
              )}
            </motion.div>
          )}

          {/* Análisis Visual - Grid de Gráficos */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-12">
            {/* El Mapa del Dinero - Pie Chart */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 1.2 }}
              className="glass-card p-6 sm:p-8 rounded-2xl"
            >
              <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-[#FF6600]" />
                Distribución del Mercado
              </h2>
              
              {isArbitrage && arbitrageData.length > 0 && (
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={arbitrageData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                        outerRadius={110}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {arbitrageData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value: number) => `$${value.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
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
                </div>
              )}

              {isPrivateLabel && privateLabelData.length > 0 && (
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={privateLabelData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                      <XAxis dataKey="name" stroke="#ffffff50" />
                      <YAxis stroke="#ffffff50" />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#1a1a1a',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                          borderRadius: '8px',
                          color: '#fff',
                        }}
                      />
                      <Legend />
                      <Bar dataKey="capturado" stackId="a" fill="#10b981" name="Tráfico Capturado" />
                      <Bar dataKey="perdido" stackId="a" fill="#ef4444" name="Tráfico Perdido" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </motion.div>

            {/* Gráfico de Barras - Revenue vs Share por Producto */}
            {report.computed_metrics && report.computed_metrics.top_products.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 1.3 }}
                className="glass-card p-6 sm:p-8 rounded-2xl"
              >
                <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-[#FF6600]" />
                  Revenue vs Share Estimado
                </h2>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                    data={report.computed_metrics.top_products.slice(0, 15).map((p, idx) => ({
                      name: `#${idx + 1}`,
                      revenue: p.revenue,
                      share: p.estimatedShare || 0,
                      gap: p.revenue - (p.estimatedShare || 0),
                    }))}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                      <XAxis dataKey="name" stroke="#ffffff50" />
                      <YAxis 
                        stroke="#ffffff50"
                        tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#1a1a1a',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                          borderRadius: '8px',
                          color: '#fff',
                        }}
                        formatter={(value: number) => `$${value.toLocaleString('es-ES', { maximumFractionDigits: 0 })}`}
                      />
                      <Legend />
                      <Bar dataKey="revenue" fill="#FF6600" name="Revenue Total" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="share" fill="#10b981" name="Tu Share Estimado" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </motion.div>
            )}
          </div>

          {/* Análisis de Competencia */}
          {report.computed_metrics && report.computed_metrics.top_products.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 1.4 }}
              className="glass-card p-6 sm:p-8 rounded-2xl mb-12"
            >
              <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                <Users className="h-5 w-5 text-[#FF6600]" />
                Análisis de Competencia por Producto
              </h2>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={report.computed_metrics.top_products.slice(0, 15).map((p, idx) => ({
                      name: `#${idx + 1}`,
                      vendedores: p.activeSellers,
                      reviews: Math.min(p.reviews / 10, 100), // Normalizar para visualización
                      ventas: Math.min(p.sales / 10, 100), // Normalizar
                    }))}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                    <XAxis dataKey="name" stroke="#ffffff50" angle={-45} textAnchor="end" height={80} />
                    <YAxis stroke="#ffffff50" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#1a1a1a',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '8px',
                        color: '#fff',
                      }}
                    />
                    <Legend />
                    <Bar dataKey="vendedores" fill="#ef4444" name="Vendedores Activos" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="reviews" fill="#f59e0b" name="Reviews (x10)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="ventas" fill="#10b981" name="Ventas/mes (x10)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </motion.div>
          )}

          {/* La Matriz de Oportunidades - Tabla Expandida */}
          {report.computed_metrics && report.computed_metrics.top_products.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 1.5 }}
              className="glass-card p-6 sm:p-8 rounded-2xl mb-12 overflow-x-auto"
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                  <Zap className="h-6 w-6 text-[#FF6600]" />
                  Análisis Detallado de Productos
                </h2>
                <div className="text-white/60 text-sm font-medium">
                  {report.computed_metrics.top_products.length} productos analizados
                </div>
              </div>
              <div className="overflow-x-auto max-h-[800px] overflow-y-auto">
                <table className="w-full min-w-[800px]">
                  <thead className="sticky top-0 bg-[#080808]/95 backdrop-blur-sm z-10">
                    <tr className="border-b border-white/10">
                      <th className="text-left py-3 px-4 text-sm font-semibold text-white/70">#</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-white/70">Producto / ASIN</th>
                      <th className="text-center py-3 px-4 text-sm font-semibold text-white/70">Estado</th>
                      <th className="text-right py-3 px-4 text-sm font-semibold text-white/70">Revenue</th>
                      {isArbitrage && (
                        <>
                          <th className="text-right py-3 px-4 text-sm font-semibold text-white/70">Share Est.</th>
                          <th className="text-right py-3 px-4 text-sm font-semibold text-white/70">Gap</th>
                        </>
                      )}
                      <th className="text-right py-3 px-4 text-sm font-semibold text-white/70">Ventas/mes</th>
                      <th className="text-right py-3 px-4 text-sm font-semibold text-white/70">Reviews</th>
                      <th className="text-right py-3 px-4 text-sm font-semibold text-white/70">Vendedores</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-white/70">Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.computed_metrics.top_products.map((product, idx) => {
                      const gap = isArbitrage ? (product.revenue - (product.estimatedShare || 0)) : 0
                      return (
                        <motion.tr
                          key={product.asin || idx}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ duration: 0.4, delay: 1.6 + idx * 0.1 }}
                          className="border-b border-white/5 hover:bg-white/5 transition-colors"
                        >
                          <td className="py-4 px-4">
                            <div className="w-8 h-8 rounded bg-[#FF6600]/20 flex items-center justify-center">
                              <span className="text-[#FF6600] font-bold text-xs">#{idx + 1}</span>
                            </div>
                          </td>
                          <td className="py-4 px-4">
                            <div className="min-w-0 max-w-xs">
                              <p className="text-white font-medium text-sm truncate">
                                {product.title.substring(0, 50)}
                                {product.title.length > 50 ? '...' : ''}
                              </p>
                              <p className="text-white/50 text-xs mt-1 font-mono">{product.asin}</p>
                            </div>
                          </td>
                          <td className="py-4 px-4">
                            <div className="flex justify-center">
                              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                                getProductStatus(product) === 'Perdiendo Buy Box' || getProductStatus(product) === 'SEO Débil'
                                  ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                                  : getProductStatus(product) === 'Share Bajo' || getProductStatus(product) === 'Bajo Rendimiento'
                                  ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                                  : 'bg-green-500/20 text-green-400 border border-green-500/30'
                              }`}>
                                {getProductStatus(product) === 'Perdiendo Buy Box' || getProductStatus(product) === 'SEO Débil' ? (
                                  <AlertTriangle className="h-3 w-3" />
                                ) : getProductStatus(product) === 'Competitivo' || getProductStatus(product) === 'Estable' ? (
                                  <CheckCircle2 className="h-3 w-3" />
                                ) : (
                                  <TrendingUp className="h-3 w-3" />
                                )}
                                {getProductStatus(product)}
                              </span>
                            </div>
                          </td>
                          <td className="py-4 px-4 text-right">
                            <p className="text-white font-semibold text-sm">
                              ${product.revenue.toLocaleString('es-ES', { maximumFractionDigits: 0 })}
                            </p>
                          </td>
                          {isArbitrage && (
                            <>
                              <td className="py-4 px-4 text-right">
                                <p className="text-green-400 font-semibold text-sm">
                                  ${(product.estimatedShare || 0).toLocaleString('es-ES', { maximumFractionDigits: 0 })}
                                </p>
                              </td>
                              <td className="py-4 px-4 text-right">
                                <p className={`font-semibold text-sm ${gap > 0 ? 'text-red-400' : 'text-green-400'}`}>
                                  {gap > 0 ? (
                                    <span className="flex items-center justify-end gap-1">
                                      <ArrowDownRight className="h-3 w-3" />
                                      ${gap.toLocaleString('es-ES', { maximumFractionDigits: 0 })}
                                    </span>
                                  ) : (
                                    <span className="flex items-center justify-end gap-1">
                                      <ArrowUpRight className="h-3 w-3" />
                                      ${Math.abs(gap).toLocaleString('es-ES', { maximumFractionDigits: 0 })}
                                    </span>
                                  )}
                                </p>
                              </td>
                            </>
                          )}
                          <td className="py-4 px-4 text-right">
                            <p className="text-white/90 text-sm">
                              {product.sales.toLocaleString('es-ES', { maximumFractionDigits: 0 })}
                            </p>
                          </td>
                          <td className="py-4 px-4 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Star className="h-3 w-3 text-yellow-400" />
                              <p className="text-white/90 text-sm">
                                {product.reviews.toLocaleString('es-ES')}
                              </p>
                            </div>
                          </td>
                          <td className="py-4 px-4 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Users className="h-3 w-3 text-blue-400" />
                              <p className="text-white/90 text-sm">
                                {product.activeSellers.toFixed(0)}
                              </p>
                            </div>
                          </td>
                          <td className="py-4 px-4">
                            <p className="text-white/80 text-xs leading-relaxed">{getProductAction(product)}</p>
                          </td>
                        </motion.tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

          {/* Análisis de Riesgo Detallado */}
          {report.computed_metrics && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-12">
              {/* Radar Chart de Métricas */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 1.7 }}
                className="glass-card p-6 sm:p-8 rounded-2xl"
              >
                <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                  <Activity className="h-5 w-5 text-[#FF6600]" />
                  Perfil de Riesgo
                </h2>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart
                      data={[
                        {
                          subject: 'Competencia',
                          A: isArbitrage 
                            ? Math.min((report.computed_metrics.model_specific_metrics.avg_sellers_per_listing || 0) * 10, 100)
                            : 100 - (report.computed_metrics.model_specific_metrics.ad_dependency_score || 0),
                          fullMark: 100,
                        },
                        {
                          subject: 'Reviews',
                          A: Math.min((report.computed_metrics.top_products.reduce((sum, p) => sum + p.reviews, 0) / report.computed_metrics.top_products.length) / 10, 100),
                          fullMark: 100,
                        },
                        {
                          subject: 'Revenue',
                          A: Math.min((report.computed_metrics.top_products.reduce((sum, p) => sum + p.revenue, 0) / 10000), 100),
                          fullMark: 100,
                        },
                        {
                          subject: 'Share',
                          A: isArbitrage
                            ? Math.min((report.computed_metrics.top_products.reduce((sum, p) => sum + (p.estimatedShare || 0), 0) / report.computed_metrics.top_products.reduce((sum, p) => sum + p.revenue, 0)) * 100, 100)
                            : 80,
                          fullMark: 100,
                        },
                        {
                          subject: 'Ventas',
                          A: Math.min((report.computed_metrics.top_products.reduce((sum, p) => sum + p.sales, 0) / report.computed_metrics.top_products.length) / 10, 100),
                          fullMark: 100,
                        },
                      ]}
                    >
                      <PolarGrid stroke="#ffffff20" />
                      <PolarAngleAxis dataKey="subject" stroke="#ffffff70" tick={{ fill: '#ffffff70', fontSize: 12 }} />
                      <PolarRadiusAxis angle={90} domain={[0, 100]} stroke="#ffffff20" />
                      <Radar
                        name="Tu Cuenta"
                        dataKey="A"
                        stroke="#FF6600"
                        fill="#FF6600"
                        fillOpacity={0.3}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#1a1a1a',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                          borderRadius: '8px',
                          color: '#fff',
                        }}
                      />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </motion.div>

              {/* Métricas Clave del Mercado */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 1.8 }}
                className="glass-card p-6 sm:p-8 rounded-2xl"
              >
                <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                  <Award className="h-5 w-5 text-[#FF6600]" />
                  Métricas del Mercado
                </h2>
                <div className="space-y-4">
                  {report.input_data?.xray?.metrics && (
                    <>
                      <div className="flex items-center justify-between p-4 rounded-lg bg-white/5">
                        <div className="flex items-center gap-3">
                          <DollarSign className="h-5 w-5 text-green-400" />
                          <div>
                            <p className="text-white/70 text-sm">Precio Promedio</p>
                            <p className="text-white/50 text-xs">TOP 10 productos</p>
                          </div>
                        </div>
                        <p className="text-xl font-bold text-white">
                          ${report.input_data.xray.metrics.avgPrice.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                      </div>

                      <div className="flex items-center justify-between p-4 rounded-lg bg-white/5">
                        <div className="flex items-center gap-3">
                          <ShoppingCart className="h-5 w-5 text-blue-400" />
                          <div>
                            <p className="text-white/70 text-sm">Ventas Promedio</p>
                            <p className="text-white/50 text-xs">Unidades/mes</p>
                          </div>
                        </div>
                        <p className="text-xl font-bold text-white">
                          {report.input_data.xray.metrics.avgSales.toLocaleString('es-ES', { maximumFractionDigits: 0 })}
                        </p>
                      </div>

                      <div className="flex items-center justify-between p-4 rounded-lg bg-white/5">
                        <div className="flex items-center gap-3">
                          <Star className="h-5 w-5 text-yellow-400" />
                          <div>
                            <p className="text-white/70 text-sm">Reviews Promedio</p>
                            <p className="text-white/50 text-xs">Por producto</p>
                          </div>
                        </div>
                        <p className="text-xl font-bold text-white">
                          {report.input_data.xray.metrics.avgReviews.toLocaleString('es-ES')}
                        </p>
                      </div>

                      <div className="flex items-center justify-between p-4 rounded-lg bg-white/5">
                        <div className="flex items-center gap-3">
                          <Percent className="h-5 w-5 text-purple-400" />
                          <div>
                            <p className="text-white/70 text-sm">Fees Promedio</p>
                            <p className="text-white/50 text-xs">Amazon FBA</p>
                          </div>
                        </div>
                        <p className="text-xl font-bold text-white">
                          ${report.input_data.xray.metrics.avgFees.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                      </div>
                    </>
                  )}

                  {isArbitrage && report.computed_metrics.model_specific_metrics.saturated_niches !== undefined && (
                    <div className="flex items-center justify-between p-4 rounded-lg bg-red-500/10 border border-red-500/30">
                      <div className="flex items-center gap-3">
                        <AlertTriangle className="h-5 w-5 text-red-400" />
                        <div>
                          <p className="text-white/70 text-sm">Nichos Saturados</p>
                          <p className="text-white/50 text-xs">{'>'}20 vendedores</p>
                        </div>
                      </div>
                      <p className="text-xl font-bold text-red-400">
                        {report.computed_metrics.model_specific_metrics.saturated_niches}
                      </p>
                    </div>
                  )}

                  {isPrivateLabel && report.computed_metrics.model_specific_metrics.ad_dependency_score !== undefined && (
                    <div className="flex items-center justify-between p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
                      <div className="flex items-center gap-3">
                        <TrendingDown className="h-5 w-5 text-yellow-400" />
                        <div>
                          <p className="text-white/70 text-sm">Dependencia de Ads</p>
                          <p className="text-white/50 text-xs">Score 0-100</p>
                        </div>
                      </div>
                      <p className="text-xl font-bold text-yellow-400">
                        {report.computed_metrics.model_specific_metrics.ad_dependency_score}/100
                      </p>
                    </div>
                  )}
                </div>
              </motion.div>
            </div>
          )}

          {/* Action Plan */}
          {report.ai_analysis?.action_plan && report.ai_analysis.action_plan.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.9 }}
              className="glass-card p-6 sm:p-8 rounded-2xl mb-12"
            >
              <h2 className="text-2xl font-bold text-white mb-6">Plan de Acción</h2>
              <div className="space-y-4">
                {report.ai_analysis?.action_plan?.map((action, idx) => (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.4, delay: 1 + idx * 0.1 }}
                    className="p-4 rounded-lg bg-white/5 border border-white/10"
                  >
                    <div className="flex items-start gap-3">
                      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                        action.impact === 'High' ? 'bg-red-500/20 text-red-400' :
                        action.impact === 'Medium' ? 'bg-yellow-500/20 text-yellow-400' :
                        'bg-blue-500/20 text-blue-400'
                      }`}>
                        {action.impact === 'High' ? '🔥' : action.impact === 'Medium' ? '⚡' : '💡'}
                      </div>
                      <div className="flex-1">
                        <h3 className="text-white font-semibold mb-1">{action.title}</h3>
                        <p className="text-white/70 text-sm">{action.description}</p>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}
        </section>

          {/* Resumen Ejecutivo Visual */}
          {report.computed_metrics && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 1.9 }}
              className="glass-card p-6 sm:p-8 rounded-2xl mb-12 border-2 border-[#FF6600]/30"
            >
              <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
                <Award className="h-6 w-6 text-[#FF6600]" />
                Resumen Ejecutivo
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="p-4 rounded-lg bg-gradient-to-br from-green-500/10 to-green-500/5 border border-green-500/20">
                  <div className="flex items-center gap-2 mb-2">
                    <ArrowUpRight className="h-5 w-5 text-green-400" />
                    <h3 className="text-white font-semibold">Oportunidad</h3>
                  </div>
                  <p className="text-2xl font-bold text-green-400 mb-1">{moneyOnTable}</p>
                  <p className="text-white/60 text-xs">Potencial anual no capturado</p>
                </div>
                <div className="p-4 rounded-lg bg-gradient-to-br from-blue-500/10 to-blue-500/5 border border-blue-500/20">
                  <div className="flex items-center gap-2 mb-2">
                    <Package className="h-5 w-5 text-blue-400" />
                    <h3 className="text-white font-semibold">Productos Top</h3>
                  </div>
                  <p className="text-2xl font-bold text-blue-400 mb-1">
                    {report.computed_metrics.top_products.length}
                  </p>
                  <p className="text-white/60 text-xs">Analizados en detalle</p>
                </div>
                <div className="p-4 rounded-lg bg-gradient-to-br from-purple-500/10 to-purple-500/5 border border-purple-500/20">
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp className="h-5 w-5 text-purple-400" />
                    <h3 className="text-white font-semibold">Revenue Total</h3>
                  </div>
                  <p className="text-2xl font-bold text-purple-400 mb-1">
                    ${report.computed_metrics.top_products.reduce((sum, p) => sum + p.revenue, 0).toLocaleString('es-ES', { maximumFractionDigits: 0 })}
                  </p>
                  <p className="text-white/60 text-xs">Suma de top productos</p>
                </div>
              </div>
            </motion.div>
          )}

        {/* CTA Flotante */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 2.0 }}
          className="fixed bottom-0 left-0 right-0 z-50 p-4 sm:p-6"
        >
          <div className="max-w-5xl mx-auto">
            <Card className="glass-card border-2 border-[#FF6600]/50 bg-gradient-to-r from-[#FF6600]/10 via-[#FF6600]/5 to-[#FF6600]/10 p-6 sm:p-8 rounded-2xl shadow-2xl backdrop-blur-xl">
              <CardContent className="p-0">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
                  <div className="flex-1 text-center sm:text-left">
                    <h3 className="text-2xl sm:text-3xl font-bold text-white mb-3">
                      ¿Listo para desbloquear esos {moneyOnTable}?
                    </h3>
                    <p className="text-white/80 text-base mb-2">
                      Agenda una sesión estratégica gratuita de 30 minutos
                    </p>
                    <p className="text-white/60 text-sm">
                      Te explicaremos paso a paso cómo ejecutar este plan y maximizar tu rentabilidad en Amazon
                    </p>
                  </div>
                  <Button
                    size="lg"
                    className="w-full sm:w-auto min-w-[240px] text-base py-6 px-8"
                    onClick={() => {
                      window.open('https://calendly.com/liberty-seller', '_blank')
                    }}
                  >
                    <Calendar className="h-5 w-5 mr-2" />
                    Agendar Sesión Gratis
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </motion.div>

        {/* Spacer para el CTA flotante */}
        <div className="h-32"></div>
      </div>
    </div>
  )
}

