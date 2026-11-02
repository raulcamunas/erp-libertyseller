'use client'

import { useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import {
  EXTRA_KIND_LABELS,
  monthLongLabel,
  type Employee,
  type EmployeeCurrency,
  type EmployeeExtra,
} from '@/lib/types/employees'
import { fieldInput, ghostButton, parseDecimal, primaryButton } from './shared'

const TIPOS = Object.keys(EXTRA_KIND_LABELS) as EmployeeExtra['kind'][]

const AYUDA_TIPO: Record<EmployeeExtra['kind'], string> = {
  comision: 'Una comisión que no sale sola de las citas',
  bonus: 'Un premio o plus puntual',
  encargo: 'Un trabajo concreto fuera de su sueldo',
  otro: 'Cualquier otro pago (o descuento, en negativo)',
}

/**
 * AÑADIR UN PAGO SUELTO A MANO (comisión, bonus, encargo…).
 * Escribe en la misma tabla que la ficha de la persona (`employee_extras`, migración 178), así que lo apuntado aquí
 * aparece también allí, en la tabla de previsión y en lo que suma Tesorería. Un importe en negativo es un descuento.
 */
export function NuevoPago({
  employees,
  period,
  months,
  employeeId,
  defaultCurrency,
  onSaved,
  onClose,
}: {
  employees: Employee[]
  /** 'yyyy-MM-01' del mes que se está mirando */
  period: string
  /** Los meses que el módulo tiene cargados */
  months: string[]
  /** La persona preseleccionada, si se pulsó el «+» de su fila */
  employeeId?: string | null
  defaultCurrency: EmployeeCurrency
  onSaved: (extra: EmployeeExtra) => void
  onClose: () => void
}) {
  const supabase = createClient()
  const [persona, setPersona] = useState(employeeId ?? employees[0]?.id ?? '')
  const [mes, setMes] = useState(period)
  const [tipo, setTipo] = useState<EmployeeExtra['kind']>('comision')
  const [concepto, setConcepto] = useState('')
  const [importe, setImporte] = useState('')
  const [moneda, setMoneda] = useState<EmployeeCurrency>(defaultCurrency)
  const [pagado, setPagado] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function guardar() {
    const texto = concepto.trim()
    const cantidad = parseDecimal(importe)
    if (!persona) return setError('Elige a quién se le paga')
    if (!texto) return setError('Escribe qué se le paga')
    if (cantidad == null || cantidad === 0) return setError('Pon el importe')

    setGuardando(true)
    setError(null)
    const { data, error: fallo } = await supabase
      .from('employee_extras')
      .insert({ employee_id: persona, period: mes, concept: texto, amount: cantidad, currency: moneda, kind: tipo, paid: pagado })
      .select('*')
      .single()
    setGuardando(false)

    if (fallo) {
      setError(
        fallo.code === '42P01' || fallo.code === 'PGRST205'
          ? 'Falta lanzar la migración 178: la tabla de pagos sueltos no existe todavía.'
          : fallo.message
      )
      return
    }
    onSaved(data as unknown as EmployeeExtra)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0d0d0d] shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-white/[0.06]">
          <div>
            <h3 className="text-[15px] font-semibold text-white">Añadir un pago</h3>
            <p className="text-[11px] text-white/40">Comisión, bonus o encargo aparte del sueldo</p>
          </div>
          <button type="button" onClick={onClose} className="h-7 w-7 rounded-full flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-4 gap-1.5">
            {TIPOS.map((t) => (
              <button
                key={t}
                type="button"
                title={AYUDA_TIPO[t]}
                onClick={() => setTipo(t)}
                className={`h-8 rounded-lg border text-[12px] font-medium transition-colors ${
                  tipo === t ? 'border-[#FF6600]/60 bg-[#FF6600]/[0.14] text-white' : 'border-white/10 bg-white/[0.02] text-white/55 hover:text-white hover:border-white/20'
                }`}
              >
                {EXTRA_KIND_LABELS[t]}
              </button>
            ))}
          </div>
          <p className="-mt-2 text-[11px] text-white/35">{AYUDA_TIPO[tipo]}</p>

          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-white/40">Persona</span>
            <select value={persona} onChange={(e) => setPersona(e.target.value)} className={`${fieldInput} mt-1`}>
              {employees.map((e) => (
                <option key={e.id} value={e.id} className="bg-[#0d0d0d]">
                  {e.name}
                  {!e.is_active ? ' (de baja)' : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-white/40">Concepto</span>
            <input
              value={concepto}
              onChange={(e) => setConcepto(e.target.value)}
              placeholder="Ej.: 2 citas extra de la campaña del viernes"
              className={`${fieldInput} mt-1`}
              autoFocus
            />
          </label>

          <div className="grid grid-cols-[1fr_88px] gap-2">
            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-white/40">Importe (negativo = descuento)</span>
              <input value={importe} onChange={(e) => setImporte(e.target.value)} inputMode="decimal" placeholder="0" className={`${fieldInput} mt-1 text-right tabular-nums`} />
            </label>
            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-white/40">Divisa</span>
              <select value={moneda} onChange={(e) => setMoneda(e.target.value as EmployeeCurrency)} className={`${fieldInput} mt-1`}>
                <option value="USD" className="bg-[#0d0d0d]">US$</option>
                <option value="EUR" className="bg-[#0d0d0d]">€</option>
              </select>
            </label>
          </div>

          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-white/40">Se cobra en</span>
            <select value={mes} onChange={(e) => setMes(e.target.value)} className={`${fieldInput} mt-1`}>
              {months.map((m) => (
                <option key={m} value={m} className="bg-[#0d0d0d]">
                  {monthLongLabel(m)}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 text-[12px] text-white/70 cursor-pointer select-none">
            <input type="checkbox" checked={pagado} onChange={(e) => setPagado(e.target.checked)} className="accent-[#FF6600]" />
            Ya está pagado
          </label>

          {error && <p className="text-[12px] text-red-400">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 px-5 pb-4">
          <button type="button" onClick={onClose} className={ghostButton}>
            Cancelar
          </button>
          <button type="button" onClick={guardar} disabled={guardando} className={primaryButton}>
            {guardando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Guardar pago
          </button>
        </div>
      </div>
    </div>
  )
}
