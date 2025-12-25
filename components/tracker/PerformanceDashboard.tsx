'use client'

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { 
  PieChart, 
  Pie, 
  Cell, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  LineChart,
  Line
} from 'recharts'
import { format, parseISO, startOfDay, endOfDay } from 'date-fns'
import { es } from 'date-fns/locale'
import { TrendingUp, TrendingDown, Clock, Target, Zap, AlertTriangle, Brain } from 'lucide-react'
import { toast } from 'sonner'

interface TrackerLog {
  id: string
  report_id: string
  domain: string
  url: string
  title: string | null
  duration_seconds: number
  start_time: string
  end_time: string | null
  category: string
}

interface PerformanceDashboardProps {
  employees: string[]
}

// Categorías productivas vs no productivas
const productiveCategories = ['linkedin', 'amazon', 'navegación', 'Prospecting', 'Communication', 'Productivity']
const unproductiveCategories = ['Entertainment', 'Other']

// Colores por categoría
const categoryColors: Record<string, string> = {
  'linkedin': '#3b82f6',
  'amazon': '#FF6600',
  'navegación': '#f59e0b',
  'Prospecting': '#3b82f6',
  'Entertainment': '#ef4444',
  'Communication': '#10b981',
  'Productivity': '#f59e0b',
  'Other': '#6b7280',
}

