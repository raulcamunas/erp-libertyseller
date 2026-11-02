'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Palmtree, Plus } from 'lucide-react'
import {
  employeesMonthTotal,
  futureSteps,
  isWithinContract,
  monthLongLabel,
  toDollars,
  toEuros,
  type EmployeeCurrency,
  type Employee,
  type EmployeeMonthRecord,
  type EmployeeNote,
  type EmployeeSalaryStep,
  type EmployeesDataset,
  type EmployeeExtra,
  type LinkableProfile,
} from '@/lib/types/employees'
import type { PersonCost } from '@/lib/payroll/cost'
import type { UserProfile } from '@/lib/supabase/get-user-profile'
import type { VacationsView } from '@/lib/vacations/client'
import { EmployeesList } from './EmployeesList'
import { SalaryMatrix } from './SalaryMatrix'
import { EmployeeDetail } from './EmployeeDetail'
import { CellEditor } from './CellEditor'
import { ResumenDelMes } from './ResumenDelMes'
import { NuevoPago } from './NuevoPago'
import { shortMoney } from './shared'
import { VacacionesPanel } from '@/components/vacaciones/VacacionesPanel'

export interface EmployeesBoardProps {
  currentUser: UserProfile
  initialEmployees: Employee[]
  initialSteps: EmployeeSalaryStep[]
  initialRecords: EmployeeMonthRecord[]
  initialNotes: EmployeeNote[]
  /** Encargos y comisiones sueltas (migración 178) */
  initialExtras: EmployeeExtra[]
  /** Perfiles del ERP, para poder enlazar a quien cobra por horas con «Mis Horas» */
  profiles: LinkableProfile[]
  /**
   * Coste de «Mis Horas» por empleado y mes. Llega calculado del servidor y no
   * se toca aquí: recalcularlo en el navegador significaría traerse todas las
   * horas del equipo y tener un segundo motor que se puede desviar del primero.
   */
  hoursDetail: Record<string, Record<string, PersonCost>>
  /** Ventana de meses cargada, consecutiva y en orden */
  periods: string[]
  currentPeriod: string
  usdEur: number
  /**
   * Vacaciones de todo el equipo. Va aparte del resto del dataset a propósito:
   * el coste mensual lo consume también Tesorería y no tiene por qué cargar con
   * esto. Su `missingTables` es independiente, así que desplegar antes de
   * lanzar la migración 116 no tumba la pantalla de sueldos.
   */
  initialVacations: VacationsView
}

type Pestana = 'mes' | 'plantilla' | 'prevision'

/**
 * CONTROL EMPLEADOS
 * =================
 * Arriba, lo que cuesta el equipo este mes. Debajo, quién está y en qué
 * condiciones. Y al fondo, la tabla que es el motivo del módulo: cada persona
 * en una fila, cada mes en una columna, lo que cobra y lo que va a cobrar.
 *
 * Todo lo que se escribe pasa por aquí —la lista, la ficha y el editor de
 * celda solo avisan— para que el estado sea uno solo: si la tabla de meses y
 * la plantilla llevaran cada una su copia, una subida guardada desde la ficha
 * no aparecería en la tabla hasta recargar.
 */
