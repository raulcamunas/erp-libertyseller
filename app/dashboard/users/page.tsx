import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect } from 'next/navigation'
import { UsersManagement } from '@/components/users/UsersManagement'
import { puedeGestionarUsuarios } from '@/lib/usuarios/gestion'

export default async function UsersPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  const profile = await getUserProfile()

  // El mismo criterio que middleware.ts y las rutas de /api/users: administrador pleno (no CEO) con el correo del dueño
  if (!puedeGestionarUsuarios(profile)) {
    redirect('/dashboard')
  }

  return <UsersManagement actorId={user.id} />
}
