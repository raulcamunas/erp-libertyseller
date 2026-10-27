'use client'

import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { Check, Lock, Mic, Image as ImageIcon, MessageSquare, Store, Trash2, Video, X } from 'lucide-react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { createClient } from '@/lib/supabase/client'
import { toMadrid, fromMadrid } from '@/lib/timezone'
import { DURACION_CITA_MS, tieneDuracionFija } from '@/lib/agenda/duracion'
import {
  camposDelEnlace,
  CAMPOS_DE_LEAD_PARA_LA_CITA,
  datosDeLaCitaDesdeLead,
  enlaceDesdeLead,
  idDelLeadEnlazado,
  type EnlaceDeLead,
  type LeadParaLaCita,
} from '@/lib/agenda/cliente-lead'
import { camposDeUnaCita, cuerpoDeLosCampos, traerDatosDelLead, type CamposDelFormulario } from '@/lib/agenda/formulario'
import { BOTON, CAMPO, COLOR_ESTADO, INSIGNIA, TEXTO } from '@/lib/estilo/denso'
import {
  AppointmentWithPeople,
  AppointmentStatus,
  CalendarPerson,
  TranscriptionStatus,
  VENDE_EN_AMAZON_LABELS,
  VENDE_EN_AMAZON_OPCIONES,
  colorForAgent,
  type VendeEnAmazon,
} from '@/lib/types/appointments'
import { UserProfile } from '@/lib/supabase/get-user-profile'
import { AudioRecordingField } from './AudioRecordingField'
import { AttachmentsField } from './AttachmentsField'
import { TranscriptionPanel } from './TranscriptionPanel'
import { CommentsThread } from './CommentsThread'
import { BuscadorDeClientes } from './BuscadorDeClientes'
import { ESTADO_DE_CITA, iniciales } from './estados'

interface AppointmentSheetProps {
  mode: 'create' | 'edit'
  appointment: AppointmentWithPeople | null
  /** Fecha/hora prefijada al crear pinchando en el calendario */
  prefill?: { start: Date; end: Date } | null
  team: CalendarPerson[]
  currentUser: UserProfile
  onClose: () => void
  onSaved: (appt: AppointmentWithPeople) => void
  onDeleted: (id: string) => void
}

// Todas las fechas/horas de la ficha se muestran y se guardan en hora de España, sea cual sea el huso horario del navegador (comerciales en Latinoamérica incluidos)
function toDateInput(d: Date) {
  return format(toMadrid(d), 'yyyy-MM-dd')
}
function toTimeInput(d: Date) {
  return format(toMadrid(d), 'HH:mm')
}
function combine(dateStr: string, timeStr: string): Date {
  return fromMadrid(`${dateStr}T${timeStr}:00`)
}

const STATUS_OPTIONS: AppointmentStatus[] = ['scheduled', 'confirmed', 'rescheduled', 'no_show', 'qualified', 'not_qualified', 'cancelled']

const ID_BUSCADOR = 'cita-buscador-de-clientes'

/** Dos columnas. Escrita entera a propósito: Tailwind solo genera las clases que aparecen completas en el código, no las que se arman con un replace */
const REJILLA_DE_CAMPOS = 'grid grid-cols-2 gap-x-2.5 gap-y-[9px]'

/** Una sección de la ficha: título pequeño arriba y una caja con lo suyo dentro */
function Seccion({ titulo, icono, nota, children }: { titulo: string; icono?: ReactNode; nota?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-3">
      <h3 className="mb-2 flex min-h-[16px] items-center gap-1.5 text-[11px] font-semibold text-[var(--ls-t4)]">
        {icono}
        <span>{titulo}</span>
        {nota && <span className="ml-auto font-normal text-[var(--ls-t4)]">{nota}</span>}
      </h3>
      {children}
    </section>
  )
}

