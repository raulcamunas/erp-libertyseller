'use client'

import { useMemo, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Clock, Plus, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import {
  EXTRA_KIND_LABELS,
  MONTHS_SHORT,
  addMonths,
  employeeMonth,
  isWithinContract,
  monthLongLabel,
  monthShortLabel,
  toDollars,
  toEuros,
  type Employee,
  type EmployeeCurrency,
  type EmployeeExtra,
  type EmployeesDataset,
} from '@/lib/types/employees'
import type { PersonCost } from '@/lib/payroll/cost'
import { shortMoney } from './shared'

export interface ResumenDelMesProps {
  employees: Employee[]
  data: EmployeesDataset
  hoursDetail: Record<string, Record<string, PersonCost>>
  /** Meses cargados, en orden */
  periods: string[]
  period: string
  currentPeriod: string
  usdEur: number
  moneda: EmployeeCurrency
  onPeriod: (period: string) => void
  onAdd: (employeeId?: string) => void
  onOpenEmployee: (employee: Employee) => void
  /** Todos los pagos sueltos, para la lista de abajo */
  extras: EmployeeExtra[]
  onExtrasChange: (lista: EmployeeExtra[]) => void
}

interface Fila {
  employee: Employee
  /** Sueldo fijo, o horas × tarifa en quien cobra por horas */
  base: number
  /** Citas cualificadas × comisión (solo por horas) */
  citas: number
  /** Pagos sueltos de este mes, ya convertidos */
  sueltos: number
  total: number
  horas: number | null
  nCitas: number | null
  extras: EmployeeExtra[]
  fuente: ReturnType<typeof employeeMonth>['source']
}

/** «15 oct → 14 nov»: el ciclo que se paga el día 15 del mes `period` */
function etiquetaDelCiclo(period: string): { desde: string; hasta: string } {
  const ant = addMonths(period, -1)
  const [, m0] = ant.split('-').map(Number)
  const [, m1] = period.split('-').map(Number)
  return { desde: `15 ${MONTHS_SHORT[m0 - 1]}`, hasta: `14 ${MONTHS_SHORT[m1 - 1]}` }
}

function Cifra({ valor, moneda, vacio = '—', fuerte = false }: { valor: number; moneda: EmployeeCurrency; vacio?: string; fuerte?: boolean }) {
  if (!valor) return <span className="text-white/20">{vacio}</span>
  return <span className={`tabular-nums ${fuerte ? 'text-white font-semibold' : 'text-white/80'} ${valor < 0 ? 'text-red-300' : ''}`}>{shortMoney(valor, moneda)}</span>
}

/**
 * LO QUE SE VA A PAGAR ESE MES, TODO JUNTO.
 * Los comerciales (cobran por horas) entran por el CICLO que se paga el día 15: del 15 del mes anterior al 14 de este.
 * El resto, por su sueldo estipulado. Encima de ambos, los pagos sueltos que se apuntan a mano. Los números salen del mismo
 * motor que Tesorería (`employeeMonth` + `hoursDetail`), así que esta pantalla y el gasto del mes no pueden discrepar.
 */
export function ResumenDelMes({
  employees,
  data,
  hoursDetail,
  periods,
  period,
  currentPeriod,
  usdEur,
  moneda,
  onPeriod,
  onAdd,
  onOpenEmployee,
  extras,
  onExtrasChange,
}: ResumenDelMesProps) {
  const supabase = createClient()
  const [verTodos, setVerTodos] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const conv = (n: number, cur: EmployeeCurrency) => (moneda === 'USD' ? toDollars(n, cur, usdEur) : toEuros(n, cur, usdEur))

  const filas = useMemo(() => {
    const out: Fila[] = []
    for (const employee of employees) {
      const m = employeeMonth(employee, period, data)
      const sueltosLista = m.extras
      if (!isWithinContract(employee, period) && sueltosLista.length === 0) continue
      const cost = hoursDetail[employee.id]?.[period]
      const porHoras = (m.source === 'horas' || (m.source === 'sin_registro' && employee.pay_model === 'horas')) && cost
      const base = porHoras ? conv(cost.salary, 'USD') : conv(m.amount, m.currency)
      const citas = porHoras ? conv(cost.commissions, 'USD') : 0
      const sueltos = sueltosLista.reduce((s, e) => s + conv(Number(e.amount), e.currency), 0)
      out.push({
        employee,
        base,
        citas,
        sueltos,
        total: base + citas + sueltos,
        horas: porHoras ? cost.hours : null,
        nCitas: porHoras ? cost.appointments : null,
        extras: sueltosLista,
        fuente: m.source,
      })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employees, data, hoursDetail, period, moneda, usdEur])

  const comerciales = filas.filter((f) => f.employee.pay_model === 'horas')
  const fijos = filas.filter((f) => f.employee.pay_model !== 'horas')
  const ciclo = etiquetaDelCiclo(period)
  // El ciclo que se cobra este mes se cierra el 14: antes de esa fecha todavía suben las horas y las citas
  const abierto = period === currentPeriod && new Date().getDate() <= 14
  const idx = periods.indexOf(period)

  const nombreDe = (id: string) => employees.find((e) => e.id === id)?.name ?? '—'

  const listaPagos = useMemo(
    () =>
      extras
        .filter((e) => verTodos || e.period.slice(0, 7) === period.slice(0, 7))
        .sort((a, b) => b.period.localeCompare(a.period) || b.created_at.localeCompare(a.created_at)),
    [extras, period, verTodos]
  )
  const totalPagos = listaPagos.reduce((s, e) => s + conv(Number(e.amount), e.currency), 0)

  async function alternarPagado(e: EmployeeExtra) {
    const { error: fallo } = await supabase.from('employee_extras').update({ paid: !e.paid }).eq('id', e.id)
    if (fallo) return setError(fallo.message)
    setError(null)
    onExtrasChange(extras.map((x) => (x.id === e.id ? { ...x, paid: !e.paid } : x)))
  }

  async function quitar(e: EmployeeExtra) {
    if (!confirm(`Quitar «${e.concept}» de ${nombreDe(e.employee_id)}?`)) return
    const { error: fallo } = await supabase.from('employee_extras').delete().eq('id', e.id)
    if (fallo) return setError(fallo.message)
    setError(null)
    onExtrasChange(extras.filter((x) => x.id !== e.id))
  }

  const cabecera = (titulo: string, sub: string, lista: Fila[]) => (
    <div className="flex items-baseline justify-between gap-3 px-4 pt-3 pb-1.5">
      <div className="min-w-0">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-white/70">{titulo}</h4>
        <p className="text-[10.5px] text-white/35 truncate">{sub}</p>
      </div>
      <span className="text-[13px] font-semibold text-white tabular-nums flex-shrink-0">{shortMoney(lista.reduce((s, f) => s + f.total, 0), moneda)}</span>
    </div>
  )

  const tabla = (lista: Fila[], porHoras: boolean) => (
    <div className="px-2 pb-2">
      <div className="grid grid-cols-[minmax(130px,1.6fr)_minmax(0,1.2fr)_92px_92px_92px_100px_32px] gap-x-2 px-2 py-1 text-[9.5px] uppercase tracking-wider text-white/30">
        <span>Persona</span>
        <span>{porHoras ? 'Horas y citas del ciclo' : 'Condición'}</span>
        <span className="text-right">{porHoras ? 'Horas' : 'Sueldo'}</span>
        <span className="text-right">{porHoras ? 'Citas' : '—'}</span>
        <span className="text-right">Sueltos</span>
        <span className="text-right">Total</span>
        <span />
      </div>
      {lista.length === 0 && <p className="px-2 py-3 text-[12px] text-white/30">Nadie en este grupo este mes.</p>}
      {lista.map((f) => (
        <div
          key={f.employee.id}
          className="grid grid-cols-[minmax(130px,1.6fr)_minmax(0,1.2fr)_92px_92px_92px_100px_32px] gap-x-2 items-center px-2 py-2 rounded-lg hover:bg-white/[0.035] group transition-colors text-[12.5px]"
        >
          <button type="button" onClick={() => onOpenEmployee(f.employee)} className="flex items-center gap-2 min-w-0 text-left">
            <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${f.employee.is_active ? 'bg-emerald-400' : 'bg-white/25'}`} />
            <span className="truncate text-white font-medium group-hover:text-[#FF8A3D] transition-colors">{f.employee.name}</span>
          </button>

          <span className="text-[11px] text-white/40 truncate flex items-center gap-1.5">
            {porHoras && f.horas != null ? (
              <>
                {abierto && <Clock className="h-3 w-3 text-[#FF6600] flex-shrink-0" aria-label="Todavía suben" />}
                <span className="tabular-nums">{Math.round(f.horas * 10) / 10} h</span>
                <span>·</span>
                <span className="tabular-nums">{f.nCitas} {f.nCitas === 1 ? 'cita' : 'citas'}</span>
              </>
            ) : f.fuente === 'sin_registro' ? (
              <span className="text-amber-300/80">Sin apuntar</span>
            ) : f.fuente === 'sin_perfil' ? (
              <span className="text-amber-300/80">Sin perfil enlazado</span>
            ) : f.fuente === 'registrado' ? (
              'Apuntado'
            ) : f.employee.role_label ? (
              f.employee.role_label
            ) : (
              'Sueldo estipulado'
            )}
          </span>

          <span className="text-right"><Cifra valor={f.base} moneda={moneda} /></span>
          <span className="text-right">{porHoras ? <Cifra valor={f.citas} moneda={moneda} /> : <span className="text-white/15">·</span>}</span>
          <span
            className="text-right"
            title={f.extras.map((e) => `${EXTRA_KIND_LABELS[e.kind]}: ${e.concept} (${shortMoney(Number(e.amount), e.currency)})`).join('\n')}
          >
            <Cifra valor={f.sueltos} moneda={moneda} />
          </span>
          <span className="text-right text-[13px]"><Cifra valor={f.total} moneda={moneda} fuerte /></span>
          <button
            type="button"
            onClick={() => onAdd(f.employee.id)}
            title={`Añadir un pago a ${f.employee.name}`}
            className="h-6 w-6 rounded-full flex items-center justify-center text-white/30 hover:text-white hover:bg-[#FF6600]/30 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  )

  return (
    <div className="flex flex-col gap-3 min-w-0">
      {/* Selector de mes */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center rounded-full border border-white/10 bg-white/[0.03]">
          <button type="button" disabled={idx <= 0} onClick={() => onPeriod(periods[idx - 1])} className="h-8 w-8 flex items-center justify-center text-white/60 hover:text-white disabled:opacity-25">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="px-2 min-w-[132px] text-center text-[13px] font-semibold text-white capitalize">{monthLongLabel(period)}</span>
          <button type="button" disabled={idx < 0 || idx >= periods.length - 1} onClick={() => onPeriod(periods[idx + 1])} className="h-8 w-8 flex items-center justify-center text-white/60 hover:text-white disabled:opacity-25">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        {period !== currentPeriod && (
          <button type="button" onClick={() => onPeriod(currentPeriod)} className="h-8 px-3 rounded-full border border-white/10 text-[12px] text-white/60 hover:text-white hover:border-white/25">
            Este mes
          </button>
        )}
        <p className="text-[11px] text-white/40">
          Se paga el <strong className="text-white/70 font-medium">15 de {MONTHS_SHORT[Number(period.slice(5, 7)) - 1]}</strong>
          {' · '}
          ciclo de los comerciales <strong className="text-white/70 font-medium">{ciclo.desde} → {ciclo.hasta}</strong>
          {abierto && <span className="text-[#FF8A3D]"> · todavía abierto</span>}
        </p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.02] overflow-x-auto">
        <div className="min-w-[760px]">
          {cabecera('Comerciales', `Por horas y citas · ciclo ${ciclo.desde} → ${ciclo.hasta}`, comerciales)}
          {tabla(comerciales, true)}
          <div className="border-t border-white/[0.06]" />
          {cabecera('Equipo con sueldo estipulado', `Su sueldo de ${monthLongLabel(period)}`, fijos)}
          {tabla(fijos, false)}
        </div>
      </div>

      {/* Todos los pagos sueltos */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.02]">
        <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-white/[0.06]">
          <div className="flex items-center gap-3">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-white/70">Pagos sueltos</h4>
            <div className="flex rounded-full border border-white/10 p-0.5 text-[11px]">
              {([[false, monthShortLabel(period)], [true, 'Todos']] as const).map(([v, label]) => (
                <button key={String(v)} type="button" onClick={() => setVerTodos(v)} className={`px-2.5 py-0.5 rounded-full capitalize ${verTodos === v ? 'bg-white/10 text-white' : 'text-white/45 hover:text-white'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <span className="text-[12px] text-white/50 tabular-nums">
            {listaPagos.length} {listaPagos.length === 1 ? 'pago' : 'pagos'} · <span className="text-white font-semibold">{shortMoney(totalPagos, moneda)}</span>
          </span>
        </div>
        {error && <p className="px-4 pt-2 text-[12px] text-red-400">{error}</p>}
        {listaPagos.length === 0 ? (
          <p className="px-4 py-5 text-[12px] text-white/35">
            Nada apuntado {verTodos ? 'todavía' : `en ${monthLongLabel(period)}`}. Pulsa «Añadir pago» para una comisión, un bonus o un encargo.
          </p>
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {listaPagos.map((e) => (
              <li key={e.id} className="flex items-center gap-3 px-4 py-2 text-[12.5px]">
                <span className="w-20 flex-shrink-0 text-[10px] uppercase tracking-wider text-white/35 capitalize">{monthShortLabel(e.period)}</span>
                <span className="w-24 flex-shrink-0 truncate text-white font-medium">{nombreDe(e.employee_id)}</span>
                <span className="flex-shrink-0 px-2 py-0.5 rounded-full border border-white/10 text-[10px] text-white/60">{EXTRA_KIND_LABELS[e.kind]}</span>
                <span className="min-w-0 flex-1 truncate text-white/70" title={e.concept}>{e.concept}</span>
                <span className={`tabular-nums font-semibold ${Number(e.amount) < 0 ? 'text-red-300' : 'text-white'}`}>{shortMoney(Number(e.amount), e.currency)}</span>
                <button
                  type="button"
                  onClick={() => alternarPagado(e)}
                  title={e.paid ? 'Pagado: pulsa para marcarlo como pendiente' : 'Pendiente: pulsa para marcarlo como pagado'}
                  className={`h-6 px-2 rounded-full border text-[10.5px] flex items-center gap-1 transition-colors ${e.paid ? 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10' : 'border-white/10 text-white/45 hover:text-white'}`}
                >
                  {e.paid && <Check className="h-3 w-3" />}
                  {e.paid ? 'Pagado' : 'Pendiente'}
                </button>
                <button type="button" onClick={() => quitar(e)} title="Quitar" className="h-6 w-6 rounded-full flex items-center justify-center text-white/25 hover:text-red-300 hover:bg-red-500/10">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
