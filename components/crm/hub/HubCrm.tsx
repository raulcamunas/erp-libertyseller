'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Check, ChevronLeft, MailSearch, MousePointerClick, Pencil, Plus, Search, BarChart3 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { fetchAll } from '@/lib/supabase/paginacion'
import { BOTON, CIFRAS, COLOR_ESTADO, INSIGNIA, TITULO } from '@/lib/estilo/denso'
import { toMadrid } from '@/lib/timezone'
import { CRM_STAGES, crmContact, type CrmClientWithDetails, type CrmStage } from '@/lib/types/crm'
import type { WorkHourEntry, PayrollRate } from '@/lib/types/payroll'
import { monthCostTotal } from '@/lib/payroll/cost'
import type { CalendarPerson } from '@/lib/types/appointments'
import type { UserProfile } from '@/lib/supabase/get-user-profile'
import { useIsMobile } from '@/lib/use-is-mobile'
import type { EntradaDeFase } from '@/lib/crm/fases'
import { agruparPorCliente, cifrasDelPipeline, ETIQUETA_CORTA, FILTRO_INICIAL, filtrarClientes, ordenarClientes, resumenDeFila, type FiltroDeLista, type NotaLigera, type OrdenDeLista } from '@/lib/crm/lista'
import { esTablaInexistente } from '@/lib/crm/migracion'
import { NewLeadDialog } from '../NewLeadDialog'
import { MonthBreakdown } from '../MonthBreakdown'
import { BandejaDeNotas } from './BandejaDeNotas'
import { FichaHub } from './FichaHub'
import { ListaClientes } from './ListaClientes'
import { Boton } from './piezas'

/**
 * EL CRM DE CLIENTES, EL HUB.
 * ============================
 * Todos los clientes a la izquierda (con su fase, desde cuándo, la próxima acción y el interés que dejó la última reunión) y la ficha entera a la derecha: la línea de fases, las
 * notas de Gemini desglosadas por la IA, la propuesta que se le va a hacer, la actividad, los documentos y los datos. Arriba, las cifras del embudo y los filtros.
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
  /** Solo dirección: lo que cuesta el equipo comercial (sueldos y comisiones). Con false las horas y tarifas llegan vacías desde el servidor */
  puedeVerCosteEquipo: boolean
  /** Solo dirección: cambiar fichas y dar de alta clientes. La RLS de crm_clients lo exige; esto hace que la pantalla diga lo mismo que la base */
  puedeEditarFichas: boolean
  /** El historial de fases de todos los clientes, para los días en la fase de cada fila */
  historialesIniciales: Record<string, EntradaDeFase[]>
  /** Las notas de reunión, en ligero (sin contenido) */
  notasIniciales: NotaLigera[]
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

