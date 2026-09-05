'use client'

import { useMemo } from 'react'
import { Check, Loader2, PanelRightOpen, Plus } from 'lucide-react'
import {
  PAY_MODEL_COLORS,
  PAY_MODEL_HINTS,
  PAY_MODEL_LABELS,
  HOURS_UNIT_LABELS,
  contractedHoursPerMonth,
  employeeMonth,
  formatMoney,
  isWithinContract,
  monthLongLabel,
  type Employee,
  type EmployeesDataset,
  type EmployeeMonthAmount,
} from '@/lib/types/employees'
import type { PersonCost } from '@/lib/payroll/cost'
import { numInput, textInput, parseDecimal } from './shared'

export interface EmployeesListProps {
  employees: Employee[]
  data: EmployeesDataset
  currentPeriod: string
  hoursDetail?: Record<string, Record<string, PersonCost>>
  onPatch: (employee: Employee, patch: Partial<Employee>) => void
  onOpen: (employee: Employee) => void
  onAdd: () => void
  adding: boolean
  /** Lo pone el tablero para ocultar el panel en móvil («hidden» gana a «flex») */
  className?: string
}

/**
 * LA PLANTILLA
 * ============
 * Quién está, qué hace, cuántas horas tiene contratadas y qué cobra.
 *
 * La columna «reales» está pegada a «contratadas» a propósito: son el mismo
 * dato mirado desde dos sitios —lo pactado y lo que de verdad se apuntó en
 * «Mis Horas»— y hasta ahora no había forma de compararlos sin abrir dos
 * pantallas. Cuando no cuadran, se ve aquí.
 */

/**
 * Los encargos del mes, resumidos para que quepan en la celda.
 *
 * Se agrupan POR DIVISA y no se convierten: aquí no se conoce el tipo de
 * cambio, y enseñar «+80 US$» cuando eran euros sería peor que enseñar dos
 * cifras. El detalle entero está en el title y en la ficha.
 */
function agrupaExtras(extras: EmployeeMonthAmount['extras']): string {
  const porDivisa = new Map<string, number>()
  for (const e of extras) {
    porDivisa.set(e.currency, (porDivisa.get(e.currency) ?? 0) + Number(e.amount))
  }
  return [...porDivisa]
    .map(([divisa, importe]) => `+${formatMoney(importe, divisa as 'EUR' | 'USD')}`)
    .join(' · ')
}

