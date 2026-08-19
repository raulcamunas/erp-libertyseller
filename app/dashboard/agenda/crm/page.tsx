import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { fetchAllTolerante } from '@/lib/supabase/paginacion'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { ClientsCRM, CrmQualifiedAppointment } from '@/components/crm/ClientsCRM'
import { CrmClientWithDetails } from '@/lib/types/crm'
import { WorkHourEntry, PayrollRate } from '@/lib/types/payroll'
import { CalendarPerson } from '@/lib/types/appointments'

export default async function CrmClientsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const profile = await getUserProfile()
  if (!profile) redirect('/auth/login')

  // El CRM es vista de dirección: presupuestos, propuestas y contratos.
  // Las políticas RLS ya lo blindan, esto es solo para no enseñar una
  // pantalla vacía a quien no le corresponde.
  const isAdmin = profile.role === 'admin' || profile.role === 'partner'
  if (!isAdmin) redirect('/dashboard/agenda')

  // LAS SEIS CONSULTAS VAN EN PARALELO, NO EN CADENA.
  //
  // Antes se hacía un `await` detrás de otro aunque ninguna dependa de las
  // demás: son seis GET independientes a URLs distintas de PostgREST, sin
  // estado compartido entre ellas. Medido contra la base real (tres rondas con
  // la conexión ya caliente):
  //
  //   en serie:    524 ms
  //   Promise.all: 121 ms      -> 403 ms menos, y la página es la más larga
  //                               de todo el ERP en número de consultas
  //
  // NO CAMBIA NADA DE LO QUE SE VE: cada `{ data }` se asigna exactamente a lo
  // mismo que antes, en el mismo orden, con los mismos filtros y el mismo
  // `.order()`. Y como supabase-js no lanza cuando una consulta falla —devuelve
  // `{ error }`— Promise.all tampoco altera el manejo de errores: ninguna de
  // estas seis puede rechazar la promesa.
  const [clientsRes, teamRes, workHoursRes, payrollRatesRes, qualified, fxRes] =
    await Promise.all([
      supabase
        .from('crm_clients')
        .select(`
          *,
          appointment:appointments!crm_clients_appointment_id_fkey(
            *,
            comercial:profiles!appointments_comercial_id_fkey(id, full_name, email, role, calendar_color),
            assigned_closer:profiles!appointments_assigned_closer_id_fkey(id, full_name, email, role, calendar_color)
          )
        `)
        .order('created_at', { ascending: false }),
      supabase
        .from('profiles')
        .select('id, full_name, email, role, calendar_color')
        .eq('is_comercial', true)
        .order('full_name', { ascending: true }),
      // Lo necesario para calcular lo que cuesta el equipo comercial este mes
      supabase.from('work_hours').select('*'),
      supabase.from('payroll_rates').select('*'),
      // PAGINADA, igual que la misma consulta en app/dashboard/horas/page.tsx:
      // PostgREST corta a 1000 filas y NO da error. Hoy el filtro deja 3 citas
      // de las 5853 de la tabla, así que devuelve exactamente lo mismo; pero
      // con esta lista se calcula lo que cuesta el equipo comercial, y una cita
      // cualificada que cayera fuera del corte dejaría de contar en silencio.
      // El `.order('id')` es el desempate que exige paginar; no se nota porque
      // esta lista se agrupa y se cuenta, no se enseña en este orden.
      fetchAllTolerante<CrmQualifiedAppointment>('appointments cualificadas (crm)', (desde, hasta) =>
        supabase
          .from('appointments')
          .select('id, comercial_id, start_time')
          .eq('status', 'qualified')
          .eq('is_external', false)
          .order('id', { ascending: true })
          .range(desde, hasta)
      ),
      supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'usd_eur_rate')
        .maybeSingle(),
    ])

  const clients = clientsRes.data
  const team = teamRes.data
  const workHours = workHoursRes.data
  const payrollRates = payrollRatesRes.data
  const fxSetting = fxRes.data

  return (
    <div className="flex flex-col h-[calc(100dvh-8rem)] lg:h-[calc(100vh-4rem)]">
      <div className="mb-3 flex-shrink-0 flex items-start gap-3">
        <Link
          href="/dashboard/agenda"
          className="mt-1 h-9 w-9 flex-shrink-0 flex items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-white/60 hover:text-white hover:bg-white/[0.06] hover:border-white/20 transition-colors"
          title="Volver al calendario"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="heading-medium text-white mb-1">CRM de Clientes</h1>
          <p className="hidden sm:block text-white/50 text-sm">
            Todos los leads, estén o no cualificados: su estado, lo que hemos
            hablado con ellos y las respuestas de la reunión.
          </p>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <ClientsCRM
          initialClients={(clients as CrmClientWithDetails[]) || []}
          team={(team as CalendarPerson[]) || []}
          currentUser={profile}
          workHours={(workHours as WorkHourEntry[]) || []}
          payrollRates={(payrollRates as PayrollRate[]) || []}
          qualifiedAppointments={qualified}
          initialUsdEurRate={Number(fxSetting?.value ?? 0.92)}
        />
      </div>
    </div>
  )
}
