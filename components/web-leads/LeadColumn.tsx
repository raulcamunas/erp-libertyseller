'use client'

import { WebLead, WebLeadStatus } from '@/lib/types/web-leads'
import { LeadCard } from './LeadCard'
import { cn } from '@/lib/utils'

interface LeadColumnProps {
  status: { id: WebLeadStatus; label: string; color: string }
  leads: WebLead[]
  onLeadClick: (lead: WebLead) => void
  onMoveLead: (leadId: string, newStatus: WebLeadStatus) => void
  onDeleteLead: (leadId: string) => void
  statusIndex: number
  totalStatuses: number
  allStatuses: { id: WebLeadStatus; label: string; color: string }[]
}

export function LeadColumn({ 
  status, 
  leads, 
  onLeadClick, 
  onMoveLead,
  onDeleteLead,
  statusIndex,
  totalStatuses,
  allStatuses
}: LeadColumnProps) {
  const canMoveLeft = statusIndex > 0
  const canMoveRight = statusIndex < totalStatuses - 1

  return (
    <div className="flex flex-col h-full">
      {/* Header de la columna */}
      <div
        className={cn(
          "p-3 rounded-t-xl border-b border-white/10 mb-3",
          status.color
        )}
      >
        <h3 className="font-semibold text-white text-sm">
          {status.label}
        </h3>
        <span className="text-xs text-white/60">
          {leads.length} {leads.length === 1 ? 'lead' : 'leads'}
        </span>
      </div>

      {/* Contenido de la columna */}
      <div className="flex-1 space-y-3 min-h-[200px] pb-4">
        {leads.map((lead) => {
          // Determinar estados adyacentes
          const prevStatus = canMoveLeft ? allStatuses[statusIndex - 1]?.id : null
          const nextStatus = canMoveRight ? allStatuses[statusIndex + 1]?.id : null

          return (
            <LeadCard
              key={lead.id}
              lead={lead}
              onClick={() => onLeadClick(lead)}
              currentStatus={status.id}
              onMoveLeft={canMoveLeft && prevStatus ? () => onMoveLead(lead.id, prevStatus) : undefined}
              onMoveRight={canMoveRight && nextStatus ? () => onMoveLead(lead.id, nextStatus) : undefined}
              onDelete={() => onDeleteLead(lead.id)}
              canMoveLeft={canMoveLeft}
              canMoveRight={canMoveRight}
            />
          )
        })}

        {leads.length === 0 && (
          <div className="text-center py-8 text-white/30 text-sm">
            Sin leads
          </div>
        )}
      </div>
    </div>
  )
}

