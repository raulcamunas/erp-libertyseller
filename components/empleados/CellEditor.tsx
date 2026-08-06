'use client'

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { CalendarOff, Clock, Loader2, Trash2, TrendingUp, X } from 'lucide-react'
import {
  contractGap,
  employeeMonth,
  formatMoney,
  monthKeyOf,
  monthLongLabel,
  stepForMonth,
  type Employee,
  type EmployeeCurrency,
  type EmployeeMonthRecord,
  type EmployeeSalaryStep,
  type EmployeesDataset,
} from '@/lib/types/employees'
import { fieldInput, ghostButton, parseDecimal, primaryButton, shortMoney } from './shared'

export interface CellEditorProps {
  employee: Employee
  /** 'yyyy-MM-01' de la celda pulsada */
  period: string
  currentPeriod: string
  data: EmployeesDataset
  onClose: () => void
  onStepSaved: (step: EmployeeSalaryStep) => void
  onStepDeleted: (id: string) => void
  onRecordSaved: (record: EmployeeMonthRecord) => void
  onRecordDeleted: (id: string) => void
}

/**
 * QUÉ SE EDITA AL PULSAR UNA CELDA
 * ================================
 * Depende del mes, y la diferencia no es un capricho de la interfaz: es la
 * regla de que la historia no se reescribe sola.
 *
 *   mes en curso o futuro, sueldo fijo -> se edita el ESCALÓN. Poner un
 *     importe con fecha de efecto arrastra ese sueldo hacia adelante hasta la
 *     siguiente subida, que es exactamente lo que se quiere al pactar una.
 *
 *   mes ya cerrado -> se edita lo REGISTRADO en aquel mes, y solo ese mes.
 *     Hace falta poder hacerlo: hay meses que nadie llegó a teclear —a
 *     septiembre le faltaban tres personas— y taparlos con el escalón de hoy
 *     cambiaría el beneficio de un mes que ya se cerró. Por eso se avisa.
 *
 *   mes en curso o futuro, por horas -> no se edita nada. Ese importe sale de
 *     «Mis Horas» y ponerlo a mano aquí crearía una segunda cifra para el
 *     mismo mes, que es el problema que este módulo vino a quitar.
 */
