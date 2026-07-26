import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect } from 'next/navigation'
import { AgendaCalendar } from '@/components/agenda/AgendaCalendar'
import { AppointmentWithPeople, CalendarPerson } from '@/lib/types/appointments'

export default async function AgendaPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const profile = await getUserProfile()
  if (!profile) redirect('/auth/login')

  // Comerciales (Yamila, Alejandro, José, Maoli) para leyenda y asignación
  const { data: team } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, calendar_color')
    .eq('is_comercial', true)
    .order('full_name', { ascending: true })

  // Citas con la persona que las agendó y el closer asignado
  const { data: appointments } = await supabase
    .from('appointments')
    .select(`
      *,
      comercial:profiles!appointments_comercial_id_fkey(id, full_name, email, role, calendar_color),
      assigned_closer:profiles!appointments_assigned_closer_id_fkey(id, full_name, email, role, calendar_color)
    `)
    .order('start_time', { ascending: true })

  return (
    <div className="space-y-6">
      <div className="mb-2">
        <h1 className="heading-medium text-white mb-2">Agenda Comercial</h1>
      </div>

      <AgendaCalendar
        initialAppointments={(appointments as AppointmentWithPeople[]) || []}
        team={(team as CalendarPerson[]) || []}
        currentUser={profile}
      />
    </div>
  )
}