export function EmployeesBoard({
  currentUser,
  initialEmployees,
  initialSteps,
  initialRecords,
  initialNotes,
  initialExtras,
  profiles,
  hoursDetail,
  periods,
  currentPeriod,
  usdEur,
  initialVacations,
}: EmployeesBoardProps) {
  const supabase = createClient()
  const router = useRouter()

  const [employees, setEmployees] = useState(initialEmployees)
  const [steps, setSteps] = useState(initialSteps)
  const [records, setRecords] = useState(initialRecords)
  const [notes, setNotes] = useState(initialNotes)
  const [extras, setExtras] = useState(initialExtras)
  const [adding, setAdding] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [cell, setCell] = useState<{ employeeId: string; period: string } | null>(null)
  const [pestana, setPestana] = useState<Pestana>('mes')
  // El mes que se mira en «Este mes»: por defecto el en curso, pero se puede ir a otro
  const [period, setPeriod] = useState(currentPeriod)
  const [moneda, setMoneda] = useState<EmployeeCurrency>('USD')
  const [nuevoPago, setNuevoPago] = useState<{ employeeId: string | null } | null>(null)
  // El estado de vacaciones vive aquí, igual que el resto: cada aprobación
  // devuelve la vista entera recargada y el panel solo avisa hacia arriba.
  const [vacations, setVacations] = useState(initialVacations)
  const [vacationsOpen, setVacationsOpen] = useState(false)

  const pendingVacations = vacations.requests.filter((r) => r.status === 'pendiente').length

  // ---------- El conjunto de datos que consume todo el cálculo ----------
  const hoursCost = useMemo(() => {
    const out: Record<string, Record<string, number>> = {}
    for (const [employeeId, byPeriod] of Object.entries(hoursDetail)) {
      const totals: Record<string, number> = {}
      for (const [period, cost] of Object.entries(byPeriod)) totals[period] = cost.total
      out[employeeId] = totals
    }
    return out
  }, [hoursDetail])

  const sorted = useMemo(
    () =>
      [...employees].sort(
        (a, b) => (a.position ?? 9999) - (b.position ?? 9999) || a.name.localeCompare(b.name, 'es')
      ),
    [employees]
  )

  /**
   * La vista de vacaciones que consume el panel.
   *
   * Las peticiones vienen del servidor y se refrescan con cada aprobación,
   * pero las FICHAS se derivan de la lista de esta pantalla: aquí es donde se
   * corrigen la fecha de alta y los días por mes, y el saldo de esa persona
   * cuelga entero de esas dos cosas. Con dos copias, tocar el alta en la ficha
   * dejaría el panel enseñando el saldo viejo hasta recargar.
   *
   * Se recorta a los campos de VacationEmployee a mano, y no se pasa el objeto
   * entero aunque encaje: así el sueldo no puede llegar a un componente de
   * vacaciones ni por accidente el día que alguno se reutilice fuera de aquí.
   */
  const vacationsView: VacationsView = useMemo(
    () => ({
      ...vacations,
      employees: sorted.map((e) => ({
        id: e.id,
        name: e.name,
        user_id: e.user_id,
        started_on: e.started_on,
        ended_on: e.ended_on,
        is_active: e.is_active,
        vacation_days_per_month: e.vacation_days_per_month,
      })),
    }),
    [vacations, sorted]
  )

  const data: EmployeesDataset = useMemo(
    // currentPeriod va explícito: lo calcula el servidor y así el navegador no
    // puede discrepar del mes en el que se pintó la página.
    // baseCoste 'ciclo': los comerciales se cuentan por el ciclo 15→14 que se paga ese mes (el mismo criterio que Tesorería)
    () => ({ employees: sorted, steps, records, extras, hoursCost, currentPeriod, baseCoste: 'ciclo' as const }),
    [sorted, steps, records, extras, hoursCost, currentPeriod]
  )

  // ---------- Cabecera ----------
  const conv = (n: number, cur: EmployeeCurrency) => (moneda === 'USD' ? toDollars(n, cur, usdEur) : toEuros(n, cur, usdEur))

  // Lo del mes que se mira, repartido en lo que se pagará: comerciales (ciclo), sueldos estipulados y pagos sueltos
  const mes = useMemo(() => {
    const t = employeesMonthTotal(period, data, usdEur)
    let comerciales = 0
    let sueldos = 0
    let sueltos = 0
    let nSueltos = 0
    for (const { employee, month } of t.rows) {
      const v = conv(month.amount, month.currency)
      if (employee.pay_model === 'horas') comerciales += v
      else sueldos += v
      for (const e of month.extras) {
        sueltos += conv(Number(e.amount), e.currency)
        nSueltos += 1
      }
    }
    return { t, comerciales, sueldos, sueltos, nSueltos, total: comerciales + sueldos + sueltos }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, data, usdEur, moneda])

  const upcoming = useMemo(() => futureSteps(steps, undefined, currentPeriod), [steps, currentPeriod])

  // Lo que hay que revisar en TODA la ventana, no solo en el mes en curso: los
  // meses que se quedaron sin apuntar son de hace medio año y por eso nadie
  // los ve. Los futuros nunca cuentan aquí —no tienen registro con el que
  // descuadrar—, así que este número es siempre pasado sin cerrar.
  const reviewCount = useMemo(
    () => periods.reduce((s, p) => s + employeesMonthTotal(p, data, usdEur).warnings, 0),
    [periods, data, usdEur]
  )

  // En plantilla ESTE MES: la marca de activo y las fechas juntas, igual que
  // en el cálculo del coste.
  const activeCount = employees.filter((e) => isWithinContract(e, currentPeriod)).length

  const otraMoneda = moneda === 'USD' ? ('EUR' as const) : ('USD' as const)
  const kpis = [
    {
      label: `Total a pagar · ${monthLongLabel(period)}`,
      value: shortMoney(mes.total, moneda),
      hint: `${shortMoney(mes.t[otraMoneda === 'EUR' ? 'eur' : 'usd'], otraMoneda)} · cambio ${usdEur}`,
      tone: 'text-white',
      destacado: true,
    },
    { label: 'Comerciales', value: shortMoney(mes.comerciales, moneda), hint: 'Horas y citas del ciclo 15 → 14', tone: 'text-white', destacado: false },
    { label: 'Sueldos estipulados', value: shortMoney(mes.sueldos, moneda), hint: 'El resto del equipo', tone: 'text-white', destacado: false },
    {
      label: 'Pagos sueltos',
      value: shortMoney(mes.sueltos, moneda),
      hint: mes.nSueltos === 0 ? 'Ninguno apuntado' : `${mes.nSueltos} ${mes.nSueltos === 1 ? 'pago' : 'pagos'} · comisiones, bonus, encargos`,
      tone: mes.nSueltos > 0 ? 'text-[#FF8A3D]' : 'text-white/40',
      destacado: false,
    },
  ]

  // ---------- Escrituras ----------
  async function patchEmployee(employee: Employee, patch: Partial<Employee>) {
    /**
     * CAMBIAR LA FORMA DE COBRO MUEVE DINERO, NO ES UNA ETIQUETA.
     * La insignia «Cobro» de la tabla lo alterna con un solo clic, y pasar a
     * «por horas» a alguien de sueldo fijo sin perfil del ERP —Carla, Daniella
     * o Yasury— deja de mirar su escalón y no encuentra horas: su sueldo pasa
     * a 0 en el mes en curso y en todos los que vienen, y en Tesorería el
     * beneficio y el reparto entre socios se mueven en esa misma cantidad. Por
     * un clic de más al pasar el ratón por encima de la tabla. Se pregunta,
     * pero solo cuando hay algo que perder.
     */
    if (patch.pay_model && patch.pay_model !== employee.pay_model) {
      const tiene =
        steps.some((s) => s.employee_id === employee.id) ||
        records.some((r) => r.employee_id === employee.id)
      const destino = patch.pay_model === 'horas' ? 'por horas' : 'sueldo fijo'
      if (
        tiene &&
        !confirm(
          `${employee.name} pasa a cobrar ${destino}.\n\n` +
            (patch.pay_model === 'horas'
              ? 'Sus escalones de sueldo dejarán de aplicarse y su coste saldrá de «Mis Horas». Si no tiene perfil del ERP enlazado, costará 0 en Tesorería este mes y los siguientes.'
              : 'Su coste dejará de salir de «Mis Horas» y pasará a ser el escalón de sueldo que tenga puesto.') +
            '\n\n¿Seguro?'
        )
      ) {
        return
      }
    }

    setEmployees((prev) => prev.map((e) => (e.id === employee.id ? { ...e, ...patch } : e)))

    const { error } = await supabase.from('employees').update(patch).eq('id', employee.id)
    if (!error) {
      // Al cambiar la forma de cobro (o al enlazar un perfil) el coste por
      // horas lo tiene que recalcular el servidor: aquí no están ni las horas
      // ni las tarifas, y ponerlas sería duplicar el motor de payroll.
      if ('pay_model' in patch || 'user_id' in patch) router.refresh()
      return
    }

    console.error('Error guardando el empleado:', error)
    const duplicate = (error as { code?: string }).code === '23505'
    toast.error(
      duplicate
        ? `Ya hay otra persona que se llama «${patch.name}»`
        : 'No se ha podido guardar el cambio'
    )
    setEmployees((prev) => prev.map((e) => (e.id === employee.id ? employee : e)))
  }

  async function addEmployee() {
    // El nombre es UNIQUE en la base: si se insertaran dos «Nueva persona»
    // seguidas, la segunda daría un 23505 y parecería un fallo del botón.
    const taken = new Set(employees.map((e) => e.name.trim().toLowerCase()))
    let name = 'Nueva persona'
    for (let i = 2; taken.has(name.toLowerCase()); i += 1) name = `Nueva persona ${i}`

    const nextPos = Math.max(0, ...employees.map((e) => e.position ?? 0)) + 1
    setAdding(true)
    try {
      const { data: row, error } = await supabase
        .from('employees')
        .insert({
          name,
          pay_model: 'fijo',
          currency: 'USD',
          hours_unit: 'mes',
          position: nextPos,
          is_active: true,
          // Se da de alta este mes a propósito: sin fecha de alta, todos los
          // meses pasados saldrían como «sin registrar» y llenarían de avisos
          // una tabla en la que esa persona todavía no existía.
          started_on: currentPeriod,
        })
        .select('*')
        .single()
      if (error) throw error
      const created = row as Employee
      setEmployees((prev) => [...prev, created])
      setOpenId(created.id)
      toast.success('Persona añadida: ponle nombre y su sueldo')
    } catch (err) {
      console.error('Error creando el empleado:', err)
      toast.error('No se ha podido dar de alta')
    } finally {
      setAdding(false)
    }
  }

  function upsertStep(step: EmployeeSalaryStep) {
    setSteps((prev) =>
      prev.some((s) => s.id === step.id)
        ? prev.map((s) => (s.id === step.id ? step : s))
        : [...prev, step]
    )
  }

  function upsertRecord(record: EmployeeMonthRecord) {
    setRecords((prev) =>
      prev.some((r) => r.id === record.id)
        ? prev.map((r) => (r.id === record.id ? record : r))
        : [...prev, record]
    )
  }

  function removeEmployee(id: string) {
    setEmployees((prev) => prev.filter((e) => e.id !== id))
    setSteps((prev) => prev.filter((s) => s.employee_id !== id))
    setRecords((prev) => prev.filter((r) => r.employee_id !== id))
    setNotes((prev) => prev.filter((n) => n.employee_id !== id))
  }

  const openEmployee = employees.find((e) => e.id === openId) ?? null
  const cellEmployee = cell ? employees.find((e) => e.id === cell.employeeId) ?? null : null

  const pestanas: Array<[Pestana, string, string | null]> = [
    ['mes', 'Este mes', mes.t.warnings > 0 ? String(mes.t.warnings) : null],
    ['plantilla', 'Plantilla', String(activeCount)],
    ['prevision', 'Previsión', upcoming.length > 0 ? `${upcoming.length} subidas` : null],
  ]

  return (
    <div className="flex flex-col h-full gap-3 min-w-0">
      {/* Acciones: pestañas a la izquierda, lo que se hace a la derecha */}
      <div className="flex items-center justify-between gap-2 flex-shrink-0 flex-wrap">
        <div className="flex items-center rounded-full border border-white/10 bg-white/[0.03] p-0.5">
          {pestanas.map(([id, label, badge]) => (
            <button
              key={id}
              type="button"
              onClick={() => setPestana(id)}
              className={`h-7 px-3.5 rounded-full text-[12px] font-medium flex items-center gap-1.5 transition-colors ${
                pestana === id ? 'bg-[#FF6600] text-white' : 'text-white/55 hover:text-white'
              }`}
            >
              {label}
              {badge && (
                <span className={`text-[10px] px-1.5 rounded-full tabular-nums ${pestana === id ? 'bg-black/25' : 'bg-white/10 text-white/60'}`}>{badge}</span>
              )}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-full border border-white/10 p-0.5 text-[11px]">
            {(['USD', 'EUR'] as const).map((c) => (
              <button key={c} type="button" onClick={() => setMoneda(c)} className={`px-2.5 py-1 rounded-full ${moneda === c ? 'bg-white/10 text-white' : 'text-white/45 hover:text-white'}`}>
                {c === 'USD' ? 'US$' : '€'}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setVacationsOpen(true)}
            disabled={vacations.missingTables}
            title={
              vacations.missingTables
                ? 'Falta lanzar la migración 116_vacations.sql en Supabase'
                : pendingVacations > 0
                  ? `${pendingVacations} ${pendingVacations === 1 ? 'petición' : 'peticiones'} esperando respuesta`
                  : 'Saldos del equipo y peticiones de vacaciones'
            }
            className={`h-8 pl-3 pr-2.5 rounded-full border text-[12px] font-medium flex items-center gap-2 flex-shrink-0 transition-colors disabled:opacity-40 ${
              pendingVacations > 0
                ? 'border-[#FF6600]/50 bg-[#FF6600]/[0.12] text-white hover:bg-[#FF6600]/[0.18]'
                : 'border-white/10 bg-white/[0.03] text-white/75 hover:bg-white/[0.06] hover:border-white/20'
            }`}
          >
            <Palmtree className={`h-3.5 w-3.5 flex-shrink-0 ${pendingVacations > 0 ? 'text-[#FF6600]' : ''}`} />
            <span className="hidden sm:inline">Vacaciones</span>
            {pendingVacations > 0 && (
              <span className="h-5 min-w-[20px] px-1 rounded-full bg-[#FF6600] text-white text-[11px] font-bold flex items-center justify-center tabular-nums">
                {pendingVacations > 9 ? '9+' : pendingVacations}
              </span>
            )}
          </button>

          <button type="button" onClick={() => setNuevoPago({ employeeId: null })} className="h-8 px-3.5 rounded-full bg-gradient-to-b from-[#FF7A1F] to-[#FF6600] text-white text-[12px] font-semibold flex items-center gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Añadir pago
          </button>
        </div>
      </div>

      {/* Resultado del mes que se mira */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 flex-shrink-0">
        {kpis.map((k) => (
          <div
            key={k.label}
            className={`rounded-xl border px-3.5 py-2.5 ${k.destacado ? 'border-[#FF6600]/35 bg-[#FF6600]/[0.06]' : 'border-white/10 bg-white/[0.02]'}`}
          >
            <p className="text-[10px] uppercase tracking-wider text-white/40 truncate">{k.label}</p>
            <p className={`font-bold text-[22px] mt-0.5 tabular-nums leading-tight ${k.tone}`}>{k.value}</p>
            <p className="text-[10.5px] text-white/35 truncate">{k.hint}</p>
          </div>
        ))}
      </div>

      <div className="flex-1 min-h-0 min-w-0 overflow-y-auto">
        {pestana === 'mes' && (
          <ResumenDelMes
            employees={sorted}
            data={data}
            hoursDetail={hoursDetail}
            periods={periods}
            period={period}
            currentPeriod={currentPeriod}
            usdEur={usdEur}
            moneda={moneda}
            onPeriod={setPeriod}
            onAdd={(employeeId) => setNuevoPago({ employeeId: employeeId ?? null })}
            onOpenEmployee={(e) => setOpenId(e.id)}
            extras={extras}
            onExtrasChange={setExtras}
          />
        )}

        {pestana === 'plantilla' && (
          <EmployeesList
            className="flex h-full"
            employees={sorted}
            data={data}
            currentPeriod={currentPeriod}
            hoursDetail={hoursDetail}
            onPatch={patchEmployee}
            onOpen={(e) => setOpenId(e.id)}
            onAdd={addEmployee}
            adding={adding}
          />
        )}

        {pestana === 'prevision' && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] flex flex-col min-h-0 min-w-0 overflow-hidden h-full">
            <div className="px-3 py-2 border-b border-white/[0.06] flex items-center justify-between gap-2 flex-shrink-0">
              <h3 className="text-[10px] font-semibold text-white/45 uppercase tracking-wider">Cuánto cobra y cuánto va a cobrar</h3>
              <span className="text-[10px] text-white/30 hidden sm:block">Pulsa una celda para cambiar el sueldo o programar una subida</span>
            </div>
            <SalaryMatrix
              employees={sorted}
              data={data}
              periods={periods}
              currentPeriod={currentPeriod}
              usdEur={usdEur}
              hoursDetail={hoursDetail}
              onCellClick={(employee, p) => setCell({ employeeId: employee.id, period: p })}
              onOpenEmployee={(employee) => setOpenId(employee.id)}
            />
          </div>
        )}
      </div>

      {openEmployee && (
        <EmployeeDetail
          employee={openEmployee}
          currentUser={currentUser}
          data={data}
          profiles={profiles}
          notes={notes.filter((n) => n.employee_id === openEmployee.id)}
          monthCost={hoursDetail[openEmployee.id]?.[currentPeriod]}
          currentPeriod={currentPeriod}
          onClose={() => setOpenId(null)}
          onPatch={(patch) => patchEmployee(openEmployee, patch)}
          onDeleted={removeEmployee}
          onStepSaved={upsertStep}
          onStepDeleted={(id) => setSteps((prev) => prev.filter((s) => s.id !== id))}
          onExtrasChange={setExtras}
          onNotesChange={(list) =>
            setNotes((prev) => [...prev.filter((n) => n.employee_id !== openEmployee.id), ...list])
          }
        />
      )}

      {vacationsOpen && (
        <VacacionesPanel
          data={vacationsView}
          onData={setVacations}
          onClose={() => setVacationsOpen(false)}
          // Todo el saldo cuelga de la fecha de alta, y en varias fichas esa
          // fecha la dedujo la migración 112 de la primera factura de
          // Tesorería. Desde el panel se salta a la ficha a corregirla, que es
          // el único sitio donde se puede.
          onOpenFicha={(employeeId) => {
            setVacationsOpen(false)
            setOpenId(employeeId)
          }}
        />
      )}

      {nuevoPago && (
        <NuevoPago
          employees={sorted}
          period={period}
          months={periods}
          employeeId={nuevoPago.employeeId}
          defaultCurrency={moneda}
          onSaved={(extra) => setExtras((prev) => [...prev, extra])}
          onClose={() => setNuevoPago(null)}
        />
      )}

      {cell && cellEmployee && (
        <CellEditor
          employee={cellEmployee}
          period={cell.period}
          currentPeriod={currentPeriod}
          data={data}
          onClose={() => setCell(null)}
          onStepSaved={upsertStep}
          onStepDeleted={(id) => setSteps((prev) => prev.filter((s) => s.id !== id))}
          onRecordSaved={upsertRecord}
          onRecordDeleted={(id) => setRecords((prev) => prev.filter((r) => r.id !== id))}
        />
      )}
    </div>
  )
}
