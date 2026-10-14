'use client'

import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Download } from 'lucide-react'
import type { RemesaDePanel, SkuDePanel } from '@/lib/fba/datos'
import {
  analizarProductos,
  CLASE_TEXTO,
  matrizDeVentas,
  resumenDeRitmo,
  serieDeLinea,
  serieDeRemesa,
  ultimosDias,
  type Clase,
  type FilaProducto,
} from '@/lib/fba/analisis'
import { fecha as formatoFecha } from './formato'
import { SeguimientoEnvio } from './SeguimientoEnvio'

/**
 * EL DESGLOSE DE UN ENVÍO, EN PESTAÑAS.
 *
 *   Resumen      cómo va el envío de un vistazo y el gráfico de ventas y stock.
 *   Ventas       las ventas de cada producto, día a día.
 *   Almacén      lo que hay ahora en el almacén de Amazon, producto a producto.
 *   Rotación     a qué ritmo sale cada producto y cuándo se agota.
 *   Seguimiento  el recorrido del envío: estados, unidades recibidas y primera venta.
 *   Referencias  la tabla de siempre, con todas las columnas.
 *
 * Todo sale de lo que el panel ya trae (lib/fba/analisis.ts): ninguna pestaña hace
 * llamadas propias, así que cambiar de una a otra es instantáneo.
 */

type Pestana = 'resumen' | 'ventas' | 'almacen' | 'rotacion' | 'seguimiento' | 'referencias'

const PESTANAS: Array<[Pestana, string]> = [
  ['resumen', 'Resumen'],
  ['ventas', 'Ventas por día'],
  ['almacen', 'Almacén'],
  ['rotacion', 'Rotación'],
  ['seguimiento', 'Seguimiento'],
  ['referencias', 'Referencias'],
]

const NARANJA = '#FF6600'
const VERDE = '#34d399'
const GRIS = 'rgba(255,255,255,0.35)'
const TOOLTIP = {
  contentStyle: {
    background: '#111',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 8,
    fontSize: 11,
    color: '#fff',
  },
  labelStyle: { color: 'rgba(255,255,255,0.6)', marginBottom: 2 },
  cursor: { fill: 'rgba(255,255,255,0.05)' },
}

const num = (v: number, dec = 1) => v.toLocaleString('es-ES', { maximumFractionDigits: dec })
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

function descargarCsv(nombre: string, lineas: string[]) {
  const blob = new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  a.click()
  URL.revokeObjectURL(url)
}
const celda = (v: string | number | null) => {
  const t = v === null ? '' : String(v)
  return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
}

