'use client'

import { useMemo, useState, useTransition, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { MotionConfig } from 'framer-motion'
import { toast } from 'sonner'
import { AlertTriangle, ArrowLeft, Bell, BellOff, BellRing, CalendarClock, Check, ChevronDown, ExternalLink, FileText, Printer, RefreshCw, Send, Sparkles, Timer } from 'lucide-react'
import { Boton, CabeceraDeModulo, EstadoVacio, FilaDeKpis, Insignia, Kpi, Pestanas, TACTIL } from '@/components/ui-ls'
import { COLOR_ESTADO, type TonoEstado } from '@/lib/estilo/denso'
import { FAMILIA_DE_TIPO, NOMBRE_DE_FAMILIA, compararAlertas, contarPorSeveridad, type FamiliaAlerta, type Severidad } from '@/lib/fba/alertas'
import { FALTA_LA_MIGRACION_267 } from '@/lib/fba/alertas-mensajes'
import type { AlertaGuardada, ClienteDeAlertas, PanelDeAlertas } from '@/lib/fba/alertas-lectura'
import type { EnvioPropuestoGuardado } from '@/lib/fba/plan-tipos'
import { urlDeEnvioPropuesto } from '@/lib/fba/trabajo-plan'
import { AjustesReposicion } from '../comun/AjustesReposicion'
import { Combo, type OpcionCombo } from '../comun/Combo'
import { compararPrioridad, dinero, fechaCorta, PRIORIDAD } from '../comun/estilo-plan'
import type { SesionRemesas } from '../comun/tipos-ui'
import { cx } from '../comun/ui'
import { useEnviosPropuestos } from '../comun/useEnviosPropuestos'

/**
 * ALERTAS FBA: TODO LO QUE VA MAL EN LA LOGÍSTICA, DE TODOS LOS CLIENTES, EN UNA PANTALLA (vista `alertas`, spec remesas-pro §8).
 *
 *   ALERTAS         lo más grave primero, con el dinero en juego; filtrable por cliente (chips; en el móvil, un Combo), por
 *                   familia y «solo críticas y altas»; las silenciadas aparte. Cada fila se despliega: las cuentas, «Abrir en
 *                   Remesas» (?vista=cliente&seccion=envios&cliente=…), el envío propuesto del plan si la referencia va en
 *                   uno (onAbrirEnvioPropuesto), «Proponer con IA» (…&ia=1), Silenciar 7/30 días y Reabrir.
 *   PLAZOS          los ajustes de reposición de cada cliente con `AjustesReposicion` (compacto) y, debajo, cuándo se
 *                   calcularon sus alertas y «Recalcular».
 *   RESUMEN SEMANAL lo abierto, en una hoja que se imprime o se guarda en PDF desde el navegador.
 *
 * Permisos (§1.4): silenciar, reabrir, recalcular y «Proponer con IA» son de la AGENCIA CON EDICIÓN en ese cliente (antes,
 * solo admin). Sin `sesion` (la ruta vieja) se usa `esAdmin`, como siempre.
 *
 * La pantalla no calcula nada: lee lo que dejó la pasada diaria (o «Recalcular»). Cada acción llama a la API y vuelve a
 * pedir la página (`router.refresh()`).
 */

type Pestana = 'alertas' | 'plazos' | 'resumen'

const TONO: Record<Severidad, TonoEstado> = { critica: 'rojo', alta: 'naranja', media: 'ambar', info: 'gris' }
const ROTULO: Record<Severidad, string> = { critica: 'Crítica', alta: 'Alta', media: 'Media', info: 'Aviso' }
const PLURAL: Record<Severidad, string> = { critica: 'Críticas', alta: 'Altas', media: 'Medias', info: 'Avisos' }
const TODOS = '__todos__'

/** Las alertas que se miran en el inventario del cliente y no en un envío */
const DE_STOCK = new Set<string>(['descuadre', 'stock_parado', 'stock_antiguo', 'no_vendibles', 'perdidas'])

/** «hoy», «ayer», «hace 5 días», «hace 3 semanas» */
function hace(iso: string | null, ahora: number): string {
  if (!iso) return 'nunca'
  const dias = Math.floor((ahora - Date.parse(iso)) / 86_400_000)
  if (dias <= 0) return 'hoy'
  if (dias === 1) return 'ayer'
  if (dias < 14) return `hace ${dias} días`
  if (dias < 60) return `hace ${Math.floor(dias / 7)} semanas`
  return `hace ${Math.floor(dias / 30)} meses`
}

/** El impacto en la moneda de la alerta (las de reposición la traen del plan; las demás, euros) */
const impacto = (a: AlertaGuardada) => dinero(a.impacto, typeof a.datos.moneda === 'string' && a.datos.moneda ? a.datos.moneda : 'EUR')

async function llamar(url: string, metodo: 'POST' | 'PUT', cuerpo: unknown): Promise<boolean> {
  try {
    const r = await fetch(url, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) })
    const datos = (await r.json().catch(() => ({}))) as { error?: string; message?: string }
    if (!r.ok) {
      toast.error(datos.error ?? datos.message ?? 'No se ha podido hacer')
      return false
    }
    return true
  } catch {
    toast.error('No se ha podido conectar con el servidor')
    return false
  }
}

