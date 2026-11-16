'use client'

import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useReducedMotion } from 'framer-motion'
import { BarChart3, Download, Table2 } from 'lucide-react'
import { EstadoVacio } from '@/components/ui-ls/EstadoVacio'
import { BOTON } from '@/lib/estilo/denso'
import { decimal, dinero, entero, fechaCorta, simboloDe } from '../formato'
import { bajarBlob } from './descargar'
import { Clave, cx, Segmentado, Tarjeta } from './ui'

/**
 * LAS PIEZAS DE LOS GRÁFICOS DE REMESAS.
 *
 * Siguen la guía de visualización de datos, no el gusto del momento:
 *
 *   · UN SOLO EJE. Dos magnitudes distintas —ventas del día y stock que queda—
 *     son DOS gráficos pequeños, uno encima de otro y con el cursor sincronizado,
 *     nunca una gráfica con dos escalas: la alineación de dos escalas es
 *     arbitraria e inventa correlaciones.
 *   · Marcas finas: columnas de 24 px como mucho, esquina de 4 px solo en el
 *     extremo del dato; líneas de 2 px; puntos de 8 px con un aro de 2 px del
 *     color de la superficie; área al 10 %.
 *   · Rejilla de un píxel, continua y apagada; ejes sin raya gorda.
 *   · Tooltip con el VALOR primero y el nombre de la serie detrás, y una raya
 *     corta del color de la serie, no una caja.
 *   · El color sigue a la ENTIDAD: «vendidas» es siempre azul y «quedan» siempre
 *     naranja, en todos los gráficos de la pantalla (variables --viz-*, que se
 *     definen en app/globals.css y se han validado en los dos temas).
 *   · Toda gráfica tiene su TABLA al lado: el tooltip no es la única forma de
 *     leer un valor.
 *
 * Excepción anotada al eje único: `GraficoVentasCompuesto` lleva unidades (barras, eje izquierdo) y € con media
 * móvil (línea, eje derecho), porque lo pide la spec de remesas-pro §6.3. El eje de € se rotula con su moneda
 * y el tooltip da las dos cifras con su unidad, para que nadie lea una correlación en la alineación.
 *
 * API
 *   VIZ, EJE, dm(iso), dmy(iso), tooltipDe(series, titulo)          (los de siempre)
 *   <ColumnasPorDia>, <AreaPorDia>, <TablaDeDatos>, <TarjetaGrafico>, descargarCsv(nombre, cabecera, filas)
 *   animarGraficos(puntos?, reducir?)  true si se puede animar: sin «reducir movimiento» y ≤ 400 puntos (400 ms)
 *   useAnimarGraficos(puntos)          lo mismo en un componente (sigue a la preferencia del sistema)
 *   <Grafico alto? etiqueta vacio? textoVacio? className?>{<BarChart …/>}</Grafico>
 *       contenedor `min-w-0 w-full` con ResponsiveContainer dentro; alto 220 en el móvil y 280 en el escritorio
 *       (o el número que se le dé). Solo monta el gráfico cuando es VISIBLE (IntersectionObserver): uno dentro de
 *       una pestaña oculta o de un bloque `hidden lg:block` no gasta nada. `vacio` → EstadoVacio compacto.
 *   <GraficoBarrasApiladas datos claveX series formatoX? formatoValor? unidad? etiqueta>
 *       barras apiladas (salidas por semana y cliente…): verticales en el escritorio y horizontales en el móvil
 *       (la categoría en el eje Y), decidido por CSS para que no salte al hidratar.
 *   <GraficoVentasCompuesto datos anterior? moneda porSemana? etiqueta>
 *       barras de unidades por día + línea de € con media móvil de 7 días + línea discontinua del periodo anterior.
 *   mediaMovil(valores, n)             puro: media de los n últimos (los null no cuentan; null si no hay ninguno)
 */

export const VIZ = {
  vendidas: 'var(--viz-1)',
  quedan: 'var(--viz-2)',
  recibidas: 'var(--viz-3)',
} as const

export const EJE = {
  tick: { fill: 'var(--ls-t4)', fontSize: 11 },
  linea: 'var(--ls-linea2)',
  rejilla: 'var(--ls-linea)',
} as const

