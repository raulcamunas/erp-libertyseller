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
  BadgeEuro,
  FileSignature,
  FileText,
  History,
  Sparkles,
  StickyNote,
  Briefcase,
  Loader2,
  ClipboardList,
  CalendarCheck,
} from 'lucide-react'
import {
  CrmClientWithDetails,
  CrmDocument,
  CrmInteraction,
  CrmStage,
  CRM_STAGES,
  CRM_STAGE_LABELS,
  CRM_STAGE_COLORS,
  PREGUNTAS_REUNION,
  contestadas,
  crmContact,
} from '@/lib/types/crm'
import {
  APPOINTMENT_STATUS_LABELS,
  CalendarPerson,
  colorForAgent,
} from '@/lib/types/appointments'
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
  compacta,
  children,
}: {
  icon?: ReactNode
  label: string
  /** Etiqueta más estrecha, para cuando las filas van a dos columnas */
  compacta?: boolean
  children: ReactNode
}) {
  return (
    <div className="flex items-center gap-2 py-0.5 min-w-0">
      <div
        className={`${compacta ? 'w-[76px]' : 'w-[110px]'} flex-shrink-0 flex items-center gap-1.5 text-[12px] text-white/40`}
      >
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
  const contact = crmContact(client)
  // Si la ficha nace de una cita, la cita manda: nombre, email, teléfono y
  // empresa se editan allí para que agenda y CRM no se contradigan. En las
  // altas manuales no hay cita, así que se editan aquí.
  const isManual = !client.appointment_id

  // Campos editables. Se guardan al salir del campo (blur) si cambiaron,
  // igual que en Notion: sin botón de guardar.
  const [leadName, setLeadName] = useState(client.lead_name ?? '')
  const [leadEmail, setLeadEmail] = useState(client.lead_email ?? '')
  const [leadPhone, setLeadPhone] = useState(client.lead_phone ?? '')
  const [leadCompany, setLeadCompany] = useState(client.lead_company ?? '')
  const [manualRevenue, setManualRevenue] = useState(
    client.revenue_amount != null ? String(client.revenue_amount) : ''
  )
  const [manualAmazonLink, setManualAmazonLink] = useState(client.amazon_link ?? '')
  const [contactRole, setContactRole] = useState(client.contact_role ?? '')

  /**
   * Las respuestas del guion, en un solo objeto.
   *
   * Se guarda ENTERO en cada blur y no pregunta a pregunta: son veinticinco
   * campos en la misma columna JSONB, y veinticinco escrituras parciales contra
   * el mismo objeto es la receta para que la última pise a las anteriores en
   * cuanto alguien tabule rápido entre dos respuestas.
   */
  const [preguntas, setPreguntas] = useState<Record<string, string>>(client.preguntas ?? {})
  const [preguntasAbiertas, setPreguntasAbiertas] = useState(false)
  const [cambiandoCita, setCambiandoCita] = useState(false)
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
  const [closedAt, setClosedAt] = useState(
    client.closed_at ? format(toMadrid(client.closed_at), 'yyyy-MM-dd') : ''
  )
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

  // La fecha de cierre la sella un trigger al pasar a «Cliente cerrado»,
  // así que llega de vuelta por Realtime y hay que reflejarla aquí.
  useEffect(() => {
    setClosedAt(client.closed_at ? format(toMadrid(client.closed_at), 'yyyy-MM-dd') : '')
  }, [client.closed_at])

  /** Guarda el guion entero. Solo si algo ha cambiado de verdad */
  async function guardarPreguntas() {
    const limpio: Record<string, string> = {}
    for (const [clave, valor] of Object.entries(preguntas)) {
      const texto = valor.trim()
      if (texto !== '') limpio[clave] = texto
    }
    if (JSON.stringify(limpio) === JSON.stringify(client.preguntas ?? {})) return
    await patch({ preguntas: limpio })
    setPreguntas(limpio)
  }

  /**
   * Cualificar o descualificar la cita.
   *
   * VA POR LA RUTA DE LA AGENDA Y NO POR UN UPDATE DIRECTO, aunque el resto de
   * esta pantalla escriba directo contra Supabase. Las citas se sincronizan con
   * Google Calendar y esa ruta es la que lleva el `updated_source` y el
   * `sync_status`; escribiendo a pelo, el ERP y el calendario del comercial se
   * quedarían contando cosas distintas.
   */
  async function cambiarEstadoCita(estado: 'qualified' | 'not_qualified' | 'no_show') {
    if (!appt || cambiandoCita) return
    setCambiandoCita(true)
    const res = await fetch(`/api/appointments/${appt.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: estado }),
    })
    setCambiandoCita(false)
    if (!res.ok) {
      toast.error('No se pudo cambiar el estado de la cita')
      return
    }
    onPatched({ appointment: { ...appt, status: estado } })
    toast.success(
      estado === 'qualified'
        ? 'Cita cualificada'
        : estado === 'no_show'
          ? 'Cita marcada como «no asistió»'
          : 'Cita marcada como no cualificada'
    )
  }

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

  function commitNumber(
    field: 'setup_budget' | 'maintenance_budget' | 'revenue_amount',
    value: string
  ) {
    const parsed = value.trim() === '' ? null : Number(value)
    if (parsed !== null && Number.isNaN(parsed)) return
    if ((client[field] ?? null) === parsed) return
    patch({ [field]: parsed })
  }

  const meetingDate = contact.meetingAt
    ? format(toMadrid(contact.meetingAt), "d 'de' MMMM yyyy · HH:mm", { locale: es })
    : null

  const ownerPerson = team.find((p) => p.id === client.owner_id) ?? null

  const totalContestadas = PREGUNTAS_REUNION.reduce((n, b) => n + contestadas(b, preguntas), 0)

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
            {contact.name || 'Cliente'}
          </h2>
          <p className="text-[12px] text-white/40 truncate">
            {contact.company || 'Sin empresa'}
            {meetingDate ? ` · Reunión ${meetingDate}` : ' · Alta manual'}
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

      {/* ---------------- El guion de la reunión ---------------- */}
      {/* ARRIBA DEL TODO Y PLEGADO. Arriba porque se rellena MIENTRAS se habla
          con el cliente, y lo que hay que teclear en caliente no puede estar a
          tres scrolls. Plegado porque son veinticinco preguntas: desplegadas
          empujarían el resto de la ficha fuera de la pantalla el 95 % del
          tiempo, que es cuando no hay ninguna reunión en marcha. */}
      <Section
        icon={<ClipboardList className="h-3 w-3" />}
        title="Preguntas de la reunión"
        right={
          <button
            type="button"
            onClick={() => setPreguntasAbiertas((v) => !v)}
            className="text-[11px] text-white/40 hover:text-white transition-colors flex items-center gap-1.5"
          >
            {totalContestadas > 0 && (
              <span className="text-[#FF6600]">{totalContestadas} contestadas</span>
            )}
            {preguntasAbiertas ? 'Cerrar' : 'Abrir'}
          </button>
        }
      >
        {!preguntasAbiertas ? (
          <p className="text-[12px] text-white/35">
            El guion de la reunión: uno para quien ya vende en Amazon y otro para quien no.
          </p>
        ) : (
          <div className="space-y-3">
            {PREGUNTAS_REUNION.map((bloque) => (
              <div key={bloque.id}>
                <div className="flex items-baseline gap-2 mb-1">
                  <h4 className="text-[12px] font-semibold text-white/70">{bloque.titulo}</h4>
                  <span className="text-[11px] text-white/30">{bloque.pista}</span>
                  <span className="ml-auto text-[11px] text-white/30 tabular-nums">
                    {contestadas(bloque, preguntas)}/{bloque.preguntas.length}
                  </span>
                </div>
                {/* EN REJILLA Y NO APILADAS. Una pregunta por fila dejaba media
                    pantalla vacía a la derecha y obligaba a bajar veinticinco
                    veces en mitad de una reunión, que es justo cuando no se
                    puede estar buscando la siguiente casilla.

                    Se rompe por ancho de VENTANA y no del contenedor porque el
                    plugin de container queries no está en este proyecto. Los
                    cortes van corridos a propósito —la ficha vive en un panel
                    que comparte sitio con la lista de leads y siempre es más
                    estrecha que la pantalla—: dos columnas a partir de 640 y
                    tres a partir de 1.280, que es cuando a la ficha le quedan
                    unos 900 px y tres columnas de 300 se leen bien. */}
                <div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-1.5 items-start">
                  {bloque.preguntas.map((pregunta) => (
                    <div
                      key={pregunta.clave}
                      className={`rounded-lg border p-2 ${
                        // Las de cierre ocupan la fila entera: son las dos que
                        // deciden si hay trato, son largas de leer y en una
                        // columna estrecha se convierten en un párrafo de seis
                        // líneas que nadie lee entero.
                        pregunta.cierre ? 'sm:col-span-2 xl:col-span-3 ' : ''
                      }${
                        pregunta.cierre
                          ? 'border-emerald-500/25 bg-emerald-500/[0.06]'
                          : 'border-white/[0.07] bg-white/[0.02]'
                      }`}
                    >
                      <p
                        className={`text-[11.5px] leading-tight mb-1 ${
                          pregunta.cierre ? 'text-emerald-200/90 font-medium' : 'text-white/60'
                        }`}
                      >
                        {pregunta.texto}
                      </p>
                      <textarea
                        value={preguntas[pregunta.clave] ?? ''}
                        onChange={(e) =>
                          setPreguntas((prev) => ({ ...prev, [pregunta.clave]: e.target.value }))
                        }
                        onBlur={() => guardarPreguntas()}
                        rows={2}
                        placeholder="Escribe aquí lo que conteste"
                        className={`${ghostInput} resize-y min-h-[38px]`}
                      />
                    </div>
                  ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ---------------- La cita: cualificada o no ---------------- */}
      {/* VA ENCIMA DEL ESTADO DEL PIPELINE Y ES OTRA COSA. El estado dice por
          dónde va la venta; esto dice si la cita valió. Y no es cosmético: la
          comisión del comercial se devenga EXACTAMENTE por esto, así que la
          decisión tiene que estar donde se documenta al cliente y no escondida
          en la cajita del calendario.

          Escribe `appointments.status`, que es donde el ERP guarda esa decisión
          desde siempre — y por eso el cambio se ve a la vez aquí, en el
          calendario y en el cálculo de comisiones, sin que nada tenga que
          copiarse a ningún sitio. */}
      <Section icon={<CalendarCheck className="h-3 w-3" />} title="La cita">
        {!appt ? (
          <p className="text-[12px] text-white/35">
            Este lead se dio de alta a mano, sin cita en la agenda. No hay nada que cualificar y no
            genera comisión por cita.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {/* «No asistió» ES UN DESENLACE, NO UN ESTADO INTERMEDIO.
                  Antes salía en el texto de «todavía sin decidir», que es
                  justo lo contrario de lo que significa: la cita ya pasó y no
                  se presentó nadie. Y la diferencia importa —una cita perdida
                  por incomparecencia no es lo mismo que una que se celebró y no
                  valió— porque es el número que dice si el problema está en
                  cómo se agenda o en a quién se agenda. */}
              {(
                [
                  { valor: 'qualified' as const, texto: 'Cita cualificada', clase: 'border-emerald-500/50 bg-emerald-500/15 text-emerald-200' },
                  { valor: 'not_qualified' as const, texto: 'Cita no cualificada', clase: 'border-red-500/50 bg-red-500/15 text-red-200' },
                  { valor: 'no_show' as const, texto: 'No asistió', clase: 'border-amber-500/50 bg-amber-500/15 text-amber-200' },
                ]
              ).map((opcion) => {
                const activa = appt.status === opcion.valor
                return (
                  <button
                    key={opcion.valor}
                    type="button"
                    disabled={cambiandoCita}
                    onClick={() => !activa && cambiarEstadoCita(opcion.valor)}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors disabled:opacity-50 ${
                      activa ? opcion.clase : 'border-white/10 text-white/45 hover:text-white/80'
                    }`}
                  >
                    {opcion.texto}
                  </button>
                )
              })}
              {appt.status !== 'qualified' &&
                appt.status !== 'not_qualified' &&
                appt.status !== 'no_show' && (
                  <span className="text-[11px] text-white/35 self-center">
                    Todavía sin decidir · {APPOINTMENT_STATUS_LABELS[appt.status]}
                  </span>
                )}
            </div>
            <p className="text-[11px] text-white/30 mt-1.5">
              Solo <strong className="text-white/45">Cita cualificada</strong> genera la comisión del
              comercial que la agendó. Las otras dos no, y las tres se ven al momento en el
              calendario.
            </p>
          </>
        )}
      </Section>

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
          {/* Fecha de cierre = cuándo pagó de verdad. Se sella sola al
              marcar «Cliente cerrado», pero se puede corregir: una cita
              cualificada del 30 de julio que paga el 3 de agosto cuenta en
              la tesorería de agosto, no en la de julio. */}
          <Row icon={<BadgeEuro className="h-3 w-3" />} label="Fecha de cierre">
            <input
              type="date"
              value={closedAt}
              onChange={(e) => {
                setClosedAt(e.target.value)
                patch({
                  closed_at: e.target.value
                    ? new Date(`${e.target.value}T12:00:00Z`).toISOString()
                    : null,
                })
              }}
              disabled={client.stage !== 'ganado'}
              className={`${ghostInput} [color-scheme:dark] disabled:opacity-40`}
              title={
                client.stage !== 'ganado'
                  ? 'Solo se rellena cuando el cliente está cerrado'
                  : 'Día en que pagó: es lo que cuenta para la tesorería del mes'
              }
            />
          </Row>
        </div>
      </Section>

      {/* Datos del cliente */}
      <Section icon={<Building2 className="h-3 w-3" />} title="Datos del cliente">
        {/* A DOS COLUMNAS. Eran diez filas apiladas y la ficha empezaba con un
              scroll de datos que casi nunca se tocan: web, país, marketplaces.
              Emparejadas caben de un vistazo y lo de abajo —presupuesto, estado,
              notas— entra en pantalla sin bajar. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-0.5">
          <Row compacta icon={<User className="h-3 w-3" />} label="Contacto">
            {isManual ? (
              <input
                value={leadName}
                onChange={(e) => setLeadName(e.target.value)}
                onBlur={() => leadName.trim() && commitText('lead_name', leadName)}
                className={ghostInput}
                placeholder="Nombre y apellidos"
              />
            ) : (
              <ReadOnly value={contact.name} />
            )}
          </Row>
          <Row compacta icon={<Briefcase className="h-3 w-3" />} label="Cargo">
            <input
              value={contactRole}
              onChange={(e) => setContactRole(e.target.value)}
              onBlur={() => commitText('contact_role', contactRole)}
              className={ghostInput}
              placeholder="CEO, responsable ecommerce..."
            />
          </Row>
          <Row compacta icon={<Mail className="h-3 w-3" />} label="Email">
            {isManual ? (
              <input
                value={leadEmail}
                onChange={(e) => setLeadEmail(e.target.value)}
                onBlur={() => commitText('lead_email', leadEmail)}
                className={ghostInput}
                placeholder="hola@empresa.com"
              />
            ) : contact.email ? (
              <a
                href={`mailto:${contact.email}`}
                className="text-[13px] text-white/80 hover:text-[#FF6600] px-2 transition-colors break-all"
              >
                {contact.email}
              </a>
            ) : (
              <ReadOnly value={null} />
            )}
          </Row>
          <Row compacta icon={<Phone className="h-3 w-3" />} label="Teléfono">
            {isManual ? (
              <input
                value={leadPhone}
                onChange={(e) => setLeadPhone(e.target.value)}
                onBlur={() => commitText('lead_phone', leadPhone)}
                className={ghostInput}
                placeholder="+34..."
              />
            ) : (
              <ReadOnly value={contact.phone} />
            )}
          </Row>
          <Row compacta icon={<Building2 className="h-3 w-3" />} label="Empresa">
            {isManual ? (
              <input
                value={leadCompany}
                onChange={(e) => setLeadCompany(e.target.value)}
                onBlur={() => commitText('lead_company', leadCompany)}
                className={ghostInput}
                placeholder="Nombre de la empresa"
              />
            ) : (
              <ReadOnly value={contact.company} />
            )}
          </Row>
          <Row compacta icon={<Globe className="h-3 w-3" />} label="Web">
            <input
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              onBlur={() => commitText('website', website)}
              className={ghostInput}
              placeholder="https://..."
            />
          </Row>
          <Row compacta icon={<MapPin className="h-3 w-3" />} label="País">
            <input
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              onBlur={() => commitText('country', country)}
              className={ghostInput}
              placeholder="España"
            />
          </Row>
          <Row compacta icon={<Store className="h-3 w-3" />} label="Marketplaces">
            <input
              value={marketplaces}
              onChange={(e) => setMarketplaces(e.target.value)}
              onBlur={() => commitText('marketplaces', marketplaces)}
              className={ghostInput}
              placeholder="ES, IT, DE..."
            />
          </Row>
          <Row compacta icon={<Link2 className="h-3 w-3" />} label="Amazon">
            {isManual ? (
              <input
                value={manualAmazonLink}
                onChange={(e) => setManualAmazonLink(e.target.value)}
                onBlur={() => commitText('amazon_link', manualAmazonLink)}
                className={ghostInput}
                placeholder="https://amazon.es/..."
              />
            ) : contact.amazonLink ? (
              <a
                href={contact.amazonLink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[13px] text-white/80 hover:text-[#FF6600] px-2 transition-colors break-all"
              >
                {contact.amazonLink}
              </a>
            ) : (
              <ReadOnly value={null} />
            )}
          </Row>
          <Row compacta icon={<Euro className="h-3 w-3" />} label="Facturación">
            {isManual ? (
              <input
                value={manualRevenue}
                onChange={(e) => setManualRevenue(e.target.value)}
                onBlur={() => commitNumber('revenue_amount', manualRevenue)}
                inputMode="decimal"
                className={ghostInput}
                placeholder="0 €"
              />
            ) : (
              <ReadOnly
                value={
                  contact.revenue != null
                    ? `${Number(contact.revenue).toLocaleString('es-ES')} €`
                    : null
                }
              />
            )}
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
