'use client'

import { useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { LibertyButton } from '@/components/ui/LibertyButton'
import {
  X,
  Trash2,
  Phone,
  Mail,
  Building2,
  User,
  Lock,
  Video,
  Clock3,
  Check,
  Euro,
  CalendarClock,
  Link2 as LinkIcon,
  Mic,
  MessageSquare,
} from 'lucide-react'
import { toast } from 'sonner'
import { format } from 'date-fns'
import {
  AppointmentWithPeople,
  AppointmentStatus,
  CalendarPerson,
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_STATUS_COLORS,
  colorForAgent,
} from '@/lib/types/appointments'
import { UserProfile } from '@/lib/supabase/get-user-profile'
import { AudioRecordingField } from './AudioRecordingField'
import { CommentsThread } from './CommentsThread'

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

function initials(name: string | null | undefined, fallback: string) {
  const source = (name || fallback || '?').trim()
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

const STATUS_OPTIONS: AppointmentStatus[] = [
  'scheduled',
  'confirmed',
  'rescheduled',
  'no_show',
  'qualified',
  'not_qualified',
]

// Input "fantasma" al estilo Notion: sin caja visible hasta que se
// interactúa, para que cada fila ocupe lo mínimo posible.
const ghostInput =
  'w-full bg-transparent hover:bg-white/[0.04] focus:bg-white/[0.06] border border-transparent focus:border-white/15 rounded-md px-2 py-1 text-[13px] text-white outline-none transition-colors placeholder:text-white/25 disabled:opacity-50 disabled:hover:bg-transparent'

const sectionVariants = {
  hidden: { opacity: 0, y: 8 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: 0.03 * i, duration: 0.2, ease: 'easeOut' as const },
  }),
}

function Section({
  icon,
  title,
  index,
  children,
}: {
  icon?: ReactNode
  title: string
  index: number
  children: ReactNode
}) {
  return (
    <motion.div
      custom={index}
      variants={sectionVariants}
      initial="hidden"
      animate="show"
      className="rounded-xl border border-white/10 bg-white/[0.02] p-3"
    >
      <h3 className="text-[10px] font-semibold text-white/45 flex items-center gap-1.5 tracking-wider uppercase mb-1.5">
        {icon}
        {title}
      </h3>
      <div className="divide-y divide-white/[0.04]">{children}</div>
    </motion.div>
  )
}

