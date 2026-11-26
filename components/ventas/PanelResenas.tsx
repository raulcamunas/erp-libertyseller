'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowLeft, CalendarClock, Check, Inbox, Loader2, MailCheck, Pause, Pencil, Play, Plus, RefreshCw, Send, Star, Trash2, Undo2, X } from 'lucide-react'
import { CifraAnimada, PanelLateral } from '@/components/ui-ls'
import { ESTADOS, type Campana, type EstadoEnvio } from '@/lib/ventas/resenas'
import type { CuentaDelPanel } from '@/lib/ventas/panel-servidor'
import type { DetalleResenas, PedidoConResena, ResumenResenasCuenta } from '@/lib/ventas/resenas-servidor'
import { ACENTOS, Marco, TARJETA } from './TableroVentas'
import { Emoji } from './ResumenDeCuentas'
import { SelectorDeCuenta } from './SelectorDeCuenta'
import { bandera, entero, euros, pais } from './piezas'

/**
 * RESEÑAS (Sellerboard propio). Sin cuenta: todas las cuentas con las reseñas pedidas hoy, en 7 y en 30 días y lo que hay en cola. Con cuenta: sus
 * campañas (como las de Sellerboard), la cola por días y por estado, y cada pedido. La reseña la pide el cron con la API oficial de Amazon.
 */

async function pedir<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: 'no-store', ...init })
  const j = (await r.json().catch(() => null)) as (T & { error?: string }) | null
  if (!r.ok) throw new Error(j?.error ?? `Error ${r.status}`)
  return j as T
}
const enviar = (cuerpo: Record<string, unknown>) => pedir<{ ok: boolean; id?: string }>('/api/ventas/resenas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) })

const VERDE = '#34D399'
const AZUL = '#60A5FA'
const fechaHora = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }) : '—')
const fecha = (iso: string) => new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', timeZone: 'Europe/Madrid' })

export function PanelResenas({ cuentaInicial = null }: { cuentaInicial?: string | null }) {
  const [cuentas, setCuentas] = useState<CuentaDelPanel[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    pedir<{ cuentas: CuentaDelPanel[] }>('/api/ventas?que=cuentas')
      .then((x) => setCuentas(x.cuentas))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])
  return cuentaInicial ? <DeUnaCuenta cuentas={cuentas} cuentaId={cuentaInicial} error={error} /> : <TodasLasCuentas cuentas={cuentas} error={error} />
}

/* ------------------------------------------------------------------ */
/* Todas las cuentas                                                   */
/* ------------------------------------------------------------------ */

