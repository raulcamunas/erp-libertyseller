'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { CalendarClock, ChevronLeft, ChevronRight, Palmtree, Plus, TrendingUp, UserPlus, Wallet } from 'lucide-react'
import {
  MONTHS_SHORT,
  addMonths,
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
import { SalaryMatrix } from './SalaryMatrix'
import { EmployeeDetail } from './EmployeeDetail'
import { CellEditor } from './CellEditor'
import { PagosDelMes } from './PagosDelMes'
import { DatosDePagoEquipo } from './DatosDePagoEquipo'
import { BarraReparto, CabeceraTarjeta, Pastilla, Tarjeta, velo } from '@/components/contabilidad/ui'
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

  // ---------- El mes que se mira ----------
  const idx = periods.indexOf(period)
  const [, mesNum] = period.split('-').map(Number)
  const [, mesAnt] = addMonths(period, -1).split('-').map(Number)
  const ciclo = `15 ${MONTHS_SHORT[mesAnt - 1]} → 14 ${MONTHS_SHORT[mesNum - 1]}`
  const abierto = period === currentPeriod && new Date().getDate() <= 14
  const verPrevision = useRef<HTMLDivElement>(null)

  return (
    <div className="flex h-full min-w-0 flex-col gap-3 overflow-y-auto pb-8 pr-1">
      {/* Barra: el mes a la izquierda, lo que se hace a la derecha */}
      <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-xl border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-1">
            <button type="button" disabled={idx <= 0} onClick={() => setPeriod(periods[idx - 1])} className="grid h-8 w-8 place-items-center rounded-lg text-[var(--ls-t3)] hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)] disabled:opacity-30" aria-label="Mes anterior">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[150px] px-2 text-center text-[13.5px] font-semibold capitalize text-[var(--ls-t1)]">{monthLongLabel(period)}</span>
            <button type="button" disabled={idx < 0 || idx >= periods.length - 1} onClick={() => setPeriod(periods[idx + 1])} className="grid h-8 w-8 place-items-center rounded-lg text-[var(--ls-t3)] hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)] disabled:opacity-30" aria-label="Mes siguiente">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          {period !== currentPeriod && (
            <button type="button" onClick={() => setPeriod(currentPeriod)} className="h-10 rounded-xl border border-[var(--ls-linea)] px-3 text-[12px] text-[var(--ls-t3)] hover:text-[var(--ls-t1)]">
              Volver a este mes
            </button>
          )}
          <div className="flex rounded-xl border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-1 text-[12px]">
            {(['USD', 'EUR'] as const).map((c) => (
              <button key={c} type="button" onClick={() => setMoneda(c)} className={`h-8 rounded-lg px-3 font-medium ${moneda === c ? 'bg-[var(--ls-sup3)] text-[var(--ls-t1)]' : 'text-[var(--ls-t3)] hover:text-[var(--ls-t1)]'}`}>
                {c === 'USD' ? 'US$' : '€'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <DatosDePagoEquipo />
          <button
            type="button"
            onClick={() => setVacationsOpen(true)}
            disabled={vacations.missingTables}
            title={vacations.missingTables ? 'Falta lanzar la migración 116_vacations.sql en Supabase' : pendingVacations > 0 ? `${pendingVacations} ${pendingVacations === 1 ? 'petición' : 'peticiones'} esperando respuesta` : 'Saldos del equipo y peticiones de vacaciones'}
            className="inline-flex h-7 items-center gap-1.5 rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-[11px] text-[11.5px] font-medium text-[var(--ls-t2)] hover:border-[var(--ls-linea2)] hover:text-[var(--ls-t1)] disabled:opacity-40"
          >
            <Palmtree className="h-[14px] w-[14px]" style={pendingVacations > 0 ? { color: 'var(--ls-acc)' } : undefined} />
            Vacaciones
            {pendingVacations > 0 && <span className="grid h-4 min-w-[16px] place-items-center rounded-full bg-[var(--ls-acc-relleno)] px-1 text-[10px] font-bold text-[var(--ls-acc-tinta)]">{pendingVacations > 9 ? '9+' : pendingVacations}</span>}
          </button>
          <button type="button" onClick={addEmployee} disabled={adding} className="inline-flex h-7 items-center gap-1.5 rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-[11px] text-[11.5px] font-medium text-[var(--ls-t2)] hover:border-[var(--ls-linea2)] hover:text-[var(--ls-t1)] disabled:opacity-40">
            <UserPlus className="h-[14px] w-[14px]" />
            {adding ? 'Dando de alta…' : 'Persona'}
          </button>
          <button type="button" onClick={() => setNuevoPago({ employeeId: null })} className="inline-flex h-7 items-center gap-1.5 rounded-[6px] bg-[var(--ls-acc-relleno)] px-[11px] text-[11.5px] font-semibold text-[var(--ls-acc-tinta)] hover:brightness-110">
            <Plus className="h-[14px] w-[14px]" /> Añadir pago
          </button>
        </div>
      </div>

      {/* Lo que hay que pagar este mes, de un vistazo */}
      <div className="grid flex-shrink-0 gap-3 lg:grid-cols-[1.15fr_1fr]">
        <Tarjeta acento="naranja" className="px-5 py-4" style={{ borderColor: 'color-mix(in srgb, var(--ls-e-naranja) 35%, transparent)' }}>
          <div className="flex items-center gap-2 text-[12px] font-medium text-[var(--ls-t3)]">
            <span className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: velo('naranja', 16), color: 'var(--ls-e-naranja)' }}>
              <Wallet className="h-[15px] w-[15px]" />
            </span>
            Total a pagar · <span className="capitalize">{monthLongLabel(period)}</span>
          </div>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-[36px] font-semibold leading-none tracking-[-0.025em] tabular-nums text-[var(--ls-t1)]">{shortMoney(mes.total, moneda)}</span>
            <span className="text-[13px] tabular-nums text-[var(--ls-t3)]">
              {shortMoney(mes.t[otraMoneda === 'EUR' ? 'eur' : 'usd'], otraMoneda)} · cambio {usdEur}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-[var(--ls-t3)]">
            <span className="inline-flex items-center gap-1.5">
              <CalendarClock className="h-3.5 w-3.5" /> Se paga el <strong className="font-semibold text-[var(--ls-t2)]">15 de {MONTHS_SHORT[mesNum - 1]}</strong>
            </span>
            <span>· ciclo de los comerciales {ciclo}</span>
            {abierto && <Pastilla tono="naranja">todavía abierto</Pastilla>}
            {reviewCount > 0 && <Pastilla tono="ambar" title="Meses pasados sin apuntar o personas por horas sin perfil enlazado">{reviewCount} por revisar</Pastilla>}
          </div>
        </Tarjeta>

        <Tarjeta className="flex flex-col justify-center gap-3 px-5 py-4">
          <BarraReparto
            alto={12}
            partes={[
              { valor: mes.comerciales, tono: 'naranja', titulo: 'Comerciales' },
              { valor: mes.sueldos, tono: 'azul', titulo: 'Sueldos estipulados' },
              { valor: mes.sueltos, tono: 'violeta', titulo: 'Pagos sueltos' },
            ]}
          />
          <div className="grid grid-cols-3 gap-3">
            {(
              [
                ['Comerciales', mes.comerciales, 'naranja', 'Horas y citas del ciclo'],
                ['Sueldos', mes.sueldos, 'azul', `${activeCount} en plantilla`],
                ['Sueltos', mes.sueltos, 'violeta', mes.nSueltos === 0 ? 'Ninguno' : `${mes.nSueltos} ${mes.nSueltos === 1 ? 'pago' : 'pagos'}`],
              ] as const
            ).map(([label, valor, t, nota]) => (
              <div key={label} className="min-w-0">
                <div className="flex items-center gap-1.5 text-[11.5px] text-[var(--ls-t3)]">
                  <span className="h-2 w-2 rounded-full" style={{ background: `var(--ls-e-${t})` }} />
                  {label}
                </div>
                <div className="mt-1 text-[18px] font-semibold tabular-nums text-[var(--ls-t1)]">{shortMoney(valor, moneda)}</div>
                <div className="truncate text-[11px] text-[var(--ls-t4)]">{nota}</div>
              </div>
            ))}
          </div>
          {upcoming.length > 0 && (
            <button type="button" onClick={() => verPrevision.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="inline-flex items-center gap-1.5 self-start text-[12px] font-medium text-[var(--ls-acc)]">
              <TrendingUp className="h-3.5 w-3.5" /> {upcoming.length} subidas programadas · ver previsión
            </button>
          )}
        </Tarjeta>
      </div>

      <PagosDelMes
        employees={sorted}
        data={data}
        hoursDetail={hoursDetail}
        period={period}
        currentPeriod={currentPeriod}
        usdEur={usdEur}
        moneda={moneda}
        onAdd={(employeeId) => setNuevoPago({ employeeId: employeeId ?? null })}
        onOpenEmployee={(e) => setOpenId(e.id)}
        extras={extras}
        onExtrasChange={setExtras}
      />

      {/* El desglose mes a mes: lo que cobra y va a cobrar cada uno (aquí se programan las subidas) */}
      <div ref={verPrevision} className="scroll-mt-2">
        <Tarjeta className="flex h-[620px] flex-col">
          <CabeceraTarjeta icono={TrendingUp} titulo="Mes a mes: lo que cobra y lo que va a cobrar" sub="Pulsa una celda para cambiar el sueldo o programar una subida" tonoIcono="verde" />
          <div className="min-h-0 flex-1 px-1 pb-1">
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
        </Tarjeta>
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
