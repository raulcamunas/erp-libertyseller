'use client'

import { Area, CartesianGrid, ComposedChart, Line, ReferenceDot, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import type { LlegadaPrevista } from '@/lib/fba/plan-tipos'
import { diasEntre, entero, fechaCorta, sumarDias } from '../formato'
import { DURACION_ANIMACION, EJE, Grafico, tooltipDe, useAnimarGraficos, VIZ } from './graficos'
import { Clave, cx } from './ui'

/**
 * PROYECCIÓN DEL STOCK DE UNA REFERENCIA, DÍA A DÍA (spec remesas-pro §11 D43.1: «para fiarse del plan»).
 *
 * Un minigráfico con lo que quedará en Amazon cada día si se vende al ritmo del plan:
 *   · área naranja (`--viz-2`, «quedan») = stock sin enviar nada más;
 *   · rombos = llegadas conocidas (envíos de camino, remesas comprometidas, entrantes de Amazon). Las DUDOSAS
 *     (envío viejo sin recibir nada, D3) van huecas y NO suman: así es como las cuenta el plan;
 *   · línea discontinua cian = con el envío propuesto, que llega «a la venta» en su fecha (rombo cian);
 *   · raya roja = rotura; raya cian = fecha «a la venta».
 * Debajo, la lista de llegadas en texto (el gráfico no es la única forma de leerlo).
 *
 * API
 *   <ProyeccionStock hoy vendibles consumoDia llegadas proyeccion? fechaRotura? aLaVenta? cantidadPropuesta? dias? alto? />
 *     consumoDia: ud/día (el consumo neto del plan, `ritmo.consumoNeto ?? ritmo.previsto`) o una función por fecha
 *     llegadas: las `LlegadaPrevista` de la referencia (basta fecha, unidades, dudoso, nombre, origen)
 *     proyeccion: la de `simularStock` si se tiene; si no, se calcula aquí con `proyectarStock`
 *   proyectarStock({ hoy, vendibles, consumoDia, llegadas, dias })  puro (con prueba): [{ fecha, stock }]
 */

type Llegada = Pick<LlegadaPrevista, 'fecha' | 'unidades' | 'dudoso'> & Partial<Pick<LlegadaPrevista, 'nombre' | 'origen'>>

export interface ProyeccionStockProps {
  hoy: string
  vendibles: number
  consumoDia: number | ((fecha: string) => number)
  llegadas: ReadonlyArray<Llegada>
  proyeccion?: ReadonlyArray<{ fecha: string; stock: number }> | null
  fechaRotura?: string | null
  /** Cuándo estaría a la venta lo que se propone enviar */
  aLaVenta?: string | null
  /** Unidades propuestas que llegarían en `aLaVenta` (dibuja la línea «con el envío») */
  cantidadPropuesta?: number | null
  /** Días que se dibujan; por defecto los que hagan falta para ver la rotura y las llegadas (60-180) */
  dias?: number
  alto?: number
  className?: string
}

/**
 * El stock al CIERRE de cada día desde hoy: se suma lo que llega ese día y se resta el consumo. No baja de 0 (lo que
 * no se vende sin stock no se recupera). Las llegadas dudosas no suman.
 */
export function proyectarStock(e: {
  hoy: string
  vendibles: number
  consumoDia: number | ((fecha: string) => number)
  llegadas: ReadonlyArray<Llegada>
  dias: number
  extra?: { fecha: string; unidades: number } | null
}): Array<{ fecha: string; stock: number }> {
  const consumo = typeof e.consumoDia === 'function' ? e.consumoDia : () => e.consumoDia as number
  const porDia = new Map<string, number>()
  for (const l of e.llegadas) {
    if (l.dudoso || !(l.unidades > 0)) continue
    const f = l.fecha < e.hoy ? e.hoy : l.fecha
    porDia.set(f, (porDia.get(f) ?? 0) + l.unidades)
  }
  if (e.extra && e.extra.unidades > 0) {
    const f = e.extra.fecha < e.hoy ? e.hoy : e.extra.fecha
    porDia.set(f, (porDia.get(f) ?? 0) + e.extra.unidades)
  }
  const salida: Array<{ fecha: string; stock: number }> = []
  let stock = Math.max(0, e.vendibles)
  for (let i = 0; i <= e.dias; i++) {
    const f = sumarDias(e.hoy, i)
    if (i > 0) stock = Math.max(0, stock - Math.max(0, consumo(f) || 0))
    stock += porDia.get(f) ?? 0
    salida.push({ fecha: f, stock: Math.round(stock * 10) / 10 })
  }
  return salida
}

/** Cuántos días dibujar: hasta ver la rotura, la venta y las llegadas con algo de aire (60 a 180) */
export function diasDeProyeccion(hoy: string, fechas: ReadonlyArray<string | null | undefined>): number {
  let max = 60
  for (const f of fechas) if (f) max = Math.max(max, diasEntre(hoy, f) + 21)
  return Math.min(180, max)
}

/** Un rombo de 10 px; hueco = no cuenta */
function Rombo({ cx: x, cy: y, color, hueco }: { cx?: number; cy?: number; color: string; hueco?: boolean }) {
  if (typeof x !== 'number' || typeof y !== 'number') return <g />
  const r = 5.5
  return <path d={`M ${x} ${y - r} L ${x + r} ${y} L ${x} ${y + r} L ${x - r} ${y} Z`} fill={hueco ? 'var(--ls-sup)' : color} stroke={color} strokeWidth={hueco ? 1.6 : 1.2} />
}

export function ProyeccionStock({
  hoy,
  vendibles,
  consumoDia,
  llegadas,
  proyeccion,
  fechaRotura = null,
  aLaVenta = null,
  cantidadPropuesta = null,
  dias,
  alto = 150,
  className,
}: ProyeccionStockProps) {
  const horizonte = dias ?? diasDeProyeccion(hoy, [fechaRotura, aLaVenta, ...llegadas.map((l) => l.fecha)])
  const base = proyeccion && proyeccion.length > 0 ? proyeccion.slice(0, horizonte + 1) : proyectarStock({ hoy, vendibles, consumoDia, llegadas, dias: horizonte })
  const conEnvio =
    aLaVenta && cantidadPropuesta && cantidadPropuesta > 0
      ? proyectarStock({ hoy, vendibles, consumoDia, llegadas, dias: base.length - 1, extra: { fecha: aLaVenta, unidades: cantidadPropuesta } })
      : null
  const filas = base.map((p, i) => ({ fecha: p.fecha, stock: p.stock, conEnvio: conEnvio ? conEnvio[i]?.stock ?? null : null }))
  const ultima = filas[filas.length - 1]?.fecha ?? hoy
  const dentro = (f: string | null | undefined): f is string => !!f && f >= hoy && f <= ultima
  const stockEn = (f: string, clave: 'stock' | 'conEnvio' = 'stock') => {
    const fila = filas.find((x) => x.fecha === (f < hoy ? hoy : f))
    return fila ? (fila[clave] ?? fila.stock) : 0
  }
  const animar = useAnimarGraficos(filas.length)
  const Contenido = tooltipDe(
    [
      { key: 'stock', nombre: 'sin enviar más', color: VIZ.quedan, formato: (v) => `${entero(v)} ud` },
      ...(conEnvio ? [{ key: 'conEnvio', nombre: 'con el envío propuesto', color: COLOR_ESTADO.cian, formato: (v: number) => `${entero(v)} ud` }] : []),
    ],
    (l) => fechaCorta(String(l), hoy)
  )
  const visibles = llegadas.filter((l) => l.unidades > 0)
  const resumen = [
    `Stock hoy ${entero(vendibles)} ud`,
    fechaRotura ? `rotura el ${fechaCorta(fechaRotura, hoy)}` : 'sin rotura en el horizonte',
    aLaVenta ? `a la venta el ${fechaCorta(aLaVenta, hoy)}` : null,
    ...visibles.map((l) => `${l.dudoso ? 'llegada dudosa (no cuenta)' : 'llegan'} ${entero(l.unidades)} ud el ${fechaCorta(l.fecha, hoy)}`),
  ]
    .filter(Boolean)
    .join('; ')

  return (
    <div className={cx('min-w-0 w-full', className)}>
      <Grafico etiqueta={`Proyección del stock: ${resumen}`} alto={alto} vacio={filas.length === 0}>
        <ComposedChart data={filas} margin={{ top: 14, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={EJE.rejilla} vertical={false} />
          <XAxis dataKey="fecha" tickFormatter={(v: string) => fechaCorta(v)} tick={EJE.tick} axisLine={{ stroke: EJE.linea }} tickLine={false} minTickGap={28} />
          <YAxis tick={EJE.tick} axisLine={false} tickLine={false} allowDecimals={false} width={34} tickMargin={4} domain={[0, 'auto']} />
          <Tooltip content={<Contenido />} cursor={{ stroke: 'var(--ls-linea2)', strokeWidth: 1 }} isAnimationActive={false} />
          <Area type="stepAfter" dataKey="stock" stroke={VIZ.quedan} strokeWidth={2} fill={VIZ.quedan} fillOpacity={0.1} dot={false} isAnimationActive={animar} animationDuration={DURACION_ANIMACION} />
          {conEnvio && <Line type="stepAfter" dataKey="conEnvio" stroke={COLOR_ESTADO.cian} strokeWidth={1.6} strokeDasharray="5 4" dot={false} isAnimationActive={false} />}
          {dentro(fechaRotura) && (
            <ReferenceLine
              x={fechaRotura}
              stroke={COLOR_ESTADO.rojo}
              strokeDasharray="3 3"
              label={{ value: `rotura ${fechaCorta(fechaRotura)}`, position: 'insideTopRight', fill: COLOR_ESTADO.rojo, fontSize: 10.5 }}
            />
          )}
          {dentro(aLaVenta) && (
            <ReferenceLine
              x={aLaVenta}
              stroke={COLOR_ESTADO.cian}
              strokeDasharray="3 3"
              label={{ value: `a la venta ${fechaCorta(aLaVenta)}`, position: 'insideTopLeft', fill: COLOR_ESTADO.cian, fontSize: 10.5 }}
            />
          )}
          {visibles.filter((l) => dentro(l.fecha < hoy ? hoy : l.fecha)).map((l, i) => {
            const f = l.fecha < hoy ? hoy : l.fecha
            return <ReferenceDot key={`l${i}`} x={f} y={stockEn(f)} r={6} shape={(p: { cx?: number; cy?: number }) => <Rombo {...p} color={VIZ.recibidas} hueco={l.dudoso} />} />
          })}
          {conEnvio && dentro(aLaVenta) && (
            <ReferenceDot x={aLaVenta} y={stockEn(aLaVenta, 'conEnvio')} r={6} shape={(p: { cx?: number; cy?: number }) => <Rombo {...p} color={COLOR_ESTADO.cian} />} />
          )}
        </ComposedChart>
      </Grafico>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <Clave color={VIZ.quedan}>Stock sin enviar más</Clave>
        {conEnvio && <Clave color={COLOR_ESTADO.cian}>Con el envío propuesto ({entero(cantidadPropuesta)} ud)</Clave>}
        {fechaRotura && <Clave color={COLOR_ESTADO.rojo}>Rotura: {fechaCorta(fechaRotura, hoy)}</Clave>}
      </div>
      {visibles.length > 0 && (
        <ul className="mt-2 space-y-[3px] text-[11.5px] leading-[1.45] text-[var(--ls-t3)]">
          {visibles.map((l, i) => (
            <li key={i} className="flex min-w-0 items-start gap-[6px]">
              <svg aria-hidden viewBox="0 0 12 12" className="mt-[3px] h-[10px] w-[10px] shrink-0">
                <path d="M6 1 L11 6 L6 11 L1 6 Z" fill={l.dudoso ? 'none' : VIZ.recibidas} stroke={VIZ.recibidas} strokeWidth={1.4} />
              </svg>
              <span className="min-w-0">
                <b className="font-semibold tabular-nums text-[var(--ls-t2)]">{entero(l.unidades)} ud</b> el {fechaCorta(l.fecha < hoy ? hoy : l.fecha, hoy)}
                {l.nombre ? <> · {l.nombre}</> : null}
                {l.dudoso && <span style={{ color: COLOR_ESTADO.ambar }}> · dudoso: no cuenta para la cobertura</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
