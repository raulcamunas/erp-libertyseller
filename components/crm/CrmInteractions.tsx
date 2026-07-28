'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { toMadrid, fromMadrid } from '@/lib/timezone'
import { Phone, Mail, MessageCircle, Users, FileText, StickyNote, Plus, X } from 'lucide-react'
import {
  CrmInteraction,
  CrmInteractionKind,
  CRM_INTERACTION_LABELS,
} from '@/lib/types/crm'
import { UserProfile } from '@/lib/supabase/get-user-profile'

interface CrmInteractionsProps {
  clientId: string
  currentUser: UserProfile
  interactions: CrmInteraction[]
  onChange: (list: CrmInteraction[]) => void
}

const KIND_ICONS: Record<CrmInteractionKind, typeof Phone> = {
  llamada: Phone,
  email: Mail,
  whatsapp: MessageCircle,
  reunion: Users,
  propuesta: FileText,
  nota: StickyNote,
}

const KIND_COLORS: Record<CrmInteractionKind, string> = {
  llamada: '#3B82F6',
  email: '#A855F7',
  whatsapp: '#22C55E',
  reunion: '#FF6600',
  propuesta: '#EAB308',
  nota: '#94A3B8',
}

const KINDS: CrmInteractionKind[] = [
  'llamada',
  'email',
  'whatsapp',
  'reunion',
  'propuesta',
  'nota',
]

/** Historial de tomas de contacto con el lead, lo más reciente arriba */
export function CrmInteractions({
  clientId,
  currentUser,
  interactions,
  onChange,
}: CrmInteractionsProps) {
  const supabase = createClient()
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [kind, setKind] = useState<CrmInteractionKind>('llamada')
  const [body, setBody] = useState('')
  const [date, setDate] = useState(format(toMadrid(new Date()), 'yyyy-MM-dd'))

  async function handleSave() {
    const text = body.trim()
    if (!text) return
    setSaving(true)
    try {
      // La hora exacta no importa tanto como el día: se guarda a mediodía
      // en hora de España para que no se desplace de día en Latinoamérica.
      const occurredAt = fromMadrid(`${date}T12:00:00`).toISOString()
      const { data, error } = await supabase
        .from('crm_interactions')
        .insert({
          client_id: clientId,
          author_id: currentUser.id,
          kind,
          body: text,
          occurred_at: occurredAt,
        })
        .select('*, author:profiles!crm_interactions_author_id_fkey(id, full_name, email, role, calendar_color)')
        .single()
      if (error) throw error

      onChange([data as CrmInteraction, ...interactions])
      setBody('')
      setAdding(false)
    } catch (err) {
      console.error('Error guardando toma de contacto:', err)
      toast.error('No se pudo guardar la toma de contacto')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    try {
      const { error } = await supabase.from('crm_interactions').delete().eq('id', id)
      if (error) throw error
      onChange(interactions.filter((i) => i.id !== id))
    } catch (err) {
      console.error('Error borrando toma de contacto:', err)
      toast.error('No se pudo borrar')
    }
  }

  const sorted = [...interactions].sort(
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
          <Plus className="h-3.5 w-3.5" /> Registrar toma de contacto
        </button>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5 space-y-2"
        >
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
                  {CRM_INTERACTION_LABELS[k]}
                </button>
              )
            })}
          </div>

          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            autoFocus
            placeholder="Qué se habló, qué quedó pendiente..."
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
        <p className="text-[11px] text-white/25">Todavía no hay tomas de contacto.</p>
      ) : (
        <div className="space-y-0">
          <AnimatePresence initial={false}>
            {sorted.map((it, idx) => {
              const Icon = KIND_ICONS[it.kind] ?? StickyNote
              const color = KIND_COLORS[it.kind] ?? '#94A3B8'
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
                        {CRM_INTERACTION_LABELS[it.kind] ?? it.kind}
                      </span>
                      <span className="text-[10px] text-white/30">
                        {format(toMadrid(it.occurred_at), "d MMM yyyy", { locale: es })}
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
