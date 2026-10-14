'use client'

import { useState, type ReactNode } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { BarChart3, Download, Table2 } from 'lucide-react'
import { BOTON } from '@/lib/estilo/denso'
import { cx, Segmentado, Tarjeta } from './ui'

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
          <YAxis tick={EJE.tick} axisLine={false} tickLine={false} allowDecimals={false} width={30} tickMargin={4} />
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
          <YAxis tick={EJE.tick} axisLine={false} tickLine={false} allowDecimals={false} width={30} tickMargin={4} domain={[0, 'auto']} />
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
  const blob = new Blob(['﻿' + cuerpo], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  a.click()
  URL.revokeObjectURL(url)
}
