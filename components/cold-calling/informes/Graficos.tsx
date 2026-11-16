'use client'

import { BarChart3, Clock3 } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Tarjeta, VIZ } from '@/components/ui-ls'
import { cuandoCorto, decimal, entero, etiquetaDeDia, horaDelDia, type PanelDeInformes } from './tipos'

/** Los dos gráficos del ritmo: informes por día (desde el primero) y por hora (últimas 48 h). Amazon siempre en --viz-1 y sin Amazon en --viz-2 */

const TOOLTIP = {
  contentStyle: { background: 'var(--ls-sup2)', border: '1px solid var(--ls-linea2)', borderRadius: 10, boxShadow: 'var(--ls-sombra-2)', fontSize: 12 },
  labelStyle: { color: 'var(--ls-t3)' },
  itemStyle: { color: 'var(--ls-t1)' },
  cursor: { fill: 'color-mix(in srgb, var(--ls-t1) 5%, transparent)' },
} as const
const EJE = { tick: { fill: 'var(--ls-t4)', fontSize: 10.5 }, tickLine: false, axisLine: false } as const
const NOMBRE: Record<string, string> = { amazon: 'Amazon', sin: 'Sin Amazon', saltados: 'Saltados' }

function Leyenda({ conSaltados }: { conSaltados?: boolean }) {
  const items: Array<[string, string]> = [
    ['Amazon', VIZ[0]],
    ['Sin Amazon', VIZ[1]],
  ]
  if (conSaltados) items.push(['Saltados', 'var(--ls-t4)'])
  return (
    <span className="flex items-center gap-3 text-[11px] text-[var(--ls-t4)]">
      {items.map(([t, c]) => (
        <span key={t} className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-[2px]" style={{ background: c }} />
          {t}
        </span>
      ))}
    </span>
  )
}

export function GraficoPorDia({ porDia, ritmoDia, indice }: { porDia: PanelDeInformes['porDia']; ritmoDia: number; indice?: number }) {
  const haySaltados = porDia.some((d) => d.saltados > 0)
  return (
    <Tarjeta indice={indice} icono={BarChart3} acento="marca" titulo="Informes por día" subtitulo={`Media de los últimos días completos: ${entero(ritmoDia)} al día`} acciones={<Leyenda conSaltados={haySaltados} />}>
      <div className="h-[220px] lg:h-[240px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={porDia} margin={{ top: 8, right: 4, bottom: 0, left: -18 }}>
            <CartesianGrid vertical={false} stroke="var(--ls-linea)" strokeDasharray="3 4" />
            <XAxis dataKey="dia" tickFormatter={etiquetaDeDia} {...EJE} minTickGap={16} />
            <YAxis {...EJE} width={44} allowDecimals={false} />
            <Tooltip {...TOOLTIP} labelFormatter={(v) => etiquetaDeDia(String(v))} formatter={(v, n) => [entero(Number(v)), NOMBRE[String(n)] ?? String(n)]} />
            {ritmoDia > 0 && <ReferenceLine y={ritmoDia} stroke="var(--ls-t4)" strokeDasharray="4 4" />}
            <Bar dataKey="amazon" stackId="d" fill={VIZ[0]} isAnimationActive={false} maxBarSize={44} />
            <Bar dataKey="sin" stackId="d" fill={VIZ[1]} radius={haySaltados ? 0 : [4, 4, 0, 0]} isAnimationActive={false} maxBarSize={44} />
            {haySaltados && <Bar dataKey="saltados" stackId="d" fill="var(--ls-t4)" fillOpacity={0.45} radius={[4, 4, 0, 0]} isAnimationActive={false} maxBarSize={44} />}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Tarjeta>
  )
}

export function GraficoPorHora({ porHora, ritmoHora, indice }: { porHora: PanelDeInformes['porHora']; ritmoHora: number; indice?: number }) {
  return (
    <Tarjeta indice={indice} icono={Clock3} acento="marca" titulo="Informes por hora · 48 h" subtitulo={`Ritmo de las últimas 24 h: ${decimal(ritmoHora)} a la hora (uno cada ${ritmoHora > 0 ? entero(60 / ritmoHora) : '—'} min)`} acciones={<Leyenda />}>
      <div className="h-[220px] lg:h-[240px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={porHora} margin={{ top: 8, right: 4, bottom: 0, left: -18 }}>
            <CartesianGrid vertical={false} stroke="var(--ls-linea)" strokeDasharray="3 4" />
            <XAxis dataKey="hora" tickFormatter={horaDelDia} {...EJE} minTickGap={28} />
            <YAxis {...EJE} width={44} allowDecimals={false} />
            <Tooltip {...TOOLTIP} labelFormatter={(v) => cuandoCorto(String(v))} formatter={(v, n) => [entero(Number(v)), NOMBRE[String(n)] ?? String(n)]} />
            {ritmoHora > 0 && <ReferenceLine y={ritmoHora} stroke="var(--ls-t4)" strokeDasharray="4 4" />}
            <Bar dataKey="amazon" stackId="h" fill={VIZ[0]} isAnimationActive={false} />
            <Bar dataKey="sin" stackId="h" fill={VIZ[1]} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Tarjeta>
  )
}
