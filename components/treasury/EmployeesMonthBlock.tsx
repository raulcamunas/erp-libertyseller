'use client'

import Link from 'next/link'
import { ArrowUpRight, Clock, Loader2, Lock } from 'lucide-react'
import {
  EMPLOYEES_COLOR,
  currentMonthKey,
  formatMoney,
  toEuros,
} from '@/lib/types/employees'
import type { EmployeeMonthCell, EmployeesMonthTotalWire } from '@/lib/employees/payload'
import { eurosPrecise } from '@/lib/types/treasury'

export interface EmployeesMonthBlockProps {
  /** 'yyyy-MM-01' del mes que se está mirando en Tesorería */
  period: string
  /** Lo que suma este mes. null = todavía no ha llegado del servidor */
  total: EmployeesMonthTotalWire | null
  /** El desglose por persona. Vacío si no toca verlo o si aún no ha llegado */
  cells: EmployeeMonthCell[]
  /** false = quien mira es un partner: ve el total, no quién cobra cuánto */
  detail: boolean
  usdEur: number
  /** Se están pidiendo meses que no venían cargados */
  loading: boolean
  /**
   * El módulo de empleados está desplegado pero sus tablas todavía no existen.
   *
   * Sin esto el bloque diría «nadie en nómina este mes», que es falso: la gente
   * cobra igual, lo que falta es lanzar las migraciones. Y como además los
   * sueldos siguen entonces en las filas viejas de gasto —que ya no cuentan en
   * el total—, el mes sale corto: hay que decirlo, no dejar un cero limpio.
   */
  pendingSetup?: boolean
}

/**
 * EMPLEADOS AL MES
 * ================
 * Ocupa el sitio que tenía la categoría «Equipo» de gastos, con su mismo color
 * azul para no romper el código que el equipo ya tiene aprendido. La
 * diferencia está debajo: esto NO son filas de treasury_expenses, es el
 * resultado de Control empleados.
 *
 * Antes eran siete filas copiadas a mano cada mes. Se ve en los datos que eso
 * no funcionaba: a septiembre le faltaban tres personas y una estaba a cero,
 * no porque no cobraran, sino porque nadie llegó a teclearlo. Un bloque
 * calculado no se puede olvidar de nadie y una subida aparece sola en todos
 * los meses siguientes.
 *
 * Y suma UNA sola vez: la migración 112 sacó esos sueldos de treasury_expenses
 * y dejó el CHECK de la tabla sin la categoría «equipo», así que la base
 * rechaza que alguien vuelva a apuntar un sueldo como gasto suelto.
 */
