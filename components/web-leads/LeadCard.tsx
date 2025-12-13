'use client'

import { WebLead, WebLeadStatus } from '@/lib/types/web-leads'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import { Building2, Mail, Phone, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

interface LeadCardProps {
  lead: WebLead
  onClick: () => void
  currentStatus: WebLeadStatus
  onMoveLeft?: () => void
  onMoveRight?: () => void
  onDelete?: () => void
  canMoveLeft: boolean
  canMoveRight: boolean
}

export function LeadCard({ 
  lead, 
  onClick, 
  currentStatus,
  onMoveLeft,
  onMoveRight,
  onDelete,
  canMoveLeft,
  canMoveRight
}: LeadCardProps) {
  const timeAgo = formatDistanceToNow(new Date(lead.created_at), {
    addSuffix: true,
    locale: es
  })

  const handleCardClick = (e: React.MouseEvent) => {
    // No abrir el panel si se hace clic en los botones
    if ((e.target as HTMLElement).closest('button')) {
      return
    }
    onClick()
  }

  const handleMoveLeft = (e: React.MouseEvent) => {
    e.stopPropagation()
    onMoveLeft?.()
  }

  const handleMoveRight = (e: React.MouseEvent) => {
    e.stopPropagation()
    onMoveRight?.()
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onDelete && confirm(`¿Estás seguro de eliminar el lead "${lead.nombre}"?`)) {
      onDelete()
    }
  }

  return (
    <div
      onClick={handleCardClick}
      className={cn(
        "glass-card p-4 cursor-pointer transition-all duration-300 relative group",
        "hover:border-[#FF6600]/30 hover:scale-[1.02]",
        "border border-white/10 rounded-xl"
      )}
      style={{
        boxShadow: 'none'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = '0 0 30px rgba(255, 102, 0, 0.3)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      {/* Nombre y Empresa */}
      <div className="mb-3">
        <h3 className="font-bold text-white text-base mb-1">
          {lead.nombre}
        </h3>
        {lead.empresa && (
          <div className="flex items-center gap-1.5 text-white/60 text-sm">
            <Building2 className="h-3.5 w-3.5" />
            <span>{lead.empresa}</span>
          </div>
        )}
      </div>

      {/* Contacto */}
      <div className="space-y-1.5 mb-3">
        {lead.email && (
          <div className="flex items-center gap-2 text-white/70 text-xs">
            <Mail className="h-3.5 w-3.5 text-white/50" />
            <span className="truncate">{lead.email}</span>
          </div>
        )}
        {lead.telefono && (
          <div className="flex items-center gap-2 text-white/70 text-xs">
            <Phone className="h-3.5 w-3.5 text-white/50" />
            <span>{lead.telefono}</span>
          </div>
        )}
      </div>

      {/* Tiempo */}
      <div className="text-[10px] text-white/40 mt-2">
        {timeAgo}
      </div>

      {/* Botones de navegación y borrar */}
      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {canMoveLeft && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 bg-white/[0.1] hover:bg-white/[0.2] border border-white/10"
            onClick={handleMoveLeft}
            title="Mover a la izquierda"
          >
            <ChevronLeft className="h-4 w-4 text-white" />
          </Button>
        )}
        {canMoveRight && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 bg-white/[0.1] hover:bg-white/[0.2] border border-white/10"
            onClick={handleMoveRight}
            title="Mover a la derecha"
          >
            <ChevronRight className="h-4 w-4 text-white" />
          </Button>
        )}
        {onDelete && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 bg-red-500/[0.1] hover:bg-red-500/[0.2] border border-red-500/20"
            onClick={handleDelete}
            title="Eliminar lead"
          >
            <Trash2 className="h-4 w-4 text-red-400" />
          </Button>
        )}
      </div>
    </div>
  )
}

