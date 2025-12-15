'use client'

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { format, parseISO, startOfWeek, addDays, eachDayOfInterval, isSameDay } from 'date-fns'
import { es } from 'date-fns/locale'
import { Plus, Trash2, Edit, DollarSign, Clock, TrendingUp, TrendingDown } from 'lucide-react'
import { toast } from 'sonner'

interface EmployeePaymentAdjustment {
  id: string
  employee_id: string
  week_start_date: string
  adjustment_type: 'commission' | 'bonus' | 'deduction' | 'hourly_rate_override'
  amount: number
  description: string | null
  created_at: string
  updated_at: string
}

interface WeeklyEarnings {
  weekStart: string
  totalHours: number
  baseEarnings: number
  adjustments: EmployeePaymentAdjustment[]
  totalEarnings: number
}

// Sueldo por hora de cada empleado (en dólares)
const hourlyRates: Record<string, number> = {
  'Alejandro': 2.44,
  // Agregar más empleados aquí cuando sea necesario
}

interface EmployeeManagementProps {
  employees: string[]
}

export function EmployeeManagement({ employees }: EmployeeManagementProps) {
  const supabase = createClient()
  const [selectedEmployee, setSelectedEmployee] = useState<string>(employees[0] || '')
  const [selectedWeek, setSelectedWeek] = useState<string>(format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd'))
  const [adjustments, setAdjustments] = useState<EmployeePaymentAdjustment[]>([])
  const [loading, setLoading] = useState(true)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingAdjustment, setEditingAdjustment] = useState<EmployeePaymentAdjustment | null>(null)
  const [weeklyEarnings, setWeeklyEarnings] = useState<WeeklyEarnings[]>([])

  // Formulario de ajuste
  const [formData, setFormData] = useState({
    adjustment_type: 'commission' as 'commission' | 'bonus' | 'deduction' | 'hourly_rate_override',
    amount: '',
    description: '',
    week_start_date: selectedWeek
  })

  // Cargar ajustes y datos de la semana
  useEffect(() => {
    if (selectedEmployee && selectedWeek) {
      loadData()
    }
  }, [selectedEmployee, selectedWeek])

  const loadData = async () => {
    if (!selectedEmployee || !selectedWeek) return

    setLoading(true)
    try {
      // Cargar ajustes de pago (manejar caso donde la tabla no existe aún)
      let adjustmentsData: EmployeePaymentAdjustment[] = []
      const { data, error: adjustmentsError } = await supabase
        .from('employee_payment_adjustments')
        .select('*')
        .eq('employee_id', selectedEmployee)
        .eq('week_start_date', selectedWeek)
        .order('created_at', { ascending: true })

      if (adjustmentsError) {
        // Si la tabla no existe, simplemente continuar con array vacío
        if (adjustmentsError.code === '42P01' || adjustmentsError.message.includes('does not exist')) {
          console.warn('Tabla employee_payment_adjustments no existe aún. Ejecuta la migración 024_create_employee_payment_adjustments.sql')
          adjustmentsData = []
        } else {
          throw adjustmentsError
        }
      } else {
        adjustmentsData = data || []
      }
      
      setAdjustments(adjustmentsData)

      // Cargar datos de tracking de la semana
      const weekStart = parseISO(selectedWeek)
      const weekEnd = addDays(weekStart, 6)
      
      const { data: reportsData } = await supabase
        .from('tracker_reports')
        .select('id, report_date')
        .eq('employee_id', selectedEmployee)
        .gte('report_date', weekStart.toISOString())
        .lte('report_date', weekEnd.toISOString())

      if (reportsData && reportsData.length > 0) {
        const reportIds = reportsData.map(r => r.id)
        const { data: logsData } = await supabase
          .from('tracker_logs')
          .select('duration_seconds')
          .in('report_id', reportIds)

        const totalSeconds = logsData?.reduce((sum, log) => sum + log.duration_seconds, 0) || 0
        const totalHours = totalSeconds / 3600
        const hourlyRate = hourlyRates[selectedEmployee] || 0
        const baseEarnings = totalHours * hourlyRate

        const adjustmentsTotal = (adjustmentsData || []).reduce((sum, adj) => {
          if (adj.adjustment_type === 'deduction') {
            return sum - adj.amount
          }
          return sum + adj.amount
        }, 0)

        setWeeklyEarnings([{
          weekStart: selectedWeek,
          totalHours,
          baseEarnings,
          adjustments: adjustmentsData,
          totalEarnings: baseEarnings + adjustmentsTotal
        }])
      } else {
        setWeeklyEarnings([{
          weekStart: selectedWeek,
          totalHours: 0,
          baseEarnings: 0,
          adjustments: adjustmentsData,
          totalEarnings: adjustmentsData.reduce((sum, adj) => {
            if (adj.adjustment_type === 'deduction') {
              return sum - adj.amount
            }
            return sum + adj.amount
          }, 0)
        }])
      }
    } catch (error: any) {
      console.error('Error loading data:', error)
      const errorMessage = error?.message || 'Error desconocido'
      const errorCode = error?.code || 'UNKNOWN'
      
      // Mostrar error más descriptivo
      if (errorCode === '42P01' || errorMessage.includes('does not exist')) {
        toast.error('La tabla de ajustes no existe. Ejecuta la migración 024_create_employee_payment_adjustments.sql en Supabase')
      } else if (errorCode === '42501' || errorMessage.includes('permission denied')) {
        toast.error('No tienes permisos para acceder a esta tabla')
      } else {
        toast.error(`Error al cargar los datos: ${errorMessage}`)
      }
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.amount || parseFloat(formData.amount) <= 0) {
      toast.error('El monto debe ser mayor a 0')
      return
    }

    try {
      if (editingAdjustment) {
        // Actualizar ajuste existente
        const { error } = await supabase
          .from('employee_payment_adjustments')
          .update({
            adjustment_type: formData.adjustment_type,
            amount: parseFloat(formData.amount),
            description: formData.description || null,
            week_start_date: formData.week_start_date
          })
          .eq('id', editingAdjustment.id)

        if (error) {
          if (error.code === '42P01' || error.message.includes('does not exist')) {
            throw new Error('La tabla de ajustes no existe. Ejecuta la migración 024_create_employee_payment_adjustments.sql en Supabase')
          }
          throw error
        }
        toast.success('Ajuste actualizado correctamente')
      } else {
        // Crear nuevo ajuste
        const { error } = await supabase
          .from('employee_payment_adjustments')
          .insert({
            employee_id: selectedEmployee,
            adjustment_type: formData.adjustment_type,
            amount: parseFloat(formData.amount),
            description: formData.description || null,
            week_start_date: formData.week_start_date
          })

        if (error) {
          if (error.code === '42P01' || error.message.includes('does not exist')) {
            throw new Error('La tabla de ajustes no existe. Ejecuta la migración 024_create_employee_payment_adjustments.sql en Supabase')
          }
          throw error
        }
        toast.success('Ajuste creado correctamente')
      }

      setIsDialogOpen(false)
      setEditingAdjustment(null)
      setFormData({
        adjustment_type: 'commission',
        amount: '',
        description: '',
        week_start_date: selectedWeek
      })
      loadData()
    } catch (error: any) {
      console.error('Error saving adjustment:', error)
      toast.error(error?.message || 'Error al guardar el ajuste')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('¿Estás seguro de eliminar este ajuste?')) return

    try {
      const { error } = await supabase
        .from('employee_payment_adjustments')
        .delete()
        .eq('id', id)

      if (error) throw error
      toast.success('Ajuste eliminado correctamente')
      loadData()
    } catch (error: any) {
      console.error('Error deleting adjustment:', error)
      toast.error(error?.message || 'Error al eliminar el ajuste')
    }
  }

  const handleEdit = (adjustment: EmployeePaymentAdjustment) => {
    setEditingAdjustment(adjustment)
    setFormData({
      adjustment_type: adjustment.adjustment_type,
      amount: adjustment.amount.toString(),
      description: adjustment.description || '',
      week_start_date: adjustment.week_start_date
    })
    setIsDialogOpen(true)
  }

  const getAdjustmentTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      'commission': 'Comisión',
      'bonus': 'Bono',
      'deduction': 'Deducción',
      'hourly_rate_override': 'Ajuste de Sueldo'
    }
    return labels[type] || type
  }

  const getAdjustmentTypeIcon = (type: string) => {
    if (type === 'deduction') return <TrendingDown className="h-4 w-4 text-red-400" />
    return <TrendingUp className="h-4 w-4 text-green-400" />
  }

  const currentWeekEarnings = weeklyEarnings[0] || {
    weekStart: selectedWeek,
    totalHours: 0,
    baseEarnings: 0,
    adjustments: [],
    totalEarnings: 0
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-white">Gestión de Empleados</h1>
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
              <Label htmlFor="week" className="text-white/70">Semana (Lunes)</Label>
              <Input
                id="week"
                type="date"
                value={selectedWeek}
                onChange={(e) => setSelectedWeek(e.target.value)}
                className="bg-white/[0.05] border-white/10 text-white"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="text-center text-white/50 py-12">Cargando...</div>
      ) : adjustments.length === 0 && weeklyEarnings.length > 0 && weeklyEarnings[0].totalHours === 0 ? (
        <Card className="glass-card border-white/10">
          <CardContent className="pt-6">
            <div className="text-center py-8">
              <p className="text-white/70 mb-2">No hay datos de tracking para esta semana</p>
              <p className="text-white/50 text-sm">Los ajustes de pago se mostrarán aquí una vez que se registren</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Resumen de la Semana */}
          <Card className="glass-card border-white/10">
            <CardHeader>
              <CardTitle className="text-white">
                Resumen Semanal - {format(parseISO(selectedWeek), "dd/MM/yyyy", { locale: es })} a {format(addDays(parseISO(selectedWeek), 6), "dd/MM/yyyy", { locale: es })}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="p-4 rounded-lg bg-white/5 border border-white/10">
                  <div className="flex items-center gap-2 text-white/70 mb-2">
                    <Clock className="h-4 w-4" />
                    <span className="text-sm">Horas Trabajadas</span>
                  </div>
                  <div className="text-2xl font-bold text-white">
                    {currentWeekEarnings.totalHours.toFixed(2)}h
                  </div>
                </div>
                <div className="p-4 rounded-lg bg-white/5 border border-white/10">
                  <div className="flex items-center gap-2 text-white/70 mb-2">
                    <DollarSign className="h-4 w-4" />
                    <span className="text-sm">Ganancia Base</span>
                  </div>
                  <div className="text-2xl font-bold text-white">
                    ${currentWeekEarnings.baseEarnings.toFixed(2)}
                  </div>
                  <div className="text-xs text-white/50 mt-1">
                    {hourlyRates[selectedEmployee] ? `$${hourlyRates[selectedEmployee]}/h` : 'Sin sueldo configurado'}
                  </div>
                </div>
                <div className="p-4 rounded-lg bg-white/5 border border-white/10">
                  <div className="flex items-center gap-2 text-white/70 mb-2">
                    <TrendingUp className="h-4 w-4" />
                    <span className="text-sm">Ajustes</span>
                  </div>
                  <div className="text-2xl font-bold text-white">
                    ${currentWeekEarnings.adjustments.reduce((sum, adj) => {
                      if (adj.adjustment_type === 'deduction') {
                        return sum - adj.amount
                      }
                      return sum + adj.amount
                    }, 0).toFixed(2)}
                  </div>
                  <div className="text-xs text-white/50 mt-1">
                    {currentWeekEarnings.adjustments.length} ajuste(s)
                  </div>
                </div>
                <div className="p-4 rounded-lg bg-[#FF6600]/20 border border-[#FF6600]/30">
                  <div className="flex items-center gap-2 text-white/70 mb-2">
                    <DollarSign className="h-4 w-4" />
                    <span className="text-sm">Total a Pagar</span>
                  </div>
                  <div className="text-2xl font-bold text-[#FF6600]">
                    ${currentWeekEarnings.totalEarnings.toFixed(2)}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Tabla de Ajustes */}
          <Card className="glass-card border-white/10">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-white">Ajustes de Pago</CardTitle>
                <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                  <DialogTrigger asChild>
                    <Button
                      onClick={() => {
                        setEditingAdjustment(null)
                        setFormData({
                          adjustment_type: 'commission',
                          amount: '',
                          description: '',
                          week_start_date: selectedWeek
                        })
                      }}
                      className="bg-[#FF6600] hover:bg-[#FF8533] text-white"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Agregar Ajuste
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="bg-black border-white/10 text-white">
                    <DialogHeader>
                      <DialogTitle className="text-white">
                        {editingAdjustment ? 'Editar Ajuste' : 'Nuevo Ajuste'}
                      </DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleSubmit} className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="type" className="text-white/70">Tipo de Ajuste</Label>
                        <Select
                          value={formData.adjustment_type}
                          onValueChange={(value: any) => setFormData({ ...formData, adjustment_type: value })}
                        >
                          <SelectTrigger id="type" className="bg-white/[0.05] border-white/10 text-white">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="commission">Comisión</SelectItem>
                            <SelectItem value="bonus">Bono</SelectItem>
                            <SelectItem value="deduction">Deducción</SelectItem>
                            <SelectItem value="hourly_rate_override">Ajuste de Sueldo</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="amount" className="text-white/70">Monto ($)</Label>
                        <Input
                          id="amount"
                          type="number"
                          step="0.01"
                          value={formData.amount}
                          onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                          className="bg-white/[0.05] border-white/10 text-white"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="description" className="text-white/70">Descripción</Label>
                        <Textarea
                          id="description"
                          value={formData.description}
                          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                          className="bg-white/[0.05] border-white/10 text-white"
                          rows={3}
                        />
                      </div>
                      <div className="flex gap-2 justify-end">
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => {
                            setIsDialogOpen(false)
                            setEditingAdjustment(null)
                          }}
                          className="text-white/70 hover:text-white"
                        >
                          Cancelar
                        </Button>
                        <Button type="submit" className="bg-[#FF6600] hover:bg-[#FF8533] text-white">
                          {editingAdjustment ? 'Actualizar' : 'Crear'}
                        </Button>
                      </div>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              {adjustments.length === 0 ? (
                <p className="text-white/50 text-center py-8">No hay ajustes registrados para esta semana</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-white/10">
                        <TableHead className="text-white/70">Tipo</TableHead>
                        <TableHead className="text-white/70">Monto</TableHead>
                        <TableHead className="text-white/70">Descripción</TableHead>
                        <TableHead className="text-white/70">Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {adjustments.map((adjustment) => (
                        <TableRow key={adjustment.id} className="border-white/10">
                          <TableCell className="text-white/90">
                            <div className="flex items-center gap-2">
                              {getAdjustmentTypeIcon(adjustment.adjustment_type)}
                              {getAdjustmentTypeLabel(adjustment.adjustment_type)}
                            </div>
                          </TableCell>
                          <TableCell className="text-white/90">
                            <span className={adjustment.adjustment_type === 'deduction' ? 'text-red-400' : 'text-green-400'}>
                              {adjustment.adjustment_type === 'deduction' ? '-' : '+'}${adjustment.amount.toFixed(2)}
                            </span>
                          </TableCell>
                          <TableCell className="text-white/90">
                            {adjustment.description || '-'}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleEdit(adjustment)}
                                className="text-white/70 hover:text-white"
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDelete(adjustment.id)}
                                className="text-red-400/70 hover:text-red-400"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

