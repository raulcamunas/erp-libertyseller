'use client'

import { useState } from 'react'
import { CompanyWithProspects, CompanyProspect } from '@/lib/types/linkedin'
import { CompanyCard } from './CompanyCard'
import { ProspectModal } from './ProspectModal'
import { AddCompanyModal } from './AddCompanyModal'
import { AddProspectModal } from './AddProspectModal'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'

interface LinkedInDashboardProps {
  initialCompanies: CompanyWithProspects[]
}

export function LinkedInDashboard({ initialCompanies }: LinkedInDashboardProps) {
  const [companies, setCompanies] = useState<CompanyWithProspects[]>(initialCompanies)
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

  return (
    <div className="linkedin-module">
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

