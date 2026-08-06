'use client'

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarClock,
  Clock,
  Loader2,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import {
  PAY_MODELS,
  PAY_MODEL_COLORS,
  PAY_MODEL_HINTS,
  PAY_MODEL_LABELS,
  HOURS_UNIT_LABELS,
  contractedHoursPerMonth,
  currentStep,
  formatMoney,
  isWithinContract,
  monthKeyOf,
  monthLongLabel,
  type Employee,
  type EmployeeNote,
  type EmployeeSalaryStep,
  type EmployeesDataset,
  type HoursUnit,
  type LinkableProfile,
  type PayModel,
} from '@/lib/types/employees'
import type { PersonCost } from '@/lib/payroll/cost'
import type { UserProfile } from '@/lib/supabase/get-user-profile'
import { EmployeeNotes } from './EmployeeNotes'
import {
  dateInput,
  fieldInput,
  fromMonthInput,
  ghostButton,
  parseDecimal,
  primaryButton,
  toMonthInput,
} from './shared'

export interface EmployeeDetailProps {
  employee: Employee
  currentUser: UserProfile
  data: EmployeesDataset
  /** Perfiles del ERP a los que se puede enlazar a quien cobra por horas */
  profiles: LinkableProfile[]
  notes: EmployeeNote[]
  /** Horas y comisiones reales del mes en curso, si cobra por horas */
  monthCost?: PersonCost
  currentPeriod: string
  onClose: () => void
  /** Guarda en la base y actualiza el estado del tablero */
  onPatch: (patch: Partial<Employee>) => Promise<void>
  onDeleted: (id: string) => void
  onStepSaved: (step: EmployeeSalaryStep) => void
  onStepDeleted: (id: string) => void
  onNotesChange: (list: EmployeeNote[]) => void
}

/**
 * LA FICHA DE UNA PERSONA
 * =======================
 * Tres cosas, y el orden importa: sus condiciones, el historial de subidas y
 * las notas fechadas.
 *
 * El historial de subidas es la única vista donde el modelo de escalones se ve
 * tal cual es —una serie con fechas de efecto— y donde se programa una subida
 * futura, que era medio encargo: «necesito saber cuánto van a cobrar». Aquí
 * eso no es una previsión, es un compromiso ya escrito.
 */
