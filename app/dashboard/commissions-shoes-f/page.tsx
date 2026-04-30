import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect } from 'next/navigation'
import { ShoesFCommissionsCalculator } from '@/components/commissions/ShoesFCommissionsCalculator'

export default async function CommissionsShoesFPage() {
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
          <h1 className="heading-medium text-white mb-2">Calculadora de comisiones Shoes F</h1>
          <p className="text-white/50">No existe el cliente "ShoesF" en la tabla clients.</p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="heading-medium text-white mb-2">Calculadora de comisiones Shoes F</h1>
        <p className="text-white/50">
          Comparación entre años + % manual + desglose por país (Jurisdiction Name)
        </p>
      </div>
      <ShoesFCommissionsCalculator shoesClientId={shoesClient.id} />
    </div>
  )
}
