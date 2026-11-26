'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowDownRight, ArrowUp, ArrowUpRight, ChevronDown, ChevronRight, Search } from 'lucide-react'
import { Area, Cell, ComposedChart, Line, Pie, PieChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ImagenDeProducto } from '@/components/productos/ImagenDeProducto'
import { marketplaceById } from '@/lib/types/amazon'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { totalizar, variacion, type FilaPanel, type Periodo, type Totales } from '@/lib/ventas/panel'
import type { LineaDelPanel } from '@/lib/ventas/panel-servidor'

/**
 * VENTAS · LAS PIEZAS DEL PANEL: formatos, banderas, el desglose de una baldosa, la gráfica, el reparto del dinero, la tabla de productos, la de pedidos y la
 * cuenta de resultados por periodo. Todo con lo que ya está en el navegador (lib/ventas/panel.ts).
 */

export const NARANJA = '#F26212'
export const NARANJA2 = '#FF8A3D'
export const VERDE = COLOR_ESTADO.verde
export const ROJO = COLOR_ESTADO.rojo

export const euros = (n: number | null | undefined, dec = 2) => (n == null || !Number.isFinite(n) ? '—' : (Math.abs(n) < 0.005 ? 0 : n).toLocaleString('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: dec, maximumFractionDigits: dec }))
export const entero = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : Math.round(n).toLocaleString('es-ES'))
export const pct = (n: number | null | undefined, dec = 1) => (n == null || !Number.isFinite(n) ? '—' : `${(n * 100).toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec })} %`)
export const fechaCorta = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })

