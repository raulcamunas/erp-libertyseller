import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect } from 'next/navigation'
import { FinanceDashboard } from '@/components/finances/FinanceDashboard'

export default async function FinancesPage() {
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
    <div>
      <div className="mb-8">
        <h1 className="heading-medium text-white mb-2">
          Control Financiero
        </h1>
        <p className="text-white/50">
          Gestiona tus ingresos, gastos y contabilidad mensual
        </p>
      </div>
      <FinanceDashboard />
    </div>
  )
}

