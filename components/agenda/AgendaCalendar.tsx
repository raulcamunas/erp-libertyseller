'use client'

import { useState, useEffect, useMemo, useRef, Fragment } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import {
  startOfWeek,
  addDays,
  addWeeks,
  format,
  isSameDay,
} from 'date-fns'
import { toMadrid, fromMadrid, madridWallClockString } from '@/lib/timezone'
import { es } from 'date-fns/locale'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Calendar as CalIcon,
  Video,
  Link2,
  Table2,
  Contact,
  Clock3 as ClockIcon,
} from 'lucide-react'
import { AppointmentSheet } from './AppointmentSheet'
import { AvailabilitySettings } from './AvailabilitySettings'
import {
  AppointmentWithPeople,
  CalendarPerson,
  colorForAgent,
  APPOINTMENT_STATUS_COLORS,
} from '@/lib/types/appointments'
import { AvailabilityWindow, parseTimeToHourMinute } from '@/lib/types/availability'
import { UserProfile } from '@/lib/supabase/get-user-profile'
import { layoutOverlappingEvents } from '@/lib/calendar-layout'

interface AgendaCalendarProps {
  initialAppointments: AppointmentWithPeople[]
  team: CalendarPerson[]
  currentUser: UserProfile
  initialAvailabilityWindows?: AvailabilityWindow[]
}

const DAY_START = 8 // 08:00
const DAY_END = 21 // 21:00
const HOUR_HEIGHT = 64 // px por hora
const HOURS = Array.from({ length: DAY_END - DAY_START }, (_, i) => DAY_START + i)

// Etiquetas cortas para que quepan dentro de la tarjeta del calendario
const CARD_STATUS_LABELS: Record<string, string> = {
  scheduled: 'Agendada',
  confirmed: 'Confirmada',
  rescheduled: 'Reagendada',
  no_show: 'No asistió',
  qualified: 'Cualificada',
  not_qualified: 'No cualificada',
}

