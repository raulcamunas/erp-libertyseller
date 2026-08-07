'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { AlarmClock, AlertTriangle, Eraser, Loader2, Send, UserX } from 'lucide-react'
import { monthKeyOf } from '@/lib/types/employees'
import {
  NOTICE_DAYS,
  checkVacationRequest,
  formatDayLong,
  formatDayRange,
  formatDays,
  round2,
  type VacationEmployee,
  type VacationRequest,
} from '@/lib/types/vacations'
import { postVacations, type VacationsMutation } from '@/lib/vacations/client'
import { VacacionesCalendar, type DaySelection } from './VacacionesCalendar'
import { errorBox, fieldInput, ghostButton, primaryButton, warnBox } from './shared'

/**
 * PEDIR UNOS DÍAS: el calendario y lo que cuesta lo que se ha elegido.
 *
 * Todo lo que se enseña mientras se arrastra sale de `checkVacationRequest`,
 * que es LA MISMA función que ejecuta la ruta de API antes de guardar. Una sola
 * fuente para las dos: con dos, la pantalla acabaría diciendo que sí a algo que
 * el servidor rechaza, y a la inversa.
 *
 * QUÉ FRENA EL BOTÓN Y QUÉ SOLO AVISA
 * -----------------------------------
 * Frena lo que produciría un dato incoherente: fechas del revés, un rango que
 * no consume ni un día laborable, un SOLAPE con otra petición viva, o una
 * persona a la que no se le ha puesto tarifa de vacaciones.
 * Solo avisa lo demás, incluido pedir con menos de 30 días y pasarse del saldo.
 * Las aprueba un admin una a una, con toda la información delante; bloquear el
 * envío solo conseguiría que se pidiera por WhatsApp y no quedara registrado.
 */

export interface PeticionFormProps {
  employee: VacationEmployee
  /** Todas las peticiones de esa persona: de aquí salen los solapes y el saldo */
  requests: VacationRequest[]
  today: string
  /** Un admin registrando la petición EN NOMBRE de otra persona */
  onBehalf?: boolean
  onDone: (data: VacationsMutation) => void
}