function TodasLasCuentas({ cuentas, error: errorCuentas }: { cuentas: CuentaDelPanel[] | null; error: string | null }) {
  const [resumen, setResumen] = useState<ResumenResenasCuenta[] | null>(null)
  const [sinTabla, setSinTabla] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const cargar = useCallback(() => {
    setCargando(true)
    pedir<{ sinTabla?: boolean; cuentas: ResumenResenasCuenta[] }>('/api/ventas/resenas')
      .then((x) => (setResumen(x.cuentas), setSinTabla(Boolean(x.sinTabla))))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setCargando(false))
  }, [])
  useEffect(() => {
    cargar()
    const t = setInterval(() => document.visibilityState === 'visible' && cargar(), 120_000)
    return () => clearInterval(t)
  }, [cargar])

  const por = useMemo(() => new Map((resumen ?? []).map((r) => [r.cuenta, r])), [resumen])
  const lista = useMemo(() => [...(cuentas ?? [])].sort((a, b) => (por.get(b.id)?.dias30 ?? -1) - (por.get(a.id)?.dias30 ?? -1) || (a.cliente ?? a.nombre).localeCompare(b.cliente ?? b.nombre, 'es')), [cuentas, por])
  const total = useMemo(() => (resumen ?? []).reduce((s, r) => ({ hoy: s.hoy + r.hoy, dias7: s.dias7 + r.dias7, dias30: s.dias30 + r.dias30, enCola: s.enCola + r.enCola, activas: s.activas + (r.activas ? 1 : 0) }), { hoy: 0, dias7: 0, dias30: 0, enCola: 0, activas: 0 }), [resumen])

  return (
    <Marco
      titulo="Reseñas"
      subtitulo="Las solicitudes de reseña de Amazon de cada cliente, en automático. Pulsa una cuenta para ver y configurar sus campañas."
      icono={Star}
      acciones={
        <button type="button" onClick={cargar} className="inline-flex h-11 w-11 items-center justify-center rounded-[13px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] text-[var(--ls-t2)] hover:text-[var(--ls-t1)]" title="Volver a leer" aria-label="Volver a leer">
          {cargando ? <Loader2 className="h-[14px] w-[14px] animate-spin" /> : <RefreshCw className="h-[14px] w-[14px]" />}
        </button>
      }
    >
      {(error || errorCuentas) && <p className="mb-4 rounded-[12px] border border-[color-mix(in_srgb,#F87171_40%,transparent)] px-4 py-3 text-[12.5px] text-[#F87171]">{error ?? errorCuentas}</p>}
      {sinTabla && <p className="mb-4 rounded-[12px] border border-[color-mix(in_srgb,#F5B942_40%,transparent)] px-4 py-3 text-[12.5px] text-[#F5B942]">Falta lanzar la migración 347 (las tablas de reseñas).</p>}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi icono={Send} texto="Pedidas hoy" valor={total.hoy} color={VERDE} />
        <Kpi icono={MailCheck} texto="Últimos 7 días" valor={total.dias7} color="#A78BFA" />
        <Kpi icono={Star} texto="Últimos 30 días" valor={total.dias30} color="#F5B942" />
        <Kpi icono={Inbox} texto="En cola" valor={total.enCola} color={AZUL} />
        <Kpi icono={Play} texto="Cuentas en marcha" valor={total.activas} color="#FF7A1A" />
      </div>

      {!cuentas || !resumen ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((k) => (
            <div key={k} className={`${TARJETA} h-[190px] animate-pulse`} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {lista.map((c, i) => {
            const r = por.get(c.id)
            const [a] = ACENTOS[i % ACENTOS.length]
            return (
              <motion.div key={c.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: Math.min(i, 12) * 0.04 }}>
                <Link href={`/dashboard/ventas/resenas?cuenta=${c.id}`} className={`${TARJETA} group relative block overflow-hidden p-5 transition-transform duration-200 hover:-translate-y-[2px]`}>
                  <div aria-hidden className="pointer-events-none absolute -right-10 -top-16 h-[160px] w-[240px] rounded-full opacity-[0.12] blur-[60px] transition-opacity group-hover:opacity-[0.22]" style={{ background: a }} />
                  <div className="flex items-center gap-3">
                    <Emoji c={c} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-semibold text-[var(--ls-t1)]">{c.cliente ?? c.nombre}</div>
                      <div className="text-[11.5px]">
                        {r?.activas ? (
                          <span className="inline-flex items-center gap-1 text-[#34D399]">
                            <span className="h-[6px] w-[6px] animate-pulse rounded-full bg-[#34D399]" />
                            {r.activas === 1 ? '1 campaña activa' : `${r.activas} campañas activas`}
                          </span>
                        ) : (
                          <span className="text-[var(--ls-t4)]">{r?.campanas ? 'Campañas en pausa' : 'Sin campañas'}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-4 divide-x divide-[color-mix(in_srgb,var(--ls-t1)_7%,transparent)] rounded-[13px] border border-[color-mix(in_srgb,var(--ls-t1)_6%,transparent)] bg-[color-mix(in_srgb,var(--ls-sup2)_72%,transparent)] py-[10px]">
                    <Num texto="Hoy" valor={r?.hoy ?? 0} color={VERDE} />
                    <Num texto="7 días" valor={r?.dias7 ?? 0} />
                    <Num texto="30 días" valor={r?.dias30 ?? 0} />
                    <Num texto="En cola" valor={r?.enCola ?? 0} color={AZUL} />
                  </div>
                </Link>
              </motion.div>
            )
          })}
        </div>
      )}
    </Marco>
  )
}

function Kpi({ icono: Icono, texto, valor, color }: { icono: typeof Star; texto: string; valor: number; color: string }) {
  return (
    <div className={`${TARJETA} relative overflow-hidden p-4`}>
      <div aria-hidden className="pointer-events-none absolute -right-8 -top-10 h-[110px] w-[150px] rounded-full opacity-[0.16] blur-[40px]" style={{ background: color }} />
      <div className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--ls-t4)]">
        <span className="flex h-6 w-6 items-center justify-center rounded-[8px]" style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }}>
          <Icono className="h-[13px] w-[13px]" />
        </span>
        {texto}
      </div>
      <CifraAnimada valor={valor} className="mt-2 block text-[28px] font-semibold leading-none tracking-[-0.03em] tabular-nums text-[var(--ls-t1)]" />
    </div>
  )
}

