'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { ArrowUpDown, Calendar, Coins, LayoutGrid, Loader2, RefreshCw, Rows3 } from 'lucide-react'
import { CifraAnimada, Segmentado } from '@/components/ui-ls'
import { hoyEnMadrid, sumarDias, sumarTotales, type Totales } from '@/lib/ventas/panel'
import type { CuentaDelPanel, ResumenDeCuenta } from '@/lib/ventas/panel-servidor'
import { ACENTOS, Marco, MiniArea, TARJETA } from './TableroVentas'
import { Chip, entero, euros, pct, ROJO, VERDE } from './piezas'

/**
 * VENTAS · TODAS LAS CUENTAS (la vista de pájaro). Cada cliente del panel con lo que ha vendido en el periodo elegido, sus reembolsos, su gasto en
 * publicidad y su ganancia, comparado con el periodo anterior de la misma duración. Un clic lleva al panel de esa cuenta.
 */

type IdPeriodo = 'hoy' | 'ayer' | '7' | '30' | 'mes' | 'mesPasado' | 'rango'
type Orden = 'ventas' | 'neto' | 'publicidad' | 'reembolsos' | 'nombre'

const PERIODOS: Array<{ id: IdPeriodo; texto: string }> = [
  { id: 'hoy', texto: 'Hoy' },
  { id: 'ayer', texto: 'Ayer' },
  { id: '7', texto: '7 días' },
  { id: '30', texto: '30 días' },
  { id: 'mes', texto: 'Este mes' },
  { id: 'mesPasado', texto: 'Mes pasado' },
  { id: 'rango', texto: 'Fechas' },
]

async function pedir<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: 'no-store' })
  const j = (await r.json().catch(() => null)) as (T & { error?: string }) | null
  if (!r.ok) throw new Error(j?.error ?? `Error ${r.status}`)
  return j as T
}

const dias = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1

function rangoDe(id: IdPeriodo, hoy: string, libre: { desde: string; hasta: string }): { desde: string; hasta: string; comp: { desde: string; hasta: string }; texto: string } {
  const primeroDeMes = `${hoy.slice(0, 8)}01`
  const r = (() => {
    switch (id) {
      case 'hoy':
        return { desde: hoy, hasta: hoy, comp: { desde: sumarDias(hoy, -7), hasta: sumarDias(hoy, -7) }, texto: 'frente al mismo día de la semana pasada' }
      case 'ayer':
        return { desde: sumarDias(hoy, -1), hasta: sumarDias(hoy, -1), comp: { desde: sumarDias(hoy, -8), hasta: sumarDias(hoy, -8) }, texto: 'frente al mismo día de la semana anterior' }
      case '7':
        return { desde: sumarDias(hoy, -6), hasta: hoy, comp: { desde: sumarDias(hoy, -13), hasta: sumarDias(hoy, -7) }, texto: 'frente a los 7 días anteriores' }
      case '30':
        return { desde: sumarDias(hoy, -29), hasta: hoy, comp: { desde: sumarDias(hoy, -59), hasta: sumarDias(hoy, -30) }, texto: 'frente a los 30 días anteriores' }
      case 'mes': {
        const finAnt = sumarDias(primeroDeMes, -1)
        const iniAnt = `${finAnt.slice(0, 8)}01`
        const n = dias(primeroDeMes, hoy)
        return { desde: primeroDeMes, hasta: hoy, comp: { desde: iniAnt, hasta: [sumarDias(iniAnt, n - 1), finAnt].sort()[0] }, texto: 'frente a los mismos días del mes pasado' }
      }
      case 'mesPasado': {
        const fin = sumarDias(primeroDeMes, -1)
        const ini = `${fin.slice(0, 8)}01`
        const finAnt = sumarDias(ini, -1)
        return { desde: ini, hasta: fin, comp: { desde: `${finAnt.slice(0, 8)}01`, hasta: finAnt }, texto: 'frente al mes anterior' }
      }
      default: {
        const n = dias(libre.desde, libre.hasta)
        return { desde: libre.desde, hasta: libre.hasta, comp: { desde: sumarDias(libre.desde, -n), hasta: sumarDias(libre.desde, -1) }, texto: `frente a los ${n} días anteriores` }
      }
    }
  })()
  return r
}

