import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect } from 'next/navigation'
import { KanbanBoard } from '@/components/web-leads/KanbanBoard'
import { WebLead } from '@/lib/types/web-leads'

export default async function WebLeadsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  const profile = await getUserProfile()

  if (!profile) {
    redirect('/auth/login')
  }

  // Cargar todos los leads
  const { data: leads, error } = await supabase
    .from('web_leads')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error loading leads:', error)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="heading-medium text-white mb-2">
          CRM Leads Web
        </h1>
        <p className="text-white/50">
          Gestiona los leads que llegan desde tu sitio web
        </p>
      </div>

      {/* Kanban Board */}
      {leads && leads.length > 0 ? (
        <KanbanBoard initialLeads={leads as WebLead[]} />
      ) : (
        <div className="glass-card p-12 text-center">
          <p className="text-white/50 mb-4">No hay leads aún</p>
          <p className="text-white/30 text-sm">
            Los leads que lleguen desde n8n aparecerán aquí automáticamente
          </p>
        </div>
      )}
    </div>
  )
}

