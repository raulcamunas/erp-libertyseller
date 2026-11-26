'use client'

import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Search } from 'lucide-react'
import { Area, Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
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

/** La variación como chip: verde si mejora, rojo si empeora (para gastos, al revés) */
export function Chip({ actual, anterior, inverso = false }: { actual: number; anterior: number | null | undefined; inverso?: boolean }) {
  const v = variacion(actual, anterior)
  if (v == null) return <span className="rounded-[6px] bg-[var(--ls-sup2)] px-[6px] py-[1px] text-[10.5px] text-[var(--ls-t4)]">—</span>
  const bueno = inverso ? v <= 0 : v >= 0
  const color = Math.abs(v) < 0.005 ? 'var(--ls-t3)' : bueno ? VERDE : ROJO
  return (
    <span className="inline-flex items-center gap-[2px] rounded-[6px] px-[6px] py-[1px] text-[10.5px] font-semibold tabular-nums" style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}>
      {v >= 0 ? '+' : '−'}
      {Math.abs(v * 100).toLocaleString('es-ES', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} %
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

export function GraficaVentas({ filas, dias, ivaPct, costes, resaltado }: { filas: readonly FilaPanel[]; dias: string[]; ivaPct: number; costes: Record<string, number>; resaltado: { desde: string; hasta: string } | null }) {
  const datos = useMemo(() => {
    const porDia = new Map<string, FilaPanel[]>()
    for (const f of filas) porDia.set(f.dia, [...(porDia.get(f.dia) ?? []), f])
    return dias.map((d) => {
      const t = totalizar(porDia.get(d) ?? [], ivaPct, costes)
      const dentro = resaltado ? d >= resaltado.desde && d <= resaltado.hasta : false
      return { dia: d, etiqueta: new Date(`${d}T00:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' }), ventas: t.ventas, neto: t.neto, publicidad: t.publicidad, unidades: t.unidades, dentro }
    })
  }, [filas, dias, ivaPct, costes, resaltado])
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={datos} margin={{ top: 10, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="ventas-barra" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={NARANJA2} stopOpacity={0.95} />
            <stop offset="100%" stopColor={NARANJA} stopOpacity={0.55} />
          </linearGradient>
          <linearGradient id="ventas-barra-tenue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={NARANJA2} stopOpacity={0.35} />
            <stop offset="100%" stopColor={NARANJA} stopOpacity={0.15} />
          </linearGradient>
          <linearGradient id="ventas-neto" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={VERDE} stopOpacity={0.28} />
            <stop offset="100%" stopColor={VERDE} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--ls-linea)" strokeDasharray="3 4" vertical={false} />
        <XAxis dataKey="etiqueta" tick={{ fontSize: 11, fill: 'var(--ls-t4)' }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={18} />
        <YAxis tick={{ fontSize: 11, fill: 'var(--ls-t4)' }} axisLine={false} tickLine={false} width={56} tickFormatter={(v: number) => `${Math.round(v).toLocaleString('es-ES')} €`} />
        <Tooltip
          cursor={{ fill: 'color-mix(in srgb, var(--ls-t1) 5%, transparent)' }}
          contentStyle={{ background: 'var(--ls-sup)', border: '1px solid var(--ls-linea)', borderRadius: 12, fontSize: 12, boxShadow: 'var(--ls-sombra-2)' }}
          labelStyle={{ color: 'var(--ls-t1)', fontWeight: 600 }}
          formatter={(v: number, nombre: string) => [nombre === 'Unidades' ? entero(v) : euros(v), nombre]}
        />
        <Bar dataKey="ventas" name="Ventas" radius={[6, 6, 0, 0]} maxBarSize={26} animationDuration={900} shape={(p: unknown) => <BarraVentas {...(p as BarraProps)} />} />
        <Area type="monotone" dataKey="neto" name="Ganancia neta" stroke={VERDE} strokeWidth={2.5} fill="url(#ventas-neto)" dot={false} animationDuration={1100} />
        <Line type="monotone" dataKey="publicidad" name="Publicidad" stroke={COLOR_ESTADO.violeta ?? '#a78bfa'} strokeWidth={1.5} strokeDasharray="4 4" dot={false} animationDuration={1100} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

type BarraProps = { x: number; y: number; width: number; height: number; payload: { dentro: boolean } }
function BarraVentas({ x, y, width, height, payload }: BarraProps) {
  if (!height || height < 0) return null
  const r = Math.min(6, width / 2)
  return <path d={`M${x},${y + height} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + width - r},${y} Q${x + width},${y} ${x + width},${y + r} L${x + width},${y + height} Z`} fill={payload.dentro ? 'url(#ventas-barra)' : 'url(#ventas-barra-tenue)'} />
}

/* ------------------------------------------------------------------ */
/* Dónde se va el dinero (barra apilada de las ventas)                 */
/* ------------------------------------------------------------------ */

export function RepartoDelDinero({ t }: { t: Totales }) {
  const partes = [
    { texto: 'IVA', valor: t.iva, color: '#9C9289' },
    { texto: 'Tarifas de Amazon', valor: -t.tarifas, color: NARANJA },
    { texto: 'Publicidad', valor: t.publicidad, color: COLOR_ESTADO.violeta ?? '#a78bfa' },
    { texto: 'Reembolsos', valor: -t.costeReembolso, color: ROJO },
    { texto: 'Promociones', valor: t.promo, color: COLOR_ESTADO.ambar },
    { texto: 'Coste de productos', valor: t.cogs, color: COLOR_ESTADO.azul },
    { texto: 'Ganancia neta', valor: Math.max(0, t.neto), color: VERDE },
  ].filter((p) => p.valor > 0.005)
  const total = partes.reduce((s, p) => s + p.valor, 0) || 1
  return (
    <div>
      <div className="flex h-[14px] w-full overflow-hidden rounded-full bg-[var(--ls-sup2)]">
        {partes.map((p, i) => (
          <div key={p.texto} className="h-full transition-[width] duration-700 ease-out" style={{ width: `${(p.valor / total) * 100}%`, background: p.color, marginLeft: i ? 2 : 0 }} title={`${p.texto}: ${euros(p.valor)}`} />
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-[6px]">
        {partes.map((p) => (
          <div key={p.texto} className="flex items-center gap-2 text-[12px]">
            <span className="h-[9px] w-[9px] shrink-0 rounded-[3px]" style={{ background: p.color }} />
            <span className="truncate text-[var(--ls-t3)]">{p.texto}</span>
            <span className="ml-auto tabular-nums text-[var(--ls-t1)]">{pct(p.valor / total, 0)}</span>
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

export function TablaProductos({ filas, ivaPct, costes, titulos, buscar }: { filas: readonly FilaPanel[]; ivaPct: number; costes: Record<string, number>; titulos: Record<string, { titulo: string | null; asin: string | null }>; buscar: string }) {
  const [orden, setOrden] = useState<{ col: ColProducto; desc: boolean }>({ col: 'ventas', desc: true })
  const productos = useMemo(() => {
    const por = new Map<string, FilaPanel[]>()
    for (const f of filas) {
      if (!f.sku) continue
      const k = `${f.mkt}|${f.sku}`
      por.set(k, [...(por.get(k) ?? []), f])
    }
    const q = buscar.trim().toLowerCase()
    return [...por.entries()]
      .map(([k, fs]) => {
        const [mkt, ...resto] = k.split('|')
        const sku = resto.join('|')
        const asin = fs.find((f) => f.asin)?.asin ?? titulos[sku]?.asin ?? null
        return { k, mkt, sku, asin, titulo: titulos[sku]?.titulo ?? null, t: totalizar(fs, ivaPct, costes), coste: costes[sku] ?? null }
      })
      .filter((p) => !q || p.sku.toLowerCase().includes(q) || (p.asin ?? '').toLowerCase().includes(q) || (p.titulo ?? '').toLowerCase().includes(q))
  }, [filas, ivaPct, costes, titulos, buscar])
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
            <tr key={p.k} className="group border-b border-[var(--ls-linea)] transition-colors hover:bg-[color-mix(in_srgb,var(--ls-sup2)_70%,transparent)]" style={{ animation: `ventas-entra 420ms ${Math.min(i, 20) * 25}ms both cubic-bezier(.2,.8,.2,1)` }}>
              <td className="px-3 py-[9px]">
                <div className="flex items-center gap-3">
                  <span className="shrink-0 rounded-[9px] bg-white p-[2px] ring-1 ring-[var(--ls-linea)] transition-transform group-hover:scale-[1.06]">
                    <ImagenDeProducto asin={p.asin} mkt={p.mkt} lado={44} redondeo={7} titulo={p.titulo ?? p.sku} />
                  </span>
                  <div className="min-w-0 max-w-[460px]">
                    <div className="flex items-center gap-2 text-[11px] text-[var(--ls-t4)]">
                      <span title={pais(p.mkt)}>{bandera(p.mkt)}</span>
                      <span className="tabular-nums">{p.asin ?? '—'}</span>
                      <span>·</span>
                      <span className="truncate">SKU {p.sku}</span>
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
