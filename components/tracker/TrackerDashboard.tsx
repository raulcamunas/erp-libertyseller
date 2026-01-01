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
import { AlertTriangle, ExternalLink, Clock, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Users, Plus, Trash2, Target, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useRouter } from 'next/navigation'
import { AddManualHoursModal } from './AddManualHoursModal'
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

interface TrackerReport {
  id: string
  employee_id: string
  report_date: string
  created_at?: string
  logs: TrackerLog[]
}

interface TrackerDashboardProps {
  employees: string[]
}

// Colores por categoría
const categoryColors: Record<string, string> = {
  'linkedin': '#3b82f6', // Azul
  'amazon': '#FF6600', // Naranja corporativo
  'navegación': '#f59e0b', // Amarillo
  'Prospecting': '#3b82f6', // Azul (mantener compatibilidad)
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
  const router = useRouter()
  const [selectedEmployee, setSelectedEmployee] = useState<string>(employees[0] || '')
  const [selectedDate, setSelectedDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'))
  const [viewMode, setViewMode] = useState<'day' | 'week'>('week')
  const [reports, setReports] = useState<TrackerReport[]>([])
  const [loading, setLoading] = useState(true)
  const [isAddHoursModalOpen, setIsAddHoursModalOpen] = useState(false)
  const [selectedDayForHours, setSelectedDayForHours] = useState<Date | null>(null)
  const [deletingDay, setDeletingDay] = useState<string | null>(null)
  const [deletingLog, setDeletingLog] = useState<string | null>(null)
  const [hoveredReport, setHoveredReport] = useState<TrackerReport | null>(null)
  const [showReportModal, setShowReportModal] = useState(false)

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

      // Simplificar: obtener TODOS los reportes del empleado y filtrar por logs después
      // Esto evita problemas de zona horaria con report_date
      const cleanEmployeeId = selectedEmployee.trim()
      
      console.log('🔍 [TRACKER] Buscando TODOS los reportes del empleado:', {
        employee: cleanEmployeeId,
        selectedDate_start: format(startDate, 'yyyy-MM-dd'),
        selectedDate_end: format(endDate, 'yyyy-MM-dd')
      })

      // Obtener todos los reportes del empleado (sin filtrar por fecha)
      const { data: allReportsData, error: reportsError } = await supabase
        .from('tracker_reports')
        .select('id, employee_id, report_date, created_at')
        .eq('employee_id', cleanEmployeeId)
        .order('report_date', { ascending: true })

      console.log('📋 [TRACKER] Todos los reportes del empleado:', allReportsData?.length || 0)

      if (reportsError) {
        console.error('❌ [TRACKER] Error loading reports:', reportsError)
        throw reportsError
      }

      // Si no hay reportes, no hay nada que mostrar
      if (!allReportsData || allReportsData.length === 0) {
        console.log('⚠️ [TRACKER] No se encontraron reportes para:', { employee: selectedEmployee })
        setReports([])
        setLoading(false)
        return
      }

      // Obtener los IDs de todos los reportes
      const reportIds = allReportsData.map(r => r.id)
      
      console.log('📊 [TRACKER] Total reportes encontrados:', allReportsData.length, 'IDs:', reportIds)

      // Obtener logs con un rango amplio y luego filtrar por fecha local
      const logsStartDate = new Date(startDate)
      logsStartDate.setUTCHours(0, 0, 0, 0)
      logsStartDate.setUTCDate(logsStartDate.getUTCDate() - 1) // -1 día para estar seguros
      
      const logsEndDate = new Date(endDate)
      logsEndDate.setUTCHours(23, 59, 59, 999)
      logsEndDate.setUTCDate(logsEndDate.getUTCDate() + 1) // +1 día para estar seguros

      console.log('🔍 [TRACKER] Buscando logs:', {
        reportIds: reportIds.length,
        logsStartDate: logsStartDate.toISOString(),
        logsEndDate: logsEndDate.toISOString(),
        selectedDate_start: format(startDate, 'yyyy-MM-dd'),
        selectedDate_end: format(endDate, 'yyyy-MM-dd')
      })

      const { data: allLogsData, error: logsError } = await supabase
        .from('tracker_logs')
        .select('*')
        .in('report_id', reportIds)
        .gte('start_time', logsStartDate.toISOString())
        .lte('start_time', logsEndDate.toISOString())
        .order('start_time', { ascending: true })

      if (logsError) {
        console.error('❌ [TRACKER] Error loading logs:', logsError)
        throw logsError
      }

      // Filtrar logs que realmente correspondan a los días seleccionados (fecha local)
      // Crear un set de días válidos para comparación rápida
      const validDays = new Set<string>()
      for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        validDays.add(format(d, 'yyyy-MM-dd'))
      }
      
      console.log('📅 [TRACKER] Días válidos para filtrar:', Array.from(validDays))
      
      const logsData = (allLogsData || []).filter(log => {
        const logDate = new Date(log.start_time)
        const logDateLocal = format(logDate, 'yyyy-MM-dd')
        const isValid = validDays.has(logDateLocal)
        
        // Loggear algunos ejemplos para debugging
        if (allLogsData && allLogsData.length > 0 && allLogsData.length < 20) {
          console.log('🔍 [TRACKER] Log:', {
            start_time: log.start_time,
            date_local: logDateLocal,
            isValid,
            in_valid_days: validDays.has(logDateLocal)
          })
        }
        
        return isValid
      })
      
      console.log('📊 [TRACKER] Logs encontrados:', {
        total: allLogsData?.length || 0,
        filtered: logsData.length,
        sample: logsData.slice(0, 3).map(l => ({
          start_time: l.start_time,
          date_local: format(new Date(l.start_time), 'yyyy-MM-dd')
        }))
      })

      // Si no hay logs, no hay nada que mostrar
      if (!logsData || logsData.length === 0) {
        console.log('⚠️ [TRACKER] No se encontraron logs para los reportes:', reportIds)
        setReports([])
        setLoading(false)
        return
      }

      // Agrupar logs por reporte, pero solo incluir reportes que tengan logs en el rango de fechas seleccionado
      const reportsWithLogs: TrackerReport[] = allReportsData
        .map(report => ({
        ...report,
        logs: (logsData || []).filter(log => log.report_id === report.id)
        }))
        .filter(report => report.logs.length > 0) // Solo reportes con logs en el rango

      console.log('✅ [TRACKER] Reportes con logs en el rango:', reportsWithLogs.length)
      console.log('📊 [TRACKER] Total logs en reportes:', reportsWithLogs.reduce((sum, r) => sum + r.logs.length, 0))

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
      linkedin: number
      amazon: number
      'navegación': number
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
        linkedin: 0,
        amazon: 0,
        'navegación': 0,
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

  // Formatear hora (ajustada a zona horaria de Colombia UTC-5, pero usando -6h como indicado)
  const formatTime = (dateString: string): string => {
    const date = parseISO(dateString)
    // Ajustar a hora de Colombia: restar 6 horas (21600000 ms)
    const colombiaTime = new Date(date.getTime() - (6 * 60 * 60 * 1000))
    return format(colombiaTime, 'HH:mm', { locale: es })
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
      const filteredReports = dayReports.map(report => ({
        ...report,
        logs: report.logs.filter(log => {
          const logDate = parseISO(log.start_time)
          return isSameDay(logDate, day)
        })
      })).filter(report => report.logs.length > 0)
      
      // Ordenar por fecha de creación (más antiguo primero) para numerar correctamente
      filteredReports.sort((a, b) => {
        const dateA = new Date(a.created_at || 0).getTime()
        const dateB = new Date(b.created_at || 0).getTime()
        return dateA - dateB
      })
      
      grouped[dayKey] = filteredReports
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
      // Calcular tiempo total como diferencia entre primera hora de inicio y última hora de fin
      let totalSeconds = 0
      if (logs.length > 0) {
        // Ordenar logs por start_time
        const sortedLogs = [...logs].sort((a, b) => 
          new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
        )
        
        const firstLog = sortedLogs[0]
        const lastLog = sortedLogs[sortedLogs.length - 1]
        
        const firstStartTime = new Date(firstLog.start_time).getTime()
        // Usar end_time si existe, sino usar start_time + duration_seconds
        const lastEndTime = lastLog.end_time 
          ? new Date(lastLog.end_time).getTime()
          : new Date(lastLog.start_time).getTime() + (lastLog.duration_seconds * 1000)
        
        // Calcular diferencia en segundos
        totalSeconds = Math.floor((lastEndTime - firstStartTime) / 1000)
        
        // Asegurarse de que no sea negativo
        if (totalSeconds < 0) {
          totalSeconds = 0
        }
      }
      
      // Calcular por categoría (mantener suma de duraciones para las categorías)
      const byCategory: Record<string, number> = {}
      logs.forEach(log => {
        const category = log.category || 'Other'
        byCategory[category] = (byCategory[category] || 0) + log.duration_seconds
      })
      
      stats[dayKey] = { totalSeconds, byCategory }
    })
    
    return stats
  }, [logsByDay, viewMode])


  // Calcular rango de horas de un reporte
  const getReportTimeRange = (report: TrackerReport): string => {
    if (report.logs.length === 0) return 'Sin datos'
    
    const times = report.logs.map(log => parseISO(log.start_time))
    const minTime = new Date(Math.min(...times.map(t => t.getTime())))
    const maxTime = new Date(Math.max(...times.map(t => t.getTime())))
    
    // Ajustar a hora de Colombia: restar 6 horas
    const minTimeColombia = new Date(minTime.getTime() - (6 * 60 * 60 * 1000))
    const maxTimeColombia = new Date(maxTime.getTime() - (6 * 60 * 60 * 1000))
    
    const minHour = format(minTimeColombia, 'HH:mm')
    const maxHour = format(maxTimeColombia, 'HH:mm')
    
    // Si es el mismo rango, mostrar solo una hora
    if (minHour === maxHour) {
      return `${format(minTimeColombia, 'HH')}h`
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

  // Obtener hora de inicio del primer log de un reporte
  const getReportStartTime = (report: TrackerReport): string | null => {
    if (report.logs.length === 0) return null
    const sortedLogs = [...report.logs].sort((a, b) => 
      new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
    )
    return formatTime(sortedLogs[0].start_time)
  }

  // Obtener hora de fin del último log de un reporte
  const getReportEndTime = (report: TrackerReport): string | null => {
    if (report.logs.length === 0) return null
    const sortedLogs = [...report.logs].sort((a, b) => {
      const aEnd = a.end_time ? new Date(a.end_time).getTime() : new Date(a.start_time).getTime() + (a.duration_seconds * 1000)
      const bEnd = b.end_time ? new Date(b.end_time).getTime() : new Date(b.start_time).getTime() + (b.duration_seconds * 1000)
      return bEnd - aEnd
    })
    const lastLog = sortedLogs[0]
    if (lastLog.end_time) {
      return formatTime(lastLog.end_time)
    }
    const endTime = new Date(lastLog.start_time)
    endTime.setSeconds(endTime.getSeconds() + lastLog.duration_seconds)
    return formatTime(endTime.toISOString())
  }

  // Calcular ganancia de un reporte
  const calculateReportEarnings = (report: TrackerReport): number => {
    const totalSeconds = getReportTotalSeconds(report)
    return calculateDailyEarnings(totalSeconds, selectedEmployee)
  }

  const navigateWeek = (direction: 'prev' | 'next') => {
    const selected = parseISO(selectedDate)
    const weekStart = startOfWeek(selected, { weekStartsOn: 1 })
    const newDate = direction === 'prev' 
      ? addDays(weekStart, -7)
      : addDays(weekStart, 7)
    setSelectedDate(format(newDate, 'yyyy-MM-dd'))
  }

  const handleDeleteDay = async (day: Date) => {
    const dayKey = format(day, 'yyyy-MM-dd')
    const dayStart = startOfDay(day)
    const dayEnd = endOfDay(day)

    if (!confirm(`¿Estás seguro de que quieres eliminar todas las horas registradas del ${format(day, "dd 'de' MMMM 'de' yyyy", { locale: es })}?`)) {
      return
    }

    setDeletingDay(dayKey)
    try {
      // Usar función SQL con SECURITY DEFINER para bypassear RLS
      const { data: deletedCount, error: deleteError } = await supabase.rpc('delete_tracker_reports', {
        p_employee_id: selectedEmployee,
        p_day_start: dayStart.toISOString(),
        p_day_end: dayEnd.toISOString()
      })

      if (deleteError) throw deleteError

      const count = deletedCount || 0
      if (count > 0) {
        toast.success(`Se eliminaron todas las horas del ${format(day, "dd 'de' MMMM", { locale: es })}`)
        loadData() // Recargar datos
      } else {
        toast.info('No hay horas registradas para eliminar en este día')
      }
    } catch (error: any) {
      console.error('Error deleting day:', error)
      toast.error(`Error al eliminar las horas: ${error.message || 'Error desconocido'}`)
    } finally {
      setDeletingDay(null)
    }
  }

  const handleDeleteLog = async (logId: string) => {
    if (!confirm('¿Estás seguro de que quieres eliminar este registro?')) {
      return
    }

    setDeletingLog(logId)
    try {
      // Usar función SQL con SECURITY DEFINER para bypassear RLS
      const { data: deleted, error: deleteError } = await supabase.rpc('delete_tracker_log', {
        p_log_id: logId
      })

      if (deleteError) throw deleteError

      if (deleted) {
        toast.success('Registro eliminado correctamente')
        loadData() // Recargar datos
      } else {
        toast.error('No se pudo eliminar el registro')
      }
    } catch (error: any) {
      console.error('Error deleting log:', error)
      toast.error(`Error al eliminar el registro: ${error.message || 'Error desconocido'}`)
    } finally {
      setDeletingLog(null)
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-white">Employee Tracker</h1>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => router.push('/dashboard/tracker/performance')}
            className="bg-[#FF6600] hover:bg-[#FF8533] text-white"
          >
            <Target className="h-4 w-4 mr-2" />
            Gestionar Rendimiento
          </Button>
        <Button
          onClick={() => router.push('/dashboard/tracker/employees')}
          className="bg-[#FF6600] hover:bg-[#FF8533] text-white"
        >
          <Users className="h-4 w-4 mr-2" />
          Gestión de Empleados
        </Button>
        </div>
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
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelectedDayForHours(day)
                          setIsAddHoursModalOpen(true)
                        }}
                        className="text-[#FF6600] hover:text-[#FF6600] hover:bg-[#FF6600]/10 border border-[#FF6600]/30"
                        title="Añadir horas manuales"
                      >
                        <Plus className="h-4 w-4 mr-1" />
                        Añadir Horas
                      </Button>
                      {stats.totalSeconds > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteDay(day)}
                          disabled={deletingDay === dayKey}
                          className="text-red-500 hover:text-red-600 hover:bg-red-500/10 border border-red-500/30"
                          title="Eliminar todas las horas de este día"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
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

                  {/* Lista de todos los paquetes (reportes) del día */}
                  {dayReports.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-white/10">
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {dayReports.map((report) => {
                          const reportStartTime = getReportStartTime(report)
                          const reportEndTime = getReportEndTime(report)
                          const reportTotalSeconds = getReportTotalSeconds(report)
                          const reportEarnings = calculateReportEarnings(report)
                          const reportHours = calculateHours(reportTotalSeconds)
                          const uploadTime = report.created_at ? formatTime(report.created_at) : null
                          const categoryStats = getReportCategoryStats(report)

                          return (
                            <div
                              key={report.id}
                              className="relative group"
                            >
                              <Card className="glass-card border-white/10 transition-all">
                                <CardContent className="p-4">
                                  <div className="space-y-2">
                                    {/* Hora de subida */}
                                    {uploadTime && (
                                      <div className="flex items-center gap-2 text-xs text-white/60">
                                        <Clock className="h-3 w-3" />
                                        <span>Subido: {uploadTime}</span>
                                      </div>
                                    )}
                                    
                                    {/* Rango de horas */}
                                    <div className="flex items-center gap-2">
                                      <Clock className="h-4 w-4 text-[#FF6600]" />
                                      <div className="flex-1">
                                        <div className="text-sm font-medium text-white">
                                          {reportStartTime && reportEndTime ? (
                                            `${reportStartTime} - ${reportEndTime}`
                                          ) : reportStartTime ? (
                                            `Desde ${reportStartTime}`
                                          ) : (
                                            'Sin datos'
                                          )}
                                        </div>
                                        <div className="text-xs text-white/70">
                                          {formatHours(reportTotalSeconds)}
                                        </div>
                                      </div>
                                    </div>

                                    {/* Ganancia del paquete */}
                                    {(() => {
                                      const hourlyRate = hourlyRates[report.employee_id] || 0
                                      return hourlyRate > 0 && reportTotalSeconds > 0 && (
                                        <div className="flex items-center justify-between px-2 py-1 rounded bg-[#FF6600]/10 border border-[#FF6600]/20">
                                          <span className="text-xs text-white/70">Ganancia:</span>
                                          <span className="text-sm font-semibold text-[#FF6600]">
                                            ${reportEarnings.toFixed(2)}
                                          </span>
                                        </div>
                                      )
                                    })()}

                                    {/* Resumen por categoría (mini) */}
                                    {Object.keys(categoryStats).length > 0 && (
                                      <div className="flex flex-wrap gap-1 pt-1">
                                        {Object.entries(categoryStats).slice(0, 3).map(([category, seconds]) => (
                                          <div
                                            key={category}
                                            className="flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-white/5 border border-white/10"
                                          >
                                            <div
                                              className="w-2 h-2 rounded-full"
                                              style={{ backgroundColor: categoryColors[category] || categoryColors.Other }}
                                            />
                                            <span className="text-white/70">{category}</span>
                                            <span className="text-white/90 font-medium">
                                              {Math.floor(seconds / 60)}m
                                            </span>
                                          </div>
                                        ))}
                                        {Object.keys(categoryStats).length > 3 && (
                                          <div className="text-xs text-white/50 px-2 py-0.5">
                                            +{Object.keys(categoryStats).length - 3} más
                                          </div>
                                        )}
                                      </div>
                                    )}

                                    {/* Botón para ver detalles */}
                                    <Button
                                      onClick={() => {
                                        setHoveredReport(report)
                                        setShowReportModal(true)
                                      }}
                                      variant="outline"
                                      size="sm"
                                      className="w-full mt-2 border-[#FF6600]/30 text-[#FF6600] hover:bg-[#FF6600]/10 hover:text-[#FF6600]"
                                    >
                                      Ver detalles
                                    </Button>
                                  </div>
                                </CardContent>
                              </Card>
                            </div>
                          )
                        })}
                      </div>
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
                  <Bar dataKey="linkedin" stackId="a" fill={categoryColors.linkedin} />
                  <Bar dataKey="amazon" stackId="a" fill={categoryColors.amazon} />
                  <Bar dataKey="navegación" stackId="a" fill={categoryColors['navegación']} />
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
            <CardTitle className="text-white">Detalles de Búsquedas</CardTitle>
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
                      <TableHead className="text-white/70">Hora Fin</TableHead>
                      <TableHead className="text-white/70">Duración (s)</TableHead>
                      <TableHead className="text-white/70">Búsqueda</TableHead>
                      <TableHead className="text-white/70">Categoría</TableHead>
                      <TableHead className="text-white/70">Link</TableHead>
                      <TableHead className="text-white/70">Acciones</TableHead>
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
                          {log.end_time ? (
                            <div className="flex items-center gap-2">
                              <Clock className="h-4 w-4 text-white/50" />
                              {formatTime(log.end_time)}
                            </div>
                          ) : (
                            <span className="text-white/50">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-white/90 font-medium">
                          {log.duration_seconds}s
                        </TableCell>
                        <TableCell className="text-white/90">
                          {log.title || log.domain}
                        </TableCell>
                        <TableCell>
                          <span
                            className={cn(
                              "px-2 py-1 rounded text-xs font-medium",
                              (log.category === 'linkedin' || log.category === 'Prospecting') && "bg-blue-500/20 text-blue-300",
                              log.category === 'amazon' && "bg-[#FF6600]/20 text-[#FF8533]",
                              log.category === 'navegación' && "bg-yellow-500/20 text-yellow-300",
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
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteLog(log.id)}
                            disabled={deletingLog === log.id}
                            className="h-8 px-2 text-red-500 hover:text-red-600 hover:bg-red-500/10"
                            title="Eliminar registro"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
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

      {/* Modal de detalles del paquete (hover) */}
      {showReportModal && hoveredReport && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm report-modal"
          onMouseEnter={() => setShowReportModal(true)}
          onMouseLeave={() => {
            setShowReportModal(false)
            setHoveredReport(null)
          }}
        >
          <div
            className="glass-card p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto rounded-lg"
            onMouseEnter={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-white">Detalles del Paquete</h2>
              <button
                onClick={() => {
                  setShowReportModal(false)
                  setHoveredReport(null)
                }}
                className="text-white/40 hover:text-white transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Información del paquete */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white/5 p-3 rounded-lg border border-white/10">
                  <div className="text-xs text-white/60 mb-1">Hora de Subida</div>
                  <div className="text-sm font-medium text-white">
                    {hoveredReport.created_at ? formatTime(hoveredReport.created_at) : 'N/A'}
                  </div>
                </div>
                <div className="bg-white/5 p-3 rounded-lg border border-white/10">
                  <div className="text-xs text-white/60 mb-1">Hora Inicio</div>
                  <div className="text-sm font-medium text-white">
                    {getReportStartTime(hoveredReport) || 'N/A'}
                  </div>
                </div>
                <div className="bg-white/5 p-3 rounded-lg border border-white/10">
                  <div className="text-xs text-white/60 mb-1">Hora Final</div>
                  <div className="text-sm font-medium text-white">
                    {getReportEndTime(hoveredReport) || 'N/A'}
                  </div>
                </div>
                <div className="bg-white/5 p-3 rounded-lg border border-white/10">
                  <div className="text-xs text-white/60 mb-1">Duración Total</div>
                  <div className="text-sm font-medium text-white">
                    {formatHours(getReportTotalSeconds(hoveredReport))}
                  </div>
                </div>
              </div>

              {/* Ganancia del paquete */}
              {(() => {
                const hourlyRate = hourlyRates[hoveredReport.employee_id] || 0
                return hourlyRate > 0 && getReportTotalSeconds(hoveredReport) > 0 && (
                  <div className="bg-[#FF6600]/10 border border-[#FF6600]/30 p-4 rounded-lg">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-white/70">Ganancia del Paquete:</span>
                      <span className="text-lg font-semibold text-[#FF6600]">
                        ${calculateReportEarnings(hoveredReport).toFixed(2)}
                      </span>
                    </div>
                    <div className="text-xs text-white/50 mt-1">
                      {calculateHours(getReportTotalSeconds(hoveredReport)).toFixed(2)}h × ${hourlyRate}/h
                    </div>
                  </div>
                )
              })()}

              {/* Resumen por categoría */}
              {Object.keys(getReportCategoryStats(hoveredReport)).length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-white/70 mb-2">Resumen por Categoría</h3>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(getReportCategoryStats(hoveredReport)).map(([category, seconds]) => (
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
                </div>
              )}

              {/* Tabla de logs del paquete */}
              <div>
                <h3 className="text-sm font-medium text-white/70 mb-2">
                  Actividades ({hoveredReport.logs.length} registros)
                </h3>
                <div className="overflow-x-auto max-h-[400px]">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-white/10">
                        <TableHead className="text-white/70 text-xs">Hora Inicio</TableHead>
                        <TableHead className="text-white/70 text-xs">Hora Fin</TableHead>
                        <TableHead className="text-white/70 text-xs">Duración</TableHead>
                        <TableHead className="text-white/70 text-xs">Actividad</TableHead>
                        <TableHead className="text-white/70 text-xs">Categoría</TableHead>
                        <TableHead className="text-white/70 text-xs">Link</TableHead>
                        <TableHead className="text-white/70 text-xs">Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {hoveredReport.logs.map((log) => (
                        <TableRow key={log.id} className="border-white/10">
                          <TableCell className="text-white/90 text-xs">
                            <div className="flex items-center gap-2">
                              <Clock className="h-3 w-3 text-white/50" />
                              {formatTime(log.start_time)}
                            </div>
                          </TableCell>
                          <TableCell className="text-white/90 text-xs">
                            {log.end_time ? (
                              <div className="flex items-center gap-2">
                                <Clock className="h-3 w-3 text-white/50" />
                                {formatTime(log.end_time)}
                              </div>
                            ) : (
                              <span className="text-white/50">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-white/90 text-xs font-medium">
                            {formatDuration(log.duration_seconds)}
                          </TableCell>
                          <TableCell className="text-white/90 text-xs">
                            {log.title || log.domain}
                          </TableCell>
                          <TableCell>
                            <span
                              className={cn(
                                "px-2 py-0.5 rounded text-xs font-medium",
                                (log.category === 'linkedin' || log.category === 'Prospecting') && "bg-blue-500/20 text-blue-300",
                                log.category === 'amazon' && "bg-[#FF6600]/20 text-[#FF8533]",
                                log.category === 'navegación' && "bg-yellow-500/20 text-yellow-300",
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
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteLog(log.id)}
                              disabled={deletingLog === log.id}
                              className="h-7 px-2 text-red-500 hover:text-red-600 hover:bg-red-500/10"
                              title="Eliminar registro"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal para añadir horas manuales */}
      {selectedDayForHours && (
        <AddManualHoursModal
          open={isAddHoursModalOpen}
          onClose={() => {
            setIsAddHoursModalOpen(false)
            setSelectedDayForHours(null)
          }}
          onSuccess={() => {
            loadData()
          }}
          employeeId={selectedEmployee}
          date={selectedDayForHours}
        />
      )}
    </div>
  )
}

