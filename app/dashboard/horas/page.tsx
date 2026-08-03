import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
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

  // Las políticas RLS ya limitan cada uno a sus propias horas; los admins
  // reciben las de todo el equipo con la misma consulta.
  const { data: hours } = await supabase
    .from('work_hours')
    .select('*')
    .order('work_date', { ascending: true })

  const { data: rates } = await supabase.from('payroll_rates').select('*')

  const { data: team } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, calendar_color')
    .eq('is_comercial', true)
    .order('full_name', { ascending: true })

  // Solo hace falta lo justo para contar comisiones y listarlas.
  let qualifiedQuery = supabase
    .from('appointments')
    .select('id, comercial_id, start_time, lead_name, lead_company')
    .eq('status', 'qualified')
    .eq('is_external', false)

  if (!isAdmin) {
    qualifiedQuery = qualifiedQuery.eq('comercial_id', user.id)
  }

  const { data: qualified } = await qualifiedQuery

  // Citas añadidas a mano por un admin: RLS ya limita a cada comercial
  // las suyas.
  const { data: manual } = await supabase
    .from('payroll_manual_appointments')
    .select('*')

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)] lg:h-[calc(100vh-4rem)]">
      <div className="mb-3 flex-shrink-0">
        <h1 className="heading-medium text-white mb-1">Mis Horas</h1>
        <p className="text-white/50 text-sm">
          Apunta cada día lo que trabajas y mira en vivo lo que llevas ganado en
          este periodo.
        </p>
      </div>

      <HoursTracker
        initialHours={(hours as WorkHourEntry[]) || []}
        initialRates={(rates as PayrollRate[]) || []}
        qualifiedAppointments={(qualified as QualifiedAppointment[]) || []}
        initialManual={(manual as ManualAppointment[]) || []}
        team={(team as CalendarPerson[]) || []}
        currentUser={profile}
        isAdmin={isAdmin}
      />
    </div>
  )
}
