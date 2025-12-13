'use client'

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { PPCWeeklySnapshot } from '@/lib/types/ppc'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

interface PerformanceChartProps {
  data: PPCWeeklySnapshot[]
  currency: string
}

export function PerformanceChart({ data, currency }: PerformanceChartProps) {
  const chartData = data.map((snapshot) => ({
    week: format(new Date(snapshot.week_start_date), 'dd/MM', { locale: es }),
    weekFull: format(new Date(snapshot.week_start_date), 'dd MMM yyyy', { locale: es }),
    ventas: parseFloat(String(snapshot.total_sales)),
    acos: parseFloat(String(snapshot.global_acos)),
  }))

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="glass-card p-4 rounded-lg border border-white/10 backdrop-blur-md">
          <p className="text-sm font-semibold text-white mb-2">{label}</p>
          {payload.map((entry: any, index: number) => (
            <p key={index} className="text-sm" style={{ color: entry.color }}>
              {entry.name === 'ventas' ? 'Ventas' : 'ACOS'}:{' '}
              {entry.name === 'ventas'
                ? `${entry.value.toLocaleString('es-ES', {
                    style: 'currency',
                    currency: currency,
                  })}`
                : `${entry.value.toFixed(2)}%`}
            </p>
          ))}
        </div>
      )
    }
    return null
  }

  return (
    <div className="glass-card p-6 rounded-xl">
      <h3 className="text-lg font-semibold text-white mb-4">Rendimiento Semanal</h3>
      <ResponsiveContainer width="100%" height={400}>
        <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="colorVentas" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#FF6600" stopOpacity={0.8} />
              <stop offset="95%" stopColor="#FF6600" stopOpacity={0.1} />
            </linearGradient>
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
            tickFormatter={(value) => `${(value / 1000).toFixed(0)}k`}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            stroke="rgba(255, 255, 255, 0.5)"
            style={{ fontSize: '12px' }}
            tickFormatter={(value) => `${value}%`}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ color: 'rgba(255, 255, 255, 0.7)' }}
            iconType="line"
          />
          <Area
            yAxisId="left"
            type="monotone"
            dataKey="ventas"
            stroke="#FF6600"
            strokeWidth={2}
            fillOpacity={1}
            fill="url(#colorVentas)"
            name="Ventas"
          />
          <Area
            yAxisId="right"
            type="monotone"
            dataKey="acos"
            stroke="rgba(255, 255, 255, 0.5)"
            strokeWidth={2}
            strokeDasharray="5 5"
            fill="none"
            name="ACOS"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