export const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
export const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`

/* ------------------------------------------------------------------ */
/* Tooltip                                                             */
/* ------------------------------------------------------------------ */

export interface SerieTooltip {
  key: string
  nombre: string
  color: string
  formato?: (v: number) => string
}

interface PropsTooltip {
  active?: boolean
  label?: string | number
  payload?: Array<{ dataKey?: string | number; value?: number | string; payload?: Record<string, unknown> }>
}

/**
 * El contenido del tooltip de Recharts. Los nombres de las series vienen de
 * nuestro código, pero se pintan como TEXTO de React, nunca como HTML.
 */
export function tooltipDe(series: SerieTooltip[], titulo: (label: string | number) => string) {
  return function TooltipSerie({ active, payload, label }: PropsTooltip) {
    if (!active || !payload || payload.length === 0) return null
    return (
      <div className="pointer-events-none min-w-[150px] rounded-[6px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-[10px] py-[8px] shadow-lg">
        <p className="mb-[5px] text-[11px] text-[var(--ls-t4)]">{titulo(label ?? '')}</p>
        <div className="space-y-[4px]">
          {series.map((s) => {
            const fila = payload.find((p) => p.dataKey === s.key)
            if (!fila || fila.value === undefined || fila.value === null) return null
            const v = Number(fila.value)
            return (
              <div key={s.key} className="flex items-center gap-[8px]">
                <span className="h-[2px] w-[12px] shrink-0 rounded-full" style={{ background: s.color }} />
                <span className="text-[13px] font-semibold tabular-nums text-[var(--ls-t1)]">
                  {s.formato ? s.formato(v) : v.toLocaleString('es-ES')}
                </span>
                <span className="text-[11.5px] text-[var(--ls-t3)]">{s.nombre}</span>
              </div>
            )
          })}
        </div>
      </div>
    )
  }
}

/* ------------------------------------------------------------------ */
/* Columnas por día                                                    */
/* ------------------------------------------------------------------ */

/** Cualquier fila con una `fecha`: las series diarias traen además sus propios valores */
export interface PuntoDia {
  fecha: string
}

/**
 * El eje Y de los gráficos por día: las cifras con su separador de miles y el ancho que pide la más larga (con 30 px fijos,
 * 1.800 se leía «800»). Se mide sobre el máximo redondeado hacia arriba, que es donde recharts pone la última marca.
 */
function ejeYDe(datos: ReadonlyArray<Record<string, unknown>>, clave: string): { width: number; tickFormatter: (v: number) => string } {
  let max = 0
  for (const d of datos) {
    const v = Number(d[clave])
    if (Number.isFinite(v) && Math.abs(v) > max) max = Math.abs(v)
  }
  const magnitud = max > 0 ? Math.pow(10, Math.floor(Math.log10(max))) : 1
  const techo = Math.ceil(max / magnitud) * magnitud
  const texto = entero(techo)
  return { width: Math.max(30, texto.length * 7 + 8), tickFormatter: (v: number) => entero(v) }
}

/**
 * Columnas, una por día. Con `ejeX` apagado sirve de gráfico de arriba en un par
 * sincronizado: solo el de abajo lleva las fechas.
 */
export function ColumnasPorDia({
  datos,
  clave,
  nombre,
  color,
  alto = 150,
  ejeX = true,
  syncId,
}: {
  datos: PuntoDia[]
  clave: string
  nombre: string
  color: string
  alto?: number
  ejeX?: boolean
  syncId?: string
}) {
  const Contenido = tooltipDe([{ key: clave, nombre, color }], (l) => dmy(String(l)))
  const ejeY = ejeYDe(datos as unknown as ReadonlyArray<Record<string, unknown>>, clave)
  return (
    <div style={{ height: alto }} className="w-full" role="img" aria-label={`${nombre} por día`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={datos} syncId={syncId} margin={{ top: 8, right: 6, left: 0, bottom: 0 }} barCategoryGap="22%">
          <CartesianGrid stroke={EJE.rejilla} vertical={false} />
          <XAxis
            dataKey="fecha"
            tickFormatter={dm}
            tick={EJE.tick}
            axisLine={{ stroke: EJE.linea }}
            tickLine={false}
            minTickGap={22}
            hide={!ejeX}
            height={ejeX ? 22 : 0}
          />
          <YAxis tick={EJE.tick} axisLine={false} tickLine={false} allowDecimals={false} width={ejeY.width} tickFormatter={ejeY.tickFormatter} tickMargin={4} />
          <Tooltip content={<Contenido />} cursor={{ fill: 'var(--ls-sup3)', opacity: 0.7 }} isAnimationActive={false} />
          <Bar
            dataKey={clave}
            fill={color}
            fillOpacity={0.9}
            radius={[4, 4, 0, 0]}
            maxBarSize={24}
            activeBar={{ fillOpacity: 1, stroke: 'var(--ls-t1)', strokeWidth: 1 }}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Área / línea por día                                                */
/* ------------------------------------------------------------------ */

export function AreaPorDia({
  datos,
  clave,
  nombre,
  color,
  alto = 150,
  ejeX = true,
  syncId,
  paso = false,
}: {
  datos: PuntoDia[]
  clave: string
  nombre: string
  color: string
  alto?: number
  ejeX?: boolean
  syncId?: string
  /** true = escalón: el stock cambia al cierre de cada día, no entre medias */
  paso?: boolean
}) {
  const Contenido = tooltipDe([{ key: clave, nombre, color }], (l) => dmy(String(l)))
  const ejeY = ejeYDe(datos as unknown as ReadonlyArray<Record<string, unknown>>, clave)
  const ultimo = datos.length - 1
  return (
    <div style={{ height: alto }} className="w-full" role="img" aria-label={`${nombre} por día`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={datos} syncId={syncId} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={EJE.rejilla} vertical={false} />
          <XAxis
            dataKey="fecha"
            tickFormatter={dm}
            tick={EJE.tick}
            axisLine={{ stroke: EJE.linea }}
            tickLine={false}
            minTickGap={22}
            hide={!ejeX}
            height={ejeX ? 22 : 0}
          />
          <YAxis tick={EJE.tick} axisLine={false} tickLine={false} allowDecimals={false} width={ejeY.width} tickFormatter={ejeY.tickFormatter} tickMargin={4} domain={[0, 'auto']} />
          <Tooltip content={<Contenido />} cursor={{ stroke: 'var(--ls-linea2)', strokeWidth: 1 }} isAnimationActive={false} />
          <Area
            type={paso ? 'stepAfter' : 'monotone'}
            dataKey={clave}
            stroke={color}
            strokeWidth={2}
            fill={color}
            fillOpacity={0.1}
            isAnimationActive={false}
            activeDot={{ r: 5, fill: color, stroke: 'var(--ls-sup)', strokeWidth: 2 }}
            dot={(p: { cx?: number; cy?: number; index?: number }) =>
              p.index === ultimo && typeof p.cx === 'number' && typeof p.cy === 'number' ? (
                // El punto final: 8 px y su aro de superficie, para ver dónde acaba hoy
                <circle key="fin" cx={p.cx} cy={p.cy} r={4} fill={color} stroke="var(--ls-sup)" strokeWidth={2} />
              ) : (
                <g key={`n${p.index}`} />
              )
            }
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* La tarjeta de un gráfico, con su tabla                              */
/* ------------------------------------------------------------------ */

export interface ColumnaTabla {
  clave: string
  titulo: string
  numero?: boolean
  formato?: (v: string | number) => string
}

/** La tabla gemela de un gráfico: la forma de leerlo sin el ratón */
export function TablaDeDatos({ columnas, filas, alto = 260 }: { columnas: ColumnaTabla[]; filas: ReadonlyArray<object>; alto?: number }) {
  return (
    <div className="overflow-auto rounded-[6px] border border-[var(--ls-linea)]" style={{ maxHeight: alto }}>
      <table className="w-full border-separate border-spacing-0 text-[12px]">
        <thead>
          <tr>
            {columnas.map((c) => (
              <th
                key={c.clave}
                className={cx(
                  'sticky top-0 h-[26px] border-b border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-2 text-[11px] font-semibold text-[var(--ls-t4)]',
                  c.numero ? 'text-right' : 'text-left'
                )}
              >
                {c.titulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={i} className="hover:[&>td]:bg-[var(--ls-sup3)]">
              {columnas.map((c) => (
                <td
                  key={c.clave}
                  className={cx(
                    'h-[26px] whitespace-nowrap border-b border-[var(--ls-linea)] px-2 text-[var(--ls-t2)]',
                    c.numero && 'text-right tabular-nums'
                  )}
                >
                  {c.formato ? c.formato(valorDe(f, c.clave)) : String(valorDe(f, c.clave) ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const valorDe = (fila: object, clave: string): string | number => (fila as Record<string, string | number>)[clave]

export function TarjetaGrafico({
  titulo,
  ayuda,
  leyenda,
  grafico,
  tabla,
  onCsv,
  derecha,
}: {
  titulo: ReactNode
  ayuda?: ReactNode
  /** Con dos series o más va siempre. Con una, el título ya dice qué es */
  leyenda?: ReactNode
  grafico: ReactNode
  /** La tabla gemela. Sin ella no hay interruptor */
  tabla?: ReactNode
  onCsv?: () => void
  derecha?: ReactNode
}) {
  const [vista, setVista] = useState<'grafico' | 'tabla'>('grafico')
  return (
    <Tarjeta
      titulo={titulo}
      ayuda={ayuda}
      derecha={
        <>
          {derecha}
          {onCsv && (
            <button type="button" onClick={onCsv} className={cx(BOTON.base, BOTON.secundario)} title="Descargar los datos en CSV">
              <Download className="h-3 w-3" />
              CSV
            </button>
          )}
          {tabla && (
            <Segmentado
              valor={vista}
              onCambio={setVista}
              etiqueta="Ver como"
              opciones={[
                { id: 'grafico', texto: <BarChart3 className="h-3 w-3" />, titulo: 'Ver el gráfico' },
                { id: 'tabla', texto: <Table2 className="h-3 w-3" />, titulo: 'Ver los datos en una tabla' },
              ]}
            />
          )}
        </>
      }
    >
      {leyenda && <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">{leyenda}</div>}
      {vista === 'grafico' || !tabla ? grafico : tabla}
    </Tarjeta>
  )
}

/* ------------------------------------------------------------------ */
/* Descargas                                                           */
/* ------------------------------------------------------------------ */

const celda = (v: string | number | null | undefined) => {
  const t = v === null || v === undefined ? '' : String(v)
  return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
}

/** Un CSV con BOM y `;`, que es lo que abre bien Excel en español */
export function descargarCsv(nombre: string, cabecera: string[], filas: Array<Array<string | number | null | undefined>>) {
  const cuerpo = [cabecera.map(celda).join(';'), ...filas.map((f) => f.map(celda).join(';'))].join('\r\n')
  bajarBlob(new Blob(['﻿' + cuerpo], { type: 'text/csv;charset=utf-8' }), nombre)
}

/* ------------------------------------------------------------------ */
/* Animación                                                           */
/* ------------------------------------------------------------------ */

/** Más puntos que esto y recharts no se anima: se notaría en el móvil y no aporta nada */
export const MAX_PUNTOS_ANIMADOS = 400
export const DURACION_ANIMACION = 400

/**
 * ¿Se anima este gráfico? Nunca con «reducir movimiento» del sistema ni con más de 400 puntos. En el servidor, no.
 * `reducir` permite pasar la preferencia ya leída (useReducedMotion) y probarlo sin navegador.
 */
export function animarGraficos(puntos = 0, reducir?: boolean | null): boolean {
  if (puntos > MAX_PUNTOS_ANIMADOS) return false
  if (reducir !== undefined && reducir !== null) return !reducir
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function useAnimarGraficos(puntos = 0): boolean {
  const reducir = useReducedMotion()
  return animarGraficos(puntos, reducir ?? false)
}

/* ------------------------------------------------------------------ */
/* Contenedor                                                          */
/* ------------------------------------------------------------------ */

/** Monta `children` solo cuando el nodo entra (o está a 200 px de entrar) en pantalla. Una vez montado, se queda */
function useVisibleUnaVez<T extends HTMLElement>(): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null)
  const [visto, setVisto] = useState(false)
  useEffect(() => {
    if (visto) return
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setVisto(true)
      return
    }
    // Un nodo con display:none (pestaña oculta, `hidden lg:block` en el móvil) no corta nunca: no se monta
    const io = new IntersectionObserver(
      (entradas) => {
        if (entradas.some((e) => e.isIntersecting)) {
          setVisto(true)
          io.disconnect()
        }
      },
      { rootMargin: '200px 0px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [visto])
  return [ref, visto]
}

export function Grafico({
  children,
  alto,
  etiqueta,
  vacio = false,
  textoVacio = 'Sin datos para este periodo',
  descripcionVacio,
  className,
}: {
  /** Un único gráfico de recharts (BarChart, ComposedChart…): va dentro de un ResponsiveContainer */
  children: ReactElement
  /** Por defecto 220 px en el móvil y 280 en el escritorio */
  alto?: number
  /** Qué enseña, para quien no lo ve («Unidades vendidas por día, últimos 30 días») */
  etiqueta: string
  vacio?: boolean
  textoVacio?: string
  descripcionVacio?: string
  className?: string
}) {
  const [ref, visto] = useVisibleUnaVez<HTMLDivElement>()
  if (vacio) {
    return (
      <div className={cx('min-w-0 w-full', className)}>
        <EstadoVacio compacto titulo={textoVacio} descripcion={descripcionVacio} />
      </div>
    )
  }
  return (
    <div
      ref={ref}
      role="img"
      aria-label={etiqueta}
      className={cx('relative min-w-0 w-full', alto === undefined && 'h-[220px] lg:h-[280px]', className)}
      style={alto !== undefined ? { height: alto } : undefined}
    >
      {visto ? (
        <ResponsiveContainer width="100%" height="100%" debounce={60}>
          {children}
        </ResponsiveContainer>
      ) : (
        <div aria-hidden className="h-full w-full animate-pulse rounded-[10px] bg-[var(--ls-sup2)] motion-reduce:animate-none" />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Barras apiladas                                                     */
/* ------------------------------------------------------------------ */

export interface SerieApilada {
  clave: string
  nombre: string
  color: string
}

export function GraficoBarrasApiladas({
  datos,
  claveX,
  series,
  formatoX = (v) => String(v),
  formatoValor = (n) => entero(n),
  unidad = 'ud',
  etiqueta,
  leyenda,
  alto,
}: {
  datos: ReadonlyArray<Record<string, string | number | null>>
  /** La categoría (la semana, el cliente…) */
  claveX: string
  /** De abajo arriba (o de izquierda a derecha en el móvil) */
  series: SerieApilada[]
  formatoX?: (v: string | number) => string
  formatoValor?: (n: number) => string
  unidad?: string
  etiqueta: string
  /** Por defecto, con dos series o más */
  leyenda?: boolean
  /** Alto en el escritorio (el móvil crece con las filas) */
  alto?: number
}) {
  const animar = useAnimarGraficos(datos.length * series.length)
  const total = datos.reduce((s, d) => s + series.reduce((t, x) => t + (Number(d[x.clave]) || 0), 0), 0)
  const conLeyenda = leyenda ?? series.length > 1
  const tooltip = tooltipDe(
    series.map((x) => ({ key: x.clave, nombre: x.nombre, color: x.color, formato: (v: number) => `${formatoValor(v)} ${unidad}` })),
    (l) => formatoX(l)
  )
  const Contenido = tooltip
  const ultima = series.length - 1
  const vacio = datos.length === 0 || total === 0
  // En el móvil, una fila por categoría: 30 px cada una y aire para el eje
  const altoMovil = Math.max(200, datos.length * 30 + 36)

  return (
    <div className="min-w-0 w-full">
      {conLeyenda && !vacio && (
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          {series.map((x) => (
            <Clave key={x.clave} color={x.color}>
              {x.nombre}
            </Clave>
          ))}
        </div>
      )}
      {/* Móvil: barras horizontales (la categoría en el eje Y) */}
      <div className="lg:hidden">
        <Grafico etiqueta={etiqueta} vacio={vacio} alto={altoMovil}>
          <BarChart data={datos as Array<Record<string, string | number | null>>} layout="vertical" margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barCategoryGap="24%">
            <CartesianGrid stroke={EJE.rejilla} horizontal={false} />
            <XAxis type="number" tick={EJE.tick} axisLine={false} tickLine={false} allowDecimals={false} tickFormatter={(v: number) => formatoValor(v)} />
            <YAxis type="category" dataKey={claveX} tick={EJE.tick} axisLine={{ stroke: EJE.linea }} tickLine={false} width={64} tickFormatter={(v: string | number) => formatoX(v)} />
            <Tooltip content={<Contenido />} cursor={{ fill: 'var(--ls-sup3)', opacity: 0.7 }} isAnimationActive={false} />
            {series.map((x, i) => (
              <Bar key={x.clave} dataKey={x.clave} stackId="a" fill={x.color} radius={i === ultima ? [0, 4, 4, 0] : 0} maxBarSize={22} isAnimationActive={animar} animationDuration={DURACION_ANIMACION} />
            ))}
          </BarChart>
        </Grafico>
      </div>
      {/* Escritorio: columnas */}
      <div className="hidden lg:block">
        <Grafico etiqueta={etiqueta} vacio={vacio} alto={alto}>
          <BarChart data={datos as Array<Record<string, string | number | null>>} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="22%">
            <CartesianGrid stroke={EJE.rejilla} vertical={false} />
            <XAxis dataKey={claveX} tick={EJE.tick} axisLine={{ stroke: EJE.linea }} tickLine={false} minTickGap={12} tickFormatter={(v: string | number) => formatoX(v)} />
            <YAxis tick={EJE.tick} axisLine={false} tickLine={false} allowDecimals={false} width={40} tickMargin={4} tickFormatter={(v: number) => formatoValor(v)} />
            <Tooltip content={<Contenido />} cursor={{ fill: 'var(--ls-sup3)', opacity: 0.7 }} isAnimationActive={false} />
            {series.map((x, i) => (
              <Bar key={x.clave} dataKey={x.clave} stackId="a" fill={x.color} radius={i === ultima ? [4, 4, 0, 0] : 0} maxBarSize={36} isAnimationActive={animar} animationDuration={DURACION_ANIMACION} />
            ))}
          </BarChart>
        </Grafico>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Ventas: unidades + € con media móvil + periodo anterior             */
/* ------------------------------------------------------------------ */

/** Media de los `n` últimos valores (incluido el de cada posición). Los null no cuentan; sin ninguno, null */
export function mediaMovil(valores: ReadonlyArray<number | null>, n = 7): Array<number | null> {
  return valores.map((_, i) => {
    let suma = 0
    let cuenta = 0
    for (let j = Math.max(0, i - n + 1); j <= i; j++) {
      const v = valores[j]
      if (v === null || v === undefined || !Number.isFinite(v)) continue
      suma += v
      cuenta++
    }
    return cuenta === 0 ? null : suma / cuenta
  })
}

export interface PuntoVentas {
  fecha: string
  unidades: number
  euros: number | null
}

/** Las filas que pinta el gráfico de ventas (puro, para probarlo): media móvil de € y el anterior alineado por posición */
export function filasDeVentas(datos: ReadonlyArray<PuntoVentas>, anterior: ReadonlyArray<PuntoVentas> | null, porSemana: boolean) {
  const media = porSemana ? datos.map((d) => d.euros) : mediaMovil(datos.map((d) => d.euros), 7)
  // El anterior se alinea por el final: el último día del anterior va con el último del actual
  const desfase = anterior ? anterior.length - datos.length : 0
  return datos.map((d, i) => ({
    fecha: d.fecha,
    unidades: d.unidades,
    euros: d.euros,
    eurosMedia: media[i] === null ? null : Math.round((media[i] as number) * 100) / 100,
    anterior: anterior ? anterior[i + desfase]?.unidades ?? null : null,
  }))
}

export function GraficoVentasCompuesto({
  datos,
  anterior = null,
  moneda = 'EUR',
  porSemana = false,
  etiqueta,
  alto,
}: {
  /** Por día (o por semana, con `porSemana`) */
  datos: ReadonlyArray<PuntoVentas>
  /** El periodo anterior del mismo número de días; null = no se enseña (p. ej. anterior incompleto con 365 días) */
  anterior?: ReadonlyArray<PuntoVentas> | null
  moneda?: string
  porSemana?: boolean
  etiqueta: string
  alto?: number
}) {
  const filas = filasDeVentas(datos, anterior, porSemana)
  const animar = useAnimarGraficos(filas.length * 3)
  const hayEuros = filas.some((f) => f.eurosMedia !== null)
  const hayAnterior = filas.some((f) => f.anterior !== null)
  const vacio = filas.length === 0 || filas.every((f) => f.unidades === 0 && !f.euros)
  const titulo = (l: string | number) => (porSemana ? `Semana del ${fechaCorta(String(l))}` : dmy(String(l)))
  const Contenido = tooltipDe(
    [
      { key: 'unidades', nombre: 'unidades', color: VIZ.vendidas, formato: (v) => `${entero(v)} ud` },
      ...(hayEuros ? [{ key: 'eurosMedia', nombre: porSemana ? 'ventas' : 'ventas (media 7 días)', color: 'var(--viz-4)', formato: (v: number) => dinero(v, moneda) }] : []),
      ...(hayAnterior ? [{ key: 'anterior', nombre: 'unidades, periodo anterior', color: 'var(--ls-t4)', formato: (v: number) => `${entero(v)} ud` }] : []),
    ],
    titulo
  )
  return (
    <div className="min-w-0 w-full">
      {!vacio && (
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          <Clave color={VIZ.vendidas}>Unidades {porSemana ? 'por semana' : 'por día'}</Clave>
          {hayEuros && <Clave color="var(--viz-4)">{porSemana ? 'Ventas' : 'Ventas, media de 7 días'} ({simboloDe(moneda)})</Clave>}
          {hayAnterior && <Clave color="var(--ls-t4)">Periodo anterior</Clave>}
        </div>
      )}
      <Grafico etiqueta={etiqueta} vacio={vacio} alto={alto}>
        <ComposedChart data={filas} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap="22%">
          <CartesianGrid stroke={EJE.rejilla} vertical={false} />
          <XAxis dataKey="fecha" tickFormatter={(v: string) => fechaCorta(v)} tick={EJE.tick} axisLine={{ stroke: EJE.linea }} tickLine={false} minTickGap={22} />
          <YAxis yAxisId="ud" tick={EJE.tick} axisLine={false} tickLine={false} allowDecimals={false} width={34} tickMargin={4} />
          {hayEuros && (
            <YAxis
              yAxisId="eur"
              orientation="right"
              tick={EJE.tick}
              axisLine={false}
              tickLine={false}
              width={46}
              tickMargin={4}
              tickFormatter={(v: number) => (v >= 1000 ? `${decimal(v / 1000, 1)}k` : entero(v))}
            />
          )}
          <Tooltip content={<Contenido />} cursor={{ fill: 'var(--ls-sup3)', opacity: 0.6 }} isAnimationActive={false} />
          <Bar yAxisId="ud" dataKey="unidades" fill={VIZ.vendidas} fillOpacity={0.9} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={animar} animationDuration={DURACION_ANIMACION} />
          {hayAnterior && (
            <Line yAxisId="ud" type="monotone" dataKey="anterior" stroke="var(--ls-t4)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} connectNulls />
          )}
          {hayEuros && (
            <Line
              yAxisId="eur"
              type="monotone"
              dataKey="eurosMedia"
              stroke="var(--viz-4)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: 'var(--viz-4)', stroke: 'var(--ls-sup)', strokeWidth: 2 }}
              isAnimationActive={animar}
              animationDuration={DURACION_ANIMACION}
              connectNulls
            />
          )}
        </ComposedChart>
      </Grafico>
    </div>
  )
}
