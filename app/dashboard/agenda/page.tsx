import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect } from 'next/navigation'
import { AgendaCalendar } from '@/components/agenda/AgendaCalendar'
import { AppointmentWithPeople, CalendarPerson } from '@/lib/types/appointments'
import { AvailabilityWindow } from '@/lib/types/availability'

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

  // Citas con la persona que las agendó y el closer asignado.
  //
  // Por tramos: Supabase corta toda consulta a 1.000 filas y un .limit()
  // mayor no lo salta, porque el tope lo aplica el servidor. Los huecos
  // importados de Google se acumulan solos — cada reunión semanal son unas
  // 50 filas al año — así que sin esto la agenda empezaría a perder citas
  // en silencio en cuanto se pasara del millar.
  const CHUNK = 1000
  const appointments: AppointmentWithPeople[] = []
  for (let from = 0; ; from += CHUNK) {
    const { data, error } = await supabase
      .from('appointments')
      .select(`
        *,
        comercial:profiles!appointments_comercial_id_fkey(id, full_name, email, role, calendar_color),
        assigned_closer:profiles!appointments_assigned_closer_id_fkey(id, full_name, email, role, calendar_color)
      `)
      .order('start_time', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + CHUNK - 1)

    if (error) {
      console.error('Error cargando la agenda:', error)
      break
    }
    if (!data || data.length === 0) break
    appointments.push(...(data as AppointmentWithPeople[]))
    if (data.length < CHUNK) break
  }

  const { data: availabilityWindows } = await supabase
    .from('availability_windows')
    .select('*')

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)] lg:h-[calc(100vh-4rem)]">
      <div className="mb-4 flex-shrink-0">
        <h1 className="heading-medium text-white mb-2">Agenda Comercial</h1>
      </div>

      <div className="flex-1 min-h-0">
        <AgendaCalendar
          initialAppointments={appointments}
          team={(team as CalendarPerson[]) || []}
          currentUser={profile}
          initialAvailabilityWindows={(availabilityWindows as AvailabilityWindow[]) || []}
        />
      </div>
    </div>
  )
}
