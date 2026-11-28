'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, ArrowDown, ArrowDownRight, ArrowUp, ArrowUpRight, ChevronDown, ChevronRight, Search, TrendingDown, TrendingUp, X } from 'lucide-react'
import { Area, Cell, ComposedChart, Line, Pie, PieChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ImagenDeProducto } from '@/components/productos/ImagenDeProducto'
import { marketplaceById } from '@/lib/types/amazon'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { ivaDeLaCuenta, ivaDeVentas, totalizar, variacion, type FilaPanel, type Iva, type Periodo, type Totales } from '@/lib/ventas/panel'
import type { BsrDelProducto, InventarioDelProducto, LineaDelPanel } from '@/lib/ventas/panel-servidor'

/** Lo que acompaña a cada producto como en Sellerboard: inventario FBA, BSR y sesiones del periodo (por «país|ASIN») */
export interface ExtrasProductos {
  stock?: Record<string, number>
  bsr?: Record<string, BsrDelProducto>
  sesiones?: Record<string, number> | null
  /** Reservado, enviado, no apto y ritmo de 30 días por SKU */
  inventario?: Record<string, InventarioDelProducto>
  /** Guardar el COGS de un SKU desde la tabla (null = quitarlo) */
  onCoste?: (sku: string, coste: number | null) => Promise<boolean>
}

/**
 * VENTAS · LAS PIEZAS DEL PANEL: formatos, banderas, el desglose de una baldosa, la gráfica, el reparto del dinero, la tabla de productos, la de pedidos y la
 * cuenta de resultados por periodo. Todo con lo que ya está en el navegador (lib/ventas/panel.ts).
 */

export const NARANJA = '#F26212'
export const NARANJA2 = '#FF8A3D'
export const VERDE = COLOR_ESTADO.verde
export const ROJO = COLOR_ESTADO.rojo

// SIEMPRE con dos decimales y punto de miles también en las de 4 cifras (en es-ES, 1322 € saldría sin punto). `_dec` se ignora: Raúl quiere los céntimos en todas partes
const formato = (moneda: string) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: moneda, minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' } as Intl.NumberFormatOptions)
// «Habilitar el cambio de moneda en el panel» (Configuración): todas las cifras están en euros y se enseñan en la moneda elegida con el cambio del día.
// Lo pone el tablero mientras está abierto (`ponerMonedaDelPanel`) y lo quita al salir: el resto de pantallas siguen en euros
let monedaPanel = { codigo: 'EUR', factor: 1, fmt: formato('EUR') }
export function ponerMonedaDelPanel(codigo: string, factor: number) {
  if (monedaPanel.codigo === codigo && monedaPanel.factor === factor) return
  monedaPanel = { codigo, factor: factor > 0 ? factor : 1, fmt: formato(codigo) }
}
export const monedaDelPanel = () => monedaPanel.codigo
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const euros = (n: number | null | undefined, _dec = 2) => (n == null || !Number.isFinite(n) ? '—' : monedaPanel.fmt.format(Math.abs(n * monedaPanel.factor) < 0.005 ? 0 : n * monedaPanel.factor))
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

export function filasDeDesglose(t: Totales, sesiones?: number | null): FilaDesglose[] {
  const organico = t.ventas - t.ventasPpc
  const conSesiones: FilaDesglose[] =
    sesiones === undefined
      ? []
      : [
          { texto: 'Sesiones', valor: sesiones == null ? '—' : entero(sesiones), gris: true },
          { texto: 'Porcentaje de sesiones por unidad', valor: sesiones ? pct(t.unidades / sesiones, 2) : '—', gris: true },
        ]
  return [
    { texto: 'Ventas', valor: euros(t.ventas), fuerte: true, hijos: [{ texto: 'Orgánico', valor: euros(organico) }, { texto: 'Publicidad (mismo día)', valor: euros(t.ventasPpc) }] },
    { texto: 'Unidades', valor: entero(t.unidades), hijos: [{ texto: 'Orgánico', valor: entero(t.unidades - t.unidadesPpc) }, { texto: 'Publicidad (mismo día)', valor: entero(t.unidadesPpc) }] },
    { texto: 'Pedidos', valor: entero(t.pedidos) },
    { texto: 'Reembolsos', valor: entero(t.reembolsos) },
    { texto: 'Promociones', valor: euros(-t.promo), signo: 'menos' },
    { texto: 'Costes publicitarios', valor: euros(-t.publicidad), signo: 'menos' },
    {
      texto: 'Coste de los reembolsos',
      valor: euros(t.costeReembolso),
      signo: 'menos',
      hijos: [
        { texto: 'Devuelto al comprador', valor: euros(-t.reembolsado) },
        { texto: 'Comisiones que devuelve Amazon', valor: euros(t.costeReembolso + t.reembolsado - t.valorDevuelto) },
        ...(t.valorDevuelto ? [{ texto: 'Valor de los artículos devueltos', valor: euros(t.valorDevuelto) }] : []),
      ],
    },
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
    ...(t.envio ? [{ texto: 'Costo de envío (FBM)', valor: euros(-t.envio), signo: 'menos' as const }] : []),
    ...(t.pickpack ? [{ texto: 'FBM Pick & Pack', valor: euros(-t.pickpack), signo: 'menos' as const }] : []),
    { texto: 'Ajustes y reembolsos de Amazon', valor: euros(t.ajustes), signo: 'mas' },
    { texto: 'Ganancia bruta', valor: euros(t.bruto) },
    { texto: 'Gastos indirectos', valor: euros(0) },
    { texto: 'Ganancia neta', valor: euros(t.neto), fuerte: true },
    { texto: 'Pago estimado', valor: euros(t.pago), nota: 'Lo que Amazon te ingresa por esto: ventas menos promociones, tarifas (con su IVA), reembolsos y publicidad' },
    { texto: 'TACOS (publicidad / ventas)', valor: pct(t.tacos, 2), gris: true },
    { texto: 'Tasa de reembolso', valor: pct(t.tasaReembolso, 2), gris: true },
    { texto: 'Margen', valor: pct(t.margen, 2), gris: true },
    { texto: 'ROI', valor: t.roi == null ? '—' : pct(t.roi, 2), gris: true },
    ...conSesiones,
    { texto: 'Precio medio de venta', valor: euros(t.precioMedio), gris: true },
  ]
}

