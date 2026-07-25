'use client'

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import {
  startOfWeek,
  addDays,
  addWeeks,
  format,
  isSameDay,
  isToday,
} from 'date-fns'
import { es } from 'date-fns/locale'
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Calendar as CalIcon,
  RefreshCw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LibertyButton } from '@/components/ui/LibertyButton'
import { AppointmentSheet } from './AppointmentSheet'
import {
  AppointmentWithPeople,
  CalendarPerson,
  colorForAgent,
} from '@/lib/types/appointments'
import { UserProfile } from '@/lib/supabase/get-user-profile'

interface AgendaCalendarProps {
  initialAppointments: AppointmentWithPeople[]
  team: CalendarPerson[]
  currentUser: UserProfile
}

const DAY_START = 8 // 08:00
const DAY_END = 21 // 21:00
const HOUR_HEIGHT = 56 // px por hora
const HOURS = Array.from({ length: DAY_END - DAY_START }, (_, i) => DAY_START + i)

export function AgendaCalendar({
  initialAppointments,
  team,
  currentUser,
}: AgendaCalendarProps) {
  const supabase = createClient()
  const [appointments, setAppointments] = useState<AppointmentWithPeople[]>(
    initialAppointments
  )
  const [weekStart, setWeekStart] = useState<Date>(
    startOfWeek(new Date(), { weekStartsOn: 1 })
  )
  const [sheet, setSheet] = useState<
    | { mode: 'create'; prefill: { start: Date; end: Date } }
    | { mode: 'edit'; appointment: AppointmentWithPeople }
    | null
  >(null)
  const [importing, setImporting] = useState(false)
  const isAdmin = currentUser.role === 'admin' || currentUser.role === 'partner'

  async function handleImportFromGoogle() {
    setImporting(true)
    try {
      const res = await fetch('/api/appointments/google-import', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al importar')
      toast.success(
        `Importado de Google: ${data.imported} nuevos, ${data.updated} actualizados`
      )
      // Recargar para traer los eventos externos recién importados
      window.location.reload()
    } catch (err) {
      console.error('Error importando de Google:', err)
      toast.error((err as Error).message || 'Error al importar de Google Calendar')
    } finally {
      setImporting(false)
    }
  }

  // Comerciales que aparecen en la leyenda (quienes han agendado algo o pueden)
  const legendPeople = useMemo(() => {
    const map = new Map<string, CalendarPerson>()
    team.forEach((p) => map.set(p.id, p))
    appointments.forEach((a) => {
      if (a.comercial && !map.has(a.comercial.id)) map.set(a.comercial.id, a.comercial)
    })
    return Array.from(map.values())
  }, [team, appointments])

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel(`appointments_${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'appointments' },
        async (payload) => {
          if (payload.eventType === 'DELETE') {
            const id = (payload.old as { id: string }).id
            setAppointments((prev) => prev.filter((a) => a.id !== id))
            return
          }
          // Para INSERT/UPDATE recargamos la fila con sus joins
          const row = payload.new as { id: string }
          const { data } = await supabase
            .from('appointments')
            .select(`
              *,
              comercial:profiles!appointments_comercial_id_fkey(id, full_name, email, role, calendar_color),
              assigned_closer:profiles!appointments_assigned_closer_id_fkey(id, full_name, email, role, calendar_color)
            `)
            .eq('id', row.id)
            .single()
          if (!data) return
          const appt = data as AppointmentWithPeople
          setAppointments((prev) => {
            const exists = prev.some((a) => a.id === appt.id)
            return exists
              ? prev.map((a) => (a.id === appt.id ? appt : a))
              : [...prev, appt]
          })
        }
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase])

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  )

  const weekLabel = `${format(weekStart, "d 'de' MMM", { locale: es })} – ${format(
    addDays(weekStart, 6),
    "d 'de' MMM yyyy",
    { locale: es }
  )}`

  function appointmentsForDay(day: Date) {
    return appointments.filter((a) => isSameDay(new Date(a.start_time), day))
  }

  function positionFor(a: AppointmentWithPeople) {
    const start = new Date(a.start_time)
    const end = new Date(a.end_time)
    const startMins = (start.getHours() - DAY_START) * 60 + start.getMinutes()
    const endMins = (end.getHours() - DAY_START) * 60 + end.getMinutes()
    const top = (startMins / 60) * HOUR_HEIGHT
    const height = Math.max(((endMins - startMins) / 60) * HOUR_HEIGHT, 22)
    return { top, height }
  }

  function handleSlotClick(day: Date, hour: number) {
    const start = new Date(day)
    start.setHours(hour, 0, 0, 0)
    const end = new Date(start.getTime() + 60 * 60 * 1000)
    setSheet({ mode: 'create', prefill: { start, end } })
  }

  function upsertLocal(appt: AppointmentWithPeople) {
    setAppointments((prev) => {
      const exists = prev.some((a) => a.id === appt.id)
      return exists ? prev.map((a) => (a.id === appt.id ? appt : a)) : [...prev, appt]
    })
    setSheet(null)
  }

  function removeLocal(id: string) {
    setAppointments((prev) => prev.filter((a) => a.id !== id))
    setSheet(null)
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setWeekStart((w) => addWeeks(w, -1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}
          >
            Hoy
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setWeekStart((w) => addWeeks(w, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="ml-2 text-white font-medium flex items-center gap-2">
            <CalIcon className="h-4 w-4 text-[#FF6600]" />
            {weekLabel}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {isAdmin && (
            <Button
              variant="outline"
              onClick={handleImportFromGoogle}
              disabled={importing}
              className="gap-2"
              title="Trae a este calendario los eventos que ya existían en Google Calendar"
            >
              <RefreshCw className={`h-4 w-4 ${importing ? 'animate-spin' : ''}`} />
              {importing ? 'Importando...' : 'Importar de Google'}
            </Button>
          )}
          <LibertyButton
            onClick={() => {
              const start = new Date()
              start.setMinutes(0, 0, 0)
              start.setHours(start.getHours() + 1)
              const end = new Date(start.getTime() + 60 * 60 * 1000)
              setSheet({ mode: 'create', prefill: { start, end } })
            }}
            className="gap-2"
          >
            <Plus className="h-4 w-4" /> Nueva cita
          </LibertyButton>
        </div>
      </div>

      {/* Leyenda de comerciales */}
      {legendPeople.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 glass-card p-3">
          <span className="text-xs text-white/40">Comerciales:</span>
          {legendPeople.map((p) => (
            <span key={p.id} className="flex items-center gap-1.5 text-xs text-white/70">
              <span
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: colorForAgent(p.id, p.calendar_color) }}
              />
              {p.full_name || p.email}
            </span>
          ))}
        </div>
      )}

      {/* Calendario */}
      <div className="glass-card overflow-x-auto">
        <div className="min-w-[820px]">
          {/* Cabecera de días */}
          <div className="grid grid-cols-[56px_repeat(7,1fr)] border-b border-white/10">
            <div className="p-2" />
            {days.map((day) => (
              <div
                key={day.toISOString()}
                className={`p-2 text-center border-l border-white/10 ${
                  isToday(day) ? 'bg-[#FF6600]/10' : ''
                }`}
              >
                <div className="text-xs text-white/40 uppercase">
                  {format(day, 'EEE', { locale: es })}
                </div>
                <div
                  className={`text-lg font-semibold ${
                    isToday(day) ? 'text-[#FF6600]' : 'text-white'
                  }`}
                >
                  {format(day, 'd')}
                </div>
              </div>
            ))}
          </div>

          {/* Rejilla horaria */}
          <div className="grid grid-cols-[56px_repeat(7,1fr)]">
            {/* Columna de horas */}
            <div className="relative">
              {HOURS.map((h) => (
                <div
                  key={h}
                  style={{ height: HOUR_HEIGHT }}
                  className="text-[11px] text-white/30 text-right pr-2 -translate-y-2"
                >
                  {String(h).padStart(2, '0')}:00
                </div>
              ))}
            </div>

            {/* Columnas de días */}
            {days.map((day) => {
              const dayAppts = appointmentsForDay(day)
              return (
                <div
                  key={day.toISOString()}
                  className="relative border-l border-white/10"
                  style={{ height: HOURS.length * HOUR_HEIGHT }}
                >
                  {/* Líneas de hora + slots clicables */}
                  {HOURS.map((h) => (
                    <div
                      key={h}
                      onClick={() => handleSlotClick(day, h)}
                      style={{ height: HOUR_HEIGHT }}
                      className="border-b border-white/5 hover:bg-white/[0.03] cursor-pointer transition-colors"
                    />
                  ))}

                  {/* Citas */}
                  {dayAppts.map((a) => {
                    const { top, height } = positionFor(a)
                    const color = a.is_external
                      ? '#6B7280'
                      : a.comercial
                        ? colorForAgent(a.comercial.id, a.comercial.calendar_color)
                        : '#FF6600'
                    const cancelled = a.status === 'cancelled'
                    return (
                      <button
                        key={a.id}
                        onClick={(e) => {
                          e.stopPropagation()
                          setSheet({ mode: 'edit', appointment: a })
                        }}
                        style={{
                          top,
                          height,
                          borderLeftColor: color,
                          backgroundColor: a.is_external
                            ? 'rgba(107,114,128,0.12)'
                            : `${color}22`,
                          backgroundImage: a.is_external
                            ? 'repeating-linear-gradient(135deg, rgba(255,255,255,0.03) 0px, rgba(255,255,255,0.03) 4px, transparent 4px, transparent 8px)'
                            : undefined,
                        }}
                        className={`absolute left-1 right-1 rounded-md border-l-4 px-2 py-1 text-left overflow-hidden hover:brightness-125 transition-all ${
                          cancelled ? 'opacity-50 line-through' : ''
                        } ${a.is_external ? 'border-dashed' : ''}`}
                      >
                        <div className="text-[11px] font-semibold text-white truncate">
                          {a.lead_name}
                        </div>
                        <div className="text-[10px] text-white/60 truncate">
                          {format(new Date(a.start_time), 'HH:mm')}
                          {a.is_external
                            ? ' · Google Calendar'
                            : a.lead_company
                              ? ` · ${a.lead_company}`
                              : ''}
                        </div>
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {sheet && (
        <AppointmentSheet
          mode={sheet.mode}
          appointment={sheet.mode === 'edit' ? sheet.appointment : null}
          prefill={sheet.mode === 'create' ? sheet.prefill : null}
          team={team}
          currentUser={currentUser}
          onClose={() => setSheet(null)}
          onSaved={upsertLocal}
          onDeleted={removeLocal}
        />
      )}
    </div>
  )
}
