'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { X, Plus, Trash2, Clock3 } from 'lucide-react'
import { AvailabilityWindow, WEEKDAY_LABELS } from '@/lib/types/availability'
import { UserProfile } from '@/lib/supabase/get-user-profile'

interface AvailabilitySettingsProps {
  currentUser: UserProfile
  windows: AvailabilityWindow[]
  onClose: () => void
  onChange: (windows: AvailabilityWindow[]) => void
}

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0] // lunes -> domingo
const DEFAULT_DAYS = [1, 2, 3, 4, 5] // lunes a viernes

export function AvailabilitySettings({
  currentUser,
  windows,
  onClose,
  onChange,
}: AvailabilitySettingsProps) {
  const supabase = createClient()
  const [startTime, setStartTime] = useState('10:00')
  const [endTime, setEndTime] = useState('13:00')
  const [days, setDays] = useState<number[]>(DEFAULT_DAYS)
  const [saving, setSaving] = useState(false)

  const mine = windows.filter((w) => w.owner_id === currentUser.id)

  function toggleDay(d: number) {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))
  }

  async function handleAdd() {
    if (days.length === 0) {
      toast.error('Elige al menos un día')
      return
    }
    if (endTime <= startTime) {
      toast.error('La hora de fin debe ser posterior a la de inicio')
      return
    }
    setSaving(true)
    try {
      const { data, error } = await supabase
        .from('availability_windows')
        .insert({
          owner_id: currentUser.id,
          days_of_week: days,
          start_time: `${startTime}:00`,
          end_time: `${endTime}:00`,
        })
        .select()
        .single()
      if (error) throw error
      onChange([...windows, data as AvailabilityWindow])
      toast.success('Franja añadida')
    } catch (err) {
      console.error('Error creando franja de disponibilidad:', err)
      toast.error('No se pudo guardar la franja')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    try {
      const { error } = await supabase.from('availability_windows').delete().eq('id', id)
      if (error) throw error
      onChange(windows.filter((w) => w.id !== id))
    } catch (err) {
      console.error('Error borrando franja:', err)
      toast.error('No se pudo borrar la franja')
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-md bg-[#0a0a0a] border border-white/10 rounded-2xl p-5 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Clock3 className="h-4 w-4 text-[#FF6600]" /> Mi disponibilidad
            </h2>
            <button
              onClick={onClose}
              className="h-7 w-7 rounded-full hover:bg-white/10 flex items-center justify-center text-white/60"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="text-xs text-white/40">
            Se pinta como franja disponible en el calendario del equipo, a modo de guía. No
            bloquea la creación de citas.
          </p>

          {/* Franjas existentes */}
          <div className="space-y-2">
            {mine.length === 0 && (
              <p className="text-xs text-white/30">Todavía no tienes ninguna franja.</p>
            )}
            {mine.map((w) => (
              <div
                key={w.id}
                className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2"
              >
                <div className="text-xs text-white/80">
                  <span className="font-semibold">
                    {w.start_time.slice(0, 5)} – {w.end_time.slice(0, 5)}
                  </span>
                  <span className="text-white/40 ml-2">
                    {w.days_of_week
                      .sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b))
                      .map((d) => WEEKDAY_LABELS[d])
                      .join(', ')}
                  </span>
                </div>
                <button
                  onClick={() => handleDelete(w.id)}
                  className="text-white/30 hover:text-red-400 transition-colors flex-shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>

          {/* Nueva franja */}
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] text-white/40 block mb-1">Inicio</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white outline-none focus:border-[#FF6600]"
                />
              </div>
              <div>
                <label className="text-[11px] text-white/40 block mb-1">Fin</label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white outline-none focus:border-[#FF6600]"
                />
              </div>
            </div>
            <div>
              <label className="text-[11px] text-white/40 block mb-1.5">Días</label>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleDay(d)}
                    className={`h-7 w-11 rounded-lg text-xs font-medium border transition-colors ${
                      days.includes(d)
                        ? 'bg-[#FF6600]/20 border-[#FF6600]/50 text-white'
                        : 'border-white/10 text-white/40 hover:border-white/20'
                    }`}
                  >
                    {WEEKDAY_LABELS[d]}
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={handleAdd}
              disabled={saving}
              className="w-full h-9 rounded-lg bg-[#FF6600] text-white text-sm font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" /> Añadir franja
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
