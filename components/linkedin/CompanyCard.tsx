'use client'

import { CompanyWithProspects } from '@/lib/types/linkedin'
import { ProspectMiniCard } from './ProspectMiniCard'
import { Button } from '@/components/ui/button'
import { Plus, Trash2, ExternalLink, Edit } from 'lucide-react'
import { cn } from '@/lib/utils'

interface CompanyCardProps {
  company: CompanyWithProspects
  onProspectClick: (prospectId: string) => void
  onAddProspect: (companyId: string) => void
  onDeleteCompany?: (companyId: string) => void
  onEditCompany?: (company: CompanyWithProspects) => void
}

export function CompanyCard({
  company,
  onProspectClick,
  onAddProspect,
  onDeleteCompany,
  onEditCompany,
}: CompanyCardProps) {
  return (
    <div className="glass-card p-5 border border-white/10 rounded-xl hover:border-[#FF6600]/20 transition-all duration-200">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <h3 className="text-xl font-bold text-white mb-1">
            {company.name}
          </h3>
          <p className="text-xs text-white/50">
            {company.prospects.length} {company.prospects.length === 1 ? 'prospecto' : 'prospectos'}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {onEditCompany && (
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation()
                onEditCompany(company)
              }}
              className="h-8 w-8 text-white/50 hover:text-[#FF6600] hover:bg-[#FF6600]/10"
              title="Editar empresa"
            >
              <Edit className="h-4 w-4" />
            </Button>
          )}
          {onDeleteCompany && (
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation()
                if (confirm(`¿Eliminar la empresa "${company.name}"?`)) {
                  onDeleteCompany(company.id)
                }
              }}
              className="h-8 w-8 text-white/50 hover:text-red-400 hover:bg-red-500/10"
              title="Eliminar empresa"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Lista de Prospectos */}
      <div className="space-y-2 mb-4 min-h-[100px] max-h-[400px] overflow-y-auto">
        {company.prospects.length > 0 ? (
          company.prospects.map((prospect) => (
            <ProspectMiniCard
              key={prospect.id}
              prospect={prospect}
              onClick={() => onProspectClick(prospect.id)}
            />
          ))
        ) : (
          <div className="text-center py-8 text-white/30 text-sm">
            Sin prospectos aún
          </div>
        )}
      </div>

      {/* Footer - Botones */}
      <div className="space-y-2">
        {company.amazon_url && (
          <Button
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation()
              window.open(company.amazon_url!, '_blank')
            }}
            className="w-full border border-blue-500/20 hover:border-blue-500/40 hover:bg-blue-500/10 text-blue-400"
          >
            <ExternalLink className="h-4 w-4 mr-2" />
            Página de Amazon
          </Button>
        )}
        <Button
          variant="ghost"
          onClick={() => onAddProspect(company.id)}
          className="w-full border border-[#FF6600]/20 hover:border-[#FF6600]/40 hover:bg-[#FF6600]/10 text-[#FF6600]"
        >
          <Plus className="h-4 w-4 mr-2" />
          Añadir Empleado
        </Button>
      </div>
    </div>
  )
}

