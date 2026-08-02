'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { X, Settings2, Info } from 'lucide-react'
import {
  PayrollRate,
  PayrollPeriod,
  periodLabel,
  resolveRate,
  DEFAULT_HOURLY_RATE,
  DEFAULT_COMMISSION,
} from '@/lib/types/payroll'
import { CalendarPerson } from '@/lib/types/appointments'

interface RateSettingsProps {
  period: PayrollPeriod
  rates: PayrollRate[]
  team: CalendarPerson[]
  onClose: () => void
  onSaved: (rate: PayrollRate) => void
  onRemoved: (id: string) => void
}

const field =
  'w-full bg-white/[0.04] border border-white/10 rounded-lg px-2.5 py-1.5 text-[13px] text-white outline-none focus:border-[#FF6600] transition-colors'

/** Fila editable de tarifa: la general del periodo o la de una persona */
function RateRow({
  label,
  sublabel,
  period,
  userId,
  rates,
  onSaved,
  onRemoved,
}: {
  label: string
  sublabel: string
  period: PayrollPeriod
  userId: string | null
  rates: PayrollRate[]
  onSaved: (rate: PayrollRate) => void
  onRemoved: (id: string) => void
}) {
  const supabase = createClient()
  const existing = rates.find(
    (r) => r.period_start === period.key && r.user_id === userId
  )
  // Si esta persona no tiene excepción, se parte de lo que le aplica hoy
  const fallback = resolveRate(rates, period.key, userId ?? '__none__')

  const [hourly, setHourly] = useState(
    String(existing?.hourly_rate ?? (userId ? fallback.hourly : DEFAULT_HOURLY_RATE))
  )
  const [commission, setCommission] = useState(
    String(
      existing?.commission_per_appointment ??
        (userId ? fallback.commission : DEFAULT_COMMISSION)
    )
  )
  const [saving, setSaving] = useState(false)

  async function save() {
    const h = Number(hourly)
    const c = Number(commission)
    if (Number.isNaN(h) || Number.isNaN(c)) {
      toast.error('Los importes tienen que ser números')
      return
    }
    setSaving(true)
    try {
      if (existing) {
        const { data, error } = await supabase
          .from('payroll_rates')
          .update({ hourly_rate: h, commission_per_appointment: c })
          .eq('id', existing.id)
          .select('*')
          .single()
        if (error) throw error
        onSaved(data as PayrollRate)
      } else {
        const { data, error } = await supabase
          .from('payroll_rates')
          .insert({
            period_start: period.key,
            user_id: userId,
            hourly_rate: h,
            commission_per_appointment: c,
          })
          .select('*')
          .single()
        if (error) throw error
        onSaved(data as PayrollRate)
      }
      toast.success('Tarifa guardada')
    } catch (err) {
      console.error('Error guardando tarifa:', err)
      toast.error('No se pudo guardar la tarifa')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!existing) return
    setSaving(true)
    try {
      const { error } = await supabase.from('payroll_rates').delete().eq('id', existing.id)
      if (error) throw error
      onRemoved(existing.id)
      toast.success('Excepción quitada')
    } catch (err) {
      console.error('Error quitando tarifa:', err)
      toast.error('No se pudo quitar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className={`rounded-xl border p-2.5 ${
        existing ? 'border-[#FF6600]/30 bg-[#FF6600]/[0.05]' : 'border-white/10 bg-white/[0.02]'
      }`}
    >
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-white truncate">{label}</p>
          <p className="text-[10px] text-white/35">{sublabel}</p>
        </div>
        {existing && userId && (
          <button
            type="button"
            onClick={remove}
            disabled={saving}
            className="text-[10px] text-white/35 hover:text-red-400 transition-colors flex-shrink-0"
          >
            Quitar excepción
          </button>
        )}
      </div>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label className="text-[10px] text-white/35 mb-0.5 block">Precio/hora ($)</label>
          <input
            value={hourly}
            onChange={(e) => setHourly(e.target.value)}
            inputMode="decimal"
            className={field}
          />
        </div>
        <div className="flex-1">
          <label className="text-[10px] text-white/35 mb-0.5 block">Por cita ($)</label>
          <input
            value={commission}
            onChange={(e) => setCommission(e.target.value)}
            inputMode="decimal"
            className={field}
          />
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="h-[34px] px-3 rounded-lg bg-[#FF6600] text-[12px] font-semibold text-white disabled:opacity-40 transition-opacity flex-shrink-0"
        >
          Guardar
        </button>
      </div>
    </div>
  )
}

export function RateSettings({
  period,
  rates,
  team,
  onClose,
  onSaved,
  onRemoved,
}: RateSettingsProps) {
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
        className="relative w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#0d0d0d] p-4 shadow-2xl"
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-white font-semibold text-[15px] flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-[#FF6600]" /> Tarifas del periodo
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-white/40 hover:text-white transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-[11px] text-white/35 mb-3">{periodLabel(period)}</p>

        <div className="flex items-start gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.02] p-2 mb-3">
          <Info className="h-3.5 w-3.5 text-white/30 flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-white/45 leading-snug">
            La tarifa general se aplica a todo el equipo en este periodo. Si alguien
            cobra distinto, guarda su excepción abajo y solo le afectará a esa persona
            y a este ciclo.
          </p>
        </div>

        <div className="space-y-2">
          <RateRow
            label="Tarifa general"
            sublabel="Se aplica a todo el equipo en este periodo"
            period={period}
            userId={null}
            rates={rates}
            onSaved={onSaved}
            onRemoved={onRemoved}
          />

          <p className="text-[10px] uppercase tracking-wider text-white/30 pt-1">
            Excepciones por persona
          </p>

          {team.map((p) => (
            <RateRow
              key={p.id}
              label={p.full_name || p.email || 'Sin nombre'}
              sublabel={
                rates.some((r) => r.period_start === period.key && r.user_id === p.id)
                  ? 'Tiene tarifa propia en este periodo'
                  : 'Usa la tarifa general'
              }
              period={period}
              userId={p.id}
              rates={rates}
              onSaved={onSaved}
              onRemoved={onRemoved}
            />
          ))}
        </div>
      </motion.div>
    </div>
  )
}
