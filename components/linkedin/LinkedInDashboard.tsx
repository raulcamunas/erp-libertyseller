'use client'

import { useMemo, useState } from 'react'
import { CompanyWithProspects, CompanyProspect, Agent } from '@/lib/types/linkedin'
import { CompanyCard } from './CompanyCard'
import { ProspectModal } from './ProspectModal'
import { AddCompanyModal } from './AddCompanyModal'
import { AddProspectModal } from './AddProspectModal'
import { EditCompanyModal } from './EditCompanyModal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Plus, Search } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import { format, differenceInCalendarDays, startOfDay, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import { LinkedInLogsTab } from './LinkedInLogsTab'

interface LinkedInDashboardProps {
  initialCompanies: CompanyWithProspects[]
  userRole?: string
}

export function LinkedInDashboard({ initialCompanies, userRole = 'employee' }: LinkedInDashboardProps) {
  const [companies, setCompanies] = useState<CompanyWithProspects[]>(initialCompanies)
  const [activeTab, setActiveTab] = useState<'companies' | 'followup' | 'metrics' | 'logs'>('companies')
  const isAdmin = userRole === 'admin'
  const [selectedProspect, setSelectedProspect] = useState<CompanyProspect | null>(null)
  const [isProspectModalOpen, setIsProspectModalOpen] = useState(false)
  const [isAddCompanyModalOpen, setIsAddCompanyModalOpen] = useState(false)
  const [isAddProspectModalOpen, setIsAddProspectModalOpen] = useState(false)
  const [isEditCompanyModalOpen, setIsEditCompanyModalOpen] = useState(false)
  const [selectedCompanyForEdit, setSelectedCompanyForEdit] = useState<CompanyWithProspects | null>(null)
  const [selectedCompanyForProspect, setSelectedCompanyForProspect] = useState<{
    id: string
    name: string
  } | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const supabase = createClient()

  const handleProspectClick = (prospectId: string) => {
    // Buscar el prospecto en todas las empresas
    for (const company of companies) {
      const prospect = company.prospects.find((p) => p.id === prospectId)
      if (prospect) {
        setSelectedProspect(prospect)
        setIsProspectModalOpen(true)
        break
      }
    }
  }

  const handleAddProspect = (companyId: string) => {
    const company = companies.find((c) => c.id === companyId)
    if (company) {
      setSelectedCompanyForProspect({ id: companyId, name: company.name })
      setIsAddProspectModalOpen(true)
    }
  }

  const handleAgentChange = async (prospectId: string, agent: 'Raul' | 'Mario') => {
    // Optimistic update
    setCompanies((prev) =>
      prev.map((company) => ({
        ...company,
        prospects: company.prospects.map((p) =>
          p.id === prospectId ? { ...p, agent } : p
        ),
      }))
    )

    // Actualizar en Supabase
    try {
      const { error } = await supabase
        .from('company_prospects')
        .update({ agent })
        .eq('id', prospectId)

      if (error) throw error

      toast.success(`Agente cambiado a ${agent}`)
    } catch (error) {
      console.error('Error updating agent:', error)
      // Revertir cambio
      setCompanies((prev) =>
        prev.map((company) => ({
          ...company,
          prospects: company.prospects.map((p) =>
            p.id === prospectId ? { ...p, agent: p.agent === 'Raul' ? 'Mario' : 'Raul' } : p
          ),
        }))
      )
      toast.error('Error al cambiar el agente')
    }
  }

  const handleProspectUpdate = async () => {
    // Recargar datos
    const { data: companiesData } = await supabase
      .from('target_companies')
      .select('*')
      .eq('status', 'active')
      .order('created_at', { ascending: false })

    const { data: prospectsData } = await supabase
      .from('company_prospects')
      .select('*')
      .order('created_at', { ascending: false })

    if (companiesData && prospectsData) {
      const updatedCompanies = companiesData.map((company) => ({
        ...company,
        prospects: prospectsData.filter((p) => p.company_id === company.id),
      }))
      setCompanies(updatedCompanies)
    }
  }

  const handleCompanyAdded = async () => {
    // Recargar empresas
    const { data: companiesData } = await supabase
      .from('target_companies')
      .select('*')
      .eq('status', 'active')
      .order('created_at', { ascending: false })

    const { data: prospectsData } = await supabase
      .from('company_prospects')
      .select('*')
      .order('created_at', { ascending: false })

    if (companiesData && prospectsData) {
      const updatedCompanies = companiesData.map((company) => ({
        ...company,
        prospects: prospectsData.filter((p) => p.company_id === company.id),
      }))
      setCompanies(updatedCompanies)
      toast.success('Empresa añadida correctamente')
    }
  }

  const handleProspectAdded = async () => {
    // Recargar prospectos
    const { data: prospectsData } = await supabase
      .from('company_prospects')
      .select('*')
      .order('created_at', { ascending: false })

    if (prospectsData) {
      setCompanies((prev) =>
        prev.map((company) => ({
          ...company,
          prospects: prospectsData.filter((p) => p.company_id === company.id),
        }))
      )
      toast.success('Prospecto añadido correctamente')
    }
  }

  const handleDeleteCompany = async (companyId: string) => {
    // Optimistic update
    setCompanies((prev) => prev.filter((c) => c.id !== companyId))

    // Eliminar en Supabase (cascade eliminará los prospectos)
    try {
      const { error } = await supabase
        .from('target_companies')
        .delete()
        .eq('id', companyId)

      if (error) throw error

      toast.success('Empresa eliminada correctamente')
    } catch (error) {
      console.error('Error deleting company:', error)
      // Recargar en caso de error
      handleCompanyAdded()
      toast.error('Error al eliminar la empresa')
    }
  }

  const handleEditCompany = (company: CompanyWithProspects) => {
    setSelectedCompanyForEdit(company)
    setIsEditCompanyModalOpen(true)
  }

  const handleCompanyUpdated = async () => {
    // Recargar empresas
    const { data: companiesData } = await supabase
      .from('target_companies')
      .select('*')
      .eq('status', 'active')
      .order('created_at', { ascending: false })

    const { data: prospectsData } = await supabase
      .from('company_prospects')
      .select('*')
      .order('created_at', { ascending: false })

    if (companiesData && prospectsData) {
      const updatedCompanies = companiesData.map((company) => ({
        ...company,
        prospects: prospectsData.filter((p) => p.company_id === company.id),
      }))
      setCompanies(updatedCompanies)
      toast.success('Empresa actualizada correctamente')
    }
  }

  // ===== Datos derivados para vistas avanzadas =====
  const allProspects: CompanyProspect[] = useMemo(
    () => companies.flatMap((c) => c.prospects),
    [companies]
  )

  const pendingProspects: (CompanyProspect & { company_name: string; effective_next_contact_at: string })[] =
    useMemo(() => {
      const now = new Date()
      const limit = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 7) // próximos 7 días

      return companies
        .flatMap((company) =>
          company.prospects
            .map((p) => {
              // Misma lógica que en la mini‑card para calcular la fecha efectiva
              let effectiveNext = p.next_contact_at || null
              if (!effectiveNext) {
                if (p.status === 'connected') {
                  const d = new Date(p.created_at)
                  d.setDate(d.getDate() + 3)
                  effectiveNext = d.toISOString()
                } else if (p.status === 'messaged') {
                  const d = new Date(p.created_at)
                  d.setDate(d.getDate() + 3)
                  effectiveNext = d.toISOString()
                }
              }
              return { prospect: p, company_name: company.name, effectiveNext }
            })
            .filter(
              ({ prospect, effectiveNext }) =>
                (prospect.status === 'connected' || prospect.status === 'messaged') &&
                effectiveNext &&
                new Date(effectiveNext) <= limit
            )
            .map(({ prospect, company_name, effectiveNext }) => ({
              ...prospect,
              company_name,
              effective_next_contact_at: effectiveNext as string,
            }))
        )
        .sort((a, b) => {
          const da = new Date(a.effective_next_contact_at).getTime()
          const db = new Date(b.effective_next_contact_at).getTime()
          return da - db
        })
    }, [companies])

  const statusMetrics = useMemo(() => {
    const total = allProspects.length
    const identified = allProspects.filter(p => p.status === 'identified').length
    const connected = allProspects.filter(p => p.status === 'connected').length
    const messaged = allProspects.filter(p => p.status === 'messaged').length
    const thirdContact = allProspects.filter(p => p.status === 'third_contact').length
    const inFollowUp = allProspects.filter(p => p.status === 'in_follow_up').length
    const meetingScheduled = allProspects.filter(p => p.status === 'meeting_scheduled').length
    const notInterested = allProspects.filter(p => p.status === 'not_interested').length

    return { total, identified, connected, messaged, thirdContact, inFollowUp, meetingScheduled, notInterested }
  }, [allProspects])

  const statusChartData: Array<{ name: string; value: number; color: string }> = useMemo(() => ([
    { name: 'Identificados', value: statusMetrics.identified, color: '#9ca3af' },
    { name: 'Primer contacto', value: statusMetrics.connected, color: '#FF6600' },
    { name: '2o contacto', value: statusMetrics.messaged, color: '#60a5fa' },
    { name: '3er contacto', value: statusMetrics.thirdContact, color: '#f87171' },
    { name: 'En seguimiento', value: statusMetrics.inFollowUp, color: '#22c55e' },
    { name: 'Reunión concretada', value: statusMetrics.meetingScheduled, color: '#10b981' },
    { name: 'No le interesa', value: statusMetrics.notInterested, color: '#64748b' },
  ]), [statusMetrics])

  const weeklyCreationData = useMemo(() => {
    const map = new Map<string, number>()
    allProspects.forEach((p) => {
      const weekLabel = format(new Date(p.created_at), "I 'sem' yyyy", { locale: es })
      map.set(weekLabel, (map.get(weekLabel) || 0) + 1)
    })
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ name, count }))
  }, [allProspects])

  // Contadores diarios por agente (20 contactos/día)
  const DAILY_QUOTA = 20

  const dailyAgentCounters = useMemo(() => {
    const todayStart = startOfDay(new Date())
    const agents: Agent[] = ['Raul', 'Mario']

    return agents.map((agent) => {
      const usedToday = allProspects.filter((p) => {
        if (p.agent !== agent) return false
        const created = startOfDay(new Date(p.created_at))
        return created.getTime() === todayStart.getTime()
      }).length

      const remaining = Math.max(DAILY_QUOTA - usedToday, 0)

      return {
        agent,
        usedToday,
        remaining,
      }
    })
  }, [allProspects])

  // Filtrar empresas según búsqueda
  const filteredCompanies = useMemo(() => {
    if (!searchQuery.trim()) return companies
    
    const query = searchQuery.toLowerCase().trim()
    return companies.filter((company) => {
      const matchesName = company.name.toLowerCase().includes(query)
      const matchesProspects = company.prospects.some(
        (p) =>
          p.full_name.toLowerCase().includes(query) ||
          (p.role && p.role.toLowerCase().includes(query))
      )
      return matchesName || matchesProspects
    })
  }, [companies, searchQuery])

  return (
    <div className="linkedin-module">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
        <div className="mb-4 flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="companies">Empresas</TabsTrigger>
            <TabsTrigger value="followup">Seguimiento</TabsTrigger>
            <TabsTrigger value="metrics">Métricas</TabsTrigger>
            {isAdmin && <TabsTrigger value="logs">Logs</TabsTrigger>}
          </TabsList>
        </div>

      {/* Contadores diarios por agente */}
      <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {dailyAgentCounters.map((counter) => {
          const isLow = counter.remaining <= 3
          const isZero = counter.remaining === 0

          const accentColor =
            counter.agent === 'Raul'
              ? '#FF6600'
              : '#F97316' // Mario

          return (
            <div
              key={counter.agent}
              className="glass-card px-4 py-3 rounded-xl flex items-center justify-between border border-white/10"
            >
              <div>
                <p className="text-xs text-white/50 mb-1">Cuota diaria {counter.agent}</p>
                <p className="text-sm text-white/70">
                  {counter.usedToday} / {DAILY_QUOTA} añadidos hoy
                </p>
              </div>
              <div
                className={cn(
                  'px-3 py-1 rounded-full text-xs font-semibold flex items-center justify-center min-w-[56px]',
                  isZero
                    ? 'bg-red-500/15 text-red-300 border border-red-500/40'
                    : isLow
                    ? 'bg-amber-500/15 text-amber-200 border border-amber-500/40'
                    : 'bg-emerald-500/15 text-emerald-200 border border-emerald-500/40'
                )}
                style={{ boxShadow: `0 0 0 1px ${accentColor}22` }}
              >
                {counter.remaining} left
              </div>
            </div>
          )
        })}
      </div>

        <TabsContent value="companies">
          {/* Barra de búsqueda */}
          <div className="mb-6 flex items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 h-4 w-4 text-white/40 z-10 pointer-events-none" />
              <Input
                type="text"
                placeholder="Buscar empresas o prospectos..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="!pl-12 !pr-4 input-glass"
              />
            </div>
            {searchQuery && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSearchQuery('')}
                className="text-white/60 hover:text-white"
              >
                Limpiar
              </Button>
            )}
          </div>

          {/* Grid de Empresas */}
          {filteredCompanies.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredCompanies.map((company) => (
                <CompanyCard
                  key={company.id}
                  company={company}
                  onProspectClick={handleProspectClick}
                  onAddProspect={handleAddProspect}
                  onDeleteCompany={handleDeleteCompany}
                  onEditCompany={handleEditCompany}
                />
              ))}
            </div>
          ) : companies.length > 0 ? (
            <div className="glass-card p-12 text-center">
              <p className="text-white/60 mb-4">
                No se encontraron empresas que coincidan con "{searchQuery}"
              </p>
              <Button
                variant="ghost"
                onClick={() => setSearchQuery('')}
                className="text-white/60 hover:text-white"
              >
                Limpiar búsqueda
              </Button>
            </div>
          ) : (
            <div className="glass-card p-12 text-center">
              <p className="text-white/60 mb-4">
                No hay empresas añadidas aún
              </p>
              <Button
                onClick={() => setIsAddCompanyModalOpen(true)}
                className="bg-[#FF6600]/20 border-2 border-[#FF6600] text-[#FF6600] hover:bg-[#FF6600]/30 hover:border-[#FF6600]/80"
              >
                <Plus className="h-4 w-4 mr-2" />
                Añadir Primera Empresa
              </Button>
            </div>
          )}
        </TabsContent>

        <TabsContent value="followup">
          <div className="glass-card p-6 rounded-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-white">Seguimiento pendiente</h2>
              <p className="text-sm text-white/60">
                {pendingProspects.length} contactos pendientes en los próximos 7 días
              </p>
            </div>
            {pendingProspects.length === 0 ? (
              <p className="text-white/50 text-sm">
                No hay contactos pendientes ahora mismo. ¡Buen trabajo!
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-white/60">
                      <th className="text-left py-2 px-3">Contacto</th>
                      <th className="text-left py-2 px-3">Empresa</th>
                      <th className="text-left py-2 px-3">Estado</th>
                      <th className="text-left py-2 px-3">Agente</th>
                      <th className="text-left py-2 px-3">Próximo contacto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingProspects.map((p) => {
                      const isToday =
                        !!p.effective_next_contact_at &&
                        differenceInCalendarDays(
                          startOfDay(new Date(p.effective_next_contact_at)),
                          startOfDay(new Date())
                        ) === 0

                      const nextContactCellClass = isToday
                        ? 'py-2 px-3 text-emerald-300 font-semibold'
                        : 'py-2 px-3 text-white/70'

                      return (
                      <tr
                        key={p.id}
                        className="border-b border-white/5 hover:bg-white/5 cursor-pointer"
                        onClick={() => handleProspectClick(p.id)}
                      >
                        <td className="py-2 px-3 text-white">
                          <div className="font-medium">{p.full_name}</div>
                          {p.role && <div className="text-xs text-white/60">{p.role}</div>}
                        </td>
                        <td className="py-2 px-3 text-white/80">
                          {p.company_name}
                        </td>
                        <td className="py-2 px-3 text-white/70">
                          {p.status === 'connected'
                            ? 'Primer contacto'
                            : p.status === 'messaged'
                            ? '2o contacto'
                            : p.status === 'third_contact'
                            ? '3er contacto'
                            : p.status === 'identified'
                            ? 'Identificado'
                            : p.status === 'in_follow_up'
                            ? 'En seguimiento'
                            : p.status === 'meeting_scheduled'
                            ? 'Reunión concretada'
                            : p.status === 'not_interested'
                            ? 'No le interesa'
                            : p.status}
                        </td>
                        <td className="py-2 px-3 text-white/70">
                          {p.agent}
                        </td>
                        <td className={nextContactCellClass}>
                          {p.effective_next_contact_at
                            ? format(new Date(p.effective_next_contact_at), "dd MMM yyyy", { locale: es })
                            : '-'}
                        </td>
                      </tr>
                    )})}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="metrics">
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <div className="glass-card p-4 rounded-xl">
                <p className="text-xs text-white/60 mb-1">Prospectos totales</p>
                <p className="text-2xl font-bold text-white">{statusMetrics.total}</p>
              </div>
              <div className="glass-card p-4 rounded-xl">
                <p className="text-xs text-white/60 mb-1">Identificados</p>
                <p className="text-2xl font-bold text-gray-300">{statusMetrics.identified}</p>
              </div>
              <div className="glass-card p-4 rounded-xl">
                <p className="text-xs text-white/60 mb-1">Primer contacto</p>
                <p className="text-2xl font-bold text-[#FF6600]">{statusMetrics.connected}</p>
              </div>
              <div className="glass-card p-4 rounded-xl">
                <p className="text-xs text-white/60 mb-1">2o contacto</p>
                <p className="text-2xl font-bold text-blue-400">{statusMetrics.messaged}</p>
              </div>
              <div className="glass-card p-4 rounded-xl">
                <p className="text-xs text-white/60 mb-1">3er contacto</p>
                <p className="text-2xl font-bold text-red-300">{statusMetrics.thirdContact}</p>
              </div>
              <div className="glass-card p-4 rounded-xl">
                <p className="text-xs text-white/60 mb-1">En seguimiento</p>
                <p className="text-2xl font-bold text-green-400">{statusMetrics.inFollowUp}</p>
              </div>
              <div className="glass-card p-4 rounded-xl">
                <p className="text-xs text-white/60 mb-1">Reunión concretada</p>
                <p className="text-2xl font-bold text-emerald-400">{statusMetrics.meetingScheduled}</p>
              </div>
              <div className="glass-card p-4 rounded-xl">
                <p className="text-xs text-white/60 mb-1">No le interesa</p>
                <p className="text-2xl font-bold text-slate-400">{statusMetrics.notInterested}</p>
              </div>
            </div>

            <div className="glass-card p-4 rounded-xl">
              <h3 className="text-sm font-semibold text-white mb-3">Estado actual del funnel</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={statusChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                    <XAxis dataKey="name" stroke="#ffffff60" />
                    <YAxis stroke="#ffffff60" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'var(--ls-fondo)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 8,
                        color: '#fff',
                      }}
                    />
                    <Legend />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                      {statusChartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="glass-card p-4 rounded-xl">
              <h3 className="text-sm font-semibold text-white mb-3">Prospectos creados por semana</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weeklyCreationData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                    <XAxis dataKey="name" stroke="#ffffff60" angle={-30} textAnchor="end" height={70} />
                    <YAxis stroke="#ffffff60" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'var(--ls-fondo)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 8,
                        color: '#fff',
                      }}
                    />
                    <Bar dataKey="count" fill="#10b981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Pestaña de Logs - Solo para Admin */}
        {isAdmin && (
          <TabsContent value="logs" className="mt-6">
            <LinkedInLogsTab />
          </TabsContent>
        )}
      </Tabs>

      {/* Modales */}
      <ProspectModal
        prospect={selectedProspect}
        open={isProspectModalOpen}
        onClose={() => {
          setIsProspectModalOpen(false)
          setSelectedProspect(null)
        }}
        onUpdate={handleProspectUpdate}
      />

      <AddCompanyModal
        open={isAddCompanyModalOpen}
        onClose={() => setIsAddCompanyModalOpen(false)}
        onSuccess={handleCompanyAdded}
      />

      {selectedCompanyForProspect && (
        <AddProspectModal
          open={isAddProspectModalOpen}
          companyId={selectedCompanyForProspect.id}
          companyName={selectedCompanyForProspect.name}
          onClose={() => {
            setIsAddProspectModalOpen(false)
            setSelectedCompanyForProspect(null)
          }}
          onSuccess={handleProspectAdded}
        />
      )}
      <EditCompanyModal
        open={isEditCompanyModalOpen}
        onClose={() => {
          setSelectedCompanyForEdit(null)
          setIsEditCompanyModalOpen(false)
        }}
        company={selectedCompanyForEdit}
        onSuccess={handleCompanyUpdated}
      />
    </div>
  )
}