export function EmployeesMonthBlock({
  period,
  total,
  cells,
  detail,
  usdEur,
  loading,
  pendingSetup,
}: EmployeesMonthBlockProps) {
  const current = currentMonthKey()
  const isFuture = period > current
  const isCurrent = period === current

  // Quien no estaba de alta no se pinta: meterlo con un 0 llenaría el bloque
  // de gente que no cobra y escondería a la que sí. Se filtra ANTES de decidir
  // si el bloque está vacío; si no, un mes anterior a la primera alta pinta la
  // cabecera y debajo un hueco, que parece que algo no ha cargado.
  const visibles = cells.filter((c) => c.month.source !== 'fuera_de_alta')

  /** Cuánta gente sigue devengando este mes. Llega en el total, así que un
      socio —que no ve el desglose— también se entera de que falta mes. */
  const accruingCount = total?.accruing ?? 0

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-white/60">
          <span
            className="h-2 w-2 rounded-sm"
            style={{ backgroundColor: EMPLOYEES_COLOR }}
          />
          Empleados al mes
          {loading && <Loader2 className="h-3 w-3 animate-spin text-white/35" />}
        </span>
        <span className="flex items-center gap-2">
          <span className="text-[11px] text-white/45 tabular-nums">
            {total ? eurosPrecise(total.eur) : '—'}
          </span>
          {/* El enlace solo si quien mira puede entrar: a un partner el
              middleware lo devolvería al panel y parecería que algo falla. */}
          {detail && (
            <Link
              href="/dashboard/empleados"
              title="Abrir Control empleados"
              className="h-5 w-5 rounded flex items-center justify-center text-white/30 hover:text-white hover:bg-white/[0.08] transition-colors"
            >
              <ArrowUpRight className="h-3 w-3" />
            </Link>
          )}
        </span>
      </div>

      {pendingSetup ? (
        /* El cero de aquí no significa que nadie cobre, significa que el módulo
           no está instalado. Decirlo es lo único honesto: con las migraciones
           sin lanzar, los sueldos están todavía en las filas viejas de gasto,
           que ya no cuentan en el total, así que el mes se queda corto. */
        <p className="text-[10px] text-amber-300/70 pl-3.5 leading-relaxed">
          Control empleados aún no está instalado, así que los sueldos no entran en el total de
          este mes. Ejecuta las migraciones 111 a 115 y volverán a contar.
        </p>
      ) : !total ? (
        <p className="text-[10px] text-white/20 pl-3.5">Calculando el coste del equipo...</p>
      ) : !detail ? (
        /* Un partner ve el total —lo necesita para que le cuadre su parte—
           pero no quién cobra cuánto. Se dice, en vez de enseñar una lista
           vacía que parecería que este mes no cobra nadie. */
        <div className="pl-3.5 flex items-start gap-1.5">
          <Lock className="h-3 w-3 mt-0.5 flex-shrink-0 text-white/25" />
          <p className="text-[10px] text-white/30 leading-relaxed">
            {total && total.headcount > 0
              ? `${total.headcount} personas en nómina este mes. El desglose por persona es solo para administración.`
              : 'El desglose por persona es solo para administración.'}
          </p>
        </div>
      ) : visibles.length === 0 ? (
        <p className="text-[10px] text-white/20 pl-3.5">Nadie en nómina este mes</p>
      ) : (
        <div className="space-y-0.5">
          {visibles.map(({ employeeId, name, payModel, month }) => {
            // Mes futuro de quien cobra por horas: sale calculado a 0 porque
            // todavía no ha trabajado. Ese 0 es cierto pero se lee como «no
            // cobra», así que se dice lo que es.
            const pending = isFuture && payModel === 'horas'
            // Y el mes EN CURSO de esa misma persona no es un importe cerrado:
            // es lo que lleva devengado a día de hoy y sube cada día que
            // trabaja. Sin marcarlo se lee como su sueldo del mes y el
            // beneficio de agosto parece mucho mejor de lo que va a ser.
            const accruing = isCurrent && payModel === 'horas'
            const eur = toEuros(month.amount, month.currency, usdEur)

            return (
              <div
                key={employeeId}
                className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-white/[0.03] transition-colors"
              >
                <span className="flex-1 min-w-0 truncate px-1.5 py-1 text-[12px] text-white/80">
                  {name}
                  {month.source === 'sin_registro' && (
                    <span
                      className="ml-1.5 text-[10px] font-medium text-yellow-400"
                      title="Este mes no se llegó a registrar, así que suma 0"
                    >
                      sin registrar
                    </span>
                  )}
                  {month.source === 'sin_perfil' && (
                    <span
                      className="ml-1.5 text-[10px] font-medium text-yellow-400"
                      title="Cobra por horas y no tiene perfil del ERP enlazado, así que su coste no se puede calcular y suma 0. Se arregla en Control empleados, en su ficha."
                    >
                      sin perfil enlazado
                    </span>
                  )}
                  {month.divergence != null && (
                    <span
                      className="ml-1.5 text-[10px] font-medium text-yellow-400 tabular-nums"
                      title={`Se registró ${formatMoney(
                        month.recorded ?? 0,
                        month.currency
                      )} y el modelo dice ${formatMoney(
                        month.computed ?? 0,
                        month.currency
                      )}. Manda lo registrado: un mes cerrado no se reescribe.`}
                    >
                      Δ {month.divergence > 0 ? '+' : ''}
                      {formatMoney(month.divergence, month.currency)}
                    </span>
                  )}
                </span>

                <span className="w-[74px] flex-shrink-0 text-right px-1.5 py-1 text-[13px] text-white tabular-nums">
                  {pending ? (
                    <span className="text-[10px] italic text-white/30">variable</span>
                  ) : accruing ? (
                    <span
                      className="inline-flex items-center justify-end gap-1 italic text-white/70"
                      title={`Lleva devengados ${formatMoney(
                        month.amount,
                        month.currency
                      )} de este mes. Cobra por horas, así que la cifra sube según trabaje: el mes todavía no ha cerrado.`}
                    >
                      <Clock className="h-2.5 w-2.5 flex-shrink-0 text-white/40" />
                      <span className="whitespace-nowrap">
                        {formatMoney(month.amount, month.currency)}
                      </span>
                    </span>
                  ) : (
                    formatMoney(month.amount, month.currency)
                  )}
                </span>

                <span className="w-[62px] flex-shrink-0 text-right text-[10px] text-white/30 tabular-nums">
                  {!pending && month.currency === 'USD' ? eurosPrecise(eur) : ''}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* El mes en curso con gente por horas no es un cierre. Se dice aquí
          también, y no solo con el reloj de cada fila, porque un socio no ve
          el desglose por persona y aun así necesita saber que su parte de este
          mes va a bajar. */}
      {isCurrent && accruingCount > 0 && (
        <p className="mt-1 pl-3.5 flex items-start gap-1.5 text-[10px] text-yellow-400/90 leading-relaxed">
          <Clock className="h-3 w-3 mt-px flex-shrink-0" />
          <span>
            El mes no ha terminado:{' '}
            {accruingCount === 1 ? 'una persona cobra' : `${accruingCount} personas cobran`} por
            horas y su sueldo sube cada día que trabaja. Este gasto todavía va a crecer.
          </span>
        </p>
      )}

      {/* Por qué el bloque no se puede editar aquí. Sin esto, lo primero que
          hace cualquiera es buscar el botón «+» que había antes. */}
      <p className="mt-1 pl-3.5 text-[10px] text-white/25 leading-relaxed">
        Sale de Control empleados, no se apunta aquí. Los sueldos ya no son un gasto suelto:
        así no se puede olvidar a nadie ni contar a nadie dos veces.
      </p>
    </div>
  )
}
