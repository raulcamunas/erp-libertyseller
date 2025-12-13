import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect } from 'next/navigation'
import { AddClientForm } from '@/components/ppc/AddClientForm'

export default async function NewClientPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  const profile = await getUserProfile()

  if (!profile) {
    redirect('/auth/login')
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="heading-medium text-white mb-2">
          Añadir Nuevo Cliente PPC
        </h1>
        <p className="text-white/50">
          Crea un nuevo cliente para gestionar sus campañas PPC
        </p>
      </div>

      <AddClientForm />
    </div>
  )
}

