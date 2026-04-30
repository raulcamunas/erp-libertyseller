import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect } from 'next/navigation'
import { ShoesFReportsDashboard } from '@/components/commissions/ShoesFReportsDashboard'

export default async function ShoesFReportsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  const profile = await getUserProfile()

  if (!profile) {
    redirect('/auth/login')
  }

  const { data: shoesClient } = await supabase
    .from('clients')
    .select('*')
    .eq('name', 'ShoesF')
    .maybeSingle()

  if (!shoesClient) {
    return (
      <div>
        <div className="mb-8">
          <h1 className="heading-medium text-white mb-2">Historial Shoes F</h1>
          <p className="text-white/50">No existe el cliente "ShoesF" en la tabla clients.</p>
        </div>
      </div>
    )
  }

  const { data: reports } = await supabase
    .from('commission_reports')
    .select(`
      *,
      clients:clients(name)
    `)
    .eq('client_id', shoesClient.id)
    .order('created_at', { ascending: false })

  return (
    <div>
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="heading-medium text-white mb-2">Historial Shoes F</h1>
            <p className="text-white/50">Reportes guardados de comparaciones y cálculos personalizados</p>
          </div>
          <a href="/dashboard/commissions-shoes-f" className="btn-glass">
            Nueva Comparación
          </a>
        </div>
      </div>
      <ShoesFReportsDashboard reports={reports || []} />
    </div>
  )
}
