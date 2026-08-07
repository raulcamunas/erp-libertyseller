'use client'

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { AlarmClock, CalendarOff, Palmtree, TrendingUp } from 'lucide-react'
import { monthKeyOf } from '@/lib/types/employees'
import {
  formatDayLong,
  formatDays,
  vacationBalance,
  type VacationEmployee,
} from '@/lib/types/vacations'
import { postVacations, type VacationsMutation, type VacationsView } from '@/lib/vacations/client'
import { BalanceResumen } from './BalanceResumen'
import { PeticionCard } from './PeticionCard'
import { PeticionForm } from './PeticionForm'
import { VacacionesCalendar } from './VacacionesCalendar'
import { cardShell } from './shared'

/**
 * MIS VACACIONES — la pantalla de quien las pide.
 *
 * NI UN SOLO DATO SALARIAL, y no por disciplina al escribirla: lo que le llega
 * es un `VacationEmployee`, que es un subconjunto de la ficha SIN sueldo, sin
 * escalones y sin horas. El servidor no le manda el dato, así que no hay forma
 * de que se le escape a la pantalla. Por eso esto vive en /dashboard/vacaciones
 * y no dentro de Control empleados, que está cerrada a admin justo porque
 * enseña los sueldos de todo el equipo.
 *
 * Quien la abre solo puede hacer dos cosas: pedir días y retirar una petición
 * suya que todavía no le hayan contestado. Aprobar es de dirección, y no basta
 * con esconder el botón —el navegador habla con PostgREST directamente—: la
 * migración 116 le quita a `authenticated` el permiso de escribir en
 * vacation_requests (desde el navegador la tabla solo se lee) y las rutas
 * comprueban el rol con `requireAdmin()`. Aquí solo se decide qué se dibuja.
 */

export interface MisVacacionesProps {
  employee: VacationEmployee
  initialData: VacationsView
}

