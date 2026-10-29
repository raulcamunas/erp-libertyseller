'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { BarChart3, CalendarCheck, Check, ChevronLeft, Handshake, MailSearch, MousePointerClick, Pencil, Plus, Search, Trophy } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { fetchAll } from '@/lib/supabase/paginacion'
import { BOTON, CIFRAS, COLOR_ESTADO, INSIGNIA, TITULO } from '@/lib/estilo/denso'
import { toMadrid } from '@/lib/timezone'
import { crmContact, type CrmClientWithDetails, type CrmStage } from '@/lib/types/crm'
import type { WorkHourEntry, PayrollRate } from '@/lib/types/payroll'
import { monthCostTotal } from '@/lib/payroll/cost'
import type { CalendarPerson } from '@/lib/types/appointments'
import type { UserProfile } from '@/lib/supabase/get-user-profile'
import { useIsMobile } from '@/lib/use-is-mobile'
import { cicloDeVenta, type EntradaDeFase } from '@/lib/crm/fases'
import type { AlcanceDelCrm } from '@/lib/crm/acceso'
import { agruparPorCliente, cifrasDelPipeline, ETIQUETA_CORTA, FILTRO_INICIAL, filtrarClientes, resumenDeFila, type NotaLigera } from '@/lib/crm/lista'
import {
  FASES_DEL_SEGUIMIENTO,
  FILTROS_DE_CITA,
  ORDENES_DE_SEGUIMIENTO,
  coincideConElFiltroDeCita,
  contarPorPestana,
  cuentaDeCerrados,
  cuentaDeCitas,
  ordenarCerrados,
  ordenarCitas,
  ordenarSeguimiento,
  pestanaDe,
  resumenDeContactos,
  situacionDeLaCita,
  type ContactoLigero,
  type FiltroDeCerrado,
  type FiltroDeCita,
  type OrdenDeSeguimiento,
  type PestanaDelCrm,
} from '@/lib/crm/pestanas'
import { esTablaInexistente } from '@/lib/crm/migracion'
import { NewLeadDialog } from '../NewLeadDialog'
import { MonthBreakdown } from '../MonthBreakdown'
import { BandejaDeNotas } from './BandejaDeNotas'
import { BarraDePestanas } from './BarraDePestanas'
import { FichaHub } from './FichaHub'
import { FilaDeCerrado, FilaDeCita, FilaDeSeguimiento, SinFilas } from './filas'
import { Boton } from './piezas'
import { useAccionesDeFase } from './useAccionesDeFase'

/**
 * EL CRM DE CLIENTES, EL HUB.
 * ============================
 * ARRIBA, UNA BARRA DE TRES PESTAÑAS (Cita agendada · En seguimiento · Cerrado; lib/crm/pestanas.ts) que separa lo que hay que hacer con cada lead en cada momento: en Cita
 * agendada se decide si se sigue con él o se descarta; en En seguimiento se ve el proceso de cada uno hasta cerrarlo; en Cerrado están los ganados y los perdidos. A la izquierda,
 * la lista de la pestaña (con los botones de cada lead) y a la derecha la ficha entera: la línea de fases, las notas de Gemini desglosadas por la IA, la propuesta que se le va a
 * hacer, la actividad, los documentos y los datos.
 *
 * QUIÉN VE QUÉ lo dice `alcance` (lib/crm/acceso.ts): dirección y los managers ven todos los clientes, un comercial autónomo solo los suyos; mover un lead (seguir, descartar, avanzar,
 * cerrar, perder, reabrir) lo hacen los tres, y los importes, el responsable y el resultado de la cita solo dirección.
 *
 * Es la sucesora de ClientsCRM: conserva TODO lo de entonces —la lectura en vivo de las fichas, las horas y comisiones del equipo, el desglose del mes, el alta de un cliente a mano,
 * lo que ve cada rol— y le añade el historial de fases, las notas de reunión y el plan de propuesta (migración 258). Sin esa migración funciona igual, sin esas tres cosas.
 */

/** Cita cualificada, con lo justo para calcular comisiones */
export interface CrmQualifiedAppointment {
  id: string
  comercial_id: string | null
  start_time: string
}