export function Desglose({ t, sesiones, compacto = false, onReembolsos }: { t: Totales; sesiones?: number | null; compacto?: boolean; onReembolsos?: () => void }) {
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set())
  return (
    <div className="flex flex-col">
      {filasDeDesglose(t, sesiones).map((f) => {
        const abierto = abiertos.has(f.texto)
        return (
          <div key={f.texto} className={`border-b border-[var(--ls-linea)] ${f.gris ? 'bg-[var(--ls-sup2)]' : ''}`}>
            <button
              type="button"
              disabled={!f.hijos && !(f.texto === 'Reembolsos' && onReembolsos && t.reembolsos)}
              onClick={() => f.texto === 'Reembolsos' && onReembolsos ? onReembolsos() : setAbiertos((s) => {
                const n = new Set(s)
                if (n.has(f.texto)) n.delete(f.texto)
                else n.add(f.texto)
                return n
              })}
              className={`flex w-full items-center gap-2 px-3 text-left disabled:cursor-default ${compacto ? 'py-[6px]' : 'py-[9px]'}`}
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

export function GraficaVentas({ filas, dias, ivaPct, costes, resaltado, series = new Set<SerieGrafica>(['ventas', 'neto', 'publicidad']) }: { filas: readonly FilaPanel[]; dias: string[]; ivaPct: Iva; costes: Record<string, number>; resaltado: { desde: string; hasta: string } | null; series?: ReadonlySet<SerieGrafica> }) {
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

type ColProducto = 'unidades' | 'reembolsos' | 'ventas' | 'publicidad' | 'tarifas' | 'neto' | 'margen' | 'roi' | 'precio' | 'bruto' | 'bsr'

export type Agrupar = 'sku' | 'asin' | 'mercado'

export function TablaProductos({ filas, ivaPct, costes, titulos, buscar, agrupar = 'sku', onAbrir, extras }: { filas: readonly FilaPanel[]; ivaPct: Iva; costes: Record<string, number>; titulos: Record<string, { titulo: string | null; asin: string | null }>; buscar: string; agrupar?: Agrupar; onAbrir?: (p: { titulo: string; sub: string; asin: string | null; mkt: string; filas: FilaPanel[] }) => void; extras?: ExtrasProductos }) {
  const [orden, setOrden] = useState<{ col: ColProducto; desc: boolean }>({ col: 'ventas', desc: true })
  const [mas, setMas] = useState<{ k: string; boton: HTMLElement } | null>(null)
  const productos = useMemo(() => {
    // push y no `[...lista, f]`: copiar la lista en cada fila era cuadrático y con 14.000 filas (13 meses de Cobo) colgaba el navegador
    const por = new Map<string, FilaPanel[]>()
    for (const f of filas) {
      if (!f.sku && agrupar !== 'mercado') continue
      const k = agrupar === 'mercado' ? f.mkt : agrupar === 'asin' ? (f.asin ?? titulos[f.sku]?.asin ?? f.sku) : `${f.mkt}|${f.sku}`
      const g = por.get(k)
      if (g) g.push(f)
      else por.set(k, [f])
    }
    // Las sesiones por ASIN (todos los países) de una pasada, no buscando en todas por cada producto
    const sesionesPorAsin = new Map<string, number>()
    if (agrupar === 'asin' && extras?.sesiones) for (const [c, v] of Object.entries(extras.sesiones)) { const a = c.slice(c.indexOf('|') + 1); sesionesPorAsin.set(a, (sesionesPorAsin.get(a) ?? 0) + v) }
    const q = buscar.trim().toLowerCase()
    return [...por.entries()]
      .map(([k, fs]) => {
        const conSku = fs.find((f) => f.sku) ?? fs[0]
        const mkt = conSku.mkt
        const sku = agrupar === 'mercado' ? '' : conSku.sku
        const asin = agrupar === 'mercado' ? null : (fs.find((f) => f.asin)?.asin ?? titulos[sku]?.asin ?? null)
        const titulo = agrupar === 'mercado' ? `${dominio(mkt)}` : (titulos[sku]?.titulo ?? null)
        const listaSkus = [...new Set(fs.map((f) => f.sku).filter(Boolean))]
        const skus = listaSkus.length
        // Inventario: el de sus SKU (el almacén es uno para todos los países)
        const conStock = listaSkus.filter((x) => extras?.stock?.[x] != null)
        const stock = agrupar === 'mercado' || conStock.length === 0 ? null : conStock.reduce((suma, x) => suma + (extras?.stock?.[x] ?? 0), 0)
        const bsr = agrupar === 'mercado' ? null : (extras?.bsr?.[sku] ?? null)
        let sesiones: number | null | undefined = undefined
        if (extras?.sesiones !== undefined && agrupar !== 'mercado') {
          if (!extras.sesiones || !asin) sesiones = null
          else if (agrupar === 'asin') sesiones = sesionesPorAsin.get(asin) ?? 0
          else sesiones = extras.sesiones[`${mkt}|${asin}`] ?? 0
        }
        const suma = (c: 'reservado' | 'enviado' | 'noApto' | 'ritmo') => listaSkus.reduce((acc, x) => acc + (extras?.inventario?.[x]?.[c] ?? 0), 0)
        const inv = agrupar === 'mercado' || !extras?.inventario ? null : { reservado: suma('reservado'), enviado: suma('enviado'), noApto: suma('noApto'), ritmo: suma('ritmo') }
        return { k, mkt, sku, asin, titulo, skus, filas: fs, t: totalizar(fs, ivaPct, costes), coste: costes[sku] ?? null, stock, bsr, sesiones, inv }
      })
      .filter((p) => !q || p.sku.toLowerCase().includes(q) || (p.asin ?? '').toLowerCase().includes(q) || (p.titulo ?? '').toLowerCase().includes(q))
  }, [filas, ivaPct, costes, titulos, buscar, agrupar, extras])
  const valor = (p: (typeof productos)[number], c: ColProducto) => (c === 'tarifas' ? p.t.tarifas : c === 'margen' ? (p.t.margen ?? -9) : c === 'roi' ? (p.t.roi ?? -9) : c === 'precio' ? (p.t.precioMedio ?? 0) : c === 'neto' ? p.t.neto : c === 'bruto' ? p.t.bruto : c === 'bsr' ? -(p.bsr?.rank ?? 1e12) : (p.t[c] as number))
  const lista = useMemo(() => [...productos].sort((a, b) => (orden.desc ? valor(b, orden.col) - valor(a, orden.col) : valor(a, orden.col) - valor(b, orden.col))), [productos, orden]) // eslint-disable-line react-hooks/exhaustive-deps
  // DE 100 EN 100: pintar miles de filas con su imagen de golpe dejaba la página sin responder (ShoesF: más de 3.000 productos en 13 meses)
  const [mostrar, setMostrar] = useState(100)
  useEffect(() => setMostrar(100), [filas, buscar, agrupar, orden])
  const finDeLista = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = finDeLista.current
    if (!el || mostrar >= lista.length) return
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setMostrar((m) => m + 100), { rootMargin: '800px' })
    io.observe(el)
    return () => io.disconnect()
  }, [mostrar, lista.length])
  const abierto = mas ? lista.find((p) => p.k === mas.k) ?? null : null
  useEffect(() => {
    if (!mas) return
    const cerrar = (e: KeyboardEvent) => e.key === 'Escape' && setMas(null)
    window.addEventListener('keydown', cerrar)
    return () => window.removeEventListener('keydown', cerrar)
  }, [mas])
  const Cab = ({ col, texto }: { col: ColProducto; texto: string }) => (
    <th className="whitespace-nowrap px-2 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-[var(--ls-t4)]">
      <button type="button" onClick={() => setOrden((o) => ({ col, desc: o.col === col ? !o.desc : true }))} className="inline-flex items-center gap-1 hover:text-[var(--ls-t1)]">
        {texto}
        {orden.col === col && (orden.desc ? <ArrowDown className="h-[11px] w-[11px]" /> : <ArrowUp className="h-[11px] w-[11px]" />)}
      </button>
    </th>
  )
  if (lista.length === 0) return <p className="px-4 py-8 text-center text-[13px] text-[var(--ls-t4)]">Ningún producto con movimiento en este periodo.</p>
  const conBsr = agrupar !== 'mercado' && lista.some((p) => p.bsr)
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1080px] text-[12.5px]">
        <thead className="border-b border-[var(--ls-linea)]">
          <tr>
            <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--ls-t4)] max-sm:sticky max-sm:left-0 max-sm:z-[2] max-sm:bg-[var(--ls-sup)] max-sm:shadow-[6px_0_10px_-8px_rgba(0,0,0,0.6)]">Producto</th>
            <Cab col="unidades" texto="Unidades" />
            <Cab col="reembolsos" texto="Reemb." />
            <Cab col="ventas" texto="Ventas" />
            <Cab col="publicidad" texto="Publicidad" />
            <Cab col="tarifas" texto="Tarifas" />
            <Cab col="bruto" texto="Ganancia bruta" />
            <Cab col="neto" texto="Ganancia neta" />
            <Cab col="margen" texto="Margen" />
            <Cab col="roi" texto="ROI" />
            {conBsr && <Cab col="bsr" texto="BSR" />}
            <Cab col="precio" texto="Precio medio" />
            <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-[var(--ls-t4)]">Información</th>
          </tr>
        </thead>
        <tbody>
          {lista.slice(0, mostrar).map((p, i) => {
            const pocas = p.stock != null && (p.stock === 0 || p.stock < p.t.unidades)
            const sube = p.bsr?.antes != null && p.bsr.rank < p.bsr.antes
            const baja = p.bsr?.antes != null && p.bsr.rank > p.bsr.antes
            return (
              <tr key={p.k} onClick={() => onAbrir?.({ titulo: p.titulo ?? p.sku, sub: agrupar === 'mercado' ? `${p.skus} productos` : `${p.asin ?? '—'} · SKU ${p.sku}${agrupar === 'asin' && p.skus > 1 ? ` y ${p.skus - 1} más` : ''}`, asin: p.asin, mkt: p.mkt, filas: p.filas })} className={`group border-b ${onAbrir ? 'cursor-pointer' : ''} border-[var(--ls-linea)] transition-colors hover:bg-[color-mix(in_srgb,var(--ls-sup2)_70%,transparent)] ${mas?.k === p.k ? 'bg-[color-mix(in_srgb,var(--ls-sup2)_70%,transparent)]' : ''}`} style={{ animation: `ventas-entra 420ms ${Math.min(i, 20) * 25}ms both cubic-bezier(.2,.8,.2,1)` }}>
                {/* En el móvil la columna del producto se queda fija y las cifras se pasan de lado */}
                <td className="px-3 py-[5px] max-sm:sticky max-sm:left-0 max-sm:z-[1] max-sm:bg-[var(--ls-sup)] max-sm:shadow-[6px_0_10px_-8px_rgba(0,0,0,0.6)]">
                  <div className="flex items-center gap-[10px]">
                    {agrupar === 'mercado' ? (
                      <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[10px] bg-[var(--ls-sup2)] text-[20px]">{bandera(p.mkt)}</span>
                    ) : (
                      <span className="shrink-0 rounded-[8px] transition-transform group-hover:scale-[1.06]">
                        <ImagenDeProducto asin={p.asin} mkt={p.mkt} lado={34} redondeo={6} titulo={p.titulo ?? p.sku} borde={false} className="shadow-[0_1px_4px_rgba(0,0,0,0.35)]" />
                      </span>
                    )}
                    <div className="min-w-0 max-w-[132px] overflow-hidden leading-[1.3] sm:max-w-[460px]">
                      <div className="flex items-center gap-[6px] text-[10.5px] text-[var(--ls-t4)]">
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
                      {agrupar !== 'mercado' && (
                        <div className="flex items-center gap-[5px] whitespace-nowrap text-[10.5px] tabular-nums text-[var(--ls-t4)]">
                          <span>{euros(p.t.precioMedio)}</span>
                          <span>·</span>
                          {extras?.onCoste && agrupar === 'sku' ? <EditarCoste coste={p.coste} onGuardar={(v) => extras.onCoste!(p.sku, v)} /> : <span>COGS: {p.coste != null ? euros(p.coste) : <span className="text-[var(--ls-t4)]">sin poner</span>}</span>}
                          {p.stock != null && (
                            <>
                              <span>·</span>
                              <InventarioFba stock={p.stock} inv={p.inv} coste={p.coste} pocas={pocas} />
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-2 text-right tabular-nums text-[var(--ls-t1)]">{entero(p.t.unidades)}</td>
                <td className="px-2 text-right tabular-nums" style={{ color: p.t.reembolsos ? ROJO : 'var(--ls-t4)' }}>{entero(p.t.reembolsos)}</td>
                <td className="px-2 text-right font-semibold tabular-nums text-[var(--ls-t1)]">{euros(p.t.ventas)}</td>
                <td className="px-2 text-right tabular-nums text-[var(--ls-t3)]">{p.t.publicidad ? euros(-p.t.publicidad) : '—'}</td>
                <td className="px-2 text-right tabular-nums text-[var(--ls-t3)]">{euros(p.t.tarifas)}</td>
                <td className="px-2 text-right tabular-nums text-[var(--ls-t2)]">{euros(p.t.bruto)}</td>
                <td className="px-2 text-right font-semibold tabular-nums" style={{ color: p.t.neto >= 0 ? VERDE : ROJO }}>{euros(p.t.neto)}</td>
                <td className="px-2 text-right tabular-nums text-[var(--ls-t2)]">{pct(p.t.margen, 0)}</td>
                <td className="whitespace-nowrap px-2 text-right tabular-nums text-[var(--ls-t2)]" title={p.coste == null ? 'Sin coste puesto' : undefined}>{p.t.roi == null ? <span className="text-[var(--ls-t4)]">sin coste</span> : pct(p.t.roi, 0)}</td>
                {conBsr && (
                  <td className="whitespace-nowrap px-2 text-right tabular-nums" style={{ color: sube ? VERDE : baja ? ROJO : 'var(--ls-t3)' }} title={p.bsr?.antes != null ? `Hace unos días: ${entero(p.bsr.antes)}` : undefined}>
                    {p.bsr ? (
                      <span className="inline-flex items-center gap-1">
                        {sube && <TrendingUp className="h-[12px] w-[12px]" />}
                        {baja && <TrendingDown className="h-[12px] w-[12px]" />}
                        {entero(p.bsr.rank)}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                )}
                <td className="px-2 text-right tabular-nums text-[var(--ls-t3)]">{euros(p.t.precioMedio)}</td>
                <td className="px-3 text-right">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      const boton = e.currentTarget as HTMLElement
                      setMas((m) => (m?.k === p.k ? null : { k: p.k, boton }))
                    }}
                    className="rounded-[6px] px-2 py-[2px] text-[12px] font-medium text-[#3B82F6] transition-colors hover:bg-[color-mix(in_srgb,#3B82F6_12%,transparent)]"
                  >
                    Más
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {mostrar < lista.length && (
        <div ref={finDeLista} className="flex items-center justify-center gap-3 py-4 text-[12px] text-[var(--ls-t4)]">
          {mostrar} de {lista.length} productos
          <button type="button" onClick={() => setMostrar(lista.length)} className="text-[var(--ls-t2)] underline-offset-2 hover:underline">
            Ver todos
          </button>
        </div>
      )}
      {abierto && mas && <PanelMas p={abierto} boton={mas.boton} agrupar={agrupar} onCerrar={() => setMas(null)} />}
    </div>
  )
}

/** El «Más» de Sellerboard: todo el desglose de un producto en una ventanita junto a su fila */
function PanelMas({ p, boton, agrupar, onCerrar }: { p: { k: string; mkt: string; sku: string; asin: string | null; titulo: string | null; skus: number; t: Totales; sesiones?: number | null; stock: number | null }; boton: HTMLElement; agrupar: Agrupar; onCerrar: () => void }) {
  // Va pegada a su fila: al hacer scroll (de la página o de cualquier caja) se recoloca, y si la fila sale de la pantalla se cierra.
  // El alto se ajusta a lo que queda visible y lo de dentro hace scroll: nunca se queda nada cortado
  const ANCHO = 380
  const [pos, setPos] = useState<{ left: number; top: number; alto: number } | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  // Sin velo delante: la página sigue haciendo scroll con la ventana abierta. Un clic fuera la cierra
  useEffect(() => {
    const fuera = (e: MouseEvent) => {
      const t = e.target as Node
      if (panel.current?.contains(t) || boton.contains(t)) return
      onCerrar()
    }
    document.addEventListener('mousedown', fuera)
    return () => document.removeEventListener('mousedown', fuera)
  }, [boton, onCerrar])
  useLayoutEffect(() => {
    let marco = 0
    const colocar = () => {
      cancelAnimationFrame(marco)
      marco = requestAnimationFrame(() => {
        if (!boton.isConnected) return onCerrar()
        const r = boton.getBoundingClientRect()
        const vh = window.innerHeight
        const vw = window.innerWidth
        if (r.bottom < 0 || r.top > vh) return onCerrar()
        const left = Math.max(12, Math.min(r.right - ANCHO - 60, vw - ANCHO - 12))
        const alto = Math.min(660, vh - 24)
        const top = Math.max(12, Math.min(r.top - 40, vh - alto - 12))
        setPos({ left, top, alto: Math.min(alto, vh - top - 12) })
      })
    }
    colocar()
    window.addEventListener('scroll', colocar, true)
    window.addEventListener('resize', colocar)
    return () => {
      cancelAnimationFrame(marco)
      window.removeEventListener('scroll', colocar, true)
      window.removeEventListener('resize', colocar)
    }
  }, [boton, onCerrar])
  if (!pos) return null
  return (
    <>
      <div ref={panel} className="fixed z-[81] flex flex-col overflow-hidden rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] shadow-[0_24px_60px_-12px_rgba(0,0,0,0.45)]" style={{ left: pos.left, top: pos.top, width: ANCHO, maxHeight: pos.alto, animation: 'ventas-entra 220ms both cubic-bezier(.2,.8,.2,1)' }}>
        <div className="flex items-start gap-3 border-b border-[var(--ls-linea)] px-3 py-3">
          {agrupar === 'mercado' ? (
            <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[10px] bg-[var(--ls-sup2)] text-[22px]">{bandera(p.mkt)}</span>
          ) : (
            <span className="shrink-0 rounded-[8px]">
              <ImagenDeProducto asin={p.asin} mkt={p.mkt} lado={40} redondeo={6} titulo={p.titulo ?? p.sku} borde={false} className="shadow-[0_1px_4px_rgba(0,0,0,0.35)]" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-[11px] tabular-nums text-[var(--ls-t4)]">{agrupar === 'mercado' ? `${pais(p.mkt)} · ${p.skus} productos` : `${p.asin ?? '—'} · ${p.sku}${agrupar === 'asin' && p.skus > 1 ? ` y ${p.skus - 1} más` : ''}`}</div>
            <div className="line-clamp-2 text-[12.5px] font-medium leading-[1.3] text-[var(--ls-t1)]">{p.titulo ?? p.sku}</div>
            {p.stock != null && <div className="mt-[2px] text-[11px] text-[var(--ls-t3)]">Inventario FBA: {entero(p.stock)}</div>}
          </div>
          <button type="button" onClick={onCerrar} className="rounded-[6px] p-1 text-[var(--ls-t4)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]" aria-label="Cerrar">
            <X className="h-[15px] w-[15px]" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <Desglose t={p.t} sesiones={p.sesiones} compacto />
        </div>
      </div>
    </>
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

export function TablaPedidos({ lineas, titulos, ivaPct, costes, buscar }: { lineas: readonly LineaDelPanel[]; titulos: Record<string, { titulo: string | null; asin: string | null }>; ivaPct: Iva; costes: Record<string, number>; buscar: string }) {
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
            // Las tarifas de Amazon vienen con su IVA dentro y se enseñan sin él (lib/ventas/panel.ts)
            const tarifas = (l.tarifas ?? -0.15 * 1.21 * ventas) / (1 + ivaDeLaCuenta(ivaPct) / 100)
            const rIva = ivaDeVentas(ivaPct, l.mkt)
            const iva = Math.max(0, ventas - l.promo) * (rIva / (100 + rIva))
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
                    <span className="shrink-0 rounded-[8px]">
                      <ImagenDeProducto asin={l.asin ?? t?.asin ?? null} mkt={l.mkt} lado={38} redondeo={6} borde={false} className="shadow-[0_1px_4px_rgba(0,0,0,0.35)]" />
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
    // Las mismas líneas que el desglose: sumadas dan la ganancia neta (antes faltaban el envío FBM y el pick & pack)
    ...(totales.some((t) => t.envio) ? [{ texto: 'Costo de envío (FBM)', f: (t: Totales) => euros(-t.envio) }] : []),
    ...(totales.some((t) => t.pickpack) ? [{ texto: 'FBM Pick & Pack', f: (t: Totales) => euros(-t.pickpack) }] : []),
    { texto: 'Ajustes de Amazon', f: (t) => euros(t.ajustes) },
    { texto: 'Ganancia neta', f: (t) => euros(t.neto), fuerte: true, neto: true },
    { texto: 'Pago estimado', f: (t) => euros(t.pago) },
    { texto: 'Margen', f: (t) => pct(t.margen) },
    { texto: 'ROI', f: (t) => (t.roi == null ? '—' : pct(t.roi)) },
    { texto: 'TACOS', f: (t) => pct(t.tacos) },
    { texto: 'Tasa de reembolso', f: (t) => pct(t.tasaReembolso) },
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
    <div ref={caja} className="min-w-0" style={{ minHeight: minimo }}>
      {children}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Los motivos de los reembolsos (al pulsar «Reembolsos»)              */
/* ------------------------------------------------------------------ */

const COLORES_MOTIVO = ['#34D399', '#60A5FA', '#F87171', '#F472B6', '#A3E635', '#FB923C', '#38BDF8', '#FBBF24', '#C084FC', '#2DD4BF', '#E879F9', '#94A3B8']

export function MotivosDeReembolso({ cuenta, desde, hasta, skus, mercados }: { cuenta: string; desde: string; hasta: string; skus?: Set<string> | null; mercados?: Set<string> | null }) {
  const [datos, setDatos] = useState<{ total: number; grupos: Array<{ motivo: string; unidades: number; comentarios: string[] }>; conDevoluciones: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set())
  useEffect(() => {
    let vivo = true
    setDatos(null)
    const q = new URLSearchParams({ que: 'motivos', cuenta, desde, hasta })
    if (skus?.size) q.set('skus', [...skus].join(','))
    if (mercados?.size) q.set('mercados', [...mercados].join(','))
    fetch(`/api/ventas?${q}`, { cache: 'no-store' })
      .then(async (r) => {
        const j = await r.json()
        if (!r.ok) throw new Error(j?.error ?? `Error ${r.status}`)
        if (vivo) setDatos(j)
      })
      .catch((e) => vivo && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      vivo = false
    }
  }, [cuenta, desde, hasta, skus, mercados])
  if (error) return <p className="text-[12.5px]" style={{ color: ROJO }}>{error}</p>
  if (!datos) return <div className="h-[260px] animate-pulse rounded-[14px] bg-[var(--ls-sup2)]" />
  if (!datos.total) return <p className="py-8 text-center text-[13px] text-[var(--ls-t4)]">Ningún reembolso en este periodo.</p>
  const color = (i: number, motivo: string) => (motivo.startsWith('Pendiente') ? '#71717A' : COLORES_MOTIVO[i % COLORES_MOTIVO.length])
  return (
    <div className="flex flex-col gap-4">
      <div className="relative mx-auto h-[210px] w-[210px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={datos.grupos} dataKey="unidades" nameKey="motivo" innerRadius={72} outerRadius={100} paddingAngle={2} stroke="none" isAnimationActive>
              {datos.grupos.map((g, i) => (
                <Cell key={g.motivo} fill={color(i, g.motivo)} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[34px] font-semibold tabular-nums leading-none text-[var(--ls-t1)]">{entero(datos.total)}</span>
          <span className="mt-1 text-[11px] text-[var(--ls-t4)]">reembolsos</span>
        </div>
      </div>
      {!datos.conDevoluciones && <p className="rounded-[10px] border border-[var(--ls-linea)] px-3 py-2 text-[11.5px] text-[var(--ls-t3)]">Los motivos salen del informe de devoluciones de Amazon: falta lanzar la migración 348 o aún no se ha leído (tarda una pasada del cron).</p>}
      <div className="flex flex-col">
        {datos.grupos.map((g, i) => {
          const abierto = abiertos.has(g.motivo)
          return (
            <div key={g.motivo} className="border-b border-[var(--ls-linea)] last:border-0">
              <button
                type="button"
                disabled={!g.comentarios.length}
                onClick={() =>
                  setAbiertos((s) => {
                    const n = new Set(s)
                    if (n.has(g.motivo)) n.delete(g.motivo)
                    else n.add(g.motivo)
                    return n
                  })
                }
                className="flex w-full items-center gap-2 py-[9px] text-left disabled:cursor-default"
              >
                <span className="w-[14px] text-[var(--ls-t4)]">{g.comentarios.length ? abierto ? <ChevronDown className="h-[13px] w-[13px]" /> : <ChevronRight className="h-[13px] w-[13px]" /> : null}</span>
                <span className="h-[9px] w-[9px] shrink-0 rounded-full" style={{ background: color(i, g.motivo) }} />
                <span className="flex-1 text-[13px] text-[var(--ls-t2)]">{g.motivo}</span>
                {g.comentarios.length > 0 && <span className="text-[10.5px] text-[var(--ls-t4)]">{g.comentarios.length} {g.comentarios.length === 1 ? 'comentario' : 'comentarios'}</span>}
                <span className="w-[34px] text-right text-[13px] font-semibold tabular-nums text-[var(--ls-t1)]">{entero(g.unidades)}</span>
              </button>
              {abierto && (
                <div className="flex flex-col gap-[6px] pb-3 pl-[40px] pr-2">
                  {g.comentarios.map((c) => (
                    <p key={c} className="rounded-[10px] bg-[var(--ls-sup2)] px-3 py-2 text-[12px] italic leading-[1.45] text-[var(--ls-t3)]">
                      «{c}»
                    </p>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Días que tarda una reposición (fabricar + mandar a Amazon), como el «plazo» por defecto de Sellerboard: «días hasta el próximo pedido» = días que quedan − esto */
export const PLAZO_REPOSICION_DIAS = 45

/**
 * «INVENTARIO FBA: N» CON SU FICHA AL PASAR EL RATÓN (o al tocar, en el móvil), como Sellerboard: días que quedan, días hasta el próximo pedido,
 * ritmo de venta, valor, reservado, enviado y no apto. En rojo cuando ya toca pedir.
 */
function InventarioFba({ stock, inv, coste, pocas }: { stock: number; inv: { reservado: number; enviado: number; noApto: number; ritmo: number } | null; coste: number | null; pocas: boolean }) {
  const ancla = useRef<HTMLSpanElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number; arriba: boolean } | null>(null)
  const ritmo = inv?.ritmo ?? 0
  const dias = ritmo > 0 ? Math.floor(stock / ritmo) : null
  const proximo = dias === null ? null : Math.max(0, dias - PLAZO_REPOSICION_DIAS)
  const urge = proximo !== null && proximo <= 0
  const cerca = proximo !== null && proximo > 0 && proximo <= 14
  const color = urge ? ROJO : pocas || cerca ? NARANJA : 'var(--ls-t3)'
  const abrir = () => {
    const r = ancla.current?.getBoundingClientRect()
    if (!r) return
    const arriba = r.bottom + 190 > window.innerHeight
    setPos({ x: Math.max(8, Math.min(r.left, window.innerWidth - 400)), y: arriba ? r.top - 6 : r.bottom + 6, arriba })
  }
  useEffect(() => {
    if (!pos) return
    const cerrar = () => setPos(null)
    window.addEventListener('scroll', cerrar, true)
    return () => window.removeEventListener('scroll', cerrar, true)
  }, [pos])
  const celda = (rotulo: string, valor: ReactNode, rojo = false) => (
    <div className="min-w-0">
      <div className="text-[11px] leading-[1.3] text-[var(--ls-t4)]">{rotulo}</div>
      <div className="mt-[3px] inline-flex items-center gap-1 text-[15px] font-semibold tabular-nums" style={{ color: rojo ? ROJO : 'var(--ls-t1)' }}>
        {rojo && <AlertTriangle className="h-[13px] w-[13px]" strokeWidth={2.4} />}
        {valor}
      </div>
    </div>
  )
  return (
    <>
      <span
        ref={ancla}
        onMouseEnter={abrir}
        onMouseLeave={() => setPos(null)}
        onClick={(e) => (e.stopPropagation(), pos ? setPos(null) : abrir())}
        className="inline-flex cursor-help items-center gap-[3px] font-medium underline decoration-dotted underline-offset-2"
        style={{ color }}
      >
        <TrendingUp className="h-[11px] w-[11px]" />
        Inventario FBA: {entero(stock)}
        {(pocas || urge) && <AlertTriangle className="h-[11px] w-[11px]" strokeWidth={2.4} />}
      </span>
      {pos &&
        typeof document !== 'undefined' &&
        createPortal(
        <div
          role="tooltip"
          className="pointer-events-none fixed z-[80] w-[min(392px,calc(100vw-16px))] rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-4 shadow-[var(--ls-sombra-3)]"
          style={{ left: pos.x, top: pos.y, transform: pos.arriba ? 'translateY(-100%)' : undefined }}
        >
          <div className="grid grid-cols-4 gap-x-4 gap-y-3 whitespace-normal">
            {celda('Días de inventario (FBA) que quedan', dias === null ? '—' : entero(dias))}
            {celda('Días hasta el próximo pedido', proximo === null ? '—' : entero(proximo), urge)}
            {celda('Ritmo (uds./día, 30 días)', ritmo.toLocaleString('es-ES', { maximumFractionDigits: 2 }))}
            {celda('Valor del inventario', coste == null ? '—' : euros((stock + (inv?.reservado ?? 0)) * coste))}
            {celda('Disponible', entero(stock))}
            {celda('Reservado', inv ? entero(inv.reservado) : '—')}
            {celda('Enviado a FBA', inv ? entero(inv.enviado) : '—')}
            {celda('No apto', inv ? entero(inv.noApto) : '—')}
          </div>
          <p className="mt-3 border-t border-[var(--ls-linea)] pt-2 text-[10.5px] leading-[1.4] text-[var(--ls-t4)]">
            Próximo pedido = días que quedan − {PLAZO_REPOSICION_DIAS} días de reposición. El valor, a COGS (disponible + reservado).
          </p>
        </div>,
          document.body
        )}
    </>
  )
}

/** El COGS de la fila, editable con un clic (Enter guarda, Esc cancela, vacío lo quita) */
function EditarCoste({ coste, onGuardar }: { coste: number | null; onGuardar: (v: number | null) => Promise<boolean> }) {
  const [editando, setEditando] = useState(false)
  const [texto, setTexto] = useState('')
  const [guardando, setGuardando] = useState(false)
  const guardar = async () => {
    const limpio = texto.trim().replace(/\s|€/g, '').replace(',', '.')
    const v = limpio === '' ? null : Number(limpio)
    if (v !== null && (!Number.isFinite(v) || v < 0)) return
    if (v === coste) return setEditando(false)
    setGuardando(true)
    const ok = await onGuardar(v === null ? null : Math.round(v * 100) / 100)
    setGuardando(false)
    if (ok) setEditando(false)
  }
  if (!editando)
    return (
      <button
        type="button"
        onClick={(e) => (e.stopPropagation(), setTexto(coste == null ? '' : String(coste).replace('.', ',')), setEditando(true))}
        className="rounded-[4px] px-[2px] text-[var(--ls-acc)] underline decoration-dotted underline-offset-2 hover:bg-[var(--ls-sup2)]"
        title="Cambiar el COGS"
      >
        COGS: {coste != null ? euros(coste) : 'poner'}
      </button>
    )
  return (
    <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      COGS:
      <input
        autoFocus
        inputMode="decimal"
        value={texto}
        disabled={guardando}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void guardar()
          if (e.key === 'Escape') setEditando(false)
        }}
        onBlur={() => void guardar()}
        className="h-[20px] w-[70px] rounded-[5px] border border-[var(--ls-acc)] bg-[var(--ls-sup)] px-1 text-right text-[11px] text-[var(--ls-t1)] outline-none"
        placeholder="0,00"
      />
      €
    </span>
  )
}

/** Colores de los canales: FBA (Amazon envía) y FBM (envía el vendedor) */
const COLOR_FBA = '#F26212'
const COLOR_FBM = '#60A5FA'

/**
 * LAS VENTAS POR CANAL (FBA / FBM) en un donut, de los últimos 1, 7, 14 o 30 días (de las líneas de pedido: sin cancelados). Respeta los países y
 * los productos elegidos arriba.
 */
export function RepartoPorCanal({ cuenta, hoy, mercados, skus }: { cuenta: string; hoy: string; mercados: ReadonlySet<string> | null; skus: ReadonlySet<string> | null }) {
  const [dias, setDias] = useState<1 | 7 | 14 | 30>(7)
  const [datos, setDatos] = useState<{ fba: { ventas: number; unidades: number; pedidos: number }; fbm: { ventas: number; unidades: number; pedidos: number } } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    setError(null)
    const desde = new Date(Date.parse(`${hoy}T00:00:00Z`) - (dias - 1) * 86_400_000).toISOString().slice(0, 10)
    const q = new URLSearchParams({ que: 'canal', cuenta, desde, hasta: hoy })
    if (mercados) q.set('mercados', [...mercados].join(','))
    if (skus) q.set('skus', [...skus].join(','))
    fetch(`/api/ventas?${q}`, { cache: 'no-store' })
      .then(async (r) => {
        const j = await r.json().catch(() => null)
        if (!r.ok) throw new Error(j?.error ?? 'No se han podido leer las ventas por canal')
        if (vivo) setDatos(j)
      })
      .catch((e) => vivo && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      vivo = false
    }
  }, [cuenta, hoy, dias, mercados, skus])
  const total = datos ? datos.fba.ventas + datos.fbm.ventas : 0
  const partes = datos
    ? [
        { texto: 'FBA', sub: 'Lo envía Amazon', color: COLOR_FBA, ...datos.fba },
        { texto: 'FBM', sub: 'Lo envía el vendedor', color: COLOR_FBM, ...datos.fbm },
      ]
    : []
  return (
    <div className="flex flex-col gap-4">
      <div className="inline-flex self-start rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-[3px]" role="group" aria-label="Días">
        {([1, 7, 14, 30] as const).map((d) => (
          <button key={d} type="button" onClick={() => setDias(d)} className={`h-[26px] rounded-[7px] px-[10px] text-[12px] font-medium transition-colors ${dias === d ? 'bg-[var(--ls-sup)] text-[var(--ls-t1)] shadow-sm' : 'text-[var(--ls-t3)] hover:text-[var(--ls-t1)]'}`}>
            {d === 1 ? 'Hoy' : `${d} días`}
          </button>
        ))}
      </div>
      {error ? (
        <p className="text-[12px]" style={{ color: ROJO }}>{error}</p>
      ) : (
        <div className="flex items-center gap-4">
          <div className="relative h-[140px] w-[140px] shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie style={{ filter: 'drop-shadow(0 6px 14px rgba(0,0,0,0.35))' }} data={total ? partes.filter((p) => p.ventas > 0) : [{ texto: '', ventas: 1, color: 'var(--ls-sup2)' }]} dataKey="ventas" innerRadius={50} outerRadius={68} paddingAngle={total && partes.every((p) => p.ventas > 0) ? 2.5 : 0} cornerRadius={5} stroke="none" startAngle={90} endAngle={-270} animationDuration={900}>
                  {(total ? partes.filter((p) => p.ventas > 0) : [{ color: 'var(--ls-sup2)' }]).map((p, i) => (
                    <Cell key={i} fill={p.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[22px] font-semibold tracking-[-0.02em] tabular-nums text-[var(--ls-t1)]">{datos ? (total ? pct(datos.fba.ventas / total, 0) : '—') : '…'}</span>
              <span className="text-[10.5px] uppercase tracking-[0.1em] text-[var(--ls-t4)]">FBA</span>
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            {!datos && <span className="text-[12px] text-[var(--ls-t4)]">Leyendo…</span>}
            {partes.map((p) => (
              <div key={p.texto} className="min-w-0">
                <div className="flex items-center gap-2 text-[12.5px]">
                  <span className="h-[8px] w-[8px] shrink-0 rounded-full" style={{ background: p.color }} />
                  <span className="font-medium text-[var(--ls-t1)]">{p.texto}</span>
                  <span className="truncate text-[11px] text-[var(--ls-t4)]">{p.sub}</span>
                  <span className="ml-auto whitespace-nowrap tabular-nums text-[var(--ls-t1)]">{euros(p.ventas)}</span>
                  <span className="w-[36px] shrink-0 whitespace-nowrap text-right tabular-nums text-[var(--ls-t4)]">{pct(total ? p.ventas / total : 0, 0)}</span>
                </div>
                <div className="pl-4 text-[11px] tabular-nums text-[var(--ls-t4)]">
                  {entero(p.unidades)} uds. · {entero(p.pedidos)} pedido{p.pedidos === 1 ? '' : 's'}
                </div>
              </div>
            ))}
            {datos && total === 0 && <span className="text-[12px] text-[var(--ls-t4)]">Sin ventas en estos días</span>}
          </div>
        </div>
      )}
    </div>
  )
}
