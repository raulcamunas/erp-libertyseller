'use client'

import { MonthlySummary } from '@/lib/types/finances'
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts'

interface FinanceChartProps {
  data: MonthlySummary[]
}

export function FinanceChart({ data }: FinanceChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-white/50">
        No hay datos para mostrar
      </div>
    )
  }

  const chartData = data.map(item => ({
    mes: item.month.slice(0, 3),
    ingresos: item.totalIncome,
    gastos: item.totalExpenses,
    beneficio: item.profit
  }))

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.1)" />
        <XAxis 
          dataKey="mes" 
          stroke="rgba(255, 255, 255, 0.5)"
          style={{ fontSize: '12px' }}
        />
        <YAxis 
          stroke="rgba(255, 255, 255, 0.5)"
          style={{ fontSize: '12px' }}
          tickFormatter={(value) => `€${value.toLocaleString()}`}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: 'rgba(8, 8, 8, 0.95)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '8px',
            color: '#fff'
          }}
          formatter={(value: number, name: string) => [
            `€${value.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            name === 'ingresos' ? 'Ingresos' : name === 'gastos' ? 'Gastos' : 'Beneficio'
          ]}
        />
        <Legend 
          wrapperStyle={{ color: 'rgba(255, 255, 255, 0.7)' }}
        />
        <Bar dataKey="ingresos" fill="#FF6600" name="Ingresos" radius={[8, 8, 0, 0]} />
        <Bar dataKey="gastos" fill="#ef4444" name="Gastos" radius={[8, 8, 0, 0]} />
        <Bar dataKey="beneficio" fill="#22c55e" name="Beneficio" radius={[8, 8, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

