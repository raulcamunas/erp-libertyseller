'use client'

import { CompanyProspect, Agent } from '@/lib/types/linkedin'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { User, Clock } from 'lucide-react'
import { differenceInCalendarDays, startOfDay, format } from 'date-fns'
import { es } from 'date-fns/locale'

interface ProspectMiniCardProps {
  prospect: CompanyProspect
  onClick: () => void
  onAgentChange?: (agent: Agent) => void // Opcional, ya no se usa
}

export function ProspectMiniCard({ prospect, onClick }: ProspectMiniCardProps) {
  const agentColors: Record<Agent, string> = {
    Raul: 'border-2 border-[#FF6600]/70 bg-[#FF6600]/20 text-[#FF6600]',
    Mario: 'border-2 border-orange-400/70 bg-orange-500/20 text-orange-300',
    Alejandro: 'border-2 border-sky-400/70 bg-sky-500/20 text-sky-300',
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

  // Texto ultra-compacto del contador de siguiente contacto
  let nextContactText: string | null = null
  let nextContactClass =
    'inline-flex items-center gap-1 rounded-full border border-white/15 px-1.5 py-0.5 text-[10px] text-white/70'

  // Fecha efectiva de próximo contacto:
  // 1) si existe next_contact_at la usamos
  // 2) si no existe pero el status ya es connected/messaged (leads antiguos), usamos created_at + (1 o 3 días)
  let effectiveNextContactAt: string | null = prospect.next_contact_at || null

  if (!effectiveNextContactAt) {
    if (prospect.status === 'connected') {
      const d = new Date(prospect.created_at)
      d.setDate(d.getDate() + 1)
      effectiveNextContactAt = d.toISOString()
    } else if (prospect.status === 'messaged') {
      const d = new Date(prospect.created_at)
      d.setDate(d.getDate() + 3)
      effectiveNextContactAt = d.toISOString()
    }
  }

  if (effectiveNextContactAt) {
    const today = startOfDay(new Date())
    const target = startOfDay(new Date(effectiveNextContactAt))
    const diffDays = differenceInCalendarDays(target, today)

    if (diffDays < 0) {
      nextContactText = 'ASAP'
      nextContactClass =
        'inline-flex items-center gap-1 rounded-full border border-red-500/40 px-1.5 py-0.5 text-[10px] text-red-300 bg-red-500/10'
    } else if (diffDays === 0) {
      nextContactText = 'Hoy'
      nextContactClass =
        'inline-flex items-center gap-1 rounded-full border border-amber-400/40 px-1.5 py-0.5 text-[10px] text-amber-200 bg-amber-500/10'
    } else if (diffDays === 1) {
      nextContactText = '1d'
    } else {
      nextContactText = `${diffDays}d`
    }
  }
  
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
        <p className="text-[11px] text-white/35 truncate leading-tight mt-0.5">
          Creado el{' '}
          {format(new Date(prospect.created_at), "dd MMM yyyy", {
            locale: es,
          })}
        </p>
      </div>

      {/* Lado derecho: agente + mini contador */}
      <div className="flex flex-col items-end gap-1 flex-shrink-0 ml-2">
        <Badge
          className={cn(
            'text-xs px-2 py-0.5 flex items-center gap-1',
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

        {nextContactText && (
          <span className={nextContactClass}>
            <Clock className="h-3 w-3" />
            {nextContactText}
          </span>
        )}
      </div>
    </div>
  )
}

