'use client'

import { WebLead } from '@/lib/types/web-leads'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import { Building2, Mail, Phone } from 'lucide-react'
import { cn } from '@/lib/utils'

interface LeadCardProps {
  lead: WebLead
  onClick: () => void
}

export function LeadCard({ lead, onClick }: LeadCardProps) {
  const timeAgo = formatDistanceToNow(new Date(lead.created_at), {
    addSuffix: true,
    locale: es
  })

  return (
    <div
      onClick={onClick}
      className={cn(
        "glass-card p-4 cursor-pointer transition-all duration-300 relative",
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
    </div>
  )
}

