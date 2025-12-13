import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect } from 'next/navigation'
import { UsersManagement } from '@/components/users/UsersManagement'

export default async function UsersPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  const profile = await getUserProfile()

  // Solo el admin puede acceder (raulcamunas369@gmail.com)
  if (!profile || profile.role !== 'admin' || profile.email !== 'raulcamunas369@gmail.com') {
    redirect('/dashboard')
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="heading-medium text-white mb-2">
          Gestión de Usuarios
        </h1>
        <p className="text-white/50">
          Crea y gestiona usuarios del sistema con permisos específicos
        </p>
      </div>

      <UsersManagement />
    </div>
  )
}

