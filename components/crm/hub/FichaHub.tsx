'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { toast } from 'sonner'
import { AlertTriangle, ExternalLink, Mail, Phone, Video } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { BOTON, COLOR_ESTADO } from '@/lib/estilo/denso'
import { toMadrid } from '@/lib/timezone'
import { colorForAgent, type CalendarPerson } from '@/lib/types/appointments'
import { CRM_STAGE_LABELS, crmContact, type CrmClientWithDetails, type CrmDocument, type CrmInteraction, type CrmStage } from '@/lib/types/crm'
import type { UserProfile } from '@/lib/supabase/get-user-profile'
import { avanceDeLaPropuesta, leerPlan } from '@/lib/crm/propuesta'
import { lineaDeFases, type EntradaDeFase } from '@/lib/crm/fases'
import { COLUMNAS_DE_NOTA, type FilaDeNota } from '@/lib/crm/gemini/tipos'
import { esTablaInexistente, FALTA_MIGRACION_258 } from '@/lib/crm/migracion'
import { iniciales } from '@/lib/crm/lista'
import { LineaDeFases } from './LineaDeFases'
import { Aviso } from './piezas'
import { PESTANAS, type ContextoFicha, type Pestana } from './tipos'
import { PestanaResumen } from './PestanaResumen'
import { PestanaReunion } from './PestanaReunion'
import { PestanaPropuesta } from './PestanaPropuesta'
import { PestanaActividad } from './PestanaActividad'
import { PestanaDocumentos } from './PestanaDocumentos'
import { PestanaDatos } from './PestanaDatos'

/**
 * LA FICHA DEL CLIENTE, EL HUB.
 * ==============================
 * Arriba, quién es y DÓNDE ESTÁ en el proceso (la línea de fases, con fechas y días). Debajo, seis pestañas con todo lo del cliente:
 *
 *   Resumen      lo esencial de un vistazo: siguiente paso, lo último de la reunión, dolores, propuesta
 *   Reunión      las notas de Gemini de Gmail y Drive, desglosadas por la IA, y el guion de la reunión
 *   Propuesta    lo que se le va a proponer (la base de la propuesta en PDF), importes y documentos
 *   Actividad    tomas de contacto e historial de fases
 *   Documentos   propuestas y contratos
 *   Datos        contacto, empresa, cita, responsable y notas internas
 *
 * Esta pantalla es la dueña de los datos de la ficha (tomas de contacto, documentos, historial de fases y notas de reunión, que se leen juntos al abrirla) y de CÓMO SE GUARDA
 * (`patch`); las pestañas solo los pintan y los piden cambiar. Todas las reglas de antes se conservan: solo dirección cambia la ficha (la RLS es el filtro de verdad; aquí se
 * dice lo mismo), cualificar una cita va por la ruta de la agenda y quien supervisa puede apuntar tomas de contacto.
 *
 * SI LA MIGRACIÓN 258 NO ESTÁ LANZADA la ficha funciona igual, sin historial ni notas, y lo dice una vez arriba.
 */

interface Props {
  client: CrmClientWithDetails
  team: CalendarPerson[]
  currentUser: UserProfile
  onPatched: (patch: Partial<CrmClientWithDetails>) => void
  puedeEditar: boolean
  /** El historial de fases que ya trajo el servidor para la lista (se refresca al abrir la ficha) */
  historialInicial: EntradaDeFase[]
  /** Si el servidor ya vio que la migración falta */
  migracionFaltaInicial: boolean
  /** Todos los clientes del CRM, en ligero, para asignar una nota de reunión a otro */
  clientes: ReadonlyArray<{ id: string; nombre: string; empresa: string | null }>
  /** Avisa a la lista de que las notas de este cliente han cambiado (se ha analizado una, se ha reasignado…) */
  onNotasCambiadas?: () => void
}

