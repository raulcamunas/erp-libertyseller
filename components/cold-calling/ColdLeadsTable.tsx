'use client'

import { Fragment, useState, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { toMadrid } from '@/lib/timezone'
import {
  Building2,
  CalendarClock,
  ChevronRight,
  Copy,
  Euro,
  ExternalLink,
  FileText,
  History,
  Mail,
  MapPin,
  Maximize2,
  Phone,
  Tag,
  Users,
} from 'lucide-react'
import {
  ColdLead,
  ColdLeadStatus,
  ColdNoteKind,
  COLD_STATUSES,
  COLD_STATUS_LABELS,
  COLD_STATUS_DOTS,
  colorForList,
  formatRevenue,
} from '@/lib/types/cold-leads'
import { UserProfile } from '@/lib/supabase/get-user-profile'
import { ColdLeadNotes } from './ColdLeadNotes'

interface ColdLeadsTableProps {
  leads: ColdLead[]
  currentUserId: string
  /** Hace falta entero para poder registrar interacciones sin salir de la tabla */
  currentUser: UserProfile
  isAdmin: boolean
  selectedId: string | null
  onSelect: (id: string) => void
  /** Abre la ficha completa de ese lead */
  onOpenDetail: (id: string) => void
  onPatched: (id: string, patch: Partial<ColdLead>) => void
}

/** Celda de texto editable al vuelo, como en una hoja de cálculo */
function EditableCell({
  value,
  onSave,
  disabled,
  placeholder,
  className = '',
}: {
  value: string
  onSave: (v: string) => void
  disabled: boolean
  placeholder?: string
  className?: string
}) {
  const [draft, setDraft] = useState(value)
  const [editing, setEditing] = useState(false)

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          if (disabled) return
          setDraft(value)
          setEditing(true)
        }}
        disabled={disabled}
        title={value || undefined}
        className={`w-full text-left truncate px-2 py-1 rounded hover:bg-white/[0.06] transition-colors disabled:hover:bg-transparent ${
          value ? 'text-white/75' : 'text-white/20'
        } ${className}`}
      >
        {value || placeholder || '—'}
      </button>
    )
  }

  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setEditing(false)
        if (draft !== value) onSave(draft)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setDraft(value)
          setEditing(false)
        }
      }}
      autoFocus
      className="w-full bg-white/[0.08] border border-[#FF6600] rounded px-2 py-1 text-white outline-none"
    />
  )
}

/**
 * LA EMPRESA, DENTRO DEL DESPLEGABLE.
 *
 * La tabla enseña once columnas y no caben en pantalla: en cuanto la ventana no
 * da de sí, Email, Provincia y Categoría se van por la derecha y hay que hacer
 * scroll horizontal para verlas. Justo cuando el comercial está al teléfono.
 *
 * Aquí está todo junto y sin scroll, incluido lo que NO tiene columna propia
 * —desde cuándo vende, los directivos, la dirección, el registro mercantil— y
 * los dos datos que dicen si esta rellamada es la segunda o la sexta.
 *
 * Es la misma información que la ficha completa, escrita aparte a propósito: la
 * ficha es una barra lateral estrecha y va en una columna; esto es una banda
 * ancha y va en rejilla. Compartir el marcado obligaría a que una de las dos
 * pasara la disposición como parámetro, que es más enredo que estas líneas.
 */
