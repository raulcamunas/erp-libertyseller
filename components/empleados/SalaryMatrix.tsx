'use client'

import { useEffect, useMemo, useRef } from 'react'
import { ArrowDownRight, ArrowUpRight, Clock, CornerDownRight } from 'lucide-react'
import {
  addMonths,
  contractGap,
  employeeMonth,
  isWithinContract,
  monthKeyOf,
  monthShortLabel,
  stepForMonth,
  toDollars,
  PAY_MODEL_COLORS,
  PAY_MODEL_LABELS,
  type Employee,
  type EmployeeMonthAmount,
  type EmployeesDataset,
} from '@/lib/types/employees'
import type { PersonCost } from '@/lib/payroll/cost'
import { hourlyReference, shortMoney, type HourlyReference } from './shared'

export interface SalaryMatrixProps {
  employees: Employee[]
  data: EmployeesDataset
  /** Ventana de meses cargada, en orden y consecutiva */
  periods: string[]
  currentPeriod: string
  usdEur: number
  /** Horas y comisiones reales de «Mis Horas», para el detalle del mes en curso */
  hoursDetail?: Record<string, Record<string, PersonCost>>
  onCellClick: (employee: Employee, period: string) => void
  onOpenEmployee: (employee: Employee) => void
}

/**
 * Ancho de columna de mes. Fijo y conocido porque con él se calcula el
 * desplazamiento inicial: la tabla se abre enseñando el mes en curso, no
 * el de hace un año obligando a arrastrar.
 */
const COL = 86

interface Cell {
  period: string
  month: EmployeeMonthAmount
  /** El escalón entra en vigor justo este mes */
  raise: { delta: number | null; first: boolean } | null
  /** Mes futuro de quien cobra por horas: no se sabe y no se inventa */
  pending: boolean
  /** Referencia orientativa para esos meses. NUNCA suma al total en firme */
  estimate: number | null
  /** Lo que suma en firme, en dólares */
  usd: number
}

/**
 * CUÁNTO COBRA CADA UNO Y CUÁNTO VA A COBRAR
 * ==========================================
 * Personas en las filas, meses en las columnas. Es la tabla que pidió el
 * usuario y el motivo de que el sueldo se guarde como escalones: aquí se ve
 * de un golpe la serie entera sin haber tenido que teclear un importe por mes.
 *
 * LOS QUE COBRAN POR HORAS NO SE PROYECTAN, Y ESO ES DELIBERADO.
 * A un comercial no se le puede poner un número en noviembre: depende de las
 * horas que trabaje y de las citas que cierre, y no ha pasado nada de eso
 * todavía. Sus meses futuros salen con trama discontinua y un «≈» delante de
 * la media de los últimos meses cerrados, que es un hecho del pasado, no una
 * promesa. Esa cifra queda FUERA del total en firme: los totales llevan la
 * parte variable en una segunda línea, separada, para que nadie confunda
 * «esto está comprometido» con «esto suele salir por ahí».
 */
