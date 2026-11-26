'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Calendar, Check, ChevronDown, Download, GitCompareArrows, Globe, Loader2, Settings2 } from 'lucide-react'
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { PanelLateral, Segmentado } from '@/components/ui-ls'
import { ImagenDeProducto } from '@/components/productos/ImagenDeProducto'
import { sumarDias, totalizar, type FilaPanel, type Totales } from '@/lib/ventas/panel'
import type { CuentaDelPanel, LineaDelPanel } from '@/lib/ventas/panel-servidor'
import { bandera, Buscador, Desglose, entero, euros, fechaCorta, pais, pct, TablaPedidos, TablaProductos, type Agrupar } from './piezas'

/**
 * VENTAS · LA VISTA «GRÁFICO» (como la de Sellerboard, 26 nov 2026). Barras y líneas por mes, semana o día de las métricas que se elijan (con tres vistas
 * hechas: la general, la de reembolsos y la de ventas), comparadas con el año anterior en barras rayadas. Al pulsar una barra, a la derecha sale el desglose
 * de ese mes, semana o día (o del rango entero) y abajo sus productos y pedidos. Se exporta a CSV.
 */

type Datos = { filas: FilaPanel[]; productos: { titulos: Record<string, { titulo: string | null; asin: string | null }>; costes: Record<string, number> } | null; lineas: LineaDelPanel[] | null }
export type Modo = 'meses' | 'semanas' | 'dias' | 'rango'
type Unidad = 'euros' | 'numero' | 'porcentaje'

interface Metrica {
  id: string
  texto: string
  unidad: Unidad
  color: string
  valor: (t: Totales) => number | null
  /** Barra (euros) o línea (números y porcentajes) */
  forma: 'barra' | 'linea'
}

const METRICAS: Metrica[] = [
  { id: 'ventas', texto: 'Ventas', unidad: 'euros', color: '#FF8A3D', valor: (t) => t.ventas, forma: 'barra' },
  { id: 'unidades', texto: 'Unidades', unidad: 'numero', color: '#60A5FA', valor: (t) => t.unidades, forma: 'linea' },
  { id: 'pedidos', texto: 'Pedidos', unidad: 'numero', color: '#22D3EE', valor: (t) => t.pedidos, forma: 'linea' },
  { id: 'publicidad', texto: 'Costes publicitarios', unidad: 'euros', color: '#F0544F', valor: (t) => -t.publicidad, forma: 'barra' },
  { id: 'reembolsos', texto: 'Reembolsos', unidad: 'numero', color: '#F472B6', valor: (t) => t.reembolsos, forma: 'linea' },
  { id: 'costeReembolso', texto: 'Coste de reembolso', unidad: 'euros', color: '#FB7185', valor: (t) => t.costeReembolso, forma: 'barra' },
  { id: 'tarifas', texto: 'Tarifas de Amazon', unidad: 'euros', color: '#F5B942', valor: (t) => t.tarifas, forma: 'barra' },
  { id: 'cogs', texto: 'Coste de los productos', unidad: 'euros', color: '#38BDF8', valor: (t) => -t.cogs, forma: 'barra' },
  { id: 'iva', texto: 'IVA', unidad: 'euros', color: '#8B8580', valor: (t) => -t.iva, forma: 'barra' },
  { id: 'neto', texto: 'Ganancia neta', unidad: 'euros', color: '#818CF8', valor: (t) => t.neto, forma: 'barra' },
  { id: 'margen', texto: 'Margen', unidad: 'porcentaje', color: '#4ADE80', valor: (t) => t.margen, forma: 'linea' },
  { id: 'roi', texto: 'ROI', unidad: 'porcentaje', color: '#2DD4BF', valor: (t) => t.roi, forma: 'linea' },
  { id: 'tacos', texto: 'TACOS', unidad: 'porcentaje', color: '#C084FC', valor: (t) => t.tacos, forma: 'linea' },
  { id: 'tasaReembolso', texto: 'Tasa de reembolso', unidad: 'porcentaje', color: '#FDA4AF', valor: (t) => t.tasaReembolso, forma: 'linea' },
]
const VISTAS: Array<{ id: string; texto: string; metricas: string[] }> = [
  { id: 'general', texto: 'Vista general de la cuenta', metricas: ['unidades', 'publicidad', 'reembolsos', 'neto'] },
  { id: 'reembolsos', texto: 'Análisis de reembolsos', metricas: ['reembolsos', 'costeReembolso', 'tasaReembolso'] },
  { id: 'ventas', texto: 'Análisis de ventas', metricas: ['ventas', 'unidades', 'pedidos', 'margen'] },
]
export const MODOS: Array<{ id: Modo; texto: string }> = [
  { id: 'meses', texto: 'Últimos 12 meses, por mes' },
  { id: 'semanas', texto: 'Últimos 3 meses, por semana' },
  { id: 'dias', texto: 'Últimos 30 días, por día' },
]

