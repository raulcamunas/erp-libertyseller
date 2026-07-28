'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { toMadrid } from '@/lib/timezone'
import {
  User,
  Mail,
  Phone,
  Building2,
  Globe,
  MapPin,
  Store,
  Euro,
  CalendarClock,
  Link2,
  Video,
  Target,
  FileSignature,
  FileText,
  History,
  Sparkles,
  StickyNote,
  Briefcase,
  Loader2,
} from 'lucide-react'
import {
  CrmClientWithDetails,
  CrmDocument,
  CrmInteraction,
  CrmStage,
  CRM_STAGES,
  CRM_STAGE_LABELS,
  CRM_STAGE_COLORS,
} from '@/lib/types/crm'
import { CalendarPerson, colorForAgent } from '@/lib/types/appointments'
import { UserProfile } from '@/lib/supabase/get-user-profile'
import { CrmDocuments } from './CrmDocuments'
import { CrmInteractions } from './CrmInteractions'

interface CrmClientDetailProps {
  client: CrmClientWithDetails
  team: CalendarPerson[]
  currentUser: UserProfile
  onPatched: (patch: Partial<CrmClientWithDetails>) => void
}

const ghostInput =
  'w-full bg-transparent hover:bg-white/[0.04] focus:bg-white/[0.06] border border-transparent focus:border-white/15 rounded-md px-2 py-1 text-[13px] text-white outline-none transition-colors placeholder:text-white/25'

function Section({
  icon,
  title,
  right,
  children,
}: {
  icon?: ReactNode
  title: string
  right?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <h3 className="text-[10px] font-semibold text-white/45 flex items-center gap-1.5 tracking-wider uppercase">
          {icon}
          {title}
        </h3>
        {right}
      </div>
      {children}
    </div>
  )
}

