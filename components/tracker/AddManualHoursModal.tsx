'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Save, X, Clock } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { toast } from 'sonner'

interface AddManualHoursModalProps {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  employeeId: string
  date: Date
}

const categoryOptions = [
  { value: 'Prospecting', label: 'Prospecting', domain: 'linkedin.com' },
  { value: 'Communication', label: 'Communication', domain: 'gmail.com' },
  { value: 'Productivity', label: 'Productivity', domain: 'notion.so' },
  { value: 'Other', label: 'Other', domain: 'other.com' },
]

export function AddManualHoursModal({
  open,
  onClose,
  onSuccess,
  employeeId,
  date,
}: AddManualHoursModalProps) {
  const [startTime, setStartTime] = useState('09:00')
  const [durationHours, setDurationHours] = useState('1')
  const [durationMinutes, setDurationMinutes] = useState('0')
  const [category, setCategory] = useState('Other')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const supabase = createClient()

  const handleSave = async () => {
    if (!startTime || !durationHours || !category) {
      toast.error('Por favor completa todos los campos obligatorios')
      return
    }

    const hours = parseInt(durationHours) || 0
    const minutes = parseInt(durationMinutes) || 0
    const totalMinutes = hours * 60 + minutes

    if (totalMinutes <= 0) {
      toast.error('La duración debe ser mayor a 0')
      return
    }

    setSaving(true)
    try {
      // Crear fecha/hora de inicio combinando la fecha del día con la hora seleccionada
      const [hour, minute] = startTime.split(':').map(Number)
      const startDateTime = new Date(date)
      startDateTime.setHours(hour, minute, 0, 0)

      // Calcular fecha/hora de fin
      const endDateTime = new Date(startDateTime)
      endDateTime.setMinutes(endDateTime.getMinutes() + totalMinutes)

      // Obtener dominio según la categoría
      const selectedCategory = categoryOptions.find(c => c.value === category)
      const domain = selectedCategory?.domain || 'other.com'
      const url = `https://${domain}${title ? `/${title.toLowerCase().replace(/\s+/g, '-')}` : ''}`

      // Redondear report_date a la hora para usar el reporte existente o crear uno nuevo
      const reportDate = new Date(startDateTime)
      reportDate.setMinutes(0, 0, 0)

      // Buscar o crear reporte para esta hora
      let reportId: string

      // Buscar reporte existente para esta hora
      const { data: existingReports } = await supabase
        .from('tracker_reports')
        .select('id')
        .eq('employee_id', employeeId)
        .gte('report_date', new Date(reportDate.getTime() - 60 * 60 * 1000).toISOString())
        .lte('report_date', new Date(reportDate.getTime() + 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      if (existingReports) {
        reportId = existingReports.id
      } else {
        // Crear nuevo reporte
        const { data: newReport, error: reportError } = await supabase.rpc('insert_tracker_report', {
          p_employee_id: employeeId,
          p_report_date: reportDate.toISOString(),
        })

        if (reportError || !newReport || newReport.length === 0) {
          throw new Error(reportError?.message || 'Error al crear el reporte')
        }

        reportId = newReport[0].id
      }

      // Insertar el log
      const durationSeconds = totalMinutes * 60
      const { error: logError } = await supabase.rpc('insert_tracker_log', {
        p_report_id: reportId,
        p_domain: domain,
        p_url: url,
        p_title: title || description || `Actividad manual - ${category}`,
        p_duration_seconds: durationSeconds,
        p_start_time: startDateTime.toISOString(),
        p_end_time: endDateTime.toISOString(),
      })

      if (logError) {
        throw new Error(logError.message || 'Error al crear el log')
      }

      toast.success(`Horas añadidas correctamente: ${hours}h ${minutes > 0 ? `${minutes}m` : ''}`)
      onSuccess()
      onClose()
      
      // Resetear formulario
      setStartTime('09:00')
      setDurationHours('1')
      setDurationMinutes('0')
      setCategory('Other')
      setTitle('')
      setDescription('')
    } catch (error: any) {
      console.error('Error adding manual hours:', error)
      toast.error(error.message || 'Error al añadir las horas')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-[#080808] border-white/10 backdrop-blur-md max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-white">
            Añadir Horas Manuales
          </DialogTitle>
          <DialogDescription className="text-white/60">
            Añade horas de trabajo para el día {format(date, "dd 'de' MMMM 'de' yyyy", { locale: es })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {/* Hora de inicio */}
          <div>
            <Label htmlFor="startTime" className="text-sm font-semibold text-white mb-2 block">
              <Clock className="h-4 w-4 inline mr-2 text-[#FF6600]" />
              Hora de Inicio
            </Label>
            <Input
              id="startTime"
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="input-glass"
            />
          </div>

          {/* Duración */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="durationHours" className="text-sm font-semibold text-white mb-2 block">
                Horas
              </Label>
              <Input
                id="durationHours"
                type="number"
                min="0"
                max="24"
                value={durationHours}
                onChange={(e) => setDurationHours(e.target.value)}
                placeholder="0"
                className="input-glass"
              />
            </div>
            <div>
              <Label htmlFor="durationMinutes" className="text-sm font-semibold text-white mb-2 block">
                Minutos
              </Label>
              <Input
                id="durationMinutes"
                type="number"
                min="0"
                max="59"
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value)}
                placeholder="0"
                className="input-glass"
              />
            </div>
          </div>

          {/* Categoría */}
          <div>
            <Label htmlFor="category" className="text-sm font-semibold text-white mb-2 block">
              Categoría
            </Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="input-glass">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#080808] border-white/10">
                {categoryOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value} className="text-white">
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Título/Actividad */}
          <div>
            <Label htmlFor="title" className="text-sm font-semibold text-white mb-2 block">
              Título de la Actividad (Opcional)
            </Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ej: Reunión con cliente, Trabajo en proyecto X"
              className="input-glass"
            />
          </div>

          {/* Descripción */}
          <div>
            <Label htmlFor="description" className="text-sm font-semibold text-white mb-2 block">
              Descripción (Opcional)
            </Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Detalles adicionales sobre la actividad..."
              className="input-glass min-h-[80px]"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              onClick={onClose}
              className="flex-1 border-white/20 hover:border-white/40"
              disabled={saving}
            >
              <X className="h-4 w-4 mr-2" />
              Cancelar
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 bg-[#FF6600]/20 border-2 border-[#FF6600] text-[#FF6600] hover:bg-[#FF6600]/30 hover:border-[#FF6600]/80"
            >
              <Save className="h-4 w-4 mr-2" />
              {saving ? 'Guardando...' : 'Añadir Horas'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

