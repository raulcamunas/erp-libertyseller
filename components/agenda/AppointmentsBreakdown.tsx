'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { format, isFuture } from 'date-fns'
import { es } from 'date-fns/locale'
import { motion } from 'framer-motion'
import { ArrowLeft, CalendarDays, TrendingUp, Users } from 'lucide-react'
import {
  AppointmentWithPeople,
  CalendarPerson,
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_STATUS_COLORS,
  colorForAgent,
} from '@/lib/types/appointments'
import { UserProfile } from '@/lib/supabase/get-user-profile'
import { AppointmentSheet } from './AppointmentSheet'

interface AppointmentsBreakdownProps {
  initialAppointments: AppointmentWithPeople[]
  team: CalendarPerson[]
  currentUser: UserProfile
}

function initials(name: string | null | undefined, fallback: string) {
  const source = (name || fallback || '?').trim()
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

function formatEuros(n: number) {
  return n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })
}

const SELECT_WITH_PEOPLE = `
  *,
  comercial:profiles!appointments_comercial_id_fkey(id, full_name, email, role, calendar_color),
  assigned_closer:profiles!appointments_assigned_closer_id_fkey(id, full_name, email, role, calendar_color)
`

export function AppointmentsBreakdown({
  initialAppointments,
  team,
  currentUser,
}: AppointmentsBreakdownProps) {
  const supabase = createClient()
  const [appointments, setAppointments] = useState<AppointmentWithPeople[]>(
    initialAppointments
  )
  const [filter, setFilter] = useState<'all' | 'upcoming'>('all')
  const [selected, setSelected] = useState<AppointmentWithPeople | null>(null)

  useEffect(() => {
    const channel = supabase
      .channel(`appointments_breakdown_${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'appointments' },
        async (payload) => {
          if (payload.eventType === 'DELETE') {
            const id = (payload.old as { id: string }).id
            setAppointments((prev) => prev.filter((a) => a.id !== id))
            return
          }
          const row = payload.new as { id: string; is_external: boolean }
          if (row.is_external) return
          const { data } = await supabase
            .from('appointments')
            .select(SELECT_WITH_PEOPLE)
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

  const filtered = useMemo(() => {
    if (filter === 'all') return appointments
    return appointments.filter((a) => isFuture(new Date(a.start_time)))
  }, [appointments, filter])

  const groups = useMemo(() => {
    const map = new Map<string, { person: CalendarPerson; items: AppointmentWithPeople[] }>()
    team.forEach((p) => map.set(p.id, { person: p, items: [] }))

    for (const a of filtered) {
      const id = a.comercial_id
      if (!id) continue
      if (!map.has(id)) {
        map.set(id, {
          person: a.comercial
            ? { id, full_name: a.comercial.full_name, email: a.comercial.email, role: a.comercial.role, calendar_color: a.comercial.calendar_color }
            : { id, full_name: 'Otro', email: null, role: 'employee', calendar_color: null },
          items: [],
        })
      }
      map.get(id)!.items.push(a)
    }

    for (const g of map.values()) {
      g.items.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
    }

    return Array.from(map.values())
  }, [filtered, team])

  const totals = useMemo(() => {
    const total = filtered.length
    const upcoming = filtered.filter((a) => isFuture(new Date(a.start_time))).length
    const revenue = filtered.reduce((sum, a) => sum + (a.revenue_amount || 0), 0)
    return { total, upcoming, revenue }
  }, [filtered])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/dashboard/agenda"
          className="h-9 px-3 rounded-full border border-white/10 bg-white/[0.03] text-white/70 text-sm flex items-center gap-1.5 hover:bg-white/[0.06] hover:text-white transition-colors w-fit"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Volver al calendario
        </Link>

        <div className="flex items-center rounded-full border border-white/10 bg-white/[0.03] p-1">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 h-8 rounded-full text-xs font-semibold transition-colors ${
              filter === 'all' ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white/80'
            }`}
          >
            Todas
          </button>
          <button
            onClick={() => setFilter('upcoming')}
            className={`px-4 h-8 rounded-full text-xs font-semibold transition-colors ${
              filter === 'upcoming' ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white/80'
            }`}
          >
            Próximas
          </button>
        </div>
      </div>

      {/* Resumen general */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 flex items-center gap-3">
          <span className="h-9 w-9 rounded-full bg-[#FF6600]/15 flex items-center justify-center">
            <CalendarDays className="h-4 w-4 text-[#FF6600]" />
          </span>
          <div>
            <div className="text-2xl font-bold text-white leading-none">{totals.total}</div>
            <div className="text-xs text-white/40 mt-1">Citas totales</div>
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 flex items-center gap-3">
          <span className="h-9 w-9 rounded-full bg-blue-500/15 flex items-center justify-center">
            <Users className="h-4 w-4 text-blue-300" />
          </span>
          <div>
            <div className="text-2xl font-bold text-white leading-none">{totals.upcoming}</div>
            <div className="text-xs text-white/40 mt-1">Próximas</div>
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 flex items-center gap-3">
          <span className="h-9 w-9 rounded-full bg-emerald-500/15 flex items-center justify-center">
            <TrendingUp className="h-4 w-4 text-emerald-300" />
          </span>
          <div>
            <div className="text-2xl font-bold text-white leading-none">
              {formatEuros(totals.revenue)}
            </div>
            <div className="text-xs text-white/40 mt-1">Facturación registrada</div>
          </div>
        </div>
      </div>

      {/* Por comercial */}
      <div className="space-y-4">
        {groups.map(({ person, items }, i) => {
          const color = colorForAgent(person.id, person.calendar_color)
          const upcoming = items.filter((a) => isFuture(new Date(a.start_time))).length
          const completed = items.filter((a) => a.status === 'completed').length
          const revenue = items.reduce((s, a) => s + (a.revenue_amount || 0), 0)

          return (
            <motion.div
              key={person.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04, duration: 0.2 }}
              className="rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden"
            >
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-white/[0.06]">
                <div className="flex items-center gap-2.5">
                  <span
                    className="h-8 w-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white"
                    style={{ backgroundColor: color }}
                  >
                    {initials(person.full_name, person.email || '')}
                  </span>
                  <span className="text-white font-semibold text-[15px]">
                    {person.full_name || person.email}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-xs text-white/50">
                  <span>
                    <b className="text-white">{items.length}</b> citas
                  </span>
                  <span>
                    <b className="text-white">{upcoming}</b> próximas
                  </span>
                  <span>
                    <b className="text-white">{completed}</b> realizadas
                  </span>
                  <span>
                    <b className="text-emerald-300">{formatEuros(revenue)}</b>
                  </span>
                </div>
              </div>

              {items.length === 0 ? (
                <p className="px-4 py-4 text-sm text-white/30">Sin citas en este filtro.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] text-white/35 uppercase tracking-wide">
                        <th className="px-4 py-2 font-medium">Fecha</th>
                        <th className="px-4 py-2 font-medium">Lead</th>
                        <th className="px-4 py-2 font-medium">Empresa</th>
                        <th className="px-4 py-2 font-medium">Teléfono</th>
                        <th className="px-4 py-2 font-medium">Estado</th>
                        <th className="px-4 py-2 font-medium text-right">Facturación</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((a) => (
                        <tr
                          key={a.id}
                          onClick={() => setSelected(a)}
                          className="border-t border-white/[0.04] hover:bg-white/[0.03] cursor-pointer transition-colors"
                        >
                          <td className="px-4 py-2 text-white/70 whitespace-nowrap tabular-nums">
                            {format(new Date(a.start_time), "d MMM yyyy · HH:mm", { locale: es })}
                          </td>
                          <td className="px-4 py-2 text-white font-medium">{a.lead_name}</td>
                          <td className="px-4 py-2 text-white/60">{a.lead_company || '—'}</td>
                          <td className="px-4 py-2 text-white/60 whitespace-nowrap">
                            {a.lead_phone || '—'}
                          </td>
                          <td className="px-4 py-2">
                            <span
                              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${APPOINTMENT_STATUS_COLORS[a.status]}`}
                            >
                              {APPOINTMENT_STATUS_LABELS[a.status]}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right text-white/70 tabular-nums">
                            {a.revenue_amount != null ? formatEuros(a.revenue_amount) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </motion.div>
          )
        })}
      </div>

      {selected && (
        <AppointmentSheet
          mode="edit"
          appointment={selected}
          team={team}
          currentUser={currentUser}
          onClose={() => setSelected(null)}
          onSaved={(appt) => {
            setAppointments((prev) => prev.map((a) => (a.id === appt.id ? appt : a)))
            setSelected(null)
          }}
          onDeleted={(id) => {
            setAppointments((prev) => prev.filter((a) => a.id !== id))
            setSelected(null)
          }}
        />
      )}
    </div>
  )
}