export function ResumenDeCuentas() {
  const { hoy } = useMemo(() => hoyEnMadrid(), [])
  const [periodo, setPeriodo] = useState<IdPeriodo>('hoy')
  const [libre, setLibre] = useState({ desde: sumarDias(hoy, -13), hasta: hoy })
  const [vista, setVista] = useState<'tarjetas' | 'tabla'>('tarjetas')
  const [orden, setOrden] = useState<Orden>('ventas')
  const [cuentas, setCuentas] = useState<CuentaDelPanel[] | null>(null)
  const [resumen, setResumen] = useState<ResumenDeCuenta[] | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloj, setReloj] = useState(0)
  const peticion = useRef(0)
  const r = useMemo(() => rangoDe(periodo, hoy, libre), [periodo, hoy, libre])

  useEffect(() => {
    try {
      const v = localStorage.getItem('ventas-resumen-vista')
      if (v === 'tabla' || v === 'tarjetas') setVista(v)
    } catch {}
  }, [])
  // AL MOMENTO: lo último que se vio de cada periodo se enseña nada más entrar (guardado en este navegador) mientras llegan los números nuevos
  const leerGuardado = <T,>(k: string): T | null => {
    try {
      const v = localStorage.getItem(k)
      return v ? (JSON.parse(v) as T) : null
    } catch {
      return null
    }
  }
  const guardar = (k: string, v: unknown) => {
    try {
      localStorage.setItem(k, JSON.stringify(v))
    } catch {
      /* sin almacenamiento: se espera a la red como antes */
    }
  }
  useEffect(() => {
    const ya = leerGuardado<CuentaDelPanel[]>('ventas-resumen-cuentas')
    if (ya) setCuentas(ya)
    pedir<{ cuentas: CuentaDelPanel[] }>('/api/ventas?que=cuentas')
      .then((x) => (setCuentas(x.cuentas), guardar('ventas-resumen-cuentas', x.cuentas)))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])
  useEffect(() => {
    const n = ++peticion.current
    setCargando(true)
    const url = `/api/ventas?que=resumen&desde=${r.desde}&hasta=${r.hasta}&compDesde=${r.comp.desde}&compHasta=${r.comp.hasta}&serieDesde=${[sumarDias(hoy, -13), r.desde].sort()[0]}`
    const ya = leerGuardado<ResumenDeCuenta[]>(`ventas-resumen:${url}`)
    if (ya) setResumen(ya)
    pedir<{ resumen: ResumenDeCuenta[] }>(url)
      .then((x) => n === peticion.current && (setResumen(x.resumen), setError(null), guardar(`ventas-resumen:${url}`, x.resumen)))
      .catch((e) => n === peticion.current && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => n === peticion.current && setCargando(false))
  }, [r, hoy, reloj])
  // Se refresca solo cada 2 minutos con la pantalla a la vista
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === 'visible' && setReloj((x) => x + 1), 120_000)
    return () => clearInterval(t)
  }, [])

  const filas = useMemo(() => {
    if (!cuentas || !resumen) return []
    const por = new Map(resumen.map((x) => [x.id, x]))
    const lista = cuentas.map((c) => ({ c, r: por.get(c.id) ?? null }))
    const v = (x: (typeof lista)[number]) => (orden === 'nombre' ? 0 : orden === 'publicidad' ? (x.r?.t.publicidad ?? 0) : orden === 'reembolsos' ? (x.r?.t.reembolsos ?? 0) : orden === 'neto' ? (x.r?.t.neto ?? 0) : (x.r?.t.ventas ?? 0))
    return lista.sort((a, b) => (orden === 'nombre' ? (a.c.cliente ?? a.c.nombre).localeCompare(b.c.cliente ?? b.c.nombre, 'es') : v(b) - v(a)))
  }, [cuentas, resumen, orden])

  const total = useMemo(() => sumar(filas.map((f) => f.r?.t ?? null)), [filas])
  const totalComp = useMemo(() => sumar(filas.map((f) => f.r?.c ?? null)), [filas])

  return (
    <Marco
      titulo="Sellerboard"
      subtitulo="Todas las cuentas de un vistazo: lo que venden, lo que se devuelve, lo que se gasta en publicidad y lo que queda. Pulsa una para entrar."
      icono={Coins}
      debajo={
        <div className="flex flex-wrap items-center gap-2">
          <Segmentado etiqueta="Periodo" valor={periodo} onCambio={setPeriodo} opciones={PERIODOS} />
          {periodo === 'rango' && (
            <div className="flex items-center gap-2 rounded-[13px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 py-[6px] text-[12.5px] text-[var(--ls-t2)]">
              <Calendar className="h-[14px] w-[14px] text-[var(--ls-t4)]" />
              <input type="date" value={libre.desde} max={libre.hasta} onChange={(e) => e.target.value && setLibre((x) => ({ ...x, desde: e.target.value }))} className="bg-transparent outline-none [color-scheme:dark]" />
              <span className="text-[var(--ls-t4)]">→</span>
              <input type="date" value={libre.hasta} min={libre.desde} max={hoy} onChange={(e) => e.target.value && setLibre((x) => ({ ...x, hasta: e.target.value }))} className="bg-transparent outline-none [color-scheme:dark]" />
            </div>
          )}
        </div>
      }
      acciones={
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex h-11 items-center gap-2 rounded-[13px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 text-[12.5px] text-[var(--ls-t2)]">
            <ArrowUpDown className="h-[14px] w-[14px] text-[var(--ls-t4)]" />
            <select value={orden} onChange={(e) => setOrden(e.target.value as Orden)} className="bg-transparent outline-none">
              <option value="ventas">Más ventas</option>
              <option value="neto">Más ganancia</option>
              <option value="publicidad">Más publicidad</option>
              <option value="reembolsos">Más reembolsos</option>
              <option value="nombre">Por nombre</option>
            </select>
          </label>
          <Segmentado
            etiqueta="Vista"
            tamano="sm"
            valor={vista}
            onCambio={(v) => {
              setVista(v)
              try {
                localStorage.setItem('ventas-resumen-vista', v)
              } catch {}
            }}
            opciones={[
              { id: 'tarjetas', texto: 'Tarjetas', icono: LayoutGrid },
              { id: 'tabla', texto: 'Tabla', icono: Rows3 },
            ]}
          />
          <button type="button" onClick={() => setReloj((x) => x + 1)} className="inline-flex h-11 w-11 items-center justify-center rounded-[13px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] text-[var(--ls-t2)] hover:text-[var(--ls-t1)]" title="Volver a leer" aria-label="Volver a leer">
            {cargando ? <Loader2 className="h-[14px] w-[14px] animate-spin" /> : <RefreshCw className="h-[14px] w-[14px]" />}
          </button>
        </div>
      }
    >
      {error && <p className="mb-4 rounded-[12px] border border-[color-mix(in_srgb,#F87171_40%,transparent)] px-4 py-3 text-[12.5px] text-[#F87171]">{error}</p>}

      {/* Lo de todas juntas */}
      <div className={`${TARJETA} relative mb-5 overflow-hidden p-5`}>
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-24 h-[240px] w-[420px] rounded-full opacity-[0.16] blur-[80px]" style={{ background: 'linear-gradient(90deg,#F26212,#A78BFA)' }} />
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--ls-t4)]">Todas las cuentas · {PERIODOS.find((p) => p.id === periodo)?.texto}</div>
            <CifraAnimada valor={total?.ventas ?? 0} formato={(v) => euros(v)} className="mt-1 block text-[38px] font-semibold leading-none tracking-[-0.04em] tabular-nums text-[var(--ls-t1)]" />
            <div className="mt-2 flex items-center gap-2 text-[12px] text-[var(--ls-t4)]">
              <Chip actual={total?.ventas ?? 0} anterior={totalComp?.ventas} />
              <span>{r.texto}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Cifra texto="Unidades" valor={entero(total?.unidades ?? 0)} delta={<Chip actual={total?.unidades ?? 0} anterior={totalComp?.unidades} />} />
            <Cifra texto="Reembolsos" valor={entero(total?.reembolsos ?? 0)} color={total?.reembolsos ? ROJO : undefined} delta={<Chip actual={total?.reembolsos ?? 0} anterior={totalComp?.reembolsos} inverso />} />
            <Cifra texto="Publicidad" valor={euros(-(total?.publicidad ?? 0))} delta={<Chip actual={total?.publicidad ?? 0} anterior={totalComp?.publicidad} inverso />} />
            <Cifra texto="Ganancia neta" valor={euros(total?.neto ?? 0)} color={(total?.neto ?? 0) >= 0 ? VERDE : ROJO} delta={<Chip actual={total?.neto ?? 0} anterior={totalComp?.neto} />} />
            <Cifra texto="Margen" valor={pct(total?.margen ?? null, 0)} />
          </div>
        </div>
      </div>

      {!resumen || !cuentas ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 min-[1400px]:grid-cols-4">
          {[0, 1, 2].map((k) => (
            <div key={k} className={`${TARJETA} h-[270px] animate-pulse`} />
          ))}
        </div>
      ) : vista === 'tarjetas' ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 min-[1400px]:grid-cols-4">
          {filas.map(({ c, r: x }, i) => (
            <TarjetaCuenta key={c.id} c={c} r={x} i={i} />
          ))}
        </div>
      ) : (
        <TablaCuentas filas={filas} />
      )}
    </Marco>
  )
}

