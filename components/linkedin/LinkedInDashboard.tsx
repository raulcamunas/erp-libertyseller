'use client'

import { useMemo, useState } from 'react'
import { CompanyWithProspects, CompanyProspect, Agent } from '@/lib/types/linkedin'
import { CompanyCard } from './CompanyCard'
import { ProspectModal } from './ProspectModal'
import { AddCompanyModal } from './AddCompanyModal'
import { AddProspectModal } from './AddProspectModal'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
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
} from 'recharts'
import { format, differenceInCalendarDays, startOfDay } from 'date-fns'
import { es } from 'date-fns/locale'
import { cn } from '@/lib/utils'

interface LinkedInDashboardProps {
  initialCompanies: CompanyWithProspects[]
}

export function LinkedInDashboard({ initialCompanies }: LinkedInDashboardProps) {
  const [companies, setCompanies] = useState<CompanyWithProspects[]>(initialCompanies)
  const [activeTab, setActiveTab] = useState<'companies' | 'followup' | 'metrics'>('companies')
  const [selectedProspect, setSelectedProspect] = useState<CompanyProspect | null>(null)
  const [isProspectModalOpen, setIsProspectModalOpen] = useState(false)
  const [isAddCompanyModalOpen, setIsAddCompanyModalOpen] = useState(false)
  const [isAddProspectModalOpen, setIsAddProspectModalOpen] = useState(false)
  const [selectedCompanyForProspect, setSelectedCompanyForProspect] = useState<{
    id: string
    name: string
  } | null>(null)
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
                  d.setDate(d.getDate() + 1)
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
                prospect.status !== 'replied' &&
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
    const replied = allProspects.filter(p => p.status === 'replied').length

    return { total, identified, connected, messaged, replied }
  }, [allProspects])

  const statusChartData = useMemo(() => ([
    { name: 'Identificados', value: statusMetrics.identified },
    { name: 'Conectados', value: statusMetrics.connected },
    { name: 'Mensaje enviado', value: statusMetrics.messaged },
    { name: 'Respondieron', value: statusMetrics.replied },
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
    const agents: Agent[] = ['Raul', 'Mario', 'Alejandro']

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

  return (
    <div className="linkedin-module">
      <div className="mb-4 flex items-center justify-between">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
          <TabsList>
            <TabsTrigger value="companies">Empresas</TabsTrigger>
            <TabsTrigger value="followup">Seguimiento</TabsTrigger>
            <TabsTrigger value="metrics">Métricas</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Contadores diarios por agente */}
      <div className="mb-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
        {dailyAgentCounters.map((counter) => {
          const isLow = counter.remaining <= 3
          const isZero = counter.remaining === 0

          const accentColor =
            counter.agent === 'Raul'
              ? '#FF6600'
              : counter.agent === 'Mario'
              ? '#F97316'
              : '#0EA5E9'

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

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
        <TabsContent value="companies">
          {/* Grid de Empresas */}
          {companies.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {companies.map((company) => (
                <CompanyCard
                  key={company.id}
                  company={company}
                  onProspectClick={handleProspectClick}
                  onAddProspect={handleAddProspect}
                  onDeleteCompany={handleDeleteCompany}
                />
              ))}
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
                            ? 'Conectado'
                            : p.status === 'messaged'
                            ? 'Mensaje enviado'
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
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="glass-card p-4 rounded-xl">
                <p className="text-xs text-white/60 mb-1">Prospectos totales</p>
                <p className="text-2xl font-bold text-white">{statusMetrics.total}</p>
              </div>
              <div className="glass-card p-4 rounded-xl">
                <p className="text-xs text-white/60 mb-1">Conectados</p>
                <p className="text-2xl font-bold text-sky-300">{statusMetrics.connected}</p>
              </div>
              <div className="glass-card p-4 rounded-xl">
                <p className="text-xs text-white/60 mb-1">Mensajes enviados</p>
                <p className="text-2xl font-bold text-blue-300">{statusMetrics.messaged}</p>
              </div>
              <div className="glass-card p-4 rounded-xl">
                <p className="text-xs text-white/60 mb-1">Respuestas</p>
                <p className="text-2xl font-bold text-purple-300">{statusMetrics.replied}</p>
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
                        backgroundColor: '#080808',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 8,
                        color: '#fff',
                      }}
                    />
                    <Legend />
                    <Bar dataKey="value" fill="#FF6600" radius={[4, 4, 0, 0]} />
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
                        backgroundColor: '#080808',
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
    </div>
  )
}

