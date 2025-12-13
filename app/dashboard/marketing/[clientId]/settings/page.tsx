import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect, notFound } from 'next/navigation'

export default async function SettingsPage({
  params,
}: {
  params: { clientId: string }
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

  // Verificar que el cliente existe
  const { data: client, error } = await supabase
    .from('ppc_clients')
    .select('*')
    .eq('id', params.clientId)
    .single()

  if (error || !client) {
    notFound()
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="heading-medium text-white mb-2">
          Configuración
        </h1>
        <p className="text-white/50">
          Configuración del cliente {client.name}
        </p>
      </div>

      <div className="glass-card p-12 text-center">
        <p className="text-white/60">
          Módulo de configuración en desarrollo
        </p>
      </div>
    </div>
  )
}