function sumar(ts: Array<Totales | null>): Totales | null {
  const vivos = ts.filter((t): t is Totales => t != null)
  if (!vivos.length) return null
  return sumarTotales(vivos)
}

function Cifra({ texto, valor, color, delta }: { texto: string; valor: string; color?: string; delta?: React.ReactNode }) {
  return (
    <div className="min-w-[110px] rounded-[14px] border border-[color-mix(in_srgb,var(--ls-t1)_6%,transparent)] bg-[color-mix(in_srgb,var(--ls-sup2)_72%,transparent)] px-3 py-[9px]">
      <div className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-[var(--ls-t4)]">{texto}</div>
      <div className="whitespace-nowrap text-[16px] font-semibold tabular-nums" style={{ color: color ?? 'var(--ls-t1)' }}>
        {valor}
      </div>
      <div className="h-[15px] [&_*]:!text-[10.5px]">{delta}</div>
    </div>
  )
}

export function Emoji({ c, lado = 40 }: { c: Pick<CuentaDelPanel, 'emoji' | 'cliente' | 'nombre'>; lado?: number }) {
  const texto = c.cliente ?? c.nombre
  const letras = texto.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('')
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-[12px] font-bold leading-none"
      style={{ width: lado, height: lado, fontSize: c.emoji ? lado * 0.52 : lado * 0.34, color: '#141414', background: c.emoji ? 'linear-gradient(135deg, color-mix(in srgb, #F26212 22%, var(--ls-sup2)), var(--ls-sup2))' : 'linear-gradient(135deg, #F26212, #FFB27A)', boxShadow: 'inset 0 0 0 1px color-mix(in srgb, #F26212 28%, transparent)' }}
      aria-hidden
    >
      {c.emoji ?? letras}
    </span>
  )
}

