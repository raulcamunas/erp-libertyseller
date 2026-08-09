import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect } from 'next/navigation'
import { AgendaCalendar } from '@/components/agenda/AgendaCalendar'
import { AppointmentWithPeople, CalendarPerson, COLUMNAS_AGENDA } from '@/lib/types/appointments'
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
      // Columnas explícitas en vez de `*`: la transcripción completa de una
      // llamada son decenas de miles de caracteres, y venían todas en la
      // carga inicial de la página aunque no se lean nunca. El resumen sí
      // se queda, que es corto y se enseña en la ficha; el texto largo se
      // pide solo al desplegarlo.
      //
      // Y POR EL MISMO MOTIVO YA NO SE PIDEN cinco columnas de fontanería de
      // la sincronización con Google —google_html_link, google_calendar_id,
      // last_synced_at, sync_error y updated_source—: las escribe
      // lib/appointments-sync.ts y no las lee NINGUNA pantalla (cero usos en
      // components/ y app/dashboard/). Medido contra la base real con las
      // 5853 citas de hoy:
      //
      //   con las cinco:  6566 kB sin comprimir / 342 kB gzip / 1511 ms
      //   sin las cinco:  4847 kB sin comprimir / 266 kB gzip /  857 ms
      //
      // `google_meet_link` SÍ SE QUEDA y no debe quitarse aunque lo parezca:
      // se pinta en AgendaCalendar.tsx:1005, AppointmentSheet.tsx:379 y
      // AppointmentConfirmation.tsx:183. Quitarla borraría el enlace de Meet
      // de la agenda, que es un cambio visible.
      //
      // La lista vive en COLUMNAS_AGENDA (lib/types/appointments.ts) porque el
      // botón «Resincronizar» de AgendaCalendar recarga esta misma tabla y
      // tenía su propio `select('*')`, que deshacía el recorte en cuanto
      // alguien lo pulsaba. Con una sola lista no se pueden volver a separar.
      .select(COLUMNAS_AGENDA)
      .order('start_time', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + CHUNK - 1)

    if (error) {
      console.error('Error cargando la agenda:', error)
      break
    }
    if (!data || data.length === 0) break
    appointments.push(...(data as unknown as AppointmentWithPeople[]))
    if (data.length < CHUNK) break
  }

  const { data: availabilityWindows } = await supabase
    .from('availability_windows')
    .select('*')

  return (
    <div className="flex flex-col h-[calc(100dvh-8rem)] lg:h-[calc(100vh-4rem)]">
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