async function pedir<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: 'no-store' })
  const j = (await r.json().catch(() => null)) as (T & { error?: string }) | null
  if (!r.ok) throw new Error(j?.error ?? `Error ${r.status}`)
  return j as T
}

const mesDe = (d: string) => d.slice(0, 7)
export const lunesDe = (d: string) => sumarDias(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7))
export const menosUnAnio = (d: string) => `${Number(d.slice(0, 4)) - 1}${d.slice(4)}`.replace(/-02-29$/, '-02-28')

export interface Cubeta {
  clave: string
  etiqueta: string
  sub?: string
  desde: string
  hasta: string
}

export function cubetas(modo: Modo, desde: string, hasta: string): Cubeta[] {
  const out: Cubeta[] = []
  const porDia = modo === 'dias' || (modo === 'rango' && Date.parse(hasta) - Date.parse(desde) <= 62 * 86_400_000)
  const porSemana = modo === 'semanas' || (modo === 'rango' && !porDia && Date.parse(hasta) - Date.parse(desde) <= 190 * 86_400_000)
  if (porDia) {
    for (let d = desde; d <= hasta; d = sumarDias(d, 1)) out.push({ clave: d, etiqueta: d.slice(8, 10), sub: d.endsWith('-01') || d === desde ? new Date(`${d}T00:00:00Z`).toLocaleDateString('es-ES', { month: 'short', timeZone: 'UTC' }) : undefined, desde: d, hasta: d })
  } else if (porSemana) {
    for (let l = lunesDe(desde); l <= hasta; l = sumarDias(l, 7)) {
      const ini = l < desde ? desde : l
      const fin = sumarDias(l, 6) > hasta ? hasta : sumarDias(l, 6)
      out.push({ clave: l, etiqueta: new Date(`${ini}T00:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' }), desde: ini, hasta: fin })
    }
  } else {
    for (let m = `${mesDe(desde)}-01`; m <= hasta; ) {
      const d = new Date(`${m}T00:00:00Z`)
      const fin = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10)
      out.push({ clave: mesDe(m), etiqueta: d.toLocaleDateString('es-ES', { month: 'short', timeZone: 'UTC' }).replace('.', ''), sub: String(d.getUTCFullYear()), desde: m < desde ? desde : m, hasta: fin > hasta ? hasta : fin })
      m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10)
    }
  }
  return out
}

export function VistaGrafico({ cuenta, hoy, skus }: { cuenta: CuentaDelPanel; hoy: string; skus: Set<string> | null }) {
  const [modo, setModo] = useState<Modo>('meses')
  const [rango, setRango] = useState({ desde: sumarDias(hoy, -89), hasta: hoy })
  const [comparar, setComparar] = useState(true)
  const [mercados, setMercados] = useState<Set<string> | null>(null)
  const [metricas, setMetricas] = useState<string[]>(VISTAS[0].metricas)
  const [elegida, setElegida] = useState<string | null>(null)
  const [pestana, setPestana] = useState<'productos' | 'pedidos'>('productos')
  const [agrupar, setAgrupar] = useState<Agrupar>('sku')
  const [buscar, setBuscar] = useState('')
  const [datos, setDatos] = useState<Datos | null>(null)
  const [comp, setComp] = useState<FilaPanel[]>([])
  const [lineas, setLineas] = useState<LineaDelPanel[] | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [producto, setProducto] = useState<{ titulo: string; sub: string; asin: string | null; mkt: string; filas: FilaPanel[] } | null>(null)

  const rangoTotal = useMemo(() => {
    if (modo === 'dias') return { desde: sumarDias(hoy, -29), hasta: hoy }
    if (modo === 'semanas') return { desde: lunesDe(sumarDias(hoy, -12 * 7)), hasta: hoy }
    if (modo === 'meses') {
      const d = new Date(`${hoy}T00:00:00Z`)
      return { desde: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 12, 1)).toISOString().slice(0, 10), hasta: hoy }
    }
    return rango
  }, [modo, rango, hoy])
  const lista = useMemo(() => cubetas(modo, rangoTotal.desde, rangoTotal.hasta), [modo, rangoTotal])
  useEffect(() => setElegida(null), [modo, rangoTotal])

  useEffect(() => {
    let vivo = true
    setCargando(true)
    setError(null)
    const a = pedir<Datos>(`/api/ventas?cuenta=${cuenta.id}&desde=${rangoTotal.desde}&hasta=${rangoTotal.hasta}`)
    const b = comparar ? pedir<Datos>(`/api/ventas?cuenta=${cuenta.id}&desde=${menosUnAnio(rangoTotal.desde)}&hasta=${menosUnAnio(rangoTotal.hasta)}&productos=0`) : Promise.resolve({ filas: [] as FilaPanel[], productos: null, lineas: null })
    Promise.all([a, b])
      .then(([x, y]) => {
        if (!vivo) return
        setDatos(x)
        setComp(y.filas)
      })
      .catch((e) => vivo && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => vivo && setCargando(false))
    return () => {
      vivo = false
    }
  }, [cuenta.id, rangoTotal, comparar])

  const filtrar = (fs: readonly FilaPanel[]) => fs.filter((f) => (!mercados || mercados.has(f.mkt)) && (!skus || skus.has(f.sku)))
  const filas = useMemo(() => filtrar(datos?.filas ?? []), [datos, mercados, skus]) // eslint-disable-line react-hooks/exhaustive-deps
  const filasComp = useMemo(() => filtrar(comp), [comp, mercados, skus]) // eslint-disable-line react-hooks/exhaustive-deps
  const costes = useMemo(() => datos?.productos?.costes ?? {}, [datos])
  const titulos = useMemo(() => datos?.productos?.titulos ?? {}, [datos])
  const iva = cuenta.iva
  const mercadosConDatos = useMemo(() => [...new Set((datos?.filas ?? []).map((f) => f.mkt))].sort((a, b) => pais(a).localeCompare(pais(b), 'es')), [datos])

  const porCubeta = useMemo(() => {
    const dentro = (f: FilaPanel, c: Cubeta) => f.dia >= c.desde && f.dia <= c.hasta
    return lista.map((c) => {
      const t = totalizar(filas.filter((f) => dentro(f, c)), iva, costes)
      const cc = { desde: menosUnAnio(c.desde), hasta: menosUnAnio(c.hasta) }
      const tc = comparar ? totalizar(filasComp.filter((f) => f.dia >= cc.desde && f.dia <= cc.hasta), iva, costes) : null
      return { c, t, tc }
    })
  }, [lista, filas, filasComp, iva, costes, comparar])

  const datosGrafica = porCubeta.map(({ c, t, tc }) => {
    const fila: Record<string, number | string | null> = { clave: c.clave, etiqueta: c.etiqueta }
    for (const m of METRICAS) {
      fila[m.id] = m.valor(t)
      if (tc) fila[`${m.id}_ant`] = m.valor(tc)
    }
    return fila
  })
  const activas = METRICAS.filter((m) => metricas.includes(m.id))
  const hayNumero = activas.some((m) => m.unidad === 'numero')
  const hayPct = activas.some((m) => m.unidad === 'porcentaje')

  const cubetaElegida = porCubeta.find((x) => x.c.clave === elegida) ?? null
  const filasElegidas = useMemo(() => (cubetaElegida ? filas.filter((f) => f.dia >= cubetaElegida.c.desde && f.dia <= cubetaElegida.c.hasta) : filas), [cubetaElegida, filas])
  const tRango = useMemo(() => totalizar(filas, iva, costes), [filas, iva, costes])
  const tElegida = cubetaElegida?.t ?? tRango
  const rangoDetalle = cubetaElegida ? cubetaElegida.c : rangoTotal

  // Los pedidos del mes, semana o día elegido (solo hay detalle de los últimos ~62 días)
  useEffect(() => {
    if (pestana !== 'pedidos') return
    let vivo = true
    setLineas(null)
    pedir<Datos>(`/api/ventas?cuenta=${cuenta.id}&desde=${rangoDetalle.desde}&hasta=${rangoDetalle.desde}&productos=0&lineasDesde=${rangoDetalle.desde}&lineasHasta=${rangoDetalle.hasta}`)
      .then((r) => vivo && setLineas(r.lineas ?? []))
      .catch(() => vivo && setLineas([]))
    return () => {
      vivo = false
    }
  }, [pestana, cuenta.id, rangoDetalle.desde, rangoDetalle.hasta])

  const exportar = () => {
    const cab = ['Periodo', 'Desde', 'Hasta', ...METRICAS.map((m) => m.texto)]
    const filasCsv = porCubeta.map(({ c, t }) => [c.etiqueta + (c.sub ? ` ${c.sub}` : ''), c.desde, c.hasta, ...METRICAS.map((m) => {
      const v = m.valor(t)
      return v == null ? '' : m.unidad === 'porcentaje' ? (v * 100).toFixed(2).replace('.', ',') : String(Math.round(v * 100) / 100).replace('.', ',')
    })])
    const blob = new Blob(['﻿' + [cab, ...filasCsv].map((f) => f.join(';')).join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `ventas-${(cuenta.cliente ?? cuenta.nombre).toLowerCase().replace(/\s+/g, '-')}-${rangoTotal.desde}-${rangoTotal.hasta}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const formato = (m: Metrica, v: number | null) => (v == null ? '—' : m.unidad === 'euros' ? euros(v) : m.unidad === 'porcentaje' ? pct(v) : entero(v))

  return (
    <div className="flex flex-col gap-4">
      {/* Los filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <Menu icono={Calendar} texto={modo === 'rango' ? `${fechaCorta(rango.desde)} – ${fechaCorta(rango.hasta)}` : (MODOS.find((m) => m.id === modo)?.texto ?? '')}>
          {(cerrar) => (
            <>
              {MODOS.map((m) => (
                <Fila key={m.id} activa={modo === m.id} onClick={() => (setModo(m.id), cerrar())}>
                  {m.texto}
                </Fila>
              ))}
              <RangoLibre inicial={rango} hoy={hoy} activo={modo === 'rango'} onAplicar={(r) => (setRango(r), setModo('rango'), cerrar())} />
            </>
          )}
        </Menu>
        <Menu icono={Globe} texto={!mercados ? 'Todos los países' : `${mercados.size} ${mercados.size === 1 ? 'país' : 'países'}`}>
          {() => (
            <>
              <Fila activa={!mercados} onClick={() => setMercados(null)}>
                Todos los países
              </Fila>
              {mercadosConDatos.map((m) => (
                <Fila
                  key={m}
                  activa={!mercados || mercados.has(m)}
                  onClick={() => {
                    const base = new Set(mercados ?? mercadosConDatos)
                    if (base.has(m)) base.delete(m)
                    else base.add(m)
                    setMercados(base.size === mercadosConDatos.length || base.size === 0 ? null : base)
                  }}
                >
                  {bandera(m)} {pais(m)}
                </Fila>
              ))}
            </>
          )}
        </Menu>
        <Menu icono={GitCompareArrows} texto={comparar ? 'Comparar año sobre año' : 'Sin comparar'}>
          {(cerrar) => (
            <>
              <Fila activa={!comparar} onClick={() => (setComparar(false), cerrar())}>
                No comparar
              </Fila>
              <Fila activa={comparar} onClick={() => (setComparar(true), cerrar())}>
                Comparar año sobre año
              </Fila>
            </>
          )}
        </Menu>
        <Menu icono={Settings2} texto="Métricas">
          {() => (
            <>
              <div className="flex flex-col gap-1 px-1 pb-2">
                {VISTAS.map((v) => {
                  const igual = v.metricas.length === metricas.length && v.metricas.every((x) => metricas.includes(x))
                  return (
                    <button key={v.id} type="button" onClick={() => setMetricas(v.metricas)} className="rounded-[8px] border px-3 py-[6px] text-left text-[12.5px] transition-colors" style={igual ? { borderColor: '#F26212', background: 'color-mix(in srgb, #F26212 14%, transparent)', color: 'var(--ls-t1)' } : { borderColor: 'var(--ls-linea)', color: 'var(--ls-t2)' }}>
                      {v.texto}
                    </button>
                  )
                })}
              </div>
              <div className="max-h-[320px] overflow-y-auto border-t border-[var(--ls-linea)] pt-1">
                {METRICAS.map((m) => {
                  const on = metricas.includes(m.id)
                  return (
                    <button key={m.id} type="button" onClick={() => setMetricas((xs) => (on ? xs.filter((x) => x !== m.id) : [...xs, m.id]))} className="flex w-full items-center gap-2 rounded-[8px] px-3 py-[7px] text-left text-[12.5px] hover:bg-[var(--ls-sup2)]">
                      <span className="flex h-[15px] w-[15px] items-center justify-center rounded-[4px] border" style={on ? { background: m.color, borderColor: m.color } : { borderColor: 'var(--ls-linea)' }}>
                        {on && <Check className="h-[11px] w-[11px] text-[#141414]" strokeWidth={3} />}
                      </span>
                      <span className={on ? 'text-[var(--ls-t1)]' : 'text-[var(--ls-t3)]'}>{m.texto}</span>
                      <span className="ml-auto text-[10.5px] text-[var(--ls-t4)]">{m.unidad === 'euros' ? '€' : m.unidad === 'porcentaje' ? '%' : 'nº'}</span>
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </Menu>
        {cargando && <Loader2 className="h-[14px] w-[14px] animate-spin text-[var(--ls-t4)]" />}
        <button type="button" onClick={exportar} className="ml-auto inline-flex h-9 items-center gap-2 rounded-[11px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 text-[12.5px] text-[var(--ls-t2)] hover:text-[var(--ls-t1)]">
          <Download className="h-[14px] w-[14px]" /> Exportar
        </button>
      </div>
      {error && <p className="text-[12.5px] text-[var(--ls-e-rojo)]">{error}</p>}

      {/* La gráfica y el desglose */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="rounded-[20px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            {activas.map((m) => (
              <span key={m.id} className="inline-flex items-center gap-[6px] text-[12px] text-[var(--ls-t2)]">
                {m.forma === 'barra' ? <span className="h-[10px] w-[10px] rounded-[3px]" style={{ background: m.color }} /> : <span className="h-[10px] w-[10px] rounded-full border-2" style={{ borderColor: m.color }} />}
                {m.texto}
              </span>
            ))}
            {comparar && (
              <span className="inline-flex items-center gap-[6px] text-[12px] text-[var(--ls-t3)]">
                <span className="h-[10px] w-[10px] rounded-[3px]" style={{ background: 'repeating-linear-gradient(135deg, var(--ls-t3) 0 2px, transparent 2px 4px)' }} />
                Año anterior
              </span>
            )}
            <span className="ml-auto text-[11.5px] text-[var(--ls-t4)]">Pulsa una barra para ver su desglose</span>
          </div>
          <ResponsiveContainer width="100%" height={380}>
            <ComposedChart data={datosGrafica} margin={{ top: 8, right: 4, bottom: 4, left: 0 }} barGap={1} barCategoryGap="12%" onClick={(e: { activeLabel?: string; activePayload?: Array<{ payload: { clave: string } }> } | null) => { const clave = e?.activePayload?.[0]?.payload?.clave; if (clave) setElegida((x) => (x === clave ? null : clave)) }}>
              <defs>
                {activas.map((m) => (
                  <pattern key={m.id} id={`rayado-${m.id}`} patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)">
                    <rect width="5" height="5" fill={m.color} fillOpacity={0.12} />
                    <line x1="0" y1="0" x2="0" y2="5" stroke={m.color} strokeWidth="2.2" strokeOpacity={0.55} />
                  </pattern>
                ))}
              </defs>
              <CartesianGrid stroke="var(--ls-linea)" strokeDasharray="2 6" vertical={false} />
              <XAxis dataKey="etiqueta" tick={{ fontSize: 11, fill: 'var(--ls-t4)' }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={10} dy={6} />
              <YAxis yAxisId="e" tick={{ fontSize: 11, fill: 'var(--ls-t4)' }} axisLine={false} tickLine={false} width={54} tickFormatter={(v: number) => `${Math.abs(v) >= 1000 ? `${(v / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })}k` : Math.round(v)} €`} />
              {hayNumero && <YAxis yAxisId="n" orientation="right" tick={{ fontSize: 11, fill: 'var(--ls-t4)' }} axisLine={false} tickLine={false} width={36} allowDecimals={false} />}
              {hayPct && <YAxis yAxisId="p" orientation="right" hide={hayNumero} tick={{ fontSize: 11, fill: 'var(--ls-t4)' }} axisLine={false} tickLine={false} width={42} tickFormatter={(v: number) => `${Math.round(v * 100)} %`} />}
              <Tooltip content={<Burbuja metricas={activas} comparar={comparar} formato={formato} />} cursor={{ fill: 'color-mix(in srgb, var(--ls-t1) 5%, transparent)', radius: 8 } as never} />
              {activas
                .filter((m) => m.forma === 'barra')
                .flatMap((m) => [
                  comparar ? <Bar key={`${m.id}_ant`} yAxisId="e" dataKey={`${m.id}_ant`} name={`${m.texto} (año anterior)`} fill={`url(#rayado-${m.id})`} radius={[5, 5, 5, 5]} maxBarSize={30} animationDuration={700} /> : null,
                  <Bar key={m.id} yAxisId="e" dataKey={m.id} name={m.texto} fill={m.color} radius={[5, 5, 5, 5]} maxBarSize={30} animationDuration={800} fillOpacity={0.92} />,
                ])}
              {activas
                .filter((m) => m.forma === 'linea')
                .flatMap((m) => [
                  comparar ? <Line key={`${m.id}_ant`} yAxisId={m.unidad === 'numero' ? 'n' : 'p'} type="monotone" dataKey={`${m.id}_ant`} name={`${m.texto} (año anterior)`} stroke={m.color} strokeOpacity={0.45} strokeDasharray="4 4" strokeWidth={1.5} dot={false} animationDuration={900} /> : null,
                  <Line key={m.id} yAxisId={m.unidad === 'numero' ? 'n' : 'p'} type="monotone" dataKey={m.id} name={m.texto} stroke={m.color} strokeWidth={2.2} dot={{ r: 3.5, fill: 'var(--ls-sup)', strokeWidth: 2 }} activeDot={{ r: 5 }} animationDuration={1000} />,
                ])}
            </ComposedChart>
          </ResponsiveContainer>
          {/* Las cubetas, para elegir también sin apuntar a la barra */}
          <div className="mt-2 flex gap-1 overflow-x-auto pb-1 [scrollbar-width:thin]">
            {porCubeta.map(({ c, t }) => (
              <button key={c.clave} type="button" onClick={() => setElegida((x) => (x === c.clave ? null : c.clave))} className="min-w-[58px] shrink-0 rounded-[9px] px-2 py-[5px] text-center transition-colors" style={elegida === c.clave ? { background: 'color-mix(in srgb, #F26212 16%, transparent)', color: 'var(--ls-t1)' } : { color: 'var(--ls-t4)' }}>
                <div className="text-[11px] font-medium">{c.etiqueta}{c.sub && modo !== 'dias' ? ` ${c.sub.slice(2)}` : ''}</div>
                <div className="text-[10.5px] tabular-nums">{euros(t.ventas, 0)}</div>
              </button>
            ))}
          </div>
        </section>

        <aside className="overflow-hidden rounded-[20px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
          <div className="flex border-b border-[var(--ls-linea)] px-2 pt-2">
            {cubetaElegida && (
              <PestanaLado activa onClick={() => undefined}>
                {cubetaElegida.c.desde === cubetaElegida.c.hasta ? fechaCorta(cubetaElegida.c.desde) : `${fechaCorta(cubetaElegida.c.desde).slice(0, 5)} – ${fechaCorta(cubetaElegida.c.hasta).slice(0, 5)}`}
              </PestanaLado>
            )}
            <PestanaLado activa={!cubetaElegida} onClick={() => setElegida(null)}>
              {modo === 'rango' ? 'Todo el rango' : MODOS.find((m) => m.id === modo)?.texto.split(',')[0]}
            </PestanaLado>
          </div>
          <div className="max-h-[560px] overflow-y-auto">
            <Desglose t={tElegida} />
          </div>
        </aside>
      </div>

      {/* Productos y pedidos de lo elegido */}
      <section className="overflow-hidden rounded-[20px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
        <div className="flex flex-wrap items-center gap-3 border-b border-[var(--ls-linea)] px-5 py-4">
          <div className="mr-2">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--ls-t4)]">Detalle</div>
            <div className="mt-1 text-[15px] font-semibold text-[var(--ls-t1)]">
              {cubetaElegida ? `${cubetaElegida.c.etiqueta}${cubetaElegida.c.sub ? ` ${cubetaElegida.c.sub}` : ''}` : modo === 'rango' ? `${fechaCorta(rango.desde)} – ${fechaCorta(rango.hasta)}` : MODOS.find((m) => m.id === modo)?.texto.split(',')[0]}
            </div>
          </div>
          <Segmentado etiqueta="Vista" tamano="sm" valor={pestana} onCambio={setPestana} opciones={[{ id: 'productos', texto: 'Productos' }, { id: 'pedidos', texto: 'Pedidos' }]} />
          {pestana === 'productos' && (
            <Segmentado etiqueta="Agrupar por" tamano="sm" valor={agrupar} onCambio={setAgrupar} opciones={[{ id: 'sku', texto: 'SKU' }, { id: 'asin', texto: 'ASIN' }, { id: 'mercado', texto: 'País' }]} />
          )}
          <span className="ml-auto" />
          <Buscador valor={buscar} onCambio={setBuscar} />
        </div>
        {pestana === 'productos' ? (
          <TablaProductos filas={filasElegidas} ivaPct={iva} costes={costes} titulos={titulos} buscar={buscar} agrupar={agrupar} onAbrir={setProducto} />
        ) : lineas == null ? (
          <p className="flex items-center justify-center gap-2 py-10 text-[12.5px] text-[var(--ls-t4)]">
            <Loader2 className="h-[14px] w-[14px] animate-spin" /> Cargando los pedidos…
          </p>
        ) : (
          <TablaPedidos lineas={lineas.filter((l) => (!mercados || mercados.has(l.mkt)) && (!skus || skus.has(l.sku)))} titulos={titulos} ivaPct={iva} costes={costes} buscar={buscar} />
        )}
      </section>

      <PanelLateral abierto={producto != null} onCambio={(a) => !a && setProducto(null)} titulo={producto?.titulo ?? ''} descripcion={producto?.sub ?? ''} acento="marca" ancho={460}>
        {producto && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <span className="rounded-[12px] bg-white p-[3px] ring-1 ring-[var(--ls-linea)]">
                <ImagenDeProducto asin={producto.asin} mkt={producto.mkt} lado={72} redondeo={9} />
              </span>
              <div className="text-[12px] text-[var(--ls-t3)]">
                {bandera(producto.mkt)} {pais(producto.mkt)}
                <div className="text-[var(--ls-t4)]">{fechaCorta(rangoDetalle.desde)} – {fechaCorta(rangoDetalle.hasta)}</div>
              </div>
            </div>
            <div className="-mx-1 overflow-hidden rounded-[14px] border border-[var(--ls-linea)]">
              <Desglose t={totalizar(producto.filas, iva, costes)} />
            </div>
          </div>
        )}
      </PanelLateral>
    </div>
  )
}