function TarjetaCuenta({ c, r, i }: { c: CuentaDelPanel; r: ResumenDeCuenta | null; i: number }) {
  const [a] = ACENTOS[i % ACENTOS.length]
  const t = r?.t
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: Math.min(i, 12) * 0.04, ease: [0.2, 0.8, 0.2, 1] }}>
      <Link href={`/dashboard/ventas?cuenta=${c.id}`} className={`${TARJETA} group relative block overflow-hidden p-4 transition-transform duration-200 hover:-translate-y-[2px]`}>
        <div aria-hidden className="pointer-events-none absolute -right-10 -top-16 h-[160px] w-[240px] rounded-full opacity-[0.14] blur-[60px] transition-opacity group-hover:opacity-[0.24]" style={{ background: a }} />
        <div className="flex items-center gap-3">
          <Emoji c={c} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-semibold text-[var(--ls-t1)]">{c.cliente ?? c.nombre}</div>
            <div className="truncate text-[11.5px] text-[var(--ls-t4)]">{c.cliente && c.cliente !== c.nombre ? c.nombre : `${c.mercados.length} países`}</div>
          </div>
          {c.estado.error && <span className="h-2 w-2 shrink-0 rounded-full bg-[#F87171]" title={c.estado.error} />}
        </div>
        <div className="mt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--ls-t4)]">Ventas</div>
        <div className="flex items-baseline gap-2">
          <CifraAnimada valor={t?.ventas ?? 0} formato={(v) => euros(v)} className="text-[23px] font-semibold leading-none tracking-[-0.035em] tabular-nums text-[var(--ls-t1)]" />
          {t && <Chip actual={t.ventas} anterior={r?.c?.ventas} />}
        </div>
        <div className="-mx-4 mt-1">
          <MiniArea valores={r?.serie ?? []} color={a} id={`rc-${c.id.slice(0, 8)}`} viva alto={34} />
        </div>
        <div className="mt-1 grid grid-cols-4 divide-x divide-[color-mix(in_srgb,var(--ls-t1)_7%,transparent)] rounded-[11px] border border-[color-mix(in_srgb,var(--ls-t1)_6%,transparent)] bg-[color-mix(in_srgb,var(--ls-sup2)_72%,transparent)] py-[6px]">
          <Mini texto="Uds." valor={entero(t?.unidades ?? 0)} />
          <Mini texto="Reemb." valor={entero(t?.reembolsos ?? 0)} color={t?.reembolsos ? ROJO : undefined} />
          <Mini texto="PPC" valor={euros(-(t?.publicidad ?? 0))} />
          <Mini texto="Neto" valor={euros(t?.neto ?? 0)} color={(t?.neto ?? 0) >= 0 ? VERDE : ROJO} />
        </div>
      </Link>
    </motion.div>
  )
}

