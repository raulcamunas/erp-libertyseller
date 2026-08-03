import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
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

  const { data: clients } = await supabase
    .from('crm_clients')
    .select(`
      *,
      appointment:appointments!crm_clients_appointment_id_fkey(
        *,
        comercial:profiles!appointments_comercial_id_fkey(id, full_name, email, role, calendar_color),
        assigned_closer:profiles!appointments_assigned_closer_id_fkey(id, full_name, email, role, calendar_color)
      )
    `)
    .order('created_at', { ascending: false })

  const { data: team } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, calendar_color')
    .eq('is_comercial', true)
    .order('full_name', { ascending: true })

  // Lo necesario para calcular lo que cuesta el equipo comercial este mes
  const { data: workHours } = await supabase.from('work_hours').select('*')
  const { data: payrollRates } = await supabase.from('payroll_rates').select('*')
  const { data: qualified } = await supabase
    .from('appointments')
    .select('id, comercial_id, start_time')
    .eq('status', 'qualified')
    .eq('is_external', false)

  const { data: fxSetting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'usd_eur_rate')
    .maybeSingle()

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
            Todos los leads con cita cualificada, su estado y todo lo que hemos
            hablado con ellos.
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
          qualifiedAppointments={(qualified as CrmQualifiedAppointment[]) || []}
          initialUsdEurRate={Number(fxSetting?.value ?? 0.92)}
        />
      </div>
    </div>
  )
}
