'use client'

import { useState } from 'react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { LibertyButton } from '@/components/ui/LibertyButton'
import { X, Trash2, Phone, Mail, Building2, User, Lock, Video } from 'lucide-react'
import { toast } from 'sonner'
import { format } from 'date-fns'
import {
  AppointmentWithPeople,
  AppointmentStatus,
  CalendarPerson,
  APPOINTMENT_STATUS_LABELS,
  colorForAgent,
} from '@/lib/types/appointments'
import { UserProfile } from '@/lib/supabase/get-user-profile'

interface AppointmentSheetProps {
  mode: 'create' | 'edit'
  appointment: AppointmentWithPeople | null
  /** Fecha/hora prefijada al crear pinchando en el calendario */
  prefill?: { start: Date; end: Date } | null
  team: CalendarPerson[]
  currentUser: UserProfile
  onClose: () => void
  onSaved: (appt: AppointmentWithPeople) => void
  onDeleted: (id: string) => void
}

function toDateInput(d: Date) {
  return format(d, 'yyyy-MM-dd')
}
function toTimeInput(d: Date) {
  return format(d, 'HH:mm')
}
function combine(dateStr: string, timeStr: string): Date {
  return new Date(`${dateStr}T${timeStr}:00`)
}

const STATUS_OPTIONS: AppointmentStatus[] = [
  'scheduled',
  'confirmed',
  'completed',
  'cancelled',
  'no_show',
]

