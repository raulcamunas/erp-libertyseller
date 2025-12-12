import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect } from 'next/navigation'
import { CommissionsCalculator } from '@/components/commissions/CommissionsCalculator'

export default async function CommissionsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  const profile = await getUserProfile()

  if (!profile) {
    redirect('/auth/login')
  }

  // Cargar clientes
  const { data: clients } = await supabase
    .from('clients')
    .select('*')
    .order('name', { ascending: true })

  return (
    <div>
      <div className="mb-8">
        <h1 className="heading-medium text-white mb-2">
          Calculadora de Comisiones
        </h1>
        <p className="text-white/50">
          Procesa CSVs de Amazon/Sellerboard y calcula liquidaciones exactas
        </p>
      </div>
      <CommissionsCalculator clients={clients || []} />
    </div>
  )
}