/** Fila de propiedad estilo Notion: icono + etiqueta a la izquierda, valor a la derecha */
function PropertyRow({
  icon,
  label,
  children,
}: {
  icon?: ReactNode
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <div className="w-[104px] flex-shrink-0 flex items-center gap-1.5 text-[12px] text-white/40">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

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
  // Si el que agenda es uno de los comerciales, se autoselecciona a sí
  // mismo como closer para evitar que elija a otra persona por error.
  const isAdmin = currentUser.role === 'admin' || currentUser.role === 'partner'
  // Un comercial (no admin) siempre agenda a su propio nombre: no puede
  // elegir a otro closer, por si acaso se equivoca.
  const loggedInIsComercial = team.some((p) => p.id === currentUser.id)
  const closerLocked = loggedInIsComercial && !isAdmin
  const [assignedCloser, setAssignedCloser] = useState<string>(
    closerLocked ? currentUser.id : appointment?.assigned_closer_id ?? 'none'
  )
  const [date, setDate] = useState(toDateInput(initialStart))
  const [startTime, setStartTime] = useState(toTimeInput(initialStart))
  const [endTime, setEndTime] = useState(toTimeInput(initialEnd))
  const [status, setStatus] = useState<AppointmentStatus>(
    appointment?.status ?? 'scheduled'
  )
  const [notes, setNotes] = useState(appointment?.notes ?? '')
  const [revenueAmount, setRevenueAmount] = useState(
    appointment?.revenue_amount != null ? String(appointment.revenue_amount) : ''
  )
  const [callDate, setCallDate] = useState(appointment?.call_date ?? '')
  const [amazonLink, setAmazonLink] = useState(appointment?.amazon_link ?? '')
  const [recordingUrl, setRecordingUrl] = useState(appointment?.recording_url ?? null)
  const [recordingFilename, setRecordingFilename] = useState(
    appointment?.recording_filename ?? null
  )
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

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
        assigned_closer_id: closerLocked
          ? currentUser.id
          : assignedCloser === 'none'
            ? null
            : assignedCloser,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        status,
        notes: notes.trim() || null,
        revenue_amount: revenueAmount.trim() ? Number(revenueAmount.replace(',', '.')) : null,
        call_date: callDate || null,
        amazon_link: amazonLink.trim() || null,
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
    : isExternal
      ? '#7C8493'
      : colorForAgent(currentUser.id)

  const ownerLabel = isExternal
    ? 'Google'
    : appointment?.comercial
      ? initials(appointment.comercial.full_name, appointment.comercial.email || '')
      : initials(currentUser.full_name, currentUser.email || '')

  return (
    <Sheet open={true} onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-md bg-[#0a0a0a] border-l border-white/10 overflow-y-auto p-0">
        <div className="sticky top-0 z-10 bg-[#0a0a0a]/90 backdrop-blur-xl border-b border-white/[0.06] px-4 pt-4 pb-2.5">
          <SheetHeader>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div
                  className="h-8 w-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0 shadow-lg"
                  style={{
                    background: `linear-gradient(135deg, ${ownerColor}, ${ownerColor}cc)`,
                    boxShadow: `0 4px 12px -4px ${ownerColor}66`,
                  }}
                >
                  {ownerLabel}
                </div>
                <div>
                  <SheetTitle className="text-[15px] font-bold text-white leading-tight">
                    {mode === 'create' ? 'Nueva cita' : leadName || 'Cita'}
                  </SheetTitle>
                  <SheetDescription className="text-white/45 text-[11px] leading-tight">
                    {isExternal
                      ? 'Evento importado de Google Calendar'
                      : mode === 'edit' && appointment?.comercial
                        ? `Agendada por ${appointment.comercial.full_name || appointment.comercial.email}`
                        : 'Rellena los datos del lead'}
                  </SheetDescription>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="h-6 w-6 rounded-full hover:bg-white/10 flex-shrink-0"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </SheetHeader>

          {mode === 'edit' && appointment && !isExternal && (
            <span
              className={`mt-2 inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full border ${APPOINTMENT_STATUS_COLORS[appointment.status]}`}
            >
              {APPOINTMENT_STATUS_LABELS[appointment.status]}
            </span>
          )}
        </div>

        <div className="px-4 py-3 space-y-2.5">
          {!canEdit && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5 flex items-center gap-2 text-xs text-white/60"
            >
              <Lock className="h-3.5 w-3.5 text-white/40 flex-shrink-0" />
              {isExternal
                ? 'Este evento no lo gestiona el ERP: se importó de Google Calendar para que veas el hueco ocupado.'
                : 'Solo puedes ver esta cita. La agendó otro comercial.'}
            </motion.div>
          )}

          {appointment?.google_meet_link && (
            <motion.a
              href={appointment.google_meet_link}
              target="_blank"
              rel="noopener noreferrer"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              whileHover={{ y: -1 }}
              className="flex items-center justify-between gap-2 rounded-xl border border-[#FF6600]/25 bg-gradient-to-r from-[#FF6600]/[0.12] to-transparent px-3 py-2 group"
            >
              <span className="text-xs text-white/80 flex items-center gap-2">
                <Video className="h-3.5 w-3.5 text-[#FF6600]" />
                Videollamada de Google Meet
              </span>
              <span className="text-xs font-semibold text-[#FF6600] group-hover:underline">
                Unirse →
              </span>
            </motion.a>
          )}

          {/* Datos del lead */}
          <Section icon={<User className="h-3 w-3" />} title="Lead" index={0}>
            <PropertyRow label="Nombre *">
              <input
                value={leadName}
                onChange={(e) => setLeadName(e.target.value)}
                disabled={!canEdit}
                className={ghostInput}
                placeholder="Nombre del contacto"
              />
            </PropertyRow>
            <PropertyRow icon={<Mail className="h-3 w-3" />} label="Email">
              <input
                value={leadEmail}
                onChange={(e) => setLeadEmail(e.target.value)}
                disabled={!canEdit}
                className={ghostInput}
                placeholder="email@empresa.com"
              />
            </PropertyRow>
            <PropertyRow icon={<Phone className="h-3 w-3" />} label="Teléfono">
              <input
                value={leadPhone}
                onChange={(e) => setLeadPhone(e.target.value)}
                disabled={!canEdit}
                className={ghostInput}
                placeholder="+34 ..."
              />
            </PropertyRow>
            <PropertyRow icon={<Building2 className="h-3 w-3" />} label="Empresa">
              <input
                value={leadCompany}
                onChange={(e) => setLeadCompany(e.target.value)}
                disabled={!canEdit}
                className={ghostInput}
                placeholder="Empresa"
              />
            </PropertyRow>
          </Section>

          {/* Franja horaria */}
          <Section icon={<Clock3 className="h-3 w-3" />} title="Cuándo" index={1}>
            <div className="grid grid-cols-3 gap-2 py-1">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                disabled={!canEdit}
                className={`${ghostInput} text-[12px] px-1.5`}
              />
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                disabled={!canEdit}
                className={`${ghostInput} text-[12px] px-1.5`}
              />
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                disabled={!canEdit}
                className={`${ghostInput} text-[12px] px-1.5`}
              />
            </div>
          </Section>

          {/* Asignación, datos comerciales y notas: bloqueados hasta guardar
              la cita por primera vez, para que no se rellenen antes de
              agendarla y luego se pierda al crearla. */}
          <div className="relative">
            {mode === 'create' && (
              <div className="sticky top-16 z-20 flex justify-center pointer-events-none mb-2.5">
                <div className="pointer-events-none bg-[#171717] border border-white/15 rounded-xl px-3.5 py-2 flex items-center gap-2 shadow-xl">
                  <Lock className="h-3.5 w-3.5 text-[#FF6600] flex-shrink-0" />
                  <span className="text-[11px] text-white/80">
                    Agenda la cita primero para añadir esta información
                  </span>
                </div>
              </div>
            )}
            <div
              className={`space-y-2.5 ${mode === 'create' ? 'blur-[3px] opacity-40 pointer-events-none select-none' : ''}`}
              aria-hidden={mode === 'create'}
            >
          {/* Asignación + estado */}
          <Section title="Asignación" index={2}>
            <div className="py-1.5">
              <div className="text-[12px] text-white/40 mb-1.5">Closer asignado</div>
              {closerLocked ? (
                <div className="flex items-center gap-1.5">
                  <span
                    className="flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-full border text-xs font-medium"
                    style={{
                      borderColor: colorForAgent(currentUser.id, undefined),
                      backgroundColor: `${colorForAgent(currentUser.id, undefined)}22`,
                      color: 'white',
                    }}
                  >
                    <span
                      className="h-4 w-4 rounded-full flex items-center justify-center text-[8px] font-bold text-white"
                      style={{ backgroundColor: colorForAgent(currentUser.id, undefined) }}
                    >
                      {initials(currentUser.full_name, currentUser.email || '')}
                    </span>
                    {currentUser.full_name || currentUser.email}
                  </span>
                  <span className="text-[10px] text-white/35 flex items-center gap-1">
                    <Lock className="h-2.5 w-2.5" /> Eres tú
                  </span>
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => canEdit && setAssignedCloser('none')}
                    disabled={!canEdit}
                    className={`flex items-center gap-1 px-2 py-1 rounded-full border text-xs font-medium transition-all ${
                      assignedCloser === 'none'
                        ? 'border-white/30 bg-white/10 text-white'
                        : 'border-white/10 text-white/40 hover:border-white/20 hover:text-white/70'
                    } ${!canEdit ? 'cursor-not-allowed opacity-60' : ''}`}
                  >
                    {assignedCloser === 'none' && <Check className="h-3 w-3" />}
                    Sin asignar
                  </button>
                  {closers.map((p) => {
                    const color = colorForAgent(p.id, p.calendar_color)
                    const selected = assignedCloser === p.id
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => canEdit && setAssignedCloser(p.id)}
                        disabled={!canEdit}
                        className={`flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-full border text-xs font-medium transition-all ${
                          !canEdit ? 'cursor-not-allowed opacity-60' : ''
                        }`}
                        style={{
                          borderColor: selected ? color : 'rgba(255,255,255,0.1)',
                          backgroundColor: selected ? `${color}26` : 'transparent',
                          color: selected ? 'white' : 'rgba(255,255,255,0.5)',
                        }}
                      >
                        <span
                          className="h-4 w-4 rounded-full flex items-center justify-center text-[8px] font-bold text-white flex-shrink-0"
                          style={{ backgroundColor: color, opacity: selected ? 1 : 0.5 }}
                        >
                          {initials(p.full_name, p.email || '')}
                        </span>
                        {p.full_name || p.email}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="py-1.5">
              <div className="text-[12px] text-white/40 mb-1.5">Estado</div>
              <div className="flex flex-wrap gap-1.5">
                {STATUS_OPTIONS.map((s) => {
                  const selected = status === s
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => canEdit && setStatus(s)}
                      disabled={!canEdit}
                      className={`flex items-center gap-1 px-2 py-1 rounded-full border text-xs font-medium transition-all ${
                        selected
                          ? APPOINTMENT_STATUS_COLORS[s]
                          : 'border-white/10 text-white/40 bg-transparent hover:border-white/20 hover:text-white/70'
                      } ${!canEdit ? 'cursor-not-allowed opacity-60' : ''}`}
                    >
                      {selected && <Check className="h-3 w-3" />}
                      {APPOINTMENT_STATUS_LABELS[s]}
                    </button>
                  )
                })}
              </div>
            </div>
          </Section>

          {/* Datos comerciales */}
          <Section icon={<Euro className="h-3 w-3" />} title="Datos comerciales" index={3}>
            <PropertyRow icon={<Euro className="h-3 w-3" />} label="Facturación">
              <input
                type="number"
                inputMode="decimal"
                value={revenueAmount}
                onChange={(e) => setRevenueAmount(e.target.value)}
                disabled={!canEdit}
                className={ghostInput}
                placeholder="0,00"
              />
            </PropertyRow>
            <PropertyRow icon={<CalendarClock className="h-3 w-3" />} label="Fecha llamada">
              <input
                type="date"
                value={callDate}
                onChange={(e) => setCallDate(e.target.value)}
                disabled={!canEdit}
                className={ghostInput}
              />
            </PropertyRow>
            <PropertyRow icon={<LinkIcon className="h-3 w-3" />} label="Link Amazon">
              <input
                value={amazonLink}
                onChange={(e) => setAmazonLink(e.target.value)}
                disabled={!canEdit}
                className={ghostInput}
                placeholder="https://amazon.es/..."
              />
            </PropertyRow>
            <div className="pt-2">
              <div className="text-[12px] text-white/40 mb-1.5 flex items-center gap-1.5">
                <Mic className="h-3 w-3" /> Grabación de la llamada
              </div>
              {mode === 'edit' && appointment ? (
                <AudioRecordingField
                  appointmentId={appointment.id}
                  recordingUrl={recordingUrl}
                  recordingFilename={recordingFilename}
                  canEdit={canEdit}
                  onChange={(url, filename) => {
                    setRecordingUrl(url)
                    setRecordingFilename(filename)
                  }}
                />
              ) : (
                <p className="text-[11px] text-white/30">
                  Podrás subir la grabación una vez agendada la cita.
                </p>
              )}
            </div>
          </Section>

          {/* Notas */}
          <Section title="Notas de la cita" index={4}>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={!canEdit}
              placeholder="Contexto del lead, qué se ha hablado, objetivo de la reunión..."
              className="bg-white/[0.03] border-white/10 rounded-lg px-2.5 py-2 text-[13px] min-h-[70px] resize-none mt-1"
            />
          </Section>
            </div>
          </div>

          {/* Comentarios */}
          {mode === 'edit' && appointment && (
            <Section
              icon={<MessageSquare className="h-3 w-3" />}
              title="Comentarios"
              index={5}
            >
              <div className="pt-1">
                <CommentsThread appointmentId={appointment.id} currentUser={currentUser} />
              </div>
            </Section>
          )}
        </div>

        {/* Acciones */}
        {canEdit && (
          <div className="sticky bottom-0 bg-[#0a0a0a]/90 backdrop-blur-xl border-t border-white/[0.06] px-4 py-2.5 flex gap-2">
            {mode === 'edit' && (
              <Button
                variant="outline"
                onClick={handleDelete}
                disabled={deleting}
                className="h-9 w-9 p-0 flex-shrink-0 rounded-lg border-red-500/25 text-red-300 hover:bg-red-500/10 hover:border-red-500/40"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              variant="outline"
              onClick={onClose}
              className="flex-1 h-9 py-0 px-4 rounded-lg text-sm normal-case tracking-normal font-semibold"
            >
              Cancelar
            </Button>
            <LibertyButton
              onClick={handleSave}
              disabled={saving}
              className="flex-1 h-9 py-0 px-4 mt-0 rounded-lg text-sm flex items-center justify-center"
            >
              {saving ? 'Guardando...' : mode === 'create' ? 'Agendar cita' : 'Guardar'}
            </LibertyButton>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
