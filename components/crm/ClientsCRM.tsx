'use client'

import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { toMadrid } from '@/lib/timezone'
import { Search, Users, Euro, Trophy, MousePointerClick, Plus } from 'lucide-react'
import {
  CrmClientWithDetails,
  CrmStage,
  CRM_STAGES,
  CRM_STAGE_LABELS,
  CRM_STAGE_COLORS,
  CRM_STAGE_DOTS,
  crmContact,
} from '@/lib/types/crm'
import { CalendarPerson } from '@/lib/types/appointments'
import { UserProfile } from '@/lib/supabase/get-user-profile'
import { CrmClientDetail } from './CrmClientDetail'
import { NewLeadDialog } from './NewLeadDialog'

interface ClientsCRMProps {
  initialClients: CrmClientWithDetails[]
  team: CalendarPerson[]
  currentUser: UserProfile
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

export function ClientsCRM({ initialClients, team, currentUser }: ClientsCRMProps) {
  const supabase = createClient()
  const [clients, setClients] = useState<CrmClientWithDetails[]>(initialClients)
  const [selectedId, setSelectedId] = useState<string | null>(
    initialClients[0]?.id ?? null
  )
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState<CrmStage | 'all'>('all')
  const [showNewLead, setShowNewLead] = useState(false)

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
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, currentUser.id])

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
    const openStages: CrmStage[] = [
      'nuevo',
      'seguimiento',
      'propuesta_enviada',
      'revision_propuesta',
      'negociacion',
    ]
    const open = clients.filter((c) => openStages.includes(c.stage))
    const pipelineValue = open.reduce(
      (sum, c) => sum + (Number(c.setup_budget) || 0) + (Number(c.maintenance_budget) || 0) * 12,
      0
    )
    const mrr = won.reduce((sum, c) => sum + (Number(c.maintenance_budget) || 0), 0)
    return { total: clients.length, won: won.length, pipelineValue, mrr }
  }, [clients])

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
          { icon: Users, label: 'Clientes en CRM', value: String(stats.total) },
          { icon: Trophy, label: 'Cerrados', value: String(stats.won) },
          {
            icon: Euro,
            label: 'Pipeline abierto (año 1)',
            value: money(stats.pipelineValue) ?? '0 €',
          },
          { icon: Euro, label: 'Mantenimiento cerrado', value: `${money(stats.mrr) ?? '0 €'}/mes` },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2"
          >
            <p className="text-[10px] uppercase tracking-wider text-white/35 flex items-center gap-1.5">
              <s.icon className="h-3 w-3" /> {s.label}
            </p>
            <p className="text-white font-semibold text-[15px] mt-0.5">{s.value}</p>
          </div>
        ))}
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
