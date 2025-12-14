'use client'

import { useState } from 'react'
import { AreaChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { PPCWeeklySnapshot } from '@/lib/types/ppc'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'

interface PerformanceChartProps {
  data: PPCWeeklySnapshot[]
  currency: string
}

type MetricKey = 'gasto' | 'ventas' | 'acos' | 'roas' | 'cpc' | 'ctr' | 'clicks'

const metricConfig: Record<MetricKey, {
  label: string
  color: string
  gradientId: string
  yAxisId: 'left' | 'right'
  formatter: (value: number, currency?: string) => string
  type: 'area' | 'line'
  strokeDasharray?: string
}> = {
  gasto: {
    label: 'Gasto',
    color: '#ef4444',
    gradientId: 'colorGasto',
    yAxisId: 'left',
    formatter: (value, currency = 'EUR') => `${value.toLocaleString('es-ES', { style: 'currency', currency })}`,
    type: 'area',
  },
  ventas: {
    label: 'Ventas',
    color: '#22c55e',
    gradientId: 'colorVentas',
    yAxisId: 'left',
    formatter: (value, currency = 'EUR') => `${value.toLocaleString('es-ES', { style: 'currency', currency })}`,
    type: 'area',
  },
  acos: {
    label: 'ACOS',
    color: '#eab308',
    gradientId: 'colorACOS',
    yAxisId: 'right',
    formatter: (value) => `${value.toFixed(2)}%`,
    type: 'line',
    strokeDasharray: '5 5',
  },
  roas: {
    label: 'ROAS',
    color: '#3b82f6',
    gradientId: 'colorROAS',
    yAxisId: 'right',
    formatter: (value) => value.toFixed(2),
    type: 'line',
  },
  cpc: {
    label: 'CPC',
    color: '#a855f7',
    gradientId: 'colorCPC',
    yAxisId: 'right',
    formatter: (value) => `${value.toFixed(2)}€`,
    type: 'line',
  },
  ctr: {
    label: 'CTR',
    color: '#06b6d4',
    gradientId: 'colorCTR',
    yAxisId: 'right',
    formatter: (value) => `${value.toFixed(2)}%`,
    type: 'line',
  },
  clicks: {
    label: 'Clics',
    color: '#FF6600',
    gradientId: 'colorClicks',
    yAxisId: 'left',
    formatter: (value) => value.toLocaleString('es-ES'),
    type: 'area',
  },
}

export function PerformanceChart({ data, currency }: PerformanceChartProps) {
  const [activeMetrics, setActiveMetrics] = useState<Record<MetricKey, boolean>>({
    gasto: false,
    ventas: true,
    acos: true,
    roas: false,
    cpc: false,
    ctr: false,
    clicks: false,
  })

  const chartData = data.map((snapshot) => ({
    week: format(new Date(snapshot.week_start_date), 'dd/MM', { locale: es }),
    weekFull: format(new Date(snapshot.week_start_date), 'dd MMM yyyy', { locale: es }),
    gasto: parseFloat(String(snapshot.total_spend)),
    ventas: parseFloat(String(snapshot.total_sales)),
    acos: parseFloat(String(snapshot.global_acos)),
    roas: snapshot.roas ? parseFloat(String(snapshot.roas)) : 0,
    cpc: snapshot.avg_cpc ? parseFloat(String(snapshot.avg_cpc)) : 0,
    ctr: snapshot.avg_ctr ? parseFloat(String(snapshot.avg_ctr)) : 0,
    clicks: snapshot.total_clicks ? parseFloat(String(snapshot.total_clicks)) : 0,
  }))

  const toggleMetric = (metric: MetricKey) => {
    setActiveMetrics(prev => ({ ...prev, [metric]: !prev[metric] }))
  }

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="glass-card p-4 rounded-lg border border-white/10 backdrop-blur-md">
          <p className="text-sm font-semibold text-white mb-2">{label}</p>
          {payload.map((entry: any, index: number) => {
            const metricKey = entry.dataKey as MetricKey
            const config = metricConfig[metricKey]
            if (!config) return null
            return (
              <p key={index} className="text-sm flex items-center gap-2" style={{ color: entry.color }}>
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
                {config.label}: {config.formatter(entry.value, currency)}
              </p>
            )
          })}
        </div>
      )
    }
    return null
  }

  return (
    <div className="glass-card p-6 rounded-xl">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-4">
        <h3 className="text-lg font-semibold text-white">Rendimiento Semanal</h3>
        <div className="flex items-center gap-4 flex-wrap">
          {(Object.keys(metricConfig) as MetricKey[]).map((metric) => {
            const config = metricConfig[metric]
            return (
              <div key={metric} className="flex items-center gap-2">
                <Checkbox
                  id={metric}
                  checked={activeMetrics[metric]}
                  onCheckedChange={() => toggleMetric(metric)}
                  className="border-white/30 data-[state=checked]:bg-orange-500 data-[state=checked]:border-orange-500"
                />
                <label
                  htmlFor={metric}
                  className={cn(
                    "text-sm cursor-pointer transition-opacity flex items-center gap-1.5",
                    activeMetrics[metric] ? "text-white" : "text-white/40"
                  )}
                >
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: config.color }} />
                  {config.label}
                </label>
              </div>
            )
          })}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={400}>
        <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
          <defs>
            {(Object.keys(metricConfig) as MetricKey[]).map((metric) => {
              const config = metricConfig[metric]
              if (config.type === 'area') {
                return (
                  <linearGradient key={config.gradientId} id={config.gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={config.color} stopOpacity={0.8} />
                    <stop offset="95%" stopColor={config.color} stopOpacity={0.1} />
                  </linearGradient>
                )
              }
              return null
            })}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.1)" />
          <XAxis
            dataKey="week"
            stroke="rgba(255, 255, 255, 0.5)"
            style={{ fontSize: '12px' }}
          />
          <YAxis
            yAxisId="left"
            stroke="rgba(255, 255, 255, 0.5)"
            style={{ fontSize: '12px' }}
            tickFormatter={(value) => {
              if (value >= 1000) return `${(value / 1000).toFixed(0)}k`
              return value.toString()
            }}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            stroke="rgba(255, 255, 255, 0.5)"
            style={{ fontSize: '12px' }}
            tickFormatter={(value) => {
              if (value < 1) return value.toFixed(2)
              if (value >= 100) return `${value}%`
              return value.toString()
            }}
          />
          <Tooltip content={<CustomTooltip />} />
          {(Object.keys(metricConfig) as MetricKey[]).map((metric) => {
            if (!activeMetrics[metric]) return null
            const config = metricConfig[metric]
            if (config.type === 'area') {
              return (
                <Area
                  key={metric}
                  yAxisId={config.yAxisId}
                  type="monotone"
                  dataKey={metric}
                  stroke={config.color}
                  strokeWidth={2}
                  fillOpacity={1}
                  fill={`url(#${config.gradientId})`}
                  name={config.label}
                />
              )
            } else {
              return (
                <Line
                  key={metric}
                  yAxisId={config.yAxisId}
                  type="monotone"
                  dataKey={metric}
                  stroke={config.color}
                  strokeWidth={2}
                  strokeDasharray={config.strokeDasharray}
                  dot={{ fill: config.color, r: 3 }}
                  activeDot={{ r: 5 }}
                  name={config.label}
                />
              )
            }
          })}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
