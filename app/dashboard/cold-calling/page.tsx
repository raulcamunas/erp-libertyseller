import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect } from 'next/navigation'
import { ColdCallingBoard } from '@/components/cold-calling/ColdCallingBoard'
import { ColdLead } from '@/lib/types/cold-leads'
import { CalendarPerson } from '@/lib/types/appointments'

export default async function ColdCallingPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const profile = await getUserProfile()
  if (!profile) redirect('/auth/login')

  const isAdmin = profile.role === 'admin' || profile.role === 'partner'

  // RLS ya limita a cada comercial su cartera; los admins reciben todo.
  // El límite alto es para que no se corte en las 1000 filas por defecto.
  const { data: leads } = await supabase
    .from('cold_leads')
    .select('*')
    .order('revenue_monthly', { ascending: false, nullsFirst: false })
    .limit(5000)

  const { data: team } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, calendar_color')
    .eq('is_comercial', true)
    .order('full_name', { ascending: true })

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)] lg:h-[calc(100vh-4rem)]">
      <div className="mb-3 flex-shrink-0">
        <h1 className="heading-medium text-white mb-1">Cold Calling</h1>
        <p className="text-white/50 text-sm">
          Tu cartera de sellers: estado de cada uno, historial de llamadas y todo
          lo que necesitas para la siguiente.
        </p>
      </div>

      <div className="flex-1 min-h-0">
        <ColdCallingBoard
          initialLeads={(leads as ColdLead[]) || []}
          team={(team as CalendarPerson[]) || []}
          currentUser={profile}
          isAdmin={isAdmin}
        />
      </div>
    </div>
  )
}