/** Los enlaces de una alerta (explícitos, spec §1.2 y D37) */
export function enlacesDeAlerta(a: Pick<AlertaGuardada, 'clienteId' | 'remesaId' | 'tipo'>): { abrir: string; ia: string } {
  const c = encodeURIComponent(a.clienteId)
  const abrir = a.remesaId
    ? `/dashboard/remesas?vista=cliente&seccion=envios&cliente=${c}&remesa=${encodeURIComponent(a.remesaId)}`
    : `/dashboard/remesas?vista=cliente&seccion=${DE_STOCK.has(a.tipo) ? 'stock' : 'envios'}&cliente=${c}`
  return { abrir, ia: `/dashboard/remesas?vista=cliente&seccion=envios&cliente=${c}&ia=1` }
}

export interface PanelAlertasProps {
  panel: PanelDeAlertas
  /** Compatibilidad con la ruta vieja: sin `sesion`, los permisos salen de aquí */
  esAdmin: boolean
  sesion?: SesionRemesas
  /** Dentro de Remesas (vista `alertas`): sin cabecera propia ni «Volver a Remesas» */
  incrustado?: boolean
  /** Abre el panel del envío propuesto (si no se pasa, se navega a ?vista=plan&envio=) */
  onAbrirEnvioPropuesto?: (id: string) => void
}

