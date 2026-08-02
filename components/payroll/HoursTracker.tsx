'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Settings2,
  TrendingUp,
  CheckCircle2,
  CalendarDays,
  Minus,
  Plus,
  Trash2,
  Zap,
} from 'lucide-react'
import {
  WorkHourEntry,
  PayrollRate,
  payrollPeriod,
  periodDays,
  periodLabel,
  resolveRate,
  formatDollars,
} from '@/lib/types/payroll'
import { CalendarPerson, colorForAgent } from '@/lib/types/appointments'
import { UserProfile } from '@/lib/supabase/get-user-profile'
import { toMadrid } from '@/lib/timezone'
import { RateSettings } from './RateSettings'

/** Cita cualificada, con lo mínimo para contarla y listarla */
export interface QualifiedAppointment {
  id: string
  comercial_id: string | null
  start_time: string
  lead_name: string
  lead_company: string | null
}

interface HoursTrackerProps {
  initialHours: WorkHourEntry[]
  initialRates: PayrollRate[]
  qualifiedAppointments: QualifiedAppointment[]
  team: CalendarPerson[]
  currentUser: UserProfile
  isAdmin: boolean
}

const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D']
const MONTHS_LONG = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]
const WEEKDAYS_LONG = [
  'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo',
]

function pad(n: number) {
  return String(n).padStart(2, '0')
}

/** 'yyyy-MM-dd' del día de hoy en hora de España */
function todayKey() {
  const d = toMadrid(new Date())
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Lunes = 0 ... Domingo = 6, leyendo la clave como fecha civil pura */
function weekdayIndex(key: string) {
  const [y, m, d] = key.split('-').map(Number)
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
}

function dayNumber(key: string) {
  return Number(key.split('-')[2])
}

/** Sube el número poco a poco: el dinero entra mejor por los ojos así */
function useCountUp(value: number, duration = 420) {
  const [display, setDisplay] = useState(value)
  const fromRef = useRef(value)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    const from = fromRef.current
    if (from === value) return
    const startedAt = performance.now()

    function tick(now: number) {
      const t = Math.min(1, (now - startedAt) / duration)
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(from + (value - from) * eased)
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        fromRef.current = value
      }
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      fromRef.current = value
    }
  }, [value, duration])

  return display
}