export function EmployeeDetail({
  employee,
  currentUser,
  data,
  profiles,
  notes,
  monthCost,
  currentPeriod,
  onClose,
  onPatch,
  onDeleted,
  onStepSaved,
  onStepDeleted,
  onNotesChange,
}: EmployeeDetailProps) {
  const supabase = createClient()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)

  const steps = useMemo(
    () =>
      data.steps
        .filter((s) => s.employee_id === employee.id)
        .sort((a, b) => a.effective_from.localeCompare(b.effective_from)),
    [data.steps, employee.id]
  )

  const vigente = currentStep(data.steps, employee.id)
  const contractedMonthly = contractedHoursPerMonth(employee)

  /**
   * «En plantilla» es lo que dicen las FECHAS y la marca juntas, no la marca
   * sola: alguien con fecha de baja el mes que viene sigue en plantilla hoy, y
   * alguien cuya baja ya pasó no lo está aunque nadie haya tocado la casilla.
   * Es la misma cuenta con la que se decide si su sueldo suma en Tesorería.
   */
  const enPlantilla = isWithinContract(employee, currentPeriod)

  async function handleDelete() {
    setBusy(true)
    try {
      // .select() para saber si ha borrado de verdad: con RLS, un borrado sin
      // permiso no da error, simplemente no borra nada.
      const { data: gone, error } = await supabase
        .from('employees')
        .delete()
        .eq('id', employee.id)
        .select('id')
      if (error) throw error
      if (!gone || gone.length === 0) {
        toast.error('Tu usuario no puede borrar empleados. Dale de baja en su lugar')
        return
      }
      onDeleted(employee.id)
      onClose()
    } catch (err) {
      console.error('Error borrando el empleado:', err)
      toast.error('No se ha podido borrar')
    } finally {
      setBusy(false)
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
        initial={{ opacity: 0, y: 12, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.18 }}
        className="relative w-full max-w-3xl max-h-[88vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#0d0d0d] p-4 shadow-2xl"
      >
        {/* Cabecera */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className="h-2 w-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: PAY_MODEL_COLORS[employee.pay_model] }}
              />
              <h3 className="text-[16px] font-semibold text-white truncate">{employee.name}</h3>
              {!enPlantilla && (
                <span className="text-[10px] uppercase tracking-wider text-white/35 border border-white/15 rounded-full px-2 py-0.5">
                  De baja
                </span>
              )}
            </div>
            <p className="text-[11px] text-white/40 mt-0.5">
              {employee.role_label || 'Sin puesto'} · {PAY_MODEL_LABELS[employee.pay_model]}
              {vigente ? ` · ${formatMoney(Number(vigente.gross_amount), vigente.currency)}/mes` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-7 w-7 flex-shrink-0 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* ---------- Condiciones ---------- */}
          <section className="space-y-3">
            <h4 className="text-[10px] font-semibold text-white/45 uppercase tracking-wider">
              Condiciones
            </h4>

            <div className="grid grid-cols-2 gap-2">
              <Field label="Nombre">
                <input
                  key={`name-${employee.id}`}
                  defaultValue={employee.name}
                  onBlur={(e) => {
                    const v = e.target.value.trim()
                    if (v && v !== employee.name) onPatch({ name: v })
                  }}
                  className={fieldInput}
                />
              </Field>
              <Field label="Puesto">
                <input
                  key={`role-${employee.id}`}
                  defaultValue={employee.role_label ?? ''}
                  onBlur={(e) => {
                    const v = e.target.value.trim()
                    if (v !== (employee.role_label ?? '')) onPatch({ role_label: v || null })
                  }}
                  placeholder="Comercial, asistente..."
                  className={fieldInput}
                />
              </Field>
            </div>

            <Field label="Cómo cobra">
              <div className="flex gap-1.5">
                {PAY_MODELS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => employee.pay_model !== m && onPatch({ pay_model: m as PayModel })}
                    title={PAY_MODEL_HINTS[m]}
                    className={`flex-1 px-2 py-1.5 rounded-lg text-[11px] font-medium border transition-colors ${
                      employee.pay_model === m
                        ? 'border-[#FF6600]/50 bg-[#FF6600]/[0.1] text-white'
                        : 'border-white/10 bg-white/[0.02] text-white/45 hover:text-white hover:border-white/20'
                    }`}
                  >
                    {PAY_MODEL_LABELS[m]}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[10px] text-white/30 leading-relaxed">
                {PAY_MODEL_HINTS[employee.pay_model]}
              </p>
            </Field>

            {/* EL ENLACE CON EL PERFIL DEL ERP.
                Solo para quien cobra por horas, porque es de donde sale su
                coste. Sin enlace su sueldo es 0 en Tesorería todos los meses,
                en silencio y para siempre, y hasta ahora la ficha lo avisaba
                pero no ofrecía arreglarlo: había que entrar por SQL. */}
            {employee.pay_model === 'horas' && (
              <Field label="Perfil del ERP («Mis Horas»)">
                <select
                  value={employee.user_id ?? ''}
                  onChange={(e) => {
                    const v = e.target.value || null
                    if (v !== (employee.user_id ?? null)) onPatch({ user_id: v })
                  }}
                  className={`${fieldInput} [color-scheme:dark]`}
                >
                  <option value="">— sin enlazar —</option>
                  {profiles.map((p) => {
                    const takenBy = data.employees.find(
                      (e) => e.user_id === p.id && e.id !== employee.id
                    )
                    return (
                      <option key={p.id} value={p.id} disabled={!!takenBy}>
                        {p.full_name || p.email || p.id}
                        {p.email && p.full_name ? ` · ${p.email}` : ''}
                        {takenBy ? ` (ya es ${takenBy.name})` : ''}
                      </option>
                    )
                  })}
                </select>
                {!employee.user_id && (
                  <p className="mt-1 text-[10px] text-yellow-400 leading-relaxed">
                    Sin perfil enlazado no se puede sacar su coste de «Mis Horas»: cuesta 0 € en
                    Tesorería este mes y todos los siguientes.
                  </p>
                )}
              </Field>
            )}

            <div className="grid grid-cols-2 gap-2">
              <Field label="Horas contratadas">
                <div className="flex items-center gap-1.5">
                  <input
                    key={`hours-${employee.id}`}
                    defaultValue={
                      employee.contracted_hours != null ? String(employee.contracted_hours) : ''
                    }
                    onBlur={(e) => {
                      const parsed = parseDecimal(e.target.value)
                      if (parsed === undefined) return
                      if (parsed !== null && parsed < 0) return
                      if ((employee.contracted_hours ?? null) === parsed) return
                      onPatch({ contracted_hours: parsed })
                    }}
                    inputMode="decimal"
                    placeholder="—"
                    className={`${fieldInput} text-right tabular-nums`}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      onPatch({
                        hours_unit: (employee.hours_unit === 'mes' ? 'semana' : 'mes') as HoursUnit,
                      })
                    }
                    className="flex-shrink-0 h-[30px] px-2 rounded-lg border border-white/10 bg-white/[0.04] text-[10px] text-white/60 hover:text-white hover:border-white/25 transition-colors whitespace-nowrap"
                  >
                    {HOURS_UNIT_LABELS[employee.hours_unit]}
                  </button>
                </div>
              </Field>
              <Field label="Divisa">
                <div className="flex gap-1.5">
                  {(['USD', 'EUR'] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => employee.currency !== c && onPatch({ currency: c })}
                      className={`flex-1 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors ${
                        employee.currency === c
                          ? 'border-[#FF6600]/50 bg-[#FF6600]/[0.1] text-white'
                          : 'border-white/10 bg-white/[0.02] text-white/45 hover:text-white'
                      }`}
                    >
                      {c === 'USD' ? '$ USD' : '€ EUR'}
                    </button>
                  ))}
                </div>
              </Field>
            </div>

            {/* Contratadas contra reales: el dato que el usuario pidió ver de
                un vistazo. Solo tiene sentido para quien cobra por horas. */}
            {employee.pay_model === 'horas' && (
              <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 space-y-1">
                <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-white/35">
                  <Clock className="h-3 w-3" /> {monthLongLabel(currentPeriod)}
                </p>
                {/* SU SUELDO ESTABLECIDO. Un comercial no tiene escalón, así
                    que sin esta línea la ficha enseña lo que ha cobrado pero
                    no a qué precio lo cobra, y había que salirse a «Mis Horas»
                    para saberlo. Es el equivalente al escalón vigente de los
                    de sueldo fijo. */}
                <p className="flex items-center justify-between text-[11px]">
                  <span className="text-white/40">Tarifa pactada</span>
                  <span
                    className="text-white/80 tabular-nums"
                    title={
                      monthCost
                        ? monthCost.rate.source === 'personal'
                          ? 'Excepción propia de esta persona, puesta en «Mis Horas»'
                          : monthCost.rate.source === 'periodo'
                            ? 'Tarifa general del equipo para este ciclo'
                            : 'No hay tarifa puesta para este ciclo: se aplica la de por defecto'
                        : undefined
                    }
                  >
                    {monthCost
                      ? `${formatMoney(monthCost.rate.hourly, 'USD')}/h · ${formatMoney(
                          monthCost.rate.commission,
                          'USD'
                        )}/cita`
                      : '—'}
                  </span>
                </p>
                <p className="flex items-center justify-between text-[11px]">
                  <span className="text-white/40">Horas reales apuntadas</span>
                  <span className="text-white/80 tabular-nums">
                    {monthCost
                      ? `${monthCost.hours.toLocaleString('es-ES', { maximumFractionDigits: 1 })} h`
                      : '—'}
                  </span>
                </p>
                <p className="flex items-center justify-between text-[11px]">
                  <span className="text-white/40">Contratadas (equivalente al mes)</span>
                  <span className="text-white/60 tabular-nums">
                    {contractedMonthly != null
                      ? `${contractedMonthly.toLocaleString('es-ES', { maximumFractionDigits: 1 })} h`
                      : '—'}
                  </span>
                </p>
                {monthCost && (
                  <p className="flex items-center justify-between text-[11px]">
                    <span className="text-white/40">
                      Citas cualificadas · comisiones
                    </span>
                    <span className="text-white/60 tabular-nums">
                      {monthCost.appointments} · {formatMoney(monthCost.commissions, 'USD')}
                    </span>
                  </p>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <Field label="Alta">
                <input
                  type="date"
                  key={`start-${employee.id}`}
                  defaultValue={employee.started_on ?? ''}
                  onBlur={(e) => {
                    const v = e.target.value || null
                    if (v !== (employee.started_on ?? null)) onPatch({ started_on: v })
                  }}
                  className={dateInput}
                />
              </Field>
              <Field label="Baja">
                <input
                  type="date"
                  key={`end-${employee.id}`}
                  defaultValue={employee.ended_on ?? ''}
                  onBlur={(e) => {
                    const v = e.target.value || null
                    if (v === (employee.ended_on ?? null)) return
                    // La fecha es suficiente: isWithinContract corta la serie
                    // de escalones a partir del mes SIGUIENTE al de la baja, y
                    // el mes de la baja se cobra entero. Apagar aquí `is_active`
                    // ponía a cero ese último mes —690 $ que sí se pagan— y
                    // hacía desaparecer a esa persona del bloque de Tesorería.
                    // Al quitarla, vuelve a plantilla: si no, corregir una baja
                    // puesta por error dejaba a la persona costando 0 sin nada
                    // en pantalla que lo explicara.
                    onPatch(v ? { ended_on: v } : { ended_on: null, is_active: true })
                  }}
                  className={dateInput}
                />
              </Field>
            </div>

            <Field label="Nota rápida">
              <input
                key={`notes-${employee.id}`}
                defaultValue={employee.notes ?? ''}
                onBlur={(e) => {
                  const v = e.target.value.trim()
                  if (v !== (employee.notes ?? '')) onPatch({ notes: v || null })
                }}
                placeholder="Banco, país, lo que sea de una línea"
                className={fieldInput}
              />
            </Field>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                // Volver a activar limpia también la fecha de baja: si se
                // quedara puesta, la persona seguiría fuera de plantilla y el
                // botón parecería no hacer nada.
                onClick={() =>
                  onPatch(
                    enPlantilla ? { is_active: false } : { is_active: true, ended_on: null }
                  )
                }
                title={
                  enPlantilla
                    ? 'Deja de contar en Tesorería a partir de este mes. Si sabes la fecha exacta, mejor ponla en «Baja»'
                    : 'Vuelve a plantilla y borra su fecha de baja'
                }
                className={ghostButton}
              >
                {enPlantilla ? 'Dar de baja' : 'Volver a activar'}
              </button>
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => (confirmDelete ? handleDelete() : setConfirmDelete(true))}
                disabled={busy}
                title="Borra la persona y TODO su histórico de sueldos y notas"
                className={`h-8 px-3 rounded-full border text-[12px] font-medium flex items-center gap-1.5 transition-colors disabled:opacity-50 ${
                  confirmDelete
                    ? 'border-red-400/50 bg-red-500/15 text-red-300'
                    : 'border-white/10 bg-white/[0.03] text-white/40 hover:text-red-300 hover:border-red-400/30'
                }`}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                {confirmDelete ? '¿Borrar su histórico?' : 'Borrar'}
              </button>
            </div>
          </section>

          {/* ---------- Escalones y notas ---------- */}
          <section className="space-y-4 min-w-0">
            <div>
              <h4 className="text-[10px] font-semibold text-white/45 uppercase tracking-wider mb-2">
                Historial de sueldo
              </h4>
              {employee.pay_model === 'horas' ? (
                <p className="text-[11px] text-white/35 leading-relaxed">
                  No tiene escalones a propósito: lo que cobra no es un importe pactado al mes,
                  sale de las horas que apunta en «Mis Horas» y de las citas que cualifica. Lo
                  que sí está pactado es su <strong className="text-white/55">tarifa</strong>, y
                  la tienes arriba, en el recuadro del mes.
                </p>
              ) : (
                <SalarySteps
                  employee={employee}
                  steps={steps}
                  currentPeriod={currentPeriod}
                  onStepSaved={onStepSaved}
                  onStepDeleted={onStepDeleted}
                />
              )}
            </div>

            <div>
              <h4 className="text-[10px] font-semibold text-white/45 uppercase tracking-wider mb-2">
                Notas
              </h4>
              <EmployeeNotes
                employeeId={employee.id}
                currentUser={currentUser}
                notes={notes}
                onChange={onNotesChange}
              />
            </div>
          </section>
        </div>
      </motion.div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <label className="block text-[10px] uppercase tracking-wider text-white/35 mb-1">
        {label}
      </label>
      {children}
    </div>
  )
}

interface SalaryStepsProps {
  employee: Employee
  steps: EmployeeSalaryStep[]
  currentPeriod: string
  onStepSaved: (step: EmployeeSalaryStep) => void
  onStepDeleted: (id: string) => void
}

/** La serie de escalones, de la más antigua a la más nueva, con sus saltos */
function SalarySteps({
  employee,
  steps,
  currentPeriod,
  onStepSaved,
  onStepDeleted,
}: SalaryStepsProps) {
  const supabase = createClient()
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [month, setMonth] = useState(toMonthInput(currentPeriod))
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')

  async function addStep() {
    const period = fromMonthInput(month)
    const parsed = parseDecimal(amount)
    if (!period) {
      toast.error('Elige el mes desde el que se cobra')
      return
    }
    if (parsed === undefined || parsed === null || parsed < 0) {
      toast.error('Pon el importe del sueldo')
      return
    }
    setSaving(true)
    try {
      const { data: row, error } = await supabase
        .from('employee_salary_steps')
        .upsert(
          {
            employee_id: employee.id,
            effective_from: period,
            gross_amount: parsed,
            currency: employee.currency,
            reason: reason.trim() || null,
          },
          { onConflict: 'employee_id,effective_from' }
        )
        .select('*')
        .single()
      if (error) throw error
      onStepSaved(row as EmployeeSalaryStep)
      setAdding(false)
      setAmount('')
      setReason('')
      toast.success(
        period > currentPeriod
          ? `Subida programada para ${monthLongLabel(period)}`
          : `Sueldo actualizado desde ${monthLongLabel(period)}`
      )
    } catch (err) {
      console.error('Error creando el escalón de sueldo:', err)
      toast.error('No se ha podido guardar el escalón')
    } finally {
      setSaving(false)
    }
  }

  async function removeStep(id: string) {
    try {
      const { data: gone, error } = await supabase
        .from('employee_salary_steps')
        .delete()
        .eq('id', id)
        .select('id')
      if (error) throw error
      if (!gone || gone.length === 0) {
        toast.error('Tu usuario no puede borrar escalones')
        return
      }
      onStepDeleted(id)
    } catch (err) {
      console.error('Error borrando el escalón de sueldo:', err)
      toast.error('No se ha podido borrar el escalón')
    }
  }

  return (
    <div className="space-y-2">
      {steps.length === 0 ? (
        <p className="text-[11px] text-white/25">
          Todavía no tiene ningún sueldo puesto. Añade el primer escalón y quedará vigente
          desde ese mes en adelante.
        </p>
      ) : (
        <div className="space-y-0">
          {steps.map((s, idx) => {
            const prev = idx > 0 ? Number(steps[idx - 1].gross_amount) : null
            const delta = prev == null ? null : Number(s.gross_amount) - prev
            const period = monthKeyOf(s.effective_from)
            const future = period > currentPeriod
            const vigente = !future && (idx === steps.length - 1 || monthKeyOf(steps[idx + 1].effective_from) > currentPeriod)
            return (
              <div key={s.id} className="group relative flex gap-2.5 pb-2.5">
                {idx < steps.length - 1 && (
                  <span className="absolute left-[11px] top-6 bottom-0 w-px bg-white/[0.08]" />
                )}
                <span
                  className={`relative z-10 h-[22px] w-[22px] rounded-full flex items-center justify-center flex-shrink-0 border ${
                    future
                      ? 'border-[#FF6600]/50 bg-[#FF6600]/[0.12] text-[#FF6600]'
                      : delta == null
                        ? 'border-white/15 bg-white/[0.04] text-white/45'
                        : delta > 0
                          ? 'border-green-400/40 bg-green-500/[0.12] text-green-300'
                          : 'border-yellow-400/40 bg-yellow-400/[0.12] text-yellow-300'
                  }`}
                >
                  {future ? (
                    <CalendarClock className="h-3 w-3" />
                  ) : delta != null && delta < 0 ? (
                    <ArrowDownRight className="h-3 w-3" />
                  ) : (
                    <ArrowUpRight className="h-3 w-3" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-[12px] font-semibold text-white tabular-nums">
                      {formatMoney(Number(s.gross_amount), s.currency)}
                    </span>
                    <span className="text-[10px] text-white/35 capitalize">
                      desde {monthLongLabel(period)}
                    </span>
                    {delta != null && delta !== 0 && (
                      <span
                        className={`text-[10px] font-semibold tabular-nums ${
                          delta > 0 ? 'text-green-300' : 'text-yellow-300'
                        }`}
                      >
                        {delta > 0 ? '+' : ''}
                        {formatMoney(delta, s.currency)}
                      </span>
                    )}
                    {vigente && (
                      <span className="text-[9px] uppercase tracking-wider text-[#FF6600]">
                        vigente
                      </span>
                    )}
                    {future && (
                      <span className="text-[9px] uppercase tracking-wider text-[#FF6600]">
                        programada
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => removeStep(s.id)}
                      className="ml-auto opacity-0 group-hover:opacity-100 text-white/25 hover:text-red-400 transition-all"
                      title="Quitar este escalón"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  {s.reason && (
                    <p className="text-[11px] text-white/50 break-words leading-snug">{s.reason}</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!adding ? (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/15 bg-white/[0.02] px-3 py-2 text-[11px] font-medium text-white/55 hover:border-[#FF6600]/40 hover:text-white transition-colors"
        >
          <Plus className="h-3.5 w-3.5" /> Programar una subida
        </button>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5 space-y-2"
        >
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-white/35 mb-1">
                Desde el mes
              </label>
              <input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className={dateInput}
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-white/35 mb-1">
                Nuevo sueldo
              </label>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                autoFocus
                placeholder="0"
                className={`${fieldInput} text-right tabular-nums`}
              />
            </div>
          </div>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Por qué sube"
            className={fieldInput}
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="px-2.5 py-1 rounded-lg text-[11px] text-white/50 hover:text-white transition-colors"
            >
              Cancelar
            </button>
            <button type="button" onClick={addStep} disabled={saving} className={primaryButton}>
              {saving && <Loader2 className="h-3 w-3 animate-spin" />}
              Guardar
            </button>
          </div>
        </motion.div>
      )}
    </div>
  )
}
