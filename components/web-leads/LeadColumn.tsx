'use client'

import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { WebLead, WebLeadStatus } from '@/lib/types/web-leads'
import { LeadCard } from './LeadCard'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@/lib/utils'

interface LeadColumnProps {
  status: { id: WebLeadStatus; label: string; color: string }
  leads: WebLead[]
  onLeadClick: (lead: WebLead) => void
}

function SortableLeadCard({ lead, onClick }: { lead: WebLead; onClick: () => void }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: lead.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div 
      ref={setNodeRef} 
      style={style} 
      {...attributes} 
      {...listeners}
      data-id={lead.id}
    >
      <LeadCard lead={lead} onClick={onClick} />
    </div>
  )
}

export function LeadColumn({ status, leads, onLeadClick }: LeadColumnProps) {
  const { setNodeRef } = useDroppable({
    id: status.id,
  })

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
      <div
        ref={setNodeRef}
        className="flex-1 space-y-3 min-h-[200px] pb-4"
      >
        <SortableContext
          items={leads.map(l => l.id)}
          strategy={verticalListSortingStrategy}
        >
          {leads.map((lead) => (
            <SortableLeadCard
              key={lead.id}
              lead={lead}
              onClick={() => onLeadClick(lead)}
            />
          ))}
        </SortableContext>

        {leads.length === 0 && (
          <div className="text-center py-8 text-white/30 text-sm">
            Sin leads
          </div>
        )}
      </div>
    </div>
  )
}

