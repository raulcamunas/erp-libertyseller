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

  // Lo que cuesta el equipo cada mes. Se calcula en el servidor porque las
  // tablas de empleados son solo de admin: un partner que las consultara desde
  // el navegador recibiría cero filas SIN ERROR y vería el beneficio inflado
  // en unos 2.300 € al mes. Por eso `detail` sale del rol, y a un socio se le
  // manda el total sin el desglose de quién cobra cuánto.
  //
  // La lista de meses se calcula en memoria y no depende de ninguna consulta,
  // así que loadEmployeesData puede salir a la vez que las cuatro de abajo.
  const costPeriods = monthSeries(
    addMonths(currentMonthKey(), -COST_MONTHS_BACK),
    COST_MONTHS_BACK + COST_MONTHS_FORWARD + 1
  )

  // LAS CINCO CONSULTAS VAN EN PARALELO, NO EN CADENA.
  //
  // Ninguna depende del resultado de otra: son cuatro GET independientes de
  // PostgREST más la carga de empleados, que va por su cuenta. Medido contra la
  // base real, tres rondas con la conexión caliente, las cuatro de PostgREST:
  //
  //   en serie:    221 ms
  //   Promise.all:  61 ms      -> 160 ms menos, y encima loadEmployeesData
  //                               deja de esperar a que terminen
  //
  // NO CAMBIA NADA DE LO QUE SE VE: mismas consultas, mismos filtros, mismo
  // orden, y cada resultado se asigna a lo mismo que antes. supabase-js no
  // lanza cuando una consulta falla —devuelve `{ error }`—, así que las cuatro
  // primeras no pueden rechazar la promesa; loadEmployeesData sí puede lanzar,
  // igual que antes, y el fallo sube exactamente igual porque era la última.
  const [clientsRes, monthsRes, expensesRes, settingsRes, employeesData] = await Promise.all([
    supabase
      .from('treasury_clients')
      .select('*')
      .order('position', { ascending: true, nullsFirst: false }),
    supabase.from('treasury_client_months').select('*'),
    supabase.from('treasury_expenses').select('*'),
    supabase
      .from('app_settings')
      .select('key, value')
      .in('key', ['usd_eur_rate', 'treasury_partners']),
    /**
     * `ciclo`: a la gente se le paga el día 15, y lo que se paga ese día es el
     * ciclo que cerró el 14 —del 15 del mes anterior al 14 de éste—. Tesorería
     * mide el dinero que SALE de la cuenta, así que el gasto de septiembre es
     * ese ciclo, no el mes natural del 1 al 30.
     */
    loadEmployeesData(costPeriods, { base: 'ciclo' }),
  ])

  const clients = clientsRes.data
  const monthsRows = monthsRes.data
  const expenses = expensesRes.data
  const settings = settingsRes.data

  const usdEur = Number(settings?.find((s) => s.key === 'usd_eur_rate')?.value ?? 0.92)
  const partners = Number(settings?.find((s) => s.key === 'treasury_partners')?.value ?? 2)

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
