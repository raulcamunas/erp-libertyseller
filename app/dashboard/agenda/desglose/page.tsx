import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect } from 'next/navigation'
import { AppointmentsBreakdown } from '@/components/agenda/AppointmentsBreakdown'
import { AppointmentWithPeople, CalendarPerson } from '@/lib/types/appointments'

// Únicos con visión de todo el equipo en este desglose. El resto de
// comerciales solo ven sus propios leads.
const FULL_ACCESS_EMAILS = ['raulcamunas369@gmail.com', 'mariocstanca@gmail.com']

export default async function AgendaBreakdownPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const profile = await getUserProfile()
  if (!profile) redirect('/auth/login')

  const hasFullAccess = FULL_ACCESS_EMAILS.includes(profile.email || '')

  const { data: team } = hasFullAccess
    ? await supabase
        .from('profiles')
        .select('id, full_name, email, role, calendar_color')
        .eq('is_comercial', true)
        .order('full_name', { ascending: true })
    : await supabase
        .from('profiles')
        .select('id, full_name, email, role, calendar_color')
        .eq('id', user.id)

  // Solo citas gestionadas por el ERP (se excluyen los "Hueco no disponible").
  // Si no tiene acceso total, se filtra en el propio query a sus propias
  // citas: no basta con ocultarlo en el cliente.
  let query = supabase
    .from('appointments')
    .select(`
      *,
      comercial:profiles!appointments_comercial_id_fkey(id, full_name, email, role, calendar_color),
      assigned_closer:profiles!appointments_assigned_closer_id_fkey(id, full_name, email, role, calendar_color)
    `)
    .eq('is_external', false)
    .order('start_time', { ascending: true })

  if (!hasFullAccess) {
    query = query.eq('comercial_id', user.id)
  }

  const { data: appointments } = await query

  return (
    <div className="space-y-6">
      <div className="mb-2">
        <h1 className="heading-medium text-white mb-2">Desglose de Citas</h1>
        <p className="text-white/50">
          {hasFullAccess
            ? 'Vista general del equipo: citas y leads por comercial.'
            : 'Tus citas y leads.'}
        </p>
      </div>

      <AppointmentsBreakdown
        initialAppointments={(appointments as AppointmentWithPeople[]) || []}
        team={(team as CalendarPerson[]) || []}
        currentUser={profile}
        restrictToOwn={!hasFullAccess}
      />
    </div>
  )
}
