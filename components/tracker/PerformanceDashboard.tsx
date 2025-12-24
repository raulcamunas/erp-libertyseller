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
  const [aiInsights, setAiInsights] = useState<string | null>(null)
  const [loadingAI, setLoadingAI] = useState(false)

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
    } catch (error) {
      console.error('Error loading performance data:', error)
      toast.error('Error al cargar los datos de rendimiento')
    } finally {
      setLoading(false)
    }
  }

  // Calcular métricas
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
      }
    }

    const totalSeconds = logs.reduce((sum, log) => sum + log.duration_seconds, 0)
    const byCategory: Record<string, number> = {}
    let productiveSeconds = 0
    let unproductiveSeconds = 0
    let deadTimeSeconds = 0

    logs.forEach(log => {
      const category = log.category || 'Other'
      byCategory[category] = (byCategory[category] || 0) + log.duration_seconds

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

  // Generar insights con IA
  const generateAIInsights = async () => {
    if (logs.length === 0) {
      toast.info('No hay datos para analizar')
      return
    }

    setLoadingAI(true)
    try {
      const response = await fetch('/api/tracker/performance-insights', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: `Analiza el rendimiento de un empleado basándote en estos datos:
          
Total de tiempo trabajado: ${Math.round(metrics.totalSeconds / 60)} minutos
Tiempo productivo: ${Math.round(metrics.productiveSeconds / 60)} minutos (${metrics.productivityScore}%)
Tiempo no productivo: ${Math.round(metrics.unproductiveSeconds / 60)} minutos
Tiempo muerto (entretenimiento): ${Math.round(metrics.deadTimeSeconds / 60)} minutos
Total de actividades: ${metrics.totalActivities}

Distribución por categorías:
${Object.entries(metrics.byCategory).map(([cat, sec]) => `- ${cat}: ${Math.round(sec / 60)} minutos`).join('\n')}

Proporciona:
1. Un análisis breve del rendimiento (2-3 frases)
2. Puntos fuertes identificados
3. Áreas de mejora
4. Recomendaciones específicas

Responde en español, de forma concisa y profesional.`
        })
      })

      const data = await response.json()
      if (data.insights) {
        setAiInsights(data.insights)
      } else {
        throw new Error('No se recibieron insights')
      }
    } catch (error: any) {
      console.error('Error generating AI insights:', error)
      toast.error('Error al generar insights con IA')
    } finally {
      setLoadingAI(false)
    }
  }

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
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="glass-card border-white/10">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-white/70">Tiempo Total</p>
                    <p className="text-2xl font-bold text-white">{formatDuration(metrics.totalSeconds)}</p>
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
                  </div>
                  <Target className="h-8 w-8 text-[#FF6600]" />
                </div>
              </CardContent>
            </Card>

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

          {/* Análisis con IA */}
          <Card className="glass-card border-white/10">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-white flex items-center gap-2">
                  <Brain className="h-5 w-5 text-[#FF6600]" />
                  Análisis de Rendimiento con IA
                </CardTitle>
                <Button
                  onClick={generateAIInsights}
                  disabled={loadingAI}
                  className="bg-[#FF6600] hover:bg-[#FF8533] text-white"
                >
                  {loadingAI ? 'Generando...' : 'Generar Análisis'}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {aiInsights ? (
                <div className="prose prose-invert max-w-none">
                  <div className="text-white whitespace-pre-wrap bg-white/5 p-4 rounded-lg border border-white/10">
                    {aiInsights}
                  </div>
                </div>
              ) : (
                <p className="text-white/50 text-sm">
                  Haz clic en "Generar Análisis" para obtener insights personalizados sobre el rendimiento del empleado.
                </p>
              )}
            </CardContent>
          </Card>

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