export function HoursTracker({
  initialHours,
  initialRates,
  qualifiedAppointments,
  team,
  currentUser,
  isAdmin,
}: HoursTrackerProps) {
  const supabase = createClient()
  const [hours, setHours] = useState<WorkHourEntry[]>(initialHours)
  const [rates, setRates] = useState<PayrollRate[]>(initialRates)
  const [appointments, setAppointments] = useState(qualifiedAppointments)
  const [offset, setOffset] = useState(0)
  const [selectedUserId, setSelectedUserId] = useState(currentUser.id)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [showRates, setShowRates] = useState(false)

  const period = useMemo(() => payrollPeriod(offset), [offset])
  const days = useMemo(() => periodDays(period), [period])
  const today = todayKey()

  // Los admins pueden mirar (y corregir) las horas de cualquiera; el
  // resto solo se ve a sí mismo.
  const viewingSelf = selectedUserId === currentUser.id
  const viewedPerson =
    team.find((p) => p.id === selectedUserId) ??
    ({ id: currentUser.id, full_name: currentUser.full_name, email: currentUser.email } as CalendarPerson)

  // Realtime: si un admin marca una cita como cualificada o cambia la
  // comisión, el comercial ve su total moverse sin recargar.
  useEffect(() => {
    const channel = supabase
      .channel(`payroll_${currentUser.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'work_hours' },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const old = payload.old as { id: string }
            setHours((prev) => prev.filter((h) => h.id !== old.id))
            return
          }
          const row = payload.new as WorkHourEntry
          setHours((prev) => {
            const exists = prev.some((h) => h.id === row.id)
            return exists ? prev.map((h) => (h.id === row.id ? row : h)) : [...prev, row]
          })
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'payroll_rates' },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const old = payload.old as { id: string }
            setRates((prev) => prev.filter((r) => r.id !== old.id))
            return
          }
          const row = payload.new as PayrollRate
          setRates((prev) => {
            const exists = prev.some((r) => r.id === row.id)
            return exists ? prev.map((r) => (r.id === row.id ? row : r)) : [...prev, row]
          })
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'appointments' },
        async () => {
          // Cualquier cambio de cita puede alterar el recuento de
          // cualificadas: se relee la lista, que es pequeña.
          const { data } = await supabase
            .from('appointments')
            .select('id, comercial_id, start_time, lead_name, lead_company')
            .eq('status', 'qualified')
            .eq('is_external', false)
          if (data) setAppointments(data as QualifiedAppointment[])
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, currentUser.id])

  const hoursByDay = useMemo(() => {
    const map = new Map<string, WorkHourEntry>()
    for (const h of hours) {
      if (h.user_id === selectedUserId) map.set(h.work_date, h)
    }
    return map
  }, [hours, selectedUserId])

  const totalHours = useMemo(
    () => days.reduce((sum, d) => sum + Number(hoursByDay.get(d)?.hours ?? 0), 0),
    [days, hoursByDay]
  )

  const workedDays = useMemo(
    () => days.filter((d) => Number(hoursByDay.get(d)?.hours ?? 0) > 0).length,
    [days, hoursByDay]
  )

  const periodQualified = useMemo(
    () =>
      appointments
        .filter((a) => a.comercial_id === selectedUserId)
        .filter((a) => {
          const t = new Date(a.start_time).getTime()
          return t >= period.start.getTime() && t < period.end.getTime()
        })
        .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()),
    [appointments, selectedUserId, period]
  )

  const rate = resolveRate(rates, period.key, selectedUserId)
  const salary = totalHours * rate.hourly
  const commissions = periodQualified.length * rate.commission
  const total = salary + commissions

  const animatedTotal = useCountUp(total)
  const animatedSalary = useCountUp(salary)
  const animatedCommissions = useCountUp(commissions)

  function openDay(key: string) {
    setSelectedDay(key)
    const current = hoursByDay.get(key)
    setDraft(current ? String(Number(current.hours)) : '')
  }

  async function saveDay(key: string, value: number | null) {
    setSaving(true)
    try {
      const existing = hoursByDay.get(key)

      // Cero horas es lo mismo que no haber apuntado nada: se borra la
      // fila en vez de dejar un 0 suelto ensuciando el calendario.
      if (value === null || value === 0) {
        if (existing) {
          const { error } = await supabase.from('work_hours').delete().eq('id', existing.id)
          if (error) throw error
          setHours((prev) => prev.filter((h) => h.id !== existing.id))
        }
        setSelectedDay(null)
        return
      }

      const { data, error } = await supabase
        .from('work_hours')
        .upsert(
          { user_id: selectedUserId, work_date: key, hours: value },
          { onConflict: 'user_id,work_date' }
        )
        .select('*')
        .single()
      if (error) throw error

      const row = data as WorkHourEntry
      setHours((prev) => {
        const exists = prev.some((h) => h.id === row.id)
        return exists ? prev.map((h) => (h.id === row.id ? row : h)) : [...prev, row]
      })
      setSelectedDay(null)
    } catch (err) {
      console.error('Error guardando horas:', err)
      toast.error('No se pudieron guardar las horas')
    } finally {
      setSaving(false)
    }
  }

  const leadingBlanks = days.length ? weekdayIndex(days[0]) : 0
  const todayHours = Number(hoursByDay.get(today)?.hours ?? 0)
  const todayInPeriod = days.includes(today)

  return (
    // Ocupa toda la altura disponible: el calendario del ciclo se estira
    // para que cada día sea una casilla grande y cómoda de pulsar.
    <div className="flex flex-col h-full gap-3 min-h-0">
      {/* Barra de control */}
      <div className="flex flex-wrap items-center justify-between gap-2 flex-shrink-0">
        <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-1.5 py-1">
          <button
            onClick={() => setOffset((o) => o - 1)}
            className="h-7 w-7 flex items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <AnimatePresence mode="wait">
            <motion.span
              key={period.key}
              initial={{ opacity: 0, y: -3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 3 }}
              transition={{ duration: 0.15 }}
              className="text-[13px] font-semibold text-white px-1.5 flex items-center gap-1.5 whitespace-nowrap"
            >
              <CalendarDays className="h-3.5 w-3.5 text-[#FF6600]" />
              {periodLabel(period)}
            </motion.span>
          </AnimatePresence>
          <button
            onClick={() => setOffset((o) => o + 1)}
            className="h-7 w-7 flex items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          {offset !== 0 && (
            <button
              onClick={() => setOffset(0)}
              className="text-[11px] text-white/40 hover:text-white px-2 transition-colors"
            >
              Hoy
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isAdmin && team.length > 0 && (
            <select
              value={selectedUserId}
              onChange={(e) => {
                setSelectedUserId(e.target.value)
                setSelectedDay(null)
              }}
              className="h-9 rounded-full border border-white/10 bg-white/[0.03] px-3 text-[13px] text-white/80 outline-none focus:border-[#FF6600] transition-colors cursor-pointer"
            >
              <option value={currentUser.id} className="bg-[#1a1a1a]">
                {currentUser.full_name || 'Yo'}
              </option>
              {team
                .filter((p) => p.id !== currentUser.id)
                .map((p) => (
                  <option key={p.id} value={p.id} className="bg-[#1a1a1a]">
                    {p.full_name || p.email}
                  </option>
                ))}
            </select>
          )}
          {isAdmin && (
            <button
              onClick={() => setShowRates(true)}
              className="h-9 px-4 rounded-full border border-white/10 bg-white/[0.03] text-white/80 text-[13px] font-medium flex items-center gap-2 hover:bg-white/[0.06] hover:border-white/20 transition-colors"
            >
              <Settings2 className="h-4 w-4" /> Tarifas
            </button>
          )}
        </div>
      </div>

      {!viewingSelf && (
        <div className="rounded-xl border border-[#FF6600]/25 bg-[#FF6600]/[0.06] px-3 py-2 text-[12px] text-white/70">
          Estás viendo y editando las horas de{' '}
          <span className="font-semibold text-white">
            {viewedPerson.full_name || viewedPerson.email}
          </span>
          . Cualquier cambio se le guarda a esa persona.
        </div>
      )}

      {/* Lo que lleva ganado */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#FF6600]/[0.13] via-white/[0.03] to-transparent p-4 flex-shrink-0"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -right-16 h-56 w-56 rounded-full bg-[#FF6600]/20 blur-3xl"
        />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.14em] text-white/40 flex items-center gap-1.5">
              <TrendingUp className="h-3 w-3" /> Llevas ganado este periodo
            </p>
            <p className="text-white font-bold text-[34px] sm:text-[44px] leading-none mt-1.5 tabular-nums">
              {formatDollars(animatedTotal)}
            </p>
          </div>

          <div className="flex gap-2 flex-wrap">
            <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 min-w-[132px]">
              <p className="text-[10px] uppercase tracking-wider text-white/35 flex items-center gap-1.5">
                <Clock className="h-3 w-3" /> Salario
              </p>
              <p className="text-white font-semibold text-[18px] tabular-nums">
                {formatDollars(animatedSalary)}
              </p>
              <p className="text-[10px] text-white/35 mt-0.5">
                {totalHours.toLocaleString('es-ES')} h × {formatDollars(rate.hourly)}
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 min-w-[132px]">
              <p className="text-[10px] uppercase tracking-wider text-white/35 flex items-center gap-1.5">
                <CheckCircle2 className="h-3 w-3" /> Comisiones
              </p>
              <p className="text-white font-semibold text-[18px] tabular-nums">
                {formatDollars(animatedCommissions)}
              </p>
              <p className="text-[10px] text-white/35 mt-0.5">
                {periodQualified.length}{' '}
                {periodQualified.length === 1 ? 'cita' : 'citas'} ×{' '}
                {formatDollars(rate.commission)}
              </p>
            </div>
          </div>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-3 flex-1 min-h-0">
        {/* Calendario del periodo */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3 flex flex-col min-h-0">
          {/* Apuntar hoy, a un toque */}
          {todayInPeriod && viewingSelf && (
            <div
              className={`rounded-xl border px-3 py-2 mb-3 flex flex-wrap items-center gap-2 flex-shrink-0 ${
                todayHours > 0
                  ? 'border-green-500/25 bg-green-500/[0.06]'
                  : 'border-[#FF6600]/30 bg-[#FF6600]/[0.07]'
              }`}
            >
              <Zap
                className={`h-3.5 w-3.5 flex-shrink-0 ${
                  todayHours > 0 ? 'text-green-400' : 'text-[#FF6600]'
                }`}
              />
              <span className="text-[12px] text-white/75 flex-1 min-w-[140px]">
                {todayHours > 0
                  ? `Hoy tienes apuntadas ${todayHours} h`
                  : 'Todavía no has apuntado las horas de hoy'}
              </span>
              {[3, 4, 5, 6, 7, 8].map((h) => (
                <button
                  key={h}
                  onClick={() => saveDay(today, h)}
                  disabled={saving}
                  className={`h-6 min-w-[30px] px-1.5 rounded-md text-[11px] font-semibold transition-colors ${
                    todayHours === h
                      ? 'bg-[#FF6600] text-white'
                      : 'bg-white/[0.06] text-white/60 hover:bg-white/[0.12] hover:text-white'
                  }`}
                >
                  {h}h
                </button>
              ))}
            </div>
          )}

          {/* Editor del día seleccionado */}
          <AnimatePresence>
            {selectedDay && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden flex-shrink-0"
              >
                <div className="rounded-xl border border-white/12 bg-white/[0.04] p-3 mb-3">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <p className="text-[13px] font-semibold text-white">
                      {WEEKDAYS_LONG[weekdayIndex(selectedDay)]} {dayNumber(selectedDay)} de{' '}
                      {MONTHS_LONG[Number(selectedDay.split('-')[1]) - 1]}
                    </p>
                    <button
                      onClick={() => setSelectedDay(null)}
                      className="text-[11px] text-white/40 hover:text-white transition-colors"
                    >
                      Cerrar
                    </button>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-black/25 p-1">
                      <button
                        onClick={() =>
                          setDraft((d) => String(Math.max(0, (Number(d) || 0) - 0.5)))
                        }
                        className="h-7 w-7 rounded-md flex items-center justify-center text-white/60 hover:text-white hover:bg-white/[0.08] transition-colors"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <input
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveDay(selectedDay, Number(draft) || 0)
                          if (e.key === 'Escape') setSelectedDay(null)
                        }}
                        autoFocus
                        inputMode="decimal"
                        placeholder="0"
                        className="w-14 bg-transparent text-center text-[18px] font-bold text-white outline-none tabular-nums"
                      />
                      <button
                        onClick={() =>
                          setDraft((d) => String(Math.min(24, (Number(d) || 0) + 0.5)))
                        }
                        className="h-7 w-7 rounded-md flex items-center justify-center text-white/60 hover:text-white hover:bg-white/[0.08] transition-colors"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {[2, 3, 4, 5, 6, 7, 8].map((h) => (
                      <button
                        key={h}
                        onClick={() => setDraft(String(h))}
                        className={`h-7 min-w-[32px] px-2 rounded-md text-[11px] font-semibold transition-colors ${
                          Number(draft) === h
                            ? 'bg-[#FF6600] text-white'
                            : 'bg-white/[0.06] text-white/55 hover:bg-white/[0.12] hover:text-white'
                        }`}
                      >
                        {h}h
                      </button>
                    ))}

                    <div className="flex-1" />

                    {hoursByDay.has(selectedDay) && (
                      <button
                        onClick={() => saveDay(selectedDay, null)}
                        disabled={saving}
                        className="h-8 w-8 rounded-lg border border-white/10 flex items-center justify-center text-white/40 hover:text-red-400 hover:border-red-400/30 transition-colors"
                        title="Borrar las horas de este día"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => saveDay(selectedDay, Number(draft) || 0)}
                      disabled={saving}
                      className="h-8 px-4 rounded-lg bg-[#FF6600] text-[12px] font-semibold text-white disabled:opacity-40 transition-opacity"
                    >
                      Guardar
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Rejilla de días: se reparte toda la altura que sobra, así que
              cada casilla es lo más grande que quepa en la pantalla. */}
          <div className="flex flex-col flex-1 min-h-0">
            <div className="grid grid-cols-7 gap-1.5 mb-1.5 flex-shrink-0">
              {WEEKDAYS.map((d, i) => (
                <div
                  key={`${d}-${i}`}
                  className="text-center text-[11px] font-semibold text-white/25 uppercase tracking-wider"
                >
                  {d}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 auto-rows-fr gap-1.5 flex-1 min-h-0">
            {Array.from({ length: leadingBlanks }).map((_, i) => (
              <div key={`blank-${i}`} />
            ))}
            {days.map((key) => {
              const entry = hoursByDay.get(key)
              const value = Number(entry?.hours ?? 0)
              const isToday = key === today
              const isSelected = key === selectedDay
              const weekend = weekdayIndex(key) >= 5
              const isFuture = key > today

              return (
                <motion.button
                  key={key}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => openDay(key)}
                  className={`group relative min-h-[52px] rounded-xl border flex flex-col items-start justify-between p-2 transition-colors ${
                    isSelected
                      ? 'border-[#FF6600] bg-[#FF6600]/15'
                      : value > 0
                        ? 'border-[#FF6600]/25 bg-[#FF6600]/[0.09] hover:border-[#FF6600]/50'
                        : `border-white/[0.07] hover:border-white/20 hover:bg-white/[0.04] ${
                            weekend ? 'bg-white/[0.01]' : ''
                          }`
                  } ${isFuture ? 'opacity-40' : ''}`}
                >
                  <span
                    className={`text-[13px] leading-none ${
                      isToday ? 'text-[#FF6600] font-bold' : 'text-white/45'
                    }`}
                  >
                    {dayNumber(key)}
                  </span>

                  {value > 0 ? (
                    <span className="self-end text-[22px] font-bold text-white leading-none tabular-nums">
                      {value}
                      <span className="text-[12px] font-medium text-white/45 ml-0.5">h</span>
                    </span>
                  ) : (
                    !isFuture && (
                      <span className="self-end opacity-0 group-hover:opacity-100 transition-opacity">
                        <Plus className="h-4 w-4 text-white/30" />
                      </span>
                    )
                  )}

                  {isToday && (
                    <span className="absolute top-2 right-2 h-1.5 w-1.5 rounded-full bg-[#FF6600]" />
                  )}
                </motion.button>
              )
            })}
            </div>
          </div>
        </div>

        {/* Resumen lateral */}
        <div className="space-y-3 overflow-y-auto min-h-0">
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
            <h3 className="text-[10px] font-semibold text-white/45 uppercase tracking-wider mb-2">
              Resumen del periodo
            </h3>
            <div className="space-y-1.5">
              {[
                { label: 'Horas totales', value: `${totalHours.toLocaleString('es-ES')} h` },
                { label: 'Días trabajados', value: String(workedDays) },
                {
                  label: 'Media por día',
                  value: workedDays
                    ? `${(totalHours / workedDays).toFixed(1).replace('.', ',')} h`
                    : '—',
                },
                { label: 'Citas cualificadas', value: String(periodQualified.length) },
                {
                  label: 'Tarifa aplicada',
                  value: `${formatDollars(rate.hourly)}/h · ${formatDollars(rate.commission)}/cita`,
                },
              ].map((r) => (
                <div key={r.label} className="flex items-baseline justify-between gap-2">
                  <span className="text-[12px] text-white/40">{r.label}</span>
                  <span className="text-[12px] font-semibold text-white text-right">
                    {r.value}
                  </span>
                </div>
              ))}
            </div>
            {rate.source === 'personal' && (
              <p className="text-[10px] text-[#FF6600]/80 mt-2">
                Tarifa propia para esta persona en este periodo.
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
            <h3 className="text-[10px] font-semibold text-white/45 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <CheckCircle2 className="h-3 w-3" /> Citas cualificadas
            </h3>
            {periodQualified.length === 0 ? (
              <p className="text-[11px] text-white/25">
                Ninguna todavía en este periodo. En cuanto se marque una cita como
                cualificada, aparecerá aquí y sumará a tus comisiones.
              </p>
            ) : (
              <div className="space-y-1.5 pr-1">
                {periodQualified.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.02] px-2 py-1.5"
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: colorForAgent(selectedUserId) }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] text-white truncate">{a.lead_name}</p>
                      <p className="text-[10px] text-white/30 truncate">
                        {a.lead_company || 'Sin empresa'} ·{' '}
                        {toMadrid(a.start_time).getDate()}{' '}
                        {MONTHS_LONG[toMadrid(a.start_time).getMonth()].slice(0, 3)}
                      </p>
                    </div>
                    <span className="text-[11px] font-semibold text-green-300 flex-shrink-0">
                      +{formatDollars(rate.commission)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showRates && (
          <RateSettings
            period={period}
            rates={rates}
            team={team}
            onClose={() => setShowRates(false)}
            onSaved={(r) =>
              setRates((prev) =>
                prev.some((x) => x.id === r.id)
                  ? prev.map((x) => (x.id === r.id ? r : x))
                  : [...prev, r]
              )
            }
            onRemoved={(id) => setRates((prev) => prev.filter((r) => r.id !== id))}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