export function PanelAlertas({ panel, esAdmin, sesion, incrustado = false, onAbrirEnvioPropuesto }: PanelAlertasProps) {
  const router = useRouter()
  const [, empezar] = useTransition()
  const [pestana, setPestana] = useState<Pestana>('alertas')
  const [cliente, setCliente] = useState<string | null>(null)
  const [familia, setFamilia] = useState<FamiliaAlerta | 'todas'>('todas')
  const [soloGraves, setSoloGraves] = useState(false)
  const [verSilenciadas, setVerSilenciadas] = useState(false)
  const [abiertas, setAbiertas] = useState<ReadonlySet<string>>(new Set())
  const ahora = useMemo(() => Date.now(), [])

  const esAgencia = sesion ? sesion.actor === 'agencia' : true
  /** Agencia con edición en ese cliente (§1.4); sin sesión, solo admin como antes */
  const puedeEditar = (clienteId: string): boolean =>
    sesion ? sesion.actor === 'agencia' && (sesion.editables === null || sesion.editables.includes(clienteId)) : esAdmin

  // Los envíos propuestos activos: una alerta de reposición cuya referencia va en uno enlaza con él
  const propuestos = useEnviosPropuestos(esAgencia ? {} : null)
  const envioDeSku = useMemo(() => {
    const m = new Map<string, EnvioPropuestoGuardado>()
    const lista = [...propuestos.envios].sort((x, y) => compararPrioridad(x.prioridad, y.prioridad) || x.salirAntesDe.localeCompare(y.salirAntesDe))
    for (const e of lista) for (const l of e.lineas) if (!m.has(`${e.clienteId}|${l.sku}`)) m.set(`${e.clienteId}|${l.sku}`, e)
    return m
  }, [propuestos.envios])
  const envioDe = (a: AlertaGuardada): EnvioPropuestoGuardado | { id: string } | null => {
    if (FAMILIA_DE_TIPO[a.tipo] !== 'reposicion') return null
    const delDato = typeof a.datos.envioPropuestoId === 'string' && a.datos.envioPropuestoId ? a.datos.envioPropuestoId : null
    const porSku = a.sku ? (envioDeSku.get(`${a.clienteId}|${a.sku}`) ?? null) : null
    if (porSku) return porSku
    return delDato ? { id: delDato } : null
  }

  const nombreDe = useMemo(() => new Map(panel.clientes.map((c) => [c.id, c.nombre])), [panel.clientes])
  const refrescar = () => empezar(() => router.refresh())

  const visibles = useMemo(
    () =>
      panel.alertas
        .filter((a) => (verSilenciadas ? a.estado === 'silenciada' : a.estado === 'abierta'))
        .filter((a) => cliente === null || a.clienteId === cliente)
        .filter((a) => familia === 'todas' || FAMILIA_DE_TIPO[a.tipo] === familia)
        .filter((a) => !soloGraves || a.severidad === 'critica' || a.severidad === 'alta')
        .sort(compararAlertas),
    [panel.alertas, cliente, familia, soloGraves, verSilenciadas]
  )

  const abiertasTodas = useMemo(() => panel.alertas.filter((a) => a.estado === 'abierta'), [panel.alertas])
  const conteo = contarPorSeveridad(abiertasTodas)
  const silenciadas = panel.alertas.length - abiertasTodas.length
  const sinPlazo = panel.clientes.filter((c) => c.plazoDias === null)
  const porFamilia = useMemo(() => {
    const m = new Map<FamiliaAlerta, number>()
    for (const a of abiertasTodas) m.set(FAMILIA_DE_TIPO[a.tipo], (m.get(FAMILIA_DE_TIPO[a.tipo]) ?? 0) + 1)
    return m
  }, [abiertasTodas])

  const opcionesCliente: OpcionCombo[] = useMemo(
    () => [
      { valor: TODOS, texto: 'Todos los clientes', especial: true },
      ...panel.clientes.map((c) => ({ valor: c.id, texto: c.nombre, detalle: c.abiertas > 0 ? `${c.abiertas} abierta${c.abiertas === 1 ? '' : 's'}` : undefined, atenuada: c.abiertas === 0 })),
    ],
    [panel.clientes]
  )

  const alternar = (id: string) =>
    setAbiertas((prev) => {
      const s = new Set(prev)
      if (s.has(id)) s.delete(id)
      else s.add(id)
      return s
    })

  async function silenciar(a: AlertaGuardada, dias: number) {
    const hasta = new Date(`${panel.hoy}T12:00:00Z`)
    hasta.setUTCDate(hasta.getUTCDate() + dias)
    if (await llamar('/api/fba/alertas', 'POST', { accion: 'silenciar', id: a.id, hasta: hasta.toISOString().slice(0, 10) })) {
      toast.success(`Silenciada ${dias} días`)
      refrescar()
    }
  }
  async function reabrir(a: AlertaGuardada) {
    if (await llamar('/api/fba/alertas', 'POST', { accion: 'reabrir', id: a.id })) {
      toast.success('Alerta reabierta')
      refrescar()
    }
  }

  const pestanas = (
    <Pestanas<Pestana>
      etiqueta="Secciones de alertas"
      acento="remesas"
      opciones={[
        { id: 'alertas', texto: 'Alertas', icono: BellRing, cuenta: abiertasTodas.length },
        { id: 'plazos', texto: 'Plazos de reposición', icono: Timer, cuenta: sinPlazo.length || undefined },
        { id: 'resumen', texto: 'Resumen semanal', icono: FileText },
      ]}
      valor={pestana}
      onCambio={setPestana}
    />
  )

  return (
    <MotionConfig reducedMotion="user">
      <div className="mx-auto flex w-full min-w-0 max-w-[1440px] flex-col gap-4 pb-8 print:max-w-none print:gap-0 print:pb-0">
        {/* ================= CABECERA ================= */}
        {incrustado ? (
          <div className="min-w-0 print:hidden">{pestanas}</div>
        ) : (
          <div className="print:hidden">
            <CabeceraDeModulo
              icono={Bell}
              acento="remesas"
              titulo="Alertas FBA"
              subtitulo="Lo que va mal en la logística de todos los clientes, lo más grave primero"
              migas={[{ texto: 'Remesas a FBA', href: '/dashboard/remesas' }, { texto: 'Alertas' }]}
              acciones={
                <Boton asChild variante="secundario" icono={ArrowLeft}>
                  <Link href="/dashboard/remesas">Volver a Remesas</Link>
                </Boton>
              }
              debajo={pestanas}
            />
          </div>
        )}

        {panel.faltaMigracion && (
          <div className="print:hidden">
            <Aviso tono="ambar">{FALTA_LA_MIGRACION_267}</Aviso>
          </div>
        )}

        {/* ================= ALERTAS ================= */}
        {pestana === 'alertas' && (
          <div className="flex min-w-0 flex-col gap-3">
            <FilaDeKpis minimo={150}>
              {(['critica', 'alta', 'media', 'info'] as const).map((s, i) => (
                <Kpi
                  key={s}
                  indice={i}
                  etiqueta={PLURAL[s]}
                  valor={conteo[s]}
                  acento={COLOR_ESTADO[TONO[s]]}
                  nota={s === 'critica' || s === 'alta' ? (soloGraves ? 'filtrando: solo críticas y altas' : 'pulsa para ver solo las graves') : 'abiertas ahora'}
                  onClick={s === 'critica' || s === 'alta' ? () => setSoloGraves((v) => !v) : undefined}
                />
              ))}
            </FilaDeKpis>

            {sinPlazo.length > 0 && (
              <Aviso tono="ambar">
                {sinPlazo.length === 1 ? `${sinPlazo[0].nombre} no tiene` : `${sinPlazo.length} clientes no tienen`} puesto el plazo de reposición: los avisos de «reponer» se calculan con el plazo de
                partida y no suenan en la campana hasta que se configure.{' '}
                <button type="button" className="font-semibold underline" onClick={() => setPestana('plazos')}>
                  Ponerlo
                </button>
              </Aviso>
            )}

            {/* los filtros */}
            <div className="flex min-w-0 flex-col gap-2">
              {/* cliente: Combo en el móvil, chips desde sm */}
              <div className="flex min-h-[44px] items-center gap-2 rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] px-3 sm:hidden">
                <span className="shrink-0 text-[12px] text-[var(--ls-t4)]">Cliente</span>
                <Combo
                  etiqueta="Cliente"
                  valor={cliente ?? TODOS}
                  opciones={opcionesCliente}
                  onElegir={(v) => setCliente(v === TODOS ? null : v)}
                  placeholder="Buscar cliente"
                  className="min-w-0 flex-1"
                  anchoLista={300}
                />
              </div>
              <div className="hidden flex-wrap items-center gap-[6px] sm:flex">
                <Chip activo={cliente === null} onClick={() => setCliente(null)}>
                  Todos los clientes
                </Chip>
                {panel.clientes.map((c) => (
                  <Chip key={c.id} activo={cliente === c.id} onClick={() => setCliente(cliente === c.id ? null : c.id)}>
                    {c.nombre}
                    {c.abiertas > 0 && <span className="tabular-nums opacity-70">{c.abiertas}</span>}
                  </Chip>
                ))}
              </div>
              {/* familia: en el móvil, una fila que se desliza */}
              <div className="ls-sin-barra -mx-4 flex items-center gap-[6px] overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
                <Chip activo={familia === 'todas'} onClick={() => setFamilia('todas')}>
                  Todo tipo
                </Chip>
                {(Object.keys(NOMBRE_DE_FAMILIA) as FamiliaAlerta[]).map((f) => (
                  <Chip key={f} activo={familia === f} onClick={() => setFamilia(familia === f ? 'todas' : f)}>
                    {NOMBRE_DE_FAMILIA[f]}
                    <span className="tabular-nums opacity-70">{porFamilia.get(f) ?? 0}</span>
                  </Chip>
                ))}
                <span className="mx-1 h-4 w-px shrink-0 bg-[var(--ls-linea2)]" aria-hidden />
                <Chip activo={soloGraves} onClick={() => setSoloGraves((v) => !v)}>
                  Solo críticas y altas
                </Chip>
                {silenciadas > 0 && (
                  <Chip activo={verSilenciadas} onClick={() => setVerSilenciadas((v) => !v)}>
                    <BellOff className="h-3 w-3" aria-hidden />
                    {silenciadas} silenciada{silenciadas === 1 ? '' : 's'}
                  </Chip>
                )}
              </div>
            </div>

            {verSilenciadas && <p className="text-[12px] text-[var(--ls-t3)]">Estás viendo las silenciadas. Vuelven solas al pasar la fecha, o con «Reabrir».</p>}

            {/* la lista */}
            {visibles.length === 0 ? (
              <EstadoVacio
                icono={Check}
                acento="remesas"
                titulo={panel.alertas.length === 0 ? 'Todavía no hay alertas' : 'Nada con estos filtros'}
                descripcion={
                  panel.alertas.length === 0
                    ? 'La pasada de alertas corre una vez al día. Para ver las de un cliente ahora mismo, pulsa «Recalcular» en la pestaña de Plazos.'
                    : 'Cambia los filtros para ver el resto.'
                }
                accion={panel.alertas.length === 0 ? { texto: 'Ir a Plazos', onClick: () => setPestana('plazos') } : undefined}
              />
            ) : (
              <ul className="min-w-0 divide-y divide-[var(--ls-linea)] overflow-hidden rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]">
                {visibles.map((a) => (
                  <FilaAlerta
                    key={a.id}
                    a={a}
                    cliente={nombreDe.get(a.clienteId) ?? '—'}
                    abierta={abiertas.has(a.id)}
                    onAlternar={() => alternar(a.id)}
                    ahora={ahora}
                    hoy={panel.hoy}
                    puedeEditar={puedeEditar(a.clienteId)}
                    envio={envioDe(a)}
                    onAbrirEnvioPropuesto={onAbrirEnvioPropuesto}
                    onSilenciar={(dias) => silenciar(a, dias)}
                    onReabrir={() => reabrir(a)}
                  />
                ))}
              </ul>
            )}
          </div>
        )}

        {/* ================= PLAZOS ================= */}
        {pestana === 'plazos' && (
          <div className="flex min-w-0 flex-col gap-3">
            <p className="max-w-[760px] text-[12.5px] leading-[1.55] text-[var(--ls-t3)]">
              El <b className="text-[var(--ls-t2)]">plazo de reposición</b> son los días desde que se decide un envío hasta que está a la venta en Amazon (preparación, transporte, recepción y
              margen). De él dependen los avisos de «reponer» y las fechas del plan. Si una referencia tarda distinto, se le puede poner su propio plazo.
            </p>
            {panel.clientes.length === 0 && <Aviso tono="gris">No hay ningún cliente con Amazon conectado que puedas ver.</Aviso>}
            {panel.clientes.map((c) => (
              <FilaPlazo key={c.id} c={c} ahora={ahora} puedeEditar={puedeEditar(c.id)} onCambio={refrescar} />
            ))}
          </div>
        )}

        {/* ================= RESUMEN SEMANAL ================= */}
        {pestana === 'resumen' && <ResumenSemanal panel={panel} ahora={ahora} />}
      </div>
    </MotionConfig>
  )
}

