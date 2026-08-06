import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect } from 'next/navigation'
import { EmployeesBoard } from '@/components/empleados/EmployeesBoard'
import { fetchAll, loadEmployeesData } from '@/lib/employees/data'
import {
  addMonths,
  currentMonthKey,
  monthSeries,
  type EmployeeNote,
  type LinkableProfile,
} from '@/lib/types/employees'

/**
 * Cuántos meses se traen a la tabla: un año hacia atrás y otro hacia adelante.
 *
 * Hacia atrás, porque el histórico que se importó de Tesorería empieza en
 * marzo de 2026 y tiene que caber entero. Hacia adelante, porque «cuánto va a
 * cobrar» con dos meses de margen no contesta a nada: una subida se pacta con
 * medio año de antelación y hay que poder verla en su sitio.
 */
const MONTHS_BACK = 12
const MONTHS_FORWARD = 12

export default async function EmployeesPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const profile = await getUserProfile()
  if (!profile) redirect('/auth/login')

  // Aquí está el sueldo de cada persona del equipo, así que el listón es más
  // alto que en Tesorería: solo admin, ni siquiera los socios. Las políticas
  // RLS de la migración 111 lo blindan de verdad (is_erp_admin); esto evita
  // enseñar una pantalla vacía a quien no le toca.
  if (profile.role !== 'admin') redirect('/dashboard')

  const currentPeriod = currentMonthKey()
  const periods = monthSeries(
    addMonths(currentPeriod, -MONTHS_BACK),
    MONTHS_BACK + MONTHS_FORWARD + 1
  )

  const data = await loadEmployeesData(periods)

  // Los perfiles del ERP, para poder enlazar desde la ficha a quien cobra por
  // horas. Sin ese enlace su coste sale 0 en Tesorería todos los meses, y
  // hasta ahora arreglarlo exigía entrar por SQL.
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name, email, role')
    .order('full_name', { ascending: true })

  // Las notas van aparte porque necesitan el autor, y ese join solo lo sabe
  // hacer la consulta: quién escribió qué es la mitad del valor de una nota.
  //
  // Paginadas con el mismo fetchAll que el resto del módulo: Supabase corta a
  // las mil filas sin error ni aviso, y como aquí se cargan las notas de TODA
  // la plantilla de golpe, pasado ese tope el orden descendente iría dejando
  // fuera a quien solo tiene notas antiguas — su ficha aparecería vacía como
  // si nunca se le hubiera anotado nada.
  let notes: EmployeeNote[] = []
  try {
    notes = await fetchAll<EmployeeNote>((from, to) =>
      supabase
        .from('employee_notes')
        .select(
          '*, author:profiles!employee_notes_author_id_fkey(id, full_name, email, role, calendar_color)'
        )
        // El segundo orden por id hace falta: occurred_at empata y .range()
        // sobre un orden con empates repite o se salta filas entre tramos.
        .order('occurred_at', { ascending: false })
        .order('id')
        .range(from, to)
    )
  } catch (notesError) {
    console.error('Error cargando las notas de empleados:', notesError)
  }

  return (
    <div className="flex flex-col h-[calc(100dvh-8rem)] lg:h-[calc(100vh-4rem)] min-w-0">
      <div className="mb-3 flex-shrink-0">
        <h1 className="heading-medium text-white mb-1">Control empleados</h1>
        <p className="text-white/50 text-sm">
          Quién está en plantilla, qué horas tiene contratadas y lo que cobra cada mes. Lo
          que salga aquí es lo que suma en Tesorería.
        </p>
      </div>

      <div className="flex-1 min-h-0 min-w-0">
        <EmployeesBoard
          currentUser={profile}
          initialEmployees={data.employees}
          initialSteps={data.steps}
          initialRecords={data.records}
          initialNotes={notes}
          profiles={(profiles as LinkableProfile[]) ?? []}
          hoursDetail={data.hoursDetail}
          periods={periods}
          currentPeriod={currentPeriod}
          usdEur={data.usdEur}
        />
      </div>
    </div>
  )
}