function Burbuja({ active, payload, label, metricas, comparar, formato }: { active?: boolean; payload?: Array<{ payload: Record<string, number | null> }>; label?: string; metricas: Metrica[]; comparar: boolean; formato: (m: Metrica, v: number | null) => string }) {
  if (!active || !payload?.length) return null
  const fila = payload[0].payload
  return (
    <div className="min-w-[230px] rounded-[14px] border border-[var(--ls-linea)] bg-[color-mix(in_srgb,var(--ls-sup)_95%,transparent)] px-4 py-3 shadow-[var(--ls-sombra-3)] backdrop-blur-md">
      <div className="mb-2 text-[12px] font-semibold text-[var(--ls-t1)]">{label}</div>
      {metricas.map((m) => (
        <div key={m.id} className="flex items-center gap-2 py-[3px] text-[12.5px]">
          {m.forma === 'barra' ? <span className="h-[9px] w-[9px] rounded-[3px]" style={{ background: m.color }} /> : <span className="h-[9px] w-[9px] rounded-full border-2" style={{ borderColor: m.color }} />}
          <span className="text-[var(--ls-t3)]">{m.texto}</span>
          <span className="ml-auto font-semibold tabular-nums text-[var(--ls-t1)]">{formato(m, fila[m.id] ?? null)}</span>
          {comparar && <span className="w-[72px] text-right text-[11px] tabular-nums text-[var(--ls-t4)]">{formato(m, fila[`${m.id}_ant`] ?? null)}</span>}
        </div>
      ))}
      {comparar && <div className="mt-1 text-right text-[10.5px] text-[var(--ls-t4)]">gris: el año anterior</div>}
    </div>
  )
}