export function PestanasRemesa({
  remesa,
  skus,
  hoy,
  referencias,
}: {
  remesa: RemesaDePanel
  skus: SkuDePanel[]
  hoy: string
  /** La tabla de referencias de siempre, que vive en su propia pestaña */
  referencias: React.ReactNode
}) {
  const [pestana, setPestana] = useState<Pestana>('resumen')

  const globales = useMemo(() => new Map(skus.map((s) => [s.sku, s])), [skus])
  const filas = useMemo(() => analizarProductos(remesa, globales, hoy), [remesa, globales, hoy])
  const serie = useMemo(() => serieDeRemesa(remesa, hoy), [remesa, hoy])
  const ritmo = useMemo(() => resumenDeRitmo(remesa, filas, hoy), [remesa, filas, hoy])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto rounded-lg bg-white/[0.03] p-0.5">
        {PESTANAS.map(([id, texto]) => (
          <button
            key={id}
            type="button"
            onClick={() => setPestana(id)}
            className={`whitespace-nowrap rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
              pestana === id ? 'bg-[#FF6600]/15 text-[#FF6600]' : 'text-white/45 hover:text-white/75'
            }`}
          >
            {texto}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {pestana === 'resumen' && <Resumen remesa={remesa} serie={serie} ritmo={ritmo} filas={filas} />}
        {pestana === 'ventas' && <Ventas remesa={remesa} hoy={hoy} />}
        {pestana === 'almacen' && <Almacen filas={filas} />}
        {pestana === 'rotacion' && <Rotacion filas={filas} ritmo={ritmo} />}
        {pestana === 'seguimiento' && <Seguimiento remesa={remesa} />}
        {pestana === 'referencias' && <div className="flex min-h-0 flex-1 flex-col">{referencias}</div>}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Piezas comunes                                                      */
/* ------------------------------------------------------------------ */

function Tarjeta({ titulo, children, derecha }: { titulo?: string; children: React.ReactNode; derecha?: React.ReactNode }) {
  return (
    <div className="glass-card px-3 py-2.5">
      {(titulo || derecha) && (
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-[11px] font-medium text-white/60">{titulo}</p>
          {derecha}
        </div>
      )}
      {children}
    </div>
  )
}

function Dato({ valor, etiqueta, tono, ayuda }: { valor: string; etiqueta: string; tono?: 'acento' | 'aviso' | 'bueno'; ayuda?: string }) {
  const color = tono === 'acento' ? 'text-[#FF6600]' : tono === 'aviso' ? 'text-amber-400' : tono === 'bueno' ? 'text-emerald-400' : 'text-white'
  return (
    <div className="glass-card px-3 py-2" title={ayuda}>
      <p className={`text-[18px] font-semibold leading-none tabular-nums ${color}`}>{valor}</p>
      <p className="mt-1.5 text-[9px] uppercase tracking-wider text-white/35">{etiqueta}</p>
    </div>
  )
}

function Rango({ valor, onCambio, opciones }: { valor: number; onCambio: (n: number) => void; opciones: Array<[number, string]> }) {
  return (
    <div className="flex items-center gap-0.5 text-[10px]">
      {opciones.map(([n, t]) => (
        <button
          key={n}
          type="button"
          onClick={() => onCambio(n)}
          className={`rounded px-1.5 py-0.5 transition-colors ${valor === n ? 'bg-[#FF6600]/15 text-[#FF6600]' : 'text-white/40 hover:text-white/70'}`}
        >
          {t}
        </button>
      ))}
    </div>
  )
}

function ClaseChip({ clase }: { clase: Clase }) {
  const color =
    clase === 'sin_stock'
      ? 'bg-white/10 text-white/50'
      : clase === 'rapida'
        ? 'bg-red-400/15 text-red-300'
        : clase === 'media'
          ? 'bg-amber-400/15 text-amber-300'
          : clase === 'lenta'
            ? 'bg-sky-400/15 text-sky-300'
            : 'bg-white/[0.06] text-white/40'
  return (
    <span title={CLASE_TEXTO[clase].ayuda} className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${color}`}>
      {CLASE_TEXTO[clase].texto}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Resumen                                                             */
/* ------------------------------------------------------------------ */

function Resumen({
  remesa,
  serie,
  ritmo,
  filas,
}: {
  remesa: RemesaDePanel
  serie: ReturnType<typeof serieDeRemesa>
  ritmo: ReturnType<typeof resumenDeRitmo>
  filas: FilaProducto[]
}) {
  const [dias, setDias] = useState(30)
  const datos = useMemo(() => (dias === 0 ? serie : serie.slice(-dias)), [serie, dias])

  const enviadas = remesa.lineas.reduce((s, l) => s + l.enviadas, 0)
  const recibidas = remesa.lineas.reduce((s, l) => s + (l.recibidas ?? 0), 0)
  const sinPreguntar = remesa.lineas.every((l) => l.recibidas === null)
  const vendidas = remesa.lineas.reduce((s, l) => s + l.consumidas, 0)
  const devueltas = remesa.lineas.reduce((s, l) => s + l.devueltas, 0)
  const base = Math.max(1, sinPreguntar ? enviadas : recibidas)

  const alertas: Array<{ tono: 'aviso' | 'malo' | 'info'; texto: string }> = []
  if (remesa.unidadesQueNoLlegaron > 0)
    alertas.push({ tono: 'malo', texto: `${remesa.unidadesQueNoLlegaron} unidades enviadas no figuran como recibidas: se pueden reclamar a Amazon.` })
  if (ritmo.encaminoDeAgotarse > 0)
    alertas.push({ tono: 'aviso', texto: `${ritmo.encaminoDeAgotarse} referencia${ritmo.encaminoDeAgotarse === 1 ? '' : 's'} se agotan en menos de una semana al ritmo actual.` })
  if (ritmo.sinVentas > 0)
    alertas.push({ tono: 'info', texto: `${ritmo.sinVentas} referencia${ritmo.sinVentas === 1 ? '' : 's'} sin ventas en los últimos 30 días.` })
  if (ritmo.agotadas > 0)
    alertas.push({ tono: 'info', texto: `${ritmo.agotadas} de ${filas.length} referencias ya están agotadas.` })

  return (
    <div className="space-y-2.5 pb-2">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
        <Dato valor={String(enviadas)} etiqueta="Enviadas" />
        <Dato valor={sinPreguntar ? '—' : String(recibidas)} etiqueta="Recibidas" tono={remesa.unidadesQueNoLlegaron > 0 ? 'aviso' : undefined} ayuda={sinPreguntar ? 'Todavía no se ha preguntado a Amazon' : undefined} />
        <Dato valor={String(vendidas)} etiqueta="Vendidas" tono="bueno" />
        <Dato valor={String(remesa.quedan)} etiqueta="Quedan" tono="acento" />
        <Dato valor={num(ritmo.udDia7)} etiqueta="Ud/día (7 días)" ayuda="Unidades vendidas por día en la última semana" />
        <Dato
          valor={ritmo.cobertura === null ? '—' : `${num(ritmo.cobertura, 0)} d`}
          etiqueta="Días de stock"
          tono={ritmo.cobertura !== null && ritmo.cobertura < 14 ? 'aviso' : undefined}
          ayuda={ritmo.seAgotaEl ? `Al ritmo actual se agota el ${formatoFecha(ritmo.seAgotaEl)}` : 'No se vende nada ahora mismo'}
        />
      </div>

      <Tarjeta titulo="Del envío a la venta">
        <Embudo etiqueta="Enviadas" valor={enviadas} total={Math.max(1, enviadas)} color="rgba(255,255,255,0.55)" />
        <Embudo etiqueta="Recibidas" valor={sinPreguntar ? null : recibidas} total={Math.max(1, enviadas)} color="#60a5fa" />
        <Embudo etiqueta="Vendidas" valor={vendidas} total={base} color={VERDE} extra={devueltas > 0 ? `${devueltas} devueltas` : undefined} />
        <Embudo etiqueta="Quedan" valor={remesa.quedan} total={base} color={NARANJA} />
      </Tarjeta>

      <Tarjeta
        titulo="Ventas por día y stock que queda"
        derecha={
          <Rango
            valor={dias}
            onCambio={setDias}
            opciones={[
              [14, '14 días'],
              [30, '30 días'],
              [0, 'Todo'],
            ]}
          />
        }
      >
        <GraficoVentasStock datos={datos} />
      </Tarjeta>

      {alertas.length > 0 && (
        <Tarjeta titulo="A tener en cuenta">
          <ul className="space-y-1">
            {alertas.map((a) => (
              <li
                key={a.texto}
                className={`flex items-start gap-2 text-[12px] ${a.tono === 'malo' ? 'text-red-300' : a.tono === 'aviso' ? 'text-amber-300' : 'text-white/60'}`}
              >
                <span className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
                {a.texto}
              </li>
            ))}
          </ul>
        </Tarjeta>
      )}
    </div>
  )
}

function Embudo({ etiqueta, valor, total, color, extra }: { etiqueta: string; valor: number | null; total: number; color: string; extra?: string }) {
  const pct = valor === null ? 0 : Math.min(100, (valor / total) * 100)
  return (
    <div className="mb-1.5 flex items-center gap-2 last:mb-0">
      <span className="w-[68px] shrink-0 text-[11px] text-white/50">{etiqueta}</span>
      <div className="h-3 flex-1 overflow-hidden rounded bg-white/[0.05]">
        <div className="h-full rounded transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="w-[120px] shrink-0 text-right text-[11px] tabular-nums text-white/70">
        {valor === null ? '—' : valor}
        <span className="ml-1 text-white/30">{valor === null ? '' : `${num(pct, 0)} %`}</span>
        {extra && <span className="ml-1 text-amber-300/80">· {extra}</span>}
      </span>
    </div>
  )
}

function GraficoVentasStock({ datos }: { datos: ReturnType<typeof serieDeRemesa> }) {
  if (datos.length === 0) return <p className="py-6 text-center text-[11px] text-white/35">Todavía no hay días que enseñar.</p>
  return (
    <div className="h-[230px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={datos} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis dataKey="fecha" tickFormatter={dm} tick={{ fill: GRIS, fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={22} />
          <YAxis yAxisId="v" tick={{ fill: GRIS, fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
          <YAxis yAxisId="q" orientation="right" tick={{ fill: GRIS, fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip
            {...TOOLTIP}
            labelFormatter={(f) => formatoFecha(String(f))}
            formatter={(v, nombre) => [v as number, nombre === 'vendidas' ? 'Vendidas ese día' : 'Quedan en el almacén']}
          />
          <Bar yAxisId="v" dataKey="vendidas" fill={NARANJA} radius={[3, 3, 0, 0]} maxBarSize={22} />
          <Line yAxisId="q" dataKey="quedan" stroke={VERDE} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Ventas por día                                                      */
/* ------------------------------------------------------------------ */

function Ventas({ remesa, hoy }: { remesa: RemesaDePanel; hoy: string }) {
  const [sku, setSku] = useState<string>('todos')
  const [dias, setDias] = useState(14)

  const linea = sku === 'todos' ? null : (remesa.lineas.find((l) => l.sku === sku) ?? null)
  const serie = useMemo(
    () => (linea ? serieDeLinea(linea, remesa.cuentaDesde, hoy) : serieDeRemesa(remesa, hoy)),
    [linea, remesa, hoy]
  )
  const datos = useMemo(() => serie.slice(-Math.max(dias, 1)), [serie, dias])

  const columnas = useMemo(() => ultimosDias(hoy, remesa.cuentaDesde, dias), [hoy, remesa.cuentaDesde, dias])
  const matriz = useMemo(() => matrizDeVentas(remesa.lineas, columnas), [remesa.lineas, columnas])
  const maxCelda = Math.max(1, ...matriz.flatMap((f) => f.valores))
  const totalPeriodo = datos.reduce((s, d) => s + d.vendidas, 0)

  function descargar() {
    descargarCsv(`ventas-por-dia-${remesa.referenciaEnvio ?? remesa.id.slice(0, 8)}.csv`, [
      ['SKU', 'Producto', ...columnas.map(dm), 'Total'].join(';'),
      ...matriz.map((f) => [f.sku, f.nombre, ...f.valores, f.total].map(celda).join(';')),
    ])
  }

  return (
    <div className="space-y-2.5 pb-2">
      <Tarjeta
        titulo="Ventas por día"
        derecha={
          <div className="flex items-center gap-3">
            <select
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              className="max-w-[260px] rounded border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-white/80 focus:outline-none"
            >
              <option value="todos">Toda la remesa</option>
              {remesa.lineas.map((l) => (
                <option key={l.sku} value={l.sku}>
                  {l.sku}
                  {l.variante ? ` · ${l.variante}` : ''}
                </option>
              ))}
            </select>
            <Rango
              valor={dias}
              onCambio={setDias}
              opciones={[
                [7, '7 d'],
                [14, '14 d'],
                [30, '30 d'],
                [60, '60 d'],
              ]}
            />
          </div>
        }
      >
        <p className="mb-1 text-[11px] text-white/40">
          {linea ? (linea.nombre ?? linea.sku) : 'Toda la remesa'} · {totalPeriodo} unidades en estos {datos.length} días
        </p>
        <div className="h-[210px] w-full">
          {datos.length === 0 ? (
            <p className="py-8 text-center text-[11px] text-white/35">Todavía no hay días que enseñar.</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={datos} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="fecha" tickFormatter={dm} tick={{ fill: GRIS, fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={18} />
                <YAxis yAxisId="v" tick={{ fill: GRIS, fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis yAxisId="a" orientation="right" tick={{ fill: GRIS, fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip
                  {...TOOLTIP}
                  labelFormatter={(f) => formatoFecha(String(f))}
                  formatter={(v, nombre) => [v as number, nombre === 'vendidas' ? 'Vendidas ese día' : 'Acumuladas']}
                />
                <Bar yAxisId="v" dataKey="vendidas" fill={NARANJA} radius={[3, 3, 0, 0]} maxBarSize={24} />
                <Line yAxisId="a" dataKey="acumuladas" stroke="#60a5fa" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </Tarjeta>

      <Tarjeta
        titulo="Producto por producto"
        derecha={
          <button type="button" onClick={descargar} className="flex items-center gap-1 text-[10px] text-white/40 hover:text-white/70">
            <Download className="h-3 w-3" />
            CSV
          </button>
        }
      >
        <div className="max-h-[360px] overflow-auto rounded-lg border border-white/[0.06]">
          <table className="w-full border-separate border-spacing-0">
            <thead className="sticky top-0 z-10 bg-[#0d0d0d]">
              <tr>
                <th className="sticky left-0 z-20 border-b border-white/[0.08] bg-[#0d0d0d] px-2 py-1.5 text-left text-[9px] font-semibold uppercase tracking-wider text-white/35">
                  Producto
                </th>
                {columnas.map((d) => (
                  <th key={d} className="border-b border-white/[0.08] px-1 py-1.5 text-center text-[9px] font-medium text-white/35">
                    {dm(d)}
                  </th>
                ))}
                <th className="border-b border-white/[0.08] px-2 py-1.5 text-right text-[9px] font-semibold uppercase tracking-wider text-white/35">Total</th>
              </tr>
            </thead>
            <tbody>
              {matriz.map((f) => (
                <tr key={f.sku} className="hover:bg-white/[0.02]">
                  <td
                    className="sticky left-0 z-10 max-w-[210px] cursor-pointer truncate border-b border-white/[0.04] bg-[#0d0d0d] px-2 py-1 text-[11px] text-white/70 hover:text-[#FF6600]"
                    title={`${f.nombre ?? ''} — clic para ver solo este producto`}
                    onClick={() => setSku(f.sku)}
                  >
                    <span className="font-mono text-[10px] text-white/45">{f.sku}</span>
                    {f.variante ? <span className="ml-1.5">{f.variante}</span> : null}
                  </td>
                  {f.valores.map((v, i) => (
                    <td
                      key={columnas[i]}
                      className="border-b border-white/[0.04] px-1 py-1 text-center text-[10.5px] tabular-nums"
                      style={{
                        background: v > 0 ? `rgba(255,102,0,${0.12 + 0.55 * (v / maxCelda)})` : undefined,
                        color: v > 0 ? '#fff' : 'rgba(255,255,255,0.18)',
                      }}
                      title={`${f.sku} · ${formatoFecha(columnas[i])}: ${v}`}
                    >
                      {v === 0 ? '·' : v}
                    </td>
                  ))}
                  <td className="border-b border-white/[0.04] px-2 py-1 text-right text-[11px] font-semibold tabular-nums text-white">{f.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Tarjeta>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Almacén                                                             */
/* ------------------------------------------------------------------ */

type FiltroAlmacen = 'todas' | 'con_stock' | 'agotadas' | 'descuadre'

function Almacen({ filas }: { filas: FilaProducto[] }) {
  const [filtro, setFiltro] = useState<FiltroAlmacen>('con_stock')
  const [busca, setBusca] = useState('')

  const cuenta = useMemo(
    () => ({
      todas: filas.length,
      con_stock: filas.filter((f) => f.quedan > 0).length,
      agotadas: filas.filter((f) => f.quedan === 0).length,
      descuadre: filas.filter((f) => f.descuadre !== null && f.descuadre !== 0).length,
    }),
    [filas]
  )

  const visibles = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return filas
      .filter((f) => (filtro === 'con_stock' ? f.quedan > 0 : filtro === 'agotadas' ? f.quedan === 0 : filtro === 'descuadre' ? f.descuadre !== null && f.descuadre !== 0 : true))
      .filter((f) => !t || f.sku.toLowerCase().includes(t) || (f.nombre ?? '').toLowerCase().includes(t))
      .sort((a, b) => b.quedan - a.quedan || a.sku.localeCompare(b.sku))
  }, [filas, filtro, busca])

  const maxQuedan = Math.max(1, ...filas.map((f) => f.quedan))

  return (
    <Tarjeta
      titulo="Lo que queda de esta remesa en el almacén"
      derecha={
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="SKU o nombre"
          className="w-[170px] rounded border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-white placeholder:text-white/25 focus:outline-none"
        />
      }
    >
      <div className="mb-2 flex flex-wrap gap-1">
        {(
          [
            ['con_stock', 'Con stock'],
            ['agotadas', 'Agotadas'],
            ['descuadre', 'Con descuadre'],
            ['todas', 'Todas'],
          ] as Array<[FiltroAlmacen, string]>
        ).map(([k, t]) => (
          <button
            key={k}
            type="button"
            onClick={() => setFiltro(k)}
            className={`rounded px-2 py-0.5 text-[11px] transition-colors ${filtro === k ? 'bg-[#FF6600]/15 text-[#FF6600]' : 'bg-white/[0.04] text-white/45 hover:text-white/75'}`}
          >
            {t} ({cuenta[k]})
          </button>
        ))}
      </div>

      <div className="max-h-[480px] overflow-auto rounded-lg border border-white/[0.06]">
        <table className="w-full">
          <thead className="sticky top-0 z-10 bg-[#0d0d0d]">
            <tr>
              {['SKU', 'Producto', 'Recib.', 'Vend.', 'Quedan', '', 'En Amazon', 'Descuadre'].map((h, i) => (
                <th
                  key={`${h}${i}`}
                  className={`border-b border-white/[0.08] px-2 py-1.5 text-[9px] font-semibold uppercase tracking-wider text-white/35 ${i >= 2 && i !== 5 ? 'text-right' : 'text-left'}`}
                  title={h === 'En Amazon' ? 'Lo que Amazon dice que hay AHORA de este SKU, sumando todos sus envíos' : h === 'Descuadre' ? 'Stock real de Amazon menos lo que dicen las remesas. Positivo: hay más de lo que las remesas explican' : undefined}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibles.map((f) => (
              <tr key={f.sku} className={`border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] ${f.quedan === 0 ? 'opacity-50' : ''}`}>
                <td className="whitespace-nowrap px-2 py-1.5 font-mono text-[11px] text-white/60">{f.sku}</td>
                <td className="max-w-[240px] truncate px-2 py-1.5 text-[12px] text-white/80" title={f.nombre ?? ''}>
                  {f.nombre ?? '—'}
                  {f.variante ? <span className="ml-1.5 text-white/40">{f.variante}</span> : null}
                </td>
                <td className="px-2 py-1.5 text-right text-[12px] tabular-nums text-white/55">{f.recibidas ?? f.enviadas}</td>
                <td className="px-2 py-1.5 text-right text-[12px] tabular-nums text-white/80">{f.vendidas}</td>
                <td className="px-2 py-1.5 text-right text-[13px] font-semibold tabular-nums text-[#FF6600]">{f.quedan}</td>
                <td className="w-[110px] px-2 py-1.5">
                  <div className="h-2 overflow-hidden rounded bg-white/[0.06]">
                    <div className="h-full rounded bg-[#FF6600]/70" style={{ width: `${(f.quedan / maxQuedan) * 100}%` }} />
                  </div>
                </td>
                <td className="px-2 py-1.5 text-right text-[12px] tabular-nums text-white/60">{f.stockReal ?? '—'}</td>
                <td
                  className={`px-2 py-1.5 text-right text-[12px] tabular-nums ${f.descuadre === null || f.descuadre === 0 ? 'text-white/25' : 'font-semibold text-amber-400'}`}
                >
                  {f.descuadre === null ? '—' : f.descuadre > 0 ? `+${f.descuadre}` : f.descuadre}
                </td>
              </tr>
            ))}
            {visibles.length === 0 && (
              <tr>
                <td colSpan={8} className="px-2 py-6 text-center text-[11px] text-white/35">
                  Nada que enseñar con este filtro.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-white/30">
        «Quedan» es lo recibido menos lo vendido de ESTA remesa, repartido por antigüedad (Amazon mezcla los lotes).
        «En Amazon» es el stock real de ese SKU sumando todos sus envíos, y se refresca una vez al día.
      </p>
    </Tarjeta>
  )
}

/* ------------------------------------------------------------------ */
/* Rotación                                                            */
/* ------------------------------------------------------------------ */

function Rotacion({ filas, ritmo }: { filas: FilaProducto[]; ritmo: ReturnType<typeof resumenDeRitmo> }) {
  const [orden, setOrden] = useState<'urgencia' | 'ritmo' | 'vendidas'>('urgencia')

  const ordenadas = useMemo(() => {
    const l = [...filas]
    if (orden === 'ritmo') return l.sort((a, b) => b.udDia7 - a.udDia7 || a.sku.localeCompare(b.sku))
    if (orden === 'vendidas') return l.sort((a, b) => b.vendidas - a.vendidas || a.sku.localeCompare(b.sku))
    const cob = (f: FilaProducto) => (f.clase === 'sin_stock' ? Number.POSITIVE_INFINITY : (f.cobertura ?? Number.POSITIVE_INFINITY - 1))
    return l.sort((a, b) => cob(a) - cob(b) || a.sku.localeCompare(b.sku))
  }, [filas, orden])

  const top = useMemo(
    () =>
      [...filas]
        .filter((f) => f.vendidas > 0)
        .sort((a, b) => b.vendidas - a.vendidas)
        .slice(0, 10)
        .map((f) => ({ etiqueta: f.variante ? `${f.sku.slice(-8)} · ${f.variante}` : f.sku.slice(-12), vendidas: f.vendidas, quedan: f.quedan })),
    [filas]
  )

  return (
    <div className="space-y-2.5 pb-2">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <Dato valor={num(ritmo.udDia7)} etiqueta="Ud/día · 7 días" />
        <Dato valor={num(ritmo.udDia30)} etiqueta="Ud/día · 30 días" />
        <Dato valor={num(ritmo.udDiaRemesa)} etiqueta="Ud/día · desde la llegada" />
        <Dato valor={`${ritmo.diasConVentas}/${ritmo.diasTotales}`} etiqueta="Días con ventas" />
        <Dato
          valor={ritmo.seAgotaEl ? formatoFecha(ritmo.seAgotaEl) : '—'}
          etiqueta="Se agota (al ritmo actual)"
          tono={ritmo.cobertura !== null && ritmo.cobertura < 14 ? 'aviso' : undefined}
        />
      </div>

      {top.length > 0 && (
        <Tarjeta titulo="Los 10 que más se han vendido">
          <div className="h-[240px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={top} layout="vertical" margin={{ top: 0, right: 14, left: 8, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" horizontal={false} />
                <XAxis type="number" tick={{ fill: GRIS, fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="etiqueta" width={120} tick={{ fill: 'rgba(255,255,255,0.55)', fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip {...TOOLTIP} formatter={(v, n) => [v as number, n === 'vendidas' ? 'Vendidas' : 'Quedan']} />
                <Bar dataKey="vendidas" stackId="a" fill={NARANJA} radius={[0, 0, 0, 0]} />
                <Bar dataKey="quedan" stackId="a" fill="rgba(255,255,255,0.14)" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-[10px] text-white/30">Naranja: vendidas. Gris: lo que queda.</p>
        </Tarjeta>
      )}

      <Tarjeta
        titulo="Rotación por producto"
        derecha={
          <div className="flex items-center gap-1 text-[10px] text-white/40">
            Ordenar por
            {(
              [
                ['urgencia', 'urgencia'],
                ['ritmo', 'ritmo'],
                ['vendidas', 'vendidas'],
              ] as Array<[typeof orden, string]>
            ).map(([k, t]) => (
              <button
                key={k}
                type="button"
                onClick={() => setOrden(k)}
                className={`rounded px-1.5 py-0.5 ${orden === k ? 'bg-[#FF6600]/15 text-[#FF6600]' : 'hover:text-white/70'}`}
              >
                {t}
              </button>
            ))}
          </div>
        }
      >
        <div className="max-h-[420px] overflow-auto rounded-lg border border-white/[0.06]">
          <table className="w-full">
            <thead className="sticky top-0 z-10 bg-[#0d0d0d]">
              <tr>
                {['SKU', 'Producto', 'Vendidas', 'Ud/día 7 d', 'Ud/día total', 'Quedan', 'Días de stock', 'Se agota', 'Rotación'].map((h, i) => (
                  <th key={h} className={`border-b border-white/[0.08] px-2 py-1.5 text-[9px] font-semibold uppercase tracking-wider text-white/35 ${i >= 2 && i <= 6 ? 'text-right' : 'text-left'}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ordenadas.map((f) => (
                <tr key={f.sku} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]">
                  <td className="whitespace-nowrap px-2 py-1.5 font-mono text-[11px] text-white/60">{f.sku}</td>
                  <td className="max-w-[220px] truncate px-2 py-1.5 text-[12px] text-white/80" title={f.nombre ?? ''}>
                    {f.nombre ?? '—'}
                    {f.variante ? <span className="ml-1.5 text-white/40">{f.variante}</span> : null}
                  </td>
                  <td className="px-2 py-1.5 text-right text-[12px] tabular-nums text-white/80">{f.vendidas}</td>
                  <td className="px-2 py-1.5 text-right text-[12px] tabular-nums text-white/60">{num(f.udDia7, 2)}</td>
                  <td className="px-2 py-1.5 text-right text-[12px] tabular-nums text-white/45">{num(f.udDiaRemesa, 2)}</td>
                  <td className="px-2 py-1.5 text-right text-[12px] tabular-nums text-[#FF6600]">{f.quedan}</td>
                  <td className="px-2 py-1.5 text-right text-[12px] tabular-nums text-white/70">{f.cobertura === null ? '—' : num(f.cobertura, 0)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-[11px] text-white/45">{f.seAgotaEl ? formatoFecha(f.seAgotaEl) : '—'}</td>
                  <td className="px-2 py-1.5">
                    <ClaseChip clase={f.clase} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-white/30">
          Los días de stock salen de lo que queda de esta remesa entre lo vendido por día en la última semana.
          Rápida: menos de 14 días. Media: hasta 45. Lenta: más. Sin ventas: nada en 30 días.
        </p>
      </Tarjeta>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Seguimiento                                                         */
/* ------------------------------------------------------------------ */

function Seguimiento({ remesa }: { remesa: RemesaDePanel }) {
  const datos = remesa.eventos
    .filter((e) => e.recibidas !== null)
    .map((e) => ({ t: new Date(e.vistoAt).getTime(), recibidas: e.recibidas as number, enviadas: e.enviadas ?? 0 }))

  return (
    <div className="space-y-2.5 pb-2">
      <SeguimientoEnvio remesa={remesa} />
      {datos.length >= 2 && (
        <Tarjeta titulo="Unidades recibidas por Amazon, a lo largo del tiempo">
          <div className="h-[200px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={datos} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis
                  dataKey="t"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  scale="time"
                  tickFormatter={(t) => new Date(t as number).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })}
                  tick={{ fill: GRIS, fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis tick={{ fill: GRIS, fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip
                  {...TOOLTIP}
                  labelFormatter={(t) => new Date(t as number).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  formatter={(v, n) => [v as number, n === 'recibidas' ? 'Recibidas' : 'Enviadas']}
                />
                <Line type="stepAfter" dataKey="enviadas" stroke="rgba(255,255,255,0.35)" strokeDasharray="4 3" dot={false} />
                <Line type="stepAfter" dataKey="recibidas" stroke="#60a5fa" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Tarjeta>
      )}
    </div>
  )
}