function initials(name: string | null | undefined, fallback: string) {
  const source = (name || fallback || '?').trim()
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

/** Estado de presencia: quién está rellenando/editando qué en este momento */
interface PresenceEntry {
  userId: string
  fullName: string | null
  email: string | null
  color: string
  mode: 'create' | 'edit'
  dayIso?: string
  hour?: number
  minute?: number
  appointmentId?: string
}

export function AgendaCalendar({
  initialAppointments,
  team,
  currentUser,
  initialAvailabilityWindows,
}: AgendaCalendarProps) {
  const supabase = createClient()
  const [appointments, setAppointments] = useState<AppointmentWithPeople[]>(
    initialAppointments
  )
  const [weekStart, setWeekStart] = useState<Date>(
    startOfWeek(toMadrid(new Date()), { weekStartsOn: 1 })
  )
  const [direction, setDirection] = useState(0)
  const [sheet, setSheet] = useState<
    | { mode: 'create'; prefill: { start: Date; end: Date } }
    | { mode: 'edit'; appointment: AppointmentWithPeople }
    | null
  >(null)
  const [hoverSlot, setHoverSlot] = useState<{
    dayIso: string
    hour: number
    minute: number
  } | null>(null)
  const [now, setNow] = useState(() => toMadrid(new Date()))
  const isAdmin = currentUser.role === 'admin' || currentUser.role === 'partner'
  const gridRef = useRef<HTMLDivElement>(null)
  const daysGridRef = useRef<HTMLDivElement>(null)
  const [availabilityWindows, setAvailabilityWindows] = useState<AvailabilityWindow[]>(
    initialAvailabilityWindows ?? []
  )
  const [showAvailabilitySettings, setShowAvailabilitySettings] = useState(false)

  // ── Presencia en vivo: quién está creando/editando una cita ahora mismo ──
  const [presenceList, setPresenceList] = useState<PresenceEntry[]>([])
  const presenceChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  // ── Drag & drop de citas ──────────────────────────────────────────────
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragTarget, setDragTarget] = useState<{
    dayIso: string
    hour: number
    minute: number
  } | null>(null)
  const dragTargetRef = useRef<typeof dragTarget>(null)
  const justDraggedRef = useRef(false)

  // Reloj para la línea de "ahora" (siempre en hora de España)
  useEffect(() => {
    const id = setInterval(() => setNow(toMadrid(new Date())), 60_000)
    return () => clearInterval(id)
  }, [])

  // Centrar el scroll cerca de la hora actual (España) al montar
  useEffect(() => {
    if (!gridRef.current) return
    const h = toMadrid(new Date()).getHours()
    const offset = Math.max(0, (h - DAY_START - 1) * HOUR_HEIGHT)
    gridRef.current.scrollTop = offset
  }, [])

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

  // Canal de presencia compartido por todo el equipo: quién está creando
  // o editando una cita ahora mismo, para evitar solapamientos.
  useEffect(() => {
    const channel = supabase.channel('agenda-presence', {
      config: { presence: { key: currentUser.id } },
    })
    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<PresenceEntry>()
        const entries = Object.values(state)
          .flat()
          .filter((p) => p.userId !== currentUser.id)
        setPresenceList(entries)
      })
      .subscribe()
    presenceChannelRef.current = channel
    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, currentUser.id])

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  )

  // Anuncia al resto del equipo qué se está rellenando ahora mismo (o
  // deja de anunciarlo al cerrar la cajita).
  useEffect(() => {
    const channel = presenceChannelRef.current
    if (!channel) return

    if (!sheet) {
      channel.untrack()
      return
    }

    const color = colorForAgent(currentUser.id)
    if (sheet.mode === 'create') {
      const start = toMadrid(sheet.prefill.start)
      const dayMatch = days.find((d) => isSameDay(d, start))
      channel.track({
        userId: currentUser.id,
        fullName: currentUser.full_name,
        email: currentUser.email,
        color,
        mode: 'create',
        dayIso: dayMatch?.toISOString(),
        hour: start.getHours(),
        minute: start.getMinutes(),
      } satisfies PresenceEntry)
    } else {
      channel.track({
        userId: currentUser.id,
        fullName: currentUser.full_name,
        email: currentUser.email,
        color,
        mode: 'edit',
        appointmentId: sheet.appointment.id,
      } satisfies PresenceEntry)
    }

    return () => {
      channel.untrack()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet, days, currentUser])

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
    const dayAppts = appointments.filter((a) => isSameDay(toMadrid(a.start_time), day))
    return layoutOverlappingEvents(
      dayAppts,
      (a) => new Date(a.start_time).getTime(),
      (a) => new Date(a.end_time).getTime()
    )
  }

  function positionFor(a: AppointmentWithPeople) {
    const start = toMadrid(a.start_time)
    const end = toMadrid(a.end_time)
    const startMins = (start.getHours() - DAY_START) * 60 + start.getMinutes()
    const endMins = (end.getHours() - DAY_START) * 60 + end.getMinutes()
    const top = (startMins / 60) * HOUR_HEIGHT
    const height = Math.max(((endMins - startMins) / 60) * HOUR_HEIGHT, 26)
    return { top, height }
  }

  function handleSlotClick(day: Date, hour: number, minute: number = 0) {
    const start = fromMadrid(madridWallClockString(day, hour, minute))
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

  /**
   * Arranca en pointerdown pero NO activa el modo "arrastrando" hasta que
   * el puntero se mueva más de un pequeño umbral. Así un clic normal (sin
   * mover el ratón) nunca oculta la cita ni interfiere con el onClick que
   * abre la cajita — solo un arrastre real la convierte en un drag.
   */
  function handleDragStart(e: React.PointerEvent, a: AppointmentWithPeople) {
    const canDrag = !a.is_external && (isAdmin || a.comercial_id === currentUser.id)
    if (!canDrag) return
    e.stopPropagation()

    const start = toMadrid(a.start_time)
    const dayMatch = days.find((d) => isSameDay(d, start))
    if (!dayMatch) return
    const initial = {
      dayIso: dayMatch.toISOString(),
      hour: start.getHours(),
      minute: start.getMinutes(),
    }
    const startX = e.clientX
    const startY = e.clientY
    const THRESHOLD = 6
    let isDragging = false

    function beginDrag() {
      isDragging = true
      dragTargetRef.current = initial
      setDraggingId(a.id)
      setDragTarget(initial)
      document.body.style.userSelect = 'none'
    }

    function onMove(ev: PointerEvent) {
      if (!isDragging) {
        const dx = ev.clientX - startX
        const dy = ev.clientY - startY
        if (Math.hypot(dx, dy) < THRESHOLD) return
        beginDrag()
      }
      const slot = pointerToSlot(ev.clientX, ev.clientY)
      if (!slot) return
      const dayIso = days[slot.dayIndex].toISOString()
      const prev = dragTargetRef.current
      if (
        prev &&
        prev.dayIso === dayIso &&
        prev.hour === slot.hour &&
        prev.minute === slot.minute
      ) {
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

      if (!isDragging) return // fue un clic normal, no un drag

      const target = dragTargetRef.current
      dragTargetRef.current = null
      setDraggingId(null)
      setDragTarget(null)

      const moved =
        !!target &&
        (target.dayIso !== initial.dayIso ||
          target.hour !== initial.hour ||
          target.minute !== initial.minute)

      if (moved && target) {
        justDraggedRef.current = true
        commitDrag(a.id, target)
      }
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
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
    const newStart = fromMadrid(madridWallClockString(day, target.hour, target.minute))
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
          revenue_amount: original.revenue_amount,
          call_date: original.call_date,
          amazon_link: original.amazon_link,
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
    <div className="flex flex-col h-full min-h-0 gap-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 flex-shrink-0">
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
              onClick={() => goToWeek(startOfWeek(toMadrid(new Date()), { weekStartsOn: 1 }), 0)}
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
            <button
              onClick={() => setShowAvailabilitySettings(true)}
              className="h-10 px-4 rounded-full border border-white/10 bg-white/[0.03] text-white/80 text-sm font-medium flex items-center gap-2 hover:bg-white/[0.06] hover:border-white/20 transition-colors"
            >
              <ClockIcon className="h-4 w-4" /> Mi disponibilidad
            </button>
          )}
          <Link
            href="/dashboard/agenda/desglose"
            className="h-10 px-4 rounded-full border border-white/10 bg-white/[0.03] text-white/80 text-sm font-medium flex items-center gap-2 hover:bg-white/[0.06] hover:border-white/20 transition-colors"
          >
            <Table2 className="h-4 w-4" /> Desglose de citas
          </Link>
          {isAdmin && (
            <Link
              href="/dashboard/agenda/crm"
              className="h-10 px-4 rounded-full border border-white/10 bg-white/[0.03] text-white/80 text-sm font-medium flex items-center gap-2 hover:bg-white/[0.06] hover:border-white/20 transition-colors"
            >
              <Contact className="h-4 w-4" /> CRM de clientes
            </Link>
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
        <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
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
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden flex-1 min-h-0 flex flex-col">
        <div
          ref={gridRef}
          className="overflow-x-auto overflow-y-auto flex-1 min-h-0"
        >
          <div className="min-w-[880px]">
            {/* Cabecera de días (sticky) */}
            <div className="sticky top-0 z-20 grid grid-cols-[60px_repeat(7,1fr)] bg-[#0a0a0a]/95 backdrop-blur border-b border-white/10">
              <div className="p-2" />
              {days.map((day) => (
                <div
                  key={day.toISOString()}
                  className={`py-3 text-center border-l border-white/5 transition-colors ${
                    isSameDay(day, now) ? 'bg-[#FF6600]/[0.06]' : ''
                  }`}
                >
                  <div className="text-[10px] text-white/35 uppercase tracking-wider font-medium">
                    {format(day, 'EEE', { locale: es })}
                  </div>
                  <div
                    className={`mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full text-[15px] font-semibold ${
                      isSameDay(day, now)
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
                  const showNowLine = isSameDay(day, now) && nowLineTop !== null
                  const dayIso = day.toISOString()
                  const isHoveredDay = !draggingId && hoverSlot?.dayIso === dayIso
                  const hoverTop = isHoveredDay
                    ? ((hoverSlot!.hour - DAY_START) * 60 + hoverSlot!.minute) / 60 *
                      HOUR_HEIGHT
                    : null
                  const draggingAppt =
                    draggingId ? appointments.find((a) => a.id === draggingId) : null
                  const isDropTargetDay = draggingId && dragTarget?.dayIso === dayIso
                  const presenceHere = presenceList.filter(
                    (p) => p.mode === 'create' && p.dayIso === dayIso
                  )

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

                      {/* Franjas de disponibilidad (banda visual, informativa) */}
                      {availabilityWindows
                        .filter((w) => w.days_of_week.includes(day.getDay()))
                        .map((w) => {
                          const start = parseTimeToHourMinute(w.start_time)
                          const end = parseTimeToHourMinute(w.end_time)
                          const top = topForSlot(start.hour, start.minute)
                          const height =
                            (((end.hour - start.hour) * 60 + (end.minute - start.minute)) /
                              60) *
                            HOUR_HEIGHT
                          return (
                            <div
                              key={w.id}
                              className="absolute left-0 right-0 bg-emerald-500/[0.06] border-y border-emerald-500/20 pointer-events-none"
                              style={{ top, height }}
                            />
                          )
                        })}

                      {/* Alguien más está rellenando una cita nueva a esta hora */}
                      {presenceHere.map((p) => (
                        <motion.div
                          key={p.userId}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="absolute left-1 right-1 z-30 pointer-events-none rounded-lg border-2 border-dashed px-2 py-1 overflow-hidden"
                          style={{
                            top: topForSlot(p.hour ?? 0, p.minute ?? 0),
                            height: HOUR_HEIGHT / 2,
                            borderColor: p.color,
                            background: `${p.color}1a`,
                          }}
                        >
                          <div
                            className="flex items-center gap-1 text-[10px] font-semibold truncate"
                            style={{ color: p.color }}
                          >
                            <span className="relative flex h-1.5 w-1.5 flex-shrink-0">
                              <span
                                className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                                style={{ backgroundColor: p.color }}
                              />
                              <span
                                className="relative inline-flex rounded-full h-1.5 w-1.5"
                                style={{ backgroundColor: p.color }}
                              />
                            </span>
                            {p.fullName || p.email} agendando...
                          </div>
                        </motion.div>
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
                        const cancelled = a.status === 'not_qualified'
                        const widthPct = 100 / totalCols
                        const leftPct = col * widthPct
                        const compact = height < 40
                        const canDrag =
                          !a.is_external && (isAdmin || a.comercial_id === currentUser.id)
                        const editorPresence = presenceList.find(
                          (p) => p.mode === 'edit' && p.appointmentId === a.id
                        )

                        return (
                          <Fragment key={a.id}>
                          <motion.button
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
                            <div className="flex items-center justify-between gap-1">
                              <div
                                className={`flex items-center gap-1 text-[11px] font-semibold text-white truncate min-w-0 ${
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
                              {!a.is_external && (
                                <span
                                  className={`flex-shrink-0 text-[8px] font-semibold px-1 py-0.5 rounded border leading-none whitespace-nowrap ${APPOINTMENT_STATUS_COLORS[a.status]}`}
                                >
                                  {CARD_STATUS_LABELS[a.status] ?? a.status}
                                </span>
                              )}
                            </div>
                            {!compact && (
                              <div className="text-[10px] text-white/55 truncate tabular-nums">
                                {format(toMadrid(a.start_time), 'HH:mm')}
                                {a.is_external
                                  ? ''
                                  : a.lead_company
                                    ? ` · ${a.lead_company}`
                                    : ''}
                              </div>
                            )}
                          </motion.button>

                          {editorPresence && (
                            <div
                              className="absolute z-20 pointer-events-none"
                              style={{
                                top: top - 3,
                                left: `calc(${leftPct + widthPct}% - 12px)`,
                              }}
                              title={`${editorPresence.fullName || editorPresence.email} está editando esta cita`}
                            >
                              <span className="relative flex h-2.5 w-2.5">
                                <span
                                  className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                                  style={{ backgroundColor: editorPresence.color }}
                                />
                                <span
                                  className="relative inline-flex rounded-full h-2.5 w-2.5 border-2 border-[#0a0a0a]"
                                  style={{ backgroundColor: editorPresence.color }}
                                />
                              </span>
                            </div>
                          )}
                          </Fragment>
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

      {showAvailabilitySettings && (
        <AvailabilitySettings
          currentUser={currentUser}
          windows={availabilityWindows}
          onClose={() => setShowAvailabilitySettings(false)}
          onChange={setAvailabilityWindows}
        />
      )}
    </div>
  )
}
