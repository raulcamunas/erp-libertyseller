import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect } from 'next/navigation'
import { ClientsCRM } from '@/components/crm/ClientsCRM'
import { CrmClientWithDetails } from '@/lib/types/crm'
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

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)] lg:h-[calc(100vh-4rem)]">
      <div className="mb-3 flex-shrink-0">
        <h1 className="heading-medium text-white mb-1">CRM de Clientes</h1>
        <p className="text-white/50 text-sm">
          Todos los leads con cita cualificada, su estado y todo lo que hemos
          hablado con ellos.
        </p>
      </div>

      <div className="flex-1 min-h-0">
        <ClientsCRM
          initialClients={(clients as CrmClientWithDetails[]) || []}
          team={(team as CalendarPerson[]) || []}
          currentUser={profile}
        />
      </div>
    </div>
  )
}