export interface HubCrmProps {
  initialClients: CrmClientWithDetails[]
  team: CalendarPerson[]
  currentUser: UserProfile
  workHours: WorkHourEntry[]
  payrollRates: PayrollRate[]
  qualifiedAppointments: CrmQualifiedAppointment[]
  initialUsdEurRate: number
  /** Quién ve qué cliente y qué puede hacer con él (lib/crm/acceso.ts). La RLS de las migraciones 212 y 261 dice lo mismo: esto hace que la pantalla también */
  alcance: AlcanceDelCrm
  /** El historial de fases de todos los clientes, para los días en la fase de cada fila */
  historialesIniciales: Record<string, EntradaDeFase[]>
  /** Las notas de reunión, en ligero (sin contenido) */
  notasIniciales: NotaLigera[]
  /** Las tomas de contacto, en ligero (tipo y fecha, sin texto), para «último contacto» en En seguimiento */
  contactosIniciales: ContactoLigero[]
  /** Por cliente, la nota de descartar más reciente («Descartado: …»), para enseñar el motivo en Cerrado → Perdidos */
  motivosDeDescarte: Record<string, string>
  /** El servidor vio que la migración 258 no está lanzada */
  migracionFalta: boolean
  /** Si se llega con ?cliente=<id>, esa ficha abierta */
  clienteInicial: string | null
}

const CLIENT_SELECT = `
  *,
  appointment:appointments!crm_clients_appointment_id_fkey(
    *,
    comercial:profiles!appointments_comercial_id_fkey(id, full_name, email, role, calendar_color),
    assigned_closer:profiles!appointments_assigned_closer_id_fkey(id, full_name, email, role, calendar_color)
  )
`

const euros = (n: number | null | undefined) => (n == null ? null : `${Number(n).toLocaleString('es-ES')} €`)
const dolares = (n: number) => `${Math.round(n).toLocaleString('es-ES')} $`
const pad = (n: number) => String(n).padStart(2, '0')

const SELECT_SENCILLO =
  'h-6 shrink-0 cursor-pointer rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-1.5 text-[11.5px] text-[var(--ls-t3)] outline-none hover:border-[var(--ls-linea2)]'

