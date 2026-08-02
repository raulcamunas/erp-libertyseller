'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { toMadrid } from '@/lib/timezone'
import {
  Phone,
  Mail,
  Building2,
  Euro,
  MapPin,
  Tag,
  ExternalLink,
  Users,
  CalendarClock,
  History,
  FileText,
  ChevronRight,
  PhoneCall,
  Copy,
} from 'lucide-react'
import {
  ColdLead,
  ColdLeadStatus,
  ColdNoteKind,
  COLD_STATUSES,
  COLD_STATUS_LABELS,
  COLD_STATUS_HINTS,
  COLD_STATUS_DOTS,
  telHref,
  formatRevenue,
} from '@/lib/types/cold-leads'
import { UserProfile } from '@/lib/supabase/get-user-profile'
import { ColdLeadNotes } from './ColdLeadNotes'

interface ColdLeadDetailProps {
  lead: ColdLead
  currentUser: UserProfile
  canEdit: boolean
  onPatched: (patch: Partial<ColdLead>) => void
  onNext: () => void
}

const ghostInput =
  'w-full bg-transparent hover:bg-white/[0.04] focus:bg-white/[0.06] border border-transparent focus:border-white/15 rounded-md px-2 py-1 text-[13px] text-white outline-none transition-colors placeholder:text-white/25'

function Section({
  icon,
  title,
  children,
}: {
  icon?: ReactNode
  title: string
  children: ReactNode
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <h3 className="text-[10px] font-semibold text-white/45 flex items-center gap-1.5 tracking-wider uppercase mb-1.5">
        {icon}
        {title}
      </h3>
      {children}
    </div>
  )
}