export function bandera(mkt: string): string {
  const cc = marketplaceById(mkt)?.countryCode ?? ''
  const codigo = cc === 'UK' ? 'GB' : cc
  if (codigo.length !== 2) return '🏳️'
  return String.fromCodePoint(...[...codigo.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
}
export const pais = (mkt: string) => marketplaceById(mkt)?.label ?? mkt
export const dominio = (mkt: string) => {
  const cc = marketplaceById(mkt)?.countryCode ?? ''
  const d: Record<string, string> = { ES: 'es', FR: 'fr', IT: 'it', DE: 'de', UK: 'co.uk', GB: 'co.uk', NL: 'nl', SE: 'se', PL: 'pl', BE: 'com.be', IE: 'ie', US: 'com', MX: 'com.mx', CA: 'ca', TR: 'com.tr' }
  return `Amazon.${d[cc] ?? cc.toLowerCase()}`
}

/** La variación: flecha y porcentaje, sin caja. Verde si mejora, rojo si empeora (para gastos y reembolsos, al revés). Nada si no hay con qué comparar */
export function Chip({ actual, anterior, inverso = false }: { actual: number; anterior: number | null | undefined; inverso?: boolean }) {
  const v = variacion(actual, anterior)
  if (v == null || Math.abs(v) < 0.005) return null
  const bueno = inverso ? v <= 0 : v >= 0
  const color = Math.abs(v) < 0.005 ? 'var(--ls-t3)' : bueno ? VERDE : ROJO
  const Flecha = v >= 0 ? ArrowUpRight : ArrowDownRight
  return (
    <span className="inline-flex items-center gap-[1px] text-[11.5px] font-medium tabular-nums" style={{ color }}>
      <Flecha className="h-[13px] w-[13px]" strokeWidth={2.4} />
      {Math.abs(v * 100).toLocaleString('es-ES', { maximumFractionDigits: 1, minimumFractionDigits: Math.abs(v) < 0.1 ? 1 : 0 })} %
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* El desglose de una baldosa (como el «Más» de Sellerboard)           */
/* ------------------------------------------------------------------ */

type FilaDesglose = { texto: string; valor: string; fuerte?: boolean; signo?: 'mas' | 'menos'; hijos?: Array<{ texto: string; valor: string }>; nota?: string; gris?: boolean }

export function filasDeDesglose(t: Totales): FilaDesglose[] {
  const organico = t.ventas - t.ventasPpc
  return [
    { texto: 'Ventas', valor: euros(t.ventas), fuerte: true, hijos: [{ texto: 'Orgánico', valor: euros(organico) }, { texto: 'Publicidad (mismo día)', valor: euros(t.ventasPpc) }] },
    { texto: 'Unidades', valor: entero(t.unidades), hijos: [{ texto: 'Orgánico', valor: entero(t.unidades - t.unidadesPpc) }, { texto: 'Publicidad (mismo día)', valor: entero(t.unidadesPpc) }] },
    { texto: 'Pedidos', valor: entero(t.pedidos) },
    { texto: 'Reembolsos', valor: entero(t.reembolsos) },
    { texto: 'Promociones', valor: euros(-t.promo), signo: 'menos' },
    { texto: 'Costes publicitarios', valor: euros(-t.publicidad), signo: 'menos' },
    { texto: 'Coste de los reembolsos', valor: euros(t.costeReembolso), signo: 'menos', hijos: [{ texto: 'Devuelto al comprador', valor: euros(-t.reembolsado) }, { texto: 'Comisiones que devuelve Amazon', valor: euros(t.costeReembolso + t.reembolsado) }] },
    {
      texto: 'Tarifas de Amazon',
      valor: euros(t.tarifas),
      signo: 'menos',
      hijos: [
        { texto: 'Comisión de venta', valor: euros(t.referral) },
        { texto: 'Logística de Amazon (FBA)', valor: euros(t.fba) },
        { texto: 'Otras (envío retenido, almacenamiento, suscripción…)', valor: euros(t.otras) },
      ],
      nota: t.estimadas ? `${euros(t.estimadas)} son estimadas (pedidos que Amazon aún no ha cobrado)` : undefined,
    },
    { texto: 'Coste de los productos', valor: euros(-t.cogs), signo: 'menos', nota: t.unidadesSinCoste ? `${entero(t.unidadesSinCoste)} unidades sin coste puesto` : undefined },
    { texto: 'IVA', valor: euros(-t.iva), signo: 'menos' },
    { texto: 'Ajustes y reembolsos de Amazon', valor: euros(t.ajustes), signo: 'mas' },
    { texto: 'Ganancia neta', valor: euros(t.neto), fuerte: true },
    { texto: 'Margen', valor: pct(t.margen), gris: true },
    { texto: 'ROI', valor: t.roi == null ? '—' : pct(t.roi), gris: true },
    { texto: 'TACOS (publicidad / ventas)', valor: pct(t.tacos), gris: true },
    { texto: 'Tasa de reembolso', valor: pct(t.tasaReembolso), gris: true },
    { texto: 'Precio medio de venta', valor: euros(t.precioMedio), gris: true },
  ]
}

export function Desglose({ t }: { t: Totales }) {
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set())
  return (
    <div className="flex flex-col">
      {filasDeDesglose(t).map((f) => {
        const abierto = abiertos.has(f.texto)
        return (
          <div key={f.texto} className={`border-b border-[var(--ls-linea)] ${f.gris ? 'bg-[var(--ls-sup2)]' : ''}`}>
            <button
              type="button"
              disabled={!f.hijos}
              onClick={() => setAbiertos((s) => {
                const n = new Set(s)
                if (n.has(f.texto)) n.delete(f.texto)
                else n.add(f.texto)
                return n
              })}
              className="flex w-full items-center gap-2 px-3 py-[9px] text-left disabled:cursor-default"
            >
              <span className="w-[14px] text-[var(--ls-t4)]">{f.hijos ? abierto ? <ChevronDown className="h-[13px] w-[13px]" /> : <ChevronRight className="h-[13px] w-[13px]" /> : null}</span>
              <span className={`flex-1 text-[13px] ${f.fuerte ? 'font-semibold text-[var(--ls-t1)]' : 'text-[var(--ls-t2)]'}`}>{f.texto}</span>
              <span className={`tabular-nums text-[13px] ${f.fuerte ? 'font-semibold text-[var(--ls-t1)]' : 'text-[var(--ls-t2)]'}`} style={f.texto === 'Ganancia neta' ? { color: t.neto >= 0 ? VERDE : ROJO } : undefined}>
                {f.valor}
              </span>
            </button>
            {f.nota && <p className="-mt-1 pb-2 pl-[34px] pr-3 text-[11px] text-[var(--ls-t4)]">{f.nota}</p>}
            {abierto &&
              f.hijos?.map((h) => (
                <div key={h.texto} className="flex items-center gap-2 py-[6px] pl-[34px] pr-3 text-[12px] text-[var(--ls-t3)]">
                  <span className="flex-1">{h.texto}</span>
                  <span className="tabular-nums">{h.valor}</span>
                </div>
              ))}
          </div>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* La gráfica: ventas y ganancia por día                               */
/* ------------------------------------------------------------------ */

function Burbuja({ active, payload, label }: { active?: boolean; payload?: Array<{ dataKey: string; value: number; color: string; name: string }>; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="min-w-[170px] rounded-[12px] border border-[var(--ls-linea)] bg-[color-mix(in_srgb,var(--ls-sup)_94%,transparent)] px-3 py-2 shadow-[var(--ls-sombra-3)] backdrop-blur-md">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--ls-t4)]">{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2 py-[2px] text-[12.5px]">
          <span className="h-[7px] w-[7px] rounded-full" style={{ background: p.color }} />
          <span className="text-[var(--ls-t3)]">{p.name}</span>
          <span className="ml-auto font-semibold tabular-nums text-[var(--ls-t1)]">{euros(p.value, 0)}</span>
        </div>
      ))}
    </div>
  )
}

/** Las líneas que se pueden encender y apagar en la gráfica de las baldosas */
export const SERIES_GRAFICA = [
  { id: 'ventas', texto: 'Ventas', color: '#FF8A3D' },
  { id: 'organico', texto: 'Orgánicas', color: '#FCD34D' },
  { id: 'ppc', texto: 'Por publicidad', color: '#60A5FA' },
  { id: 'neto', texto: 'Ganancia neta', color: '#4ADE80' },
  { id: 'publicidad', texto: 'Gasto en publicidad', color: '#a78bfa' },
] as const
export type SerieGrafica = (typeof SERIES_GRAFICA)[number]['id']

export function GraficaVentas({ filas, dias, ivaPct, costes, resaltado, series = new Set<SerieGrafica>(['ventas', 'neto', 'publicidad']) }: { filas: readonly FilaPanel[]; dias: string[]; ivaPct: number; costes: Record<string, number>; resaltado: { desde: string; hasta: string } | null; series?: ReadonlySet<SerieGrafica> }) {
  const datos = useMemo(() => {
    const porDia = new Map<string, FilaPanel[]>()
    for (const f of filas) porDia.set(f.dia, [...(porDia.get(f.dia) ?? []), f])
    return dias.map((d) => {
      const t = totalizar(porDia.get(d) ?? [], ivaPct, costes)
      return { dia: d, etiqueta: new Date(`${d}T00:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' }), ventas: t.ventas, organico: Math.max(0, t.ventas - t.ventasPpc), ppc: t.ventasPpc, neto: t.neto, publicidad: t.publicidad }
    })
  }, [filas, dias, ivaPct, costes])
  const vacio = datos.every((d) => d.ventas === 0 && d.neto === 0)
  const r = resaltado ? datos.filter((d) => d.dia >= resaltado.desde && d.dia <= resaltado.hasta) : []
  return (
    <div className="relative [&_.recharts-area-curve]:[filter:drop-shadow(0_3px_8px_rgba(0,0,0,0.35))] [&_.recharts-area-curve]:transition-all">
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={datos} margin={{ top: 12, right: 6, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="vg-ventas" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={NARANJA2} stopOpacity={0.38} />
              <stop offset="70%" stopColor={NARANJA} stopOpacity={0.06} />
              <stop offset="100%" stopColor={NARANJA} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="vg-org" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#FCD34D" stopOpacity={0.22} />
              <stop offset="100%" stopColor="#FCD34D" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="vg-ppc" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#60A5FA" stopOpacity={0.24} />
              <stop offset="100%" stopColor="#60A5FA" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="vg-neto" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={VERDE} stopOpacity={0.16} />
              <stop offset="100%" stopColor={VERDE} stopOpacity={0} />
            </linearGradient>
          </defs>
          {r.length > 0 && <ReferenceArea x1={r[0].etiqueta} x2={r[r.length - 1].etiqueta} fill="var(--ls-t1)" fillOpacity={0.035} stroke="none" ifOverflow="extendDomain" />}
          <XAxis dataKey="etiqueta" tick={{ fontSize: 11, fill: 'var(--ls-t4)' }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={28} dy={6} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--ls-t4)' }} axisLine={false} tickLine={false} width={48} tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })}k` : `${Math.round(v)}`)} />
          <Tooltip content={<Burbuja />} cursor={{ stroke: 'var(--ls-t4)', strokeWidth: 1, strokeDasharray: '3 3' }} />
          {series.has('ventas') && <Area type="monotone" dataKey="ventas" name="Ventas" stroke={NARANJA2} strokeWidth={2.2} fill="url(#vg-ventas)" dot={false} activeDot={{ r: 4, strokeWidth: 0, fill: NARANJA2 }} animationDuration={1000} />}
          {series.has('organico') && <Area type="monotone" dataKey="organico" name="Orgánicas" stroke="#FCD34D" strokeWidth={2} fill="url(#vg-org)" dot={false} activeDot={{ r: 4, strokeWidth: 0, fill: '#FCD34D' }} animationDuration={1000} />}
          {series.has('ppc') && <Area type="monotone" dataKey="ppc" name="Por publicidad" stroke="#60A5FA" strokeWidth={2} fill="url(#vg-ppc)" dot={false} activeDot={{ r: 4, strokeWidth: 0, fill: '#60A5FA' }} animationDuration={1000} />}
          {series.has('neto') && <Area type="monotone" dataKey="neto" name="Ganancia neta" stroke={VERDE} strokeWidth={2} fill="url(#vg-neto)" dot={false} activeDot={{ r: 4, strokeWidth: 0, fill: VERDE }} animationDuration={1200} />}
          {series.has('publicidad') && <Line type="monotone" dataKey="publicidad" name="Gasto en publicidad" stroke="#a78bfa" strokeWidth={1.4} strokeDasharray="3 4" dot={false} animationDuration={1200} />}
        </ComposedChart>
      </ResponsiveContainer>
      {vacio && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[12.5px] text-[var(--ls-t4)]">Aún no hay ventas en estos días</div>}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* A dónde va cada euro (anillo)                                       */
/* ------------------------------------------------------------------ */

export function RepartoDelDinero({ t }: { t: Totales }) {
  const partes = [
    { texto: 'Ganancia', valor: Math.max(0, t.neto), color: VERDE },
    { texto: 'Tarifas', valor: -t.tarifas, color: NARANJA },
    { texto: 'IVA', valor: t.iva, color: '#8B8580' },
    { texto: 'Publicidad', valor: t.publicidad, color: '#a78bfa' },
    { texto: 'Productos', valor: t.cogs, color: '#60A5FA' },
    { texto: 'Reembolsos', valor: -t.costeReembolso, color: ROJO },
    { texto: 'Promos', valor: t.promo, color: COLOR_ESTADO.ambar },
  ].filter((p) => p.valor > 0.005)
  const total = partes.reduce((s2, p) => s2 + p.valor, 0)
  return (
    <div className="flex items-center gap-4">
      <div className="relative h-[140px] w-[140px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie style={{ filter: 'drop-shadow(0 6px 14px rgba(0,0,0,0.35))' }} data={total ? partes : [{ texto: '', valor: 1, color: 'var(--ls-sup2)' }]} dataKey="valor" innerRadius={50} outerRadius={68} paddingAngle={total ? 2.5 : 0} cornerRadius={5} stroke="none" startAngle={90} endAngle={-270} animationDuration={900}>
              {(total ? partes : [{ color: 'var(--ls-sup2)' }]).map((p, i) => (
                <Cell key={i} fill={p.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[22px] font-semibold tracking-[-0.02em] tabular-nums" style={{ color: t.neto >= 0 ? 'var(--ls-t1)' : ROJO }}>
            {t.margen == null ? '—' : pct(t.margen, 0)}
          </span>
          <span className="text-[10.5px] uppercase tracking-[0.1em] text-[var(--ls-t4)]">margen</span>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-[7px]">
        {partes.length === 0 && <span className="text-[12px] text-[var(--ls-t4)]">Sin ventas en este periodo</span>}
        {partes.map((p) => (
          <div key={p.texto} className="flex items-center gap-2 text-[12.5px]">
            <span className="h-[8px] w-[8px] shrink-0 rounded-full" style={{ background: p.color }} />
            <span className="truncate text-[var(--ls-t3)]">{p.texto}</span>
            <span className="ml-auto whitespace-nowrap tabular-nums text-[var(--ls-t1)]">{euros(p.valor, 0)}</span>
            <span className="w-[36px] shrink-0 whitespace-nowrap text-right tabular-nums text-[var(--ls-t4)]">{pct(total ? p.valor / total : 0, 0)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Productos                                                           */
/* ------------------------------------------------------------------ */

type ColProducto = 'unidades' | 'reembolsos' | 'ventas' | 'publicidad' | 'tarifas' | 'neto' | 'margen' | 'roi' | 'precio'

export type Agrupar = 'sku' | 'asin' | 'mercado'

export function TablaProductos({ filas, ivaPct, costes, titulos, buscar, agrupar = 'sku', onAbrir }: { filas: readonly FilaPanel[]; ivaPct: number; costes: Record<string, number>; titulos: Record<string, { titulo: string | null; asin: string | null }>; buscar: string; agrupar?: Agrupar; onAbrir?: (p: { titulo: string; sub: string; asin: string | null; mkt: string; filas: FilaPanel[] }) => void }) {
  const [orden, setOrden] = useState<{ col: ColProducto; desc: boolean }>({ col: 'ventas', desc: true })
  const productos = useMemo(() => {
    const por = new Map<string, FilaPanel[]>()
    for (const f of filas) {
      if (!f.sku && agrupar !== 'mercado') continue
      const k = agrupar === 'mercado' ? f.mkt : agrupar === 'asin' ? (f.asin ?? titulos[f.sku]?.asin ?? f.sku) : `${f.mkt}|${f.sku}`
      por.set(k, [...(por.get(k) ?? []), f])
    }
    const q = buscar.trim().toLowerCase()
    return [...por.entries()]
      .map(([k, fs]) => {
        const conSku = fs.find((f) => f.sku) ?? fs[0]
        const mkt = conSku.mkt
        const sku = agrupar === 'mercado' ? '' : conSku.sku
        const asin = agrupar === 'mercado' ? null : (fs.find((f) => f.asin)?.asin ?? titulos[sku]?.asin ?? null)
        const titulo = agrupar === 'mercado' ? `${dominio(mkt)}` : (titulos[sku]?.titulo ?? null)
        const skus = new Set(fs.map((f) => f.sku).filter(Boolean)).size
        return { k, mkt, sku, asin, titulo, skus, filas: fs, t: totalizar(fs, ivaPct, costes), coste: costes[sku] ?? null }
      })
      .filter((p) => !q || p.sku.toLowerCase().includes(q) || (p.asin ?? '').toLowerCase().includes(q) || (p.titulo ?? '').toLowerCase().includes(q))
  }, [filas, ivaPct, costes, titulos, buscar, agrupar])
  const valor = (p: (typeof productos)[number], c: ColProducto) => (c === 'tarifas' ? p.t.tarifas : c === 'margen' ? (p.t.margen ?? -9) : c === 'roi' ? (p.t.roi ?? -9) : c === 'precio' ? (p.t.precioMedio ?? 0) : c === 'neto' ? p.t.neto : (p.t[c] as number))
  const lista = [...productos].sort((a, b) => (orden.desc ? valor(b, orden.col) - valor(a, orden.col) : valor(a, orden.col) - valor(b, orden.col)))
  const maxVentas = Math.max(1, ...lista.map((p) => p.t.ventas))
  const Cab = ({ col, texto }: { col: ColProducto; texto: string }) => (
    <th className="whitespace-nowrap px-2 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-[var(--ls-t4)]">
      <button type="button" onClick={() => setOrden((o) => ({ col, desc: o.col === col ? !o.desc : true }))} className="inline-flex items-center gap-1 hover:text-[var(--ls-t1)]">
        {texto}
        {orden.col === col && (orden.desc ? <ArrowDown className="h-[11px] w-[11px]" /> : <ArrowUp className="h-[11px] w-[11px]" />)}
      </button>
    </th>
  )
  if (lista.length === 0) return <p className="px-4 py-8 text-center text-[13px] text-[var(--ls-t4)]">Ningún producto con movimiento en este periodo.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] text-[12.5px]">
        <thead className="border-b border-[var(--ls-linea)]">
          <tr>
            <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--ls-t4)]">Producto</th>
            <Cab col="unidades" texto="Unidades" />
            <Cab col="reembolsos" texto="Reemb." />
            <Cab col="ventas" texto="Ventas" />
            <Cab col="publicidad" texto="Publicidad" />
            <Cab col="tarifas" texto="Tarifas" />
            <Cab col="neto" texto="Ganancia neta" />
            <Cab col="margen" texto="Margen" />
            <Cab col="roi" texto="ROI" />
            <Cab col="precio" texto="Precio medio" />
          </tr>
        </thead>
        <tbody>
          {lista.map((p, i) => (
            <tr key={p.k} onClick={() => onAbrir?.({ titulo: p.titulo ?? p.sku, sub: agrupar === 'mercado' ? `${p.skus} productos` : `${p.asin ?? '—'} · SKU ${p.sku}${agrupar === 'asin' && p.skus > 1 ? ` y ${p.skus - 1} más` : ''}`, asin: p.asin, mkt: p.mkt, filas: p.filas })} className={`group border-b ${onAbrir ? 'cursor-pointer' : ''} border-[var(--ls-linea)] transition-colors hover:bg-[color-mix(in_srgb,var(--ls-sup2)_70%,transparent)]`} style={{ animation: `ventas-entra 420ms ${Math.min(i, 20) * 25}ms both cubic-bezier(.2,.8,.2,1)` }}>
              <td className="px-3 py-[9px]">
                <div className="flex items-center gap-3">
                  {agrupar === 'mercado' ? (
                    <span className="flex h-[48px] w-[48px] shrink-0 items-center justify-center rounded-[12px] bg-[var(--ls-sup2)] text-[24px]">{bandera(p.mkt)}</span>
                  ) : (
                    <span className="shrink-0 rounded-[9px] bg-white p-[2px] ring-1 ring-[var(--ls-linea)] transition-transform group-hover:scale-[1.06]">
                      <ImagenDeProducto asin={p.asin} mkt={p.mkt} lado={44} redondeo={7} titulo={p.titulo ?? p.sku} />
                    </span>
                  )}
                  <div className="min-w-0 max-w-[380px]">
                    <div className="flex items-center gap-2 text-[11px] text-[var(--ls-t4)]">
                      {agrupar === 'mercado' ? (
                        <span>{pais(p.mkt)} · {p.skus} productos</span>
                      ) : (
                        <>
                          <span title={pais(p.mkt)}>{bandera(p.mkt)}</span>
                          <span className="tabular-nums">{p.asin ?? '—'}</span>
                          <span>·</span>
                          <span className="truncate">SKU {p.sku}{agrupar === 'asin' && p.skus > 1 ? ` y ${p.skus - 1} más` : ''}</span>
                        </>
                      )}
                    </div>
                    <div className="truncate text-[12.5px] font-medium text-[var(--ls-t1)]" title={p.titulo ?? p.sku}>
                      {p.titulo ?? p.sku}
                    </div>
                    <div className="mt-[3px] h-[3px] w-full max-w-[220px] overflow-hidden rounded-full bg-[var(--ls-sup2)]">
                      <div className="h-full rounded-full" style={{ width: `${(p.t.ventas / maxVentas) * 100}%`, background: `linear-gradient(90deg, ${NARANJA}, ${NARANJA2})` }} />
                    </div>
                  </div>
                </div>
              </td>
              <td className="px-2 text-right tabular-nums text-[var(--ls-t1)]">{entero(p.t.unidades)}</td>
              <td className="px-2 text-right tabular-nums" style={{ color: p.t.reembolsos ? ROJO : 'var(--ls-t4)' }}>{entero(p.t.reembolsos)}</td>
              <td className="px-2 text-right font-semibold tabular-nums text-[var(--ls-t1)]">{euros(p.t.ventas)}</td>
              <td className="px-2 text-right tabular-nums text-[var(--ls-t3)]">{p.t.publicidad ? euros(-p.t.publicidad) : '—'}</td>
              <td className="px-2 text-right tabular-nums text-[var(--ls-t3)]">{euros(p.t.tarifas)}</td>
              <td className="px-2 text-right font-semibold tabular-nums" style={{ color: p.t.neto >= 0 ? VERDE : ROJO }}>{euros(p.t.neto)}</td>
              <td className="px-2 text-right tabular-nums text-[var(--ls-t2)]">{pct(p.t.margen, 0)}</td>
              <td className="whitespace-nowrap px-2 text-right tabular-nums text-[var(--ls-t2)]" title={p.coste == null ? 'Sin coste puesto' : undefined}>{p.t.roi == null ? <span className="text-[var(--ls-t4)]">sin coste</span> : pct(p.t.roi, 0)}</td>
              <td className="px-2 pr-3 text-right tabular-nums text-[var(--ls-t3)]">{euros(p.t.precioMedio)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Pedidos (las líneas)                                                */
/* ------------------------------------------------------------------ */

const ESTADO: Record<string, { texto: string; color: string }> = {
  pending: { texto: 'Pendiente', color: COLOR_ESTADO.ambar },
  unshipped: { texto: 'No enviado', color: COLOR_ESTADO.ambar },
  shipped: { texto: 'Enviado', color: VERDE },
  partiallyshipped: { texto: 'Enviado en parte', color: COLOR_ESTADO.azul },
}

export function TablaPedidos({ lineas, titulos, ivaPct, costes, buscar }: { lineas: readonly LineaDelPanel[]; titulos: Record<string, { titulo: string | null; asin: string | null }>; ivaPct: number; costes: Record<string, number>; buscar: string }) {
  const q = buscar.trim().toLowerCase()
  const lista = lineas.filter((l) => !q || l.pedido.toLowerCase().includes(q) || l.sku.toLowerCase().includes(q) || (titulos[l.sku]?.titulo ?? '').toLowerCase().includes(q))
  if (lista.length === 0) return <p className="px-4 py-8 text-center text-[13px] text-[var(--ls-t4)]">No hay pedidos en este periodo (el detalle de pedidos se guarda de los últimos 62 días).</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] text-[12.5px]">
        <thead className="border-b border-[var(--ls-linea)] text-[11px] uppercase tracking-wide text-[var(--ls-t4)]">
          <tr>
            <th className="px-3 py-2 text-left font-semibold">Pedido</th>
            <th className="px-2 py-2 text-left font-semibold">Producto</th>
            <th className="px-2 py-2 text-right font-semibold">Unidades</th>
            <th className="px-2 py-2 text-right font-semibold">Ventas</th>
            <th className="px-2 py-2 text-right font-semibold">Tarifas</th>
            <th className="px-2 py-2 text-right font-semibold">IVA</th>
            <th className="px-3 py-2 text-right font-semibold">Ganancia</th>
          </tr>
        </thead>
        <tbody>
          {lista.map((l, i) => {
            const ventas = l.ventas ?? 0
            const tarifas = l.tarifas ?? -0.15 * ventas
            const iva = Math.max(0, ventas - l.promo) * (ivaPct / (100 + ivaPct))
            const cogs = (costes[l.sku] ?? 0) * l.unidades
            const neto = ventas - l.promo + tarifas - iva - cogs
            const est = ESTADO[(l.estado ?? '').toLowerCase()] ?? { texto: l.estado ?? '—', color: 'var(--ls-t3)' }
            const t = titulos[l.sku]
            return (
              <tr key={`${l.pedido}|${l.sku}`} className="border-b border-[var(--ls-linea)] hover:bg-[color-mix(in_srgb,var(--ls-sup2)_70%,transparent)]" style={{ animation: `ventas-entra 420ms ${Math.min(i, 20) * 25}ms both cubic-bezier(.2,.8,.2,1)` }}>
                <td className="px-3 py-[9px] align-top">
                  <div className="font-medium tabular-nums text-[var(--ls-t1)]">{l.pedido}</div>
                  <div className="mt-[2px] flex items-center gap-2 text-[11px] text-[var(--ls-t4)]">
                    <span>{bandera(l.mkt)} {dominio(l.mkt)}</span>
                    <span>{new Date(l.fecha).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <span className="mt-1 inline-block rounded-[6px] px-[6px] py-[1px] text-[10.5px] font-semibold" style={{ color: est.color, background: `color-mix(in srgb, ${est.color} 14%, transparent)` }}>
                    {est.texto}
                  </span>
                </td>
                <td className="px-2 py-[9px]">
                  <div className="flex items-center gap-3">
                    <span className="shrink-0 rounded-[8px] bg-white p-[2px] ring-1 ring-[var(--ls-linea)]">
                      <ImagenDeProducto asin={l.asin ?? t?.asin ?? null} mkt={l.mkt} lado={38} redondeo={6} />
                    </span>
                    <div className="min-w-0 max-w-[380px]">
                      <div className="truncate text-[11px] text-[var(--ls-t4)]">SKU {l.sku}</div>
                      <div className="truncate text-[12.5px] text-[var(--ls-t1)]">{t?.titulo ?? l.sku}</div>
                    </div>
                  </div>
                </td>
                <td className="px-2 text-right tabular-nums">{l.unidades}</td>
                <td className="px-2 text-right font-semibold tabular-nums text-[var(--ls-t1)]">{l.ventas == null ? <span className="text-[var(--ls-t4)]">sin precio aún</span> : euros(ventas)}</td>
                <td className="px-2 text-right tabular-nums text-[var(--ls-t3)]" title={l.reales ? 'Lo que Amazon ha cobrado' : 'Estimada: Amazon aún no lo ha cobrado'}>
                  {euros(tarifas)}
                  {!l.reales && <span className="ml-1 text-[10px] text-[var(--ls-t4)]">est.</span>}
                </td>
                <td className="px-2 text-right tabular-nums text-[var(--ls-t3)]">{euros(-iva)}</td>
                <td className="px-3 text-right font-semibold tabular-nums" style={{ color: neto >= 0 ? VERDE : ROJO }}>{euros(neto)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Cuenta de resultados: un concepto por fila, un periodo por columna  */
/* ------------------------------------------------------------------ */

export function CuentaDeResultados({ periodos, totales }: { periodos: Periodo[]; totales: Totales[] }) {
  const filas: Array<{ texto: string; f: (t: Totales) => string; fuerte?: boolean; neto?: boolean }> = [
    { texto: 'Ventas', f: (t) => euros(t.ventas), fuerte: true },
    { texto: 'Unidades', f: (t) => entero(t.unidades) },
    { texto: 'Pedidos', f: (t) => entero(t.pedidos) },
    { texto: 'Reembolsos', f: (t) => entero(t.reembolsos) },
    { texto: 'Promociones', f: (t) => euros(-t.promo) },
    { texto: 'Publicidad', f: (t) => euros(-t.publicidad) },
    { texto: 'Coste de reembolsos', f: (t) => euros(t.costeReembolso) },
    { texto: 'Comisión de venta', f: (t) => euros(t.referral) },
    { texto: 'Logística de Amazon (FBA)', f: (t) => euros(t.fba) },
    { texto: 'Otras tarifas', f: (t) => euros(t.otras) },
    { texto: 'Coste de los productos', f: (t) => euros(-t.cogs) },
    { texto: 'IVA', f: (t) => euros(-t.iva) },
    { texto: 'Ajustes de Amazon', f: (t) => euros(t.ajustes) },
    { texto: 'Ganancia neta', f: (t) => euros(t.neto), fuerte: true, neto: true },
    { texto: 'Margen', f: (t) => pct(t.margen) },
    { texto: 'TACOS', f: (t) => pct(t.tacos) },
  ]
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-[12.5px]">
        <thead className="border-b border-[var(--ls-linea)]">
          <tr>
            <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--ls-t4)]">Concepto</th>
            {periodos.map((p) => (
              <th key={p.id} className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-[var(--ls-t4)]">
                {p.titulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((fila) => (
            <tr key={fila.texto} className={`border-b border-[var(--ls-linea)] ${fila.fuerte ? 'bg-[color-mix(in_srgb,var(--ls-sup2)_60%,transparent)]' : ''}`}>
              <td className={`px-3 py-[8px] ${fila.fuerte ? 'font-semibold text-[var(--ls-t1)]' : 'text-[var(--ls-t2)]'}`}>{fila.texto}</td>
              {totales.map((t, i) => (
                <td key={periodos[i].id} className={`px-3 text-right tabular-nums ${fila.fuerte ? 'font-semibold' : ''}`} style={fila.neto ? { color: t.neto >= 0 ? VERDE : ROJO } : { color: 'var(--ls-t1)' }}>
                  {fila.f(t)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Buscador({ valor, onCambio }: { valor: string; onCambio: (v: string) => void }) {
  return (
    <label className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-[14px] w-[14px] -translate-y-1/2 text-[var(--ls-t4)]" />
      <input value={valor} onChange={(e) => onCambio(e.target.value)} placeholder="SKU, ASIN, título o pedido" className="h-9 w-[240px] rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] pl-9 pr-3 text-[12.5px] text-[var(--ls-t1)] outline-none placeholder:text-[var(--ls-t4)] focus:border-[color-mix(in_srgb,var(--ls-acc)_55%,var(--ls-linea))]" />
    </label>
  )
}

/**
 * Un bloque que NO encoge de golpe al cambiar lo que tiene dentro (las pestañas Productos · Pedidos · Cuenta de resultados): si lo nuevo es más bajo o aún
 * está cargando, la página se acortaba y el navegador la subía. Guarda la altura de antes mientras cambia y la suelta poco a poco.
 */
export function AltoEstable({ clave, children }: { clave: string; children: ReactNode }) {
  const caja = useRef<HTMLDivElement>(null)
  const ultimo = useRef(0)
  const [minimo, setMinimo] = useState<number | undefined>(undefined)
  useLayoutEffect(() => {
    if (ultimo.current) setMinimo(ultimo.current)
    const t = setTimeout(() => setMinimo(undefined), 2500)
    return () => clearTimeout(t)
  }, [clave])
  useEffect(() => {
    const el = caja.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      ultimo.current = el.offsetHeight
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div ref={caja} style={{ minHeight: minimo }}>
      {children}
    </div>
  )
}
