import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect, notFound } from 'next/navigation'

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

      {snapshots && snapshots.length > 0 ? (
        <div className="space-y-4">
          {snapshots.map((snapshot) => (
            <div key={snapshot.id} className="glass-card p-6 rounded-xl">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white">
                  Semana del {new Date(snapshot.week_start_date).toLocaleDateString('es-ES', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </h3>
                <span className="text-sm text-white/50">
                  ACOS: {snapshot.global_acos.toFixed(2)}%
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-white/50 mb-1">Gasto Total</p>
                  <p className="text-xl font-semibold text-white">
                    {snapshot.total_spend.toLocaleString('es-ES', {
                      style: 'currency',
                      currency: client.currency,
                    })}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-white/50 mb-1">Ventas Totales</p>
                  <p className="text-xl font-semibold text-white">
                    {snapshot.total_sales.toLocaleString('es-ES', {
                      style: 'currency',
                      currency: client.currency,
                    })}
                  </p>
                </div>
              </div>
              {snapshot.ai_summary && (
                <div className="mt-4 pt-4 border-t border-white/10">
                  <p className="text-sm text-white/70">{snapshot.ai_summary}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="glass-card p-12 text-center">
          <p className="text-white/60">
            No hay datos históricos disponibles aún
          </p>
        </div>
      )}
    </div>
  )
}