function PestanaLado({ activa, onClick, children }: { activa: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="relative px-3 pb-[10px] pt-1 text-[12.5px] font-medium transition-colors" style={{ color: activa ? 'var(--ls-t1)' : 'var(--ls-t4)' }}>
      {children}
      {activa && <motion.span layoutId="pestana-lado" className="absolute inset-x-2 bottom-0 h-[2px] rounded-full" style={{ background: 'linear-gradient(90deg, #F26212, #FF8A3D)' }} />}
    </button>
  )
}

export function Menu({ icono: Icono, texto, children }: { icono: typeof Calendar; texto: string; children: (cerrar: () => void) => React.ReactNode }) {
  const [abierto, setAbierto] = useState(false)
  const caja = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!abierto) return
    const fuera = (e: MouseEvent) => !caja.current?.contains(e.target as Node) && setAbierto(false)
    document.addEventListener('mousedown', fuera)
    return () => document.removeEventListener('mousedown', fuera)
  }, [abierto])
  return (
    <div ref={caja} className="relative">
      <button type="button" onClick={() => setAbierto((x) => !x)} className="inline-flex h-9 items-center gap-2 rounded-[11px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 text-[12.5px] text-[var(--ls-t2)] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-colors hover:border-[color-mix(in_srgb,var(--ls-t1)_18%,var(--ls-linea))] hover:text-[var(--ls-t1)]" aria-expanded={abierto}>
        <Icono className="h-[14px] w-[14px] text-[var(--ls-t4)]" />
        {texto}
        <ChevronDown className={`h-[13px] w-[13px] text-[var(--ls-t4)] transition-transform ${abierto ? 'rotate-180' : ''}`} />
      </button>
      {abierto && (
        <motion.div initial={{ opacity: 0, y: -4, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.16 }} className="absolute left-0 top-[42px] z-30 min-w-[280px] rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-1 shadow-[var(--ls-sombra-3)]">
          {children(() => setAbierto(false))}
        </motion.div>
      )}
    </div>
  )
}