function Num({ texto, valor, color }: { texto: string; valor: number; color?: string }) {
  return (
    <div className="min-w-0 px-[10px]">
      <div className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-[var(--ls-t4)]">{texto}</div>
      <div className="text-[18px] font-semibold tabular-nums" style={{ color: color ?? 'var(--ls-t1)' }}>
        {entero(valor)}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Una cuenta                                                          */
/* ------------------------------------------------------------------ */

type Clase = EstadoEnvio | 'sin_solicitud' | 'cancelado'
type Filtro = Clase | 'todos'

/** Cómo va la reseña de un pedido: la de la cola si ha entrado, y si no, por qué no */
const CLASES: Record<Clase, { texto: string; color: string }> = { ...ESTADOS, sin_solicitud: { texto: 'Sin solicitud', color: '#A1A1AA' }, cancelado: { texto: 'Cancelado', color: '#52525B' } }
function claseDe(p: PedidoConResena): Clase {
  if (p.envio) return p.envio.estado
  if (p.reembolsado) return 'reembolsado'
  if (p.cancelado) return 'cancelado'
  return 'sin_solicitud'
}
function motivoSinSolicitud(p: PedidoConResena, campanas: DetalleResenas['campanas']): string {
  const activas = campanas.filter((c) => c.activa)
  if (!activas.length) return 'No hay ninguna campaña activa'
  const dia = new Date(p.compraAt).toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' })
  if (p.fbm && activas.every((c) => c.excluir_fbm)) return 'Pedido FBM (excluido)'
  if (p.promo && activas.every((c) => c.excluir_promo)) return 'Con promoción (excluido)'
  if (activas.every((c) => dia < c.desde)) return 'Anterior a «Activa desde» de la campaña'
  if (Date.now() - Date.parse(p.compraAt) > 32 * 86_400_000) return 'Fuera del plazo de Amazon (30 días tras la entrega)'
  return 'Entra en la cola en la próxima pasada (10 min)'
}

function DeUnaCuenta({ cuentas, cuentaId, error: errorCuentas }: { cuentas: CuentaDelPanel[] | null; cuentaId: string; error: string | null }) {
  const router = useRouter()
  const [d, setD] = useState<DetalleResenas | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [ver, setVer] = useState(80)
  const [editando, setEditando] = useState<Partial<Campana> | null>(null)
  const cuenta = cuentas?.find((c) => c.id === cuentaId) ?? null

  const cargar = useCallback(() => {
    setCargando(true)
    pedir<DetalleResenas>(`/api/ventas/resenas?cuenta=${cuentaId}`)
      .then((x) => (setD(x), setError(null)))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setCargando(false))
  }, [cuentaId])
  useEffect(() => {
    setD(null)
    cargar()
    const t = setInterval(() => document.visibilityState === 'visible' && cargar(), 60_000)
    return () => clearInterval(t)
  }, [cargar])

  const hoyMs = Date.now()
  const kpis = useMemo(() => {
    const k = { hoy: 0, dias7: 0, dias30: 0, enCola: 0, proxima: null as string | null }
    if (!d) return k
    const inicioHoy = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' }) + 'T00:00:00').getTime()
    for (const e of d.envios) {
      if (e.estado === 'enviada' && e.enviadaAt) {
        const t = Date.parse(e.enviadaAt)
        if (t >= hoyMs - 30 * 86_400_000) k.dias30++
        if (t >= inicioHoy - 6 * 86_400_000) k.dias7++
        if (t >= inicioHoy) k.hoy++
      }
      if (e.estado === 'en_cola') {
        k.enCola++
        if (!k.proxima || e.programadoAt < k.proxima) k.proxima = e.programadoAt
      }
    }
    return k
  }, [d, hoyMs])
  // Todos los pedidos (los más recientes arriba), con cuántos hay de cada clase para los filtros
  const cuantos = useMemo(() => {
    const c: Partial<Record<Clase, number>> = {}
    for (const p of d?.pedidos ?? []) c[claseDe(p)] = (c[claseDe(p)] ?? 0) + 1
    return c
  }, [d])
  const lista = useMemo(() => (d?.pedidos ?? []).filter((p) => filtro === 'todos' || claseDe(p) === filtro).sort((a, b) => b.compraAt.localeCompare(a.compraAt)), [d, filtro])

  const accion = async (cuerpo: Record<string, unknown>) => {
    try {
      await enviar({ cuenta: cuentaId, ...cuerpo })
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Marco
      titulo="Reseñas"
      subtitulo={cuenta ? `Las solicitudes de reseña de ${cuenta.cliente ?? cuenta.nombre}: campañas, cola y cada pedido` : 'Las solicitudes de reseña de la cuenta'}
      icono={Star}
      acciones={
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/dashboard/ventas/resenas" className="inline-flex h-11 items-center gap-2 rounded-[13px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 text-[12.5px] font-medium text-[var(--ls-t2)] transition-colors hover:text-[var(--ls-t1)]">
            <ArrowLeft className="h-[14px] w-[14px]" />
            Todas las cuentas
          </Link>
          {cuentas && <SelectorDeCuenta cuentas={cuentas} valor={cuentaId} onCambio={(id) => router.replace(`/dashboard/ventas/resenas?cuenta=${id}`, { scroll: false })} />}
          <button type="button" onClick={cargar} className="inline-flex h-11 w-11 items-center justify-center rounded-[13px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] text-[var(--ls-t2)] hover:text-[var(--ls-t1)]" title="Volver a leer" aria-label="Volver a leer">
            {cargando ? <Loader2 className="h-[14px] w-[14px] animate-spin" /> : <RefreshCw className="h-[14px] w-[14px]" />}
          </button>
        </div>
      }
    >
      {(error || errorCuentas) && <p className="mb-4 rounded-[12px] border border-[color-mix(in_srgb,#F87171_40%,transparent)] px-4 py-3 text-[12.5px] text-[#F87171]">{error ?? errorCuentas}</p>}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi icono={Send} texto="Pedidas hoy" valor={kpis.hoy} color={VERDE} />
        <Kpi icono={MailCheck} texto="Últimos 7 días" valor={kpis.dias7} color="#A78BFA" />
        <Kpi icono={Star} texto="Últimos 30 días" valor={kpis.dias30} color="#F5B942" />
        <Kpi icono={Inbox} texto="En cola" valor={kpis.enCola} color={AZUL} />
        <div className={`${TARJETA} relative overflow-hidden p-4`}>
          <div className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--ls-t4)]">
            <span className="flex h-6 w-6 items-center justify-center rounded-[8px] bg-[color-mix(in_srgb,#FF7A1A_16%,transparent)] text-[#FF7A1A]">
              <CalendarClock className="h-[13px] w-[13px]" />
            </span>
            Próxima tanda
          </div>
          <div className="mt-2 text-[18px] font-semibold tabular-nums text-[var(--ls-t1)]">{kpis.proxima ? fechaHora(kpis.proxima) : '—'}</div>
        </div>
      </div>

      {/* La cola por días: lo pedido (verde) y lo que está programado (azul) */}
      <div className={`${TARJETA} mb-5 p-5`}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[14px] font-semibold text-[var(--ls-t1)]">La cola, día a día</div>
            <div className="text-[12px] text-[var(--ls-t4)]">Las 3 últimas semanas (pedidas) y las 2 próximas (programadas)</div>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[11.5px] text-[var(--ls-t3)]">
            <Leyenda color={VERDE} texto="Pedidas" />
            <Leyenda color={AZUL} texto="Programadas" />
            <Leyenda color="#71717A" texto="Sin pedir (Amazon no la ofrecía)" />
          </div>
        </div>
        <div className="h-[200px]">
          {d ? <GraficaCola porDia={d.porDia} /> : <div className="h-full animate-pulse rounded-[12px] bg-[var(--ls-sup2)]" />}
        </div>
        {d && (
          <div className="mt-4 flex flex-wrap gap-2">
            {(Object.keys(ESTADOS) as EstadoEnvio[]).map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setFiltro((f) => (f === e ? 'todos' : e))}
                className="inline-flex items-center gap-2 rounded-full border px-3 py-[5px] text-[12px] transition-colors"
                style={{ borderColor: filtro === e ? ESTADOS[e].color : 'var(--ls-linea)', background: filtro === e ? `color-mix(in srgb, ${ESTADOS[e].color} 14%, transparent)` : 'transparent', color: 'var(--ls-t2)' }}
              >
                <span className="h-[7px] w-[7px] rounded-full" style={{ background: ESTADOS[e].color }} />
                {ESTADOS[e].texto}
                <span className="font-semibold tabular-nums text-[var(--ls-t1)]">{entero(d.porEstado[e] ?? 0)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Las campañas */}
      <div className={`${TARJETA} mb-5 overflow-hidden`}>
        <div className="flex items-center justify-between gap-3 border-b border-[var(--ls-linea)] px-5 py-4">
          <div>
            <div className="text-[14px] font-semibold text-[var(--ls-t1)]">Campañas</div>
            <div className="text-[12px] text-[var(--ls-t4)]">Si un pedido encaja en varias, se la lleva la de prioridad más alta (1 = la primera)</div>
          </div>
          <button type="button" onClick={() => setEditando({ nombre: 'Reseñas', activa: false, dias_tras_entrega: 5, hora: 20, excluir_fbm: true, excluir_promo: false, productos_modo: 'todos', skus: [], mercados: null, prioridad: (d?.campanas.length ?? 0) + 1 })} className="inline-flex h-10 items-center gap-2 rounded-[12px] px-4 text-[12.5px] font-semibold text-[#141414]" style={{ background: 'linear-gradient(135deg,#F26212,#FF8A3D)' }}>
            <Plus className="h-[14px] w-[14px]" />
            Nueva campaña
          </button>
        </div>
        {d && d.campanas.length === 0 && <p className="px-5 py-8 text-center text-[13px] text-[var(--ls-t4)]">Esta cuenta aún no tiene campañas. Crea una y enciéndela: desde ese momento cada pedido nuevo entra en la cola.</p>}
        {d && d.campanas.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-[13px]">
              <thead className="border-b border-[var(--ls-linea)] text-[11px] uppercase tracking-wide text-[var(--ls-t4)]">
                <tr>
                  <th className="px-5 py-[10px] text-left font-semibold">Prioridad</th>
                  <th className="px-3 py-[10px] text-left font-semibold">Nombre</th>
                  <th className="px-3 py-[10px] text-left font-semibold">Productos</th>
                  <th className="px-3 py-[10px] text-left font-semibold">Cuándo</th>
                  <th className="px-3 py-[10px] text-left font-semibold">Estado</th>
                  <th className="px-3 py-[10px] text-right font-semibold">En cola</th>
                  <th className="px-3 py-[10px] text-right font-semibold">Pedidas (30 días)</th>
                  <th className="px-5 py-[10px] text-right font-semibold">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {d.campanas.map((c) => (
                  <tr key={c.id} className="border-b border-[var(--ls-linea)] last:border-0">
                    <td className="px-5 py-3 tabular-nums text-[var(--ls-t3)]">{c.prioridad}</td>
                    <td className="px-3 font-medium text-[var(--ls-t1)]">{c.nombre}</td>
                    <td className="px-3 text-[var(--ls-t2)]">{c.productos_modo === 'todos' ? 'Todos los productos' : c.productos_modo === 'solo' ? `Solo ${c.skus.length} productos` : `Todos menos ${c.skus.length}`}</td>
                    <td className="px-3 text-[var(--ls-t2)]">
                      {c.dias_tras_entrega} días tras la entrega, a las {String(c.hora).padStart(2, '0')}:00
                    </td>
                    <td className="px-3">
                      <button type="button" onClick={() => accion({ accion: 'campana', campana: { ...c, activa: !c.activa } })} className="inline-flex items-center gap-1 rounded-full px-[10px] py-[3px] text-[11.5px] font-semibold" style={{ background: c.activa ? 'color-mix(in srgb,#34D399 16%,transparent)' : 'var(--ls-sup2)', color: c.activa ? '#34D399' : 'var(--ls-t3)' }} title={c.activa ? 'Pausar' : 'Encender'}>
                        {c.activa ? <Play className="h-[11px] w-[11px]" /> : <Pause className="h-[11px] w-[11px]" />}
                        {c.activa ? 'Activa' : 'En pausa'}
                      </button>
                    </td>
                    <td className="px-3 text-right tabular-nums text-[var(--ls-t2)]">{entero(c.enCola)}</td>
                    <td className="px-3 text-right font-semibold tabular-nums text-[var(--ls-t1)]">{entero(c.enviadas30)}</td>
                    <td className="px-5 text-right">
                      <div className="inline-flex gap-1">
                        <button type="button" onClick={() => setEditando(c)} className="rounded-[8px] p-2 text-[var(--ls-t3)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]" title="Editar" aria-label="Editar">
                          <Pencil className="h-[14px] w-[14px]" />
                        </button>
                        <button type="button" onClick={() => window.confirm(`¿Borrar la campaña «${c.nombre}»? Lo que tenga en cola se descarta; lo ya pedido se queda.`) && accion({ accion: 'borrar', id: c.id })} className="rounded-[8px] p-2 text-[var(--ls-t3)] hover:bg-[var(--ls-sup2)] hover:text-[#F87171]" title="Borrar" aria-label="Borrar">
                          <Trash2 className="h-[14px] w-[14px]" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Los pedidos */}
      <div className={`${TARJETA} overflow-hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ls-linea)] px-5 py-4">
          <div>
            <div className="text-[14px] font-semibold text-[var(--ls-t1)]">Pedidos</div>
            <div className="text-[12px] text-[var(--ls-t4)]">Todos los de los últimos 40 días y si ya se les ha pedido la reseña · {entero(lista.length)}</div>
          </div>
          <div className="flex flex-wrap gap-[6px]">
            <FiltroChip activo={filtro === 'todos'} onClick={() => setFiltro('todos')} texto="Todos" n={d?.pedidos.length ?? 0} color="#F26212" />
            {(['enviada', 'en_cola', 'sin_solicitud', 'no_disponible', 'reembolsado', 'caducada', 'error', 'descartada', 'cancelado'] as Clase[])
              .filter((k) => cuantos[k])
              .map((k) => (
                <FiltroChip key={k} activo={filtro === k} onClick={() => setFiltro(filtro === k ? 'todos' : k)} texto={CLASES[k].texto} n={cuantos[k] ?? 0} color={CLASES[k].color} />
              ))}
          </div>
        </div>
        {d && lista.length === 0 && <p className="px-5 py-8 text-center text-[13px] text-[var(--ls-t4)]">Nada por aquí.</p>}
        {lista.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-[12.5px]">
              <thead className="border-b border-[var(--ls-linea)] text-[11px] uppercase tracking-wide text-[var(--ls-t4)]">
                <tr>
                  <th className="px-5 py-[9px] text-left font-semibold">Pedido</th>
                  <th className="px-3 py-[9px] text-left font-semibold">Compra</th>
                  <th className="px-3 py-[9px] text-left font-semibold">Reseña</th>
                  <th className="px-3 py-[9px] text-left font-semibold">Fecha</th>
                  <th className="px-3 py-[9px] text-right font-semibold">Importe</th>
                  <th className="px-3 py-[9px] text-left font-semibold">Campaña</th>
                  <th className="px-5 py-[9px] text-right font-semibold" />
                </tr>
              </thead>
              <tbody>
                {lista.slice(0, ver).map((p) => (
                  <FilaPedido key={p.pedido} p={p} motivo={claseDe(p) === 'sin_solicitud' ? motivoSinSolicitud(p, d?.campanas ?? []) : null} onAccion={(a) => accion({ accion: a, pedido: p.pedido })} />
                ))}
              </tbody>
            </table>
            {lista.length > ver && (
              <button type="button" onClick={() => setVer((v) => v + 120)} className="w-full border-t border-[var(--ls-linea)] py-3 text-[12.5px] font-medium text-[var(--ls-t3)] hover:text-[var(--ls-t1)]">
                Ver más ({entero(lista.length - ver)})
              </button>
            )}
          </div>
        )}
      </div>

      <EditarCampana campana={editando} mercados={cuenta?.mercados ?? []} onCerrar={() => setEditando(null)} onGuardar={async (c) => (await accion({ accion: 'campana', campana: c }), setEditando(null))} />
    </Marco>
  )
}

function Leyenda({ color, texto }: { color: string; texto: string }) {
  return (
    <span className="inline-flex items-center gap-[6px]">
      <span className="h-[9px] w-[9px] rounded-[3px]" style={{ background: color }} />
      {texto}
    </span>
  )
}

function GraficaCola({ porDia }: { porDia: DetalleResenas['porDia'] }) {
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' })
  const datos = porDia.map((p) => ({ ...p, etiqueta: new Date(`${p.dia}T12:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' }) }))
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={datos} margin={{ top: 6, right: 4, left: -18, bottom: 0 }} barCategoryGap="22%">
        <XAxis dataKey="etiqueta" tick={{ fill: 'var(--ls-t4)', fontSize: 10.5 }} axisLine={false} tickLine={false} interval={3} />
        <YAxis allowDecimals={false} tick={{ fill: 'var(--ls-t4)', fontSize: 10.5 }} axisLine={false} tickLine={false} width={40} />
        <Tooltip
          cursor={{ fill: 'color-mix(in srgb, var(--ls-t1) 5%, transparent)' }}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <div className="rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 py-2 text-[12px] shadow-lg">
                <div className="mb-1 font-semibold text-[var(--ls-t1)]">{label}</div>
                {payload.map((p) => (
                  <div key={String(p.dataKey)} className="flex items-center justify-between gap-4 text-[var(--ls-t2)]">
                    <span>{p.dataKey === 'enviadas' ? 'Pedidas' : p.dataKey === 'programadas' ? 'Programadas' : 'Sin pedir'}</span>
                    <span className="font-semibold tabular-nums">{entero(Number(p.value))}</span>
                  </div>
                ))}
              </div>
            ) : null
          }
        />
        <ReferenceLine x={datos.find((x) => x.dia === hoy)?.etiqueta} stroke="var(--ls-t4)" strokeDasharray="3 3" label={{ value: 'hoy', fill: 'var(--ls-t3)', fontSize: 10.5, position: 'top' }} />
        <Bar dataKey="enviadas" stackId="a" fill={VERDE} radius={[0, 0, 0, 0]} />
        <Bar dataKey="otras" stackId="a" fill="#71717A" />
        <Bar dataKey="programadas" stackId="a" radius={[5, 5, 0, 0]}>
          {datos.map((x) => (
            <Cell key={x.dia} fill={AZUL} fillOpacity={x.dia === hoy ? 1 : 0.75} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

function FiltroChip({ activo, onClick, texto, n, color }: { activo: boolean; onClick: () => void; texto: string; n: number; color: string }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-[6px] rounded-full border px-[10px] py-[4px] text-[11.5px] transition-colors" style={{ borderColor: activo ? color : 'var(--ls-linea)', background: activo ? `color-mix(in srgb, ${color} 14%, transparent)` : 'transparent', color: 'var(--ls-t2)' }}>
      <span className="h-[6px] w-[6px] rounded-full" style={{ background: color }} />
      {texto}
      <span className="font-semibold tabular-nums text-[var(--ls-t1)]">{entero(n)}</span>
    </button>
  )
}

function FilaPedido({ p, motivo, onAccion }: { p: PedidoConResena; motivo: string | null; onAccion: (a: 'descartar' | 'recuperar') => void }) {
  const clase = claseDe(p)
  const est = CLASES[clase]
  const e = p.envio
  return (
    <tr className="border-b border-[var(--ls-linea)] last:border-0 hover:bg-[color-mix(in_srgb,var(--ls-sup2)_60%,transparent)]">
      <td className="px-5 py-[7px]">
        <div className="flex items-center gap-2">
          <span title={pais(p.mkt)}>{bandera(p.mkt)}</span>
          <span className="tabular-nums text-[var(--ls-t1)]">{p.pedido}</span>
          {p.fbm && <span className="rounded-[5px] bg-[var(--ls-sup2)] px-[5px] text-[10px] font-semibold text-[var(--ls-t3)]">FBM</span>}
        </div>
        <div className="max-w-[300px] truncate text-[11px] text-[var(--ls-t4)]">
          {p.unidades} ud. · {p.skus.join(' · ')}
        </div>
      </td>
      <td className="px-3 tabular-nums text-[var(--ls-t3)]">{fecha(p.compraAt)}</td>
      <td className="px-3">
        <span className="inline-flex items-center gap-[6px] rounded-full px-[9px] py-[2px] text-[11.5px] font-medium" style={{ background: `color-mix(in srgb, ${est.color} 14%, transparent)`, color: est.color }} title={e?.detalle ?? motivo ?? undefined}>
          {clase === 'enviada' ? <Check className="h-[11px] w-[11px]" /> : <span className="h-[6px] w-[6px] rounded-full" style={{ background: est.color }} />}
          {est.texto}
        </span>
        {(motivo || (e?.detalle && clase !== 'enviada')) && <div className="mt-[2px] max-w-[300px] truncate text-[11px] text-[var(--ls-t4)]" title={motivo ?? e?.detalle ?? undefined}>{motivo ?? e?.detalle}</div>}
      </td>
      <td className="px-3 tabular-nums text-[var(--ls-t2)]">
        {clase === 'enviada' ? <span className="text-[#34D399]">{fechaHora(e?.enviadaAt ?? null)}</span> : clase === 'en_cola' ? <span>{fechaHora(e?.programadoAt ?? null)}</span> : <span className="text-[var(--ls-t4)]">—</span>}
      </td>
      <td className="px-3 text-right tabular-nums text-[var(--ls-t2)]">{euros(p.importe)}</td>
      <td className="px-3 text-[var(--ls-t3)]">{e?.campana ?? '—'}</td>
      <td className="px-5 text-right">
        {clase === 'en_cola' && (
          <button type="button" onClick={() => onAccion('descartar')} className="inline-flex items-center gap-1 rounded-[8px] px-2 py-1 text-[11.5px] text-[var(--ls-t3)] hover:bg-[var(--ls-sup2)] hover:text-[#F87171]">
            <X className="h-[12px] w-[12px]" /> Descartar
          </button>
        )}
        {(clase === 'descartada' || clase === 'error') && (
          <button type="button" onClick={() => onAccion('recuperar')} className="inline-flex items-center gap-1 rounded-[8px] px-2 py-1 text-[11.5px] text-[var(--ls-t3)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]">
            <Undo2 className="h-[12px] w-[12px]" /> A la cola
          </button>
        )}
      </td>
    </tr>
  )
}

/* ------------------------------------------------------------------ */
/* Crear o editar una campaña                                          */
/* ------------------------------------------------------------------ */

function EditarCampana({ campana, mercados, onCerrar, onGuardar }: { campana: Partial<Campana> | null; mercados: string[]; onCerrar: () => void; onGuardar: (c: Partial<Campana>) => Promise<void> }) {
  const [c, setC] = useState<Partial<Campana>>({})
  const [skus, setSkus] = useState('')
  const [guardando, setGuardando] = useState(false)
  useEffect(() => {
    if (campana) {
      setC(campana)
      setSkus((campana.skus ?? []).join('\n'))
    }
  }, [campana])
  const campo = 'h-10 w-full rounded-[11px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 text-[13px] text-[var(--ls-t1)] outline-none focus:border-[var(--ls-acc)]'
  const etiqueta = 'mb-[6px] block text-[11.5px] font-semibold text-[var(--ls-t3)]'
  const todos = !c.mercados || c.mercados.length === 0
  return (
    <PanelLateral
      abierto={Boolean(campana)}
      onCambio={(a) => !a && onCerrar()}
      titulo={c.id ? 'Editar campaña' : 'Nueva campaña'}
      descripcion="Amazon manda su correo estándar de «Solicitar una reseña» (el mismo del botón de Seller Central), una vez por pedido, entre 5 y 30 días tras la entrega."
      icono={Star}
      acento="marca"
      ancho={520}
      pie={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCerrar} className="h-10 rounded-[11px] border border-[var(--ls-linea)] px-4 text-[13px] text-[var(--ls-t2)]">
            Cancelar
          </button>
          <button
            type="button"
            disabled={guardando}
            onClick={async () => {
              setGuardando(true)
              try {
                await onGuardar({ ...c, skus: skus.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean) })
              } finally {
                setGuardando(false)
              }
            }}
            className="inline-flex h-10 items-center gap-2 rounded-[11px] px-5 text-[13px] font-semibold text-[#141414] disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg,#F26212,#FF8A3D)' }}
          >
            {guardando && <Loader2 className="h-[14px] w-[14px] animate-spin" />}
            Guardar
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <div>
          <label className={etiqueta}>Nombre</label>
          <input value={c.nombre ?? ''} onChange={(e) => setC({ ...c, nombre: e.target.value })} className={campo} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={etiqueta}>Estado</label>
            <button type="button" onClick={() => setC({ ...c, activa: !c.activa })} className={`${campo} flex items-center gap-2`} style={{ color: c.activa ? '#34D399' : 'var(--ls-t2)' }}>
              {c.activa ? <Play className="h-[14px] w-[14px]" /> : <Pause className="h-[14px] w-[14px]" />}
              {c.activa ? 'Activa' : 'En pausa'}
            </button>
          </div>
          <div>
            <label className={etiqueta}>Prioridad</label>
            <input type="number" min={1} max={99} value={c.prioridad ?? 1} onChange={(e) => setC({ ...c, prioridad: Number(e.target.value) })} className={campo} />
          </div>
          <div>
            <label className={etiqueta}>Activa desde</label>
            <input type="date" value={c.desde ?? ''} onChange={(e) => setC({ ...c, desde: e.target.value })} className={`${campo} [color-scheme:dark]`} />
          </div>
          <div>
            <label className={etiqueta}>Activa hasta (vacío = siempre)</label>
            <input type="date" value={c.hasta ?? ''} onChange={(e) => setC({ ...c, hasta: e.target.value || null })} className={`${campo} [color-scheme:dark]`} />
          </div>
        </div>

        <div>
          <label className={etiqueta}>Cuándo se pide</label>
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--ls-t2)]">
            <input type="number" min={0} max={25} value={c.dias_tras_entrega ?? 5} onChange={(e) => setC({ ...c, dias_tras_entrega: Number(e.target.value) })} className={`${campo} !w-[76px] text-center`} />
            <span>días después de la entrega, a las</span>
            <select value={c.hora ?? 20} onChange={(e) => setC({ ...c, hora: Number(e.target.value) })} className={`${campo} !w-[96px]`}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, '0')}:00
                </option>
              ))}
            </select>
          </div>
          <p className="mt-2 text-[11.5px] leading-[1.45] text-[var(--ls-t4)]">La entrega se estima en 2 días desde la compra. Si a esa hora Amazon aún no deja pedirla (antes de 5 días tras la entrega no deja), se vuelve a probar cada día.</p>
        </div>

        <div className="flex flex-col gap-2">
          <Casilla valor={c.excluir_fbm ?? true} onCambio={(v) => setC({ ...c, excluir_fbm: v })} texto="Excluir pedidos FBM" />
          <Casilla valor={c.excluir_promo ?? false} onCambio={(v) => setC({ ...c, excluir_promo: v })} texto="Excluir pedidos con promoción" />
        </div>

        <div>
          <label className={etiqueta}>Países</label>
          <div className="flex flex-wrap gap-2">
            <Chip activo={todos} onClick={() => setC({ ...c, mercados: null })} texto="Todos" />
            {mercados.map((m) => {
              const on = !todos && (c.mercados ?? []).includes(m)
              return <Chip key={m} activo={on} onClick={() => setC({ ...c, mercados: on ? (c.mercados ?? []).filter((x) => x !== m) : [...(todos ? [] : (c.mercados ?? [])), m] })} texto={`${bandera(m)} ${pais(m)}`} />
            })}
          </div>
        </div>

        <div>
          <label className={etiqueta}>Productos</label>
          <div className="flex flex-col gap-2">
            {(
              [
                ['todos', 'Aplicar esta campaña a todos los productos'],
                ['solo', 'Solo a los productos elegidos'],
                ['excepto', 'A todos menos los elegidos'],
              ] as const
            ).map(([id, texto]) => (
              <label key={id} className="flex cursor-pointer items-center gap-2 text-[13px] text-[var(--ls-t2)]">
                <input type="radio" checked={(c.productos_modo ?? 'todos') === id} onChange={() => setC({ ...c, productos_modo: id })} className="accent-[#F26212]" />
                {texto}
              </label>
            ))}
          </div>
          {c.productos_modo && c.productos_modo !== 'todos' && <textarea value={skus} onChange={(e) => setSkus(e.target.value)} placeholder="Los SKU, uno por línea" rows={5} className={`${campo} mt-3 !h-auto py-2 font-mono text-[12px]`} />}
        </div>

        <div className="rounded-[12px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-4 py-3 text-[12px] leading-[1.5] text-[var(--ls-t3)]">
          <b className="text-[var(--ls-t2)]">Tipo de campaña: solicitud estándar de Amazon.</b> Un correo de Amazon, en el idioma del comprador, que pide la reseña del producto y la valoración del vendedor. Es lo que deja mandar la API de Amazon que tenemos; un texto propio necesitaría el permiso de mensajería con compradores, que la app no tiene.
        </div>
      </div>
    </PanelLateral>
  )
}

function Casilla({ valor, onCambio, texto }: { valor: boolean; onCambio: (v: boolean) => void; texto: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[13px] text-[var(--ls-t2)]">
      <input type="checkbox" checked={valor} onChange={(e) => onCambio(e.target.checked)} className="h-4 w-4 accent-[#F26212]" />
      {texto}
    </label>
  )
}

function Chip({ activo, onClick, texto }: { activo: boolean; onClick: () => void; texto: string }) {
  return (
    <button type="button" onClick={onClick} className="rounded-full border px-3 py-[5px] text-[12px] transition-colors" style={{ borderColor: activo ? '#F26212' : 'var(--ls-linea)', background: activo ? 'color-mix(in srgb,#F26212 14%,transparent)' : 'transparent', color: activo ? 'var(--ls-t1)' : 'var(--ls-t3)' }}>
      {texto}
    </button>
  )
}
