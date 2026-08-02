'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { toMadrid } from '@/lib/timezone'
import { Phone, Mail, MessageCircle, Linkedin, StickyNote, Plus, X, Loader2 } from 'lucide-react'
import {
  ColdLeadNote,
  ColdNoteKind,
  COLD_NOTE_LABELS,
  COLD_NOTE_COLORS,
} from '@/lib/types/cold-leads'
import { UserProfile } from '@/lib/supabase/get-user-profile'

interface ColdLeadNotesProps {
  leadId: string
  currentUser: UserProfile
  /** Se llama al registrar una interacción, para mover el estado del lead */
  onLogged: (kind: ColdNoteKind) => void
}

const KIND_ICONS: Record<ColdNoteKind, typeof Phone> = {
  llamada: Phone,
  email: Mail,
  whatsapp: MessageCircle,
  linkedin: Linkedin,
  nota: StickyNote,
}

const KINDS: ColdNoteKind[] = ['llamada', 'email', 'whatsapp', 'linkedin', 'nota']

const NOTE_SELECT = `
  *,
  author:profiles!cold_lead_notes_author_id_fkey(id, full_name, email, role, calendar_color)
`

export function ColdLeadNotes({ leadId, currentUser, onLogged }: ColdLeadNotesProps) {
  const supabase = createClient()
  const [notes, setNotes] = useState<ColdLeadNote[]>([])
  const [loading, setLoading] = useState(true)
  const [kind, setKind] = useState<ColdNoteKind>('llamada')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    setBody('')
    supabase
      .from('cold_lead_notes')
      .select(NOTE_SELECT)
      .eq('lead_id', leadId)
      .order('occurred_at', { ascending: false })
      .then(({ data }) => {
        if (!active) return
        setNotes((data as ColdLeadNote[]) || [])
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [leadId, supabase])

  async function handleSave() {
    const text = body.trim()
    if (!text) return
    setSaving(true)
    try {
      const { data, error } = await supabase
        .from('cold_lead_notes')
        .insert({ lead_id: leadId, author_id: currentUser.id, kind, body: text })
        .select(NOTE_SELECT)
        .single()
      if (error) throw error
      setNotes((prev) => [data as ColdLeadNote, ...prev])
      setBody('')
      onLogged(kind)
    } catch (err) {
      console.error('Error guardando la interacción:', err)
      toast.error('No se pudo guardar la interacción')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    try {
      const { error } = await supabase.from('cold_lead_notes').delete().eq('id', id)
      if (error) throw error
      setNotes((prev) => prev.filter((n) => n.id !== id))
    } catch (err) {
      console.error('Error borrando la interacción:', err)
      toast.error('No se pudo borrar')
    }
  }

  return (
    <div className="space-y-2">
      {/* Registrar: siempre visible, es la acción que más se repite */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5 space-y-2">
        <div className="flex flex-wrap gap-1">
          {KINDS.map((k) => {
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
                    : 'border-white/10 text-white/45 hover:text-white/80'
                }`}
              >
                <Icon className="h-3 w-3" />
                {COLD_NOTE_LABELS[k]}
              </button>
            )
          })}
        </div>

        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSave()
          }}
          rows={2}
          placeholder="Qué ha pasado en esta llamada..."
          className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-2.5 py-1.5 text-[12px] text-white outline-none focus:border-[#FF6600] transition-colors resize-none placeholder:text-white/25"
        />

        <div className="flex items-center gap-2">
          <span className="text-[10px] text-white/25 flex-1">⌘/Ctrl + Enter para guardar</span>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !body.trim()}
            className="px-3 py-1 rounded-lg bg-[#FF6600] text-[11px] font-semibold text-white disabled:opacity-40 transition-opacity flex items-center gap-1"
          >
            <Plus className="h-3 w-3" /> Registrar
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-[11px] text-white/25 flex items-center gap-1.5">
          <Loader2 className="h-3 w-3 animate-spin" /> Cargando historial...
        </p>
      ) : notes.length === 0 ? (
        <p className="text-[11px] text-white/25">Sin interacciones registradas todavía.</p>
      ) : (
        <div className="space-y-0">
          <AnimatePresence initial={false}>
            {notes.map((n, idx) => {
              const Icon = KIND_ICONS[n.kind] ?? StickyNote
              const color = COLD_NOTE_COLORS[n.kind] ?? '#94A3B8'
              return (
                <motion.div
                  key={n.id}
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  className="group relative flex gap-2.5 pb-3"
                >
                  {idx < notes.length - 1 && (
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
                        {COLD_NOTE_LABELS[n.kind] ?? n.kind}
                      </span>
                      <span className="text-[10px] text-white/30">
                        {format(toMadrid(n.occurred_at), "d MMM yyyy, HH:mm", { locale: es })}
                        {n.author?.full_name ? ` · ${n.author.full_name}` : ''}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDelete(n.id)}
                        className="ml-auto opacity-0 group-hover:opacity-100 text-white/25 hover:text-red-400 transition-all"
                        title="Borrar"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                    <p className="text-[12px] text-white/70 whitespace-pre-wrap break-words leading-snug">
                      {n.body}
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
