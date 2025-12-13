import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect, notFound } from 'next/navigation'
import { KPICard } from '@/components/ppc/KPICard'
import { PerformanceChart } from '@/components/ppc/PerformanceChart'
import { TopProductsTable } from '@/components/ppc/TopProductsTable'
import { EmptyState } from '@/components/ppc/EmptyState'

export default async function MarketingClientDashboardPage({
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

  // Obtener datos del cliente
  const { data: client, error: clientError } = await supabase
    .from('ppc_clients')
    .select('*')
    .eq('id', params.clientId)
    .single()

  if (clientError || !client) {
    notFound()
  }

  // Obtener snapshots semanales (últimas 12 semanas para el gráfico)
  const { data: snapshots, error: snapshotsError } = await supabase
    .from('ppc_weekly_snapshots')
    .select('*')
    .eq('client_id', params.clientId)
    .order('week_start_date', { ascending: false })
    .limit(12)

  if (snapshotsError) {
    console.error('Error fetching snapshots:', snapshotsError)
  }

  const sortedSnapshots = (snapshots || []).sort((a, b) => 
    new Date(a.week_start_date).getTime() - new Date(b.week_start_date).getTime()
  )

  const latestSnapshot = sortedSnapshots[sortedSnapshots.length - 1]
  const previousSnapshot = sortedSnapshots[sortedSnapshots.length - 2]

  // Calcular ROAS
  const currentROAS = latestSnapshot && latestSnapshot.total_spend > 0
    ? (latestSnapshot.total_sales / latestSnapshot.total_spend)
    : 0
  const previousROAS = previousSnapshot && previousSnapshot.total_spend > 0
    ? (previousSnapshot.total_sales / previousSnapshot.total_spend)
    : 0

  // Si no hay datos, mostrar empty state
  if (!latestSnapshot || sortedSnapshots.length === 0) {
    return (
      <div>
        <div className="mb-8">
          <h1 className="heading-medium text-white mb-2">
            Dashboard General
          </h1>
          <p className="text-white/50">
            Vista general del rendimiento de {client.name}
          </p>
        </div>
        <EmptyState clientId={params.clientId} />
      </div>
    )
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="heading-medium text-white mb-2">
          Dashboard General
        </h1>
        <p className="text-white/50">
          Vista general del rendimiento de {client.name}
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <KPICard
          title="Gasto Total"
          value={latestSnapshot.total_spend.toLocaleString('es-ES', {
            style: 'currency',
            currency: client.currency,
          })}
          previousValue={previousSnapshot?.total_spend}
          currentValue={latestSnapshot.total_spend}
          currency={client.currency}
        />
        <KPICard
          title="Ventas Totales"
          value={latestSnapshot.total_sales.toLocaleString('es-ES', {
            style: 'currency',
            currency: client.currency,
          })}
          previousValue={previousSnapshot?.total_sales}
          currentValue={latestSnapshot.total_sales}
          currency={client.currency}
        />
        <KPICard
          title="ACOS Global"
          value={`${latestSnapshot.global_acos.toFixed(2)}%`}
          previousValue={previousSnapshot?.global_acos}
          currentValue={latestSnapshot.global_acos}
          isPercentage={true}
        />
        <KPICard
          title="ROAS"
          value={currentROAS.toFixed(2)}
          previousValue={previousROAS}
          currentValue={currentROAS}
        />
      </div>

      {/* Gráfico de Rendimiento */}
      <div className="mb-8">
        <PerformanceChart data={sortedSnapshots} currency={client.currency} />
      </div>

      {/* Tabla de Top Productos */}
      <TopProductsTable snapshot={latestSnapshot} currency={client.currency} />
    </div>
  )
}

