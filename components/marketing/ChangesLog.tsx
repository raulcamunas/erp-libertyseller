'use client'

import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { toMadrid } from '@/lib/timezone'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { ChevronLeft, History, Plus, ArrowRight, X } from 'lucide-react'
import {
  MarketingChange,
  MarketingChangeType,
  CHANGE_TYPES,
  CHANGE_TYPE_COLORS,
  CHANGE_TYPE_LABELS,
  changeTypeLabel,
} from '@/lib/types/marketing'
import { logMarketingChange, optionClass } from './shared'

export interface ChangesLogProps {
  /** null mientras la semana no esté abierta: no hay dónde colgar el cambio */
  weekId: string | null
  changes: MarketingChange[]
  /** Nombre de campaña por id, para que la línea diga a qué afectó */
  campaignNames: Map<string, string>
  /** Nombre del autor por id */
  authorNames: Map<string, string>
  currentUserId: string
  onLogged: (change: MarketingChange) => void
  /** En móvil el diario ocupa toda la pantalla */
  showBack: boolean
  onBack: () => void
  className?: string
}

const fieldClass =
  'w-full bg-white/[0.04] border border-white/10 rounded-lg px-2 py-1.5 text-[12px] text-white outline-none focus:border-[#FF6600] transition-colors placeholder:text-white/25'

export function ChangesLog({
  weekId,
  changes,
  campaignNames,
  authorNames,
  currentUserId,
  onLogged,
  showBack,
  onBack,
  className = '',
}: ChangesLogProps) {
  const supabase = createClient()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [type, setType] = useState<MarketingChangeType>('otro')
  const [description, setDescription] = useState('')
  const [before, setBefore] = useState('')
  const [after, setAfter] = useState('')

  const ordered = useMemo(
    () =>
      [...changes].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      ),
    [changes]
  )

  async function submit() {
    if (!weekId) return
    const desc = description.trim()
    if (!desc) {
      toast.error('Describe qué has cambiado')
      return
    }
    setBusy(true)
    const row = await logMarketingChange(supabase, currentUserId, {
      week_id: weekId,
      change_type: type,
      description: desc,
      before_value: before.trim() || null,
      after_value: after.trim() || null,
    })
    setBusy(false)
    if (!row) {
      toast.error('No se pudo apuntar el cambio')
      return
    }
    onLogged(row)
    setDescription('')
    setBefore('')
    setAfter('')
    setOpen(false)
  }

  return (
    <div
      className={`rounded-2xl border border-white/10 bg-white/[0.02] flex flex-col min-h-0 overflow-hidden ${className}`}
    >
      <div className="px-3 py-2 border-b border-white/[0.06] flex items-center justify-between gap-2 flex-shrink-0 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          {showBack && (
            <button
              type="button"
              onClick={onBack}
              className="flex items-center gap-1 text-[12px] font-medium text-white/60 hover:text-white transition-colors flex-shrink-0"
            >
              <ChevronLeft className="h-4 w-4" /> Campañas
            </button>
          )}
          <h3 className="text-[10px] font-semibold text-white/45 uppercase tracking-wider flex items-center gap-1.5 truncate">
            <History className="h-3 w-3" /> Diario de la semana
            <span className="text-white/25 normal-case tracking-normal tabular-nums">
              {ordered.length}
            </span>
          </h3>
        </div>
        {weekId && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="text-[11px] font-medium text-white/45 hover:text-white transition-colors flex items-center gap-1 flex-shrink-0"
          >
            {open ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
            {open ? 'Cerrar' : 'Apuntar'}
          </button>
        )}
      </div>

      <AnimatePresence initial={false}>
        {open && weekId && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="border-b border-white/[0.06] flex-shrink-0 overflow-hidden"
          >
            <div className="p-2.5 space-y-2">
              <select
                value={type}
                onChange={(e) => setType(e.target.value as MarketingChangeType)}
                className={`${fieldClass} cursor-pointer`}
                style={{ color: CHANGE_TYPE_COLORS[type] }}
              >
                {CHANGE_TYPES.map((t) => (
                  <option key={t} value={t} className={optionClass}>
                    {CHANGE_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !busy) submit()
                }}
                placeholder="Qué has cambiado y por qué"
                className={fieldClass}
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={before}
                  onChange={(e) => setBefore(e.target.value)}
                  placeholder="Antes"
                  className={`${fieldClass} tabular-nums`}
                />
                <input
                  value={after}
                  onChange={(e) => setAfter(e.target.value)}
                  placeholder="Después"
                  className={`${fieldClass} tabular-nums`}
                />
              </div>
              <button
                type="button"
                onClick={submit}
                disabled={busy}
                className="w-full h-8 rounded-lg bg-gradient-to-b from-[#FF7A1F] to-[#FF6600] text-white text-[12px] font-semibold disabled:opacity-50 transition-opacity"
              >
                {busy ? 'Apuntando...' : 'Apuntar cambio'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex-1 overflow-y-auto min-w-0">
        {ordered.length === 0 ? (
          <p className="text-[12px] text-white/30 text-center py-8 px-4">
            {weekId
              ? 'Todavía no hay cambios apuntados. Las pujas, los presupuestos y los estados de campaña que toques se anotan solos.'
              : 'Abre la semana para empezar a registrar cambios.'}
          </p>
        ) : (
          <ul className="p-1.5 space-y-1">
            {ordered.map((c) => {
              const color = CHANGE_TYPE_COLORS[c.change_type as MarketingChangeType] ?? '#64748B'
              const campaign = c.campaign_id ? campaignNames.get(c.campaign_id) : null
              const author = c.author_id ? authorNames.get(c.author_id) : null
              return (
                <li
                  key={c.id}
                  className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5"
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      className="h-1.5 w-1.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: color }}
                    />
                    <span
                      className="text-[10px] font-semibold uppercase tracking-wider truncate"
                      style={{ color }}
                    >
                      {changeTypeLabel(c.change_type)}
                    </span>
                    <span className="flex-1" />
                    <span className="text-[10px] text-white/30 tabular-nums flex-shrink-0">
                      {format(toMadrid(c.created_at), "d MMM '·' HH:mm", { locale: es })}
                    </span>
                  </div>

                  {c.description && (
                    <p className="text-[12px] text-white/80 mt-0.5 break-words">{c.description}</p>
                  )}

                  {(c.before_value || c.after_value) && (
                    <p className="text-[11px] mt-0.5 flex items-center gap-1 flex-wrap tabular-nums">
                      <span className="text-white/35 line-through">{c.before_value || '—'}</span>
                      <ArrowRight className="h-3 w-3 text-white/25 flex-shrink-0" />
                      <span className="text-white font-semibold">{c.after_value || '—'}</span>
                    </p>
                  )}

                  {(campaign || author) && (
                    <p className="text-[10px] text-white/25 mt-0.5 truncate">
                      {[campaign, author].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
