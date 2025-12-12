import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect } from 'next/navigation'
import { CommissionsReportsDashboard } from '@/components/commissions/CommissionsReportsDashboard'

export default async function CommissionsReportsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  const profile = await getUserProfile()

  if (!profile) {
    redirect('/auth/login')
  }

  // Cargar reportes
  const { data: reports } = await supabase
    .from('commission_reports')
    .select(`
      *,
      clients:clients(name)
    `)
    .order('created_at', { ascending: false })

  // Cargar clientes para el filtro
  const { data: clients } = await supabase
    .from('clients')
    .select('*')
    .order('name', { ascending: true })

  return (
    <div>
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="heading-medium text-white mb-2">
              Reportes de Comisiones
            </h1>
            <p className="text-white/50">
              Gestiona y comparte tus reportes de comisiones guardados
            </p>
          </div>
          <a
            href="/dashboard/commissions"
            className="btn-glass"
          >
            Nueva Calculación
          </a>
        </div>
      </div>
      <CommissionsReportsDashboard 
        reports={reports || []} 
        clients={clients || []}
      />
    </div>
  )
}