/** Un campo de texto con su etiqueta */
function Entrada({
  etiqueta, valor, onCambio, deshabilitado, placeholder, tipo = 'text', obligatorio, numerico, entera, paso, minimo, clase = '',
}: {
  etiqueta: string
  valor: string
  onCambio: (v: string) => void
  deshabilitado: boolean
  placeholder?: string
  tipo?: 'text' | 'date' | 'time' | 'number'
  obligatorio?: boolean
  numerico?: 'decimal' | 'numeric'
  entera?: boolean
  paso?: string
  minimo?: number
  /** Clases extra del contenedor (para colocarlo en la rejilla) */
  clase?: string
}) {
  const id = useId()
  return (
    <div className={`${CAMPO.contenedor} ${entera ? 'col-span-2' : ''} ${clase}`}>
      <label htmlFor={id} className={CAMPO.etiqueta}>
        {etiqueta}
        {obligatorio && <span className={CAMPO.obligatorio}> *</span>}
      </label>
      <input
        id={id}
        type={tipo}
        inputMode={numerico}
        step={paso}
        min={minimo}
        value={valor}
        onChange={(e) => onCambio(e.target.value)}
        disabled={deshabilitado}
        placeholder={placeholder}
        className={`${CAMPO.input} disabled:opacity-60`}
      />
    </div>
  )
}

/** Una opción de un grupo de pastillas: la elegida se enciende */
function Pastilla({ elegida, onClick, deshabilitada, children, color }: { elegida: boolean; onClick: () => void; deshabilitada: boolean; children: ReactNode; color?: string }) {
  return (
    <button
      type="button"
      aria-pressed={elegida}
      onClick={onClick}
      disabled={deshabilitada}
      // `chipEncendido` lleva `!` en el borde y el fondo y taparía el color propio de la pastilla (el de la persona o el del estado): con color se enciende por estilo
      className={`${BOTON.chip} !h-[26px] gap-1.5 ${elegida ? (color ? '!text-[var(--ls-t1)] font-medium' : BOTON.chipEncendido) : ''} ${deshabilitada ? 'cursor-not-allowed opacity-60' : ''}`}
      style={elegida && color ? { borderColor: color, background: `color-mix(in srgb, ${color} 16%, transparent)` } : undefined}
    >
      {children}
    </button>
  )
}

