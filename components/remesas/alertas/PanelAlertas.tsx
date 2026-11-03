'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AlertTriangle, BellOff, Check, ChevronDown, ChevronRight, Printer, RefreshCw, Settings2, Sparkles, X } from 'lucide-react'
import { BOTON, CAMPO, COLOR_ESTADO, TIPO, type TonoEstado } from '@/lib/estilo/denso'
import { FAMILIA_DE_TIPO, NOMBRE_DE_FAMILIA, compararAlertas, contarPorSeveridad, type FamiliaAlerta, type Severidad } from '@/lib/fba/alertas'
import { FALTA_LA_MIGRACION_267 } from '@/lib/fba/alertas-mensajes'
import type { AlertaGuardada, ClienteDeAlertas, PanelDeAlertas } from '@/lib/fba/alertas-lectura'
import { cx } from '../comun/ui'

/**
 * ALERTAS FBA: TODO LO QUE VA MAL EN LA LOGÍSTICA, DE TODOS LOS CLIENTES, EN UNA PANTALLA.
 *
 *   ALERTAS         el tablero: lo más grave primero, con el dinero en juego, filtrable por cliente y por tipo. Cada una se abre para ver
 *                   las cuentas, llevar al cliente (o a su propuesta con IA) y silenciarla unos días si ya está en marcha.
 *   PLAZOS          el plazo de reposición de cada cliente, a mano: de él depende cada aviso de «reponer». Con un plazo distinto por
 *                   referencia si hace falta.
 *   RESUMEN SEMANAL lo mismo, en una hoja que se puede imprimir o guardar en PDF desde el navegador.
 *
 * La pantalla no calcula nada: lee lo que dejó la pasada diaria (o el botón «Recalcular»). Cada acción llama a la API y vuelve a pedir la página.
 */

type Pestana = 'alertas' | 'plazos' | 'resumen'

const TONO: Record<Severidad, TonoEstado> = { critica: 'rojo', alta: 'naranja', media: 'ambar', info: 'gris' }
const ROTULO: Record<Severidad, string> = { critica: 'Crítica', alta: 'Alta', media: 'Media', info: 'Aviso' }

const euros = (n: number) => `${Math.round(n).toLocaleString('es-ES')} €`

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