export function MisVacaciones({ employee, initialData }: MisVacacionesProps) {
  const [data, setData] = useState<VacationsView>(initialData)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [month, setMonth] = useState(() => monthKeyOf(initialData.today))

  // La ficha se refresca con lo que devuelve cada escritura: si dirección
  // corrige la fecha de alta o la tarifa, el saldo de esta pantalla tiene que
  // salir de la ficha nueva y no de la que llegó al abrirla.
  const ficha = useMemo(
    () => data.employees.find((e) => e.id === employee.id) ?? employee,
    [data.employees, employee]
  )

  const misPeticiones = useMemo(
    () =>
      [...data.requests]
        .filter((r) => r.employee_id === ficha.id)
        .sort((a, b) => b.start_date.localeCompare(a.start_date) || b.id.localeCompare(a.id)),
    [data.requests, ficha.id]
  )

  const balance = useMemo(
    () => vacationBalance(ficha, data.requests, data.today),
    [ficha, data.requests, data.today]
  )

  const genera = ficha.vacation_days_per_month != null

  async function retirar(id: string) {
    if (!confirm('¿Retiras esta petición? Los días vuelven a tu saldo.')) return
    setBusyId(id)
    try {
      const result = await postVacations<VacationsMutation>(`/api/vacations/${id}/cancel`)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(result.data.message ?? 'Petición retirada')
      setData(result.data)
    } finally {
      setBusyId(null)
    }
  }

  if (!genera) {
    return (
      <div className="max-w-2xl space-y-3">
        <div className={`${cardShell} p-5`}>
          <CalendarOff className="h-5 w-5 text-white/25 mb-2" />
          <p className="text-[14px] text-white/75">Tu ficha no tiene vacaciones configuradas</p>
          <p className="text-[12px] text-white/45 mt-1 leading-relaxed">
            No es que se te hayan acabado: es que todavía no se han puesto los días que generas
            por cada mes trabajado. Díselo a dirección y lo dejan puesto en un minuto desde tu
            ficha.
          </p>
        </div>

        {misPeticiones.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-[10px] uppercase tracking-wider text-white/45">Tus peticiones</h2>
            {misPeticiones.map((r) => (
              <PeticionCard
                key={r.id}
                request={r}
                employee={ficha}
                people={data.people}
                today={data.today}
                isAdmin={false}
                busy={busyId === r.id}
                onCancel={() => retirar(r.id)}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4 min-w-0">
      {/* Lo que llevas generado */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#FF6600]/[0.13] via-white/[0.03] to-transparent p-4"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -right-16 h-56 w-56 rounded-full bg-[#FF6600]/20 blur-3xl"
        />
        {/* EL NÚMERO GRANDE SOLO SALE CUANDO SIGNIFICA ALGO.
            Sin fecha de alta en la ficha no hay desde cuándo contar, y el saldo
            sale a cero por falta de un dato, no porque se hayan gastado los
            días. Un «Puedes pedir 0 días» a 44px se lee exactamente como «te
            los has gastado todos», y el aviso que lo explicaba iba después, a
            11px. Un cero que parece un dato es peor que un fallo. */}
        {balance.accrual.missingStartDate ? (
          <div className="relative">
            <p className="text-[10px] uppercase tracking-[0.14em] text-white/40 flex items-center gap-1.5">
              <CalendarOff className="h-3 w-3" /> Todavía no se puede contar tu saldo
            </p>
            <p className="text-white font-semibold text-[17px] sm:text-[20px] leading-snug mt-1.5 max-w-lg">
              Falta tu fecha de alta en la ficha, así que no se sabe desde cuándo contar tus días.
            </p>
            <p className="text-[11px] text-white/45 mt-1.5 max-w-lg leading-relaxed">
              No es que no hayas generado vacaciones: generas{' '}
              {formatDays(ficha.vacation_days_per_month ?? 0)} por cada mes completo trabajado, y
              en cuanto dirección ponga la fecha aparecen todos de golpe. Díselo y lo dejan puesto
              en un minuto.
            </p>
          </div>
        ) : (
          <div className="relative">
            <p className="text-[10px] uppercase tracking-[0.14em] text-white/40 flex items-center gap-1.5">
              <TrendingUp className="h-3 w-3" /> Puedes pedir en {balance.year}
            </p>
            <p className="text-white font-bold text-[34px] sm:text-[44px] leading-none mt-1.5 tabular-nums">
              {formatDays(balance.available)}
            </p>
            <p className="text-[11px] text-white/45 mt-1.5 max-w-lg leading-relaxed">
              Generas {formatDays(ficha.vacation_days_per_month ?? 0)} por cada mes completo que
              trabajas, y el período es el año natural: del 1 de enero al 31 de diciembre. Solo
              cuentan de lunes a viernes, y hay que avisar con un mes de antelación.
            </p>

            {/* LO QUE SE CADUCA, EN EL SITIO MÁS VISIBLE DE LA PANTALLA.
                Enterarse en abril de que se han perdido cinco días no sirve de
                nada: el aviso tiene que estar donde se mira el saldo, con la
                fecha delante y mientras todavía se pueda hacer algo. */}
            {/* En AMARILLO y no en ámbar: el amarillo es el código de aviso de
                todo el ERP y es el único tono que la capa `html.light` de
                globals.css sabe traducir. El ámbar no está ahí, así que en tema
                claro este aviso —el más importante de la pantalla— salía a
                1,10:1 de contraste, es decir, invisible. */}
            {balance.carriedLeft > 0 && (
              <p className="mt-2.5 inline-flex items-start gap-1.5 rounded-lg border border-yellow-500/25 bg-yellow-400/[0.06] px-2.5 py-1.5 text-[11px] text-yellow-300 leading-snug max-w-lg">
                <AlarmClock className="h-3.5 w-3.5 flex-shrink-0 mt-px" />
                <span>
                  <strong className="font-semibold">
                    {formatDays(balance.carriedLeft)} te caducan el{' '}
                    {formatDayLong(balance.carriedExpiresOn)}
                  </strong>
                  : son los que te sobraron de {balance.year - 1}. Se gastan antes que los de este
                  año, así que todo lo que pidas hasta esa fecha sale de ahí. Lo que quede el 1 de
                  abril se pierde.
                </span>
              </p>
            )}
          </div>
        )}
      </motion.div>

      {/* El aviso de caducidad ya va arriba, en el héroe. Sin `sinAvisoCaducidad`
          BalanceResumen pintaba el suyo justo debajo: el mismo párrafo dos veces
          seguidas, y un aviso repetido deja de leerse. */}
      <BalanceResumen employee={ficha} balance={balance} size="amplio" sinAvisoCaducidad />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 min-w-0">
        {/* Pedir días */}
        <section className="space-y-2 min-w-0">
          <h2 className="text-[10px] uppercase tracking-wider text-white/45 flex items-center gap-1.5">
            <Palmtree className="h-3 w-3" /> Planifica tus vacaciones
          </h2>
          <PeticionForm
            employee={ficha}
            requests={misPeticiones}
            today={data.today}
            onDone={setData}
          />
        </section>

        {/* Lo pedido */}
        <section className="space-y-2 min-w-0">
          <h2 className="text-[10px] uppercase tracking-wider text-white/45">
            Tus peticiones {misPeticiones.length > 0 && `(${misPeticiones.length})`}
          </h2>

          {misPeticiones.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/15 px-4 py-8 text-center">
              <p className="text-[13px] text-white/55">Todavía no has pedido ningún día</p>
              <p className="text-[11px] text-white/35 mt-1 leading-relaxed">
                Elige las fechas en el calendario y mándalas. Dirección tiene que aprobarlas, y
                mientras esperan ya cuentan como reservadas.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {misPeticiones.map((r) => (
                <PeticionCard
                  key={r.id}
                  request={r}
                  employee={ficha}
                  people={data.people}
                  today={data.today}
                  isAdmin={false}
                  busy={busyId === r.id}
                  onCancel={() => retirar(r.id)}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Vista de solo lectura del año: el calendario de arriba está para
          elegir; este está para mirar cómo queda el mes que sea sin tocar la
          selección que se esté preparando. */}
      <section className="space-y-2">
        <h2 className="text-[10px] uppercase tracking-wider text-white/45">
          Tu calendario, mes a mes
        </h2>
        <div className={`${cardShell} p-3`}>
          <VacacionesCalendar
            month={month}
            onMonthChange={setMonth}
            today={data.today}
            requests={misPeticiones}
            selection={null}
            onSelectionChange={() => {}}
            readOnly
          />
        </div>
      </section>
    </div>
  )
}
