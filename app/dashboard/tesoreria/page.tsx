import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect } from 'next/navigation'
import { TreasuryBoard } from '@/components/treasury/TreasuryBoard'
import {
  TreasuryClient,
  TreasuryClientMonth,
  TreasuryExpense,
} from '@/lib/types/treasury'
import { buildCostResponse, loadEmployeesData } from '@/lib/employees/data'
import { addMonths, currentMonthKey, monthSeries } from '@/lib/types/employees'

/**
 * Meses de coste de equipo que se precalculan al abrir la página.
 *
 * La gráfica de doce meses se mueve con el selector de mes, así que con esta
 * ventana están cubiertos todos los saltos de un año en cualquiera de los dos
 * sentidos sin ir al API. Y precalcularlos en vez de pedirlos al pintar tiene
 * un motivo: si el total de gastos apareciera primero sin los sueldos y se
 * corrigiera medio segundo después, lo que se vería es el beneficio del mes
 * cambiando solo en pantalla.
 */
const COST_MONTHS_BACK = 23
const COST_MONTHS_FORWARD = 12

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

  // Lo que cuesta el equipo cada mes. Se calcula en el servidor porque las
  // tablas de empleados son solo de admin: un partner que las consultara desde
  // el navegador recibiría cero filas SIN ERROR y vería el beneficio inflado
  // en unos 2.300 € al mes. Por eso `detail` sale del rol, y a un socio se le
  // manda el total sin el desglose de quién cobra cuánto.
  const costPeriods = monthSeries(
    addMonths(currentMonthKey(), -COST_MONTHS_BACK),
    COST_MONTHS_BACK + COST_MONTHS_FORWARD + 1
  )
  const employeesData = await loadEmployeesData(costPeriods)
  const employeeCost = buildCostResponse(employeesData, costPeriods, profile.role === 'admin')

  return (
    <div className="flex flex-col h-[calc(100dvh-8rem)] lg:h-[calc(100vh-4rem)] min-w-0">
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
          initialEmployeeCost={employeeCost}
          usdEur={usdEur}
          partners={partners}
        />
      </div>
    </div>
  )
}
