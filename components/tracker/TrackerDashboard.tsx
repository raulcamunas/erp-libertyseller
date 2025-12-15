'use client'

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  Cell
} from 'recharts'
import { format, parseISO, startOfDay, endOfDay, startOfWeek, addDays, eachDayOfInterval, isSameDay } from 'date-fns'
import { es } from 'date-fns/locale'
import { AlertTriangle, ExternalLink, Clock, ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'

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

interface TrackerReport {
  id: string
  employee_id: string
  report_date: string
  logs: TrackerLog[]
}

interface TrackerDashboardProps {
  employees: string[]
}

// Colores por categoría
const categoryColors: Record<string, string> = {
  'Prospecting': '#3b82f6', // Azul
  'Entertainment': '#ef4444', // Rojo
  'Communication': '#10b981', // Verde
  'Productivity': '#f59e0b', // Amarillo
  'Other': '#6b7280', // Gris
}

// Sueldo por hora de cada empleado (en dólares)
const hourlyRates: Record<string, number> = {
  'Alejandro': 2.44,
  // Agregar más empleados aquí cuando sea necesario
}

// Dominios de ocio
const entertainmentDomains = ['youtube', 'netflix', 'facebook', 'instagram', 'twitter', 'x.com']

export function TrackerDashboard({ employees }: TrackerDashboardProps) {
  const supabase = createClient()
  const [selectedEmployee, setSelectedEmployee] = useState<string>(employees[0] || '')
  const [selectedDate, setSelectedDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'))
  const [viewMode, setViewMode] = useState<'day' | 'week'>('week')
  const [reports, setReports] = useState<TrackerReport[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set())
  const [expandedReports, setExpandedReports] = useState<Set<string>>(new Set())

  // Cargar datos cuando cambian los filtros
  useEffect(() => {
    if (selectedEmployee && selectedDate) {
      loadData()
    }
  }, [selectedEmployee, selectedDate, viewMode])

  const loadData = async () => {
    setLoading(true)
    try {
      let startDate: Date
      let endDate: Date

      if (viewMode === 'week') {
        // Calcular lunes y domingo de la semana
        const selected = parseISO(selectedDate)
        const weekStart = startOfWeek(selected, { weekStartsOn: 1 }) // Lunes
        const weekEnd = addDays(weekStart, 6) // Domingo
        startDate = startOfDay(weekStart)
        endDate = endOfDay(weekEnd)
      } else {
        // Vista diaria
        startDate = startOfDay(parseISO(selectedDate))
        endDate = endOfDay(parseISO(selectedDate))
      }

      // Obtener reportes del rango seleccionado
      const { data: reportsData, error: reportsError } = await supabase
        .from('tracker_reports')
        .select('id, employee_id, report_date')
        .eq('employee_id', selectedEmployee)
        .gte('report_date', startDate.toISOString())
        .lte('report_date', endDate.toISOString())
        .order('report_date', { ascending: true })

      if (reportsError) throw reportsError

      if (!reportsData || reportsData.length === 0) {
        setReports([])
        setLoading(false)
        return
      }

      // Obtener logs de todos los reportes
      const reportIds = reportsData.map(r => r.id)
      const { data: logsData, error: logsError } = await supabase
        .from('tracker_logs')
        .select('*')
        .in('report_id', reportIds)
        .order('start_time', { ascending: true })

      if (logsError) throw logsError

      // Agrupar logs por reporte
      const reportsWithLogs: TrackerReport[] = reportsData.map(report => ({
        ...report,
        logs: (logsData || []).filter(log => log.report_id === report.id)
      }))

      setReports(reportsWithLogs)
    } catch (error) {
      console.error('Error loading tracker data:', error)
    } finally {
      setLoading(false)
    }
  }

  // Combinar todos los logs del día
  const allLogs = useMemo(() => {
    return reports.flatMap(report => report.logs)
  }, [reports])

  // Calcular tiempo total en ocio
  const entertainmentTime = useMemo(() => {
    return allLogs
      .filter(log => entertainmentDomains.some(domain => log.domain.toLowerCase().includes(domain)))
      .reduce((sum, log) => sum + log.duration_seconds, 0)
  }, [allLogs])

  const entertainmentMinutes = Math.floor(entertainmentTime / 60)
  const showProductivityAlert = entertainmentMinutes > 30

  // Preparar datos para el gráfico (agrupar por hora)
  const chartData = useMemo(() => {
    const hours = Array.from({ length: 10 }, (_, i) => i + 9) // 09:00 a 18:00
    const hourData: Record<number, {
      hour: string
      Prospecting: number
      Entertainment: number
      Communication: number
      Productivity: number
      Other: number
      [key: string]: string | number // Index signature para permitir acceso dinámico
    }> = {}

    hours.forEach(hour => {
      hourData[hour] = {
        hour: `${hour}:00`,
        Prospecting: 0,
        Entertainment: 0,
        Communication: 0,
        Productivity: 0,
        Other: 0,
      }
    })

    allLogs.forEach(log => {
      const logDate = parseISO(log.start_time)
      const hour = logDate.getHours()
      const category = log.category || 'Other'
      const durationMinutes = log.duration_seconds / 60

      if (hour >= 9 && hour <= 18 && hourData[hour]) {
        const currentValue = hourData[hour][category]
        const numericValue = typeof currentValue === 'number' ? currentValue : 0
        hourData[hour][category] = numericValue + durationMinutes
      }
    })

    return Object.values(hourData)
  }, [allLogs])

  // Formatear duración
  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    if (mins > 0) {
      return `${mins}m ${secs}s`
    }
    return `${secs}s`
  }

  // Formatear hora
  const formatTime = (dateString: string): string => {
    return format(parseISO(dateString), 'HH:mm', { locale: es })
  }

  // Formatear horas totales
  const formatHours = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    if (hours > 0) {
      return `${hours}h ${minutes}m`
    }
    return `${minutes}m`
  }

  // Calcular horas trabajadas (decimal)
  const calculateHours = (seconds: number): number => {
    return seconds / 3600
  }

  // Calcular ganancia del día
  const calculateDailyEarnings = (seconds: number, employeeId: string): number => {
    const hourlyRate = hourlyRates[employeeId] || 0
    const hours = calculateHours(seconds)
    return hours * hourlyRate
  }

  // Obtener días de la semana (lunes a domingo)
  const weekDays = useMemo(() => {
    if (viewMode !== 'week') return []
    const selected = parseISO(selectedDate)
    const weekStart = startOfWeek(selected, { weekStartsOn: 1 })
    return eachDayOfInterval({ start: weekStart, end: addDays(weekStart, 6) })
  }, [selectedDate, viewMode])

  // Agrupar logs por día y luego por reporte
  const reportsByDay = useMemo(() => {
    if (viewMode !== 'week') return {}
    const grouped: Record<string, TrackerReport[]> = {}
    
    weekDays.forEach(day => {
      const dayKey = format(day, 'yyyy-MM-dd')
      // Filtrar reportes que tienen logs en este día
      const dayReports = reports.filter(report => {
        return report.logs.some(log => {
          const logDate = parseISO(log.start_time)
          return isSameDay(logDate, day)
        })
      })
      
      // Para cada reporte, filtrar solo los logs de este día
      grouped[dayKey] = dayReports.map(report => ({
        ...report,
        logs: report.logs.filter(log => {
          const logDate = parseISO(log.start_time)
          return isSameDay(logDate, day)
        })
      })).filter(report => report.logs.length > 0)
    })
    
    return grouped
  }, [reports, weekDays, viewMode])

  // Agrupar logs por día (para estadísticas)
  const logsByDay = useMemo(() => {
    if (viewMode !== 'week') return {}
    const grouped: Record<string, TrackerLog[]> = {}
    
    weekDays.forEach(day => {
      const dayKey = format(day, 'yyyy-MM-dd')
      grouped[dayKey] = allLogs.filter(log => {
        const logDate = parseISO(log.start_time)
        return isSameDay(logDate, day)
      })
    })
    
    return grouped
  }, [allLogs, weekDays, viewMode])

  // Calcular estadísticas por día
  const dayStats = useMemo(() => {
    if (viewMode !== 'week') return {}
    const stats: Record<string, {
      totalSeconds: number
      byCategory: Record<string, number>
    }> = {}
    
    Object.entries(logsByDay).forEach(([dayKey, logs]) => {
      const totalSeconds = logs.reduce((sum, log) => sum + log.duration_seconds, 0)
      const byCategory: Record<string, number> = {}
      
      logs.forEach(log => {
        const category = log.category || 'Other'
        byCategory[category] = (byCategory[category] || 0) + log.duration_seconds
      })
      
      stats[dayKey] = { totalSeconds, byCategory }
    })
    
    return stats
  }, [logsByDay, viewMode])

  const toggleDay = (dayKey: string) => {
    const newExpanded = new Set(expandedDays)
    if (newExpanded.has(dayKey)) {
      newExpanded.delete(dayKey)
    } else {
      newExpanded.add(dayKey)
    }
    setExpandedDays(newExpanded)
  }

  const toggleReport = (reportId: string) => {
    const newExpanded = new Set(expandedReports)
    if (newExpanded.has(reportId)) {
      newExpanded.delete(reportId)
    } else {
      newExpanded.add(reportId)
    }
    setExpandedReports(newExpanded)
  }

  // Calcular rango de horas de un reporte
  const getReportTimeRange = (report: TrackerReport): string => {
    if (report.logs.length === 0) return 'Sin datos'
    
    const times = report.logs.map(log => parseISO(log.start_time))
    const minTime = new Date(Math.min(...times.map(t => t.getTime())))
    const maxTime = new Date(Math.max(...times.map(t => t.getTime())))
    
    const minHour = format(minTime, 'HH:mm')
    const maxHour = format(maxTime, 'HH:mm')
    
    // Si es el mismo rango, mostrar solo una hora
    if (minHour === maxHour) {
      return `${format(minTime, 'HH')}h`
    }
    
    return `${format(minTime, 'HH')}h - ${format(maxTime, 'HH')}h`
  }

  // Calcular total de segundos de un reporte
  const getReportTotalSeconds = (report: TrackerReport): number => {
    return report.logs.reduce((sum, log) => sum + log.duration_seconds, 0)
  }

  // Calcular estadísticas por categoría de un reporte
  const getReportCategoryStats = (report: TrackerReport): Record<string, number> => {
    const stats: Record<string, number> = {}
    report.logs.forEach(log => {
      const category = log.category || 'Other'
      stats[category] = (stats[category] || 0) + log.duration_seconds
    })
    return stats
  }

  const navigateWeek = (direction: 'prev' | 'next') => {
    const selected = parseISO(selectedDate)
    const weekStart = startOfWeek(selected, { weekStartsOn: 1 })
    const newDate = direction === 'prev' 
      ? addDays(weekStart, -7)
      : addDays(weekStart, 7)
    setSelectedDate(format(newDate, 'yyyy-MM-dd'))
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-white">Employee Tracker</h1>
      </div>

      {/* Filtros */}
      <Card className="glass-card border-white/10">
        <CardHeader>
          <CardTitle className="text-white">Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
              <Label htmlFor="view" className="text-white/70">Vista</Label>
              <Select value={viewMode} onValueChange={(v) => setViewMode(v as 'day' | 'week')}>
                <SelectTrigger id="view" className="bg-white/[0.05] border-white/10 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="day">Día</SelectItem>
                  <SelectItem value="week">Semana</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="date" className="text-white/70">
                {viewMode === 'week' ? 'Semana (selecciona cualquier día)' : 'Fecha'}
              </Label>
              <div className="flex items-center gap-2">
                {viewMode === 'week' && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => navigateWeek('prev')}
                    className="h-10 w-10"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                )}
                <Input
                  id="date"
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="bg-white/[0.05] border-white/10 text-white flex-1"
                />
                {viewMode === 'week' && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => navigateWeek('next')}
                    className="h-10 w-10"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Alerta de Productividad */}
      {showProductivityAlert && viewMode === 'day' && (
        <Alert className="bg-yellow-500/10 border-yellow-500/50">
          <AlertTriangle className="h-4 w-4 text-yellow-500" />
          <AlertDescription className="text-yellow-200">
            ⚠️ Posible distracción detectada: {entertainmentMinutes} min en Ocio
          </AlertDescription>
        </Alert>
      )}

      {/* Vista Semanal */}
      {viewMode === 'week' && (
        <div className="space-y-4">
          {weekDays.map((day) => {
            const dayKey = format(day, 'yyyy-MM-dd')
            const dayReports = reportsByDay[dayKey] || []
            const stats = dayStats[dayKey] || { totalSeconds: 0, byCategory: {} }
            const isDayExpanded = expandedDays.has(dayKey)
            const dayName = format(day, 'EEEE', { locale: es })
            const dayDate = format(day, 'dd/MM/yyyy', { locale: es })

            // Calcular ganancia del día
            const hoursWorked = calculateHours(stats.totalSeconds)
            const dailyEarnings = calculateDailyEarnings(stats.totalSeconds, selectedEmployee)
            const hourlyRate = hourlyRates[selectedEmployee] || 0

            return (
              <Card key={dayKey} className="glass-card border-white/10">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <CardTitle className="text-white capitalize">
                        {dayName} {dayDate}
                      </CardTitle>
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2 text-white/70">
                          <Clock className="h-4 w-4" />
                          <span className="text-sm font-medium">
                            {formatHours(stats.totalSeconds)}
                          </span>
                        </div>
                        {hourlyRate > 0 && stats.totalSeconds > 0 && (
                          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#FF6600]/20 border border-[#FF6600]/30">
                            <span className="text-xs text-white/70">Ganancia:</span>
                            <span className="text-sm font-semibold text-[#FF6600]">
                              ${dailyEarnings.toFixed(2)}
                            </span>
                            <span className="text-xs text-white/50">
                              ({hoursWorked.toFixed(2)}h × ${hourlyRate}/h)
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleDay(dayKey)}
                      className="text-white/70 hover:text-white"
                    >
                      {isDayExpanded ? (
                        <>
                          <ChevronUp className="h-4 w-4 mr-1" />
                          Ocultar
                        </>
                      ) : (
                        <>
                          <ChevronDown className="h-4 w-4 mr-1" />
                          Ver Reportes
                        </>
                      )}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {/* Resumen por categoría */}
                  {Object.keys(stats.byCategory).length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-4">
                      {Object.entries(stats.byCategory).map(([category, seconds]) => (
                        <div
                          key={category}
                          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10"
                        >
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: categoryColors[category] || categoryColors.Other }}
                          />
                          <span className="text-sm text-white/70">{category}</span>
                          <span className="text-sm font-medium text-white">
                            {formatHours(seconds)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Lista de Reportes (Paquetes) */}
                  {isDayExpanded && (
                    <div className="mt-4 pt-4 border-t border-white/10 space-y-3">
                      {dayReports.length === 0 ? (
                        <p className="text-white/50 text-sm">No hay reportes registrados este día</p>
                      ) : (
                        dayReports.map((report) => {
                          const isReportExpanded = expandedReports.has(report.id)
                          const timeRange = getReportTimeRange(report)
                          const reportTotalSeconds = getReportTotalSeconds(report)
                          const reportCategoryStats = getReportCategoryStats(report)

                          return (
                            <Card key={report.id} className="bg-white/5 border-white/10">
                              <CardHeader className="pb-3">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-4">
                                    <CardTitle className="text-white text-sm">
                                      Reporte de las {timeRange}
                                    </CardTitle>
                                    <div className="flex items-center gap-2 text-white/70">
                                      <Clock className="h-3 w-3" />
                                      <span className="text-xs font-medium">
                                        {formatHours(reportTotalSeconds)}
                                      </span>
                                    </div>
                                  </div>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => toggleReport(report.id)}
                                    className="text-white/70 hover:text-white h-8"
                                  >
                                    {isReportExpanded ? (
                                      <>
                                        <ChevronUp className="h-3 w-3 mr-1" />
                                        Ocultar
                                      </>
                                    ) : (
                                      <>
                                        <ChevronDown className="h-3 w-3 mr-1" />
                                        Ver Actividad
                                      </>
                                    )}
                                  </Button>
                                </div>
                              </CardHeader>
                              <CardContent className="pt-0">
                                {/* Resumen por categoría del reporte */}
                                {Object.keys(reportCategoryStats).length > 0 && (
                                  <div className="flex flex-wrap gap-2 mb-3">
                                    {Object.entries(reportCategoryStats).map(([category, seconds]) => (
                                      <div
                                        key={category}
                                        className="flex items-center gap-2 px-2 py-1 rounded-lg bg-white/5 border border-white/10"
                                      >
                                        <div
                                          className="w-2 h-2 rounded-full"
                                          style={{ backgroundColor: categoryColors[category] || categoryColors.Other }}
                                        />
                                        <span className="text-xs text-white/70">{category}</span>
                                        <span className="text-xs font-medium text-white">
                                          {formatHours(seconds)}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {/* Detalles del reporte */}
                                {isReportExpanded && (
                                  <div className="mt-3 pt-3 border-t border-white/10">
                                    <div className="overflow-x-auto">
                                      <Table>
                                        <TableHeader>
                                          <TableRow className="border-white/10">
                                            <TableHead className="text-white/70 text-xs">Hora Inicio</TableHead>
                                            <TableHead className="text-white/70 text-xs">Duración</TableHead>
                                            <TableHead className="text-white/70 text-xs">Actividad</TableHead>
                                            <TableHead className="text-white/70 text-xs">Categoría</TableHead>
                                            <TableHead className="text-white/70 text-xs">Link</TableHead>
                                          </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                          {report.logs.map((log) => (
                                            <TableRow key={log.id} className="border-white/10">
                                              <TableCell className="text-white/90 text-xs">
                                                <div className="flex items-center gap-2">
                                                  <Clock className="h-3 w-3 text-white/50" />
                                                  {formatTime(log.start_time)}
                                                </div>
                                              </TableCell>
                                              <TableCell className="text-white/90 text-xs">
                                                {formatDuration(log.duration_seconds)}
                                              </TableCell>
                                              <TableCell className="text-white/90 text-xs">
                                                {log.title || log.domain}
                                              </TableCell>
                                              <TableCell>
                                                <span
                                                  className={cn(
                                                    "px-2 py-0.5 rounded text-xs font-medium",
                                                    log.category === 'Prospecting' && "bg-blue-500/20 text-blue-300",
                                                    log.category === 'Entertainment' && "bg-red-500/20 text-red-300",
                                                    log.category === 'Communication' && "bg-green-500/20 text-green-300",
                                                    log.category === 'Productivity' && "bg-yellow-500/20 text-yellow-300",
                                                    (!log.category || log.category === 'Other') && "bg-gray-500/20 text-gray-300"
                                                  )}
                                                >
                                                  {log.category || 'Other'}
                                                </span>
                                              </TableCell>
                                              <TableCell>
                                                <a
                                                  href={log.url}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  className="text-[#FF6600] hover:text-[#FF8533] flex items-center gap-1 text-xs"
                                                >
                                                  <ExternalLink className="h-3 w-3" />
                                                  Abrir
                                                </a>
                                              </TableCell>
                                            </TableRow>
                                          ))}
                                        </TableBody>
                                      </Table>
                                    </div>
                                  </div>
                                )}
                              </CardContent>
                            </Card>
                          )
                        })
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Gráfico de Timeline (solo para vista diaria) */}
      {viewMode === 'day' && (
        <Card className="glass-card border-white/10">
          <CardHeader>
            <CardTitle className="text-white">Timeline del Día</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center h-64 text-white/50">
                Cargando datos...
              </div>
            ) : allLogs.length === 0 ? (
              <div className="flex items-center justify-center h-64 text-white/50">
                No hay datos para este día
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={400}>
                <BarChart
                  data={chartData}
                  layout="vertical"
                  margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.1)" />
                  <XAxis 
                    type="number"
                    stroke="rgba(255, 255, 255, 0.5)"
                    style={{ fontSize: '11px' }}
                    label={{ value: 'Minutos', position: 'insideBottom', offset: -5, fill: 'rgba(255, 255, 255, 0.7)' }}
                  />
                  <YAxis 
                    type="category"
                    dataKey="hour"
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
                    formatter={(value: number, name: string) => [
                      `${value.toFixed(1)} min`,
                      name
                    ]}
                  />
                  <Legend 
                    wrapperStyle={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: '12px' }}
                  />
                  <Bar dataKey="Prospecting" stackId="a" fill={categoryColors.Prospecting} />
                  <Bar dataKey="Entertainment" stackId="a" fill={categoryColors.Entertainment} />
                  <Bar dataKey="Communication" stackId="a" fill={categoryColors.Communication} />
                  <Bar dataKey="Productivity" stackId="a" fill={categoryColors.Productivity} />
                  <Bar dataKey="Other" stackId="a" fill={categoryColors.Other} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tabla de Detalles (solo para vista diaria) */}
      {viewMode === 'day' && (
        <Card className="glass-card border-white/10">
          <CardHeader>
            <CardTitle className="text-white">Detalles de Actividad</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center h-32 text-white/50">
                Cargando datos...
              </div>
            ) : allLogs.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-white/50">
                No hay actividad registrada
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-white/10">
                      <TableHead className="text-white/70">Hora Inicio</TableHead>
                      <TableHead className="text-white/70">Duración</TableHead>
                      <TableHead className="text-white/70">Actividad</TableHead>
                      <TableHead className="text-white/70">Categoría</TableHead>
                      <TableHead className="text-white/70">Link</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allLogs.map((log) => (
                      <TableRow key={log.id} className="border-white/10">
                        <TableCell className="text-white/90">
                          <div className="flex items-center gap-2">
                            <Clock className="h-4 w-4 text-white/50" />
                            {formatTime(log.start_time)}
                          </div>
                        </TableCell>
                        <TableCell className="text-white/90">
                          {formatDuration(log.duration_seconds)}
                        </TableCell>
                        <TableCell className="text-white/90">
                          {log.title || log.domain}
                        </TableCell>
                        <TableCell>
                          <span
                            className={cn(
                              "px-2 py-1 rounded text-xs font-medium",
                              log.category === 'Prospecting' && "bg-blue-500/20 text-blue-300",
                              log.category === 'Entertainment' && "bg-red-500/20 text-red-300",
                              log.category === 'Communication' && "bg-green-500/20 text-green-300",
                              log.category === 'Productivity' && "bg-yellow-500/20 text-yellow-300",
                              (!log.category || log.category === 'Other') && "bg-gray-500/20 text-gray-300"
                            )}
                          >
                            {log.category || 'Other'}
                          </span>
                        </TableCell>
                        <TableCell>
                          <a
                            href={log.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#FF6600] hover:text-[#FF8533] flex items-center gap-1"
                          >
                            <ExternalLink className="h-4 w-4" />
                            Abrir
                          </a>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

