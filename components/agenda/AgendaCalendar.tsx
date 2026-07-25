'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
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
import { AnimatePresence, motion } from 'framer-motion'
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Calendar as CalIcon,
  RefreshCw,
  Video,
  Link2,
} from 'lucide-react'
import { AppointmentSheet } from './AppointmentSheet'
import {
  AppointmentWithPeople,
  CalendarPerson,
  colorForAgent,
} from '@/lib/types/appointments'
import { UserProfile } from '@/lib/supabase/get-user-profile'
import { layoutOverlappingEvents } from '@/lib/calendar-layout'

interface AgendaCalendarProps {
  initialAppointments: AppointmentWithPeople[]
  team: CalendarPerson[]
  currentUser: UserProfile
}

const DAY_START = 8 // 08:00
const DAY_END = 21 // 21:00
const HOUR_HEIGHT = 64 // px por hora
const HOURS = Array.from({ length: DAY_END - DAY_START }, (_, i) => DAY_START + i)

function initials(name: string | null | undefined, fallback: string) {
  const source = (name || fallback || '?').trim()
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

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
  const [direction, setDirection] = useState(0)
  const [sheet, setSheet] = useState<
    | { mode: 'create'; prefill: { start: Date; end: Date } }
    | { mode: 'edit'; appointment: AppointmentWithPeople }
    | null
  >(null)
  const [importing, setImporting] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const isAdmin = currentUser.role === 'admin' || currentUser.role === 'partner'
  const gridRef = useRef<HTMLDivElement>(null)

  // Reloj para la línea de "ahora"
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  // Centrar el scroll cerca de la hora actual al montar
  useEffect(() => {
    if (!gridRef.current) return
    const h = new Date().getHours()
    const offset = Math.max(0, (h - DAY_START - 1) * HOUR_HEIGHT)
    gridRef.current.scrollTop = offset
  }, [])

  async function handleImportFromGoogle() {
    setImporting(true)
    try {
      const res = await fetch('/api/appointments/google-import', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al importar')
      toast.success(
        `Importado de Google: ${data.imported} nuevos, ${data.updated} actualizados`
      )
      window.location.reload()
    } catch (err) {
      console.error('Error importando de Google:', err)
      toast.error((err as Error).message || 'Error al importar de Google Calendar')
    } finally {
      setImporting(false)
    }
  }

  const legendPeople = useMemo(() => {
    const map = new Map<string, CalendarPerson>()
    team.forEach((p) => map.set(p.id, p))
    appointments.forEach((a) => {
      if (a.comercial && !map.has(a.comercial.id)) map.set(a.comercial.id, a.comercial)
    })
    return Array.from(map.values())
  }, [team, appointments])

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

  function goToWeek(newStart: Date, dir: number) {
    setDirection(dir)
    setWeekStart(newStart)
  }

  function layoutForDay(day: Date) {
    const dayAppts = appointments.filter((a) => isSameDay(new Date(a.start_time), day))
    return layoutOverlappingEvents(
      dayAppts,
      (a) => new Date(a.start_time).getTime(),
      (a) => new Date(a.end_time).getTime()
    )
  }

  function positionFor(a: AppointmentWithPeople) {
    const start = new Date(a.start_time)
    const end = new Date(a.end_time)
    const startMins = (start.getHours() - DAY_START) * 60 + start.getMinutes()
    const endMins = (end.getHours() - DAY_START) * 60 + end.getMinutes()
    const top = (startMins / 60) * HOUR_HEIGHT
    const height = Math.max(((endMins - startMins) / 60) * HOUR_HEIGHT, 26)
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

  const nowLineTop = (() => {
    const mins = (now.getHours() - DAY_START) * 60 + now.getMinutes()
    if (now.getHours() < DAY_START || now.getHours() >= DAY_END) return null
    return (mins / 60) * HOUR_HEIGHT
  })()

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center rounded-full border border-white/10 bg-white/[0.03] p-1">
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => goToWeek(addWeeks(weekStart, -1), -1)}
              className="h-8 w-8 flex items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/[0.06] transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => goToWeek(startOfWeek(new Date(), { weekStartsOn: 1 }), 0)}
              className="px-4 h-8 rounded-full text-xs font-semibold text-white/80 hover:text-white hover:bg-white/[0.06] transition-colors button-uppercase tracking-wide"
            >
              Hoy
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => goToWeek(addWeeks(weekStart, 1), 1)}
              className="h-8 w-8 flex items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/[0.06] transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </motion.button>
          </div>

          <AnimatePresence mode="wait">
            <motion.span
              key={weekLabel}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.18 }}
              className="text-white font-semibold flex items-center gap-2 text-[15px]"
            >
              <CalIcon className="h-4 w-4 text-[#FF6600]" />
              {weekLabel}
            </motion.span>
          </AnimatePresence>
        </div>

        <div className="flex items-center gap-2">
          {isAdmin && (
            <motion.button
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.97 }}
              onClick={handleImportFromGoogle}
              disabled={importing}
              title="Trae a este calendario los eventos que ya existían en Google Calendar"
              className="h-10 px-4 rounded-full border border-white/10 bg-white/[0.03] text-white/80 text-sm font-medium flex items-center gap-2 hover:bg-white/[0.06] hover:border-white/20 transition-colors disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${importing ? 'animate-spin' : ''}`} />
              {importing ? 'Importando…' : 'Importar de Google'}
            </motion.button>
          )}
          <motion.button
            whileHover={{ y: -1, boxShadow: '0 8px 24px -4px rgba(255,102,0,0.45)' }}
            whileTap={{ scale: 0.97 }}
            onClick={() => {
              const start = new Date()
              start.setMinutes(0, 0, 0)
              start.setHours(start.getHours() + 1)
              const end = new Date(start.getTime() + 60 * 60 * 1000)
              setSheet({ mode: 'create', prefill: { start, end } })
            }}
            className="h-10 px-5 rounded-full bg-gradient-to-b from-[#FF7A1F] to-[#FF6600] text-white text-sm font-semibold flex items-center gap-2 shadow-[0_4px_16px_-4px_rgba(255,102,0,0.5)]"
          >
            <Plus className="h-4 w-4" /> Nueva cita
          </motion.button>
        </div>
      </div>

      {/* Leyenda de comerciales */}
      {legendPeople.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {legendPeople.map((p) => {
            const color = colorForAgent(p.id, p.calendar_color)
            return (
              <span
                key={p.id}
                className="flex items-center gap-1.5 pl-1 pr-3 py-1 rounded-full border border-white/10 bg-white/[0.03] text-xs text-white/70"
              >
                <span
                  className="h-5 w-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white"
                  style={{ backgroundColor: color }}
                >
                  {initials(p.full_name, p.email || '')}
                </span>
                {p.full_name || p.email}
              </span>
            )
          })}
          <span className="flex items-center gap-1.5 pl-1 pr-3 py-1 rounded-full border border-white/10 border-dashed bg-white/[0.02] text-xs text-white/40">
            <span className="h-5 w-5 rounded-full bg-white/10" />
            Google Calendar
          </span>
        </div>
      )}

      {/* Calendario */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden">
        <div
          ref={gridRef}
          className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-320px)]"
        >
          <div className="min-w-[880px]">
            {/* Cabecera de días (sticky) */}
            <div className="sticky top-0 z-20 grid grid-cols-[60px_repeat(7,1fr)] bg-[#0a0a0a]/95 backdrop-blur border-b border-white/10">
              <div className="p-2" />
              {days.map((day) => (
                <div
                  key={day.toISOString()}
                  className={`py-3 text-center border-l border-white/5 transition-colors ${
                    isToday(day) ? 'bg-[#FF6600]/[0.06]' : ''
                  }`}
                >
                  <div className="text-[10px] text-white/35 uppercase tracking-wider font-medium">
                    {format(day, 'EEE', { locale: es })}
                  </div>
                  <div
                    className={`mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full text-[15px] font-semibold ${
                      isToday(day)
                        ? 'bg-[#FF6600] text-white'
                        : 'text-white/85'
                    }`}
                  >
                    {format(day, 'd')}
                  </div>
                </div>
              ))}
            </div>

            {/* Rejilla horaria con transición de semana */}
            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={weekStart.toISOString()}
                custom={direction}
                initial={{ opacity: 0, x: direction === 0 ? 0 : direction > 0 ? 24 : -24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: direction > 0 ? -24 : 24 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="grid grid-cols-[60px_repeat(7,1fr)]"
              >
                {/* Columna de horas */}
                <div className="relative">
                  {HOURS.map((h) => (
                    <div
                      key={h}
                      style={{ height: HOUR_HEIGHT }}
                      className="text-[11px] text-white/30 text-right pr-3 -translate-y-2 tabular-nums"
                    >
                      {String(h).padStart(2, '0')}:00
                    </div>
                  ))}
                </div>

                {/* Columnas de días */}
                {days.map((day) => {
                  const positioned = layoutForDay(day)
                  const showNowLine = isToday(day) && nowLineTop !== null

                  return (
                    <div
                      key={day.toISOString()}
                      className="relative border-l border-white/5"
                      style={{ height: HOURS.length * HOUR_HEIGHT }}
                    >
                      {HOURS.map((h) => (
                        <div
                          key={h}
                          onClick={() => handleSlotClick(day, h)}
                          style={{ height: HOUR_HEIGHT }}
                          className="border-b border-white/[0.04] hover:bg-white/[0.025] cursor-pointer transition-colors group relative"
                        >
                          <Plus className="hidden group-hover:block h-3.5 w-3.5 text-white/20 absolute top-1 left-1/2 -translate-x-1/2" />
                        </div>
                      ))}

                      {showNowLine && (
                        <div
                          className="absolute left-0 right-0 z-10 pointer-events-none flex items-center"
                          style={{ top: nowLineTop! }}
                        >
                          <span className="h-2 w-2 rounded-full bg-[#FF6600] -ml-1 shadow-[0_0_6px_rgba(255,102,0,0.8)]" />
                          <span className="flex-1 h-[1.5px] bg-[#FF6600]/80" />
                        </div>
                      )}

                      {positioned.map(({ event: a, col, totalCols }) => {
                        const { top, height } = positionFor(a)
                        const color = a.is_external
                          ? '#7C8493'
                          : a.comercial
                            ? colorForAgent(a.comercial.id, a.comercial.calendar_color)
                            : '#FF6600'
                        const cancelled = a.status === 'cancelled'
                        const widthPct = 100 / totalCols
                        const leftPct = col * widthPct
                        const compact = height < 40

                        return (
                          <motion.button
                            key={a.id}
                            layout
                            initial={{ opacity: 0, scale: 0.96 }}
                            animate={{ opacity: 1, scale: 1 }}
                            whileHover={{
                              scale: 1.015,
                              zIndex: 30,
                              boxShadow: '0 8px 20px -6px rgba(0,0,0,0.5)',
                            }}
                            transition={{ duration: 0.15 }}
                            onClick={(e) => {
                              e.stopPropagation()
                              setSheet({ mode: 'edit', appointment: a })
                            }}
                            style={{
                              top,
                              height,
                              left: `calc(${leftPct}% + 2px)`,
                              width: `calc(${widthPct}% - 4px)`,
                              borderLeft: `3px solid ${color}`,
                              background: a.is_external
                                ? 'rgba(124,132,147,0.10)'
                                : `linear-gradient(135deg, ${color}26, ${color}12)`,
                              backgroundImage: a.is_external
                                ? 'repeating-linear-gradient(135deg, rgba(255,255,255,0.035) 0px, rgba(255,255,255,0.035) 4px, transparent 4px, transparent 9px)'
                                : undefined,
                            }}
                            className={`absolute rounded-lg px-2 py-1 text-left overflow-hidden z-10 ${
                              cancelled ? 'opacity-45' : ''
                            }`}
                          >
                            <div
                              className={`flex items-center gap-1 text-[11px] font-semibold text-white truncate ${
                                cancelled ? 'line-through' : ''
                              }`}
                            >
                              {a.google_meet_link && (
                                <Video className="h-2.5 w-2.5 flex-shrink-0 text-white/70" />
                              )}
                              {a.is_external && (
                                <Link2 className="h-2.5 w-2.5 flex-shrink-0 text-white/50" />
                              )}
                              <span className="truncate">{a.lead_name}</span>
                            </div>
                            {!compact && (
                              <div className="text-[10px] text-white/55 truncate tabular-nums">
                                {format(new Date(a.start_time), 'HH:mm')}
                                {a.is_external
                                  ? ''
                                  : a.lead_company
                                    ? ` · ${a.lead_company}`
                                    : ''}
                              </div>
                            )}
                          </motion.button>
                        )
                      })}
                    </div>
                  )
                })}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>

      <AnimatePresence>
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
      </AnimatePresence>
    </div>
  )
}