export function Fila({ activa, onClick, children }: { activa: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-2 rounded-[8px] px-3 py-2 text-left text-[12.5px] text-[var(--ls-t1)] hover:bg-[var(--ls-sup2)]">
      <span className="w-[14px]">{activa && <Check className="h-[13px] w-[13px] text-[var(--ls-acc)]" />}</span>
      {children}
    </button>
  )
}

export function RangoLibre({ inicial, hoy, activo, onAplicar }: { inicial: { desde: string; hasta: string }; hoy: string; activo: boolean; onAplicar: (r: { desde: string; hasta: string }) => void }) {
  const [desde, setDesde] = useState(inicial.desde)
  const [hasta, setHasta] = useState(inicial.hasta)
  const valido = desde && hasta && desde <= hasta && hasta <= hoy
  const campo = 'h-8 w-full rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2 text-[12.5px] text-[var(--ls-t1)] outline-none [color-scheme:dark]'
  return (
    <div className="mt-1 border-t border-[var(--ls-linea)] px-3 pb-2 pt-3">
      <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-[var(--ls-t2)]">
        <span className="w-[14px]">{activo && <Check className="h-[13px] w-[13px] text-[var(--ls-acc)]" />}</span>
        Rango personalizado
        <span className="text-[11px] font-normal text-[var(--ls-t4)]">(por día, semana o mes según lo largo)</span>
      </div>
      <div className="grid grid-cols-2 gap-2 pl-[22px]">
        <label className="text-[10.5px] uppercase tracking-[0.08em] text-[var(--ls-t4)]">
          Desde
          <input type="date" value={desde} max={hoy} onChange={(e) => setDesde(e.target.value)} className={campo} />
        </label>
        <label className="text-[10.5px] uppercase tracking-[0.08em] text-[var(--ls-t4)]">
          Hasta
          <input type="date" value={hasta} max={hoy} onChange={(e) => setHasta(e.target.value)} className={campo} />
        </label>
      </div>
      <div className="mt-2 flex justify-end">
        <button type="button" disabled={!valido} onClick={() => onAplicar({ desde, hasta })} className="h-8 rounded-[8px] px-3 text-[12px] font-semibold text-[#141414] disabled:opacity-40" style={{ background: 'linear-gradient(135deg, #F26212, #FF8A3D)' }}>
          Ver ese rango
        </button>
      </div>
    </div>
  )
}
