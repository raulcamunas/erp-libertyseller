import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect, notFound } from 'next/navigation'
import { HistoryListClient } from '@/components/ppc/HistoryListClient'

export default async function HistoryPage({
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

  // Obtener todos los snapshots
  const { data: snapshots, error: snapshotsError } = await supabase
    .from('ppc_weekly_snapshots')
    .select('*')
    .eq('client_id', params.clientId)
    .order('week_start_date', { ascending: false })

  if (snapshotsError) {
    console.error('Error fetching snapshots:', snapshotsError)
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="heading-medium text-white mb-2">
          Histórico
        </h1>
        <p className="text-white/50">
          Histórico de rendimiento semanal para {client.name}
        </p>
      </div>

      <HistoryListClient 
        snapshots={snapshots || []} 
        currency={client.currency}
        clientId={params.clientId}
      />
    </div>
  )
}


