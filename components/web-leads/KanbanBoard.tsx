'use client'

import { useState, useEffect } from 'react'
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { WebLead, WebLeadStatus } from '@/lib/types/web-leads'
import { LeadCard } from './LeadCard'
import { LeadColumn } from './LeadColumn'
import { LeadSheet } from './LeadSheet'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

const STATUSES: { id: WebLeadStatus; label: string; color: string }[] = [
  { id: 'registrado', label: 'Registrado', color: 'bg-blue-500/20 border-blue-500/30' },
  { id: 'contactado', label: 'Contactado', color: 'bg-yellow-500/20 border-yellow-500/30' },
  { id: 'seguimiento', label: 'Seguimiento', color: 'bg-purple-500/20 border-purple-500/30' },
  { id: 'interesado', label: 'Interesado', color: 'bg-green-500/20 border-green-500/30' },
  { id: 'descartado', label: 'Descartado', color: 'bg-gray-500/20 border-gray-500/30' },
]

interface KanbanBoardProps {
  initialLeads: WebLead[]
}

export function KanbanBoard({ initialLeads }: KanbanBoardProps) {
  const [leads, setLeads] = useState<WebLead[]>(initialLeads)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [selectedLead, setSelectedLead] = useState<WebLead | null>(null)
  const supabase = createClient()

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  )

  // Agrupar leads por estado
  const leadsByStatus = leads.reduce((acc, lead) => {
    if (!acc[lead.status]) {
      acc[lead.status] = []
    }
    acc[lead.status].push(lead)
    return acc
  }, {} as Record<WebLeadStatus, WebLead[]>)

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string)
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    setActiveId(null)

    if (!over) return

    const leadId = active.id as string
    const newStatus = over.id as WebLeadStatus

    // Encontrar el lead actual
    const lead = leads.find(l => l.id === leadId)
    if (!lead || lead.status === newStatus) return

    // Optimistic update
    setLeads(prevLeads =>
      prevLeads.map(l =>
        l.id === leadId ? { ...l, status: newStatus } : l
      )
    )

    // Actualizar en Supabase
    try {
      const { error } = await supabase
        .from('web_leads')
        .update({ status: newStatus })
        .eq('id', leadId)

      if (error) throw error
    } catch (error) {
      console.error('Error updating lead status:', error)
      // Revertir cambio en caso de error
      setLeads(prevLeads =>
        prevLeads.map(l =>
          l.id === leadId ? { ...l, status: lead.status } : l
        )
      )
    }
  }

  const handleLeadUpdate = (updatedLead: WebLead) => {
    setLeads(prevLeads =>
      prevLeads.map(l => (l.id === updatedLead.id ? updatedLead : l))
    )
    setSelectedLead(null)
  }

  const activeLead = activeId ? leads.find(l => l.id === activeId) : null

  return (
    <>
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {STATUSES.map((status) => {
            const statusLeads = leadsByStatus[status.id] || []
            return (
              <LeadColumn
                key={status.id}
                status={status}
                leads={statusLeads}
                onLeadClick={setSelectedLead}
              />
            )
          })}
        </div>

        <DragOverlay>
          {activeLead ? (
            <div className="opacity-90">
              <LeadCard lead={activeLead} onClick={() => {}} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {selectedLead && (
        <LeadSheet
          lead={selectedLead}
          onClose={() => setSelectedLead(null)}
          onUpdate={handleLeadUpdate}
        />
      )}
    </>
  )
}

