import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect } from 'next/navigation'
import { AgendaCalendar } from '@/components/agenda/AgendaCalendar'
import { citasEntre } from '@/lib/agenda/consulta'
import { claveDeSemana, limitesDeSemanas, lunesDeLaSemana, semanasAlrededor } from '@/lib/agenda/semanas'
import type { CalendarPerson } from '@/lib/types/appointments'
import type { AvailabilityWindow } from '@/lib/types/availability'

/**
 * LA AGENDA ABRE CON TRES SEMANAS, NO CON TODA LA TABLA.
 *
 * Esta página se bajaba cada vez las 5.939 citas de `appointments` en tramos de mil, UNO DETRÁS DE OTRO (6 peticiones seguidas, 5,9 MB hacia el navegador), y solo después
 * pintaba una semana. Medido contra producción el 27 oct 2026: 1,7–2,7 s de espera con la pantalla quieta. De las 5.939 filas, 5.889 son huecos de Google repetidos hasta
 * el año 2054 y 50 son citas del ERP.
 *
 * Ahora trae la semana de hoy y las dos de al lado (24 filas, 32 kB, una petición de ~0,15 s), TODO A LA VEZ con el perfil, el equipo y las franjas de disponibilidad —
 * antes cada una esperaba a la anterior —, y el navegador pide el resto de semanas al moverse por ellas (components/agenda/useCitas.ts). Las flechas no esperan: la semana de
 * después ya se está pidiendo antes de pulsarlas.
 *
 * Si la lectura falla, la página NO se queda en blanco ni enseña media semana: sale sin citas y marca esas semanas como «sin cargar», así que el navegador las pide solo.
 */
export default async function AgendaPage() {
  const supabase = await createClient()

  const semanas = semanasAlrededor(lunesDeLaSemana(new Date()), 1, 1)
  const { desde } = limitesDeSemanas(semanas[0])
  const { hasta } = limitesDeSemanas(semanas[semanas.length - 1])

  const [profile, equipo, franjas, citas] = await Promise.all([
    getUserProfile(),
    // Comerciales para la leyenda y la asignación
    supabase.from('profiles').select('id, full_name, email, role, calendar_color').eq('is_comercial', true).order('full_name', { ascending: true }),
    supabase.from('availability_windows').select('*'),
    citasEntre(supabase, desde, hasta),
  ])
  if (!profile) redirect('/auth/login')

  if (citas.error) console.error('Error cargando la agenda:', citas.error)

  return (
    <div className="flex h-[calc(100dvh-8rem)] flex-col lg:h-[calc(100vh-4rem)]">
      <div className="min-h-0 flex-1">
        <AgendaCalendar
          initialAppointments={citas.citas}
          semanasIniciales={citas.error ? [] : semanas.map(claveDeSemana)}
          semanaInicial={claveDeSemana(semanas[1])}
          team={(equipo.data as CalendarPerson[]) || []}
          currentUser={profile}
          initialAvailabilityWindows={(franjas.data as AvailabilityWindow[]) || []}
        />
      </div>
    </div>
  )
}