export function HubCrm({
  initialClients,
  team,
  currentUser,
  workHours,
  payrollRates,
  qualifiedAppointments,
  initialUsdEurRate,
  puedeVerCosteEquipo,
  puedeEditarFichas,
  historialesIniciales,
  notasIniciales,
  migracionFalta,
  clienteInicial,
}: HubCrmProps) {
  const supabase = createClient()
  const [clients, setClients] = useState<CrmClientWithDetails[]>(initialClients)
  const [selectedId, setSelectedId] = useState<string | null>(clienteInicial && initialClients.some((c) => c.id === clienteInicial) ? clienteInicial : (initialClients[0]?.id ?? null))
  const [filtro, setFiltro] = useState<FiltroDeLista>(FILTRO_INICIAL)
  const [orden, setOrden] = useState<OrdenDeLista>('reunion')
  const [showNewLead, setShowNewLead] = useState(false)
  const [showBreakdown, setShowBreakdown] = useState(false)
  const [bandeja, setBandeja] = useState(false)
  const [historiales, setHistoriales] = useState(historialesIniciales)
  const [notas, setNotas] = useState(notasIniciales)
  // En móvil no caben lista y ficha a la vez: se enseña una u otra
  const isMobile = useIsMobile()

  // «Ahora» se refresca cada minuto: los días en la fase y las acciones vencidas no pueden quedarse en el momento de cargar la página
  const [ahora, setAhora] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  // Al entrar desde el móvil se empieza por la lista, no por la ficha del primero: preseleccionar tapaba la lista nada más abrir
  useEffect(() => {
    if (isMobile && !clienteInicial) setSelectedId(null)
  }, [isMobile, clienteInicial])

  // Coste del equipo comercial: se recalcula solo cuando alguien apunta horas, se cualifica una cita o se cambia una tarifa
  const [hours, setHours] = useState<WorkHourEntry[]>(workHours)
  const [rates, setRates] = useState<PayrollRate[]>(payrollRates)
  const [qualified, setQualified] = useState(qualifiedAppointments)
  const [usdEur, setUsdEur] = useState(initialUsdEurRate)
  const [editingFx, setEditingFx] = useState(false)
  const [fxDraft, setFxDraft] = useState(String(initialUsdEurRate))

  const refrescarNotas = useCallback(async () => {
    if (migracionFalta) return
    const { data, error } = await supabase.from('crm_notas_reunion').select('id, client_id, estado, fecha_reunion, interes:analisis->interes->>nivel')
    if (error) {
      if (!esTablaInexistente(error)) console.error('No se pudieron releer las notas de reunión:', error)
      return
    }
    setNotas((data ?? []) as unknown as NotaLigera[])
  }, [supabase, migracionFalta])

  // Los dos admins pueden estar trabajando el pipeline a la vez: si uno cualifica una cita o cambia una fase, el otro lo ve al momento
  useEffect(() => {
    const channel = supabase
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
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, currentUser.id, migracionFalta])

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
  const filtrados = useMemo(() => ordenarClientes(filtrarClientes(clients, filtro, resumenes), orden, resumenes), [clients, filtro, orden, resumenes])
  const cifras = useMemo(() => cifrasDelPipeline(clients, historiales, resumenes), [clients, historiales, resumenes])
  const selected = clients.find((c) => c.id === selectedId) ?? null
  const clientesLigeros = useMemo(() => clients.map((c) => ({ id: c.id, nombre: crmContact(c).name?.trim() || 'Sin nombre', empresa: crmContact(c).company?.trim() || null })), [clients])
  const sinCliente = notas.filter((n) => n.estado === 'sin_cita').length

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

  const handlePatched = useCallback(
    (id: string, patch: Partial<CrmClientWithDetails>) => {
      setClients((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
      if (patch.stage && !migracionFalta) {
        setHistoriales((h) => ({ ...h, [id]: [...(h[id] ?? []), { etapa: patch.stage as CrmStage, desde: new Date().toISOString(), origen: 'manual' }] }))
      }
    },
    [migracionFalta]
  )

  const fases = ['abiertos', ...CRM_STAGES] as const
  const chip = (activo: boolean) => `${BOTON.chip} ${activo ? BOTON.chipEncendido : ''}`

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* ---------------- Título y acciones ---------------- */}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <h1 className={TITULO.pantalla}>CRM de clientes</h1>
          <p className={`${TITULO.entradilla} hidden sm:block`}>Cada cliente en un solo sitio: su fase, lo hablado en la reunión, la propuesta y los documentos.</p>
        </div>
        {puedeEditarFichas && !migracionFalta && (
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
        {/* Dar de alta un cliente es INSERT en crm_clients, y eso se quedó en is_admin_or_partner (080): la 212 solo abrió el SELECT */}
        {puedeEditarFichas && (
          <Boton tono="primario" alto onClick={() => setShowNewLead(true)} icono={<Plus />}>
            Nuevo cliente
          </Boton>
        )}
      </div>

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
          <div className={CIFRAS.celda} title="El set up se cobra el mes que se cierra el cliente; el mantenimiento, todos los meses">
            <span className={CIFRAS.valor}>{euros(stats.setupsThisMonth) ?? '0 €'}</span>
            <span className={CIFRAS.rotulo}>de set up este mes · {euros(stats.mrr) ?? '0 €'}/mes de mantenimiento</span>
          </div>
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

      {/* ---------------- Filtros ---------------- */}
      <div className="flex shrink-0 items-center gap-[6px] overflow-x-auto pb-px lg:flex-wrap lg:overflow-visible">
        <button type="button" onClick={() => setFiltro({ ...filtro, fase: 'todas' })} className={chip(filtro.fase === 'todas')}>
          Todos <span className="tabular-nums text-[var(--ls-t4)]">{cifras.total}</span>
        </button>
        {fases.map((f) => {
          const n = f === 'abiertos' ? cifras.abiertos : cifras.porFase[f]
          return (
            <button key={f} type="button" onClick={() => setFiltro({ ...filtro, fase: filtro.fase === f ? 'todas' : f })} className={chip(filtro.fase === f)}>
              {f === 'abiertos' ? 'Abiertos' : ETIQUETA_CORTA[f]} <span className="tabular-nums text-[var(--ls-t4)]">{n}</span>
            </button>
          )
        })}
        <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-[var(--ls-linea2)]" />
        <select value={filtro.responsable} onChange={(e) => setFiltro({ ...filtro, responsable: e.target.value })} className="h-6 shrink-0 cursor-pointer rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-1.5 text-[11.5px] text-[var(--ls-t3)] outline-none hover:border-[var(--ls-linea2)]" aria-label="Responsable">
          <option value="todos">Todos los responsables</option>
          <option value="sin">Sin asignar</option>
          {team.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name || p.email}
            </option>
          ))}
        </select>
        {cifras.accionesVencidas > 0 && (
          <button type="button" onClick={() => setFiltro({ ...filtro, soloConAccionVencida: !filtro.soloConAccionVencida })} className={chip(filtro.soloConAccionVencida)}>
            Acción vencida <span className="tabular-nums text-[var(--ls-acc)]">{cifras.accionesVencidas}</span>
          </button>
        )}
        <span className="flex-1" />
        <select value={orden} onChange={(e) => setOrden(e.target.value as OrdenDeLista)} className="h-6 shrink-0 cursor-pointer rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-1.5 text-[11.5px] text-[var(--ls-t3)] outline-none hover:border-[var(--ls-linea2)]" aria-label="Orden">
          <option value="reunion">Reunión más reciente</option>
          <option value="accion">Próxima acción</option>
          <option value="nombre">Nombre</option>
        </select>
      </div>

      {/* ---------------- Lista y ficha ---------------- */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 lg:grid-cols-[minmax(300px,360px)_minmax(0,1fr)]">
        <div className={`min-h-0 flex-col overflow-hidden rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] ${isMobile && selectedId ? 'hidden' : 'flex'}`}>
          <div className="shrink-0 border-b border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--ls-t4)]" />
              <input
                value={filtro.texto}
                onChange={(e) => setFiltro({ ...filtro, texto: e.target.value })}
                placeholder="Buscar cliente, empresa, email…"
                className="h-[26px] w-full rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] pl-7 pr-2 text-[12.5px] text-[var(--ls-t1)] outline-none placeholder:text-[var(--ls-t4)] hover:border-[var(--ls-linea2)] focus:border-[var(--ls-acc-graf)] focus:shadow-[inset_0_0_0_1px_var(--ls-acc-graf)]"
              />
            </div>
            <p className="mt-1.5 px-0.5 text-[11px] tabular-nums text-[var(--ls-t4)]">
              {filtrados.length === clients.length ? `${clients.length} clientes` : `${filtrados.length} de ${clients.length} clientes`}
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ListaClientes
              filas={filtrados}
              resumenes={resumenes}
              seleccionado={selectedId}
              onElegir={setSelectedId}
              vacio={clients.length === 0 ? 'Todavía no hay leads. En cuanto se agende una cita aparecerá aquí automáticamente.' : 'Ningún cliente coincide con los filtros.'}
            />
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
                onPatched={(patch) => handlePatched(selected.id, patch)}
                puedeEditar={puedeEditarFichas}
                historialInicial={historiales[selected.id] ?? []}
                migracionFaltaInicial={migracionFalta}
                clientes={clientesLigeros}
                onNotasCambiadas={refrescarNotas}
              />
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <MousePointerClick className="h-6 w-6 text-[var(--ls-t4)]" />
              <p className="text-[13px] text-[var(--ls-t3)]">Selecciona un cliente de la izquierda para ver su ficha completa.</p>
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>{showBreakdown && <MonthBreakdown clients={clients} team={team} hours={hours} rates={rates} qualified={qualified} usdEur={usdEur} onClose={() => setShowBreakdown(false)} />}</AnimatePresence>

      <AnimatePresence>
        {showNewLead && (
          <NewLeadDialog
            team={team}
            onClose={() => setShowNewLead(false)}
            onCreated={(created) => {
              setClients((prev) => (prev.some((c) => c.id === created.id) ? prev : [created, ...prev]))
              setSelectedId(created.id)
              setFiltro(FILTRO_INICIAL)
            }}
          />
        )}
      </AnimatePresence>

      {puedeEditarFichas && <BandejaDeNotas abierta={bandeja} onCerrar={() => setBandeja(false)} clientes={clientesLigeros} onCambio={() => void refrescarNotas()} />}
    </div>
  )
}
