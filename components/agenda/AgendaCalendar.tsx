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
  const [hoverSlot, setHoverSlot] = useState<{
    dayIso: string
    hour: number
    minute: number
  } | null>(null)
  const [now, setNow] = useState(() => new Date())
  const isAdmin = currentUser.role === 'admin' || currentUser.role === 'partner'
  const gridRef = useRef<HTMLDivElement>(null)
  const daysGridRef = useRef<HTMLDivElement>(null)

  // ── Drag & drop de citas ──────────────────────────────────────────────
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragTarget, setDragTarget] = useState<{
    dayIso: string
    hour: number
    minute: number
  } | null>(null)
  const dragInfoRef = useRef<{
    initialDayIso: string
    initialHour: number
    initialMinute: number
  } | null>(null)
  const dragTargetRef = useRef<typeof dragTarget>(null)
  const justDraggedRef = useRef(false)

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

  // Leyenda: solo los comerciales (filtrados en el servidor), no cualquiera
  // que haya agendado una cita (p.ej. un admin haciendo una prueba).
  const legendPeople = team

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

  function handleSlotClick(day: Date, hour: number, minute: number = 0) {
    const start = new Date(day)
    start.setHours(hour, minute, 0, 0)
    const end = new Date(start.getTime() + 30 * 60 * 1000)
    setSheet({ mode: 'create', prefill: { start, end } })
    setHoverSlot(null)
  }

  /** Convierte un offset en px dentro de la columna del día a hora:minuto, con snap de 30 min */
  function timeFromOffsetY(offsetY: number) {
    const totalMinutes = (offsetY / HOUR_HEIGHT) * 60
    const snapped = Math.min(
      Math.max(Math.round(totalMinutes / 30) * 30, 0),
      (DAY_END - DAY_START) * 60 - 30
    )
    return { hour: DAY_START + Math.floor(snapped / 60), minute: snapped % 60 }
  }

  function topForSlot(hour: number, minute: number) {
    return (((hour - DAY_START) * 60 + minute) / 60) * HOUR_HEIGHT
  }

  /** A partir de coordenadas de pantalla, calcula qué día/columna y hora:minuto está debajo */
  function pointerToSlot(clientX: number, clientY: number) {
    if (!daysGridRef.current) return null
    const rect = daysGridRef.current.getBoundingClientRect()
    const HOUR_COL = 60
    const dayWidth = (rect.width - HOUR_COL) / 7
    if (dayWidth <= 0) return null
    const xInGrid = clientX - rect.left - HOUR_COL
    const dayIndex = Math.min(Math.max(Math.floor(xInGrid / dayWidth), 0), 6)
    const { hour, minute } = timeFromOffsetY(clientY - rect.top)
    return { dayIndex, hour, minute }
  }

  function handleDragStart(e: React.PointerEvent, a: AppointmentWithPeople) {
    const canDrag = !a.is_external && (isAdmin || a.comercial_id === currentUser.id)
    if (!canDrag) return
    e.stopPropagation()
    const start = new Date(a.start_time)
    const dayMatch = days.find((d) => isSameDay(d, start))
    if (!dayMatch) return
    const initial = {
      dayIso: dayMatch.toISOString(),
      hour: start.getHours(),
      minute: start.getMinutes(),
    }
    dragInfoRef.current = {
      initialDayIso: initial.dayIso,
      initialHour: initial.hour,
      initialMinute: initial.minute,
    }
    dragTargetRef.current = initial
    setDraggingId(a.id)
    setDragTarget(initial)
  }

  async function commitDrag(
    id: string,
    target: { dayIso: string; hour: number; minute: number }
  ) {
    const original = appointments.find((a) => a.id === id)
    const day = days.find((d) => d.toISOString() === target.dayIso)
    if (!original || !day) return

    const durationMs =
      new Date(original.end_time).getTime() - new Date(original.start_time).getTime()
    const newStart = new Date(day)
    newStart.setHours(target.hour, target.minute, 0, 0)
    const newEnd = new Date(newStart.getTime() + durationMs)

    setAppointments((prev) =>
      prev.map((a) =>
        a.id === id
          ? { ...a, start_time: newStart.toISOString(), end_time: newEnd.toISOString() }
          : a
      )
    )

    try {
      const res = await fetch(`/api/appointments/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_name: original.lead_name,
          lead_email: original.lead_email,
          lead_phone: original.lead_phone,
          lead_company: original.lead_company,
          assigned_closer_id: original.assigned_closer_id,
          start_time: newStart.toISOString(),
          end_time: newEnd.toISOString(),
          status: original.status,
          notes: original.notes,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al mover la cita')
      setAppointments((prev) =>
        prev.map((a) => (a.id === id ? (data as AppointmentWithPeople) : a))
      )
      toast.success('Cita reagendada')
    } catch (err) {
      console.error('Error moving appointment:', err)
      toast.error('No se pudo mover la cita')
      setAppointments((prev) => prev.map((a) => (a.id === id ? original : a)))
    }
  }

  // Escucha global de puntero mientras se arrastra una cita
  useEffect(() => {
    if (!draggingId) return
    const currentId = draggingId

    function onMove(e: PointerEvent) {
      const slot = pointerToSlot(e.clientX, e.clientY)
      if (!slot) return
      const dayIso = days[slot.dayIndex].toISOString()
      const prev = dragTargetRef.current
      if (prev && prev.dayIso === dayIso && prev.hour === slot.hour && prev.minute === slot.minute) {
        return
      }
      const next = { dayIso, hour: slot.hour, minute: slot.minute }
      dragTargetRef.current = next
      setDragTarget(next)
    }

    function onUp() {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.userSelect = ''

      const info = dragInfoRef.current
      const target = dragTargetRef.current
      const moved = !!(
        info &&
        target &&
        (target.dayIso !== info.initialDayIso ||
          target.hour !== info.initialHour ||
          target.minute !== info.initialMinute)
      )

      dragInfoRef.current = null
      dragTargetRef.current = null
      setDraggingId(null)
      setDragTarget(null)

      if (moved && target) {
        justDraggedRef.current = true
        commitDrag(currentId, target)
      }
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    document.body.style.userSelect = 'none'
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.userSelect = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draggingId, days])

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
              const roundedMinutes = start.getMinutes() < 30 ? 30 : 0
              start.setMinutes(roundedMinutes, 0, 0)
              if (roundedMinutes === 0) start.setHours(start.getHours() + 1)
              const end = new Date(start.getTime() + 30 * 60 * 1000)
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
                ref={daysGridRef}
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
                  const dayIso = day.toISOString()
                  const isHoveredDay = !draggingId && hoverSlot?.dayIso === dayIso
                  const hoverTop = isHoveredDay
                    ? ((hoverSlot!.hour - DAY_START) * 60 + hoverSlot!.minute) / 60 *
                      HOUR_HEIGHT
                    : null
                  const draggingAppt =
                    draggingId ? appointments.find((a) => a.id === draggingId) : null
                  const isDropTargetDay = draggingId && dragTarget?.dayIso === dayIso

                  return (
                    <div
                      key={dayIso}
                      className="relative border-l border-white/5 cursor-pointer"
                      style={{ height: HOURS.length * HOUR_HEIGHT }}
                      onMouseMove={(e) => {
                        if (draggingId) return
                        const rect = e.currentTarget.getBoundingClientRect()
                        const { hour, minute } = timeFromOffsetY(e.clientY - rect.top)
                        setHoverSlot({ dayIso, hour, minute })
                      }}
                      onMouseLeave={() => setHoverSlot(null)}
                      onClick={(e) => {
                        if (justDraggedRef.current) {
                          justDraggedRef.current = false
                          return
                        }
                        const rect = e.currentTarget.getBoundingClientRect()
                        const { hour, minute } = timeFromOffsetY(e.clientY - rect.top)
                        handleSlotClick(day, hour, minute)
                      }}
                    >
                      {HOURS.map((h) => (
                        <div
                          key={h}
                          style={{ height: HOUR_HEIGHT }}
                          className="border-b border-white/[0.04] relative"
                        >
                          <div
                            className="absolute left-0 right-0 border-b border-white/[0.02]"
                            style={{ top: HOUR_HEIGHT / 2 }}
                          />
                        </div>
                      ))}

                      {isHoveredDay && hoverTop !== null && (
                        <div
                          className="absolute left-0 right-0 z-30 pointer-events-none"
                          style={{ top: hoverTop }}
                        >
                          <div className="border-t border-dashed border-[#FF6600]/60" />
                          <motion.span
                            initial={{ opacity: 0, y: 2 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.1 }}
                            className="absolute -top-[13px] left-1 bg-[#161616] border border-white/15 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-md shadow-lg tabular-nums whitespace-nowrap"
                          >
                            {String(hoverSlot!.hour).padStart(2, '0')}:
                            {String(hoverSlot!.minute).padStart(2, '0')}
                          </motion.span>
                        </div>
                      )}

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
                        if (a.id === draggingId) return null // se sustituye por el "fantasma"
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
                        const canDrag =
                          !a.is_external && (isAdmin || a.comercial_id === currentUser.id)

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
                            onPointerDown={(e) => handleDragStart(e, a)}
                            onClick={(e) => {
                              e.stopPropagation()
                              if (justDraggedRef.current) {
                                justDraggedRef.current = false
                                return
                              }
                              setSheet({ mode: 'edit', appointment: a })
                            }}
                            style={{
                              top,
                              height,
                              left: `calc(${leftPct}% + 2px)`,
                              width: `calc(${widthPct}% - 4px)`,
                              touchAction: 'none',
                              border: a.is_external
                                ? '1.5px dashed rgba(124,132,147,0.5)'
                                : `1.5px solid ${color}`,
                              boxShadow: a.is_external
                                ? undefined
                                : `inset 0 0 0 1px ${color}33`,
                              background: a.is_external
                                ? 'rgba(124,132,147,0.10)'
                                : `linear-gradient(135deg, ${color}29, ${color}14)`,
                              backgroundImage: a.is_external
                                ? 'repeating-linear-gradient(135deg, rgba(255,255,255,0.035) 0px, rgba(255,255,255,0.035) 4px, transparent 4px, transparent 9px)'
                                : undefined,
                            }}
                            className={`absolute rounded-lg px-2 py-1 text-left overflow-hidden z-10 ${
                              cancelled ? 'opacity-45' : ''
                            } ${canDrag ? 'cursor-grab active:cursor-grabbing' : ''}`}
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

                      {isDropTargetDay && dragTarget && draggingAppt && (
                        <div
                          className="absolute left-1 right-1 rounded-lg px-2 py-1 z-40 pointer-events-none border-2 border-dashed"
                          style={{
                            top: topForSlot(dragTarget.hour, dragTarget.minute),
                            height: Math.max(
                              ((new Date(draggingAppt.end_time).getTime() -
                                new Date(draggingAppt.start_time).getTime()) /
                                60000 /
                                60) *
                                HOUR_HEIGHT,
                              26
                            ),
                            borderColor: draggingAppt.comercial
                              ? colorForAgent(
                                  draggingAppt.comercial.id,
                                  draggingAppt.comercial.calendar_color
                                )
                              : '#FF6600',
                            background: `${
                              draggingAppt.comercial
                                ? colorForAgent(
                                    draggingAppt.comercial.id,
                                    draggingAppt.comercial.calendar_color
                                  )
                                : '#FF6600'
                            }33`,
                          }}
                        >
                          <div className="text-[11px] font-semibold text-white truncate">
                            {draggingAppt.lead_name}
                          </div>
                          <div className="text-[10px] text-white/70 tabular-nums">
                            {String(dragTarget.hour).padStart(2, '0')}:
                            {String(dragTarget.minute).padStart(2, '0')}
                          </div>
                        </div>
                      )}
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