function DatosEmpresa({ lead }: { lead: ColdLead }) {
  const categoria = [lead.category, lead.subcategory].filter(Boolean).join(' · ')

  return (
    // Anclada a la izquierda y con ancho tope: la fila desplegada es tan ancha
    // como la tabla entera, y una rejilla estirada a 1.900 px deja los últimos
    // campos fuera de la pantalla otra vez.
    <div className="mb-3 max-w-[940px] rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <h4 className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/45">
        <Building2 className="h-3 w-3" />
        La empresa
      </h4>

      <div className="grid gap-x-7 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
        <Campo icon={<Building2 className="h-3 w-3" />} label="Empresa">
          {lead.company || '—'}
        </Campo>

        <Campo icon={<Euro className="h-3 w-3" />} label="Facturación">
          {lead.revenue_monthly != null ? `${formatRevenue(lead.revenue_monthly)} / mes` : '—'}
        </Campo>

        <Campo icon={<CalendarClock className="h-3 w-3" />} label="Vende desde">
          {lead.amazon_start || '—'}
        </Campo>

        <Campo icon={<Phone className="h-3 w-3" />} label="Teléfono">
          {lead.phone ? (
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(lead.phone!)
                toast.success('Teléfono copiado')
              }}
              className="inline-flex items-center gap-1 transition-colors hover:text-white"
              title="Copiar el teléfono"
            >
              {lead.phone}
              <Copy className="h-3 w-3 flex-shrink-0 opacity-40" />
            </button>
          ) : (
            '—'
          )}
        </Campo>

        <Campo icon={<Mail className="h-3 w-3" />} label="Email">
          {lead.email ? (
            <a
              href={`mailto:${lead.email.split(/[\s/,;]+/)[0]}`}
              className="block truncate transition-colors hover:text-[#FF6600]"
              title={lead.email}
            >
              {lead.email}
            </a>
          ) : (
            '—'
          )}
        </Campo>

        <Campo icon={<Users className="h-3 w-3" />} label="Directivos">
          {lead.directors || '—'}
        </Campo>

        <Campo icon={<MapPin className="h-3 w-3" />} label="Provincia">
          {lead.province || '—'}
        </Campo>

        <Campo icon={<Tag className="h-3 w-3" />} label="Categoría">
          <span className="block truncate" title={categoria || undefined}>
            {categoria || '—'}
          </span>
        </Campo>

        <Campo icon={<FileText className="h-3 w-3" />} label="Reg. mercantil">
          {lead.mercantile_registry || '—'}
        </Campo>

        <Campo icon={<MapPin className="h-3 w-3" />} label="Dirección">
          {lead.business_address || '—'}
        </Campo>

        {/* Cuántas veces se ha intentado ya. En una pantalla que se llama
            «Rellamadas» es el dato que decide si esta llamada es insistir o
            enterrar el lead, y no tiene columna en la tabla. */}
        <Campo icon={<History className="h-3 w-3" />} label="Intentos">
          {lead.call_attempts > 0 ? (
            <>
              {lead.call_attempts}
              {lead.last_contacted_at && (
                <span className="text-white/40">
                  {' · último '}
                  {format(toMadrid(lead.last_contacted_at), 'd MMM, HH:mm', { locale: es })}
                </span>
              )}
            </>
          ) : (
            <span className="text-white/40">sin llamadas todavía</span>
          )}
        </Campo>

        <Campo icon={<ExternalLink className="h-3 w-3" />} label="Perfil seller">
          {lead.seller_url ? (
            <a
              href={lead.seller_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 transition-colors hover:text-[#FF6600]"
            >
              Ver en Amazon <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            '—'
          )}
        </Campo>
      </div>
    </div>
  )
}

/** Una etiqueta y su valor, con la etiqueta a ancho fijo para que las tres
    columnas de la rejilla queden alineadas entre sí */
function Campo({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 py-0.5">
      <span className="flex w-[96px] flex-shrink-0 items-center gap-1.5 text-[11px] text-white/35">
        {icon}
        <span className="truncate">{label}</span>
      </span>
      <span className="min-w-0 flex-1 text-[12px] text-white/80">{children}</span>
    </div>
  )
}

const TH =
  'px-2 py-1.5 text-left text-[10px] font-semibold text-white/40 uppercase tracking-wider whitespace-nowrap border-b border-white/10'