function Row({ icon, label, children }: { icon?: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <div className="w-[104px] flex-shrink-0 flex items-center gap-1.5 text-[12px] text-white/40">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

function Value({ children }: { children: ReactNode }) {
  return <span className="text-[13px] text-white/80 px-2 break-words">{children}</span>
}

export function ColdLeadDetail({
  lead,
  currentUser,
  canEdit,
  onPatched,
  onNext,
}: ColdLeadDetailProps) {
  const supabase = createClient()
  const [followUp, setFollowUp] = useState(lead.follow_up ?? '')
  const [nextCall, setNextCall] = useState(lead.next_call_date ?? '')

  useEffect(() => {
    setFollowUp(lead.follow_up ?? '')
    setNextCall(lead.next_call_date ?? '')
  }, [lead.id, lead.follow_up, lead.next_call_date])

  async function patch(fields: Partial<ColdLead>) {
    const { error } = await supabase.from('cold_leads').update(fields).eq('id', lead.id)
    if (error) {
      console.error('Error guardando el lead:', error)
      toast.error('No se pudo guardar')
      return
    }
    onPatched(fields)
  }

  /** Cambiar estado deja constancia de cuándo se tocó por última vez */
  function setStatus(status: ColdLeadStatus) {
    if (status === lead.status) return
    patch({ status, last_contacted_at: new Date().toISOString() })
  }

  /** Al registrar una llamada se suma intento y se sella la fecha */
  function handleLogged(kind: ColdNoteKind) {
    const fields: Partial<ColdLead> = { last_contacted_at: new Date().toISOString() }
    if (kind === 'llamada') fields.call_attempts = (lead.call_attempts ?? 0) + 1
    patch(fields)
  }

  const tel = telHref(lead.phone)

  return (
    <div className="h-full overflow-y-auto p-4 space-y-3">
      {/* Cabecera con la acción principal: llamar */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18 }}
        className="flex items-start justify-between gap-3"
      >
        <div className="min-w-0">
          <h2 className="text-white text-lg font-semibold truncate">{lead.store_name}</h2>
          <p className="text-[12px] text-white/40 truncate">
            {lead.company || 'Sin empresa'}
            {lead.revenue_monthly != null
              ? ` · ${formatRevenue(lead.revenue_monthly)}/mes`
              : ''}
            {lead.call_attempts > 0
              ? ` · ${lead.call_attempts} ${
                  lead.call_attempts === 1 ? 'intento' : 'intentos'
                }`
              : ''}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {tel && (
            <a
              href={`tel:${tel}`}
              className="h-9 px-4 rounded-full bg-gradient-to-b from-[#FF7A1F] to-[#FF6600] text-white text-[13px] font-semibold flex items-center gap-2 shadow-[0_4px_16px_-6px_rgba(255,102,0,0.6)]"
            >
              <PhoneCall className="h-4 w-4" /> Llamar
            </a>
          )}
          <button
            type="button"
            onClick={onNext}
            title="Siguiente lead sin contactar"
            className="h-9 px-3 rounded-full border border-white/10 bg-white/[0.03] text-white/70 text-[13px] font-medium flex items-center gap-1 hover:bg-white/[0.06] hover:text-white transition-colors"
          >
            Siguiente <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </motion.div>

      {/* Estado: lo que más se toca, arriba del todo */}
      <Section title="Estado de la gestión">
        <div className="flex flex-wrap gap-1.5">
          {COLD_STATUSES.map((s) => {
            const active = lead.status === s
            return (
              <button
                key={s}
                type="button"
                onClick={() => canEdit && setStatus(s)}
                disabled={!canEdit}
                title={COLD_STATUS_HINTS[s]}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all flex items-center gap-1.5 disabled:opacity-50 ${
                  active
                    ? 'text-white ring-1 ring-white/25'
                    : 'border-white/10 text-white/45 hover:text-white/85 hover:border-white/25'
                }`}
                style={
                  active
                    ? {
                        backgroundColor: `${COLD_STATUS_DOTS[s]}26`,
                        borderColor: `${COLD_STATUS_DOTS[s]}80`,
                      }
                    : undefined
                }
              >
                <span
                  className="h-2 w-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: COLD_STATUS_DOTS[s] }}
                />
                {COLD_STATUS_LABELS[s]}
              </button>
            )
          })}
        </div>
        <p className="text-[10px] text-white/30 mt-1.5">{COLD_STATUS_HINTS[lead.status]}</p>

        <div className="mt-2 pt-2 border-t border-white/[0.06]">
          <Row icon={<CalendarClock className="h-3 w-3" />} label="Rellamar el">
            <input
              type="date"
              value={nextCall}
              onChange={(e) => {
                setNextCall(e.target.value)
                patch({ next_call_date: e.target.value || null })
              }}
              disabled={!canEdit}
              className={`${ghostInput} [color-scheme:dark]`}
            />
          </Row>
          {lead.last_contacted_at && (
            <Row icon={<History className="h-3 w-3" />} label="Último contacto">
              <Value>
                {format(toMadrid(lead.last_contacted_at), "d MMM yyyy, HH:mm", { locale: es })}
              </Value>
            </Row>
          )}
        </div>
      </Section>

      {/* Contacto */}
      <Section icon={<Phone className="h-3 w-3" />} title="Contacto">
        <div className="space-y-0.5">
          <Row icon={<Phone className="h-3 w-3" />} label="Teléfono">
            {lead.phone ? (
              <span className="flex items-center gap-1.5 px-2">
                <span className="text-[13px] text-white/85 break-all">{lead.phone}</span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(lead.phone!)
                    toast.success('Teléfono copiado')
                  }}
                  className="text-white/30 hover:text-white transition-colors flex-shrink-0"
                  title="Copiar"
                >
                  <Copy className="h-3 w-3" />
                </button>
              </span>
            ) : (
              <Value>—</Value>
            )}
          </Row>
          <Row icon={<Mail className="h-3 w-3" />} label="Email">
            {lead.email ? (
              <a
                href={`mailto:${lead.email.split(/[\s/,;]+/)[0]}`}
                className="text-[13px] text-white/80 hover:text-[#FF6600] px-2 transition-colors break-all"
              >
                {lead.email}
              </a>
            ) : (
              <Value>—</Value>
            )}
          </Row>
          <Row icon={<Users className="h-3 w-3" />} label="Directivos">
            <Value>{lead.directors || '—'}</Value>
          </Row>
        </div>
      </Section>

      {/* Datos del seller */}
      <Section icon={<Building2 className="h-3 w-3" />} title="Datos del seller">
        <div className="space-y-0.5">
          <Row icon={<Building2 className="h-3 w-3" />} label="Empresa">
            <Value>{lead.company || '—'}</Value>
          </Row>
          <Row icon={<Euro className="h-3 w-3" />} label="Facturación">
            <Value>
              {lead.revenue_monthly != null
                ? `${formatRevenue(lead.revenue_monthly)} / mes`
                : '—'}
            </Value>
          </Row>
          {lead.amazon_start && (
            <Row icon={<CalendarClock className="h-3 w-3" />} label="Vende desde">
              <Value>{lead.amazon_start}</Value>
            </Row>
          )}
          <Row icon={<MapPin className="h-3 w-3" />} label="Provincia">
            <Value>{lead.province || '—'}</Value>
          </Row>
          <Row icon={<Tag className="h-3 w-3" />} label="Categoría">
            <Value>
              {[lead.category, lead.subcategory].filter(Boolean).join(' · ') || '—'}
            </Value>
          </Row>
          {lead.seller_url && (
            <Row icon={<ExternalLink className="h-3 w-3" />} label="Perfil seller">
              <a
                href={lead.seller_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[13px] text-white/80 hover:text-[#FF6600] px-2 transition-colors inline-flex items-center gap-1"
              >
                Ver en Amazon <ExternalLink className="h-3 w-3" />
              </a>
            </Row>
          )}
          {lead.business_address && (
            <Row icon={<MapPin className="h-3 w-3" />} label="Dirección">
              <Value>{lead.business_address}</Value>
            </Row>
          )}
          {lead.mercantile_registry && (
            <Row icon={<FileText className="h-3 w-3" />} label="Reg. mercantil">
              <Value>{lead.mercantile_registry}</Value>
            </Row>
          )}
        </div>
      </Section>

      {/* Interacciones */}
      <Section icon={<History className="h-3 w-3" />} title="Interacciones">
        <ColdLeadNotes
          key={lead.id}
          leadId={lead.id}
          currentUser={currentUser}
          onLogged={handleLogged}
        />
      </Section>

      {/* Nota viva del lead. El seguimiento original del Excel está además
          como primera entrada del historial, así que se puede reescribir
          esto sin perder lo que ya se había apuntado. */}
      <Section icon={<FileText className="h-3 w-3" />} title="Nota del lead">
        <textarea
          value={followUp}
          onChange={(e) => setFollowUp(e.target.value)}
          onBlur={() => {
            const clean = followUp.trim() || null
            if ((lead.follow_up ?? null) !== clean) patch({ follow_up: clean })
          }}
          disabled={!canEdit}
          rows={4}
          placeholder="Contexto del lead, lo que se habló, con quién..."
          className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-2.5 py-2 text-[12px] text-white outline-none focus:border-[#FF6600] transition-colors resize-none placeholder:text-white/25 disabled:opacity-60"
        />
        <p className="text-[10px] text-white/25 mt-1.5">
          Resumen siempre a la vista. Lo que venía del Excel está también en
          el historial de arriba, así que puedes reescribir esto sin perderlo.
          {lead.action_label ? ` · Etiqueta original: ${lead.action_label}` : ''}
        </p>
      </Section>
    </div>
  )
}
