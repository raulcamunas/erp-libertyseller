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
import { toast } from 'sonner'

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

  // Real-time subscription para nuevos leads
  useEffect(() => {
    const channel = supabase
      .channel('web_leads_changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'web_leads',
        },
        (payload) => {
          const newLead = payload.new as WebLead
          
          // Verificar que el lead no esté ya en la lista (evitar duplicados)
          setLeads((prevLeads) => {
            const exists = prevLeads.some(l => l.id === newLead.id)
            if (exists) return prevLeads
            
            // Mostrar notificación
            toast.success('Nuevo lead registrado en formulario web', {
              description: `${newLead.nombre}${newLead.email ? ` - ${newLead.email}` : ''}`,
              duration: 5000,
            })
            
            return [newLead, ...prevLeads]
          })
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'web_leads',
        },
        (payload) => {
          const updatedLead = payload.new as WebLead
          setLeads((prevLeads) =>
            prevLeads.map((l) => (l.id === updatedLead.id ? updatedLead : l))
          )
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase])

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

        <DragOverlay dropAnimation={null}>
          {activeLead ? (
            <div className="opacity-90 rotate-2 scale-105 cursor-grabbing">
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