export function CellEditor({
  employee,
  period,
  currentPeriod,
  data,
  onClose,
  onStepSaved,
  onStepDeleted,
  onRecordSaved,
  onRecordDeleted,
}: CellEditorProps) {
  const supabase = createClient()
  const isPast = period < currentPeriod

  const month = useMemo(() => employeeMonth(employee, period, data), [employee, period, data])

  const existingStep = useMemo(
    () =>
      data.steps.find(
        (s) => s.employee_id === employee.id && monthKeyOf(s.effective_from) === period
      ) ?? null,
    [data.steps, employee.id, period]
  )
  const existingRecord = useMemo(
    () =>
      data.records.find(
        (r) => r.employee_id === employee.id && monthKeyOf(r.period) === period
      ) ?? null,
    [data.records, employee.id, period]
  )
  const previousStep = useMemo(
    () => stepForMonth(data.steps, period, employee.id),
    [data.steps, period, employee.id]
  )

  /**
   * Un mes FUERA DE LAS FECHAS DEL CONTRATO no se rellena, y no es una manía.
   * La celda de ese mes se pinta con un «·» y dice «no estaba de alta», pero
   * el formulario de mes cerrado dejaba guardar igual, y un mes con registro
   * vale lo registrado por encima del contrato: ese importe empezaba a sumar
   * en el gasto de un mes en el que esa persona no estaba contratada. La celda
   * decía una cosa y el editor hacía la contraria.
   *
   * Dos matices que hacen que esto no estorbe:
   *   - se mira por FECHAS (contractGap), no con isWithinContract: a alguien
   *     de baja sin fecha hay que poder seguir corrigiéndole el histórico;
   *   - si ese mes YA tiene un importe apuntado, se abre el editor normal.
   *     Justo ahí es donde hace falta poder entrar: para quitarlo.
   */
  const gap = existingRecord ? null : contractGap(employee, period)

  const mode: 'escalon' | 'registro' | 'horas' | 'fuera_de_alta' = gap
    ? 'fuera_de_alta'
    : isPast
      ? 'registro'
      : employee.pay_model === 'fijo'
        ? 'escalon'
        : 'horas'

  const initialAmount =
    mode === 'escalon'
      ? existingStep
        ? String(existingStep.gross_amount)
        : previousStep && monthKeyOf(previousStep.effective_from) !== period
          ? String(previousStep.gross_amount)
          : ''
      : existingRecord
        ? String(existingRecord.amount)
        : month.computed != null
          ? String(Math.round(month.computed * 100) / 100)
          : ''

  const [amount, setAmount] = useState(initialAmount)
  const [reason, setReason] = useState(existingStep?.reason ?? '')
  const [notes, setNotes] = useState(existingRecord?.notes ?? '')
  const [currency, setCurrency] = useState<EmployeeCurrency>(
    (mode === 'escalon' ? existingStep?.currency : existingRecord?.currency) ??
      employee.currency
  )
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const parsed = parseDecimal(amount)
  const invalid = parsed === undefined || parsed === null || parsed < 0
  const delta =
    mode === 'escalon' && previousStep && !invalid && monthKeyOf(previousStep.effective_from) !== period
      ? parsed - Number(previousStep.gross_amount)
      : null

  async function save() {
    if (invalid) return
    setSaving(true)
    try {
      if (mode === 'escalon') {
        const { data: row, error } = await supabase
          .from('employee_salary_steps')
          .upsert(
            {
              ...(existingStep ? { id: existingStep.id } : {}),
              employee_id: employee.id,
              effective_from: period,
              gross_amount: parsed,
              currency,
              reason: reason.trim() || null,
            },
            { onConflict: 'employee_id,effective_from' }
          )
          .select('*')
          .single()
        if (error) throw error
        onStepSaved(row as EmployeeSalaryStep)
        toast.success(
          `${employee.name}: ${formatMoney(parsed, currency)} desde ${monthLongLabel(period)}`
        )
      } else {
        const { data: row, error } = await supabase
          .from('employee_month_records')
          .upsert(
            {
              ...(existingRecord ? { id: existingRecord.id } : {}),
              employee_id: employee.id,
              period,
              amount: parsed,
              currency,
              source: 'manual',
              paid: existingRecord?.paid ?? false,
              notes: notes.trim() || null,
            },
            { onConflict: 'employee_id,period' }
          )
          .select('*')
          .single()
        if (error) throw error
        onRecordSaved(row as EmployeeMonthRecord)
        toast.success(`${monthLongLabel(period)} de ${employee.name} corregido`)
      }
      onClose()
    } catch (err) {
      console.error('Error guardando el importe del mes:', err)
      toast.error('No se ha podido guardar')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    const table = mode === 'escalon' ? 'employee_salary_steps' : 'employee_month_records'
    const id = mode === 'escalon' ? existingStep?.id : existingRecord?.id
    if (!id) return
    setSaving(true)
    try {
      // .select() para saber si ha borrado de verdad: con RLS, borrar sin
      // permiso no da error, simplemente no borra, y la fila volvería al
      // recargar como si nada hubiera pasado.
      const { data: gone, error } = await supabase.from(table).delete().eq('id', id).select('id')
      if (error) throw error
      if (!gone || gone.length === 0) {
        toast.error('Tu usuario no puede borrar aquí')
        return
      }
      if (mode === 'escalon') onStepDeleted(id)
      else onRecordDeleted(id)
      onClose()
    } catch (err) {
      console.error('Error borrando el importe del mes:', err)
      toast.error('No se ha podido borrar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.18 }}
        className="relative w-full max-w-md max-h-[85vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#0d0d0d] p-4 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-white truncate">{employee.name}</h3>
            <p className="text-[11px] text-white/40 capitalize">{monthLongLabel(period)}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-7 w-7 flex-shrink-0 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {mode === 'fuera_de_alta' ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 space-y-1.5">
              <p className="flex items-center gap-1.5 text-[12px] font-semibold text-white">
                <CalendarOff className="h-3.5 w-3.5 text-white/45" />
                {gap === 'antes_del_alta' ? 'Todavía no estaba de alta' : 'Ya no estaba en plantilla'}
              </p>
              <p className="text-[11px] text-white/55 leading-relaxed">
                {gap === 'antes_del_alta' ? (
                  <>
                    {employee.name} figura de alta desde{' '}
                    <strong className="text-white/75">
                      {monthLongLabel(monthKeyOf(employee.started_on!))}
                    </strong>
                    , así que {monthLongLabel(period)} queda fuera de su contrato.
                  </>
                ) : (
                  <>
                    {employee.name} causó baja el{' '}
                    <strong className="text-white/75">{employee.ended_on}</strong>, así que{' '}
                    {monthLongLabel(period)} queda fuera de su contrato.
                  </>
                )}
              </p>
              <p className="text-[11px] text-white/40 leading-relaxed">
                Apuntar aquí un importe haría que ese mes empezara a sumar sueldo en Tesorería
                para alguien que no estaba contratado. Si la fecha está mal, se corrige en su
                ficha y esta celda se abre sola.
              </p>
            </div>
            <div className="flex justify-end">
              <button type="button" onClick={onClose} className={ghostButton}>
                Entendido
              </button>
            </div>
          </div>
        ) : mode === 'horas' ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 space-y-1.5">
              <p className="flex items-center gap-1.5 text-[12px] font-semibold text-white">
                <Clock className="h-3.5 w-3.5 text-[#22C55E]" /> Cobra por horas
              </p>
              <p className="text-[11px] text-white/55 leading-relaxed">
                Lo que cobre este mes sale de <strong className="text-white/75">Mis Horas</strong>:
                las horas que apunte por su tarifa, más la comisión de cada cita cualificada.
                Todavía no ha pasado, así que aquí no hay un número que poner.
              </p>
              <p className="text-[11px] text-white/40 leading-relaxed">
                Escribirlo a mano crearía una segunda cifra para el mismo mes, y entonces
                Tesorería y «Mis Horas» dirían cosas distintas.
              </p>
            </div>
            {month.computed != null && month.computed > 0 && (
              <p className="text-[11px] text-white/45">
                Llevan devengados {shortMoney(month.computed)} de este mes.
              </p>
            )}
            <div className="flex justify-end">
              <button type="button" onClick={onClose} className={ghostButton}>
                Entendido
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {mode === 'escalon' ? (
              <p className="text-[11px] text-white/45 leading-relaxed">
                Este importe pasa a ser lo que cobra{' '}
                <strong className="text-white/70">desde {monthLongLabel(period)}</strong> y se
                arrastra a todos los meses siguientes hasta que haya otra subida.
              </p>
            ) : (
              <p className="text-[11px] text-yellow-300/70 leading-relaxed">
                {monthLongLabel(period)} ya está cerrado. Lo que se toque aquí cambia solo ese
                mes —ni el sueldo de hoy ni los que vienen— y mueve el beneficio y el reparto
                entre socios de aquel mes en Tesorería.
              </p>
            )}

            <div>
              <label className="block text-[10px] uppercase tracking-wider text-white/35 mb-1">
                {mode === 'escalon' ? 'Sueldo bruto al mes' : 'Importe registrado'}
              </label>
              <div className="flex items-center gap-2">
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  inputMode="decimal"
                  autoFocus
                  placeholder="0"
                  className={`${fieldInput} text-right tabular-nums`}
                />
                <button
                  type="button"
                  onClick={() => setCurrency(currency === 'USD' ? 'EUR' : 'USD')}
                  title="Cambiar divisa"
                  className="h-[30px] w-10 flex-shrink-0 rounded-lg border border-white/10 bg-white/[0.04] text-[13px] font-semibold text-white/70 hover:text-white hover:border-white/25 transition-colors"
                >
                  {currency === 'USD' ? '$' : '€'}
                </button>
              </div>
              {delta != null && delta !== 0 && (
                <p
                  className={`mt-1 flex items-center gap-1 text-[11px] ${
                    delta > 0 ? 'text-green-300' : 'text-yellow-300'
                  }`}
                >
                  <TrendingUp className="h-3 w-3" />
                  {delta > 0 ? 'Sube' : 'Baja'} {formatMoney(Math.abs(delta), currency)} respecto a{' '}
                  {formatMoney(Number(previousStep?.gross_amount), currency)}
                </p>
              )}
            </div>

            {mode === 'escalon' ? (
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-white/35 mb-1">
                  Por qué sube
                </label>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Revisión anual, más responsabilidad..."
                  className={fieldInput}
                />
                <p className="mt-1 text-[10px] text-white/30">
                  Dentro de seis meses nadie se acuerda de por qué cambió.
                </p>
              </div>
            ) : (
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-white/35 mb-1">
                  Nota del mes
                </label>
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Paga extra, mes a medias..."
                  className={fieldInput}
                />
              </div>
            )}

            {/* Lo que ya se sabe de este mes. Cuando lo registrado y lo
                calculado no coinciden se enseñan los dos: el módulo no elige
                en silencio cuál es el bueno. */}
            {(month.recorded != null || month.computed != null) && (
              <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 space-y-1">
                {month.recorded != null && (
                  <p className="flex items-center justify-between text-[11px]">
                    <span className="text-white/40">Registrado en su día</span>
                    <span className="text-white/75 tabular-nums">
                      {formatMoney(month.recorded, existingRecord?.currency ?? employee.currency)}
                    </span>
                  </p>
                )}
                {month.computed != null && (
                  <p className="flex items-center justify-between text-[11px]">
                    <span className="text-white/40">
                      {employee.pay_model === 'horas' ? 'Según Mis Horas' : 'Según su escalón'}
                    </span>
                    <span className="text-white/75 tabular-nums">
                      {formatMoney(month.computed, employee.currency)}
                    </span>
                  </p>
                )}
                {month.divergence != null && (
                  <p className="flex items-center justify-between text-[11px] text-yellow-300/80">
                    <span>Diferencia</span>
                    <span className="tabular-nums">
                      {month.divergence > 0 ? '+' : ''}
                      {formatMoney(month.divergence, employee.currency)}
                    </span>
                  </p>
                )}
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              {/* El botón se enseña solo si hay ALGO QUE BORRAR EN EL MODO
                  ACTIVO, que es lo único que sabe borrar remove(). Con la
                  condición antigua aparecía «Quitar escalón» en un mes que
                  solo tenía registro —Yasury en agosto, por ejemplo— y al
                  pulsarlo no pasaba nada: ni borraba, ni avisaba, ni cerraba,
                  y quien lo pulsaba se quedaba convencido de que sí. */}
              {(mode === 'escalon' ? existingStep : existingRecord) && (
                <button
                  type="button"
                  onClick={() => (confirmDelete ? remove() : setConfirmDelete(true))}
                  disabled={saving}
                  className={`h-8 px-3 rounded-full border text-[12px] font-medium flex items-center gap-1.5 transition-colors disabled:opacity-50 ${
                    confirmDelete
                      ? 'border-red-400/50 bg-red-500/15 text-red-300'
                      : 'border-white/10 bg-white/[0.03] text-white/50 hover:text-red-300 hover:border-red-400/30'
                  }`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {confirmDelete ? '¿Seguro?' : mode === 'escalon' ? 'Quitar escalón' : 'Quitar'}
                </button>
              )}
              <div className="flex-1" />
              <button type="button" onClick={onClose} className={ghostButton}>
                Cancelar
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving || invalid}
                className={primaryButton}
              >
                {saving && <Loader2 className="h-3 w-3 animate-spin" />}
                Guardar
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  )
}