function Row({
  icon,
  label,
  children,
}: {
  icon?: ReactNode
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <div className="w-[110px] flex-shrink-0 flex items-center gap-1.5 text-[12px] text-white/40">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

function ReadOnly({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-[13px] text-white/25 px-2">—</span>
  return <span className="text-[13px] text-white/80 px-2 break-words">{value}</span>
}

export function CrmClientDetail({
  client,
  team,
  currentUser,
  onPatched,
}: CrmClientDetailProps) {
  const supabase = createClient()
  const appt = client.appointment

  // Campos editables. Se guardan al salir del campo (blur) si cambiaron,
  // igual que en Notion: sin botón de guardar.
  const [contactRole, setContactRole] = useState(client.contact_role ?? '')
  const [website, setWebsite] = useState(client.website ?? '')
  const [country, setCountry] = useState(client.country ?? '')
  const [marketplaces, setMarketplaces] = useState(client.marketplaces ?? '')
  const [setupBudget, setSetupBudget] = useState(
    client.setup_budget != null ? String(client.setup_budget) : ''
  )
  const [maintenanceBudget, setMaintenanceBudget] = useState(
    client.maintenance_budget != null ? String(client.maintenance_budget) : ''
  )
  const [nextAction, setNextAction] = useState(client.next_action ?? '')
  const [nextActionDate, setNextActionDate] = useState(client.next_action_date ?? '')
  const [notes, setNotes] = useState(client.notes ?? '')

  const [interactions, setInteractions] = useState<CrmInteraction[]>([])
  const [documents, setDocuments] = useState<CrmDocument[]>([])
  const [loadingExtras, setLoadingExtras] = useState(true)

  useEffect(() => {
    let active = true
    setLoadingExtras(true)
    Promise.all([
      supabase
        .from('crm_interactions')
        .select(
          '*, author:profiles!crm_interactions_author_id_fkey(id, full_name, email, role, calendar_color)'
        )
        .eq('client_id', client.id)
        .order('occurred_at', { ascending: false }),
      supabase
        .from('crm_documents')
        .select('*')
        .eq('client_id', client.id)
        .order('created_at', { ascending: false }),
    ]).then(([int, docs]) => {
      if (!active) return
      setInteractions((int.data as CrmInteraction[]) || [])
      setDocuments((docs.data as CrmDocument[]) || [])
      setLoadingExtras(false)
    })
    return () => {
      active = false
    }
  }, [client.id, supabase])

  async function patch(fields: Partial<CrmClientWithDetails>) {
    // Solo se mandan los campos tocados: nunca un update completo, para
    // no pisar lo que el otro admin esté editando a la vez.
    const { error } = await supabase.from('crm_clients').update(fields).eq('id', client.id)
    if (error) {
      console.error('Error guardando ficha CRM:', error)
      toast.error('No se pudo guardar el cambio')
      return
    }
    onPatched(fields)
  }

  /** Guarda solo si el valor cambió respecto a lo que hay en la ficha */
  function commitText(field: keyof CrmClientWithDetails, value: string) {
    const clean = value.trim() || null
    if ((client[field] ?? null) === clean) return
    patch({ [field]: clean } as Partial<CrmClientWithDetails>)
  }

  function commitNumber(field: 'setup_budget' | 'maintenance_budget', value: string) {
    const parsed = value.trim() === '' ? null : Number(value)
    if (parsed !== null && Number.isNaN(parsed)) return
    if ((client[field] ?? null) === parsed) return
    patch({ [field]: parsed })
  }

  const meetingDate = appt?.start_time
    ? format(toMadrid(appt.start_time), "d 'de' MMMM yyyy · HH:mm", { locale: es })
    : null

  const ownerPerson = team.find((p) => p.id === client.owner_id) ?? null

  return (
    <div className="h-full overflow-y-auto p-4 space-y-3">
      {/* Cabecera */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="flex items-start justify-between gap-3"
      >
        <div className="min-w-0">
          <h2 className="text-white text-lg font-semibold truncate">
            {appt?.lead_name || 'Cliente'}
          </h2>
          <p className="text-[12px] text-white/40 truncate">
            {appt?.lead_company || 'Sin empresa'}
            {meetingDate ? ` · Reunión ${meetingDate}` : ''}
          </p>
        </div>
        {ownerPerson && (
          <span
            className="h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0"
            style={{ backgroundColor: colorForAgent(ownerPerson.id, ownerPerson.calendar_color) }}
            title={ownerPerson.full_name || ownerPerson.email || ''}
          >
            {(ownerPerson.full_name || ownerPerson.email || '?').slice(0, 2).toUpperCase()}
          </span>
        )}
      </motion.div>

      {/* Estado del pipeline */}
      <Section icon={<Target className="h-3 w-3" />} title="Estado del cliente">
        <div className="flex flex-wrap gap-1.5">
          {CRM_STAGES.map((s: CrmStage) => {
            const active = client.stage === s
            return (
              <button
                key={s}
                type="button"
                onClick={() => !active && patch({ stage: s })}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${
                  active
                    ? `${CRM_STAGE_COLORS[s]} ring-1 ring-white/20`
                    : 'border-white/10 text-white/40 hover:text-white/80 hover:border-white/25'
                }`}
              >
                {CRM_STAGE_LABELS[s]}
              </button>
            )
          })}
        </div>
        <div className="mt-2 pt-2 border-t border-white/[0.06] space-y-0.5">
          <Row icon={<User className="h-3 w-3" />} label="Responsable">
            <select
              value={client.owner_id ?? 'none'}
              onChange={(e) =>
                patch({ owner_id: e.target.value === 'none' ? null : e.target.value })
              }
              className={`${ghostInput} cursor-pointer`}
            >
              <option value="none" className="bg-[#1a1a1a]">
                Sin asignar
              </option>
              {team.map((p) => (
                <option key={p.id} value={p.id} className="bg-[#1a1a1a]">
                  {p.full_name || p.email}
                </option>
              ))}
            </select>
          </Row>
          <Row icon={<CalendarClock className="h-3 w-3" />} label="Próxima acción">
            <input
              value={nextAction}
              onChange={(e) => setNextAction(e.target.value)}
              onBlur={() => commitText('next_action', nextAction)}
              className={ghostInput}
              placeholder="Llamar para cerrar propuesta..."
            />
          </Row>
          <Row icon={<CalendarClock className="h-3 w-3" />} label="Fecha">
            <input
              type="date"
              value={nextActionDate}
              onChange={(e) => {
                setNextActionDate(e.target.value)
                patch({ next_action_date: e.target.value || null })
              }}
              className={`${ghostInput} [color-scheme:dark]`}
            />
          </Row>
        </div>
      </Section>

      {/* Datos del cliente */}
      <Section icon={<Building2 className="h-3 w-3" />} title="Datos del cliente">
        <div className="space-y-0.5">
          <Row icon={<User className="h-3 w-3" />} label="Contacto">
            <ReadOnly value={appt?.lead_name} />
          </Row>
          <Row icon={<Briefcase className="h-3 w-3" />} label="Cargo">
            <input
              value={contactRole}
              onChange={(e) => setContactRole(e.target.value)}
              onBlur={() => commitText('contact_role', contactRole)}
              className={ghostInput}
              placeholder="CEO, responsable ecommerce..."
            />
          </Row>
          <Row icon={<Mail className="h-3 w-3" />} label="Email">
            {appt?.lead_email ? (
              <a
                href={`mailto:${appt.lead_email}`}
                className="text-[13px] text-white/80 hover:text-[#FF6600] px-2 transition-colors break-all"
              >
                {appt.lead_email}
              </a>
            ) : (
              <ReadOnly value={null} />
            )}
          </Row>
          <Row icon={<Phone className="h-3 w-3" />} label="Teléfono">
            <ReadOnly value={appt?.lead_phone} />
          </Row>
          <Row icon={<Building2 className="h-3 w-3" />} label="Empresa">
            <ReadOnly value={appt?.lead_company} />
          </Row>
          <Row icon={<Globe className="h-3 w-3" />} label="Web">
            <input
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              onBlur={() => commitText('website', website)}
              className={ghostInput}
              placeholder="https://..."
            />
          </Row>
          <Row icon={<MapPin className="h-3 w-3" />} label="País">
            <input
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              onBlur={() => commitText('country', country)}
              className={ghostInput}
              placeholder="España"
            />
          </Row>
          <Row icon={<Store className="h-3 w-3" />} label="Marketplaces">
            <input
              value={marketplaces}
              onChange={(e) => setMarketplaces(e.target.value)}
              onBlur={() => commitText('marketplaces', marketplaces)}
              className={ghostInput}
              placeholder="ES, IT, DE..."
            />
          </Row>
          <Row icon={<Link2 className="h-3 w-3" />} label="Amazon">
            {appt?.amazon_link ? (
              <a
                href={appt.amazon_link}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[13px] text-white/80 hover:text-[#FF6600] px-2 transition-colors break-all"
              >
                {appt.amazon_link}
              </a>
            ) : (
              <ReadOnly value={null} />
            )}
          </Row>
          <Row icon={<Euro className="h-3 w-3" />} label="Facturación">
            <ReadOnly
              value={
                appt?.revenue_amount != null
                  ? `${Number(appt.revenue_amount).toLocaleString('es-ES')} €`
                  : null
              }
            />
          </Row>
        </div>
      </Section>

      {/* Presupuesto */}
      <Section icon={<Euro className="h-3 w-3" />} title="Presupuesto lanzado">
        <div className="space-y-0.5">
          <Row icon={<Euro className="h-3 w-3" />} label="Set up">
            <input
              value={setupBudget}
              onChange={(e) => setSetupBudget(e.target.value)}
              onBlur={() => commitNumber('setup_budget', setupBudget)}
              inputMode="decimal"
              className={ghostInput}
              placeholder="0 €"
            />
          </Row>
          <Row icon={<Euro className="h-3 w-3" />} label="Mantenimiento">
            <input
              value={maintenanceBudget}
              onChange={(e) => setMaintenanceBudget(e.target.value)}
              onBlur={() => commitNumber('maintenance_budget', maintenanceBudget)}
              inputMode="decimal"
              className={ghostInput}
              placeholder="0 € / mes"
            />
          </Row>
        </div>
      </Section>

      {/* Documentos */}
      <Section icon={<FileText className="h-3 w-3" />} title="Propuesta">
        {loadingExtras ? (
          <p className="text-[11px] text-white/25 flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" /> Cargando...
          </p>
        ) : (
          <CrmDocuments
            clientId={client.id}
            kind="propuesta"
            label="Propuesta"
            documents={documents}
            onChange={setDocuments}
          />
        )}
      </Section>

      <Section icon={<FileSignature className="h-3 w-3" />} title="Contrato">
        {loadingExtras ? (
          <p className="text-[11px] text-white/25 flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" /> Cargando...
          </p>
        ) : (
          <CrmDocuments
            clientId={client.id}
            kind="contrato"
            label="Contrato"
            documents={documents}
            onChange={setDocuments}
          />
        )}
      </Section>

      {/* Tomas de contacto */}
      <Section icon={<History className="h-3 w-3" />} title="Tomas de contacto">
        {loadingExtras ? (
          <p className="text-[11px] text-white/25 flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" /> Cargando...
          </p>
        ) : (
          <CrmInteractions
            clientId={client.id}
            currentUser={currentUser}
            interactions={interactions}
            onChange={setInteractions}
          />
        )}
      </Section>

      {/* Contexto de la llamada de cualificación */}
      {(appt?.transcription_summary || appt?.notes || appt?.google_meet_link) && (
        <Section icon={<Sparkles className="h-3 w-3" />} title="De la cita de cualificación">
          <div className="space-y-2">
            {appt?.google_meet_link && (
              <a
                href={appt.google_meet_link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[12px] text-white/70 hover:text-[#FF6600] transition-colors"
              >
                <Video className="h-3 w-3" /> Enlace de la reunión
              </a>
            )}
            {appt?.notes && (
              <p className="text-[12px] text-white/60 whitespace-pre-wrap leading-snug">
                {appt.notes}
              </p>
            )}
            {appt?.transcription_summary && (
              <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-2.5">
                <p className="text-[10px] uppercase tracking-wider text-white/30 mb-1">
                  Resumen IA de la llamada
                </p>
                <p className="text-[12px] text-white/65 whitespace-pre-wrap leading-snug">
                  {appt.transcription_summary}
                </p>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Notas internas del CRM */}
      <Section icon={<StickyNote className="h-3 w-3" />} title="Notas internas">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => commitText('notes', notes)}
          rows={4}
          placeholder="Todo lo que haya que recordar de este cliente..."
          className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-2.5 py-2 text-[12px] text-white outline-none focus:border-[#FF6600] transition-colors resize-none placeholder:text-white/25"
        />
      </Section>
    </div>
  )
}