export function FichaHub({ client, team, currentUser, onPatched, puedeEditar, historialInicial, migracionFaltaInicial, clientes, onNotasCambiadas }: Props) {
  const supabase = createClient()
  const [pestana, setPestana] = useState<Pestana>('resumen')
  const [interacciones, setInteracciones] = useState<CrmInteraction[]>([])
  const [documentos, setDocumentos] = useState<CrmDocument[]>([])
  const [historial, setHistorial] = useState<EntradaDeFase[]>(historialInicial)
  const [notas, setNotas] = useState<FilaDeNota[]>([])
  const [cargando, setCargando] = useState(true)
  const [migracionFalta, setMigracionFalta] = useState(migracionFaltaInicial)
  const [cambiandoCita, setCambiandoCita] = useState(false)

  // «Ahora» se refresca cada minuto: los días de cada fase y las acciones vencidas no deben quedarse en el momento de abrir la ficha
  const [ahora, setAhora] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  const appt = client.appointment
  const contacto = crmContact(client)

  // Una ficha nueva empieza en el Resumen
  useEffect(() => {
    setPestana('resumen')
  }, [client.id])

  const cargarNotas = useCallback(async () => {
    const { data, error } = await supabase.from('crm_notas_reunion').select(COLUMNAS_DE_NOTA).eq('client_id', client.id).neq('estado', 'ignorada').order('fecha_reunion', { ascending: false, nullsFirst: false })
    if (error) {
      if (esTablaInexistente(error)) setMigracionFalta(true)
      else console.error('No se pudieron leer las notas de reunión:', error)
      return
    }
    setNotas((data ?? []) as unknown as FilaDeNota[])
    onNotasCambiadas?.()
  }, [supabase, client.id, onNotasCambiadas])

  // Todo lo de la ficha se lee junto al abrirla, en paralelo
  useEffect(() => {
    let activo = true
    setCargando(true)
    setNotas([])
    Promise.all([
      supabase.from('crm_interactions').select('*, author:profiles!crm_interactions_author_id_fkey(id, full_name, email, role, calendar_color)').eq('client_id', client.id).order('occurred_at', { ascending: false }),
      supabase.from('crm_documents').select('*').eq('client_id', client.id).order('created_at', { ascending: false }),
      supabase.from('crm_etapas_historial').select('etapa, desde, origen').eq('client_id', client.id).order('desde', { ascending: true }),
      supabase.from('crm_notas_reunion').select(COLUMNAS_DE_NOTA).eq('client_id', client.id).neq('estado', 'ignorada').order('fecha_reunion', { ascending: false, nullsFirst: false }),
    ]).then(([int, docs, hist, nts]) => {
      if (!activo) return
      setInteracciones((int.data as CrmInteraction[]) || [])
      setDocumentos((docs.data as CrmDocument[]) || [])
      if (hist.error) {
        if (esTablaInexistente(hist.error)) setMigracionFalta(true)
      } else setHistorial((hist.data ?? []) as unknown as EntradaDeFase[])
      if (nts.error) {
        if (esTablaInexistente(nts.error)) setMigracionFalta(true)
      } else setNotas((nts.data ?? []) as unknown as FilaDeNota[])
      setCargando(false)
    })
    return () => {
      activo = false
    }
  }, [client.id, supabase])

  // Cuando la fase cambia (aquí o en otro navegador) el disparador de la base anota una fila nueva: se vuelve a leer el historial
  useEffect(() => {
    if (migracionFalta) return
    let activo = true
    supabase
      .from('crm_etapas_historial')
      .select('etapa, desde, origen')
      .eq('client_id', client.id)
      .order('desde', { ascending: true })
      .then(({ data, error }) => {
        if (activo && !error) setHistorial((data ?? []) as unknown as EntradaDeFase[])
      })
    return () => {
      activo = false
    }
  }, [client.id, client.stage, migracionFalta, supabase])

  /** EL EMBUDO ÚNICO de escritura de crm_clients en esta pantalla: la etapa, los campos, el guion y el plan de propuesta pasan por aquí */
  const patch = useCallback(
    async (campos: Partial<CrmClientWithDetails>): Promise<boolean> => {
      if (!puedeEditar) {
        toast.error('Cambiar la ficha del cliente es de dirección. Puedes apuntar tomas de contacto.')
        return false
      }
      // Solo se mandan los campos tocados: nunca un update completo, para no pisar lo que otra persona esté editando a la vez
      const { error } = await supabase.from('crm_clients').update(campos).eq('id', client.id)
      if (error) {
        console.error('Error guardando ficha CRM:', error)
        toast.error(esTablaInexistente(error) ? FALTA_MIGRACION_258 : 'No se pudo guardar el cambio')
        return false
      }
      onPatched(campos)
      return true
    },
    [puedeEditar, supabase, client.id, onPatched]
  )

  function commitText(campo: keyof CrmClientWithDetails, valor: string) {
    const limpio = valor.trim() || null
    if ((client[campo] ?? null) === limpio) return
    void patch({ [campo]: limpio } as Partial<CrmClientWithDetails>)
  }

  function commitNumber(campo: 'setup_budget' | 'maintenance_budget' | 'revenue_amount', valor: string) {
    const numero = valor.trim() === '' ? null : Number(valor.replace(',', '.'))
    if (numero !== null && Number.isNaN(numero)) return
    if ((client[campo] ?? null) === numero) return
    void patch({ [campo]: numero })
  }

  /**
   * Cualificar o descualificar la cita.
   *
   * VA POR LA RUTA DE LA AGENDA Y NO POR UN UPDATE DIRECTO: las citas se sincronizan con Google Calendar y esa ruta es la que lleva el `updated_source` y el `sync_status`.
   * Y cualificar es pagar una comisión, así que solo lo hace dirección.
   */
  async function cambiarEstadoCita(estado: 'qualified' | 'not_qualified' | 'no_show') {
    if (!appt || cambiandoCita || !puedeEditar) return
    setCambiandoCita(true)
    const res = await fetch(`/api/appointments/${appt.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: estado }) })
    setCambiandoCita(false)
    if (!res.ok) {
      toast.error('No se pudo cambiar el estado de la cita')
      return
    }
    onPatched({ appointment: { ...appt, status: estado } })
    toast.success(estado === 'qualified' ? 'Cita cualificada' : estado === 'no_show' ? 'Cita marcada como «no asistió»' : 'Cita marcada como no cualificada')
  }

  async function cambiarFase(etapa: CrmStage) {
    if (etapa === client.stage) return
    const anterior = client.stage
    if (await patch({ stage: etapa })) {
      toast(`Pasa a «${CRM_STAGE_LABELS[etapa]}»`, { action: { label: 'Deshacer', onClick: () => void patch({ stage: anterior }) } })
    }
  }

  const linea = useMemo(() => lineaDeFases(client.stage, historial, new Date(ahora)), [client.stage, historial, ahora])
  const plan = useMemo(() => leerPlan(client.propuesta_plan), [client.propuesta_plan])
  const avance = useMemo(() => avanceDeLaPropuesta(plan, { setup: client.setup_budget, cuota: client.maintenance_budget }), [plan, client.setup_budget, client.maintenance_budget])

  const dueno = team.find((p) => p.id === client.owner_id) ?? null
  const fecha = contacto.meetingAt ? format(toMadrid(contacto.meetingAt), "d 'de' MMMM yyyy · HH:mm", { locale: es }) : null

  const ctx: ContextoFicha = {
    client,
    team,
    currentUser,
    puedeEditar,
    patch,
    commitText,
    commitNumber,
    cambiarFase,
    clientes,
    cambiarEstadoCita,
    cambiandoCita,
    interacciones,
    setInteracciones,
    documentos,
    setDocumentos,
    historial,
    notas,
    cargando,
    migracionFalta,
    refrescarNotas: cargarNotas,
    irA: setPestana,
    ahora,
  }

  const insigniaDe = (p: Pestana): string | null => {
    if (p === 'reunion') return notas.length > 0 ? String(notas.length) : null
    if (p === 'propuesta') return plan.origen || avance.hechas.length > 0 ? `${avance.hechas.length}/6` : null
    if (p === 'actividad') return interacciones.length > 0 ? String(interacciones.length) : null
    if (p === 'documentos') return documentos.length > 0 ? String(documentos.length) : null
    return null
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ---------------- Cabecera: quién es y dónde está ---------------- */}
      <div className="shrink-0 border-b border-[var(--ls-linea)] bg-[var(--ls-sup)] px-4 pb-3 pt-3">
        <div className="flex items-start gap-3">
          <span className="mt-px flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] text-[12px] font-bold text-[var(--ls-t2)]">{iniciales(contacto.name)}</span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[15px] font-semibold tracking-[-0.012em] text-[var(--ls-t1)]">{contacto.name || 'Cliente'}</h2>
            <p className="truncate text-[11.5px] text-[var(--ls-t3)]">
              {contacto.company || 'Sin empresa'}
              {fecha ? ` · Reunión ${fecha}` : ' · Alta manual'}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-[2px]">
            {contacto.email && (
              <a href={`mailto:${contacto.email}`} className={BOTON.icono} title={contacto.email}>
                <Mail className="h-3.5 w-3.5" />
              </a>
            )}
            {contacto.phone && (
              <a href={`tel:${contacto.phone}`} className={BOTON.icono} title={contacto.phone}>
                <Phone className="h-3.5 w-3.5" />
              </a>
            )}
            {appt?.google_meet_link && (
              <a href={appt.google_meet_link} target="_blank" rel="noopener noreferrer" className={BOTON.icono} title="Enlace de la reunión">
                <Video className="h-3.5 w-3.5" />
              </a>
            )}
            {contacto.amazonLink && (
              <a href={contacto.amazonLink} target="_blank" rel="noopener noreferrer" className={BOTON.icono} title="Enlace de Amazon">
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
            {dueno && (
              <span className="ml-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: colorForAgent(dueno.id, dueno.calendar_color) }} title={`Responsable: ${dueno.full_name || dueno.email || ''}`}>
                {(dueno.full_name || dueno.email || '?').slice(0, 2).toUpperCase()}
              </span>
            )}
          </div>
        </div>

        <div className="mt-3">
          <LineaDeFases linea={linea} puedeEditar={puedeEditar} onCambiar={cambiarFase} />
        </div>
      </div>

      {/* ---------------- Pestañas ---------------- */}
      <div className="flex shrink-0 items-center gap-[5px] overflow-x-auto border-b border-[var(--ls-linea)] bg-[var(--ls-sup)] px-4 py-[7px]" role="tablist">
        {PESTANAS.map((p) => {
          const encendida = pestana === p.id
          const insignia = insigniaDe(p.id)
          return (
            <button key={p.id} type="button" role="tab" aria-selected={encendida} onClick={() => setPestana(p.id)} className={`${BOTON.chip} ${encendida ? BOTON.chipEncendido : ''}`}>
              {p.nombre}
              {insignia && <span className={`tabular-nums ${encendida ? 'text-[var(--ls-t2)]' : 'text-[var(--ls-t4)]'}`}>{insignia}</span>}
            </button>
          )
        })}
      </div>

      {/* ---------------- Cuerpo ---------------- */}
      <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--ls-fondo)] p-3">
        {!puedeEditar && (
          <Aviso tono="naranja" icono={<AlertTriangle />} className="mb-3">
            Ficha de solo lectura. Puedes repasarla y apuntar tomas de contacto; cambiar los datos, la fase, los importes o el resultado de la cita es de dirección.
          </Aviso>
        )}
        {migracionFalta && puedeEditar && (
          <Aviso tono="ambar" icono={<AlertTriangle />} className="mb-3">
            <span style={{ color: COLOR_ESTADO.ambar }} className="font-semibold">Falta un paso. </span>
            {FALTA_MIGRACION_258} Mientras tanto la ficha funciona sin historial de fases, sin notas de Gemini y sin plan de propuesta.
          </Aviso>
        )}
        {pestana === 'resumen' && <PestanaResumen ctx={ctx} plan={plan} avance={avance} linea={linea} />}
        {pestana === 'reunion' && <PestanaReunion ctx={ctx} />}
        {pestana === 'propuesta' && <PestanaPropuesta ctx={ctx} plan={plan} avance={avance} />}
        {pestana === 'actividad' && <PestanaActividad ctx={ctx} linea={linea} />}
        {pestana === 'documentos' && <PestanaDocumentos ctx={ctx} />}
        {pestana === 'datos' && <PestanaDatos ctx={ctx} />}
      </div>
    </div>
  )
}
