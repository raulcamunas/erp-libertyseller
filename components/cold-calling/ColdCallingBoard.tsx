'use client'

import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'
import {
  Search,
  MousePointerClick,
  Phone,
  Target,
  TrendingUp,
  Users,
  Layers,
  ArrowUpDown,
  Euro,
  X,
  Table2,
  PanelRight,
} from 'lucide-react'
import {
  ColdLead,
  ColdLeadStatus,
  ColdSort,
  COLD_STATUSES,
  COLD_STATUS_LABELS,
  COLD_STATUS_DOTS,
  COLD_SORT_LABELS,
  colorForList,
  formatRevenue,
} from '@/lib/types/cold-leads'
import { CalendarPerson } from '@/lib/types/appointments'
import { UserProfile } from '@/lib/supabase/get-user-profile'
import { ColdLeadDetail } from './ColdLeadDetail'
import { ColdLeadsTable } from './ColdLeadsTable'

interface ColdCallingBoardProps {
  initialLeads: ColdLead[]
  team: CalendarPerson[]
  currentUser: UserProfile
  isAdmin: boolean
}

/** Cuántas filas se pintan de golpe: la lista completa son miles */
const PAGE = 400

/** Atajos del filtro de facturación, en euros al mes */
const REVENUE_PRESETS: Array<{ label: string; min: string; max: string }> = [
  { label: '+ de 100k', min: '100000', max: '' },
  { label: '50k – 100k', min: '50000', max: '100000' },
  { label: '20k – 50k', min: '20000', max: '50000' },
  { label: '- de 20k', min: '', max: '20000' },
]

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
  const [listFilter, setListFilter] = useState<string>('all')
  const [minRev, setMinRev] = useState('')
  const [maxRev, setMaxRev] = useState('')
  const [sort, setSort] = useState<ColdSort>('due_first')
  const [visible, setVisible] = useState(PAGE)
  // Muchos vienen del Excel y se manejan mejor en tabla; la ficha es para
  // trabajar un lead a fondo. Se elige y se recuerda entre sesiones.
  const [view, setView] = useState<'ficha' | 'tabla'>('ficha')

  useEffect(() => {
    const saved = window.localStorage.getItem('coldCallingView')
    if (saved === 'tabla' || saved === 'ficha') setView(saved)
  }, [])

  function changeView(v: 'ficha' | 'tabla') {
    setView(v)
    window.localStorage.setItem('coldCallingView', v)
  }

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

  /** Listas de origen presentes en la cartera visible, para el desplegable */
  const availableLists = useMemo(() => {
    const map = new Map<string, number>()
    for (const l of scoped) {
      const key = l.source_list || 'Sin lista'
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [scoped])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const byRevenue = (a: ColdLead, b: ColdLead) =>
      (Number(b.revenue_monthly) || 0) - (Number(a.revenue_monthly) || 0)

    return scoped
      .filter((l) => (statusFilter === 'all' ? true : l.status === statusFilter))
      .filter((l) =>
        listFilter === 'all' ? true : (l.source_list || 'Sin lista') === listFilter
      )
      .filter((l) => {
        // Rango de facturación. Si hay rango activo, los leads sin importe
        // quedan fuera: no se puede afirmar que caigan dentro.
        const min = minRev.trim() === '' ? null : Number(minRev)
        const max = maxRev.trim() === '' ? null : Number(maxRev)
        if (min === null && max === null) return true
        const rev = l.revenue_monthly == null ? null : Number(l.revenue_monthly)
        if (rev == null) return false
        if (min !== null && !Number.isNaN(min) && rev < min) return false
        if (max !== null && !Number.isNaN(max) && rev > max) return false
        return true
      })
      .filter((l) => {
        if (!q) return true
        return [l.store_name, l.company, l.phone, l.email, l.province, l.category]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q))
      })
      .sort((a, b) => {
        if (sort === 'revenue_desc') return byRevenue(a, b)
        if (sort === 'revenue_asc') return -byRevenue(a, b)
        if (sort === 'name') return a.store_name.localeCompare(b.store_name, 'es')
        // due_first: rellamadas pendientes arriba y, dentro de eso, los
        // sellers que más facturan, que es donde está el dinero.
        const ad = a.next_call_date ?? ''
        const bd = b.next_call_date ?? ''
        if (ad && bd && ad !== bd) return ad.localeCompare(bd)
        if (ad && !bd) return -1
        if (!ad && bd) return 1
        return byRevenue(a, b)
      })
  }, [scoped, search, statusFilter, listFilter, minRev, maxRev, sort])

  // Al cambiar de filtro se vuelve al principio de la lista
  useEffect(() => {
    setVisible(PAGE)
  }, [search, statusFilter, ownerFilter, listFilter, minRev, maxRev, sort])

  // Si al cambiar de comercial la lista elegida ya no existe, se resetea
  useEffect(() => {
    if (listFilter !== 'all' && !availableLists.some(([name]) => name === listFilter)) {
      setListFilter('all')
    }
  }, [availableLists, listFilter])

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
    <div className="flex flex-col h-full gap-3 min-w-0">
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

      </div>

      {/* Lista de origen y orden */}
      <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
        <span className="text-[10px] uppercase tracking-wider text-white/30 flex items-center gap-1.5">
          <Layers className="h-3 w-3" /> Lista
        </span>
        <button
          type="button"
          onClick={() => setListFilter('all')}
          className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
            listFilter === 'all'
              ? 'border-white/25 bg-white/[0.08] text-white'
              : 'border-white/10 text-white/40 hover:text-white/80'
          }`}
        >
          Todas ({scoped.length})
        </button>
        {availableLists.map(([name, count]) => {
          const active = listFilter === name
          const color = colorForList(name)
          return (
            <button
              key={name}
              type="button"
              onClick={() => setListFilter(name)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors flex items-center gap-1.5 ${
                active
                  ? 'text-white ring-1 ring-white/20'
                  : 'border-white/10 text-white/40 hover:text-white/80'
              }`}
              style={
                active
                  ? { backgroundColor: `${color}26`, borderColor: `${color}80` }
                  : undefined
              }
            >
              <span
                className="h-2 w-2 rounded-sm flex-shrink-0"
                style={{ backgroundColor: color }}
              />
              {name} ({count})
            </button>
          )
        })}

        <div className="ml-auto flex items-center gap-2">
          {/* Cambio de vista: ficha o tabla estilo Excel */}
          <div className="flex items-center rounded-full border border-white/10 bg-white/[0.03] p-0.5">
            {([
              { id: 'ficha' as const, icon: PanelRight, label: 'Ficha' },
              { id: 'tabla' as const, icon: Table2, label: 'Tabla' },
            ]).map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => changeView(v.id)}
                className={`h-6 px-2.5 rounded-full text-[11px] font-medium flex items-center gap-1.5 transition-colors ${
                  view === v.id
                    ? 'bg-[#FF6600] text-white'
                    : 'text-white/45 hover:text-white'
                }`}
              >
                <v.icon className="h-3 w-3" />
                {v.label}
              </button>
            ))}
          </div>

          <ArrowUpDown className="h-3 w-3 text-white/30" />

          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as ColdSort)}
            title="Ordenar la lista"
            className="h-7 rounded-full border border-white/10 bg-white/[0.03] pl-2.5 pr-2 text-[11px] text-white/80 outline-none focus:border-[#FF6600] transition-colors cursor-pointer"
          >
            {(Object.keys(COLD_SORT_LABELS) as ColdSort[]).map((s) => (
              <option key={s} value={s} className="bg-[#1a1a1a]">
                {COLD_SORT_LABELS[s]}
              </option>
            ))}
          </select>

          {isAdmin && team.length > 0 && (
            <select
              value={ownerFilter}
              onChange={(e) => setOwnerFilter(e.target.value)}
              className="h-7 rounded-full border border-white/10 bg-white/[0.03] px-2.5 text-[11px] text-white/80 outline-none focus:border-[#FF6600] transition-colors cursor-pointer"
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
      </div>

      {/* Rango de facturación */}
      <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
        <span className="text-[10px] uppercase tracking-wider text-white/30 flex items-center gap-1.5">
          <Euro className="h-3 w-3" /> Facturación
        </span>
        <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-2 py-1">
          <input
            value={minRev}
            onChange={(e) => setMinRev(e.target.value.replace(/[^\d]/g, ''))}
            inputMode="numeric"
            placeholder="desde"
            className="w-20 bg-transparent text-[11px] text-white outline-none placeholder:text-white/25 tabular-nums"
          />
          <span className="text-white/20 text-[11px]">–</span>
          <input
            value={maxRev}
            onChange={(e) => setMaxRev(e.target.value.replace(/[^\d]/g, ''))}
            inputMode="numeric"
            placeholder="hasta"
            className="w-20 bg-transparent text-[11px] text-white outline-none placeholder:text-white/25 tabular-nums"
          />
          <span className="text-white/25 text-[11px]">€/mes</span>
          {(minRev || maxRev) && (
            <button
              type="button"
              onClick={() => {
                setMinRev('')
                setMaxRev('')
              }}
              className="text-white/30 hover:text-white transition-colors"
              title="Quitar el filtro de facturación"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {REVENUE_PRESETS.map((p) => {
          const active = minRev === p.min && maxRev === p.max
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => {
                if (active) {
                  setMinRev('')
                  setMaxRev('')
                } else {
                  setMinRev(p.min)
                  setMaxRev(p.max)
                }
              }}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                active
                  ? 'border-[#FF6600]/60 bg-[#FF6600]/15 text-white'
                  : 'border-white/10 text-white/40 hover:text-white/80'
              }`}
            >
              {p.label}
            </button>
          )
        })}

        {(minRev || maxRev) && (
          <span className="text-[11px] text-white/35">
            {filtered.length} {filtered.length === 1 ? 'lead' : 'leads'} en ese rango
          </span>
        )}
      </div>

      {view === 'tabla' ? (
        <div className="flex-1 min-h-0 min-w-0 flex flex-col gap-2">
          <ColdLeadsTable
            leads={filtered.slice(0, visible)}
            currentUserId={currentUser.id}
            isAdmin={isAdmin}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onOpenDetail={(id) => {
              setSelectedId(id)
              changeView('ficha')
            }}
            onPatched={handlePatched}
          />
          {visible < filtered.length && (
            <button
              onClick={() => setVisible((v) => v + PAGE)}
              className="flex-shrink-0 rounded-lg border border-dashed border-white/12 py-2 text-[11px] text-white/45 hover:text-white hover:border-white/25 transition-colors"
            >
              Ver más ({filtered.length - visible} restantes)
            </button>
          )}
        </div>
      ) : (

      /* Lista + ficha */
      <div className="flex-1 min-h-0 min-w-0 grid grid-cols-1 lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)] gap-3">
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
                      <div className="flex items-center gap-1.5 pl-4 mt-0.5 min-w-0">
                        {l.source_list && (
                          <span
                            className="text-[9px] font-medium px-1.5 py-0.5 rounded border leading-none whitespace-nowrap flex-shrink-0"
                            style={{
                              color: colorForList(l.source_list),
                              borderColor: `${colorForList(l.source_list)}55`,
                              backgroundColor: `${colorForList(l.source_list)}1a`,
                            }}
                          >
                            {l.source_list}
                          </span>
                        )}
                        {l.phone && (
                          <span className="text-[10px] text-white/25 truncate">{l.phone}</span>
                        )}
                        {overdue && (
                          <span className="text-[10px] text-cyan-300 flex-shrink-0">
                            rellamar
                          </span>
                        )}
                      </div>
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
      )}
    </div>
  )
}
