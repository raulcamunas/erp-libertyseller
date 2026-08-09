import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { fetchAllTolerante } from '@/lib/supabase/paginacion'
import { redirect } from 'next/navigation'
import { HoursTracker, QualifiedAppointment } from '@/components/payroll/HoursTracker'
import { WorkHourEntry, PayrollRate, ManualAppointment } from '@/lib/types/payroll'
import { CalendarPerson } from '@/lib/types/appointments'

export default async function HoursPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const profile = await getUserProfile()
  if (!profile) redirect('/auth/login')

  const isAdmin = profile.role === 'admin' || profile.role === 'partner'

  // LAS CINCO CONSULTAS VAN EN PARALELO, NO EN CADENA.
  //
  // Antes se hacía un `await` detrás de otro aunque ninguna dependa de las
  // demás: son cinco GET independientes a URLs distintas de PostgREST, sin
  // estado compartido. Medido contra la base real, tres rondas con la conexión
  // caliente: 73 + 56 + 67 + 69 + 114 = 380 ms en serie, frente a 73 ms con
  // Promise.all — el coste pasa a ser el de la consulta más lenta, no la suma.
  // No cambia el orden de ninguna lista ni lo que se pinta: cada `{ data }` se
  // asigna a lo mismo que antes, y como supabase-js no lanza sino que devuelve
  // `{ error }`, Promise.all tampoco altera el manejo de errores.
  const [hours, rates, team, qualified, manual] = await Promise.all([
    // PAGINADO: PostgREST corta a 1000 filas SIN dar error. work_hours tiene
    // hoy 179 filas y crece a ~1,2 al día, así que cruza el millar en unos dos
    // años; el día que lo cruce, el `.order('work_date')` ascendente se queda
    // con las MIL MÁS ANTIGUAS y tira justo las del periodo que hay que pagar,
    // y «Mis Horas» enseñaría 0 h sin dar ningún error. El desempate por `id`
    // no es adorno: work_date tiene empates a punta pala —varias personas
    // apuntan el mismo día— y paginar sobre un orden con empates se salta y
    // repite filas, que sería peor que el problema. Hoy devuelve las mismas 179.
    fetchAllTolerante<WorkHourEntry>('work_hours', (desde, hasta) =>
      supabase
        .from('work_hours')
        .select('*')
        // Las políticas RLS ya limitan cada uno a sus propias horas; los admins
        // reciben las de todo el equipo con la misma consulta.
        .order('work_date', { ascending: true })
        .order('id', { ascending: true })
        .range(desde, hasta)
    ),
    // Estas dos NO se paginan y es deliberado. Son tablas acotadas por el
    // tamaño de la plantilla (hoy 9 y 11 filas) que no van a acercarse al
    // millar, y añadirles el `.order('id')` que la paginación exige SÍ cambia
    // el orden en que vuelven —comprobado contra la base real: con `id` de
    // desempate payroll_rates devuelve las 9 filas en distinto orden que hoy—.
    // `resolveRate` elige sobre esa lista, así que sería un cambio visible a
    // cambio de proteger de un corte que no puede llegar. Se quedan igual.
    supabase.from('payroll_rates').select('*'),
    supabase
      .from('profiles')
      .select('id, full_name, email, role, calendar_color')
      .eq('is_comercial', true)
      .order('full_name', { ascending: true }),
    // Solo hace falta lo justo para contar comisiones y listarlas.
    // `appointments` ya tiene 5853 filas, así que aquí el corte de 1000 no es
    // hipotético: hoy el filtro deja 3 citas cualificadas, pero cada una es una
    // comisión que se paga y las que cayeran fuera no se contarían.
    fetchAllTolerante<QualifiedAppointment>('appointments cualificadas', (desde, hasta) => {
      const q = supabase
        .from('appointments')
        .select('id, comercial_id, start_time, lead_name, lead_company')
        .eq('status', 'qualified')
        .eq('is_external', false)
      return (isAdmin ? q : q.eq('comercial_id', user.id))
        .order('id', { ascending: true })
        .range(desde, hasta)
    }),
    // Citas añadidas a mano por un admin: RLS ya limita a cada comercial las
    // suyas. Tampoco se pagina, por lo mismo: 9 filas que se dan de alta a
    // mano una a una, y el desempate por `id` cambiaría el orden de dos citas
    // manuales de la misma fecha (HoursTracker las ordena por hora y el sort
    // de JS es estable, así que el orden de entrada se nota en los empates).
    supabase.from('payroll_manual_appointments').select('*'),
  ])

  return (
    <div className="flex flex-col h-[calc(100dvh-8rem)] lg:h-[calc(100vh-4rem)]">
      <div className="mb-3 flex-shrink-0">
        <h1 className="heading-medium text-white mb-1">Mis Horas</h1>
        <p className="text-white/50 text-sm">
          Apunta cada día lo que trabajas y mira en vivo lo que llevas ganado en
          este periodo.
        </p>
      </div>

      <HoursTracker
        initialHours={hours}
        initialRates={(rates.data as PayrollRate[]) || []}
        qualifiedAppointments={qualified}
        initialManual={(manual.data as ManualAppointment[]) || []}
        team={(team.data as CalendarPerson[]) || []}
        currentUser={profile}
        isAdmin={isAdmin}
      />
    </div>
  )
}