export function AppointmentSheet({
  mode,
  appointment,
  prefill,
  team,
  currentUser,
  onClose,
  onSaved,
  onDeleted,
}: AppointmentSheetProps) {
  const initialStart = appointment
    ? new Date(appointment.start_time)
    : prefill?.start ?? new Date()
  const initialEnd = appointment
    ? new Date(appointment.end_time)
    : prefill?.end ?? new Date(Date.now() + 60 * 60 * 1000)

  const [leadName, setLeadName] = useState(appointment?.lead_name ?? '')
  const [leadEmail, setLeadEmail] = useState(appointment?.lead_email ?? '')
  const [leadPhone, setLeadPhone] = useState(appointment?.lead_phone ?? '')
  const [leadCompany, setLeadCompany] = useState(appointment?.lead_company ?? '')
  const [assignedCloser, setAssignedCloser] = useState<string>(
    appointment?.assigned_closer_id ?? 'none'
  )
  const [date, setDate] = useState(toDateInput(initialStart))
  const [startTime, setStartTime] = useState(toTimeInput(initialStart))
  const [endTime, setEndTime] = useState(toTimeInput(initialEnd))
  const [status, setStatus] = useState<AppointmentStatus>(
    appointment?.status ?? 'scheduled'
  )
  const [notes, setNotes] = useState(appointment?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const isAdmin = currentUser.role === 'admin' || currentUser.role === 'partner'
  const isExternal = appointment?.is_external ?? false
  const canEdit =
    !isExternal &&
    (mode === 'create' ||
      isAdmin ||
      appointment?.comercial_id === currentUser.id)

  const closers = team // cualquiera del equipo puede ser el closer asignado

  const handleSave = async () => {
    if (!leadName.trim()) {
      toast.error('El nombre del lead es obligatorio')
      return
    }
    const start = combine(date, startTime)
    const end = combine(date, endTime)
    if (end <= start) {
      toast.error('La hora de fin debe ser posterior a la de inicio')
      return
    }

    setSaving(true)
    try {
      const payload = {
        lead_name: leadName.trim(),
        lead_email: leadEmail.trim() || null,
        lead_phone: leadPhone.trim() || null,
        lead_company: leadCompany.trim() || null,
        assigned_closer_id: assignedCloser === 'none' ? null : assignedCloser,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        status,
        notes: notes.trim() || null,
      }

      const res = await fetch(
        mode === 'create'
          ? '/api/appointments'
          : `/api/appointments/${appointment!.id}`,
        {
          method: mode === 'create' ? 'POST' : 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al guardar')

      toast.success(mode === 'create' ? 'Cita agendada' : 'Cita actualizada')
      onSaved(data as AppointmentWithPeople)
    } catch (err) {
      console.error('Error saving appointment:', err)
      toast.error('Error al guardar la cita')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!appointment) return
    if (!confirm('¿Eliminar esta cita? Esta acción no se puede deshacer.')) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/appointments/${appointment.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Error al eliminar')
      }
      toast.success('Cita eliminada')
      onDeleted(appointment.id)
    } catch (err) {
      console.error('Error deleting appointment:', err)
      toast.error('Error al eliminar la cita')
    } finally {
      setDeleting(false)
    }
  }

  const ownerColor = appointment?.comercial
    ? colorForAgent(appointment.comercial.id, appointment.comercial.calendar_color)
    : colorForAgent(currentUser.id)

  return (
    <Sheet open={true} onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-xl bg-[#080808] border-l border-white/10 overflow-y-auto">
        <SheetHeader className="mb-6">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3">
              <span
                className="mt-1 h-4 w-4 rounded-full flex-shrink-0"
                style={{ backgroundColor: ownerColor }}
              />
              <div>
                <SheetTitle className="text-2xl font-bold text-white mb-1">
                  {mode === 'create' ? 'Nueva cita' : leadName || 'Cita'}
                </SheetTitle>
                <SheetDescription className="text-white/60">
                  {isExternal
                    ? 'Evento ya existente en Google Calendar'
                    : mode === 'edit' && appointment?.comercial
                      ? `Agendada por ${appointment.comercial.full_name || appointment.comercial.email}`
                      : 'Rellena los datos del lead y la franja horaria'}
                </SheetDescription>
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </SheetHeader>

        {!canEdit && (
          <div className="glass-card p-3 mb-4 flex items-center gap-2 text-sm text-white/60">
            <Lock className="h-4 w-4 text-white/40" />
            {isExternal
              ? 'Este evento no lo gestiona el ERP: se importó de Google Calendar para que veas el hueco ocupado.'
              : 'Solo puedes ver esta cita. La agendó otro comercial.'}
          </div>
        )}

        {appointment?.google_meet_link && (
          <div className="glass-card p-3 mb-4 flex items-center justify-between gap-2">
            <span className="text-sm text-white/70 flex items-center gap-2">
              <Video className="h-4 w-4 text-[#FF6600]" /> Videollamada de Google Meet
            </span>
            <a
              href={appointment.google_meet_link}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-[#FF6600] hover:underline"
            >
              Unirse
            </a>
          </div>
        )}

        <div className="space-y-5">
          {/* Datos del lead */}
          <div className="glass-card p-4 space-y-3">
            <h3 className="font-semibold text-white flex items-center gap-2">
              <User className="h-4 w-4 text-[#FF6600]" /> Lead
            </h3>
            <div>
              <Label className="text-xs text-white/50">Nombre *</Label>
              <Input
                value={leadName}
                onChange={(e) => setLeadName(e.target.value)}
                disabled={!canEdit}
                className="input-glass"
                placeholder="Nombre del contacto"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-white/50 flex items-center gap-1">
                  <Mail className="h-3 w-3" /> Email
                </Label>
                <Input
                  value={leadEmail}
                  onChange={(e) => setLeadEmail(e.target.value)}
                  disabled={!canEdit}
                  className="input-glass"
                  placeholder="email@empresa.com"
                />
              </div>
              <div>
                <Label className="text-xs text-white/50 flex items-center gap-1">
                  <Phone className="h-3 w-3" /> Teléfono
                </Label>
                <Input
                  value={leadPhone}
                  onChange={(e) => setLeadPhone(e.target.value)}
                  disabled={!canEdit}
                  className="input-glass"
                  placeholder="+34 ..."
                />
              </div>
            </div>
            <div>
              <Label className="text-xs text-white/50 flex items-center gap-1">
                <Building2 className="h-3 w-3" /> Empresa
              </Label>
              <Input
                value={leadCompany}
                onChange={(e) => setLeadCompany(e.target.value)}
                disabled={!canEdit}
                className="input-glass"
                placeholder="Empresa"
              />
            </div>
          </div>

          {/* Franja horaria */}
          <div className="glass-card p-4 space-y-3">
            <h3 className="font-semibold text-white">Cuándo</h3>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs text-white/50">Fecha</Label>
                <Input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  disabled={!canEdit}
                  className="input-glass"
                />
              </div>
              <div>
                <Label className="text-xs text-white/50">Inicio</Label>
                <Input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  disabled={!canEdit}
                  className="input-glass"
                />
              </div>
              <div>
                <Label className="text-xs text-white/50">Fin</Label>
                <Input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  disabled={!canEdit}
                  className="input-glass"
                />
              </div>
            </div>
          </div>

          {/* Asignación + estado */}
          <div className="glass-card p-4 space-y-3">
            <div>
              <Label className="text-xs text-white/50">Closer asignado</Label>
              <Select
                value={assignedCloser}
                onValueChange={setAssignedCloser}
                disabled={!canEdit}
              >
                <SelectTrigger className="input-glass">
                  <SelectValue placeholder="Sin asignar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin asignar</SelectItem>
                  {closers.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.full_name || p.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-white/50">Estado</Label>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as AppointmentStatus)}
                disabled={!canEdit}
              >
                <SelectTrigger className="input-glass">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {APPOINTMENT_STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Notas */}
          <div className="glass-card p-4">
            <Label className="text-sm font-semibold text-white mb-2 block">
              Notas de la cita
            </Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={!canEdit}
              placeholder="Contexto del lead, qué se ha hablado, objetivo de la reunión..."
              className="input-glass min-h-[140px] resize-none"
            />
          </div>

          {/* Acciones */}
          {canEdit && (
            <div className="flex gap-3 items-stretch pb-4">
              {mode === 'edit' && (
                <Button
                  variant="outline"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="h-12 border-red-500/30 text-red-300 hover:bg-red-500/10"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
              <Button variant="outline" onClick={onClose} className="flex-1 h-12">
                Cancelar
              </Button>
              <LibertyButton onClick={handleSave} disabled={saving} className="flex-1 h-12">
                {saving ? 'Guardando...' : mode === 'create' ? 'Agendar cita' : 'Guardar'}
              </LibertyButton>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
