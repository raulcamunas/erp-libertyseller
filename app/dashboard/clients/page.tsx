import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect } from 'next/navigation'
import { ClientsDashboard } from '@/components/clients/ClientsDashboard'

export default async function ClientsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  const profile = await getUserProfile()

  if (!profile) {
    redirect('/auth/login')
  }

  // Obtener clientes donde el usuario es miembro o creador
  // Primero obtenemos los clientes donde es miembro
  const { data: memberClients, error: memberError } = await supabase
    .from('client_members')
    .select('client_id, client_canvas:client_id (*)')
    .eq('user_id', user.id)

  // Luego obtenemos los clientes que creó
  const { data: createdClients, error: createdError } = await supabase
    .from('client_canvas')
    .select('*')
    .eq('created_by', user.id)

  if (memberError || createdError) {
    console.error('Error fetching clients:', memberError || createdError)
  }

  // Combinar y deduplicar clientes
  const memberClientIds = new Set((memberClients || []).map((m: any) => m.client_id))
  const createdClientIds = new Set((createdClients || []).map((c: any) => c.id))
  const allClientIds = new Set([...memberClientIds, ...createdClientIds])

  // Obtener todos los clientes únicos
  const clientIdsArray = Array.from(allClientIds)
  let clients: any[] = []

  if (clientIdsArray.length > 0) {
    const { data: allClients, error: clientsError } = await supabase
      .from('client_canvas')
      .select('*')
      .in('id', clientIdsArray)
      .order('created_at', { ascending: false })

    if (clientsError) {
      console.error('Error fetching clients:', clientsError)
    } else {
      clients = allClients || []
    }
  }

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="heading-medium text-white mb-2">
          Canvas Clientes
        </h1>
        <p className="text-white/50">
          Gestiona tus clientes y sus tareas de forma organizada
        </p>
      </div>

      <ClientsDashboard initialClients={clients || []} currentUserRole={profile.role} />
    </div>
  )
}

