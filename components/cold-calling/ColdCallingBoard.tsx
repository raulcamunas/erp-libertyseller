'use client'

import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'
import { Search, MousePointerClick, Phone, Target, TrendingUp, Users } from 'lucide-react'
import {
  ColdLead,
  ColdLeadStatus,
  COLD_STATUSES,
  COLD_STATUS_LABELS,
  COLD_STATUS_DOTS,
  formatRevenue,
} from '@/lib/types/cold-leads'
import { CalendarPerson } from '@/lib/types/appointments'
import { UserProfile } from '@/lib/supabase/get-user-profile'
import { ColdLeadDetail } from './ColdLeadDetail'

interface ColdCallingBoardProps {
  initialLeads: ColdLead[]
  team: CalendarPerson[]
  currentUser: UserProfile
  isAdmin: boolean
}

/** Cuántas filas se pintan de golpe: la lista completa son miles */
const PAGE = 120

export function ColdCallingBoard({
  initialLeads,
  team,
  currentUser,
  isAdmin,
}: ColdCallingBoardProps) {
  const supabase = createClient()
  const [leads, setLeads] = useState<ColdLead[]>(initialLeads)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<ColdLeadStatus | 'all'>('all')
  const [ownerFilter, setOwnerFilter] = useState<string>(isAdmin ? 'all' : currentUser.id)
  const [visible, setVisible] = useState(PAGE)

  useEffect(() => {
    const channel = supabase
      .channel(`cold_leads_${currentUser.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'cold_leads' },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const old = payload.old as { id: string }
            setLeads((prev) => prev.filter((l) => l.id !== old.id))
            return
          }
          const row = payload.new as ColdLead
          setLeads((prev) =>
            prev.some((l) => l.id === row.id)
              ? prev.map((l) => (l.id === row.id ? { ...l, ...row } : l))
              : [...prev, row]
          )
        }
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, currentUser.id])

  const scoped = useMemo(
    () => (ownerFilter === 'all' ? leads : leads.filter((l) => l.assigned_to === ownerFilter)),
    [leads, ownerFilter]
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return scoped
      .filter((l) => (statusFilter === 'all' ? true : l.status === statusFilter))
      .filter((l) => {
        if (!q) return true
        return [l.store_name, l.company, l.phone, l.email, l.province, l.category]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q))
      })
      .sort((a, b) => {
        // Lo urgente primero: rellamadas vencidas, luego por facturación,
        // que es lo que hace a un seller interesante.
        const ad = a.next_call_date ?? ''
        const bd = b.next_call_date ?? ''
        if (ad && bd && ad !== bd) return ad.localeCompare(bd)
        if (ad && !bd) return -1
        if (!ad && bd) return 1
        return (Number(b.revenue_monthly) || 0) - (Number(a.revenue_monthly) || 0)
      })
  }, [scoped, search, statusFilter])

  // Al cambiar de filtro se vuelve al principio de la lista
  useEffect(() => {
    setVisible(PAGE)
  }, [search, statusFilter, ownerFilter])

  const counts = useMemo(() => {
    const map = new Map<ColdLeadStatus, number>()
    for (const l of scoped) map.set(l.status, (map.get(l.status) ?? 0) + 1)
    return map
  }, [scoped])

  const stats = useMemo(() => {
    const worked = scoped.filter((l) => l.status !== 'pendiente').length
    const qualified = scoped.filter((l) => l.status === 'cita_cualificada').length
    const today = new Date().toISOString().slice(0, 10)
    const dueToday = scoped.filter(
      (l) => l.next_call_date && l.next_call_date <= today && l.status !== 'no_interesa'
    ).length
    return {
      total: scoped.length,
      worked,
      qualified,
      dueToday,
      rate: worked > 0 ? (qualified / worked) * 100 : 0,
    }
  }, [scoped])

  const selected = leads.find((l) => l.id === selectedId) ?? null

  function handlePatched(id: string, patch: Partial<ColdLead>) {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  }

  /** Salta al siguiente lead de la lista filtrada, para encadenar llamadas */
  function goNext() {
    const idx = filtered.findIndex((l) => l.id === selectedId)
    const next = filtered[idx + 1]
    if (next) {
      setSelectedId(next.id)
      if (idx + 1 >= visible - 5) setVisible((v) => v + PAGE)
    }
  }

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Métricas */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 flex-shrink-0">
        {[
          { icon: Users, label: 'Leads en cartera', value: String(stats.total) },
          {
            icon: Phone,
            label: 'Trabajados',
            value: `${stats.worked}`,
            hint: `de ${stats.total}`,
          },
          {
            icon: Target,
            label: 'Citas cualificadas',
            value: String(stats.qualified),
            hint: stats.worked > 0 ? `${stats.rate.toFixed(1)}% de conversión` : undefined,
          },
          {
            icon: TrendingUp,
            label: 'Rellamadas para hoy',
            value: String(stats.dueToday),
          },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2"
          >
            <p className="text-[10px] uppercase tracking-wider text-white/35 flex items-center gap-1.5">
              <s.icon className="h-3 w-3" /> {s.label}
            </p>
            <p className="text-white font-semibold text-[15px] mt-0.5 flex items-baseline gap-1.5">
              {s.value}
              {s.hint && (
                <span className="text-[11px] font-normal text-white/35">{s.hint}</span>
              )}
            </p>
          </div>
        ))}
      </div>

      {/* Filtros por estado, con los colores del Excel */}
      <div className="flex flex-wrap items-center gap-1.5 flex-shrink-0">
        <button
          type="button"
          onClick={() => setStatusFilter('all')}
          className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
            statusFilter === 'all'
              ? 'border-white/25 bg-white/[0.08] text-white'
              : 'border-white/10 text-white/40 hover:text-white/80'
          }`}
        >
          Todos ({scoped.length})
        </button>
        {COLD_STATUSES.map((s) => {
          const active = statusFilter === s
          return (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors flex items-center gap-1.5 ${
                active ? 'text-white ring-1 ring-white/20' : 'border-white/10 text-white/40 hover:text-white/80'
              }`}
              style={
                active
                  ? {
                      backgroundColor: `${COLD_STATUS_DOTS[s]}26`,
                      borderColor: `${COLD_STATUS_DOTS[s]}80`,
                    }
                  : undefined
              }
            >
              <span
                className="h-2 w-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: COLD_STATUS_DOTS[s] }}
              />
              {COLD_STATUS_LABELS[s]} ({counts.get(s) ?? 0})
            </button>
          )
        })}

        {isAdmin && team.length > 0 && (
          <select
            value={ownerFilter}
            onChange={(e) => setOwnerFilter(e.target.value)}
            className="ml-auto h-7 rounded-full border border-white/10 bg-white/[0.03] px-2.5 text-[11px] text-white/80 outline-none focus:border-[#FF6600] transition-colors cursor-pointer"
          >
            <option value="all" className="bg-[#1a1a1a]">
              Todos los comerciales
            </option>
            {team.map((p) => (
              <option key={p.id} value={p.id} className="bg-[#1a1a1a]">
                {p.full_name || p.email}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Lista + ficha */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(300px,380px)_1fr] gap-3">
        <div className="flex flex-col min-h-0 rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden">
          <div className="p-2.5 border-b border-white/[0.06] flex-shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/30" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar tienda, empresa, teléfono..."
                className="w-full bg-white/[0.04] border border-white/10 rounded-lg pl-8 pr-2.5 py-1.5 text-[12px] text-white outline-none focus:border-[#FF6600] transition-colors placeholder:text-white/25"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
            {filtered.length === 0 ? (
              <p className="text-[12px] text-white/30 text-center py-8 px-4">
                Ningún lead con estos filtros.
              </p>
            ) : (
              <>
                {filtered.slice(0, visible).map((l) => {
                  const active = l.id === selectedId
                  const overdue =
                    l.next_call_date && l.next_call_date <= new Date().toISOString().slice(0, 10)
                  return (
                    <button
                      key={l.id}
                      onClick={() => setSelectedId(l.id)}
                      className={`w-full text-left rounded-xl border px-2.5 py-2 transition-colors ${
                        active
                          ? 'border-[#FF6600]/50 bg-[#FF6600]/[0.08]'
                          : 'border-transparent hover:border-white/10 hover:bg-white/[0.03]'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2 w-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: COLD_STATUS_DOTS[l.status] }}
                          title={COLD_STATUS_LABELS[l.status]}
                        />
                        <span className="text-[13px] font-semibold text-white truncate flex-1 min-w-0">
                          {l.store_name}
                        </span>
                        {l.revenue_monthly != null && (
                          <span className="text-[10px] text-white/35 flex-shrink-0 tabular-nums">
                            {formatRevenue(l.revenue_monthly)}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-white/40 truncate pl-4">
                        {l.company || 'Sin empresa'}
                      </p>
                      {(l.phone || overdue) && (
                        <p className="text-[10px] text-white/25 truncate pl-4 mt-0.5 flex items-center gap-1.5">
                          {l.phone && <span className="truncate">{l.phone}</span>}
                          {overdue && (
                            <span className="text-cyan-300 flex-shrink-0">· rellamar</span>
                          )}
                        </p>
                      )}
                    </button>
                  )
                })}
                {visible < filtered.length && (
                  <button
                    onClick={() => setVisible((v) => v + PAGE)}
                    className="w-full rounded-lg border border-dashed border-white/12 py-2 text-[11px] text-white/45 hover:text-white hover:border-white/25 transition-colors"
                  >
                    Ver más ({filtered.length - visible} restantes)
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        <div className="min-h-0 rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden">
          <AnimatePresence mode="wait">
            {selected ? (
              <motion.div
                key={selected.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                className="h-full"
              >
                <ColdLeadDetail
                  lead={selected}
                  currentUser={currentUser}
                  canEdit={isAdmin || selected.assigned_to === currentUser.id}
                  onPatched={(patch) => handlePatched(selected.id, patch)}
                  onNext={goNext}
                />
              </motion.div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-6">
                <MousePointerClick className="h-6 w-6 text-white/20" />
                <p className="text-[13px] text-white/35">
                  Elige un lead de la izquierda para ver su ficha y empezar a llamar.
                </p>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