export function AppointmentSheet({ mode, appointment, prefill, team, currentUser, onClose, onSaved, onDeleted }: AppointmentSheetProps) {
  const supabase = useMemo(() => createClient(), [])
  const initialStart = appointment ? new Date(appointment.start_time) : prefill?.start ?? new Date()
  const initialEnd = appointment ? new Date(appointment.end_time) : prefill?.end ?? new Date(Date.now() + 60 * 60 * 1000)

  const [campos, setCampos] = useState<CamposDelFormulario>(() => camposDeUnaCita(appointment))
  const poner = <K extends keyof CamposDelFormulario>(clave: K, valor: CamposDelFormulario[K]) => setCampos((prev) => ({ ...prev, [clave]: valor }))

  // Si el que agenda es uno de los comerciales, se autoselecciona a sí mismo como closer para evitar que elija a otra persona por error
  const isAdmin = currentUser.role === 'admin' || currentUser.role === 'partner'
  // Un comercial (no admin) siempre agenda a su propio nombre: no puede elegir a otro closer, por si acaso se equivoca
  const loggedInIsComercial = team.some((p) => p.id === currentUser.id)
  const closerLocked = loggedInIsComercial && !isAdmin
  const [assignedCloser, setAssignedCloser] = useState<string>(closerLocked ? currentUser.id : appointment?.assigned_closer_id ?? 'none')
  const [date, setDate] = useState(toDateInput(initialStart))
  const [startTime, setStartTime] = useState(toTimeInput(initialStart))
  const [endTime, setEndTime] = useState(toTimeInput(initialEnd))

  const [recordingUrl, setRecordingUrl] = useState(appointment?.recording_url ?? null)
  const [recordingFilename, setRecordingFilename] = useState(appointment?.recording_filename ?? null)
  const [transcription, setTranscription] = useState(appointment?.transcription ?? null)
  const [transcriptionSummary, setTranscriptionSummary] = useState(appointment?.transcription_summary ?? null)
  const [transcriptionStatus, setTranscriptionStatus] = useState<TranscriptionStatus>(appointment?.transcription_status ?? 'none')
  const [transcriptionError, setTranscriptionError] = useState(appointment?.transcription_error ?? null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const isExternal = appointment?.is_external ?? false
  const canEdit = !isExternal && (mode === 'create' || isAdmin || appointment?.comercial_id === currentUser.id)

  // ── El lead de Cold Calling al que está enlazada la cita ──
  const leadEnlazadoAlAbrir = appointment ? idDelLeadEnlazado(appointment) : null
  const [enlace, setEnlace] = useState<EnlaceDeLead | null>(() =>
    leadEnlazadoAlAbrir
      ? { id: leadEnlazadoAlAbrir, nombre: appointment?.lead_company || appointment?.lead_name || 'Lead', estado: null, lista: null, responsable: null }
      : null
  )
  const [trayendo, setTrayendo] = useState(false)
  const nombres = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of team) m.set(p.id, p.full_name || p.email || '')
    m.set(currentUser.id, currentUser.full_name || currentUser.email || '')
    return m
  }, [team, currentUser])

  // Al abrir una cita ya enlazada se completa lo que se enseña del lead (su estado, su lista). Si no se puede leer —es de otra persona— se queda lo que había
  useEffect(() => {
    if (!leadEnlazadoAlAbrir) return
    let vivo = true
    supabase
      .from('cold_leads')
      .select(CAMPOS_DE_LEAD_PARA_LA_CITA)
      .eq('id', leadEnlazadoAlAbrir)
      .maybeSingle()
      .then(({ data }) => {
        if (vivo && data) setEnlace(enlaceDesdeLead(data as unknown as LeadParaLaCita))
      })
    return () => {
      vivo = false
    }
  }, [leadEnlazadoAlAbrir, supabase])

  /** Rellena la ficha con lo que sabe el lead y deja la cita enlazada a él */
  const traerDelLead = (lead: LeadParaLaCita) => {
    const traido = traerDatosDelLead(campos, datosDeLaCitaDesdeLead(lead))
    setCampos(traido.campos)
    setEnlace(enlaceDesdeLead(lead))
    const n = traido.cambiados.length
    toast.success(n > 0 ? `${n} ${n === 1 ? 'dato' : 'datos'} de «${lead.store_name}» traídos a la cita` : `Enlazada a «${lead.store_name}». Ya estaba todo apuntado.`)
  }

  const actualizarDelLead = async () => {
    if (!enlace) return
    setTrayendo(true)
    try {
      const { data, error } = await supabase.from('cold_leads').select(CAMPOS_DE_LEAD_PARA_LA_CITA).eq('id', enlace.id).maybeSingle()
      if (error || !data) throw error ?? new Error('sin acceso')
      traerDelLead(data as unknown as LeadParaLaCita)
    } catch (err) {
      console.error('Error trayendo los datos del lead:', err)
      toast.error('No se pudo leer ese lead. Puede que ya no sea tuyo.')
    } finally {
      setTrayendo(false)
    }
  }

  /**
   * UNA CITA DE UN COMERCIAL DURA SIEMPRE UNA HORA (lib/agenda/duracion.ts).
   *
   * La hora de fin no la elige él: es la de inicio más una hora, y se recalcula sola al cambiar el día o la hora de inicio. El servidor lo impone igualmente (ignora la hora
   * de fin que llegue), esto solo evita enseñar un campo que no vale. Los administradores y los socios siguen pudiendo poner la hora de fin.
   *
   * Una cita que ya existía y a la que NO se le cambia el día ni la hora de inicio enseña y manda la hora de fin que tenía: apuntar una nota en una cita antigua de media
   * hora no la alarga. En cuanto se le cambia la hora, pasa a una hora.
   */
  const duracionFija = tieneDuracionFija(currentUser.role)
  const horasCambiadas = !appointment || date !== toDateInput(initialStart) || startTime !== toTimeInput(initialStart)
  const inicioElegido = combine(date, startTime)
  const finImpuesto = duracionFija && horasCambiadas && !Number.isNaN(inicioElegido.getTime()) ? new Date(inicioElegido.getTime() + DURACION_CITA_MS) : null
  const finMostrado = finImpuesto ? toTimeInput(finImpuesto) : endTime
  const esAnterior = !!appointment && initialEnd.getTime() - initialStart.getTime() !== DURACION_CITA_MS

  const handleSave = async () => {
    if (!campos.leadName.trim()) {
      toast.error('El nombre del lead es obligatorio')
      return
    }
    const start = combine(date, startTime)
    if (Number.isNaN(start.getTime())) {
      toast.error('Pon el día y la hora de inicio')
      return
    }
    // Un comercial no elige la hora de fin: una hora desde el inicio (si le ha cambiado la hora); el servidor lo impone igualmente
    const end = finImpuesto ?? combine(date, endTime)
    if (end <= start) {
      toast.error('La hora de fin debe ser posterior a la de inicio')
      return
    }

    setSaving(true)
    try {
      const payload = {
        ...cuerpoDeLosCampos(campos),
        assigned_closer_id: closerLocked ? currentUser.id : assignedCloser === 'none' ? null : assignedCloser,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        // Solo viaja si el enlace con el lead ha cambiado: una cita que viene de la web o de LinkedIn conserva su origen aunque se edite aquí
        ...camposDelEnlace(leadEnlazadoAlAbrir, enlace?.id ?? null),
      }

      const res = await fetch(mode === 'create' ? '/api/appointments' : `/api/appointments/${appointment!.id}`, {
        method: mode === 'create' ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al guardar')

      toast.success(mode === 'create' ? 'Cita agendada' : 'Cita actualizada')
      onSaved(data as AppointmentWithPeople)
    } catch (err) {
      console.error('Error saving appointment:', err)
      toast.error('Error al guardar la cita')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!appointment) return
    if (!confirm('¿Eliminar esta cita? Esta acción no se puede deshacer.')) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/appointments/${appointment.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Error al eliminar')
      }
      toast.success('Cita eliminada')
      onDeleted(appointment.id)
    } catch (err) {
      console.error('Error deleting appointment:', err)
      toast.error('Error al eliminar la cita')
    } finally {
      setDeleting(false)
    }
  }

  const ownerColor = appointment?.comercial ? colorForAgent(appointment.comercial.id, appointment.comercial.calendar_color) : isExternal ? '#7C8493' : colorForAgent(currentUser.id)
  const ownerLabel = isExternal
    ? 'G'
    : appointment?.comercial
      ? iniciales(appointment.comercial.full_name, appointment.comercial.email || '')
      : iniciales(currentUser.full_name, currentUser.email || '')

  const estadoActual = ESTADO_DE_CITA[campos.status]
  const GlifoActual = estadoActual.icono
  const noVende = campos.vendeEnAmazon === 'no_vende'

  return (
    <Sheet open={true} onOpenChange={onClose}>
      <SheetContent
        className="w-full overflow-y-auto border-l border-[color:var(--ls-linea2)] bg-[var(--ls-fondo)] p-0 focus:outline-none focus-visible:outline-none sm:max-w-[500px]"
        // Al agendar, el foco va directo a buscar al cliente: lo primero que se hace es escribir su nombre
        onOpenAutoFocus={(e) => {
          if (mode === 'create' && canEdit) {
            e.preventDefault()
            document.getElementById(ID_BUSCADOR)?.focus()
          }
        }}
      >
        <div className="sticky top-0 z-20 border-b border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-4 py-3">
          <SheetHeader>
            <div className="flex items-start gap-2.5">
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                style={{ background: ownerColor }}
                aria-hidden
              >
                {ownerLabel}
              </div>
              <div className="min-w-0 flex-1">
                <SheetTitle className="truncate text-[15px] font-semibold leading-tight tracking-[-0.012em] text-[var(--ls-t1)]">
                  {mode === 'create' ? 'Nueva cita' : campos.leadName || 'Cita'}
                </SheetTitle>
                <SheetDescription className="mt-0.5 text-[11.5px] leading-tight text-[var(--ls-t3)]">
                  {isExternal
                    ? 'Evento importado de Google Calendar'
                    : mode === 'edit' && appointment?.comercial
                      ? `Agendada por ${appointment.comercial.full_name || appointment.comercial.email}`
                      : 'Busca al cliente o rellena los datos'}
                </SheetDescription>
              </div>
              <button type="button" onClick={onClose} className={`${BOTON.icono} !h-6 !w-6 shrink-0`} aria-label="Cerrar">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </SheetHeader>

          {mode === 'edit' && appointment && !isExternal && (
            <span className={`${INSIGNIA.base} mt-2`}>
              <GlifoActual className={INSIGNIA.icono} style={{ color: COLOR_ESTADO[estadoActual.tono] }} aria-hidden />
              {estadoActual.largo}
            </span>
          )}
        </div>

        <div className="space-y-2.5 px-4 py-3">
          {!canEdit && (
            <div className="flex items-center gap-2 rounded-[6px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] p-2.5 text-[11.5px] text-[var(--ls-t2)]">
              <Lock className="h-3.5 w-3.5 shrink-0 text-[var(--ls-t4)]" />
              {isExternal
                ? 'Este evento no lo gestiona el ERP: se importó de Google Calendar para que veas el hueco ocupado.'
                : 'Solo puedes ver esta cita. La agendó otro comercial.'}
            </div>
          )}

          {appointment?.google_meet_link && (
            <a
              href={appointment.google_meet_link}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-2 rounded-[6px] border border-[var(--ls-acc-graf)] bg-[var(--ls-acc-suave)] px-3 py-2 text-[12px] text-[var(--ls-t1)] hover:brightness-110"
            >
              <span className="flex items-center gap-2">
                <Video className="h-3.5 w-3.5 text-[var(--ls-acc)]" />
                Videollamada de Google Meet
              </span>
              <span className="font-semibold text-[var(--ls-acc)]">Unirse →</span>
            </a>
          )}

          {/* El cliente: se busca entre los leads de Cold Calling y se trae todo de un golpe */}
          {(canEdit || enlace) && (
            <Seccion titulo="Cliente de Cold Calling" nota={canEdit && !enlace ? 'trae sus datos y deja la cita enlazada' : undefined}>
              <BuscadorDeClientes
                enlace={enlace}
                puedeEditar={canEdit}
                nombres={nombres}
                idDelCampo={ID_BUSCADOR}
                trayendo={trayendo}
                onElegir={traerDelLead}
                onQuitar={() => setEnlace(null)}
                onActualizar={actualizarDelLead}
              />
            </Seccion>
          )}

          <Seccion titulo="Contacto">
            <div className={REJILLA_DE_CAMPOS}>
              <Entrada etiqueta="Nombre" valor={campos.leadName} onCambio={(v) => poner('leadName', v)} deshabilitado={!canEdit} placeholder="Nombre del contacto" obligatorio entera />
              <Entrada etiqueta="Email" valor={campos.leadEmail} onCambio={(v) => poner('leadEmail', v)} deshabilitado={!canEdit} placeholder="email@empresa.com" />
              <Entrada etiqueta="Teléfono" valor={campos.leadPhone} onCambio={(v) => poner('leadPhone', v)} deshabilitado={!canEdit} placeholder="+34 ..." />
              <Entrada etiqueta="Empresa" valor={campos.leadCompany} onCambio={(v) => poner('leadCompany', v)} deshabilitado={!canEdit} placeholder="Empresa" entera />
            </div>
          </Seccion>

          <Seccion titulo="Cuándo">
            {/* En un móvil estrecho el día va solo en su fila y inicio y fin comparten la siguiente: tres campos de fecha y hora no caben en 340 px */}
            <div className="grid grid-cols-2 gap-x-2.5 gap-y-[9px] sm:grid-cols-3">
              <Entrada etiqueta="Día" tipo="date" valor={date} onCambio={setDate} deshabilitado={!canEdit} clase="col-span-2 sm:col-span-1" />
              <Entrada etiqueta="Inicio" tipo="time" valor={startTime} onCambio={setStartTime} deshabilitado={!canEdit} />
              <div title={duracionFija ? 'La cita dura siempre 1 hora: la hora de fin se calcula sola' : undefined}>
                <Entrada
                  etiqueta="Fin"
                  tipo="time"
                  valor={finMostrado}
                  onCambio={setEndTime}
                  deshabilitado={!canEdit || duracionFija}
                />
              </div>
            </div>
            {duracionFija && canEdit && (
              <p className={`${CAMPO.nota} mt-2`}>
                {esAnterior && !horasCambiadas
                  ? 'Esta cita no dura 1 hora (es anterior a la regla). Si le cambias la hora, pasará a durar 1 hora.'
                  : 'Toda cita dura 1 hora: la hora de fin se pone sola.'}
              </p>
            )}
          </Seccion>

          {/* ¿Vende ya en Amazon? Es la primera pregunta de la llamada y la que decide el discurso entero: un seller que ya está en Amazon y una tienda que vende por su web son dos
              conversaciones, dos propuestas y dos precios. Saberlo DESPUÉS de agendar no sirve para preparar la cita, que es justo para lo que sirve. */}
          <Seccion titulo="¿Vende ya en Amazon?">
            <div className="flex flex-wrap gap-1.5">
              {VENDE_EN_AMAZON_OPCIONES.map((v) => {
                const elegido = campos.vendeEnAmazon === v
                const color = v === 'vende' ? COLOR_ESTADO.verde : v === 'no_vende' ? 'var(--ls-acc-graf)' : undefined
                return (
                  <Pastilla key={v} elegida={elegido} onClick={() => poner('vendeEnAmazon', v as VendeEnAmazon)} deshabilitada={!canEdit} color={color}>
                    {elegido && <Check className="h-3 w-3" />}
                    {VENDE_EN_AMAZON_LABELS[v]}
                  </Pastilla>
                )
              })}
            </div>
            {campos.vendeEnAmazon === 'sin_comprobar' && (
              <p className={`${CAMPO.nota} mt-2`}>Sin esto, quien atienda la cita no sabe con qué discurso entrar. Se comprueba en treinta segundos buscando la marca en Amazon.</p>
            )}
          </Seccion>

          {/* LA AGENDA EN DOS TIEMPOS. El comercial agenda rápido, EN LA LLAMADA: busca al cliente (o escribe nombre y teléfono), elige el día y la hora y aprieta «Agendar cita».
              Lo demás —asignación, datos comerciales y fiscales, su tienda, notas, grabación— lo completa DESPUÉS, ya con la cita creada. Por eso esa segunda parte está
              bloqueada y borrosa hasta guardar la cita por primera vez: ni estorba mientras se habla ni se rellena a medias.

              Si la cita está enlazada a un lead, los datos de ese lead YA van dentro (se traen al elegirlo y se guardan con la cita); lo bloqueado solo no se puede tocar.
              `inert` además saca esos campos del tabulador: sin él, tabulando desde «Fin» se podía escribir en campos que no se ven. */}
          <div className="relative">
            {mode === 'create' && (
              <div className="pointer-events-none sticky top-[76px] z-10 mb-2.5 flex justify-center">
                <div className="flex max-w-full items-center gap-2 rounded-[6px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-3 py-2 shadow-xl">
                  <Lock className="h-3.5 w-3.5 shrink-0 text-[var(--ls-acc)]" />
                  <span className="text-[11.5px] text-[var(--ls-t1)]">
                    {enlace
                      ? `Agenda la cita primero: los datos de «${enlace.nombre}» ya van traídos y el resto lo completas después`
                      : 'Agenda la cita primero para completar esta información'}
                  </span>
                </div>
              </div>
            )}
            <div
              className={`space-y-2.5 ${mode === 'create' ? 'pointer-events-none select-none opacity-40 blur-[3px]' : ''}`}
              aria-hidden={mode === 'create'}
              {...(mode === 'create' ? ({ inert: '' } as Record<string, string>) : {})}
            >
          <Seccion titulo="Asignación y estado">
            <div className={CAMPO.etiqueta}>Closer asignado</div>
            {closerLocked ? (
              <div className="flex items-center gap-1.5">
                <span className={`${BOTON.chip} !h-[26px] gap-1.5 !pl-1`} style={{ borderColor: colorForAgent(currentUser.id), background: `color-mix(in srgb, ${colorForAgent(currentUser.id)} 16%, transparent)` }}>
                  <span className="flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-bold text-white" style={{ background: colorForAgent(currentUser.id) }}>
                    {iniciales(currentUser.full_name, currentUser.email || '')}
                  </span>
                  <span className="text-[var(--ls-t1)]">{currentUser.full_name || currentUser.email}</span>
                </span>
                <span className={`flex items-center gap-1 text-[11px] ${TEXTO.t4}`}>
                  <Lock className="h-2.5 w-2.5" /> Eres tú
                </span>
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                <Pastilla elegida={assignedCloser === 'none'} onClick={() => setAssignedCloser('none')} deshabilitada={!canEdit}>
                  {assignedCloser === 'none' && <Check className="h-3 w-3" />}
                  Sin asignar
                </Pastilla>
                {team.map((p) => {
                  const color = colorForAgent(p.id, p.calendar_color)
                  const elegido = assignedCloser === p.id
                  return (
                    <Pastilla key={p.id} elegida={elegido} onClick={() => setAssignedCloser(p.id)} deshabilitada={!canEdit} color={color}>
                      <span className="flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-bold text-white" style={{ background: color, opacity: elegido ? 1 : 0.55 }}>
                        {iniciales(p.full_name, p.email || '')}
                      </span>
                      {p.full_name || p.email}
                    </Pastilla>
                  )
                })}
              </div>
            )}

            <div className={`${CAMPO.etiqueta} mt-3`}>Estado</div>
            <div className="flex flex-wrap gap-1.5">
              {STATUS_OPTIONS.map((s) => {
                const e = ESTADO_DE_CITA[s]
                const Glifo = e.icono
                return (
                  <Pastilla key={s} elegida={campos.status === s} onClick={() => poner('status', s)} deshabilitada={!canEdit} color={COLOR_ESTADO[e.tono]}>
                    <Glifo className="h-3 w-3" style={{ color: COLOR_ESTADO[e.tono] }} aria-hidden />
                    {e.largo}
                  </Pastilla>
                )
              })}
            </div>
          </Seccion>

          <Seccion titulo="Datos comerciales">
            <div className={REJILLA_DE_CAMPOS}>
              <Entrada etiqueta="Facturación (€)" tipo="number" numerico="decimal" valor={campos.revenueAmount} onCambio={(v) => poner('revenueAmount', v)} deshabilitado={!canEdit} placeholder="0,00" />
              <Entrada etiqueta="Fecha llamada" tipo="date" valor={campos.callDate} onCambio={(v) => poner('callDate', v)} deshabilitado={!canEdit} />
              {/* El enlace cambia según la respuesta de «¿vende ya en Amazon?»: si ya vende, lo que hay que mirar es su escaparate; si no, no hay escaparate y lo que tiene es su web */}
              {noVende ? (
                <Entrada etiqueta="Web" valor={campos.web} onCambio={(v) => poner('web', v)} deshabilitado={!canEdit} placeholder="https://sutienda.com" entera />
              ) : (
                <Entrada etiqueta="Link Amazon" valor={campos.amazonLink} onCambio={(v) => poner('amazonLink', v)} deshabilitado={!canEdit} placeholder="https://amazon.es/..." entera />
              )}
            </div>
          </Seccion>

          {/* Siempre a la vista: la razón social y el CIF hacen falta para facturar a cualquier cliente, venda ya en Amazon o no. Antes solo salían con «no vende» y lo que
              se traía de Cold Calling se quedaba escondido en una ficha que no los enseñaba */}
          <Seccion titulo="Datos fiscales">
            <div className={REJILLA_DE_CAMPOS}>
              <Entrada etiqueta="Razón social" valor={campos.razonSocial} onCambio={(v) => poner('razonSocial', v)} deshabilitado={!canEdit} placeholder="Luz del Sur SL" entera />
              <Entrada etiqueta="CIF" valor={campos.cif} onCambio={(v) => poner('cif', v)} deshabilitado={!canEdit} placeholder="B12345678" />
              <Entrada etiqueta="Ciudad" valor={campos.ciudad} onCambio={(v) => poner('ciudad', v)} deshabilitado={!canEdit} placeholder="Albacete" />
            </div>
          </Seccion>

          {/* Los datos de su tienda: solo cuando NO vende en Amazon, porque a un seller que ya está allí estos campos no le aplican. Que se escondan no borra nada: lo escrito
              se sigue guardando aunque luego se marque «vende». Son los mismos campos, con los mismos nombres, que la ficha de un lead de Cold Calling */}
          {noVende && (
            <Seccion titulo="Su tienda" icono={<Store className="h-3 w-3" />} nota="es lo único que hay para preparar la propuesta">
              <div className={REJILLA_DE_CAMPOS}>
                <Entrada etiqueta="Plataforma" valor={campos.plataforma} onCambio={(v) => poner('plataforma', v)} deshabilitado={!canEdit} placeholder="PrestaShop, Shopify, WooCommerce…" entera />
                <Entrada etiqueta="Productos" tipo="number" numerico="numeric" minimo={0} valor={campos.nProductos} onCambio={(v) => poner('nProductos', v)} deshabilitado={!canEdit} placeholder="112" />
                <Entrada etiqueta="Antigüedad (años)" tipo="number" numerico="decimal" minimo={0} paso="0.1" valor={campos.anosTienda} onCambio={(v) => poner('anosTienda', v)} deshabilitado={!canEdit} placeholder="7,7" />
                <Entrada etiqueta="Sector" valor={campos.sector} onCambio={(v) => poner('sector', v)} deshabilitado={!canEdit} placeholder="Mascotas" entera />
              </div>
            </Seccion>
          )}

          <Seccion titulo="Notas de la cita">
            <textarea
              value={campos.notes}
              onChange={(e) => poner('notes', e.target.value)}
              disabled={!canEdit}
              placeholder="Contexto del lead, qué se ha hablado, objetivo de la reunión..."
              className={`${CAMPO.input} !h-auto min-h-[76px] resize-none py-1.5 leading-[1.5] disabled:opacity-60`}
            />
          </Seccion>

          <Seccion titulo="Grabación y capturas" icono={<Mic className="h-3 w-3" />}>
            {mode === 'edit' && appointment ? (
              <div className="space-y-3">
                <div>
                  <AudioRecordingField
                    appointmentId={appointment.id}
                    recordingUrl={recordingUrl}
                    recordingFilename={recordingFilename}
                    canEdit={canEdit}
                    onChange={(url, filename) => {
                      setRecordingUrl(url)
                      setRecordingFilename(filename)
                    }}
                  />
                  <TranscriptionPanel
                    appointmentId={appointment.id}
                    hasRecording={Boolean(recordingUrl)}
                    transcription={transcription}
                    transcriptionSummary={transcriptionSummary}
                    transcriptionStatus={transcriptionStatus}
                    transcriptionError={transcriptionError}
                    canEdit={canEdit}
                    onUpdated={(fields) => {
                      setTranscription(fields.transcription)
                      setTranscriptionSummary(fields.transcription_summary)
                      setTranscriptionStatus(fields.transcription_status)
                      setTranscriptionError(fields.transcription_error)
                    }}
                  />
                </div>
                {/* Capturas: para las citas que se cierran por correo o WhatsApp, donde no hay grabación que subir */}
                <div>
                  <div className={`${CAMPO.etiqueta} flex items-center gap-1.5`}>
                    <ImageIcon className="h-3 w-3" /> Capturas de la conversación
                  </div>
                  <AttachmentsField appointmentId={appointment.id} currentUser={currentUser} canEdit={canEdit} />
                </div>
              </div>
            ) : (
              <p className={CAMPO.nota}>La grabación de la llamada y las capturas de la conversación se suben una vez agendada la cita.</p>
            )}
          </Seccion>
            </div>
          </div>

          {mode === 'edit' && appointment && (
            <Seccion titulo="Comentarios" icono={<MessageSquare className="h-3 w-3" />}>
              <CommentsThread appointmentId={appointment.id} currentUser={currentUser} />
            </Seccion>
          )}
        </div>

        {canEdit && (
          <div className="sticky bottom-0 z-20 flex gap-2 border-t border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-4 py-2.5">
            {mode === 'edit' && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className={`${BOTON.base} ${BOTON.secundario} !h-8 !w-8 shrink-0 justify-center !px-0 text-[var(--ls-e-rojo)]`}
                aria-label="Eliminar la cita"
                title="Eliminar la cita"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
            <button type="button" onClick={onClose} className={`${BOTON.base} ${BOTON.secundario} !h-8 flex-1 justify-center`}>
              Cancelar
            </button>
            <button type="button" onClick={handleSave} disabled={saving} className={`${BOTON.base} ${BOTON.primario} !h-8 flex-1 justify-center`}>
              {saving ? 'Guardando...' : mode === 'create' ? 'Agendar cita' : 'Guardar'}
            </button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
