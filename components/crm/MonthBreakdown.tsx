'use client'

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { toMadrid } from '@/lib/timezone'
import {
  X,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Wallet,
  Euro,
  Clock,
  CheckCircle2,
} from 'lucide-react'
import { CrmClientWithDetails, crmContact } from '@/lib/types/crm'
import {
  WorkHourEntry,
  PayrollRate,
  cycleKeyForDate,
  resolveRate,
} from '@/lib/types/payroll'
import { CalendarPerson, colorForAgent } from '@/lib/types/appointments'

export interface BreakdownAppointment {
  id: string
  comercial_id: string | null
  start_time: string
}

interface MonthBreakdownProps {
  clients: CrmClientWithDetails[]
  team: CalendarPerson[]
  hours: WorkHourEntry[]
  rates: PayrollRate[]
  qualified: BreakdownAppointment[]
  usdEur: number
  onClose: () => void
}

const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function euros(n: number) {
  return `${Math.round(n).toLocaleString('es-ES')} €`
}

function dollars(n: number) {
  return `${Math.round(n).toLocaleString('es-ES')} $`
}

/** 'yyyy-MM' del día civil en España de una fecha ISO */
function monthOf(iso: string) {
  const d = toMadrid(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

export function MonthBreakdown({
  clients,
  team,
  hours,
  rates,
  qualified,
  usdEur,
  onClose,
}: MonthBreakdownProps) {
  const [offset, setOffset] = useState(0)

  const { monthKey, label } = useMemo(() => {
    const now = toMadrid(new Date())
    let y = now.getFullYear()
    let m = now.getMonth() + offset
    y += Math.floor(m / 12)
    m = ((m % 12) + 12) % 12
    return { monthKey: `${y}-${pad(m + 1)}`, label: `${MONTHS[m]} ${y}` }
  }, [offset])

  // ---------- Ingresos ----------
  // Solo el set up: es lo único que se cobra el mes que entra el cliente.
  // El mantenimiento no arranca hasta más adelante (unos 3 meses de
  // media), así que meterlo aquí inflaría la caja del mes.
  const income = useMemo(() => {
    const won = clients.filter((c) => c.stage === 'ganado' && c.closed_at)
    const closedThisMonth = won.filter((c) => monthOf(c.closed_at!) === monthKey)
    const setups = closedThisMonth.reduce((s, c) => s + (Number(c.setup_budget) || 0), 0)
    return { closedThisMonth, setups, total: setups }
  }, [clients, monthKey])

  // ---------- Costes por comercial ----------
  const costs = useMemo(() => {
    const rows = team.map((p) => {
      let personHours = 0
      let salary = 0
      for (const h of hours) {
        if (h.user_id !== p.id) continue
        if (!h.work_date.startsWith(monthKey)) continue
        const rate = resolveRate(rates, cycleKeyForDate(h.work_date), p.id)
        personHours += Number(h.hours)
        salary += Number(h.hours) * rate.hourly
      }

      let appts = 0
      let commissions = 0
      for (const a of qualified) {
        if (a.comercial_id !== p.id) continue
        const d = toMadrid(a.start_time)
        const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
        if (!key.startsWith(monthKey)) continue
        appts += 1
        commissions += resolveRate(rates, cycleKeyForDate(key), p.id).commission
      }

      return { person: p, hours: personHours, salary, appts, commissions, total: salary + commissions }
    })

    const totalUsd = rows.reduce((s, r) => s + r.total, 0)
    return { rows, totalUsd, totalEur: totalUsd * usdEur }
  }, [team, hours, rates, qualified, monthKey, usdEur])

  const margin = income.total - costs.totalEur
  const marginPct = income.total > 0 ? (margin / income.total) * 100 : 0
  const positive = margin >= 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/75 backdrop-blur-sm"
      />
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.18 }}
        className="relative w-full max-w-4xl max-h-[88vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#0d0d0d] p-4 shadow-2xl"
      >
        {/* Cabecera con navegación de mes */}
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-1.5 py-1">
            <button
              onClick={() => setOffset((o) => o - 1)}
              className="h-7 w-7 flex items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/[0.06] transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-[14px] font-semibold text-white px-2 capitalize whitespace-nowrap">
              {label}
            </span>
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
                Este mes
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-white/40 hover:text-white transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Resultado del mes */}
        <div
          className={`rounded-2xl border p-4 mb-3 ${
            positive
              ? 'border-green-500/25 bg-gradient-to-br from-green-500/[0.10] to-transparent'
              : 'border-red-500/25 bg-gradient-to-br from-red-500/[0.10] to-transparent'
          }`}
        >
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-[0.14em] text-white/40 flex items-center gap-1.5">
                {positive ? (
                  <TrendingUp className="h-3 w-3 text-green-400" />
                ) : (
                  <TrendingDown className="h-3 w-3 text-red-400" />
                )}
                {positive ? 'Margen del mes' : 'Pérdida del mes'}
              </p>
              <p
                className={`font-bold text-[36px] leading-none mt-1.5 tabular-nums ${
                  positive ? 'text-green-300' : 'text-red-300'
                }`}
              >
                {euros(margin)}
              </p>
              {income.total > 0 && (
                <p className="text-[11px] text-white/35 mt-1">
                  {marginPct.toFixed(0)}% sobre los ingresos
                </p>
              )}
            </div>
            <div className="flex gap-2 flex-wrap">
              <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 min-w-[140px]">
                <p className="text-[10px] uppercase tracking-wider text-white/35 flex items-center gap-1.5">
                  <Euro className="h-3 w-3" /> Ingresos
                </p>
                <p className="text-white font-semibold text-[19px] tabular-nums">
                  {euros(income.total)}
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 min-w-[140px]">
                <p className="text-[10px] uppercase tracking-wider text-white/35 flex items-center gap-1.5">
                  <Wallet className="h-3 w-3" /> Coste comerciales
                </p>
                <p className="text-white font-semibold text-[19px] tabular-nums">
                  {euros(costs.totalEur)}
                </p>
                <p className="text-[10px] text-white/35 mt-0.5">
                  {dollars(costs.totalUsd)} · cambio {usdEur}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {/* Ingresos */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
            <h3 className="text-[10px] font-semibold text-white/45 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Euro className="h-3 w-3" /> Ingresos de {label}
            </h3>

            <div className="flex items-baseline justify-between gap-2 pb-1.5 mb-1.5 border-b border-white/[0.06]">
              <span className="text-[12px] text-white/50">
                Set ups cobrados ({income.closedThisMonth.length})
              </span>
              <span className="text-[13px] font-semibold text-white">
                {euros(income.setups)}
              </span>
            </div>

            {income.closedThisMonth.length === 0 ? (
              <p className="text-[11px] text-white/25">
                Ningún cliente cerrado este mes.
              </p>
            ) : (
              <div className="space-y-1">
                {income.closedThisMonth.map((c) => {
                  const contact = crmContact(c)
                  return (
                    <div
                      key={c.id}
                      className="flex items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.02] px-2 py-1.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] text-white truncate">{contact.name}</p>
                        <p className="text-[10px] text-white/30 truncate">
                          {contact.company || 'Sin empresa'} ·{' '}
                          {c.closed_at ? toMadrid(c.closed_at).getDate() : '—'}{' '}
                          {MONTHS[Number(monthKey.split('-')[1]) - 1].slice(0, 3)}
                        </p>
                      </div>
                      <span className="text-[12px] font-semibold text-green-300 flex-shrink-0">
                        {euros(Number(c.setup_budget) || 0)}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Costes */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
            <h3 className="text-[10px] font-semibold text-white/45 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Wallet className="h-3 w-3" /> Salarios de {label}
            </h3>

            {costs.rows.length === 0 ? (
              <p className="text-[11px] text-white/25">No hay comerciales dados de alta.</p>
            ) : (
              <div className="space-y-1.5">
                {costs.rows.map((r) => (
                  <div
                    key={r.person.id}
                    className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-2.5 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span
                          className="h-2 w-2 rounded-full flex-shrink-0"
                          style={{
                            backgroundColor: colorForAgent(
                              r.person.id,
                              r.person.calendar_color
                            ),
                          }}
                        />
                        <span className="text-[12px] font-semibold text-white truncate">
                          {r.person.full_name || r.person.email}
                        </span>
                      </span>
                      <span className="text-[13px] font-semibold text-white flex-shrink-0 tabular-nums">
                        {dollars(r.total)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[10px] text-white/35">
                      <span className="flex items-center gap-1">
                        <Clock className="h-2.5 w-2.5" />
                        {r.hours.toLocaleString('es-ES')} h · {dollars(r.salary)}
                      </span>
                      <span className="flex items-center gap-1">
                        <CheckCircle2 className="h-2.5 w-2.5" />
                        {r.appts} {r.appts === 1 ? 'cita' : 'citas'} ·{' '}
                        {dollars(r.commissions)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-baseline justify-between gap-2 pt-2 mt-2 border-t border-white/[0.06]">
              <span className="text-[12px] text-white/50">Total equipo</span>
              <span className="text-[13px] font-semibold text-white tabular-nums">
                {dollars(costs.totalUsd)}{' '}
                <span className="text-[11px] font-normal text-white/35">
                  ≈ {euros(costs.totalEur)}
                </span>
              </span>
            </div>
          </div>
        </div>

        <p className="text-[10px] text-white/25 mt-3 leading-snug">
          Solo se cuenta el set up, que es lo único que se cobra al entrar el
          cliente, en el mes de su fecha de cierre — la que marcas en su ficha,
          que es cuando pagó de verdad. El mantenimiento no entra aquí porque
          no arranca ese mismo mes. Las horas se pagan a la tarifa de su ciclo
          del 15 al 14, aunque el desglose se agrupe por mes natural.
        </p>
      </motion.div>
    </div>
  )
}