export function PerformanceDashboard({ employees }: PerformanceDashboardProps) {
  const supabase = createClient()
  const [selectedEmployee, setSelectedEmployee] = useState<string>(employees[0] || '')
  const [selectedDate, setSelectedDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'))
  const [logs, setLogs] = useState<TrackerLog[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingAI, setLoadingAI] = useState(false)
  const [aiInsights, setAiInsights] = useState<string | null>(null)
  const [aiMetrics, setAiMetrics] = useState<{
    productivityTrend: 'improving' | 'stable' | 'declining'
    focusScore: number
    recommendations: string[]
    riskFactors: string[]
  } | null>(null)

  useEffect(() => {
    if (selectedEmployee && selectedDate) {
      loadData()
    }
  }, [selectedEmployee, selectedDate])

  const loadData = async () => {
    setLoading(true)
    try {
      const dayStart = startOfDay(parseISO(selectedDate))
      const dayEnd = endOfDay(parseISO(selectedDate))

      // Obtener reportes del día
      const { data: reportsData, error: reportsError } = await supabase
        .from('tracker_reports')
        .select('id')
        .eq('employee_id', selectedEmployee)
        .gte('report_date', dayStart.toISOString())
        .lt('report_date', dayEnd.toISOString())

      if (reportsError) throw reportsError

      if (!reportsData || reportsData.length === 0) {
        setLogs([])
        setLoading(false)
        return
      }

      const reportIds = reportsData.map(r => r.id)

      // Obtener logs del día
      const { data: logsData, error: logsError } = await supabase
        .from('tracker_logs')
        .select('*')
        .in('report_id', reportIds)
        .gte('start_time', dayStart.toISOString())
        .lte('start_time', dayEnd.toISOString())
        .order('start_time', { ascending: true })

      if (logsError) throw logsError

      setLogs(logsData || [])

      // Generar análisis con IA automáticamente si hay datos
      if (logsData && logsData.length > 0) {
        generateAIInsights(logsData)
      } else {
        setAiInsights(null)
        setAiMetrics(null)
        setLoadingAI(false)
      }
    } catch (error) {
      console.error('Error loading performance data:', error)
      toast.error('Error al cargar los datos de rendimiento')
    } finally {
      setLoading(false)
    }
  }

  // Generar insights con IA automáticamente
  const generateAIInsights = async (logsData: TrackerLog[]) => {
    setLoadingAI(true)
    try {
      // Calcular métricas básicas para el prompt
      const totalSeconds = logsData.reduce((sum, log) => sum + log.duration_seconds, 0)
      const byCategory: Record<string, number> = {}
      let productiveSeconds = 0
      let unproductiveSeconds = 0
      let deadTimeSeconds = 0
      let afkSeconds = 0
      let afkCount = 0
      let suspiciousActivities = 0

      // Ordenar logs para detectar gaps
      const sortedLogs = [...logsData].sort((a, b) => 
        new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
      )

      // Detectar gaps y períodos AFK
      const gaps: Array<{ start: string; end: string; duration: number }> = []
      for (let i = 0; i < sortedLogs.length - 1; i++) {
        const currentLog = sortedLogs[i]
        const nextLog = sortedLogs[i + 1]
        
        if (currentLog.end_time) {
          const currentEnd = new Date(currentLog.end_time).getTime()
          const nextStart = new Date(nextLog.start_time).getTime()
          const gapSeconds = Math.floor((nextStart - currentEnd) / 1000)
          
          if (gapSeconds > 300) {
            afkSeconds += gapSeconds
            afkCount++
            gaps.push({
              start: currentLog.end_time,
              end: nextLog.start_time,
              duration: gapSeconds
            })
          }
        }
      }

      logsData.forEach(log => {
        const category = log.category || 'Other'
        byCategory[category] = (byCategory[category] || 0) + log.duration_seconds

        if (log.duration_seconds < 3) {
          suspiciousActivities++
        } else if (log.duration_seconds > 7200) {
          suspiciousActivities++
          afkSeconds += log.duration_seconds - 3600
        }

        if (productiveCategories.includes(category)) {
          productiveSeconds += log.duration_seconds
        } else if (unproductiveCategories.includes(category)) {
          unproductiveSeconds += log.duration_seconds
          if (category === 'Entertainment') {
            deadTimeSeconds += log.duration_seconds
          }
        } else {
          unproductiveSeconds += log.duration_seconds
        }
      })

      const productivityScore = totalSeconds > 0 
        ? Math.round((productiveSeconds / totalSeconds) * 100) 
        : 0

      const response = await fetch('/api/tracker/performance-insights', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: `Analiza el rendimiento de un empleado y proporciona un análisis estructurado en JSON:

Datos del empleado:
- Total de tiempo: ${Math.round(totalSeconds / 60)} minutos
- Tiempo productivo: ${Math.round(productiveSeconds / 60)} minutos (${productivityScore}%)
- Tiempo no productivo: ${Math.round(unproductiveSeconds / 60)} minutos
- Tiempo muerto: ${Math.round(deadTimeSeconds / 60)} minutos
- Tiempo AFK: ${Math.round(afkSeconds / 60)} minutos (${afkCount} períodos)
- Actividades sospechosas: ${suspiciousActivities}
- Total actividades: ${logsData.length}

Distribución: ${Object.entries(byCategory).map(([cat, sec]) => `${cat}: ${Math.round(sec / 60)}m`).join(', ')}

${gaps.length > 0 ? `Períodos AFK detectados:\n${gaps.map((gap, i) => `${i + 1}. ${format(parseISO(gap.start), 'HH:mm')} - ${format(parseISO(gap.end), 'HH:mm')} (${Math.round(gap.duration / 60)} minutos)`).join('\n')}` : 'No se detectaron períodos AFK significativos.'}

Responde SOLO con un JSON válido en este formato exacto:
{
  "summary": "Resumen breve de 2-3 frases",
  "productivityTrend": "improving" | "stable" | "declining",
  "focusScore": número del 0 al 100,
  "strengths": ["fortaleza 1", "fortaleza 2"],
  "weaknesses": ["debilidad 1", "debilidad 2"],
  "recommendations": ["recomendación 1", "recomendación 2", "recomendación 3"],
  "riskFactors": ["factor de riesgo 1", "factor de riesgo 2"]
}

Sé conciso y específico. Responde SOLO con el JSON, sin texto adicional.`
        })
      })

      const data = await response.json()
      if (data.insights) {
        try {
          // Intentar parsear como JSON estructurado
          const parsed = JSON.parse(data.insights)
          setAiInsights(parsed.summary)
          setAiMetrics({
            productivityTrend: parsed.productivityTrend || 'stable',
            focusScore: parsed.focusScore || 0,
            recommendations: parsed.recommendations || [],
            riskFactors: parsed.riskFactors || []
          })
        } catch {
          // Si no es JSON, usar como texto plano
          setAiInsights(data.insights)
          setAiMetrics(null)
        }
      }
    } catch (error: any) {
      console.error('Error generating AI insights:', error)
      // No mostrar error al usuario, simplemente continuar sin IA
      setAiInsights(null)
      setAiMetrics(null)
    } finally {
      setLoadingAI(false)
    }
  }

  // Calcular métricas incluyendo detección de AFK/tiempos muertos
  const metrics = useMemo(() => {
    if (logs.length === 0) {
      return {
        totalSeconds: 0,
        productiveSeconds: 0,
        unproductiveSeconds: 0,
        deadTimeSeconds: 0,
        byCategory: {} as Record<string, number>,
        productivityScore: 0,
        totalActivities: 0,
        afkSeconds: 0,
        afkCount: 0,
        suspiciousActivities: 0,
        gaps: [] as Array<{ start: string; end: string; duration: number }>,
      }
    }

    // Ordenar logs por start_time
    const sortedLogs = [...logs].sort((a, b) => 
      new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
    )

    const totalSeconds = logs.reduce((sum, log) => sum + log.duration_seconds, 0)
    const byCategory: Record<string, number> = {}
    let productiveSeconds = 0
    let unproductiveSeconds = 0
    let deadTimeSeconds = 0
    let afkSeconds = 0
    let afkCount = 0
    let suspiciousActivities = 0
    const gaps: Array<{ start: string; end: string; duration: number }> = []

    // Detectar gaps entre actividades (posible AFK)
    for (let i = 0; i < sortedLogs.length - 1; i++) {
      const currentLog = sortedLogs[i]
      const nextLog = sortedLogs[i + 1]
      
      if (currentLog.end_time) {
        const currentEnd = new Date(currentLog.end_time).getTime()
        const nextStart = new Date(nextLog.start_time).getTime()
        const gapSeconds = Math.floor((nextStart - currentEnd) / 1000)
        
        // Si hay un gap de más de 5 minutos (300 segundos), considerarlo tiempo muerto
        if (gapSeconds > 300) {
          afkSeconds += gapSeconds
          afkCount++
          gaps.push({
            start: currentLog.end_time,
            end: nextLog.start_time,
            duration: gapSeconds
          })
        }
      }
    }

    logs.forEach(log => {
      const category = log.category || 'Other'
      byCategory[category] = (byCategory[category] || 0) + log.duration_seconds

      // Detectar actividades sospechosas:
      // - Actividades muy cortas (< 3 segundos) que podrían ser AFK
      // - Actividades muy largas (> 2 horas) en una sola página que podrían ser AFK
      if (log.duration_seconds < 3) {
        suspiciousActivities++
      } else if (log.duration_seconds > 7200) { // 2 horas
        suspiciousActivities++
        // Si es una actividad muy larga, considerar parte como tiempo muerto
        afkSeconds += log.duration_seconds - 3600 // Restar 1 hora como tiempo "activo"
      }

      if (productiveCategories.includes(category)) {
        productiveSeconds += log.duration_seconds
      } else if (unproductiveCategories.includes(category)) {
        unproductiveSeconds += log.duration_seconds
        if (category === 'Entertainment') {
          deadTimeSeconds += log.duration_seconds
        }
      } else {
        unproductiveSeconds += log.duration_seconds
      }
    })

    const productivityScore = totalSeconds > 0 
      ? Math.round((productiveSeconds / totalSeconds) * 100) 
      : 0

    return {
      totalSeconds,
      productiveSeconds,
      unproductiveSeconds,
      deadTimeSeconds,
      byCategory,
      productivityScore,
      totalActivities: logs.length,
      afkSeconds,
      afkCount,
      suspiciousActivities,
      gaps,
    }
  }, [logs])

  // Datos para gráfico de categorías (Pie)
  const categoryPieData = useMemo(() => {
    return Object.entries(metrics.byCategory).map(([category, seconds]) => ({
      name: category,
      value: Math.round(seconds / 60), // Convertir a minutos
      seconds,
      color: categoryColors[category] || categoryColors.Other
    })).sort((a, b) => b.value - a.value)
  }, [metrics.byCategory])

  // Datos para gráfico de barras por hora
  const hourlyData = useMemo(() => {
    const hours = Array.from({ length: 24 }, (_, i) => i)
    const hourStats: Record<number, { productive: number; unproductive: number }> = {}

    hours.forEach(hour => {
      hourStats[hour] = { productive: 0, unproductive: 0 }
    })

    logs.forEach(log => {
      const logDate = parseISO(log.start_time)
      const hour = logDate.getHours()
      const category = log.category || 'Other'
      const minutes = log.duration_seconds / 60

      if (hourStats[hour]) {
        if (productiveCategories.includes(category)) {
          hourStats[hour].productive += minutes
        } else {
          hourStats[hour].unproductive += minutes
        }
      }
    })

    return hours.map(hour => ({
      hour: `${hour}:00`,
      Productivo: Math.round(hourStats[hour].productive),
      'No Productivo': Math.round(hourStats[hour].unproductive),
    }))
  }, [logs])


  const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    if (hours > 0) {
      return `${hours}h ${minutes}m`
    }
    return `${minutes}m`
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-white">Gestionar Rendimiento</h1>
      </div>

      {/* Filtros */}
      <Card className="glass-card border-white/10">
        <CardHeader>
          <CardTitle className="text-white">Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="employee" className="text-white/70">Empleado</Label>
              <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
                <SelectTrigger id="employee" className="bg-white/[0.05] border-white/10 text-white">
                  <SelectValue placeholder="Seleccionar empleado" />
                </SelectTrigger>
                <SelectContent>
                  {employees.map(emp => (
                    <SelectItem key={emp} value={emp}>
                      {emp}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="date" className="text-white/70">Fecha</Label>
              <Input
                id="date"
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-white/[0.05] border-white/10 text-white"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center h-64 text-white/50">
          Cargando datos...
        </div>
      ) : logs.length === 0 ? (
        <Card className="glass-card border-white/10">
          <CardContent className="flex items-center justify-center h-64 text-white/50">
            No hay datos registrados para este día
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Métricas principales */}
          <div className={`grid grid-cols-1 gap-4 ${aiMetrics ? 'md:grid-cols-4' : 'md:grid-cols-3'}`}>
            <Card className="glass-card border-white/10">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-white/70">Tiempo Total</p>
                    <p className="text-2xl font-bold text-white">{formatDuration(metrics.totalSeconds)}</p>
                    {aiMetrics && (
                      <p className="text-xs text-white/50 mt-1">
                        Activo: {formatDuration(Math.max(0, metrics.totalSeconds - metrics.afkSeconds))}
                      </p>
                    )}
                  </div>
                  <Clock className="h-8 w-8 text-white/30" />
                </div>
              </CardContent>
            </Card>

            <Card className="glass-card border-white/10">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-white/70">Puntuación Productividad</p>
                    <p className="text-2xl font-bold text-white">{metrics.productivityScore}%</p>
                    {aiMetrics && (
                      <div className="flex items-center gap-2 mt-1">
                        <div className={`text-xs font-medium ${
                          aiMetrics.productivityTrend === 'improving' ? 'text-green-400' :
                          aiMetrics.productivityTrend === 'declining' ? 'text-red-400' :
                          'text-yellow-400'
                        }`}>
                          {aiMetrics.productivityTrend === 'improving' ? '↑ Mejorando' :
                           aiMetrics.productivityTrend === 'declining' ? '↓ En declive' :
                           '→ Estable'}
                        </div>
                      </div>
                    )}
                  </div>
                  <Target className="h-8 w-8 text-[#FF6600]" />
                </div>
              </CardContent>
            </Card>

            {aiMetrics && (
              <Card className="glass-card border-white/10">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-white/70">Puntuación de Enfoque (IA)</p>
                      <p className={`text-2xl font-bold ${
                        aiMetrics.focusScore >= 70 ? 'text-green-400' :
                        aiMetrics.focusScore >= 50 ? 'text-yellow-400' :
                        'text-red-400'
                      }`}>
                        {aiMetrics.focusScore}/100
                      </p>
                      <div className="w-full bg-white/10 rounded-full h-1.5 mt-2">
                        <div
                          className={`h-1.5 rounded-full ${
                            aiMetrics.focusScore >= 70 ? 'bg-green-400' :
                            aiMetrics.focusScore >= 50 ? 'bg-yellow-400' :
                            'bg-red-400'
                          }`}
                          style={{ width: `${aiMetrics.focusScore}%` }}
                        />
                      </div>
                    </div>
                    <Brain className="h-8 w-8 text-[#FF6600]" />
                  </div>
                </CardContent>
              </Card>
            )}

            <Card className="glass-card border-white/10">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-white/70">Tiempo Productivo</p>
                    <p className="text-2xl font-bold text-green-400">{formatDuration(metrics.productiveSeconds)}</p>
                  </div>
                  <TrendingUp className="h-8 w-8 text-green-400" />
                </div>
              </CardContent>
            </Card>

            <Card className="glass-card border-white/10">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-white/70">Tiempo Muerto</p>
                    <p className="text-2xl font-bold text-red-400">{formatDuration(metrics.deadTimeSeconds)}</p>
                  </div>
                  <AlertTriangle className="h-8 w-8 text-red-400" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Métricas de AFK/Tiempos Muertos */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="glass-card border-white/10">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-white/70">Tiempo AFK Detectado</p>
                    <p className="text-2xl font-bold text-orange-400">{formatDuration(metrics.afkSeconds)}</p>
                    <p className="text-xs text-white/50 mt-1">{metrics.afkCount} períodos detectados</p>
                  </div>
                  <Clock className="h-8 w-8 text-orange-400" />
                </div>
              </CardContent>
            </Card>

            <Card className="glass-card border-white/10">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-white/70">Actividades Sospechosas</p>
                    <p className="text-2xl font-bold text-yellow-400">{metrics.suspiciousActivities}</p>
                    <p className="text-xs text-white/50 mt-1">Posibles AFK</p>
                  </div>
                  <AlertTriangle className="h-8 w-8 text-yellow-400" />
                </div>
              </CardContent>
            </Card>

            <Card className="glass-card border-white/10">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-white/70">Tiempo Activo Real</p>
                    <p className="text-2xl font-bold text-green-400">
                      {formatDuration(Math.max(0, metrics.totalSeconds - metrics.afkSeconds))}
                    </p>
                    <p className="text-xs text-white/50 mt-1">Sin contar AFK</p>
                  </div>
                  <Zap className="h-8 w-8 text-green-400" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Gráficos */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Gráfico de categorías (Pie) */}
            <Card className="glass-card border-white/10">
              <CardHeader>
                <CardTitle className="text-white">Distribución por Categorías</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={categoryPieData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, value }) => `${name}: ${value}m`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {categoryPieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Gráfico de productividad por hora */}
            <Card className="glass-card border-white/10">
              <CardHeader>
                <CardTitle className="text-white">Productividad por Hora</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={hourlyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.1)" />
                    <XAxis 
                      dataKey="hour" 
                      stroke="rgba(255, 255, 255, 0.5)"
                      style={{ fontSize: '11px' }}
                    />
                    <YAxis 
                      stroke="rgba(255, 255, 255, 0.5)"
                      style={{ fontSize: '11px' }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'rgba(8, 8, 8, 0.95)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '8px',
                        color: '#fff'
                      }}
                    />
                    <Legend />
                    <Bar dataKey="Productivo" stackId="a" fill="#10b981" />
                    <Bar dataKey="No Productivo" stackId="a" fill="#ef4444" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Análisis con IA - Integrado automáticamente */}
          {(loadingAI || aiInsights) && (
            <Card className="glass-card border-white/10">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Brain className={`h-5 w-5 text-[#FF6600] ${loadingAI ? 'animate-pulse' : ''}`} />
                  Análisis Inteligente de Rendimiento
                  {loadingAI && (
                    <span className="text-sm text-white/50 ml-2">Analizando con IA...</span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loadingAI ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="flex flex-col items-center gap-3">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#FF6600]"></div>
                      <p className="text-white/50 text-sm">Generando insights personalizados...</p>
                    </div>
                  </div>
                ) : aiInsights && (
                <div className="space-y-4">
                  {aiInsights && (
                    <div className="text-white bg-white/5 p-4 rounded-lg border border-white/10">
                      <p className="text-sm leading-relaxed">{aiInsights}</p>
                    </div>
                  )}
                  
                  {aiMetrics && (
                    <>
                      {/* Métricas mejoradas por IA */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="bg-white/5 p-4 rounded-lg border border-white/10">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-white/70 text-sm">Puntuación de Enfoque</span>
                            <span className={`text-lg font-bold ${
                              aiMetrics.focusScore >= 70 ? 'text-green-400' :
                              aiMetrics.focusScore >= 50 ? 'text-yellow-400' :
                              'text-red-400'
                            }`}>
                              {aiMetrics.focusScore}/100
                            </span>
                          </div>
                          <div className="w-full bg-white/10 rounded-full h-2">
                            <div
                              className={`h-2 rounded-full ${
                                aiMetrics.focusScore >= 70 ? 'bg-green-400' :
                                aiMetrics.focusScore >= 50 ? 'bg-yellow-400' :
                                'bg-red-400'
                              }`}
                              style={{ width: `${aiMetrics.focusScore}%` }}
                            />
                          </div>
                        </div>

                        <div className="bg-white/5 p-4 rounded-lg border border-white/10">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-white/70 text-sm">Tendencia de Productividad</span>
                            <div className={`flex items-center gap-2 ${
                              aiMetrics.productivityTrend === 'improving' ? 'text-green-400' :
                              aiMetrics.productivityTrend === 'declining' ? 'text-red-400' :
                              'text-yellow-400'
                            }`}>
                              {aiMetrics.productivityTrend === 'improving' && <TrendingUp className="h-4 w-4" />}
                              {aiMetrics.productivityTrend === 'declining' && <TrendingDown className="h-4 w-4" />}
                              {aiMetrics.productivityTrend === 'stable' && <Target className="h-4 w-4" />}
                              <span className="text-sm font-semibold capitalize">
                                {aiMetrics.productivityTrend === 'improving' ? 'Mejorando' :
                                 aiMetrics.productivityTrend === 'declining' ? 'En Declive' :
                                 'Estable'}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Fortalezas y Debilidades */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {aiMetrics.recommendations && aiMetrics.recommendations.length > 0 && (
                          <div className="bg-green-500/10 border border-green-500/30 p-4 rounded-lg">
                            <h4 className="text-green-400 font-semibold mb-2 flex items-center gap-2">
                              <TrendingUp className="h-4 w-4" />
                              Recomendaciones
                            </h4>
                            <ul className="space-y-1">
                              {aiMetrics.recommendations.map((rec, idx) => (
                                <li key={idx} className="text-white/90 text-sm flex items-start gap-2">
                                  <span className="text-green-400 mt-1">•</span>
                                  <span>{rec}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {aiMetrics.riskFactors && aiMetrics.riskFactors.length > 0 && (
                          <div className="bg-red-500/10 border border-red-500/30 p-4 rounded-lg">
                            <h4 className="text-red-400 font-semibold mb-2 flex items-center gap-2">
                              <AlertTriangle className="h-4 w-4" />
                              Factores de Riesgo
                            </h4>
                            <ul className="space-y-1">
                              {aiMetrics.riskFactors.map((risk, idx) => (
                                <li key={idx} className="text-white/90 text-sm flex items-start gap-2">
                                  <span className="text-red-400 mt-1">•</span>
                                  <span>{risk}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Períodos AFK detectados */}
          {metrics.gaps.length > 0 && (
            <Card className="glass-card border-white/10">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-orange-400" />
                  Períodos AFK Detectados
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {metrics.gaps.map((gap, index) => (
                    <div key={index} className="flex items-center justify-between p-3 bg-orange-500/10 border border-orange-500/30 rounded-lg">
                      <div className="flex items-center gap-3">
                        <Clock className="h-4 w-4 text-orange-400" />
                        <div>
                          <p className="text-white text-sm">
                            {format(parseISO(gap.start), 'HH:mm', { locale: es })} - {format(parseISO(gap.end), 'HH:mm', { locale: es })}
                          </p>
                          <p className="text-white/50 text-xs">
                            {format(parseISO(gap.start), 'dd/MM/yyyy', { locale: es })}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-orange-400 font-semibold">{formatDuration(gap.duration)}</p>
                        <p className="text-white/50 text-xs">Tiempo muerto</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Desglose detallado */}
          <Card className="glass-card border-white/10">
            <CardHeader>
              <CardTitle className="text-white">Desglose Detallado</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <h3 className="text-white font-semibold mb-2">Tiempo por Categoría</h3>
                  <div className="space-y-2">
                    {Object.entries(metrics.byCategory)
                      .sort(([, a], [, b]) => b - a)
                      .map(([category, seconds]) => {
                        const percentage = metrics.totalSeconds > 0 
                          ? Math.round((seconds / metrics.totalSeconds) * 100) 
                          : 0
                        return (
                          <div key={category} className="flex items-center justify-between p-3 bg-white/5 rounded-lg">
                            <div className="flex items-center gap-3">
                              <div
                                className="w-4 h-4 rounded-full"
                                style={{ backgroundColor: categoryColors[category] || categoryColors.Other }}
                              />
                              <span className="text-white font-medium capitalize">{category}</span>
                            </div>
                            <div className="flex items-center gap-4">
                              <span className="text-white/70">{formatDuration(seconds)}</span>
                              <span className="text-white/50 text-sm">{percentage}%</span>
                            </div>
                          </div>
                        )
                      })}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