export function EmployeesList({
  employees,
  data,
  currentPeriod,
  hoursDetail,
  onPatch,
  onOpen,
  onAdd,
  adding,
  className = '',
}: EmployeesListProps) {
  const rows = useMemo(
    () =>
      employees.map((employee) => ({
        employee,
        month: employeeMonth(employee, currentPeriod, data),
        cost: hoursDetail?.[employee.id]?.[currentPeriod],
        contracted: contractedHoursPerMonth(employee),
        // «En plantilla» es la marca Y las fechas, igual que en el cálculo del
        // coste: con la baja puesta para el mes que viene sigue estando hoy.
        enPlantilla: isWithinContract(employee, currentPeriod),
      })),
    [employees, data, currentPeriod, hoursDetail]
  )

  return (
    <div
      className={`rounded-2xl border border-white/10 bg-white/[0.02] flex flex-col min-h-0 min-w-0 overflow-hidden ${className}`}
    >
      <div className="px-3 py-2 border-b border-white/[0.06] flex items-center justify-between gap-2 flex-shrink-0">
        <h3 className="text-[10px] font-semibold text-white/45 uppercase tracking-wider flex items-center gap-2">
          Plantilla
          <button
            type="button"
            onClick={onAdd}
            disabled={adding}
            title="Dar de alta a una persona"
            className="normal-case tracking-normal text-[11px] font-medium text-white/45 hover:text-white transition-colors flex items-center gap-1 disabled:opacity-50"
          >
            {adding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            Nueva persona
          </button>
        </h3>
        <span className="text-[11px] text-white/35 capitalize">{monthLongLabel(currentPeriod)}</span>
      </div>

      {employees.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 px-6 py-8 text-center">
          <p className="text-[13px] text-white/35">Todavía no hay nadie dado de alta.</p>
          <p className="text-[11px] text-white/25 max-w-[340px]">
            Añade a la primera persona con «Nueva persona» y ponle su sueldo desde la ficha.
          </p>
        </div>
      ) : (
        /* El desplazamiento lateral se queda dentro de esta caja: con min-w-0
           en la cadena, ocho columnas no arrastran la página en horizontal. */
        <div className="flex-1 overflow-auto min-w-0">
          <table className="w-full min-w-[860px] text-[12px] border-collapse">
            <thead className="sticky top-0 bg-[#0d0d0d] z-10">
              <tr>
                <Th className="text-left px-2.5">Empleado</Th>
                <Th className="text-left px-2">Puesto</Th>
                <Th className="text-center px-1 w-[104px]">Cobro</Th>
                <Th className="text-right px-1 w-[110px]">Contratadas</Th>
                <Th className="text-right px-1 w-[92px]">Reales</Th>
                <Th className="text-right px-2 w-[104px]">Este mes</Th>
                <Th className="text-center px-1 w-[62px]">Activo</Th>
                <Th className="text-center px-1 w-[48px]">Ficha</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ employee, month, cost, contracted, enPlantilla }) => {
                const hours = cost?.hours ?? null
                // Verde si lo apuntado se parece a lo pactado, ámbar si no.
                // El margen es ancho a propósito: un mes tiene semanas de más
                // y de menos y no compensa que se encienda cada dos por tres.
                const hoursTone =
                  hours == null || contracted == null
                    ? 'text-white/45'
                    : hours >= contracted * 0.85 && hours <= contracted * 1.15
                      ? 'text-green-300/80'
                      : 'text-yellow-300/80'

                return (
                  <tr
                    key={employee.id}
                    className={`border-b border-white/[0.04] group transition-colors hover:bg-white/[0.03] ${
                      enPlantilla ? '' : 'opacity-50'
                    }`}
                  >
                    <td className="px-1.5 py-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="h-1.5 w-1.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: PAY_MODEL_COLORS[employee.pay_model] }}
                        />
                        <input
                          key={`name-${employee.id}`}
                          defaultValue={employee.name}
                          onBlur={(e) => {
                            const v = e.target.value.trim()
                            if (v && v !== employee.name) onPatch(employee, { name: v })
                          }}
                          className={`${textInput} font-medium`}
                        />
                      </div>
                    </td>

                    <td className="px-1 py-1">
                      <input
                        key={`role-${employee.id}`}
                        defaultValue={employee.role_label ?? ''}
                        onBlur={(e) => {
                          const v = e.target.value.trim()
                          if (v !== (employee.role_label ?? ''))
                            onPatch(employee, { role_label: v || null })
                        }}
                        placeholder="—"
                        className={`${textInput} text-white/65`}
                      />
                    </td>

                    <td className="px-1 py-1 text-center">
                      <button
                        type="button"
                        onClick={() =>
                          onPatch(employee, {
                            pay_model: employee.pay_model === 'fijo' ? 'horas' : 'fijo',
                          })
                        }
                        title={PAY_MODEL_HINTS[employee.pay_model]}
                        className="px-2 py-0.5 rounded-full border border-white/10 bg-white/[0.02] text-[10px] font-medium text-white/65 hover:text-white hover:border-white/25 transition-colors whitespace-nowrap"
                      >
                        {PAY_MODEL_LABELS[employee.pay_model]}
                      </button>
                    </td>

                    <td className="px-1 py-1">
                      <div className="flex items-center gap-1 justify-end">
                        <input
                          key={`hours-${employee.id}`}
                          defaultValue={
                            employee.contracted_hours != null
                              ? String(employee.contracted_hours)
                              : ''
                          }
                          onBlur={(e) => {
                            const parsed = parseDecimal(e.target.value)
                            if (parsed === undefined) return
                            if (parsed !== null && parsed < 0) return
                            if ((employee.contracted_hours ?? null) === parsed) return
                            onPatch(employee, { contracted_hours: parsed })
                          }}
                          inputMode="decimal"
                          placeholder="—"
                          className={`${numInput} w-[46px]`}
                        />
                        <button
                          type="button"
                          onClick={() =>
                            onPatch(employee, {
                              hours_unit: employee.hours_unit === 'mes' ? 'semana' : 'mes',
                            })
                          }
                          title="Cambiar entre horas al mes y a la semana"
                          className="flex-shrink-0 text-[10px] text-white/35 hover:text-white transition-colors whitespace-nowrap"
                        >
                          {HOURS_UNIT_LABELS[employee.hours_unit]}
                        </button>
                      </div>
                    </td>

                    <td className={`px-1 py-1 text-right tabular-nums ${hoursTone}`}>
                      {employee.pay_model === 'horas' ? (
                        hours != null ? (
                          <span
                            title={
                              contracted != null
                                ? `${hours.toLocaleString('es-ES', {
                                    maximumFractionDigits: 1,
                                  })} h apuntadas frente a ${contracted.toLocaleString('es-ES', {
                                    maximumFractionDigits: 1,
                                  })} h contratadas al mes`
                                : 'Horas apuntadas este mes en «Mis Horas»'
                            }
                          >
                            {hours.toLocaleString('es-ES', { maximumFractionDigits: 1 })} h
                          </span>
                        ) : (
                          <span className="text-white/20" title="Sin perfil del ERP enlazado">
                            —
                          </span>
                        )
                      ) : (
                        <span className="text-white/20">·</span>
                      )}
                    </td>

                    <td className="px-2 py-1 text-right tabular-nums">
                      {month.amount !== 0 ? (
                        <span className="text-white font-semibold">
                          {formatMoney(month.amount, month.currency)}
                        </span>
                      ) : month.extras.length === 0 ? (
                        <span className="text-white/20">—</span>
                      ) : null}
                      {/* LOS ENCARGOS SE VEN AQUÍ, NO SOLO EN LA FICHA.
                          Van debajo del sueldo y en naranja: si solo estuvieran
                          dentro de la ficha, desde esta lista el mes de Carla
                          seguiría poniendo 250 US$ mientras Tesorería cobra 330,
                          y la diferencia solo aparecería al abrirla. */}
                      {month.extras.length > 0 && (
                        <div
                          className="text-[10px] font-medium text-[#FF6600]"
                          title={month.extras
                            .map((x) => `${x.concept}: ${formatMoney(Number(x.amount), x.currency)}`)
                            .join('\n')}
                        >
                          {agrupaExtras(month.extras)}
                        </div>
                      )}
                    </td>

                    <td className="px-1 py-1 text-center">
                      <button
                        type="button"
                        // Volver a activar limpia la fecha de baja: dejarla
                        // puesta mantendría a la persona fuera de plantilla y
                        // la casilla parecería no funcionar.
                        onClick={() =>
                          onPatch(
                            employee,
                            enPlantilla
                              ? { is_active: false }
                              : { is_active: true, ended_on: null }
                          )
                        }
                        className={`h-5 w-5 rounded border flex items-center justify-center transition-colors mx-auto ${
                          enPlantilla
                            ? 'bg-green-500/25 border-green-500/50 text-green-300'
                            : 'border-white/15 text-transparent hover:border-white/25'
                        }`}
                        title={
                          enPlantilla
                            ? 'En plantilla'
                            : employee.ended_on
                              ? `De baja desde el ${employee.ended_on}`
                              : 'De baja'
                        }
                      >
                        <Check className="h-3 w-3" />
                      </button>
                    </td>

                    <td className="px-1 py-1 text-center">
                      <button
                        type="button"
                        onClick={() => onOpen(employee)}
                        title="Abrir la ficha: escalones de sueldo y notas"
                        className="h-6 w-6 rounded flex items-center justify-center text-white/30 hover:text-white hover:bg-white/[0.08] transition-colors mx-auto"
                      >
                        <PanelRightOpen className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Th({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return (
    <th
      className={`py-1.5 text-[10px] font-semibold text-white/40 uppercase tracking-wider border-b border-white/10 whitespace-nowrap ${className}`}
    >
      {children}
    </th>
  )
}
