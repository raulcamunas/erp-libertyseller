'use client'

import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { toMadrid } from '@/lib/timezone'
import {
  Search,
  Users,
  Euro,
  Trophy,
  MousePointerClick,
  Plus,
  Wallet,
  Pencil,
  Check,
} from 'lucide-react'
import {
  CrmClientWithDetails,
  CrmStage,
  CRM_STAGES,
  CRM_STAGE_LABELS,
  CRM_STAGE_COLORS,
  CRM_STAGE_DOTS,
  crmContact,
} from '@/lib/types/crm'
import {
  WorkHourEntry,
  PayrollRate,
  cycleKeyForDate,
  resolveRate,
} from '@/lib/types/payroll'
import { CalendarPerson } from '@/lib/types/appointments'
import { UserProfile } from '@/lib/supabase/get-user-profile'
import { CrmClientDetail } from './CrmClientDetail'
import { NewLeadDialog } from './NewLeadDialog'

/** Cita cualificada, con lo justo para calcular comisiones */
export interface CrmQualifiedAppointment {
  id: string
  comercial_id: string | null
  start_time: string
}

interface ClientsCRMProps {
  initialClients: CrmClientWithDetails[]
  team: CalendarPerson[]
  currentUser: UserProfile
  workHours: WorkHourEntry[]
  payrollRates: PayrollRate[]
  qualifiedAppointments: CrmQualifiedAppointment[]
  initialUsdEurRate: number
}

const CLIENT_SELECT = `
  *,
  appointment:appointments!crm_clients_appointment_id_fkey(
    *,
    comercial:profiles!appointments_comercial_id_fkey(id, full_name, email, role, calendar_color),
    assigned_closer:profiles!appointments_assigned_closer_id_fkey(id, full_name, email, role, calendar_color)
  )
`

function money(n: number | null | undefined) {
  if (n == null) return null
  return `${Number(n).toLocaleString('es-ES')} €`
}

