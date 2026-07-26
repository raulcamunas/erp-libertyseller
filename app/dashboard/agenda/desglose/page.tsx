import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect } from 'next/navigation'
import { AppointmentsBreakdown } from '@/components/agenda/AppointmentsBreakdown'
import { AppointmentWithPeople, CalendarPerson } from '@/lib/types/appointments'

export default async function AgendaBreakdownPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const profile = await getUserProfile()
  if (!profile) redirect('/auth/login')

  const { data: team } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, calendar_color')
    .eq('is_comercial', true)
    .order('full_name', { ascending: true })

  // Solo citas gestionadas por el ERP (se excluyen los "Hueco no disponible")
  const { data: appointments } = await supabase
    .from('appointments')
    .select(`
      *,
      comercial:profiles!appointments_comercial_id_fkey(id, full_name, email, role, calendar_color),
      assigned_closer:profiles!appointments_assigned_closer_id_fkey(id, full_name, email, role, calendar_color)
    `)
    .eq('is_external', false)
    .order('start_time', { ascending: true })

  return (
    <div className="space-y-6">
      <div className="mb-2">
        <h1 className="heading-medium text-white mb-2">Desglose de Citas</h1>
        <p className="text-white/50">
          Vista general del equipo: citas, leads y facturación por comercial.
        </p>
      </div>

      <AppointmentsBreakdown
        initialAppointments={(appointments as AppointmentWithPeople[]) || []}
        team={(team as CalendarPerson[]) || []}
        currentUser={profile}
      />
    </div>
  )
}
