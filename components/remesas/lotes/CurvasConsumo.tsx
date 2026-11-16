'use client'

import { useMemo } from 'react'
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts'
import type { LoteEnvio } from '@/lib/fba/plan-tipos'
import { DURACION_ANIMACION, EJE, Grafico, useAnimarGraficos } from '../comun/graficos'
import { Clave } from '../comun/ui'
import { decimal } from '../formato'
import { seriesDeCurvas } from './useLotes'

/**
 * LAS CURVAS DE CONSUMO (spec remesas-pro §5.3): % vendido frente a días desde la llegada. Los últimos 8 envíos agotados
 * en gris y el destacado (el envío que se mira, o el vivo) en el acento de Remesas. Si la línea de color va por encima
 * de las grises, este envío se vende más rápido que los anteriores.
 *
 *   <CurvasConsumo lotes={lotes} destacado={remesaId} />
 */

const ACENTO = 'var(--ls-mod-remesas)'

interface PropsTooltip {
  active?: boolean
  label?: number | string
  payload?: Array<{ dataKey?: string | number; value?: number | string }>
}

export function CurvasConsumo({ lotes, destacado, alto }: { lotes: ReadonlyArray<LoteEnvio>; destacado: string | null; alto?: number }) {
  const { datos, series } = useMemo(() => seriesDeCurvas(lotes, destacado), [lotes, destacado])
  const animar = useAnimarGraficos(datos.length * Math.max(1, series.length))
  const grises = series.filter((s) => !s.destacada)
  const dest = series.find((s) => s.destacada) ?? null
  const nombre = dest?.nombre ?? null

  function Contenido({ active, payload, label }: PropsTooltip) {
    if (!active || !payload || payload.length === 0) return null
    const suyo = dest ? payload.find((p) => p.dataKey === dest.remesaId)?.value : undefined
    const otros = payload.filter((p) => p.dataKey !== dest?.remesaId && p.value !== undefined && p.value !== null).map((p) => Number(p.value))
    return (
      <div className="pointer-events-none min-w-[170px] rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-3 py-2 shadow-[var(--ls-sombra-2)]">
        <p className="mb-1 text-[11.5px] text-[var(--ls-t4)]">Día {label} desde la llegada</p>
        {suyo !== undefined && (
          <p className="flex items-center gap-2 text-[13px]">
            <span className="h-[2px] w-3 rounded-full" style={{ background: ACENTO }} aria-hidden />
            <b className="font-semibold tabular-nums text-[var(--ls-t1)]">{decimal(Number(suyo), 1)} %</b>
            <span className="truncate text-[var(--ls-t3)]">{nombre}</span>
          </p>
        )}
        {otros.length > 0 && (
          <p className="mt-[2px] text-[12px] text-[var(--ls-t3)]">
            Anteriores: {decimal(Math.min(...otros), 0)}–{decimal(Math.max(...otros), 0)} % vendido
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="min-w-0">
      {series.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          {dest && <Clave color={ACENTO}>{dest.nombre}</Clave>}
          {grises.length > 0 && (
            <Clave color="var(--ls-t4)">
              {grises.length === 1 ? 'El envío agotado anterior' : `Los ${grises.length} últimos envíos agotados`}
            </Clave>
          )}
        </div>
      )}
      <Grafico
        etiqueta="Porcentaje vendido de cada envío frente a los días desde su llegada"
        vacio={series.length === 0}
        textoVacio="Todavía no hay envíos con ventas para comparar"
        alto={alto}
      >
        <LineChart data={datos} margin={{ top: 8, right: 14, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={EJE.rejilla} vertical={false} />
          <XAxis
            dataKey="dia"
            type="number"
            domain={[0, 'dataMax']}
            tick={EJE.tick}
            axisLine={{ stroke: EJE.linea }}
            tickLine={false}
            allowDecimals={false}
            height={24}
            tickFormatter={(d) => `${d} d`}
          />
          <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={EJE.tick} axisLine={false} tickLine={false} width={48} tickFormatter={(v) => `${v} %`} />
          <Tooltip content={<Contenido />} cursor={{ stroke: 'var(--ls-linea2)', strokeWidth: 1 }} isAnimationActive={false} />
          {grises.map((s) => (
            <Line
              key={s.remesaId}
              type="monotone"
              dataKey={s.remesaId}
              name={s.nombre}
              stroke="var(--ls-t4)"
              strokeOpacity={0.55}
              strokeWidth={1.5}
              dot={false}
              activeDot={false}
              connectNulls
              isAnimationActive={false}
            />
          ))}
          {dest && (
            <Line
              type="monotone"
              dataKey={dest.remesaId}
              name={dest.nombre}
              stroke={ACENTO}
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4, stroke: 'var(--ls-sup)', strokeWidth: 2, fill: ACENTO }}
              connectNulls
              isAnimationActive={animar}
              animationDuration={DURACION_ANIMACION}
            />
          )}
        </LineChart>
      </Grafico>
    </div>
  )
}