function dollars(n: number) {
  return `${Math.round(n).toLocaleString('es-ES')} $`
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

export function ClientsCRM({
  initialClients,
  team,
  currentUser,
  workHours,
  payrollRates,
  qualifiedAppointments,
  initialUsdEurRate,
}: ClientsCRMProps) {
  const supabase = createClient()
  const [clients, setClients] = useState<CrmClientWithDetails[]>(initialClients)
  const [selectedId, setSelectedId] = useState<string | null>(
    initialClients[0]?.id ?? null
  )
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState<CrmStage | 'all'>('all')
  const [showNewLead, setShowNewLead] = useState(false)

  // Coste del equipo comercial: se recalcula solo cuando alguien apunta
  // horas, se cualifica una cita o se cambia una tarifa.
  const [hours, setHours] = useState<WorkHourEntry[]>(workHours)
  const [rates, setRates] = useState<PayrollRate[]>(payrollRates)
  const [qualified, setQualified] = useState(qualifiedAppointments)
  const [usdEur, setUsdEur] = useState(initialUsdEurRate)
  const [editingFx, setEditingFx] = useState(false)
  const [fxDraft, setFxDraft] = useState(String(initialUsdEurRate))

  // Los dos admins pueden estar trabajando el pipeline a la vez: si uno
  // cualifica una cita o cambia un estado, el otro lo ve al momento.
  useEffect(() => {
    const channel = supabase
      .channel(`crm_clients_${currentUser.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'crm_clients' },
        async (payload) => {
          if (payload.eventType === 'DELETE') {
            const removed = payload.old as { id: string }
            setClients((prev) => prev.filter((c) => c.id !== removed.id))
            return
          }
          const row = payload.new as { id: string }
          const { data } = await supabase
            .from('crm_clients')
            .select(CLIENT_SELECT)
            .eq('id', row.id)
            .single()
          if (!data) return
          const fresh = data as CrmClientWithDetails
          setClients((prev) => {
            const exists = prev.some((c) => c.id === fresh.id)
            return exists
              ? prev.map((c) => (c.id === fresh.id ? fresh : c))
              : [fresh, ...prev]
          })
        }
      )
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
          setHours((prev) =>
            prev.some((h) => h.id === row.id)
              ? prev.map((h) => (h.id === row.id ? row : h))
              : [...prev, row]
          )
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
          setRates((prev) =>
            prev.some((r) => r.id === row.id)
              ? prev.map((r) => (r.id === row.id ? row : r))
              : [...prev, row]
          )
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'appointments' },
        async () => {
          const { data } = await supabase
            .from('appointments')
            .select('id, comercial_id, start_time')
            .eq('status', 'qualified')
            .eq('is_external', false)
          if (data) setQualified(data as CrmQualifiedAppointment[])
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'app_settings' },
        (payload) => {
          const row = payload.new as { key: string; value: number }
          if (row?.key === 'usd_eur_rate') setUsdEur(Number(row.value))
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, currentUser.id])

  async function saveFxRate() {
    const parsed = Number(fxDraft.replace(',', '.'))
    if (Number.isNaN(parsed) || parsed <= 0) {
      setFxDraft(String(usdEur))
      setEditingFx(false)
      return
    }
    setUsdEur(parsed)
    setEditingFx(false)
    const { error } = await supabase
      .from('app_settings')
      .upsert({ key: 'usd_eur_rate', value: parsed }, { onConflict: 'key' })
    if (error) console.error('Error guardando el cambio USD/EUR:', error)
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return clients
      .filter((c) => (stageFilter === 'all' ? true : c.stage === stageFilter))
      .filter((c) => {
        if (!q) return true
        const contact = crmContact(c)
        return [contact.name, contact.company, contact.email, contact.phone, c.country]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q))
      })
      .sort((a, b) => {
        const da = a.appointment?.start_time ?? a.created_at
        const db = b.appointment?.start_time ?? b.created_at
        return new Date(db).getTime() - new Date(da).getTime()
      })
  }, [clients, search, stageFilter])

  const selected = clients.find((c) => c.id === selectedId) ?? null

  const stats = useMemo(() => {
    const won = clients.filter((c) => c.stage === 'ganado')

    // Facturación del mes: el set up se cobra una sola vez, el mes que se
    // cierra el cliente; el mantenimiento se cobra todos los meses mientras
    // siga siendo cliente. Por eso se cuentan de forma distinta.
    const now = toMadrid(new Date())
    const setupsThisMonth = won.reduce((sum, c) => {
      if (!c.closed_at) return sum
      const closed = toMadrid(c.closed_at)
      const sameMonth =
        closed.getFullYear() === now.getFullYear() && closed.getMonth() === now.getMonth()
      return sameMonth ? sum + (Number(c.setup_budget) || 0) : sum
    }, 0)
    const mrr = won.reduce((sum, c) => sum + (Number(c.maintenance_budget) || 0), 0)

    return { total: clients.length, won: won.length, setupsThisMonth, mrr }
  }, [clients])

  /**
   * Lo que cuesta el equipo comercial este mes: horas × precio/hora más
   * citas cualificadas × comisión. Se acota al mes natural para poder
   * compararlo con la facturación de al lado, aunque las tarifas vayan
   * por ciclos del 15 al 14 — cada día se paga a la tarifa de SU ciclo.
   */
  const teamCost = useMemo(() => {
    const now = toMadrid(new Date())
    const monthPrefix = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`

    let salaries = 0
    for (const h of hours) {
      if (!h.work_date.startsWith(monthPrefix)) continue
      const rate = resolveRate(rates, cycleKeyForDate(h.work_date), h.user_id)
      salaries += Number(h.hours) * rate.hourly
    }

    let commissions = 0
    for (const a of qualified) {
      if (!a.comercial_id) continue
      const d = toMadrid(a.start_time)
      const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      if (!key.startsWith(monthPrefix)) continue
      commissions += resolveRate(rates, cycleKeyForDate(key), a.comercial_id).commission
    }

    return { salaries, commissions, total: salaries + commissions }
  }, [hours, rates, qualified])

  // Ingresos del mes en euros contra coste del equipo en dólares pasados
  // a euros: si sale en verde, el equipo se paga solo.
  const costInEuros = teamCost.total * usdEur
  const profitable = stats.setupsThisMonth + stats.mrr >= costInEuros

  function handlePatched(id: string, patch: Partial<CrmClientWithDetails>) {
    setClients((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }

  // Contador por estado para los chips de filtro
  const counts = useMemo(() => {
    const map = new Map<CrmStage, number>()
    for (const c of clients) map.set(c.stage, (map.get(c.stage) ?? 0) + 1)
    return map
  }, [clients])

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Métricas de cabecera */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 flex-shrink-0">
        {[
          { icon: Users, label: 'Clientes en CRM', value: String(stats.total), hint: null },
          { icon: Trophy, label: 'Cerrados', value: String(stats.won), hint: null },
          {
            icon: Euro,
            label: 'Facturación de este mes',
            value: money(stats.setupsThisMonth) ?? '0 €',
            // Entre paréntesis, lo recurrente: se cobra todos los meses,
            // no solo este, así que no se suma al número grande.
            hint: `(${money(stats.mrr) ?? '0 €'}/mes de mantenimiento)`,
          },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2"
          >
            <p className="text-[10px] uppercase tracking-wider text-white/35 flex items-center gap-1.5">
              <s.icon className="h-3 w-3" /> {s.label}
            </p>
            <p className="text-white font-semibold text-[15px] mt-0.5 flex items-baseline gap-1.5 flex-wrap">
              {s.value}
              {s.hint && (
                <span className="text-[11px] font-normal text-white/35">{s.hint}</span>
              )}
            </p>
          </div>
        ))}

        {/* Coste del equipo comercial */}
        <div
          className={`rounded-xl border px-3 py-2 ${
            profitable
              ? 'border-green-500/25 bg-green-500/[0.05]'
              : 'border-red-500/25 bg-red-500/[0.05]'
          }`}
          title={`Salarios ${dollars(teamCost.salaries)} + comisiones ${dollars(
            teamCost.commissions
          )}`}
        >
          <p className="text-[10px] uppercase tracking-wider text-white/35 flex items-center gap-1.5">
            <Wallet className="h-3 w-3" /> Coste comerciales
          </p>
          <p className="text-white font-semibold text-[15px] mt-0.5 flex items-baseline gap-1.5 flex-wrap">
            {dollars(teamCost.total)}
            {editingFx ? (
              <span className="inline-flex items-center gap-1">
                <input
                  value={fxDraft}
                  onChange={(e) => setFxDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveFxRate()
                    if (e.key === 'Escape') {
                      setFxDraft(String(usdEur))
                      setEditingFx(false)
                    }
                  }}
                  autoFocus
                  inputMode="decimal"
                  className="w-14 bg-white/[0.06] border border-white/15 rounded px-1 py-0.5 text-[11px] font-normal text-white outline-none focus:border-[#FF6600]"
                />
                <button
                  type="button"
                  onClick={saveFxRate}
                  className="text-green-400 hover:text-green-300 transition-colors"
                >
                  <Check className="h-3 w-3" />
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setFxDraft(String(usdEur))
                  setEditingFx(true)
                }}
                className="group text-[11px] font-normal text-white/35 hover:text-white/70 transition-colors inline-flex items-center gap-1"
                title="Cambiar el tipo de cambio USD → EUR"
              >
                ≈ {money(Math.round(costInEuros))}
                <Pencil className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            )}
          </p>
          <p className="text-[9px] text-white/25 mt-0.5">
            Salarios {dollars(teamCost.salaries)} · Comisiones{' '}
            {dollars(teamCost.commissions)}
          </p>
        </div>
      </div>

      {/* Filtros por estado */}
      <div className="flex flex-wrap items-center gap-1.5 flex-shrink-0">
        <button
          type="button"
          onClick={() => setStageFilter('all')}
          className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
            stageFilter === 'all'
              ? 'border-white/25 bg-white/[0.08] text-white'
              : 'border-white/10 text-white/40 hover:text-white/80'
          }`}
        >
          Todos ({clients.length})
        </button>
        {CRM_STAGES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStageFilter(s)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
              stageFilter === s
                ? CRM_STAGE_COLORS[s]
                : 'border-white/10 text-white/40 hover:text-white/80'
            }`}
          >
            {CRM_STAGE_LABELS[s]} ({counts.get(s) ?? 0})
          </button>
        ))}
      </div>

      {/* Master-detail */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(280px,340px)_1fr] gap-3">
        {/* Lista de clientes */}
        <div className="flex flex-col min-h-0 rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden">
          <div className="p-2.5 border-b border-white/[0.06] flex-shrink-0 space-y-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/30" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar cliente, empresa, email..."
                className="w-full bg-white/[0.04] border border-white/10 rounded-lg pl-8 pr-2.5 py-1.5 text-[12px] text-white outline-none focus:border-[#FF6600] transition-colors placeholder:text-white/25"
              />
            </div>
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={() => setShowNewLead(true)}
              className="w-full h-8 rounded-lg bg-gradient-to-b from-[#FF7A1F] to-[#FF6600] text-white text-[12px] font-semibold flex items-center justify-center gap-1.5 shadow-[0_4px_16px_-6px_rgba(255,102,0,0.6)]"
            >
              <Plus className="h-3.5 w-3.5" /> Nuevo cliente
            </motion.button>
          </div>

          <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
            {filtered.length === 0 ? (
              <p className="text-[12px] text-white/30 text-center py-8 px-4">
                {clients.length === 0
                  ? 'Todavía no hay clientes. En cuanto marques una cita como "Cita Cualificada" aparecerá aquí automáticamente.'
                  : 'Ningún cliente coincide con la búsqueda.'}
              </p>
            ) : (
              filtered.map((c) => {
                const contact = crmContact(c)
                const active = c.id === selectedId
                return (
                  <motion.button
                    key={c.id}
                    layout
                    onClick={() => setSelectedId(c.id)}
                    className={`w-full text-left rounded-xl border px-2.5 py-2 transition-colors ${
                      active
                        ? 'border-[#FF6600]/50 bg-[#FF6600]/[0.08]'
                        : 'border-transparent hover:border-white/10 hover:bg-white/[0.03]'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: CRM_STAGE_DOTS[c.stage] }}
                      />
                      <span className="text-[13px] font-semibold text-white truncate flex-1 min-w-0">
                        {contact.name || 'Sin nombre'}
                      </span>
                    </div>
                    <p className="text-[11px] text-white/45 truncate pl-4">
                      {contact.company || 'Sin empresa'}
                    </p>
                    <div className="flex items-center justify-between gap-2 pl-4 mt-1">
                      <span className="text-[10px] text-white/30 truncate">
                        {contact.meetingAt
                          ? format(toMadrid(contact.meetingAt), "d MMM yyyy", { locale: es })
                          : 'Alta manual'}
                        {c.setup_budget != null || c.maintenance_budget != null
                          ? ` · ${money(c.setup_budget) ?? '—'} + ${
                              money(c.maintenance_budget) ?? '—'
                            }/mes`
                          : ''}
                      </span>
                      <span
                        className={`flex-shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded border leading-none whitespace-nowrap ${
                          CRM_STAGE_COLORS[c.stage]
                        }`}
                      >
                        {CRM_STAGE_LABELS[c.stage]}
                      </span>
                    </div>
                  </motion.button>
                )
              })
            )}
          </div>
        </div>

        {/* Ficha del cliente */}
        <div className="min-h-0 rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden">
          <AnimatePresence mode="wait">
            {selected ? (
              <motion.div
                key={selected.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="h-full"
              >
                <CrmClientDetail
                  client={selected}
                  team={team}
                  currentUser={currentUser}
                  onPatched={(patch) => handlePatched(selected.id, patch)}
                />
              </motion.div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-6">
                <MousePointerClick className="h-6 w-6 text-white/20" />
                <p className="text-[13px] text-white/35">
                  Selecciona un cliente de la izquierda para ver su ficha completa.
                </p>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence>
        {showNewLead && (
          <NewLeadDialog
            team={team}
            onClose={() => setShowNewLead(false)}
            onCreated={(created) => {
              setClients((prev) =>
                prev.some((c) => c.id === created.id) ? prev : [created, ...prev]
              )
              setSelectedId(created.id)
              setStageFilter('all')
              setSearch('')
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
