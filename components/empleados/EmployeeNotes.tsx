'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { toMadrid, fromMadrid } from '@/lib/timezone'
import { StickyNote, TrendingUp, ClipboardCheck, CalendarOff, AlertTriangle, Plus, X } from 'lucide-react'
import {
  NOTE_KINDS,
  NOTE_KIND_COLORS,
  NOTE_KIND_LABELS,
  type EmployeeNote,
  type EmployeeNoteKind,
} from '@/lib/types/employees'
import type { UserProfile } from '@/lib/supabase/get-user-profile'

interface EmployeeNotesProps {
  employeeId: string
  currentUser: UserProfile
  notes: EmployeeNote[]
  /** El estado vive en el tablero, igual que en CrmInteractions */
  onChange: (list: EmployeeNote[]) => void
}

const KIND_ICONS: Record<EmployeeNoteKind, typeof StickyNote> = {
  nota: StickyNote,
  subida: TrendingUp,
  revision: ClipboardCheck,
  ausencia: CalendarOff,
  aviso: AlertTriangle,
}

/**
 * Historial de notas de una persona, lo más reciente arriba.
 * Mismo patrón que components/crm/CrmInteractions.tsx: cada nota es un hecho
 * con fecha y autor, no un campo de texto que el siguiente que entra pisa.
 */
export function EmployeeNotes({ employeeId, currentUser, notes, onChange }: EmployeeNotesProps) {
  const supabase = createClient()
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [kind, setKind] = useState<EmployeeNoteKind>('nota')
  const [body, setBody] = useState('')
  const [date, setDate] = useState(format(toMadrid(new Date()), 'yyyy-MM-dd'))

  async function handleSave() {
    const text = body.trim()
    if (!text) return
    setSaving(true)
    try {
      // La hora exacta no importa tanto como el día: se guarda a mediodía en
      // hora de España para que no se desplace de día en Latinoamérica, que
      // es donde está media plantilla.
      const occurredAt = fromMadrid(`${date}T12:00:00`).toISOString()
      const { data, error } = await supabase
        .from('employee_notes')
        .insert({
          employee_id: employeeId,
          author_id: currentUser.id,
          kind,
          body: text,
          occurred_at: occurredAt,
        })
        .select(
          '*, author:profiles!employee_notes_author_id_fkey(id, full_name, email, role, calendar_color)'
        )
        .single()
      if (error) throw error

      onChange([data as EmployeeNote, ...notes])
      setBody('')
      setAdding(false)
    } catch (err) {
      console.error('Error guardando la nota del empleado:', err)
      toast.error('No se pudo guardar la nota')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    try {
      // .select() para saber cuántas filas se han borrado de verdad: con RLS,
      // borrar sin permiso no da error, simplemente no borra, y sin esto la
      // nota desaparecería de la pantalla y volvería al recargar.
      const { data, error } = await supabase
        .from('employee_notes')
        .delete()
        .eq('id', id)
        .select('id')
      if (error) throw error
      if (!data || data.length === 0) {
        toast.error('Tu usuario no puede borrar notas de empleados')
        return
      }
      onChange(notes.filter((n) => n.id !== id))
    } catch (err) {
      console.error('Error borrando la nota del empleado:', err)
      toast.error('No se pudo borrar la nota')
    }
  }

  const sorted = [...notes].sort(
    (a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime()
  )

  return (
    <div className="space-y-2">
      {!adding ? (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/15 bg-white/[0.02] px-3 py-2 text-[11px] font-medium text-white/55 hover:border-[#FF6600]/40 hover:text-white transition-colors"
        >
          <Plus className="h-3.5 w-3.5" /> Escribir una nota
        </button>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5 space-y-2"
        >
          <div className="flex flex-wrap gap-1">
            {NOTE_KINDS.map((k) => {
              const Icon = KIND_ICONS[k]
              const active = kind === k
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium border transition-colors ${
                    active
                      ? 'border-[#FF6600]/50 bg-[#FF6600]/15 text-white'
                      : 'border-white/10 text-white/45 hover:text-white'
                  }`}
                >
                  <Icon className="h-3 w-3" />
                  {NOTE_KIND_LABELS[k]}
                </button>
              )
            })}
          </div>

          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            autoFocus
            placeholder="Qué se acordó, qué hay pendiente, por qué sube..."
            className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-2.5 py-1.5 text-[12px] text-white outline-none focus:border-[#FF6600] transition-colors resize-none placeholder:text-white/25"
          />

          <div className="flex items-center gap-2">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="bg-white/[0.04] border border-white/10 rounded-lg px-2 py-1 text-[11px] text-white outline-none focus:border-[#FF6600] transition-colors [color-scheme:dark]"
            />
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => {
                setAdding(false)
                setBody('')
              }}
              className="px-2.5 py-1 rounded-lg text-[11px] text-white/50 hover:text-white transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !body.trim()}
              className="px-3 py-1 rounded-lg bg-[#FF6600] text-[11px] font-semibold text-white disabled:opacity-40 transition-opacity"
            >
              Guardar
            </button>
          </div>
        </motion.div>
      )}

      {sorted.length === 0 ? (
        <p className="text-[11px] text-white/25">Todavía no hay notas de esta persona.</p>
      ) : (
        <div className="space-y-0">
          <AnimatePresence initial={false}>
            {sorted.map((it, idx) => {
              const Icon = KIND_ICONS[it.kind] ?? StickyNote
              const color = NOTE_KIND_COLORS[it.kind] ?? '#94A3B8'
              return (
                <motion.div
                  key={it.id}
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  className="group relative flex gap-2.5 pb-3"
                >
                  {/* Línea del timeline */}
                  {idx < sorted.length - 1 && (
                    <span className="absolute left-[11px] top-6 bottom-0 w-px bg-white/[0.08]" />
                  )}
                  <span
                    className="relative z-10 h-[22px] w-[22px] rounded-full flex items-center justify-center flex-shrink-0 border"
                    style={{
                      backgroundColor: `${color}22`,
                      borderColor: `${color}55`,
                      color,
                    }}
                  >
                    <Icon className="h-3 w-3" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-[11px] font-semibold text-white">
                        {NOTE_KIND_LABELS[it.kind] ?? it.kind}
                      </span>
                      <span className="text-[10px] text-white/30">
                        {format(toMadrid(it.occurred_at), 'd MMM yyyy', { locale: es })}
                        {it.author?.full_name ? ` · ${it.author.full_name}` : ''}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDelete(it.id)}
                        className="ml-auto opacity-0 group-hover:opacity-100 text-white/25 hover:text-red-400 transition-all"
                        title="Borrar"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                    <p className="text-[12px] text-white/70 whitespace-pre-wrap break-words leading-snug">
                      {it.body}
                    </p>
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}
