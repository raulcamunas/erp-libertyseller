import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect, notFound } from 'next/navigation'
import { ClientDetail } from '@/components/clients/ClientDetail'

export default async function ClientDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  const profile = await getUserProfile()

  if (!profile) {
    redirect('/auth/login')
  }

  // Obtener el cliente
  const { data: client, error: clientError } = await supabase
    .from('client_canvas')
    .select('*')
    .eq('id', params.id)
    .single()

  if (clientError || !client) {
    notFound()
  }

  // Obtener las tareas del cliente
  const { data: tasks, error: tasksError } = await supabase
    .from('client_tasks')
    .select('*')
    .eq('client_id', params.id)
    .order('position', { ascending: true })
    .order('created_at', { ascending: false })

  if (tasksError) {
    console.error('Error fetching tasks:', tasksError)
  }

  // Obtener miembros del cliente
  const { data: members, error: membersError } = await supabase
    .from('client_members')
    .select(`
      *,
      profiles:user_id (
        id,
        email,
        full_name
      )
    `)
    .eq('client_id', params.id)

  if (membersError) {
    console.error('Error fetching members:', membersError)
  }

  // Asegurar que el creador esté en los miembros
  let finalMembers = members || []
  const creatorIsMember = finalMembers.some((m: any) => m.user_id === client.created_by)
  
  if (!creatorIsMember && client.created_by) {
    // Obtener perfil del creador
    const { data: creatorProfile } = await supabase
      .from('profiles')
      .select('id, email, full_name')
      .eq('id', client.created_by)
      .single()

    if (creatorProfile) {
      // Verificar si ya existe antes de insertar
      const { data: existingMember } = await supabase
        .from('client_members')
        .select('id')
        .eq('client_id', client.id)
        .eq('user_id', client.created_by)
        .single()

      if (!existingMember) {
        // Añadir el creador como owner si no está
        const { error: addCreatorError } = await supabase
          .from('client_members')
          .insert({
            client_id: client.id,
            user_id: client.created_by,
            role: 'owner',
            added_by: client.created_by,
          })

        if (!addCreatorError) {
          finalMembers = [
            ...finalMembers,
            {
              id: 'temp',
              client_id: client.id,
              user_id: client.created_by,
              role: 'owner',
              profiles: creatorProfile,
            }
          ]
        }
      } else {
        // Si ya existe, añadirlo a la lista de miembros
        finalMembers = [
          ...finalMembers,
          {
            id: existingMember.id,
            client_id: client.id,
            user_id: client.created_by,
            role: 'owner',
            profiles: creatorProfile,
          }
        ]
      }
    }
  }

  // Obtener todos los usuarios del ERP para poder añadirlos
  const { data: allUsers, error: usersError } = await supabase
    .from('profiles')
    .select('id, email, full_name')
    .order('full_name', { ascending: true })

  if (usersError) {
    console.error('Error fetching users:', usersError)
  }

  return (
    <div className="w-full">
      <ClientDetail 
        client={client} 
        initialTasks={tasks || []}
        initialMembers={finalMembers}
        allUsers={allUsers || []}
        currentUserId={user.id}
        currentUserRole={profile.role}
      />
    </div>
  )
}

