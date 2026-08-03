import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect } from 'next/navigation'
import { TreasuryBoard } from '@/components/treasury/TreasuryBoard'
import {
  TreasuryClient,
  TreasuryClientMonth,
  TreasuryExpense,
} from '@/lib/types/treasury'

export default async function TreasuryPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const profile = await getUserProfile()
  if (!profile) redirect('/auth/login')

  // Aquí están los sueldos del equipo y el reparto entre socios: las
  // políticas RLS ya lo blindan, esto evita enseñar una pantalla vacía.
  const isAdmin = profile.role === 'admin' || profile.role === 'partner'
  if (!isAdmin) redirect('/dashboard')

  const { data: clients } = await supabase
    .from('treasury_clients')
    .select('*')
    .order('position', { ascending: true, nullsFirst: false })

  const { data: monthsRows } = await supabase.from('treasury_client_months').select('*')
  const { data: expenses } = await supabase.from('treasury_expenses').select('*')

  const { data: settings } = await supabase
    .from('app_settings')
    .select('key, value')
    .in('key', ['usd_eur_rate', 'treasury_partners'])

  const usdEur = Number(settings?.find((s) => s.key === 'usd_eur_rate')?.value ?? 0.92)
  const partners = Number(settings?.find((s) => s.key === 'treasury_partners')?.value ?? 2)

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)] lg:h-[calc(100vh-4rem)] min-w-0">
      <div className="mb-3 flex-shrink-0">
        <h1 className="heading-medium text-white mb-1">Tesorería</h1>
        <p className="text-white/50 text-sm">
          Lo que factura cada cliente, lo que se va en gastos y lo que queda,
          mes a mes.
        </p>
      </div>

      <div className="flex-1 min-h-0 min-w-0">
        <TreasuryBoard
          clients={(clients as TreasuryClient[]) || []}
          initialMonths={(monthsRows as TreasuryClientMonth[]) || []}
          initialExpenses={(expenses as TreasuryExpense[]) || []}
          usdEur={usdEur}
          partners={partners}
        />
      </div>
    </div>
  )
}