export function HubCrm({
  initialClients,
  team,
  currentUser,
  workHours,
  payrollRates,
  qualifiedAppointments,
  initialUsdEurRate,
  alcance,
  historialesIniciales,
  notasIniciales,
  contactosIniciales,
  motivosDeDescarte,
  migracionFalta,
  clienteInicial,
}: HubCrmProps) {
  const supabase = createClient()
  // Lo que cuesta el equipo, las notas de Gemini y el desglose del mes son de dirección; dar de alta, de dirección y del autónomo (para sí mismo)
  const puedeVerCosteEquipo = alcance.esDireccion
  const [clients, setClients] = useState<CrmClientWithDetails[]>(initialClients)
  const clienteDeInicio = clienteInicial ? (initialClients.find((c) => c.id === clienteInicial) ?? null) : null
  // Se abre en la pestaña del cliente que se pidió; si no, en la primera que tenga algo
  const [pestana, setPestana] = useState<PestanaDelCrm>(() => {
    if (clienteDeInicio) return pestanaDe(clienteDeInicio.stage)
    const cuentas = contarPorPestana(initialClients)
    return cuentas.cita > 0 ? 'cita' : cuentas.seguimiento > 0 ? 'seguimiento' : cuentas.cerrado > 0 ? 'cerrado' : 'cita'
  })
  const [selectedId, setSelectedId] = useState<string | null>(clienteDeInicio?.id ?? null)
  const [texto, setTexto] = useState('')
  const [responsable, setResponsable] = useState('todos')
  const [filtroCita, setFiltroCita] = useState<FiltroDeCita | 'otras'>('todas')
  const [filtroFase, setFiltroFase] = useState<CrmStage | 'todas'>('todas')
  const [soloVencidas, setSoloVencidas] = useState(false)
  const [ordenSeguimiento, setOrdenSeguimiento] = useState<OrdenDeSeguimiento>('accion')
  const [filtroCerrado, setFiltroCerrado] = useState<FiltroDeCerrado>('ganados')
  const [showNewLead, setShowNewLead] = useState(false)
  const [showBreakdown, setShowBreakdown] = useState(false)
  const [bandeja, setBandeja] = useState(false)
  const [historiales, setHistoriales] = useState(historialesIniciales)
  const [notas, setNotas] = useState(notasIniciales)
  const [contactos, setContactos] = useState(contactosIniciales)
  const [motivos, setMotivos] = useState(motivosDeDescarte)
  // En móvil no caben lista y ficha a la vez: se enseña una u otra
  const isMobile = useIsMobile()

  // «Ahora» se refresca cada minuto: los días en la fase y las acciones vencidas no pueden quedarse en el momento de cargar la página
  const [ahora, setAhora] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  // Coste del equipo comercial: se recalcula solo cuando alguien apunta horas, se cualifica una cita o se cambia una tarifa
  const [hours, setHours] = useState<WorkHourEntry[]>(workHours)
  const [rates, setRates] = useState<PayrollRate[]>(payrollRates)
  const [qualified, setQualified] = useState(qualifiedAppointments)
  const [usdEur, setUsdEur] = useState(initialUsdEurRate)
  const [editingFx, setEditingFx] = useState(false)
  const [fxDraft, setFxDraft] = useState(String(initialUsdEurRate))

  const refrescarNotas = useCallback(async () => {
    if (migracionFalta) return
    const { data, error } = await supabase.from('crm_notas_reunion').select('id, client_id, estado, fecha_reunion, interes:analisis->interes->>nivel').neq('estado', 'ignorada')
    if (error) {
      if (!esTablaInexistente(error)) console.error('No se pudieron releer las notas de reunión:', error)
      return
    }
    setNotas((data ?? []) as unknown as NotaLigera[])
  }, [supabase, migracionFalta])

  // Dos personas pueden estar trabajando el pipeline a la vez: si una mueve un lead, la otra lo ve al momento. Lo del coste del equipo (horas, tarifas, citas cualificadas y el
  // cambio USD/EUR) solo lo escucha dirección, que es la única que lo enseña
  useEffect(() => {
    let canal = supabase
      .channel(`crm_clients_${currentUser.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_clients' }, async (payload) => {
        if (payload.eventType === 'DELETE') {
          const removed = payload.old as { id: string }
          setClients((prev) => prev.filter((c) => c.id !== removed.id))
          return
        }
        const row = payload.new as { id: string }
        const { data } = await supabase.from('crm_clients').select(CLIENT_SELECT).eq('id', row.id).single()
        if (!data) return
        const fresca = data as CrmClientWithDetails
        setClients((prev) => {
          const anterior = prev.find((c) => c.id === fresca.id)
          // Si la fase cambió (aquí o en otro navegador) el disparador de la base anota una fila de historial: se refleja igual en la lista
          if (anterior && anterior.stage !== fresca.stage && !migracionFalta) {
            setHistoriales((h) => ({ ...h, [fresca.id]: [...(h[fresca.id] ?? []), { etapa: fresca.stage, desde: new Date().toISOString(), origen: 'manual' }] }))
          }
          return anterior ? prev.map((c) => (c.id === fresca.id ? fresca : c)) : [fresca, ...prev]
        })
      })
      // Una toma de contacto nueva (de esta pantalla o de otra) actualiza el «último contacto» de la lista
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'crm_interactions' }, (payload) => {
        const fila = payload.new as ContactoLigero
        if (fila?.client_id && fila.kind && fila.occurred_at) setContactos((prev) => (prev.some((x) => x.client_id === fila.client_id && x.kind === fila.kind && x.occurred_at === fila.occurred_at) ? prev : [...prev, { client_id: fila.client_id, kind: fila.kind, occurred_at: fila.occurred_at }]))
      })
    if (alcance.esDireccion) {
      canal = canal
        .on('postgres_changes', { event: '*', schema: 'public', table: 'work_hours' }, (payload) => {
          if (payload.eventType === 'DELETE') {
            const old = payload.old as { id: string }
            setHours((prev) => prev.filter((h) => h.id !== old.id))
            return
          }
          const row = payload.new as WorkHourEntry
          setHours((prev) => (prev.some((h) => h.id === row.id) ? prev.map((h) => (h.id === row.id ? row : h)) : [...prev, row]))
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'payroll_rates' }, (payload) => {
          if (payload.eventType === 'DELETE') {
            const old = payload.old as { id: string }
            setRates((prev) => prev.filter((r) => r.id !== old.id))
            return
          }
          const row = payload.new as PayrollRate
          setRates((prev) => (prev.some((r) => r.id === row.id) ? prev.map((r) => (r.id === row.id ? row : r)) : [...prev, row]))
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, async () => {
          // PAGINADA. PostgREST corta a 1000 filas y NO da error: devuelve menos y se queda tan ancho. Con esta lista se calcula lo que cuesta el equipo comercial, y una
          // cita cualificada que cayera fuera del corte dejaría de contar sin que apareciera ningún aviso.
          try {
            const filas = await fetchAll<CrmQualifiedAppointment>((desde, hasta) =>
              supabase.from('appointments').select('id, comercial_id, start_time').eq('status', 'qualified').eq('is_external', false).order('id', { ascending: true }).range(desde, hasta)
            )
            setQualified(filas)
          } catch (error) {
            console.error('No se pudieron releer las citas cualificadas:', error)
          }
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings' }, (payload) => {
          const row = payload.new as { key: string; value: number }
          if (row?.key === 'usd_eur_rate') setUsdEur(Number(row.value))
        })
    }
    canal.subscribe()
    return () => {
      supabase.removeChannel(canal)
    }
  }, [supabase, currentUser.id, migracionFalta, alcance.esDireccion])

  async function saveFxRate() {
    const parsed = Number(fxDraft.replace(',', '.'))
    if (Number.isNaN(parsed) || parsed <= 0) {
      setFxDraft(String(usdEur))
      setEditingFx(false)
      return
    }
    setUsdEur(parsed)
    setEditingFx(false)
    const { error } = await supabase.from('app_settings').upsert({ key: 'usd_eur_rate', value: parsed }, { onConflict: 'key' })
    if (error) console.error('Error guardando el cambio USD/EUR:', error)
  }

  // ---------- lo que se ve de cada cliente ----------
  const notasPorCliente = useMemo(() => agruparPorCliente(notas), [notas])
  const resumenes = useMemo(() => new Map(clients.map((c) => [c.id, resumenDeFila(c, historiales[c.id], notasPorCliente[c.id], ahora)])), [clients, historiales, notasPorCliente, ahora])
  const cifras = useMemo(() => cifrasDelPipeline(clients, historiales, resumenes), [clients, historiales, resumenes])
  const contactosPorCliente = useMemo(() => resumenDeContactos(contactos), [contactos])
  const duenos = useMemo(() => new Map(team.map((p) => [p.id, p])), [team])

  // La búsqueda y el responsable valen para las tres pestañas: los números de la barra son los de lo que se está buscando
  const base = useMemo(() => filtrarClientes(clients, { ...FILTRO_INICIAL, texto, responsable }, resumenes), [clients, texto, responsable, resumenes])
  const porPestana = useMemo(() => contarPorPestana(base), [base])

  const deCita = useMemo(() => base.filter((c) => pestanaDe(c.stage) === 'cita'), [base])
  const cuentaCitas = useMemo(() => cuentaDeCitas(deCita, ahora), [deCita, ahora])
  const filasDeCita = useMemo(() => ordenarCitas(deCita.filter((c) => coincideConElFiltroDeCita(c, filtroCita, ahora)), ahora), [deCita, filtroCita, ahora])

  const deSeguimiento = useMemo(() => base.filter((c) => pestanaDe(c.stage) === 'seguimiento'), [base])
  const vencidas = useMemo(() => deSeguimiento.filter((c) => resumenes.get(c.id)?.accion?.estado === 'vencida').length, [deSeguimiento, resumenes])
  const filasDeSeguimiento = useMemo(
    () =>
      ordenarSeguimiento(
        deSeguimiento.filter((c) => (filtroFase === 'todas' || c.stage === filtroFase) && (!soloVencidas || resumenes.get(c.id)?.accion?.estado === 'vencida')),
        ordenSeguimiento,
        contactosPorCliente,
        ahora
      ),
    [deSeguimiento, filtroFase, soloVencidas, ordenSeguimiento, contactosPorCliente, resumenes, ahora]
  )

  const deCerrado = useMemo(() => base.filter((c) => pestanaDe(c.stage) === 'cerrado'), [base])
  const cuentaCerrados = useMemo(() => cuentaDeCerrados(deCerrado), [deCerrado])
  const filasDeCerrado = useMemo(() => ordenarCerrados(deCerrado, filtroCerrado), [deCerrado, filtroCerrado])

  const filasVisibles = pestana === 'cita' ? filasDeCita : pestana === 'seguimiento' ? filasDeSeguimiento : filasDeCerrado
  const idsVisibles = useMemo(() => filasVisibles.map((c) => c.id), [filasVisibles])

  const selected = clients.find((c) => c.id === selectedId) ?? null
  const clientesLigeros = useMemo(() => clients.map((c) => ({ id: c.id, nombre: crmContact(c).name?.trim() || 'Sin nombre', empresa: crmContact(c).company?.trim() || null })), [clients])
  const sinCliente = notas.filter((n) => n.estado === 'sin_cita').length

  // En escritorio siempre hay una ficha a la vista: la primera de la lista. Si lo que está abierto sale de la lista (se ha movido de pestaña, se ha filtrado) pasa a la siguiente
  useEffect(() => {
    if (isMobile) return
    if (selectedId && idsVisibles.includes(selectedId)) return
    setSelectedId(idsVisibles[0] ?? null)
  }, [idsVisibles, selectedId, isMobile])

  const stats = useMemo(() => {
    const won = clients.filter((c) => c.stage === 'ganado')
    // Facturación del mes: el set up se cobra una sola vez, el mes que se cierra el cliente; el mantenimiento se cobra todos los meses mientras siga siendo cliente
    const now = toMadrid(new Date())
    const setupsThisMonth = won.reduce((sum, c) => {
      if (!c.closed_at) return sum
      const closed = toMadrid(c.closed_at)
      return closed.getFullYear() === now.getFullYear() && closed.getMonth() === now.getMonth() ? sum + (Number(c.setup_budget) || 0) : sum
    }, 0)
    const mrr = won.reduce((sum, c) => sum + (Number(c.maintenance_budget) || 0), 0)
    return { setupsThisMonth, mrr }
  }, [clients])

  // Lo que cuesta el equipo comercial este mes: horas × precio/hora más citas cualificadas × comisión (el mismo motor que el desglose y que el módulo de empleados)
  const teamCost = useMemo(() => {
    const now = toMadrid(new Date())
    const month = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`
    const c = monthCostTotal({ month, hours, rates, qualified })
    return { salaries: c.salary, commissions: c.commissions, total: c.total }
  }, [hours, rates, qualified])
  const costInEuros = teamCost.total * usdEur
  const profitable = stats.setupsThisMonth + stats.mrr >= costInEuros

  /**
   * UNA FICHA HA CAMBIADO. `origen` dice quién la movió: la FICHA abierta (si cambia de fase, la pantalla la sigue a su pestaña nueva: no se queda mirando una ficha que ya no está
   * en la lista) o un botón de la LISTA (la pantalla pasa a la siguiente de la lista: lo normal cuando se está decidiendo una por una).
   */
  const handlePatched = useCallback(
    (id: string, patch: Partial<CrmClientWithDetails>, origen: 'ficha' | 'lista' = 'ficha') => {
      setClients((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
      if (patch.stage && !migracionFalta) {
        setHistoriales((h) => ({ ...h, [id]: [...(h[id] ?? []), { etapa: patch.stage as CrmStage, desde: new Date().toISOString(), origen: 'manual' }] }))
      }
      if (patch.stage && origen === 'ficha') setPestana(pestanaDe(patch.stage))
    },
    [migracionFalta]
  )

  const alMoverDesdeLaLista = useCallback((id: string, patch: Partial<CrmClientWithDetails>) => handlePatched(id, patch, 'lista'), [handlePatched])
  const alCambiarElMotivo = useCallback((id: string, nota: string | null) => setMotivos((prev) => (nota ? { ...prev, [id]: nota } : Object.fromEntries(Object.entries(prev).filter(([k]) => k !== id)))), [])
  const { mover, cambiarResultadoDeCita, ocupados } = useAccionesDeFase({ currentUserId: currentUser.id, onPatched: alMoverDesdeLaLista, onMotivo: alCambiarElMotivo })

  function elegirPestana(p: PestanaDelCrm) {
    setPestana(p)
    setSoloVencidas(false)
    if (isMobile) setSelectedId(null)
  }

  const chip = (activo: boolean) => `${BOTON.chip} ${activo ? BOTON.chipEncendido : ''}`
  const contador = (n: number) => <span className="tabular-nums text-[var(--ls-t4)]">{n}</span>

  const propsDeFila = (c: CrmClientWithDetails) => ({
    c,
    r: resumenes.get(c.id)!,
    activa: c.id === selectedId,
    onElegir: setSelectedId,
    alcance,
    dueno: c.owner_id ? duenos.get(c.owner_id) : null,
    ocupado: ocupados.has(c.id),
    onAccion: mover,
  })

  const sinNada = (
    <SinFilas icono={pestana === 'cita' ? <CalendarCheck /> : pestana === 'seguimiento' ? <Handshake /> : <Trophy />}>
      {clients.length === 0
        ? alcance.veTodos
          ? 'Todavía no hay leads. En cuanto se agende una cita aparecerá aquí automáticamente.'
          : 'Todavía no llevas ningún cliente. Cuando des de alta uno, o se te asigne uno, aparecerá aquí.'
        : base.length === 0
          ? 'Ningún cliente coincide con la búsqueda.'
          : pestana === 'cita'
            ? 'No hay leads en esta lista. Los que se agenden aparecen aquí solos; los que decidas seguir pasan a «En seguimiento» y los que descartes, a «Cerrado».'
            : pestana === 'seguimiento'
              ? 'No hay leads en seguimiento. Los que decidas seguir desde «Cita agendada» aparecen aquí con su proceso.'
              : filtroCerrado === 'ganados'
                ? 'Todavía no hay clientes cerrados.'
                : 'No hay leads perdidos ni descartados.'}
    </SinFilas>
  )

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* ---------------- Título y acciones ---------------- */}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <h1 className={TITULO.pantalla}>CRM de clientes</h1>
          <p className={`${TITULO.entradilla} hidden sm:block`}>
            {alcance.veTodos ? 'Cada lead en su momento: la cita agendada, el seguimiento y el cierre, con su ficha, lo hablado en la reunión, la propuesta y los documentos.' : 'Tus clientes: lo que has agendado, lo que sigues trabajando y lo que ya has cerrado. Solo ves los tuyos.'}
          </p>
        </div>
        {alcance.puedeVerLoDeDireccion && !migracionFalta && (
          <Boton onClick={() => setBandeja(true)} alto icono={<MailSearch />} titulo="Notas de las reuniones: las que no se han podido enlazar con un cliente y la sincronización con Gmail">
            Notas de reunión
            {sinCliente > 0 && <span className={INSIGNIA.contador}>{sinCliente}</span>}
          </Boton>
        )}
        {puedeVerCosteEquipo && (
          <Boton onClick={() => setShowBreakdown(true)} alto icono={<BarChart3 />}>
            Desglose mes
          </Boton>
        )}
        {/* Dar de alta un cliente: dirección (con cualquier responsable) y el comercial autónomo (solo a su nombre). La RLS de la 261 lo dice igual */}
        {alcance.puedeAlta && (
          <Boton tono="primario" alto onClick={() => setShowNewLead(true)} icono={<Plus />}>
            Nuevo cliente
          </Boton>
        )}
      </div>

      {/* ---------------- La barra de arriba: las tres pestañas ---------------- */}
      <BarraDePestanas
        activa={pestana}
        cuentas={porPestana}
        onElegir={elegirPestana}
        derecha={
          <>
            {alcance.veTodos && (
              <select value={responsable} onChange={(e) => setResponsable(e.target.value)} className={SELECT_SENCILLO} aria-label="Responsable">
                <option value="todos">Todos los responsables</option>
                <option value="sin">Sin asignar</option>
                {team.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name || p.email}
                  </option>
                ))}
              </select>
            )}
            <div className="relative w-[200px] max-w-full shrink">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--ls-t4)]" />
              <input
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                placeholder="Buscar cliente, empresa, email…"
                aria-label="Buscar"
                className="h-[26px] w-full rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] pl-7 pr-2 text-[12.5px] text-[var(--ls-t1)] outline-none placeholder:text-[var(--ls-t4)] hover:border-[var(--ls-linea2)] focus:border-[var(--ls-acc-graf)] focus:shadow-[inset_0_0_0_1px_var(--ls-acc-graf)]"
              />
            </div>
          </>
        }
      />

      {/* ---------------- Cifras del embudo ---------------- */}
      <div className="shrink-0 overflow-x-auto">
        <div className={`${CIFRAS.tira} w-max min-w-full`}>
          <div className={CIFRAS.celda}>
            <span className={CIFRAS.valor}>{cifras.total}</span>
            <span className={CIFRAS.rotulo}>clientes</span>
          </div>
          <div className={CIFRAS.celda}>
            <span className={CIFRAS.valor}>{cifras.abiertos}</span>
            <span className={CIFRAS.rotulo}>abiertos</span>
          </div>
          <div className={CIFRAS.celda}>
            <span className={CIFRAS.valor}>{cifras.ganados}</span>
            <span className={CIFRAS.rotulo}>cerrados{cifras.conversion !== null ? ` · ${Math.round(cifras.conversion * 100)} % de los decididos` : ''}</span>
          </div>
          {cifras.cicloMedio !== null && (
            <div className={CIFRAS.celda} title="Días medios desde el primer contacto hasta el cierre, de los clientes cerrados con fechas exactas">
              <span className={CIFRAS.valor}>{cifras.cicloMedio} d</span>
              <span className={CIFRAS.rotulo}>de media hasta cerrar</span>
            </div>
          )}
          <div className={CIFRAS.celda}>
            <span className={`${CIFRAS.valor} ${cifras.accionesVencidas > 0 ? CIFRAS.urgente : ''}`}>{cifras.accionesVencidas}</span>
            <span className={CIFRAS.rotulo}>{cifras.accionesVencidas === 1 ? 'acción vencida' : 'acciones vencidas'}</span>
          </div>
          {/* Los importes: dirección y los managers los ven; el comercial autónomo no */}
          {alcance.puedeVerImportes && (
            <div className={CIFRAS.celda} title="El set up se cobra el mes que se cierra el cliente; el mantenimiento, todos los meses">
              <span className={CIFRAS.valor}>{euros(stats.setupsThisMonth) ?? '0 €'}</span>
              <span className={CIFRAS.rotulo}>de set up este mes · {euros(stats.mrr) ?? '0 €'}/mes de mantenimiento</span>
            </div>
          )}
          {/* El coste del equipo comercial es sueldo de empleados: SOLO DIRECCIÓN */}
          {puedeVerCosteEquipo && (
            <div className={CIFRAS.celda} title={`Salarios ${dolares(teamCost.salaries)} + comisiones ${dolares(teamCost.commissions)}`}>
              <span className={CIFRAS.valor} style={{ color: profitable ? COLOR_ESTADO.verde : COLOR_ESTADO.rojo }}>
                {dolares(teamCost.total)}
              </span>
              <span className={CIFRAS.rotulo}>coste comerciales</span>
              {editingFx ? (
                <span className="inline-flex items-center gap-1">
                  <input
                    value={fxDraft}
                    onChange={(e) => setFxDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void saveFxRate()
                      if (e.key === 'Escape') {
                        setFxDraft(String(usdEur))
                        setEditingFx(false)
                      }
                    }}
                    autoFocus
                    inputMode="decimal"
                    className="h-5 w-12 rounded-[4px] border border-[var(--ls-acc-graf)] bg-[var(--ls-sup2)] px-1 text-[11px] text-[var(--ls-t1)] outline-none"
                  />
                  <button type="button" onClick={() => void saveFxRate()} className={BOTON.icono}>
                    <Check className="h-3 w-3" />
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setFxDraft(String(usdEur))
                    setEditingFx(true)
                  }}
                  className="group inline-flex items-center gap-1 text-[11px] text-[var(--ls-t4)] hover:text-[var(--ls-t1)]"
                  title="Cambiar el tipo de cambio USD → EUR"
                >
                  ≈ {euros(Math.round(costInEuros))}
                  <Pencil className="h-2.5 w-2.5 opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ---------------- Los filtros de la pestaña ---------------- */}
      <div className="flex shrink-0 items-center gap-[6px] overflow-x-auto pb-px lg:flex-wrap lg:overflow-visible">
        {pestana === 'cita' &&
          FILTROS_DE_CITA.filter((f) => f.id === 'todas' || f.id === filtroCita || cuentaCitas[f.id] > 0).map((f) => (
            <button key={f.id} type="button" onClick={() => setFiltroCita(f.id)} className={chip(filtroCita === f.id)}>
              {f.nombre} {contador(cuentaCitas[f.id])}
            </button>
          ))}
        {pestana === 'seguimiento' && (
          <>
            <button type="button" onClick={() => setFiltroFase('todas')} className={chip(filtroFase === 'todas')}>
              Todos {contador(deSeguimiento.length)}
            </button>
            {FASES_DEL_SEGUIMIENTO.map((f) => (
              <button key={f} type="button" onClick={() => setFiltroFase(filtroFase === f ? 'todas' : f)} className={chip(filtroFase === f)}>
                {ETIQUETA_CORTA[f]} {contador(deSeguimiento.filter((c) => c.stage === f).length)}
              </button>
            ))}
            {vencidas > 0 && (
              <>
                <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-[var(--ls-linea2)]" />
                <button type="button" onClick={() => setSoloVencidas((v) => !v)} className={chip(soloVencidas)}>
                  Acción vencida <span className="tabular-nums text-[var(--ls-acc)]">{vencidas}</span>
                </button>
              </>
            )}
            <span className="flex-1" />
            <select value={ordenSeguimiento} onChange={(e) => setOrdenSeguimiento(e.target.value as OrdenDeSeguimiento)} className={SELECT_SENCILLO} aria-label="Orden">
              {ORDENES_DE_SEGUIMIENTO.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.nombre}
                </option>
              ))}
            </select>
          </>
        )}
        {pestana === 'cerrado' && (
          <>
            <button type="button" onClick={() => setFiltroCerrado('ganados')} className={chip(filtroCerrado === 'ganados')}>
              Ganados {contador(cuentaCerrados.ganados)}
            </button>
            <button type="button" onClick={() => setFiltroCerrado('perdidos')} className={chip(filtroCerrado === 'perdidos')}>
              Perdidos y descartados {contador(cuentaCerrados.perdidos)}
            </button>
          </>
        )}
      </div>

      {/* ---------------- Lista y ficha ---------------- */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 lg:grid-cols-[minmax(340px,460px)_minmax(0,1fr)]">
        <div className={`min-h-0 flex-col overflow-hidden rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] ${isMobile && selectedId ? 'hidden' : 'flex'}`}>
          <div className="shrink-0 border-b border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-1.5">
            <p className="text-[11px] tabular-nums text-[var(--ls-t4)]">
              {filasVisibles.length === 1 ? '1 lead' : `${filasVisibles.length} leads`}
              {pestana === 'cita' && ' · la cita más próxima primero'}
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {filasVisibles.length === 0
              ? sinNada
              : pestana === 'cita'
                ? filasDeCita.map((c) => <FilaDeCita key={c.id} {...propsDeFila(c)} situacion={situacionDeLaCita(c, ahora)} onResultadoDeCita={cambiarResultadoDeCita} />)
                : pestana === 'seguimiento'
                  ? filasDeSeguimiento.map((c) => <FilaDeSeguimiento key={c.id} {...propsDeFila(c)} contactos={contactosPorCliente.get(c.id)} ahora={ahora} />)
                  : filasDeCerrado.map((c) => <FilaDeCerrado key={c.id} {...propsDeFila(c)} ciclo={c.stage === 'ganado' ? cicloDeVenta(historiales[c.id] ?? []) : null} motivo={motivos[c.id]} />)}
          </div>
        </div>

        <div className={`min-h-0 flex-col overflow-hidden rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] ${isMobile && !selectedId ? 'hidden' : 'flex'}`}>
          {isMobile && selectedId && (
            <button type="button" onClick={() => setSelectedId(null)} className="flex shrink-0 items-center gap-1.5 border-b border-[var(--ls-linea)] px-3 py-2 text-[12px] font-medium text-[var(--ls-t3)] hover:text-[var(--ls-t1)]">
              <ChevronLeft className="h-4 w-4" /> Volver a la lista
            </button>
          )}
          {selected ? (
            <div className="min-h-0 flex-1">
              <FichaHub
                key={selected.id}
                client={selected}
                team={team}
                currentUser={currentUser}
                onPatched={(patch) => handlePatched(selected.id, patch, 'ficha')}
                alcance={alcance}
                historialInicial={historiales[selected.id] ?? []}
                migracionFaltaInicial={migracionFalta}
                clientes={clientesLigeros}
                onNotasCambiadas={refrescarNotas}
              />
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <MousePointerClick className="h-6 w-6 text-[var(--ls-t4)]" />
              <p className="text-[13px] text-[var(--ls-t3)]">Selecciona un lead de la lista para ver su ficha completa.</p>
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>{showBreakdown && <MonthBreakdown clients={clients} team={team} hours={hours} rates={rates} qualified={qualified} usdEur={usdEur} onClose={() => setShowBreakdown(false)} />}</AnimatePresence>

      <AnimatePresence>
        {showNewLead && (
          <NewLeadDialog
            team={team}
            // Quien no es dirección solo da de alta clientes a su nombre (la RLS de la 261 lo exige): no se le ofrece elegir responsable
            propietarioFijo={alcance.esDireccion ? undefined : { id: currentUser.id, nombre: currentUser.full_name || currentUser.email || 'Tú' }}
            onClose={() => setShowNewLead(false)}
            onCreated={(created) => {
              setClients((prev) => (prev.some((c) => c.id === created.id) ? prev : [created, ...prev]))
              setSelectedId(created.id)
              setPestana(pestanaDe(created.stage))
              setTexto('')
              setResponsable('todos')
              setFiltroCita('todas')
              setFiltroFase('todas')
            }}
          />
        )}
      </AnimatePresence>

      {alcance.puedeVerLoDeDireccion && <BandejaDeNotas abierta={bandeja} onCerrar={() => setBandeja(false)} clientes={clientesLigeros} onCambio={() => void refrescarNotas()} />}
    </div>
  )
}
