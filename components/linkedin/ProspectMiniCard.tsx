'use client'

import { CompanyProspect, Agent } from '@/lib/types/linkedin'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { User } from 'lucide-react'

interface ProspectMiniCardProps {
  prospect: CompanyProspect
  onClick: () => void
  onAgentChange?: (agent: Agent) => void // Opcional, ya no se usa
}

export function ProspectMiniCard({ prospect, onClick }: ProspectMiniCardProps) {
  const agentColors: Record<Agent, string> = {
    Raul: 'border-2 border-[#FF6600]/70 bg-[#FF6600]/20 text-[#FF6600]',
    Mario: 'border-2 border-orange-400/70 bg-orange-500/20 text-orange-300',
  }

  // Colores del borde según el estado del prospecto (siempre activo)
  const getStatusBorderColor = (status: string) => {
    switch (status) {
      case 'identified':
        return 'border-2 border-white/20' // Gris
      case 'connected':
        return 'border-2 border-[#FF6600]/70' // Naranja
      case 'messaged':
        return 'border-2 border-[#FF6600]/70' // Naranja
      case 'replied':
        return 'border-2 border-purple-400/70' // Morado
      default:
        return 'border-2 border-white/20'
    }
  }

  const statusBorder = getStatusBorderColor(prospect.status)
  
  return (
    <div
      onClick={onClick}
      className={cn(
        "glass-card cursor-pointer transition-all duration-200",
        "rounded-lg mb-2",
        "flex items-center justify-between gap-2",
        "py-3 px-3",
        statusBorder
      )}
      style={{
        borderWidth: '2px',
        borderStyle: 'solid',
        ...(prospect.status === 'identified' && { borderColor: 'rgba(255, 255, 255, 0.2)' }),
        ...(prospect.status === 'connected' && { borderColor: 'rgba(56, 189, 248, 0.7)' }), // sky-400
        ...(prospect.status === 'messaged' && { borderColor: 'rgba(59, 130, 246, 0.7)' }), // blue-500
        ...(prospect.status === 'replied' && { borderColor: 'rgba(192, 132, 252, 0.7)' }), // purple-400
      }}
    >
      <div className="flex-1 min-w-0 flex flex-col justify-center">
        <h4 className="font-semibold text-white text-sm truncate leading-tight">
          {prospect.full_name}
        </h4>
        {prospect.role && (
          <p className="text-xs text-white/60 truncate leading-tight mt-0.5">
            {prospect.role}
          </p>
        )}
      </div>

      {/* Badge informativo del Agente */}
      <Badge
        className={cn(
          "text-xs px-2 py-0.5 flex items-center gap-1 flex-shrink-0",
          agentColors[prospect.agent]
        )}
        style={
          prospect.agent === 'Mario'
            ? {
                borderWidth: '2px',
                borderStyle: 'solid',
                borderColor: 'rgba(251, 146, 60, 0.7)', // orange-400/70
                backgroundColor: 'rgba(249, 115, 22, 0.2)', // orange-500/20
                color: 'rgb(253, 186, 116)', // orange-300
              }
            : undefined
        }
      >
        <User className="h-3 w-3" />
        {prospect.agent}
      </Badge>
    </div>
  )
}