export function PeticionForm({
  employee,
  requests,
  today,
  onBehalf = false,
  onDone,
}: PeticionFormProps) {
  const [month, setMonth] = useState(() => monthKeyOf(today))
  const [selection, setSelection] = useState<DaySelection | null>(null)
  const [reason, setReason] = useState('')
  const [sending, setSending] = useState(false)

  const check = useMemo(() => {
    if (!selection) return null
    return checkVacationRequest({
      employee,
      startDate: selection.start,
      endDate: selection.end,
      requests,
      today,
      // Los avisos los lee la propia persona salvo que sea un admin
      // registrando por ella: de ahí que tuteen o no.
      propio: !onBehalf,
    })
  }, [selection, employee, requests, today, onBehalf])

  /**
   * DE QUÉ BOLSA SALEN LOS DÍAS ELEGIDOS.
   *
   * La regla nueva con más consecuencias es que EL ARRASTRE SE GASTA PRIMERO y
   * caduca el 31 de marzo. Sin esta línea, quien pide cinco días en febrero no
   * podía saber si estaba salvando su arrastre o gastando el devengo del año
   * nuevo, que es justo la decisión que le hace perder o no perder días.
   */
  const delArrastre = useMemo(
    () => check?.byYear.filter((y) => y.fromCarry > 0) ?? [],
    [check]
  )

  async function submit() {
    if (!selection || !check?.ok || sending) return
    setSending(true)
    try {
      const result = await postVacations('/api/vacations', {
        // Solo lo manda un admin: para cualquier otro rol el servidor lo
        // ignora y se queda con su propia ficha, se mande lo que se mande.
        employee_id: onBehalf ? employee.id : undefined,
        start_date: selection.start,
        end_date: selection.end,
        reason: reason.trim() || undefined,
      })

      if (!result.ok) {
        toast.error(result.error)
        return
      }

      toast.success(
        onBehalf
          ? `Petición registrada a nombre de ${employee.name}: ${formatDayRange(selection.start, selection.end)}`
          : `Pedidas: ${formatDayRange(selection.start, selection.end)}. Queda pendiente de aprobar.`
      )
      // Los avisos que no frenaron el envío se enseñan DESPUÉS de guardar, para
      // que quien la pidió sepa que ha entrado marcada.
      for (const w of result.data.warnings ?? []) toast.warning(w)

      setSelection(null)
      setReason('')
      onDone(result.data)
    } finally {
      setSending(false)
    }
  }

  const sinCuenta = !employee.user_id

  return (
    <div className="space-y-3 min-w-0">
      {onBehalf && sinCuenta && (
        <div className={warnBox}>
          <span className="inline-flex items-center gap-1.5 font-semibold">
            <UserX className="h-3 w-3" />
            {employee.name} no tiene cuenta en el ERP.
          </span>{' '}
          No puede entrar a pedir sus vacaciones ni a mirar su saldo: se las tienes que registrar
          tú desde aquí. Para que lo haga ella misma, créale un usuario y enlázalo desde su ficha.
        </div>
      )}

      <VacacionesCalendar
        month={month}
        onMonthChange={setMonth}
        today={today}
        requests={requests}
        selection={selection}
        onSelectionChange={setSelection}
      />

      {/* Lo que cuesta lo elegido */}
      {selection && check ? (
        <div className="space-y-2">
          <div className="rounded-xl border border-[#FF6600]/25 bg-[#FF6600]/[0.07] px-3 py-2.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wider text-white/40">Has elegido</p>
                <p className="text-[15px] font-semibold text-white leading-tight">
                  {formatDays(check.workingDays)} laborables
                </p>
                <p className="text-[11px] text-white/50 truncate">
                  {formatDayRange(selection.start, selection.end)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-wider text-white/40">
                  Saldo si se aprueba
                  {check.byYear.length === 1 && ` (${check.byYear[0].year})`}
                </p>
                <p
                  className={`text-[15px] font-semibold tabular-nums leading-tight ${
                    check.balanceAfter < 0 ? 'text-red-400' : 'text-white'
                  }`}
                >
                  {formatDays(check.balanceAfter)}
                </p>
                <p className="text-[11px] text-white/40">
                  {check.noticeDays >= NOTICE_DAYS
                    ? `Con ${check.noticeDays} días de antelación`
                    : 'Fuera de plazo'}
                </p>
              </div>
            </div>

            {/* EL RANGO QUE CRUZA EL FIN DE AÑO, DESGLOSADO.
                Los días se imputan al año en que caen las fechas, así que unas
                vacaciones del 28 de diciembre al 4 de enero gastan de dos
                bolsas distintas. Con un solo número —el del año de hoy— el
                resumen diría que caben de sobra mientras deja el año que viene
                en negativo, y eso no se descubriría hasta enero. */}
            {check.byYear.length > 1 && (
              <div className="mt-2 pt-2 border-t border-white/10 space-y-1">
                <p className="text-[10px] uppercase tracking-wider text-white/40">
                  Estas fechas cruzan el fin de año
                </p>
                {check.byYear.map((y) => (
                  <div
                    key={y.year}
                    className="flex items-baseline justify-between gap-2 text-[11px]"
                  >
                    <span className="text-white/60">
                      {formatDays(y.days)} de <span className="text-white">{y.year}</span>
                    </span>
                    <span
                      className={`tabular-nums ${
                        y.availableAfter < 0 ? 'text-red-400' : 'text-white/45'
                      }`}
                    >
                      {onBehalf ? 'le quedarían' : 'te quedarían'} {formatDays(y.availableAfter)} de{' '}
                      {y.year}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* DE QUÉ BOLSA SALEN. El arrastre se gasta antes que el devengo del
                año, y es el único de los dos que caduca: quien lo ve puede
                decidir con conocimiento. */}
            {delArrastre.length > 0 && (
              <div className="mt-2 pt-2 border-t border-white/10 space-y-1">
                {delArrastre.map((y) => (
                  <p
                    key={y.year}
                    className="flex items-start gap-1.5 text-[11px] text-white/55 leading-snug"
                  >
                    <AlarmClock className="h-3 w-3 flex-shrink-0 mt-0.5" />
                    <span>
                      <span className="text-white">{formatDays(y.fromCarry)}</span> salen del
                      arrastre de {y.year - 1}, que caduca el{' '}
                      {formatDayLong(y.carryExpiresOn)}
                      {y.days > y.fromCarry && (
                        <>
                          , y {formatDays(round2(y.days - y.fromCarry))} del devengo de {y.year}
                        </>
                      )}
                      . El arrastre se gasta primero a propósito: es el único que se pierde.
                    </span>
                  </p>
                ))}
              </div>
            )}
          </div>

          {check.errors.map((e) => (
            <p key={e} className={`${errorBox} flex items-start gap-1.5`}>
              <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5" />
              <span>{e}</span>
            </p>
          ))}

          {check.warnings.map((w) => (
            <p key={w} className={`${warnBox} flex items-start gap-1.5`}>
              <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5" />
              <span>{w}</span>
            </p>
          ))}

          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Por qué (opcional). Ayuda a quien tiene que organizar el trabajo esos días."
            className={`${fieldInput} resize-none`}
          />

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={submit}
              disabled={!check.ok || sending}
              className={primaryButton}
            >
              {sending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Send className="h-3 w-3" />
              )}
              {onBehalf ? 'Registrar la petición' : 'Pedir estos días'}
            </button>
            <button
              type="button"
              onClick={() => setSelection(null)}
              disabled={sending}
              className={ghostButton}
            >
              <Eraser className="h-3 w-3" />
              Borrar
            </button>
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-white/35 leading-relaxed">
          Elige los días en el calendario. Solo cuentan de lunes a viernes, y hay que avisar con{' '}
          {NOTICE_DAYS} días: si se pide con menos, se puede mandar igual pero entra marcada como
          fuera de plazo.
        </p>
      )}
    </div>
  )
}