export function SalaryMatrix({
  employees,
  data,
  periods,
  currentPeriod,
  usdEur,
  hoursDetail,
  onCellClick,
  onOpenEmployee,
}: SalaryMatrixProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const currentIndex = periods.indexOf(currentPeriod)

  const rows = useMemo(() => {
    return employees.map((employee) => {
      const reference: HourlyReference | null =
        employee.pay_model === 'horas' ? hourlyReference(employee, data, currentPeriod) : null

      // Lo ya cobrado y lo que queda por cobrar van SEPARADOS a propósito.
      // Sumarlos daría un número con dos naturalezas dentro —doce meses de
      // nómina pagada más doce de nómina futura— y ese número, puesto debajo
      // del nombre, se lee como «lo que cobra esta persona».
      let paid = 0
      let upcoming = 0
      let variable = 0
      let variableMonths = 0

      const cells: Cell[] = periods.map((period) => {
        const month = employeeMonth(employee, period, data)

        // Un mes futuro de quien cobra por horas sale calculado a 0 —no hay
        // horas apuntadas todavía—, y ese 0 es cierto pero engañoso: parece
        // «no cobra» cuando significa «aún no ha trabajado». Se marca por la
        // fecha, no por el importe.
        const pending =
          period > currentPeriod &&
          employee.pay_model === 'horas' &&
          isWithinContract(employee, period)

        let raise: Cell['raise'] = null
        if (month.step && monthKeyOf(month.step.effective_from) === period) {
          const prev = stepForMonth(data.steps, addMonths(period, -1), employee.id)
          const prevAmount = prev ? Number(prev.gross_amount) : null
          raise = {
            first: prevAmount == null,
            delta: prevAmount == null ? null : Number(month.step.gross_amount) - prevAmount,
          }
        }

        const usd = pending ? 0 : toDollars(month.amount, month.currency, usdEur)
        if (pending) {
          variableMonths += 1
          if (reference) variable += reference.amount
        } else if (period < currentPeriod) {
          paid += usd
        } else {
          upcoming += usd
        }

        return {
          period,
          month,
          raise,
          pending,
          estimate: pending ? reference?.amount ?? null : null,
          usd,
        }
      })

      return { employee, cells, paid, upcoming, variable, variableMonths, reference }
    })
  }, [employees, data, periods, currentPeriod, usdEur])

  /**
   * El primer mes que todavía no ha ocurrido. Lleva una línea vertical más
   * marcada: es la frontera entre lo cobrado y lo previsto, y sin ella la
   * única diferencia entre las dos mitades de la tabla es la opacidad del
   * texto, que con el desplazamiento abierto por el mes en curso no se ve.
   */
  const firstFuture = periods.find((p) => p > currentPeriod) ?? null

  /** «may 25 – may 27»: la ventana que abarcan los totales de cada persona */
  const windowLabel =
    periods.length > 0
      ? `${monthShortLabel(periods[0])} – ${monthShortLabel(periods[periods.length - 1])}`
      : ''

  const columnTotals = useMemo(
    () =>
      periods.map((period, i) => {
        let firm = 0
        let variable = 0
        let variableMonths = 0
        for (const row of rows) {
          const c = row.cells[i]
          if (!c) continue
          if (c.pending) {
            variableMonths += 1
            if (c.estimate != null) variable += c.estimate
          } else {
            firm += c.usd
          }
        }
        return { period, firm, variable, variableMonths }
      }),
    [rows, periods]
  )

  // Se abre por el mes en curso, con un par de meses cerrados a la izquierda
  // para tener contexto. Depende solo del índice: si cambia la ventana, se
  // recoloca sola.
  useEffect(() => {
    const el = scrollRef.current
    if (!el || currentIndex < 0) return
    el.scrollLeft = Math.max(0, (currentIndex - 2) * COL)
  }, [currentIndex, periods.length])

  if (employees.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-[13px] text-white/35">Todavía no hay nadie en plantilla.</p>
        <p className="text-[11px] text-white/25 max-w-[320px]">
          Da de alta a la primera persona desde el panel «Plantilla» y aquí aparecerá
          lo que cobra cada mes.
        </p>
      </div>
    )
  }

  return (
    <>
      {/* Leyenda. Cada muestra va pintada EXACTAMENTE como la celda que
          describe —mismo fondo, mismo borde, mismo tono de texto— en vez de
          con un cuadrito de color: un cuadrado relleno para «cerrado» que
          luego no aparece en ninguna celda deja buscando una marca que no
          existe, y con seis estados eso se paga caro. */}
      <div className="px-3 py-1.5 border-b border-white/[0.06] flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-white/40 flex-shrink-0">
        <span className="px-1 text-white/75">cerrado</span>
        <span className="px-1 rounded-[2px] bg-[#FF6600]/[0.07] text-white font-semibold">
          en curso
        </span>
        <span className="px-1 rounded-r-[2px] bg-white/[0.02] border-l border-dashed border-white/25 text-white/50">
          previsto
        </span>
        <span className="flex items-center gap-1">
          <span className="px-1 italic text-white/35 border-b border-dashed border-white/25">
            ≈ variable
          </span>
          sale de las horas
        </span>
        <span className="px-1 rounded-[2px] ring-1 ring-inset ring-green-400/40 text-green-300 flex items-center gap-0.5">
          <ArrowUpRight className="h-2.5 w-2.5" /> subida
        </span>
        <span className="px-1 rounded-[2px] bg-yellow-400/[0.09] text-yellow-400 font-semibold">
          — sin registrar
        </span>
      </div>

      {/* El desplazamiento lateral vive DENTRO de esta caja: con min-w-0 en la
          cadena de contenedores, una tabla de dos metros no arrastra la página
          ni la barra lateral. */}
      <div ref={scrollRef} className="flex-1 overflow-auto min-w-0">
        <table className="border-separate border-spacing-0 text-[12px]">
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky top-0 left-0 z-30 bg-[#0d0d0d] text-left px-2.5 py-1.5 w-[172px] min-w-[172px] text-[10px] font-semibold text-white/40 uppercase tracking-wider border-b border-r border-white/10"
              >
                Empleado
              </th>
              {periods.map((p) => {
                const isCurrent = p === currentPeriod
                const isFuture = p > currentPeriod
                return (
                  <th
                    key={p}
                    scope="col"
                    style={{ width: COL, minWidth: COL }}
                    className={`sticky top-0 z-20 bg-[#0d0d0d] text-right px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider border-b border-white/10 whitespace-nowrap ${
                      p === firstFuture ? 'border-l border-white/25' : ''
                    } ${
                      isCurrent
                        ? 'text-[#FF6600]'
                        : isFuture
                          ? 'text-white/35'
                          : 'text-white/50'
                    }`}
                  >
                    {monthShortLabel(p)}
                  </th>
                )
              })}
            </tr>
          </thead>

          <tbody>
            {rows.map(({ employee, cells, paid, upcoming, variable, variableMonths }) => (
              <tr key={employee.id} className="group">
                <th
                  scope="row"
                  className={`sticky left-0 z-10 bg-[#0d0d0d] text-left px-2.5 py-1 border-b border-r border-white/[0.06] align-top ${
                    isWithinContract(employee, currentPeriod) ? '' : 'opacity-50'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onOpenEmployee(employee)}
                    title={`Abrir la ficha de ${employee.name}`}
                    className="flex items-center gap-1.5 text-[12px] font-medium text-white hover:text-[#FF6600] transition-colors max-w-full"
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: PAY_MODEL_COLORS[employee.pay_model] }}
                      title={PAY_MODEL_LABELS[employee.pay_model]}
                    />
                    <span className="truncate">{employee.name}</span>
                  </button>
                  {/* Lo de esta persona en la ventana, en tres cifras que NO
                      se suman entre sí: lo ya pagado, lo comprometido que
                      queda por pagar y —si cobra por horas— lo variable, que
                      ni siquiera es un compromiso. Un solo número aquí se lee
                      como su sueldo, que es justo lo que no es. */}
                  <span
                    className="block text-[10px] text-white/40 tabular-nums leading-tight"
                    title={`Pagado de ${windowLabel}: meses ya cerrados de ${employee.name}`}
                  >
                    {shortMoney(paid)} <span className="text-white/25">pagado</span>
                  </span>
                  <span
                    className="block text-[10px] text-white/30 tabular-nums leading-tight"
                    title={`Por pagar de ${windowLabel}: este mes y los que vienen, según su sueldo de hoy y las subidas ya programadas`}
                  >
                    {shortMoney(upcoming)} <span className="text-white/25">por pagar</span>
                    {variableMonths > 0 && (
                      <span
                        className="italic text-white/25"
                        title={`${variableMonths} ${
                          variableMonths === 1 ? 'mes' : 'meses'
                        } que dependen de las horas que trabaje: no está comprometido`}
                      >
                        {' '}
                        {variable > 0 ? `+≈ ${shortMoney(variable)}` : '+ variable'}
                      </span>
                    )}
                  </span>
                </th>

                {cells.map((cell) => (
                  <MonthCell
                    key={cell.period}
                    employee={employee}
                    cell={cell}
                    isCurrent={cell.period === currentPeriod}
                    isFuture={cell.period > currentPeriod}
                    isFirstFuture={cell.period === firstFuture}
                    hours={hoursDetail?.[employee.id]?.[cell.period]?.hours}
                    onClick={() => onCellClick(employee, cell.period)}
                  />
                ))}
              </tr>
            ))}
          </tbody>

          <tfoot>
            <tr>
              <th
                scope="row"
                className="sticky bottom-0 left-0 z-30 bg-[#0d0d0d] text-left px-2.5 py-2 text-[10px] font-semibold text-white/40 uppercase tracking-wider border-t border-r border-white/10"
              >
                Total del mes
              </th>
              {columnTotals.map((t) => {
                const isCurrent = t.period === currentPeriod
                return (
                  <td
                    key={t.period}
                    style={{ width: COL, minWidth: COL }}
                    className={`sticky bottom-0 z-20 bg-[#0d0d0d] text-right px-2 py-2 border-t border-white/10 tabular-nums whitespace-nowrap ${
                      t.period === firstFuture ? 'border-l border-white/25' : ''
                    } ${isCurrent ? 'text-[#FF6600]' : 'text-white/70'}`}
                  >
                    <span className="block text-[12px] font-bold">{shortMoney(t.firm)}</span>
                    {t.variableMonths > 0 && (
                      <span
                        className="block text-[9px] italic text-white/30"
                        title={`${t.variableMonths} ${
                          t.variableMonths === 1 ? 'persona cobra' : 'personas cobran'
                        } por horas: este mes aún no ha ocurrido`}
                      >
                        {t.variable > 0 ? `+≈ ${shortMoney(t.variable)}` : '+ variable'}
                      </span>
                    )}
                  </td>
                )
              })}
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  )
}

interface MonthCellProps {
  employee: Employee
  cell: Cell
  isCurrent: boolean
  isFuture: boolean
  /** La primera columna que aún no ha ocurrido: lleva la línea de frontera */
  isFirstFuture: boolean
  /** Horas reales apuntadas ese mes, si la persona cobra por horas */
  hours?: number
  onClick: () => void
}

/** Una celda: el importe del mes, de dónde sale y si ahí hay una subida */
function MonthCell({
  employee,
  cell,
  isCurrent,
  isFuture,
  isFirstFuture,
  hours,
  onClick,
}: MonthCellProps) {
  const { month, raise, pending, estimate, usd } = cell

  // DOS EJES DISTINTOS, DOS MARCAS DISTINTAS.
  // El fondo dice EN QUÉ MOMENTO está ese mes (en curso, previsto, sin
  // registrar) y el aro dice que ahí hay una SUBIDA. Antes competían por el
  // fondo y ganaba la subida, así que el mes en el que entra una —que es casi
  // siempre el mes en curso, como Carla en agosto— perdía el naranja de «hoy»,
  // y un mes cerrado sin registrar con escalón perdía el aviso ámbar.
  let background = ''
  if (isCurrent) {
    background = 'bg-[#FF6600]/[0.07]'
  } else if (month.source === 'sin_registro') {
    background = 'bg-yellow-400/[0.09]'
  } else if (isFuture) {
    // Un velo sobre lo que aún no ha ocurrido, más el borde discontinuo que
    // anuncia la leyenda: separa de un vistazo lo cobrado de lo previsto sin
    // tener que leer ninguna etiqueta.
    background = 'bg-white/[0.02]'
  }

  const frontier = isFirstFuture
    ? 'border-l border-white/25'
    : isFuture
      ? 'border-l border-dashed border-white/[0.12]'
      : ''

  const raiseRing =
    raise && !raise.first
      ? raise.delta != null && raise.delta < 0
        ? 'ring-1 ring-inset ring-yellow-400/40'
        : 'ring-1 ring-inset ring-green-400/40'
      : ''

  let tone: string
  let content: React.ReactNode = shortMoney(usd)
  let title = ''

  if (month.source === 'fuera_de_alta') {
    tone = 'text-white/20'
    content = '·'
    const gap = contractGap(employee, cell.period)
    title =
      gap === 'antes_del_alta'
        ? `${employee.name} todavía no estaba de alta en este mes (alta: ${employee.started_on})`
        : gap === 'despues_de_la_baja'
          ? `${employee.name} ya no estaba en plantilla (baja: ${employee.ended_on})`
          : `${employee.name} está de baja y no tiene fecha puesta, así que no suma en ningún mes`
  } else if (pending) {
    tone = 'text-white/35 italic'
    content =
      estimate != null ? (
        <span className="border-b border-dashed border-white/25">≈ {shortMoney(estimate)}</span>
      ) : (
        <span className="border-b border-dashed border-white/20 text-[10px]">variable</span>
      )
    title =
      estimate != null
        ? `No se sabe: depende de las horas que trabaje y de las citas que cualifique. ${shortMoney(
            estimate
          )} es la media de sus últimos meses cerrados, a título orientativo.`
        : 'Cobra por horas y todavía no hay meses cerrados con los que orientarse.'
  } else if (month.source === 'sin_registro') {
    // Ámbar al 100 %: este aviso también se lee en tema claro, donde la capa
    // de traducción de globals.css no toca los tonos de color y un
    // yellow-300/70 sobre blanco es prácticamente invisible.
    tone = 'text-yellow-400 font-semibold'
    content = '—'
    title =
      month.computed != null
        ? `Este mes no se llegó a registrar, así que suma 0. Con lo que sabemos hoy habrían sido ${shortMoney(
            month.computed
          )}. Pulsa para apuntarlo.`
        : 'Este mes no se llegó a registrar, así que suma 0. Pulsa para apuntarlo.'
  } else if (month.source === 'sin_perfil') {
    tone = 'text-yellow-400 font-semibold'
    content = '—'
    title = `${employee.name} cobra por horas y no tiene perfil del ERP enlazado, así que no hay de dónde sacar su coste y suma 0. Se arregla en su ficha, enlazando el perfil.`
  } else if (month.source === 'sin_datos') {
    tone = 'text-white/20'
    content = '—'
    title = 'Sin escalón de sueldo ni importe registrado. Pulsa para ponerle uno.'
  } else if (isCurrent) {
    tone = 'text-white font-semibold'
    title =
      month.source === 'horas'
        ? `Mes en curso: ${shortMoney(usd)} devengados${
            hours != null ? ` con ${hours.toLocaleString('es-ES')} h apuntadas` : ''
          }. Sube según trabaje.`
        : `Mes en curso, según su escalón de ${shortMoney(usd)}.`
  } else if (isFuture) {
    tone = 'text-white/50'
    title = 'Previsto según su escalón de sueldo. Pulsa para cambiarlo o programar una subida.'
  } else {
    tone = 'text-white/75'
    title = 'Cifra registrada en su momento: un mes cerrado no se reescribe solo.'
  }

  const showsRaise = raise != null && !raise.first && raise.delta != null && raise.delta !== 0
  const up = showsRaise && (raise?.delta ?? 0) > 0

  return (
    <td
      onClick={onClick}
      title={title || undefined}
      style={{ width: COL, minWidth: COL }}
      className={`px-2 py-1 text-right align-top border-b border-white/[0.04] tabular-nums whitespace-nowrap cursor-pointer transition-colors hover:bg-white/[0.06] ${background} ${frontier} ${raiseRing}`}
    >
      <span className={`block text-[12px] ${tone}`}>{content}</span>

      {showsRaise && (
        <span
          className={`flex items-center justify-end gap-0.5 text-[9px] font-semibold ${
            up ? 'text-green-300' : 'text-yellow-300'
          }`}
        >
          {up ? <ArrowUpRight className="h-2.5 w-2.5" /> : <ArrowDownRight className="h-2.5 w-2.5" />}
          {up ? '+' : ''}
          {shortMoney(raise?.delta ?? 0)}
        </span>
      )}

      {raise?.first && (
        <span className="flex items-center justify-end gap-0.5 text-[9px] text-white/30">
          <CornerDownRight className="h-2.5 w-2.5" /> alta
        </span>
      )}

      {/* Desfase entre lo que se apuntó aquel mes y lo que dice el modelo hoy.
          No se elige una de las dos en silencio: se enseña la diferencia. */}
      {month.divergence != null && !pending && (
        <span
          className="block text-[9px] font-semibold text-yellow-400"
          title={`Se registró ${shortMoney(month.recorded ?? 0)} y el modelo dice ${shortMoney(
            month.computed ?? 0
          )}. Manda lo registrado; esto es solo el aviso.`}
        >
          Δ {month.divergence > 0 ? '+' : ''}
          {shortMoney(month.divergence)}
        </span>
      )}

      {isCurrent && month.source === 'horas' && hours != null && (
        <span className="flex items-center justify-end gap-0.5 text-[9px] text-white/30">
          <Clock className="h-2.5 w-2.5" />
          {hours.toLocaleString('es-ES', { maximumFractionDigits: 1 })} h
        </span>
      )}
    </td>
  )
}