/* ------------------------------------------------------------------ */
/* Piezas pequeñas                                                     */
/* ------------------------------------------------------------------ */

function Chip({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={cx(
        'inline-flex h-8 shrink-0 items-center gap-[6px] whitespace-nowrap rounded-full border px-3 text-[12.5px] font-medium transition-colors motion-reduce:transition-none',
        TACTIL,
        activo
          ? 'border-[color-mix(in_srgb,var(--ls-mod-remesas)_55%,transparent)] bg-[color-mix(in_srgb,var(--ls-mod-remesas)_14%,transparent)] text-[var(--ls-t1)]'
          : 'border-[var(--ls-linea)] bg-[var(--ls-sup)] text-[var(--ls-t3)] hover:border-[var(--ls-linea2)] hover:text-[var(--ls-t1)]'
      )}
    >
      {children}
    </button>
  )
}

function Aviso({ tono, children }: { tono: TonoEstado; children: ReactNode }) {
  return (
    <div
      className="flex gap-2 rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-3 py-[8px] text-[12px] leading-[1.5] text-[var(--ls-t2)]"
      style={{ borderLeft: `3px solid ${COLOR_ESTADO[tono]}` }}
    >
      <AlertTriangle className="mt-[2px] h-[14px] w-[14px] shrink-0" style={{ color: COLOR_ESTADO[tono] }} aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/** Los números que acompañan a una alerta de reposición, tal como los vio el cálculo */
function CuentasDeReposicion({ d, hoy }: { d: Record<string, unknown>; hoy: string }) {
  const n = (v: unknown) => (typeof v === 'number' ? v.toLocaleString('es-ES', { maximumFractionDigits: 1 }) : '—')
  const celdas: Array<[string, string]> = [
    ['Vendibles', n(d.vendibles)],
    ['De camino', n(d.entrante)],
    ['Ritmo (ud/día)', n(d.ritmo)],
    ['Plazo de reposición', `${n(d.plazoDias)} d`],
    ['Dura lo que hay', `${n(d.diasHastaRotura)} d`],
    ['Dura con lo que viene', `${n(d.diasConLoQueViene)} d`],
  ]
  if (typeof d.seAgotaEl === 'string') celdas.push(['Se agota el', fechaCorta(d.seAgotaEl, hoy)])
  if (typeof d.salirAntesDe === 'string') celdas.push(['Salir antes del', fechaCorta(d.salirAntesDe, hoy)])
  if (typeof d.cantidadPropuesta === 'number' && d.cantidadPropuesta > 0) celdas.push(['El plan propone', `${n(d.cantidadPropuesta)} ud`])
  if (typeof d.factorEstacional === 'number' && d.factorEstacional > 1) celdas.push(['Efecto estacional', `×${n(d.factorEstacional)}`])
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-[10px] bg-[var(--ls-sup2)] px-3 py-[10px] sm:grid-cols-4">
      {celdas.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="truncate text-[10.5px] uppercase tracking-wide text-[var(--ls-t4)]">{k}</dt>
          <dd className="text-[13px] font-medium tabular-nums text-[var(--ls-t1)]">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Las referencias o los envíos que forman una alerta de cliente entero (parado, antiguo, pérdidas…) */
function ListaDeItems({ items }: { items: Array<Record<string, unknown>> }) {
  return (
    <ul className="space-y-[3px] text-[12px] text-[var(--ls-t2)]">
      {items.slice(0, 10).map((it, i) => (
        <li key={i} className="flex min-w-0 gap-2">
          <span className="min-w-0 flex-1 truncate">{String(it.nombre ?? it.sku ?? '')}</span>
          {typeof it.sku === 'string' && it.nombre ? <span className="hidden shrink-0 text-[var(--ls-t4)] sm:inline">{it.sku}</span> : null}
          {typeof it.unidades === 'number' && <span className="shrink-0 tabular-nums">{it.unidades.toLocaleString('es-ES')} ud</span>}
        </li>
      ))}
    </ul>
  )
}

function FilaAlerta({
  a,
  cliente,
  abierta,
  onAlternar,
  ahora,
  hoy,
  puedeEditar,
  envio,
  onAbrirEnvioPropuesto,
  onSilenciar,
  onReabrir,
}: {
  a: AlertaGuardada
  cliente: string
  abierta: boolean
  onAlternar: () => void
  ahora: number
  hoy: string
  puedeEditar: boolean
  envio: EnvioPropuestoGuardado | { id: string } | null
  onAbrirEnvioPropuesto?: (id: string) => void
  onSilenciar: (dias: number) => Promise<void>
  onReabrir: () => Promise<void>
}) {
  const [ocupado, setOcupado] = useState<null | 'reabrir' | 7 | 30>(null)
  const tono = TONO[a.severidad]
  const color = COLOR_ESTADO[tono]
  const esReposicion = FAMILIA_DE_TIPO[a.tipo] === 'reposicion'
  const items = Array.isArray(a.datos.items) ? (a.datos.items as Array<Record<string, unknown>>) : null
  const enlaces = enlacesDeAlerta(a)
  const conEnvio = envio && 'prioridad' in envio ? envio : null

  const hacer = async (que: 'reabrir' | 7 | 30) => {
    setOcupado(que)
    try {
      if (que === 'reabrir') await onReabrir()
      else await onSilenciar(que)
    } finally {
      setOcupado(null)
    }
  }

  return (
    <li className="relative">
      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: color }} aria-hidden />
      <button type="button" onClick={onAlternar} aria-expanded={abierta} className="flex w-full min-w-0 items-start gap-3 py-[11px] pl-4 pr-3 text-left hover:bg-[var(--ls-sup2)]">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Insignia tono={tono} tamano="sm" variante={a.severidad === 'critica' ? 'solida' : 'suave'}>
              {ROTULO[a.severidad]}
            </Insignia>
            <span className="max-w-full truncate rounded-full border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-2 text-[11px] font-medium leading-[18px] text-[var(--ls-t2)]">{cliente}</span>
            <span className="text-[11px] text-[var(--ls-t4)]">desde {hace(a.primeraVezAt, ahora)}</span>
            {a.estado === 'silenciada' && a.silenciadaHasta && (
              <span className="inline-flex items-center gap-1 text-[11px] text-[var(--ls-t4)]">
                <BellOff className="h-3 w-3" aria-hidden /> hasta el {fechaCorta(a.silenciadaHasta, hoy)}
              </span>
            )}
          </span>
          <span className="mt-[5px] block text-[13.5px] font-medium leading-snug text-[var(--ls-t1)]">{a.titulo}</span>
          {a.impacto >= 1 && (
            <span className="mt-[3px] block text-[11.5px] text-[var(--ls-t3)] sm:hidden">
              <b className="font-semibold tabular-nums text-[var(--ls-t1)]">{impacto(a)}</b> en juego
            </span>
          )}
        </span>
        {a.impacto >= 1 && (
          <span className="hidden shrink-0 text-right sm:block">
            <span className="block text-[13px] font-semibold tabular-nums text-[var(--ls-t1)]">{impacto(a)}</span>
            <span className="block text-[10.5px] text-[var(--ls-t4)]">en juego</span>
          </span>
        )}
        <ChevronDown className={cx('mt-[3px] h-4 w-4 shrink-0 text-[var(--ls-t4)] transition-transform motion-reduce:transition-none', abierta && 'rotate-180')} aria-hidden />
      </button>

      {abierta && (
        <div className="space-y-3 border-t border-[var(--ls-linea)] bg-[var(--ls-fondo)] py-3 pl-4 pr-3">
          <p className="max-w-[820px] text-[12.5px] leading-[1.6] text-[var(--ls-t2)]">{a.detalle}</p>
          {esReposicion && <CuentasDeReposicion d={a.datos} hoy={hoy} />}
          {items && items.length > 0 && <ListaDeItems items={items} />}

          {conEnvio && (
            <p className="min-w-0 text-[12px] leading-[1.7] text-[var(--ls-t3)]">
              <Send className="mr-1.5 inline h-3.5 w-3.5 -translate-y-px text-[var(--ls-mod-remesas)]" aria-hidden />
              Va en un envío propuesto: salir antes del <b className="text-[var(--ls-t1)]">{fechaCorta(conEnvio.salirAntesDe, hoy)}</b> · {conEnvio.unidades.toLocaleString('es-ES')} ud{' '}
              <Insignia tono={PRIORIDAD[conEnvio.prioridad].tono} variante={PRIORIDAD[conEnvio.prioridad].variante} tamano="sm" className="ml-1 align-middle">
                {PRIORIDAD[conEnvio.prioridad].texto}
              </Insignia>
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {envio &&
              (onAbrirEnvioPropuesto ? (
                <Boton variante="primario" tamano="sm" icono={CalendarClock} onClick={() => onAbrirEnvioPropuesto(envio.id)}>
                  Ver envío propuesto
                </Boton>
              ) : (
                <Boton asChild variante="primario" tamano="sm" icono={CalendarClock}>
                  <Link href={urlDeEnvioPropuesto(envio.id, a.clienteId)}>Ver envío propuesto</Link>
                </Boton>
              ))}
            <Boton asChild variante="secundario" tamano="sm" icono={ExternalLink}>
              <Link href={enlaces.abrir}>Abrir en Remesas</Link>
            </Boton>
            {esReposicion && puedeEditar && (
              <Boton asChild variante={envio ? 'secundario' : 'primario'} tamano="sm" icono={Sparkles}>
                <Link href={enlaces.ia} title="Abre la propuesta a medida (IA) de este cliente">
                  Proponer con IA
                </Link>
              </Boton>
            )}
            {puedeEditar &&
              (a.estado === 'silenciada' ? (
                <Boton variante="secundario" tamano="sm" icono={Bell} cargando={ocupado === 'reabrir'} onClick={() => void hacer('reabrir')}>
                  Reabrir
                </Boton>
              ) : (
                <>
                  <Boton variante="fantasma" tamano="sm" icono={BellOff} cargando={ocupado === 7} disabled={ocupado !== null} onClick={() => void hacer(7)} title="Esconde la alerta una semana: si ya está en marcha">
                    Silenciar 7 días
                  </Boton>
                  <Boton variante="fantasma" tamano="sm" cargando={ocupado === 30} disabled={ocupado !== null} onClick={() => void hacer(30)} title="Esconde la alerta un mes">
                    30 días
                  </Boton>
                </>
              ))}
          </div>
        </div>
      )}
    </li>
  )
}

/* ------------------------------------------------------------------ */
/* Plazos                                                              */
/* ------------------------------------------------------------------ */

function FilaPlazo({ c, ahora, puedeEditar, onCambio }: { c: ClienteDeAlertas; ahora: number; puedeEditar: boolean; onCambio: () => void }) {
  const [calculando, setCalculando] = useState(false)

  async function recalcular() {
    setCalculando(true)
    toast.message(`Calculando las alertas de ${c.nombre}… puede tardar un minuto`)
    const bien = await llamar('/api/fba/alertas', 'POST', { accion: 'recalcular', clienteId: c.id })
    setCalculando(false)
    if (bien) {
      toast.success(`Alertas de ${c.nombre} al día`)
      onCambio()
    }
  }

  return (
    <div className="min-w-0 space-y-[6px]">
      <AjustesReposicion clienteId={c.id} clienteNombre={c.nombre} puedeEditar={puedeEditar} compacto alGuardar={onCambio} />
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11.5px] text-[var(--ls-t4)]">
        <span>
          Alertas {c.calculadoAt ? `calculadas ${hace(c.calculadoAt, ahora)}` : 'aún sin calcular'} · {c.abiertas} abierta{c.abiertas === 1 ? '' : 's'}
        </span>
        {c.plazoDias === null && <Insignia tono="ambar" tamano="sm">Plazo sin configurar</Insignia>}
        {c.errorCalculo && (
          <span className="min-w-0 basis-full" style={{ color: COLOR_ESTADO.ambar }}>
            {c.errorCalculo}
          </span>
        )}
        {puedeEditar && (
          <Boton variante="fantasma" tamano="sm" icono={RefreshCw} cargando={calculando} onClick={() => void recalcular()} className="ml-auto" title="Calcula ahora mismo las alertas de este cliente (guarda antes los cambios de arriba)">
            Recalcular
          </Boton>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Resumen semanal                                                     */
/* ------------------------------------------------------------------ */

function ResumenSemanal({ panel, ahora }: { panel: PanelDeAlertas; ahora: number }) {
  const abiertas = panel.alertas.filter((a) => a.estado === 'abierta')
  const total = contarPorSeveridad(abiertas)
  const [y, m, d] = panel.hoy.split('-')
  const porCliente = panel.clientes
    .map((c) => ({ c, lista: abiertas.filter((a) => a.clienteId === c.id).sort(compararAlertas) }))
    .filter((x) => x.lista.length > 0)
    .sort((a, b) => {
      const sa = contarPorSeveridad(a.lista)
      const sb = contarPorSeveridad(b.lista)
      return sb.critica - sa.critica || sb.alta - sa.alta || b.lista.length - a.lista.length
    })

  return (
    <div className="min-w-0">
      <div className="mb-3 flex flex-wrap items-center gap-3 print:hidden">
        <p className="min-w-0 flex-1 text-[12.5px] text-[var(--ls-t3)]">Una hoja con lo abierto ahora. Para guardarla en PDF, imprime y elige «Guardar como PDF».</p>
        <Boton variante="primario" icono={Printer} onClick={() => window.print()}>
          Imprimir / PDF
        </Boton>
      </div>

      <article className="mx-auto max-w-[860px] rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-4 sm:p-6 print:max-w-none print:rounded-none print:border-0 print:bg-white print:p-0 print:text-black">
        <header className="mb-4 border-b border-[var(--ls-linea)] pb-3 print:border-black/20">
          <h2 className="text-[18px] font-semibold text-[var(--ls-t1)] print:text-black">Resumen semanal de logística FBA</h2>
          <p className="text-[12px] text-[var(--ls-t3)] print:text-black/70">
            {d}/{m}/{y} · {total.critica} críticas, {total.alta} altas, {total.media} medias y {total.info} avisos en {porCliente.length} cliente{porCliente.length === 1 ? '' : 's'}
          </p>
        </header>

        {porCliente.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-[var(--ls-t3)] print:text-black/70">No hay nada abierto. Todo en orden.</p>
        ) : (
          porCliente.map(({ c, lista }) => {
            const cuenta = contarPorSeveridad(lista)
            const graves = lista.filter((a) => a.severidad === 'critica' || a.severidad === 'alta')
            const resto = lista.length - graves.length
            return (
              <section key={c.id} className="mb-5 break-inside-avoid">
                <h3 className="flex flex-wrap items-baseline gap-x-2 text-[14px] font-semibold text-[var(--ls-t1)] print:text-black">
                  {c.nombre}
                  <span className="text-[11.5px] font-normal text-[var(--ls-t4)] print:text-black/60">
                    {cuenta.critica} crítica{cuenta.critica === 1 ? '' : 's'} · {cuenta.alta} alta{cuenta.alta === 1 ? '' : 's'} · {cuenta.media + cuenta.info} más
                  </span>
                </h3>
                {c.plazoDias === null && <p className="text-[11.5px] text-[var(--ls-t3)] print:text-black/70">Plazo de reposición sin configurar: se ha calculado con el plazo de partida.</p>}
                <ul className="mt-1 space-y-[3px]">
                  {graves.map((a) => (
                    <li key={a.id} className="flex min-w-0 gap-2 text-[12.5px] leading-snug text-[var(--ls-t2)] print:text-black">
                      <span className="mt-[6px] h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: COLOR_ESTADO[TONO[a.severidad]] }} />
                      <span className="min-w-0 flex-1">{a.titulo}</span>
                      <span className="hidden shrink-0 text-[11px] text-[var(--ls-t4)] sm:inline print:inline print:text-black/60">{hace(a.primeraVezAt, ahora)}</span>
                      {a.impacto >= 1 && <span className="shrink-0 tabular-nums text-[11.5px]">{impacto(a)}</span>}
                    </li>
                  ))}
                </ul>
                {resto > 0 && <p className="mt-1 text-[11.5px] text-[var(--ls-t4)] print:text-black/60">y {resto} más de menor gravedad.</p>}
              </section>
            )
          })
        )}
      </article>
    </div>
  )
}