export function PanelAlertas({ panel, esAdmin }: { panel: PanelDeAlertas; esAdmin: boolean }) {
  const router = useRouter()
  const [, empezar] = useTransition()
  const [pestana, setPestana] = useState<Pestana>('alertas')
  const [cliente, setCliente] = useState<string | null>(null)
  const [familia, setFamilia] = useState<FamiliaAlerta | 'todas'>('todas')
  const [soloGraves, setSoloGraves] = useState(false)
  const [verSilenciadas, setVerSilenciadas] = useState(false)
  const [abiertas, setAbiertas] = useState<ReadonlySet<string>>(new Set())
  const ahora = useMemo(() => Date.now(), [])

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

  const abiertasTodas = panel.alertas.filter((a) => a.estado === 'abierta')
  const conteo = contarPorSeveridad(abiertasTodas)
  const silenciadas = panel.alertas.length - abiertasTodas.length
  const sinPlazo = panel.clientes.filter((c) => c.plazoDias === null)
  const porFamilia = useMemo(() => {
    const m = new Map<FamiliaAlerta, number>()
    for (const a of abiertasTodas) m.set(FAMILIA_DE_TIPO[a.tipo], (m.get(FAMILIA_DE_TIPO[a.tipo]) ?? 0) + 1)
    return m
  }, [abiertasTodas])

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
    if (await llamar('/api/fba/alertas', 'POST', { accion: 'reabrir', id: a.id })) refrescar()
  }

  return (
    <div className="fba-cockpit flex min-h-[calc(100vh-4rem)] flex-col print:min-h-0">
      {/* ================= CABECERA ================= */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 px-5 pb-2 pt-[10px] print:hidden">
        <h1 className={cx(TIPO.xl, 'text-[var(--ls-t1)]')}>Alertas FBA</h1>
        <nav aria-label="Vistas" className="flex items-center gap-[2px] rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-[3px]">
          {(
            [
              ['alertas', 'Alertas', abiertasTodas.length],
              ['plazos', 'Plazos de reposición', sinPlazo.length],
              ['resumen', 'Resumen semanal', null],
            ] as const
          ).map(([id, rotulo, n]) => (
            <button
              key={id}
              type="button"
              onClick={() => setPestana(id)}
              aria-current={pestana === id}
              className={cx(
                'inline-flex h-6 items-center gap-[6px] rounded-[6px] px-[10px] text-[12px] font-medium',
                pestana === id ? 'bg-[var(--ls-sup)] text-[var(--ls-t1)] shadow-sm' : 'text-[var(--ls-t3)] hover:text-[var(--ls-t1)]'
              )}
            >
              {rotulo}
              {n !== null && n > 0 && <span className="tabular-nums text-[var(--ls-t4)]">{n}</span>}
            </button>
          ))}
        </nav>
        <Link href="/dashboard/remesas" className={cx(BOTON.base, BOTON.alto, BOTON.secundario, 'ml-auto')}>
          Volver a Remesas
        </Link>
      </header>

      {panel.faltaMigracion && (
        <div className="px-5 pb-2 print:hidden">
          <Aviso tono="ambar">{FALTA_LA_MIGRACION_267}</Aviso>
        </div>
      )}

      {/* ================= ALERTAS ================= */}
      {pestana === 'alertas' && (
        <div className="flex min-h-0 flex-1 flex-col gap-3 px-5 pb-6">
          {/* las cifras */}
          <div className="flex flex-wrap gap-2">
            {(['critica', 'alta', 'media', 'info'] as const).map((s) => (
              <Cifra key={s} sev={s} n={conteo[s]} />
            ))}
            {silenciadas > 0 && (
              <button type="button" onClick={() => setVerSilenciadas((v) => !v)} className={cx(BOTON.chip, verSilenciadas && '!border-[var(--ls-acc-borde)] !text-[var(--ls-t1)]')}>
                <BellOff className="h-3 w-3" />
                {silenciadas} silenciada{silenciadas === 1 ? '' : 's'}
              </button>
            )}
          </div>

          {sinPlazo.length > 0 && (
            <Aviso tono="ambar">
              {sinPlazo.length === 1 ? `${sinPlazo[0].nombre} no tiene` : `${sinPlazo.length} clientes no tienen`} puesto el plazo de reposición: los avisos de «reponer» se calculan con 45 días y no suenan en la campana hasta que se
              configure.{' '}
              <button type="button" className="underline" onClick={() => setPestana('plazos')}>
                Ponerlo
              </button>
            </Aviso>
          )}

          {/* los filtros */}
          <div className="flex flex-wrap items-center gap-[6px]">
            <Chip activo={cliente === null} onClick={() => setCliente(null)}>
              Todos los clientes
            </Chip>
            {panel.clientes.map((c) => (
              <Chip key={c.id} activo={cliente === c.id} onClick={() => setCliente(cliente === c.id ? null : c.id)}>
                {c.nombre}
                {c.abiertas > 0 && <span className="tabular-nums text-[var(--ls-t4)]">{c.abiertas}</span>}
              </Chip>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-[6px]">
            <Chip activo={familia === 'todas'} onClick={() => setFamilia('todas')}>
              Todo tipo
            </Chip>
            {(Object.keys(NOMBRE_DE_FAMILIA) as FamiliaAlerta[]).map((f) => (
              <Chip key={f} activo={familia === f} onClick={() => setFamilia(familia === f ? 'todas' : f)}>
                {NOMBRE_DE_FAMILIA[f]}
                <span className="tabular-nums text-[var(--ls-t4)]">{porFamilia.get(f) ?? 0}</span>
              </Chip>
            ))}
            <span className="mx-1 h-4 w-px bg-[var(--ls-linea2)]" />
            <Chip activo={soloGraves} onClick={() => setSoloGraves((v) => !v)}>
              Solo críticas y altas
            </Chip>
          </div>

          {/* la lista */}
          {visibles.length === 0 ? (
            <div className="rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-6 py-12 text-center">
              <Check className="mx-auto mb-2 h-6 w-6" style={{ color: COLOR_ESTADO.verde }} />
              <p className={cx(TIPO.l, 'text-[var(--ls-t2)]')}>{panel.alertas.length === 0 ? 'Todavía no hay alertas' : 'Nada con estos filtros'}</p>
              <p className="mx-auto mt-1 max-w-[460px] text-[12px] leading-[1.55] text-[var(--ls-t3)]">
                {panel.alertas.length === 0
                  ? 'La pasada de alertas corre una vez al día. Para ver las de un cliente ahora mismo, pulsa «Recalcular» en la pestaña de Plazos.'
                  : 'Cambia los filtros para ver el resto.'}
              </p>
            </div>
          ) : (
            <ul className="overflow-hidden rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] divide-y divide-[var(--ls-linea)]">
              {visibles.map((a) => (
                <FilaAlerta
                  key={a.id}
                  a={a}
                  cliente={nombreDe.get(a.clienteId) ?? '—'}
                  abierta={abiertas.has(a.id)}
                  onAlternar={() => alternar(a.id)}
                  ahora={ahora}
                  esAdmin={esAdmin}
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
        <div className="flex flex-col gap-3 px-5 pb-6">
          <p className={cx(TIPO.s, 'max-w-[760px] text-[var(--ls-t3)]')}>
            El <b className="text-[var(--ls-t2)]">plazo de reposición</b> son los días desde que se pide la mercancía hasta que está a la venta en Amazon (producción, transporte y recepción). Lo pone el
            equipo, cliente a cliente: de él depende cada aviso de «reponer ya» o «reponer pronto». Si una referencia tarda distinto, se le puede poner su propio plazo.
          </p>
          {panel.clientes.length === 0 && <Aviso tono="gris">No hay ningún cliente con Amazon conectado que puedas ver.</Aviso>}
          {panel.clientes.map((c) => (
            <FilaPlazo key={c.id} c={c} ahora={ahora} puedeEditar={esAdmin} onCambio={refrescar} />
          ))}
        </div>
      )}

      {/* ================= RESUMEN SEMANAL ================= */}
      {pestana === 'resumen' && <ResumenSemanal panel={panel} ahora={ahora} />}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Piezas pequeñas                                                     */
/* ------------------------------------------------------------------ */

function Cifra({ sev, n }: { sev: Severidad; n: number }) {
  return (
    <span className="inline-flex items-baseline gap-[6px] rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-[10px] py-[5px]">
      <span className="h-[8px] w-[8px] self-center rounded-full" style={{ background: COLOR_ESTADO[TONO[sev]] }} />
      <span className="text-[15px] font-semibold tabular-nums text-[var(--ls-t1)]">{n}</span>
      <span className="text-[11.5px] text-[var(--ls-t3)]">{ROTULO[sev].toLowerCase()}{n === 1 ? '' : 's'}</span>
    </span>
  )
}

function Chip({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={activo} className={cx(BOTON.chip, activo && '!border-[var(--ls-acc-borde)] !bg-[var(--ls-sup3)] !text-[var(--ls-t1)]')}>
      {children}
    </button>
  )
}

function Aviso({ tono, children }: { tono: TonoEstado; children: React.ReactNode }) {
  return (
    <div className="flex gap-[7px] rounded-[6px] border border-[var(--ls-linea2)] border-l-2 bg-[var(--ls-sup2)] px-[9px] py-[7px] text-[11.5px] leading-[1.5] text-[var(--ls-t2)]" style={{ borderLeftColor: COLOR_ESTADO[tono] }}>
      <AlertTriangle className="mt-[2px] h-[13px] w-[13px] shrink-0" style={{ color: COLOR_ESTADO[tono] }} />
      <span>{children}</span>
    </div>
  )
}

/** Los números que acompañan a una alerta de reposición, tal como los vio el cálculo */
function CuentasDeReposicion({ d }: { d: Record<string, unknown> }) {
  const n = (v: unknown) => (typeof v === 'number' ? v.toLocaleString('es-ES', { maximumFractionDigits: 1 }) : '—')
  const celdas: Array<[string, string]> = [
    ['Vendibles', n(d.vendibles)],
    ['De camino', n(d.entrante)],
    ['Ritmo (ud/día)', n(d.ritmo)],
    ['Plazo de reposición', `${n(d.plazoDias)} d`],
    ['Dura lo que hay', `${n(d.diasHastaRotura)} d`],
    ['Dura con lo que viene', `${n(d.diasConLoQueViene)} d`],
  ]
  if (typeof d.seAgotaEl === 'string') celdas.push(['Se agota el', d.seAgotaEl.split('-').reverse().join('/')])
  if (typeof d.factorEstacional === 'number' && d.factorEstacional > 1) celdas.push(['Efecto estacional', `×${n(d.factorEstacional)}`])
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
      {celdas.map(([k, v]) => (
        <div key={k}>
          <dt className="text-[10.5px] uppercase tracking-wide text-[var(--ls-t4)]">{k}</dt>
          <dd className="text-[12.5px] tabular-nums text-[var(--ls-t1)]">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Las referencias o los envíos que forman una alerta de cliente entero (parado, antiguo, pérdidas…) */
function ListaDeItems({ items }: { items: Array<Record<string, unknown>> }) {
  return (
    <ul className="space-y-[2px] text-[12px] text-[var(--ls-t2)]">
      {items.slice(0, 10).map((it, i) => (
        <li key={i} className="flex gap-2">
          <span className="min-w-0 flex-1 truncate">{String(it.nombre ?? it.sku ?? '')}</span>
          {typeof it.sku === 'string' && it.nombre ? <span className="shrink-0 text-[var(--ls-t4)]">{it.sku}</span> : null}
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
  esAdmin,
  onSilenciar,
  onReabrir,
}: {
  a: AlertaGuardada
  cliente: string
  abierta: boolean
  onAlternar: () => void
  ahora: number
  esAdmin: boolean
  onSilenciar: (dias: number) => void
  onReabrir: () => void
}) {
  const color = COLOR_ESTADO[TONO[a.severidad]]
  const esReposicion = FAMILIA_DE_TIPO[a.tipo] === 'reposicion'
  const items = Array.isArray(a.datos.items) ? (a.datos.items as Array<Record<string, unknown>>) : null
  const base = `/dashboard/remesas?cliente=${a.clienteId}`
  const destino =
    a.remesaId ? `${base}&remesa=${a.remesaId}` : a.tipo === 'descuadre' || a.tipo === 'stock_parado' || a.tipo === 'stock_antiguo' || a.tipo === 'no_vendibles' || a.tipo === 'perdidas' ? `${base}&vista=inventario` : base

  return (
    <li>
      <button type="button" onClick={onAlternar} aria-expanded={abierta} className="flex w-full items-start gap-3 px-3 py-[9px] text-left hover:bg-[var(--ls-sup2)]">
        <span className="mt-[5px] h-[9px] w-[9px] shrink-0 rounded-full" style={{ background: color }} title={ROTULO[a.severidad]} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-[2px]">
            <span className="rounded-[4px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-[5px] text-[10.5px] font-medium text-[var(--ls-t2)]">{cliente}</span>
            <span className="text-[10.5px] uppercase tracking-wide" style={{ color }}>
              {ROTULO[a.severidad]}
            </span>
            <span className="text-[10.5px] text-[var(--ls-t4)]">desde {hace(a.primeraVezAt, ahora)}</span>
            {a.estado === 'silenciada' && a.silenciadaHasta && <span className="text-[10.5px] text-[var(--ls-t4)]">silenciada hasta el {a.silenciadaHasta.split('-').reverse().join('/')}</span>}
          </span>
          <span className="mt-[2px] block text-[13px] font-medium leading-snug text-[var(--ls-t1)]">{a.titulo}</span>
        </span>
        {a.impacto >= 1 && (
          <span className="shrink-0 text-right">
            <span className="block text-[12.5px] font-semibold tabular-nums text-[var(--ls-t1)]">{euros(a.impacto)}</span>
            <span className="block text-[10.5px] text-[var(--ls-t4)]">en juego</span>
          </span>
        )}
        <span className="mt-[2px] shrink-0 text-[var(--ls-t4)]">{abierta ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</span>
      </button>

      {abierta && (
        <div className="space-y-3 border-t border-[var(--ls-linea)] bg-[var(--ls-fondo)] px-4 py-3">
          <p className="max-w-[820px] text-[12.5px] leading-[1.6] text-[var(--ls-t2)]">{a.detalle}</p>
          {esReposicion && <CuentasDeReposicion d={a.datos} />}
          {items && items.length > 0 && <ListaDeItems items={items} />}
          <div className="flex flex-wrap items-center gap-2">
            <Link href={destino} className={cx(BOTON.base, BOTON.secundario)}>
              Abrir en Remesas
            </Link>
            {esReposicion && esAdmin && (
              <Link href={`${base}&ia=1`} className={cx(BOTON.base, BOTON.primario)} title="Abre la propuesta con IA de este cliente">
                <Sparkles className="h-3 w-3" />
                Proponer con IA
              </Link>
            )}
            {esAdmin &&
              (a.estado === 'silenciada' ? (
                <button type="button" onClick={onReabrir} className={cx(BOTON.base, BOTON.secundario)}>
                  Reabrir
                </button>
              ) : (
                <>
                  <button type="button" onClick={() => onSilenciar(7)} className={cx(BOTON.base, BOTON.secundario)} title="Esconde la alerta una semana: si ya está en marcha">
                    <BellOff className="h-3 w-3" />
                    Silenciar 7 días
                  </button>
                  <button type="button" onClick={() => onSilenciar(30)} className={cx(BOTON.base, BOTON.secundario)}>
                    30 días
                  </button>
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
  const [plazo, setPlazo] = useState(c.plazoDias === null ? '' : String(c.plazoDias))
  const [antelacion, setAntelacion] = useState(String(c.antelacionDias))
  const [avisar, setAvisar] = useState(c.avisar)
  const [porSku, setPorSku] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(c.plazosSku).map(([k, v]) => [k, String(v)])))
  const [nuevoSku, setNuevoSku] = useState('')
  const [nuevoPlazo, setNuevoPlazo] = useState('')
  const [abierto, setAbierto] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [calculando, setCalculando] = useState(false)

  const cambiado =
    plazo !== (c.plazoDias === null ? '' : String(c.plazoDias)) ||
    antelacion !== String(c.antelacionDias) ||
    avisar !== c.avisar ||
    JSON.stringify(porSku) !== JSON.stringify(Object.fromEntries(Object.entries(c.plazosSku).map(([k, v]) => [k, String(v)])))

  async function guardar() {
    const dias = Number(plazo.replace(',', '.'))
    if (!Number.isFinite(dias) || dias < 1 || dias > 365) {
      toast.error('El plazo tiene que ser un número de días, entre 1 y 365')
      return
    }
    setGuardando(true)
    // Los que estaban y ya no están se mandan como null para que se quiten
    const plazosSku: Record<string, number | null> = {}
    for (const k of Object.keys(c.plazosSku)) plazosSku[k] = null
    for (const [k, v] of Object.entries(porSku)) plazosSku[k] = Number(v.replace(',', '.'))
    const bien = await llamar('/api/fba/alertas/config', 'PUT', { clienteId: c.id, plazoDias: dias, antelacionDias: Number(antelacion.replace(',', '.')), avisar, plazosSku })
    setGuardando(false)
    if (bien) {
      toast.success(`Plazo de ${c.nombre} guardado. Recalcula para ver las alertas con él.`)
      onCambio()
    }
  }

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

  function anadirSku() {
    const sku = nuevoSku.trim()
    const dias = Number(nuevoPlazo.replace(',', '.'))
    if (sku === '' || !Number.isFinite(dias) || dias < 1 || dias > 365) {
      toast.error('Hace falta la referencia (SKU) y un plazo entre 1 y 365 días')
      return
    }
    setPorSku((p) => ({ ...p, [sku]: String(Math.round(dias)) }))
    setNuevoSku('')
    setNuevoPlazo('')
  }

  return (
    <section className="rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2 px-3 py-[10px]">
        <div className="min-w-[160px] flex-1">
          <h3 className={cx(TIPO.l, 'text-[var(--ls-t1)]')}>{c.nombre}</h3>
          <p className="text-[11px] text-[var(--ls-t4)]">
            {c.calculadoAt ? `Calculado ${hace(c.calculadoAt, ahora)}` : 'Aún no calculado'} · {c.abiertas} abierta{c.abiertas === 1 ? '' : 's'}
            {c.plazoDias === null && <span className="ml-2" style={{ color: COLOR_ESTADO.ambar }}>Plazo sin configurar</span>}
          </p>
          {c.errorCalculo && (
            <p className="mt-[2px] text-[11px]" style={{ color: COLOR_ESTADO.ambar }}>
              {c.errorCalculo}
            </p>
          )}
        </div>
        <label className={CAMPO.contenedor}>
          <span className={CAMPO.etiqueta}>Plazo (días)</span>
          <input type="number" min={1} max={365} value={plazo} onChange={(e) => setPlazo(e.target.value)} disabled={!puedeEditar} className={cx(CAMPO.input, CAMPO.numero, '!w-[88px]')} placeholder="45" />
        </label>
        <label className={CAMPO.contenedor} title="Con cuántos días de más por encima del plazo se avisa de «reponer pronto»">
          <span className={CAMPO.etiqueta}>Antelación (días)</span>
          <input type="number" min={0} max={120} value={antelacion} onChange={(e) => setAntelacion(e.target.value)} disabled={!puedeEditar} className={cx(CAMPO.input, CAMPO.numero, '!w-[88px]')} />
        </label>
        <label className="flex h-[26px] items-center gap-[6px] text-[12px] text-[var(--ls-t2)]">
          <input type="checkbox" checked={avisar} onChange={(e) => setAvisar(e.target.checked)} disabled={!puedeEditar} />
          Avisar en la campana
        </label>
        {puedeEditar && (
          <div className="flex items-center gap-2">
            <button type="button" onClick={guardar} disabled={guardando || !cambiado} className={cx(BOTON.base, BOTON.alto, BOTON.primario)}>
              {guardando ? 'Guardando…' : 'Guardar'}
            </button>
            <button type="button" onClick={recalcular} disabled={calculando || cambiado} className={cx(BOTON.base, BOTON.alto, BOTON.secundario)} title={cambiado ? 'Guarda antes los cambios' : 'Calcula ahora mismo las alertas de este cliente'}>
              <RefreshCw className={cx('h-3 w-3', calculando && 'animate-spin')} />
              Recalcular
            </button>
            <button type="button" onClick={() => setAbierto((v) => !v)} className={cx(BOTON.base, BOTON.alto, BOTON.secundario)} aria-expanded={abierto}>
              <Settings2 className="h-3 w-3" />
              Por referencia{Object.keys(porSku).length > 0 ? ` (${Object.keys(porSku).length})` : ''}
            </button>
          </div>
        )}
      </div>

      {abierto && (
        <div className="space-y-2 border-t border-[var(--ls-linea)] px-3 py-3">
          <p className="text-[11.5px] text-[var(--ls-t3)]">Plazo propio de una referencia (sustituye al del cliente). Útil para lo que se fabrica en otro sitio o viaja por otra vía.</p>
          {Object.entries(porSku).map(([sku, dias]) => (
            <div key={sku} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--ls-t1)]">{sku}</span>
              <input type="number" min={1} max={365} value={dias} onChange={(e) => setPorSku((p) => ({ ...p, [sku]: e.target.value }))} className={cx(CAMPO.input, CAMPO.numero, '!w-[80px]')} />
              <span className="text-[11.5px] text-[var(--ls-t4)]">días</span>
              <button
                type="button"
                className={BOTON.icono}
                title="Quitar: vuelve al plazo del cliente"
                onClick={() =>
                  setPorSku((p) => {
                    const { [sku]: _quitado, ...resto } = p
                    return resto
                  })
                }
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          <div className="flex items-end gap-2">
            <label className={cx(CAMPO.contenedor, 'flex-1')}>
              <span className={CAMPO.etiqueta}>Referencia (SKU)</span>
              <input value={nuevoSku} onChange={(e) => setNuevoSku(e.target.value)} className={CAMPO.input} placeholder="Tal como sale en Amazon" />
            </label>
            <label className={CAMPO.contenedor}>
              <span className={CAMPO.etiqueta}>Días</span>
              <input type="number" min={1} max={365} value={nuevoPlazo} onChange={(e) => setNuevoPlazo(e.target.value)} className={cx(CAMPO.input, CAMPO.numero, '!w-[80px]')} />
            </label>
            <button type="button" onClick={anadirSku} className={cx(BOTON.base, BOTON.alto, BOTON.secundario)}>
              Añadir
            </button>
          </div>
          <p className="text-[11px] text-[var(--ls-t4)]">Se guardan al pulsar «Guardar» arriba.</p>
        </div>
      )}
    </section>
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
    <div className="px-5 pb-8">
      <div className="mb-3 flex items-center gap-3 print:hidden">
        <p className={cx(TIPO.s, 'text-[var(--ls-t3)]')}>Una hoja con lo abierto ahora. Para guardarla en PDF, imprime y elige «Guardar como PDF».</p>
        <button type="button" onClick={() => window.print()} className={cx(BOTON.base, BOTON.alto, BOTON.primario, 'ml-auto')}>
          <Printer className="h-3 w-3" />
          Imprimir / PDF
        </button>
      </div>

      <article className="mx-auto max-w-[860px] rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-6 print:max-w-none print:border-0 print:bg-white print:p-0 print:text-black">
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
                <h3 className="flex items-baseline gap-2 text-[14px] font-semibold text-[var(--ls-t1)] print:text-black">
                  {c.nombre}
                  <span className="text-[11.5px] font-normal text-[var(--ls-t4)] print:text-black/60">
                    {cuenta.critica} crítica{cuenta.critica === 1 ? '' : 's'} · {cuenta.alta} alta{cuenta.alta === 1 ? '' : 's'} · {cuenta.media + cuenta.info} más
                  </span>
                </h3>
                {c.plazoDias === null && <p className="text-[11.5px] text-[var(--ls-t3)] print:text-black/70">Plazo de reposición sin configurar: se ha calculado con 45 días.</p>}
                <ul className="mt-1 space-y-[3px]">
                  {graves.map((a) => (
                    <li key={a.id} className="flex gap-2 text-[12.5px] leading-snug text-[var(--ls-t2)] print:text-black">
                      <span className="mt-[6px] h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: COLOR_ESTADO[TONO[a.severidad]] }} />
                      <span className="min-w-0 flex-1">{a.titulo}</span>
                      <span className="shrink-0 text-[11px] text-[var(--ls-t4)] print:text-black/60">{hace(a.primeraVezAt, ahora)}</span>
                      {a.impacto >= 1 && <span className="shrink-0 tabular-nums text-[11.5px]">{euros(a.impacto)}</span>}
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
