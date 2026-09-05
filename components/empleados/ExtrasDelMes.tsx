'use client'

import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import {
  EXTRA_KIND_LABELS,
  formatMoney,
  type EmployeeCurrency,
  type EmployeeExtra,
} from '@/lib/types/employees'

/**
 * ENCARGOS Y COMISIONES SUELTAS
 * =============================
 * Lo que se le paga a alguien APARTE de su sueldo: «unas creatividades por
 * 80 $», una comisión, un bonus.
 *
 * Antes esto solo podía apuntarse subiéndole el sueldo de ese mes, y así se
 * perdía el porqué: al mes siguiente nadie sabía si cobró de más por un
 * encargo, por una comisión o porque alguien se equivocó al teclear. Aquí cada
 * pago lleva su concepto delante, que es lo que se lee después.
 *
 *
 * ============ POR QUÉ NO TOCA EL SUELDO ============
 *
 * Un encargo NO se suma al importe del sueldo, se guarda como una línea
 * aparte. Sumarlo dejaría a Carla con «330 US$» en septiembre y nadie sabría
 * de dónde salieron los 80 de diferencia — que es exactamente el problema que
 * esto viene a resolver. En el total del mes suman los dos; en la pantalla se
 * ven separados.
 */

const MONEDAS: EmployeeCurrency[] = ['USD', 'EUR']
const TIPOS = Object.keys(EXTRA_KIND_LABELS) as EmployeeExtra['kind'][]

export function ExtrasDelMes({
  employeeId,
  period,
  extras,
  onChange,
}: {
  employeeId: string
  /** 'yyyy-MM-01' del mes que se está mirando */
  period: string
  /** Todos los del empleado; aquí se filtran los de este mes */
  extras: EmployeeExtra[]
  onChange: (lista: EmployeeExtra[]) => void
}) {
  const supabase = createClient()
  const [concepto, setConcepto] = useState('')
  const [importe, setImporte] = useState('')
  const [moneda, setMoneda] = useState<EmployeeCurrency>('USD')
  const [tipo, setTipo] = useState<EmployeeExtra['kind']>('encargo')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const delMes = useMemo(
    () =>
      extras
        .filter((e) => e.employee_id === employeeId && e.period.slice(0, 7) === period.slice(0, 7))
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [extras, employeeId, period]
  )

  async function anadir() {
    const texto = concepto.trim()
    const cantidad = Number(importe.replace(',', '.'))

    // Las dos comprobaciones por separado: «rellena bien el formulario» obliga
    // a adivinar cuál de los dos campos está mal.
    if (!texto) {
      setError('Escribe qué se le paga')
      return
    }
    if (!Number.isFinite(cantidad) || cantidad === 0) {
      setError('Pon el importe')
      return
    }

    setGuardando(true)
    setError(null)
    const { data, error: fallo } = await supabase
      .from('employee_extras')
      .insert({
        employee_id: employeeId,
        period,
        concept: texto,
        amount: cantidad,
        currency: moneda,
        kind: tipo,
      })
      .select('*')
      .single()
    setGuardando(false)

    if (fallo) {
      // 42P01 / PGRST205: la 178 todavía no se ha lanzado. Decirlo con su
      // número ahorra el viaje de buscar por qué no guarda.
      setError(
        fallo.code === '42P01' || fallo.code === 'PGRST205'
          ? 'Falta lanzar la migración 178: la tabla de encargos no existe todavía.'
          : fallo.message
      )
      return
    }

    onChange([...extras, data as unknown as EmployeeExtra])
    setConcepto('')
    setImporte('')
  }

  async function quitar(id: string) {
    const { error: fallo } = await supabase.from('employee_extras').delete().eq('id', id)
    if (fallo) {
      setError(fallo.message)
      return
    }
    onChange(extras.filter((e) => e.id !== id))
  }

  const campo =
    'rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-[12px] text-white outline-none transition-colors placeholder:text-white/25 focus:border-[#FF6600]'

  return (
    <div>
      <AnimatePresence initial={false}>
        {delMes.map((e) => (
          <motion.div
            key={e.id}
            layout
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0 }}
            className="group flex items-center gap-2 border-b border-white/[0.05] py-1.5"
          >
            <span className="rounded-full border border-white/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-white/45">
              {EXTRA_KIND_LABELS[e.kind]}
            </span>
            <span className="min-w-0 flex-1 truncate text-[12px] text-white/80" title={e.concept}>
              {e.concept}
            </span>
            <span className="flex-shrink-0 text-[12px] font-semibold tabular-nums text-white">
              {formatMoney(Number(e.amount), e.currency)}
            </span>
            <button
              type="button"
              onClick={() => void quitar(e.id)}
              className="flex-shrink-0 text-white/15 transition-colors hover:text-red-300"
              aria-label="Quitar"
              title="Quitar este apunte"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>

      {delMes.length === 0 && (
        <p className="pb-2 text-[11px] leading-relaxed text-white/30">
          Nada aparte del sueldo este mes. Aquí van los encargos que se pagan sueltos —unas
          creatividades, una comisión— con su concepto, para saber después por qué cobró de más.
        </p>
      )}

      {/* ---------- Añadir uno ---------- */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <select
          value={tipo}
          onChange={(ev) => setTipo(ev.target.value as EmployeeExtra['kind'])}
          className={`${campo} cursor-pointer`}
        >
          {TIPOS.map((k) => (
            <option key={k} value={k} className="bg-[#141417]">
              {EXTRA_KIND_LABELS[k]}
            </option>
          ))}
        </select>

        <input
          value={concepto}
          onChange={(ev) => setConcepto(ev.target.value)}
          placeholder="Creatividades de septiembre"
          className={`${campo} min-w-[150px] flex-1`}
        />

        <input
          value={importe}
          onChange={(ev) => setImporte(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter') void anadir()
          }}
          inputMode="decimal"
          placeholder="80"
          className={`${campo} w-[70px] text-right`}
        />

        <select
          value={moneda}
          onChange={(ev) => setMoneda(ev.target.value as EmployeeCurrency)}
          className={`${campo} cursor-pointer`}
        >
          {MONEDAS.map((m) => (
            <option key={m} value={m} className="bg-[#141417]">
              {m}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => void anadir()}
          disabled={guardando}
          className="flex h-[30px] items-center gap-1 rounded-lg bg-[#FF6600] px-2.5 text-[11px] font-bold uppercase tracking-wider text-white transition-all hover:brightness-110 disabled:opacity-60"
        >
          {guardando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          Añadir
        </button>
      </div>

      {error && <p className="mt-1.5 text-[11px] text-red-300">{error}</p>}
    </div>
  )
}