function Mini({ texto, valor, color }: { texto: string; valor: string; color?: string }) {
  return (
    <div className="min-w-0 px-[8px]">
      <div className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--ls-t4)]">{texto}</div>
      <div className="truncate text-[11.5px] font-semibold tabular-nums" style={{ color: color ?? 'var(--ls-t1)' }}>
        {valor}
      </div>
    </div>
  )
}

function TablaCuentas({ filas }: { filas: Array<{ c: CuentaDelPanel; r: ResumenDeCuenta | null }> }) {
  const cab = 'whitespace-nowrap px-3 py-[10px] text-right text-[11px] font-semibold uppercase tracking-wide text-[var(--ls-t4)]'
  return (
    <div className={`${TARJETA} overflow-x-auto`}>
      <table className="w-full min-w-[920px] text-[13px]">
        <thead className="border-b border-[var(--ls-linea)]">
          <tr>
            <th className={`${cab} text-left`}>Cuenta</th>
            <th className={cab}>Ventas</th>
            <th className={cab}>Unidades</th>
            <th className={cab}>Pedidos</th>
            <th className={cab}>Reembolsos</th>
            <th className={cab}>Publicidad</th>
            <th className={cab}>TACOS</th>
            <th className={cab}>Ganancia neta</th>
            <th className={cab}>Margen</th>
          </tr>
        </thead>
        <tbody>
          {filas.map(({ c, r }) => {
            const t = r?.t
            return (
              <tr key={c.id} className="border-b border-[var(--ls-linea)] transition-colors last:border-0 hover:bg-[color-mix(in_srgb,var(--ls-sup2)_70%,transparent)]">
                <td className="px-3 py-[7px]">
                  <Link href={`/dashboard/ventas?cuenta=${c.id}`} className="flex items-center gap-3">
                    <Emoji c={c} lado={30} />
                    <span className="font-medium text-[var(--ls-t1)]">{c.cliente ?? c.nombre}</span>
                  </Link>
                </td>
                <td className="px-3 text-right font-semibold tabular-nums text-[var(--ls-t1)]">
                  <div>{euros(t?.ventas ?? 0)}</div>
                  <div className="[&_*]:!text-[10.5px]">{t && <Chip actual={t.ventas} anterior={r?.c?.ventas} />}</div>
                </td>
                <td className="px-3 text-right tabular-nums text-[var(--ls-t2)]">{entero(t?.unidades ?? 0)}</td>
                <td className="px-3 text-right tabular-nums text-[var(--ls-t2)]">{entero(t?.pedidos ?? 0)}</td>
                <td className="px-3 text-right tabular-nums" style={{ color: t?.reembolsos ? ROJO : 'var(--ls-t4)' }}>{entero(t?.reembolsos ?? 0)}</td>
                <td className="px-3 text-right tabular-nums text-[var(--ls-t3)]">{t?.publicidad ? euros(-t.publicidad) : '—'}</td>
                <td className="px-3 text-right tabular-nums text-[var(--ls-t3)]">{pct(t?.tacos ?? null, 1)}</td>
                <td className="px-3 text-right font-semibold tabular-nums" style={{ color: (t?.neto ?? 0) >= 0 ? VERDE : ROJO }}>{euros(t?.neto ?? 0)}</td>
                <td className="px-3 text-right tabular-nums text-[var(--ls-t2)]">{pct(t?.margen ?? null, 0)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