export function ColdLeadsTable({
  leads,
  currentUserId,
  currentUser,
  isAdmin,
  selectedId,
  onSelect,
  onOpenDetail,
  onPatched,
}: ColdLeadsTableProps) {
  const supabase = createClient()

  /**
   * QUÉ FILAS TIENEN EL HISTORIAL ABIERTO.
   *
   * Es un conjunto y no un solo id a propósito: en «Rellamadas de hoy» el
   * comercial baja la lista llamando una detrás de otra, y cerrarle la anterior
   * cada vez que abre la siguiente le obliga a volver a buscarla si el de
   * ahora le remite a algo que ya había apuntado.
   */
  const [abiertos, setAbiertos] = useState<Set<string>>(() => new Set())

  function alternar(id: string) {
    setAbiertos((prev) => {
      const siguiente = new Set(prev)
      if (siguiente.has(id)) siguiente.delete(id)
      else siguiente.add(id)
      return siguiente
    })
  }

  /**
   * Lo mismo que hace la ficha al registrar algo: sella el último contacto y
   * suma un intento si fue una llamada.
   *
   * Se repite aquí —cuatro líneas— en vez de sacarlo a un sitio común porque
   * sacarlo obligaría a que la tabla y la ficha compartieran también el `patch`
   * y el estado local del lead, y eso son dos componentes atados por algo que
   * cabe en un vistazo.
   */
  function registrado(id: string, kind: ColdNoteKind, lead: ColdLead) {
    const fields: Partial<ColdLead> = { last_contacted_at: new Date().toISOString() }
    if (kind === 'llamada') fields.call_attempts = (lead.call_attempts ?? 0) + 1
    void patch(id, fields)
  }

  async function patch(id: string, fields: Partial<ColdLead>) {
    const { error } = await supabase.from('cold_leads').update(fields).eq('id', id)
    if (error) {
      console.error('Error guardando el lead:', error)
      toast.error('No se pudo guardar')
      return
    }
    onPatched(id, fields)
  }

  return (
    // El scroll horizontal vive aquí dentro: la caja no crece, crece la
    // tabla, así que la barra lateral y el resto de la página no se mueven.
    <div className="h-full w-full min-w-0 overflow-auto rounded-2xl border border-white/10 bg-white/[0.02]">
      <table className="border-collapse text-[12px] min-w-max">
        <thead className="sticky top-0 z-20 bg-[#0d0d0d]">
          <tr>
            <th
              className={`${TH} sticky left-0 z-30 bg-[#0d0d0d] min-w-[190px] border-r border-white/[0.07]`}
            >
              Tienda
            </th>
            <th className={`${TH} min-w-[170px]`}>Empresa</th>
            <th className={`${TH} text-right min-w-[110px]`}>Facturación</th>
            <th className={`${TH} min-w-[170px]`}>Estado</th>
            <th className={`${TH} min-w-[140px]`}>Teléfono</th>
            <th className={`${TH} min-w-[120px]`}>Rellamar</th>
            <th className={`${TH} min-w-[280px]`}>Seguimiento</th>
            <th className={`${TH} min-w-[180px]`}>Email</th>
            <th className={`${TH} min-w-[120px]`}>Provincia</th>
            <th className={`${TH} min-w-[160px]`}>Categoría</th>
            <th className={`${TH} min-w-[110px]`}>Lista</th>
            <th className={`${TH} w-[70px]`}></th>
          </tr>
        </thead>
        <tbody>
          {leads.map((l) => {
            const canEdit = isAdmin || l.assigned_to === currentUserId
            const color = COLD_STATUS_DOTS[l.status]
            const active = l.id === selectedId
            const abierto = abiertos.has(l.id)

            // Fondo teñido con el color del estado: es exactamente lo que
            // hacían en el Excel pintando la fila entera.
            const rowBg = active
              ? 'rgba(255,102,0,0.14)'
              : l.status === 'pendiente'
                ? 'transparent'
                : `${color}14`

            return (
              <Fragment key={l.id}>
              <tr
                onClick={() => onSelect(l.id)}
                style={{ backgroundColor: rowBg }}
                className="border-b border-white/[0.05] hover:brightness-125 transition-[filter] cursor-pointer align-middle"
              >
                <td
                  className="sticky left-0 z-10 px-2 py-1 font-semibold text-white whitespace-nowrap border-r border-white/[0.07]"
                  style={{
                    // El tinte del estado es translúcido: sobre una celda
                    // congelada dejaría ver el resto de la fila pasando por
                    // debajo. Se pinta encima de un fondo opaco para que
                    // tape de verdad.
                    backgroundColor: 'var(--ls-sup)',
                    backgroundImage: `linear-gradient(${rowBg}, ${rowBg})`,
                  }}
                >
                  <span className="flex items-center gap-1.5">
                    {/* LA FLECHITA VA DENTRO DE ESTA CELDA Y NO EN UNA COLUMNA
                        PROPIA. Esta es la única columna congelada de la tabla:
                        una columna más a su izquierda habría que congelarla
                        también, con su ancho y su tinte de estado, para ganar
                        exactamente nada. */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        alternar(l.id)
                      }}
                      title={abierto ? 'Cerrar el historial' : 'Ver el historial sin salir de aquí'}
                      className={`h-5 w-5 rounded flex items-center justify-center flex-shrink-0 transition-colors ${
                        abierto ? 'text-[#FF6600]' : 'text-white/30 hover:text-white'
                      }`}
                    >
                      <motion.span
                        animate={{ rotate: abierto ? 90 : 0 }}
                        transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
                        className="flex"
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </motion.span>
                    </button>
                    <span
                      className="h-2 w-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: color }}
                    />
                    <span className="truncate max-w-[160px]" title={l.store_name}>
                      {l.store_name}
                    </span>
                  </span>
                </td>

                <td className="px-2 py-1 text-white/65">
                  <span className="truncate block max-w-[170px]" title={l.company || ''}>
                    {l.company || '—'}
                  </span>
                </td>

                <td className="px-2 py-1 text-right text-white/80 tabular-nums whitespace-nowrap">
                  {l.revenue_monthly != null
                    ? `${Math.round(Number(l.revenue_monthly)).toLocaleString('es-ES')} €`
                    : '—'}
                </td>

                <td className="px-1 py-1" onClick={(e) => e.stopPropagation()}>
                  <select
                    value={l.status}
                    disabled={!canEdit}
                    onChange={(e) =>
                      patch(l.id, {
                        status: e.target.value as ColdLeadStatus,
                        last_contacted_at: new Date().toISOString(),
                      })
                    }
                    className="w-full rounded px-1.5 py-1 text-[11px] font-medium text-white outline-none border cursor-pointer disabled:cursor-default"
                    style={{
                      backgroundColor: `${color}26`,
                      borderColor: `${color}66`,
                    }}
                  >
                    {COLD_STATUSES.map((s) => (
                      <option key={s} value={s} className="bg-[#1a1a1a] text-white">
                        {COLD_STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </td>

                <td
                  className="px-2 py-1 text-white/70 whitespace-nowrap"
                  onClick={(e) => e.stopPropagation()}
                >
                  {l.phone ? (
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(l.phone!)
                        toast.success('Teléfono copiado')
                      }}
                      className="inline-flex items-center gap-1 hover:text-white transition-colors"
                      title="Copiar el teléfono"
                    >
                      {l.phone}
                      <Copy className="h-3 w-3 flex-shrink-0 opacity-40" />
                    </button>
                  ) : (
                    <span className="text-white/20">—</span>
                  )}
                </td>

                <td className="px-1 py-1" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="date"
                    value={l.next_call_date ?? ''}
                    disabled={!canEdit}
                    onChange={(e) =>
                      patch(l.id, { next_call_date: e.target.value || null })
                    }
                    className="w-full bg-transparent hover:bg-white/[0.06] focus:bg-white/[0.08] rounded px-1 py-1 text-[11px] text-white/75 outline-none [color-scheme:dark] transition-colors"
                  />
                </td>

                <td className="px-1 py-1 max-w-[280px]" onClick={(e) => e.stopPropagation()}>
                  <EditableCell
                    value={l.follow_up ?? ''}
                    disabled={!canEdit}
                    placeholder="Añadir seguimiento..."
                    onSave={(v) => patch(l.id, { follow_up: v.trim() || null })}
                  />
                </td>

                <td className="px-2 py-1 text-white/55" onClick={(e) => e.stopPropagation()}>
                  {l.email ? (
                    <a
                      href={`mailto:${l.email.split(/[\s/,;]+/)[0]}`}
                      className="truncate block max-w-[180px] hover:text-[#FF6600] transition-colors"
                      title={l.email}
                    >
                      {l.email}
                    </a>
                  ) : (
                    <span className="text-white/20">—</span>
                  )}
                </td>

                <td className="px-2 py-1 text-white/55 whitespace-nowrap">
                  {l.province || '—'}
                </td>

                <td className="px-2 py-1 text-white/55">
                  <span
                    className="truncate block max-w-[160px]"
                    title={[l.category, l.subcategory].filter(Boolean).join(' · ')}
                  >
                    {l.category || '—'}
                  </span>
                </td>

                <td className="px-2 py-1 whitespace-nowrap">
                  {l.source_list && (
                    <span
                      className="text-[9px] font-medium px-1.5 py-0.5 rounded border leading-none"
                      style={{
                        color: colorForList(l.source_list),
                        borderColor: `${colorForList(l.source_list)}55`,
                        backgroundColor: `${colorForList(l.source_list)}1a`,
                      }}
                    >
                      {l.source_list}
                    </span>
                  )}
                </td>

                <td className="px-1 py-1 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                  <span className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onOpenDetail(l.id)}
                      title="Abrir ficha completa"
                      className="h-6 w-6 rounded flex items-center justify-center text-white/35 hover:text-white hover:bg-white/[0.08] transition-colors"
                    >
                      <Maximize2 className="h-3 w-3" />
                    </button>
                    {l.seller_url && (
                      <a
                        href={l.seller_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Ver en Amazon"
                        className="h-6 w-6 rounded flex items-center justify-center text-white/35 hover:text-white hover:bg-white/[0.08] transition-colors"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </span>
                </td>
              </tr>

              {/* EL HISTORIAL, DEBAJO DE SU FILA.
                  Es la misma pieza que usa la ficha completa —mismas
                  interacciones, mismo formulario, mismo guardado—, así que lo
                  que se apunte aquí y lo que se apunte allí es lo mismo y no
                  hay dos historiales que puedan desincronizarse.

                  La altura se anima con `height: auto`, que framer-motion sabe
                  medir; el `overflow-hidden` es lo que evita que el contenido
                  asome antes de tiempo y dé el tirón feo. */}
              <AnimatePresence initial={false}>
                {abierto && (
                  <motion.tr
                    key={`${l.id}-historial`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                  >
                    <td colSpan={12} className="p-0 border-b border-white/[0.08]">
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: 'auto' }}
                        exit={{ height: 0 }}
                        transition={{ duration: 0.24, ease: [0.4, 0, 0.2, 1] }}
                        className="overflow-hidden"
                      >
                        <div className="px-3 py-3 bg-black/25">
                          <DatosEmpresa lead={l} />
                          <ColdLeadNotes
                            leadId={l.id}
                            currentUser={currentUser}
                            onLogged={(kind) => registrado(l.id, kind, l)}
                          />
                        </div>
                      </motion.div>
                    </td>
                  </motion.tr>
                )}
              </AnimatePresence>
            </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
