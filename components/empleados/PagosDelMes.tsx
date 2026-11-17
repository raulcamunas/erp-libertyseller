'use client'

import { useEffect, useMemo, useState } from 'react'
import { Briefcase, Check, Clock, Landmark, Plus, Receipt, Trash2, Users } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import {
  EXTRA_KIND_LABELS,
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
import { COLOR_ESTADO, type TonoEstado } from '@/lib/estilo/denso'
import { CabeceraTarjeta, Iniciales, Pastilla, Tarjeta, velo } from '@/components/contabilidad/ui'
import { shortMoney } from './shared'

export interface PagosDelMesProps {
  employees: Employee[]
  data: EmployeesDataset
  hoursDetail: Record<string, Record<string, PersonCost>>
  period: string
  currentPeriod: string
  usdEur: number
  moneda: EmployeeCurrency
  onAdd: (employeeId?: string) => void
  onOpenEmployee: (employee: Employee) => void
  extras: EmployeeExtra[]
  onExtrasChange: (lista: EmployeeExtra[]) => void
}

interface Fila {
  employee: Employee
  base: number
  citas: number
  sueltos: number
  total: number
  horas: number | null
  nCitas: number | null
  extras: EmployeeExtra[]
  fuente: ReturnType<typeof employeeMonth>['source']
}

interface DatoBanco {
  employeeId: string
  datos: { banco: string; cuenta: string; moneda: string } | null
}

/**
 * LOS PAGOS DEL MES, PERSONA A PERSONA (lo que antes era «Este mes» y «Plantilla», juntos).
 *
 * Los números salen del mismo motor que Tesorería (`employeeMonth` + `hoursDetail`): los comerciales por el ciclo 15→14 que se paga ese mes, el resto por
 * su sueldo estipulado, y encima los pagos sueltos. Al lado de cada persona, si ya tiene sus datos de pago (para el lote del día 15). Pulsar el nombre abre
 * su ficha, donde se cambia el puesto, la forma de cobro, las horas contratadas y el sueldo (lo que se editaba en «Plantilla»).
 */
export function PagosDelMes({ employees, data, hoursDetail, period, currentPeriod, usdEur, moneda, onAdd, onOpenEmployee, extras, onExtrasChange }: PagosDelMesProps) {
  const supabase = createClient()
  const [verTodos, setVerTodos] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [bancos, setBancos] = useState<Map<string, DatoBanco['datos']> | null>(null)

  useEffect(() => {
    fetch('/api/employees/datos-de-pago', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { equipo?: DatoBanco[] } | null) => setBancos(j?.equipo ? new Map(j.equipo.map((e) => [e.employeeId, e.datos])) : null))
      .catch(() => setBancos(null))
  }, [])

  const conv = (n: number, cur: EmployeeCurrency) => (moneda === 'USD' ? toDollars(n, cur, usdEur) : toEuros(n, cur, usdEur))

  const filas = useMemo(() => {
    const out: Fila[] = []
    for (const employee of employees) {
      const m = employeeMonth(employee, period, data)
      if (!isWithinContract(employee, period) && m.extras.length === 0) continue
      const cost = hoursDetail[employee.id]?.[period]
      const porHoras = (m.source === 'horas' || (m.source === 'sin_registro' && employee.pay_model === 'horas')) && cost
      const base = porHoras ? conv(cost.salary, 'USD') : conv(m.amount, m.currency)
      const citas = porHoras ? conv(cost.commissions, 'USD') : 0
      const sueltos = m.extras.reduce((s, e) => s + conv(Number(e.amount), e.currency), 0)
      out.push({ employee, base, citas, sueltos, total: base + citas + sueltos, horas: porHoras ? cost.hours : null, nCitas: porHoras ? cost.appointments : null, extras: m.extras, fuente: m.source })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employees, data, hoursDetail, period, moneda, usdEur])

  const comerciales = filas.filter((f) => f.employee.pay_model === 'horas')
  const fijos = filas.filter((f) => f.employee.pay_model !== 'horas')
  const maxTotal = Math.max(1, ...filas.map((f) => f.total))
  const abierto = period === currentPeriod && new Date().getDate() <= 14
  const nombreDe = (id: string) => employees.find((e) => e.id === id)?.name ?? '—'

  const listaPagos = useMemo(
    () => extras.filter((e) => verTodos || e.period.slice(0, 7) === period.slice(0, 7)).sort((a, b) => b.period.localeCompare(a.period) || b.created_at.localeCompare(a.created_at)),
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

  const grupo = (titulo: string, sub: string, icono: typeof Users, t: TonoEstado, lista: Fila[], porHoras: boolean) => (
    <Tarjeta>
      <CabeceraTarjeta
        icono={icono}
        titulo={titulo}
        sub={sub}
        tonoIcono={t}
        accion={<span className="text-[16px] font-semibold tabular-nums text-[var(--ls-t1)]">{shortMoney(lista.reduce((s, f) => s + f.total, 0), moneda)}</span>}
      />
      <div className="overflow-x-auto px-2 pb-2">
        <div className="min-w-[720px]">
          <div className="grid grid-cols-[minmax(170px,1.4fr)_minmax(120px,1fr)_84px_84px_84px_minmax(150px,1fr)_118px_30px] items-center gap-x-3 px-2 pb-1 text-[11px] font-medium text-[var(--ls-t4)]">
            <span>Persona</span>
            <span>{porHoras ? 'Ciclo' : 'Condición'}</span>
            <span className="text-right">{porHoras ? 'Horas' : 'Sueldo'}</span>
            <span className="text-right">{porHoras ? 'Citas' : ''}</span>
            <span className="text-right">Sueltos</span>
            <span className="text-right">A pagar</span>
            <span>Datos de pago</span>
            <span />
          </div>
          {lista.length === 0 && <p className="px-2 py-4 text-[12.5px] text-[var(--ls-t3)]">Nadie en este grupo este mes.</p>}
          {lista.map((f) => {
            const banco = bancos?.get(f.employee.id)
            const aviso = f.fuente === 'sin_registro' || f.fuente === 'sin_perfil'
            return (
              <div key={f.employee.id} className="group grid grid-cols-[minmax(170px,1.4fr)_minmax(120px,1fr)_84px_84px_84px_minmax(150px,1fr)_118px_30px] items-center gap-x-3 rounded-xl px-2 py-2 transition-colors hover:bg-[var(--ls-sup2)]">
                <button type="button" onClick={() => onOpenEmployee(f.employee)} className="flex min-w-0 items-center gap-2.5 text-left" title="Abrir su ficha (puesto, forma de cobro, horas, sueldo)">
                  <Iniciales nombre={f.employee.name} tono={t} tam={30} />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold text-[var(--ls-t1)] group-hover:text-[var(--ls-acc)]">{f.employee.name}</span>
                    <span className="block truncate text-[11px] text-[var(--ls-t3)]">{f.employee.role_label || (porHoras ? 'Comercial' : 'Sin puesto')}</span>
                  </span>
                </button>
                <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-[var(--ls-t3)]">
                  {porHoras && f.horas != null ? (
                    <>
                      {abierto && <Clock className="h-3 w-3 shrink-0" style={{ color: COLOR_ESTADO.naranja }} aria-label="Todavía suben" />}
                      <span className="tabular-nums">{Math.round(f.horas * 10) / 10} h</span>·<span className="tabular-nums">{f.nCitas} {f.nCitas === 1 ? 'cita' : 'citas'}</span>
                    </>
                  ) : aviso ? (
                    <Pastilla tono="ambar">{f.fuente === 'sin_perfil' ? 'Sin perfil enlazado' : 'Sin apuntar'}</Pastilla>
                  ) : f.fuente === 'registrado' ? (
                    'Apuntado'
                  ) : (
                    'Sueldo estipulado'
                  )}
                </span>
                <span className="text-right text-[12.5px] tabular-nums text-[var(--ls-t2)]">{f.base ? shortMoney(f.base, moneda) : '—'}</span>
                <span className="text-right text-[12.5px] tabular-nums text-[var(--ls-t2)]">{porHoras ? (f.citas ? shortMoney(f.citas, moneda) : '—') : ''}</span>
                <span className="text-right text-[12.5px] tabular-nums" title={f.extras.map((e) => `${EXTRA_KIND_LABELS[e.kind]}: ${e.concept} (${shortMoney(Number(e.amount), e.currency)})`).join('\n')} style={{ color: f.sueltos ? COLOR_ESTADO.violeta : 'var(--ls-t4)' }}>
                  {f.sueltos ? `+${shortMoney(f.sueltos, moneda)}` : '—'}
                </span>
                <span className="flex items-center justify-end gap-2.5">
                  <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-[var(--ls-sup3)] lg:block">
                    <span className="block h-full rounded-full" style={{ width: `${Math.max(3, (f.total / maxTotal) * 100)}%`, background: COLOR_ESTADO[t] }} />
                  </span>
                  <span className="text-[14px] font-semibold tabular-nums text-[var(--ls-t1)]">{shortMoney(f.total, moneda)}</span>
                </span>
                <span className="min-w-0">
                  {bancos === null ? (
                    <span className="text-[11px] text-[var(--ls-t4)]">—</span>
                  ) : banco ? (
                    <span className="inline-flex max-w-full items-center gap-1 truncate text-[11.5px] text-[var(--ls-t2)]" title={`${banco.banco} ${banco.cuenta} · ${banco.moneda}`}>
                      <Landmark className="h-3 w-3 shrink-0" style={{ color: COLOR_ESTADO.verde }} />
                      <span className="truncate">{banco.cuenta} · {banco.moneda}</span>
                    </span>
                  ) : (
                    <Pastilla tono="ambar" title="Pídeselos desde «Datos de pago»">Sin datos</Pastilla>
                  )}
                </span>
                <button type="button" onClick={() => onAdd(f.employee.id)} title={`Añadir un pago a ${f.employee.name}`} className="grid h-7 w-7 place-items-center rounded-lg text-[var(--ls-t4)] transition-colors hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-acc)]">
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </Tarjeta>
  )

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {grupo('Comerciales', `Por horas y citas del ciclo que se paga en ${monthLongLabel(period)}`, Briefcase, 'naranja', comerciales, true)}
      {grupo('Equipo con sueldo estipulado', `Su sueldo de ${monthLongLabel(period)}`, Users, 'azul', fijos, false)}

      <Tarjeta>
        <CabeceraTarjeta
          icono={Receipt}
          titulo="Pagos sueltos"
          sub={`${listaPagos.length} ${listaPagos.length === 1 ? 'pago' : 'pagos'} · ${shortMoney(totalPagos, moneda)} · comisiones, bonus y encargos`}
          tonoIcono="violeta"
          accion={
            <div className="flex rounded-lg border border-[var(--ls-linea)] p-0.5 text-[11.5px]">
              {([[false, monthShortLabel(period)], [true, 'Todos']] as const).map(([v, label]) => (
                <button key={String(v)} type="button" onClick={() => setVerTodos(v)} className={`rounded-md px-2.5 py-1 capitalize ${verTodos === v ? 'bg-[var(--ls-sup3)] text-[var(--ls-t1)]' : 'text-[var(--ls-t3)] hover:text-[var(--ls-t1)]'}`}>
                  {label}
                </button>
              ))}
            </div>
          }
        />
        {error && <p className="px-4 pb-2 text-[12px]" style={{ color: COLOR_ESTADO.rojo }}>{error}</p>}
        {listaPagos.length === 0 ? (
          <p className="px-4 pb-4 text-[12.5px] text-[var(--ls-t3)]">Nada apuntado {verTodos ? 'todavía' : `en ${monthLongLabel(period)}`}. Pulsa «Añadir pago» para una comisión, un bonus o un encargo.</p>
        ) : (
          <ul className="px-2 pb-2">
            {listaPagos.map((e) => (
              <li key={e.id} className="flex items-center gap-3 rounded-xl px-2 py-2 text-[12.5px] hover:bg-[var(--ls-sup2)]">
                <Iniciales nombre={nombreDe(e.employee_id)} tono="violeta" tam={26} />
                <span className="w-28 shrink-0 truncate font-medium text-[var(--ls-t1)]">{nombreDe(e.employee_id)}</span>
                <span className="shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium" style={{ background: velo('violeta', 14), color: COLOR_ESTADO.violeta }}>
                  {EXTRA_KIND_LABELS[e.kind]}
                </span>
                <span className="min-w-0 flex-1 truncate text-[var(--ls-t2)]" title={e.concept}>
                  {e.concept}
                </span>
                <span className="hidden w-16 shrink-0 text-[11px] capitalize text-[var(--ls-t4)] sm:block">{monthShortLabel(e.period)}</span>
                <span className="font-semibold tabular-nums" style={{ color: Number(e.amount) < 0 ? COLOR_ESTADO.rojo : 'var(--ls-t1)' }}>
                  {shortMoney(Number(e.amount), e.currency)}
                </span>
                <button
                  type="button"
                  onClick={() => alternarPagado(e)}
                  title={e.paid ? 'Pagado: pulsa para marcarlo como pendiente' : 'Pendiente: pulsa para marcarlo como pagado'}
                  className="inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-[11px] font-semibold"
                  style={e.paid ? { background: velo('verde', 14), color: COLOR_ESTADO.verde } : { background: 'var(--ls-sup3)', color: 'var(--ls-t3)' }}
                >
                  {e.paid && <Check className="h-3 w-3" />}
                  {e.paid ? 'Pagado' : 'Pendiente'}
                </button>
                <button type="button" onClick={() => quitar(e)} title="Quitar" className="grid h-7 w-7 place-items-center rounded-lg text-[var(--ls-t4)] hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-e-rojo)]">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Tarjeta>
    </div>
  )
}
