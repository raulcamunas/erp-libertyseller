'use client'

import { TrendingUp, TrendingDown, DollarSign, Target, MousePointerClick } from 'lucide-react'
import { cn } from '@/lib/utils'

interface GlobalMetricsPanelProps {
  changes: Array<{
    'Gasto'?: number
    'ACOS'?: number
    'Clics'?: number
    'Ventas'?: number
    'Puja'?: number
    'Puja Original'?: number
    'CPC'?: number
    'ROAS'?: number
    'CTR'?: number
  }>
}

export function GlobalMetricsPanel({ changes }: GlobalMetricsPanelProps) {
  // Calcular métricas globales
  const totalGasto = changes.reduce((sum, c) => sum + (c['Gasto'] || 0), 0)
  const totalVentas = changes.reduce((sum, c) => sum + (c['Ventas'] || 0), 0)
  const totalClics = changes.reduce((sum, c) => sum + (c['Clics'] || 0), 0)
  
  // ACOS promedio (ponderado por gasto)
  const acosWeighted = changes
    .filter(c => c['Gasto'] && c['Gasto'] > 0 && c['ACOS'])
    .reduce((sum, c) => {
      const gasto = c['Gasto'] || 0
      const acos = c['ACOS'] || 0
      return sum + (acos * gasto)
    }, 0)
  const globalACOS = totalGasto > 0 ? (acosWeighted / totalGasto) : 0
  
  // CPC promedio (ponderado por clics)
  const cpcWeighted = changes
    .filter(c => c['Clics'] && c['Clics'] > 0)
    .reduce((sum, c) => {
      const clics = c['Clics'] || 0
      const cpc = c['CPC'] || (c['Gasto'] && c['Gasto'] > 0 ? (c['Gasto'] / clics) : 0)
      return sum + (cpc * clics)
    }, 0)
  const globalCPC = totalClics > 0 ? (cpcWeighted / totalClics) : 0
  
  // ROAS promedio (ponderado por gasto)
  const roasWeighted = changes
    .filter(c => c['Gasto'] && c['Gasto'] > 0)
    .reduce((sum, c) => {
      const gasto = c['Gasto'] || 0
      const roas = c['ROAS'] || (c['Ventas'] && c['Ventas'] > 0 ? (c['Ventas'] / gasto) : 0)
      return sum + (roas * gasto)
    }, 0)
  const globalROAS = totalGasto > 0 ? (roasWeighted / totalGasto) : 0
  
  // CTR promedio (ponderado por clics)
  const ctrWeighted = changes
    .filter(c => c['Clics'] && c['Clics'] > 0 && c['CTR'])
    .reduce((sum, c) => {
      const clics = c['Clics'] || 0
      const ctr = c['CTR'] || 0
      return sum + (ctr * clics)
    }, 0)
  const globalCTR = totalClics > 0 ? (ctrWeighted / totalClics) : 0
  
  // Cambio promedio de puja
  const bidChanges = changes.filter(c => c['Puja Original'] && c['Puja Original'] > 0)
  const avgBidChange = bidChanges.length > 0
    ? bidChanges.reduce((sum, c) => {
        const original = c['Puja Original'] || 0
        const nueva = c['Puja'] || 0
        return sum + ((nueva - original) / original) * 100
      }, 0) / bidChanges.length
    : 0

  const metrics = [
    {
      label: 'Gasto Total',
      value: `${totalGasto.toFixed(2)}€`,
      icon: DollarSign,
      color: 'text-blue-400',
    },
    {
      label: 'Ventas Totales',
      value: `${totalVentas.toFixed(2)}€`,
      icon: TrendingUp,
      color: 'text-green-400',
    },
    {
      label: 'ACOS Global',
      value: `${globalACOS.toFixed(2)}%`,
      icon: Target,
      color: globalACOS > 35 ? 'text-red-400' : globalACOS < 10 ? 'text-green-400' : 'text-yellow-400',
    },
    {
      label: 'ROAS Global',
      value: `${globalROAS.toFixed(2)}x`,
      icon: TrendingUp,
      color: globalROAS > 3 ? 'text-green-400' : globalROAS > 1 ? 'text-yellow-400' : 'text-red-400',
    },
    {
      label: 'CPC Promedio',
      value: `${globalCPC.toFixed(2)}€`,
      icon: MousePointerClick,
      color: 'text-white/70',
    },
    {
      label: 'CTR Promedio',
      value: `${globalCTR.toFixed(2)}%`,
      icon: MousePointerClick,
      color: 'text-white/70',
    },
    {
      label: 'Clics Totales',
      value: totalClics.toString(),
      icon: MousePointerClick,
      color: 'text-white/70',
    },
    {
      label: 'Cambio Promedio Puja',
      value: `${avgBidChange > 0 ? '+' : ''}${avgBidChange.toFixed(1)}%`,
      icon: avgBidChange > 0 ? TrendingUp : TrendingDown,
      color: avgBidChange > 0 ? 'text-green-400' : avgBidChange < 0 ? 'text-red-400' : 'text-white/70',
    },
  ]

  return (
    <div className="glass-card p-6 rounded-xl">
      <h3 className="text-lg font-semibold text-white mb-4">Métricas Globales de la Cuenta</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
        {metrics.map((metric, index) => {
          const Icon = metric.icon
          return (
            <div key={index} className="flex flex-col items-center p-3 rounded-lg bg-white/5 border border-white/10">
              <Icon className={cn("h-5 w-5 mb-2", metric.color)} />
              <p className="text-xs text-white/60 mb-1 text-center">{metric.label}</p>
              <p className={cn("text-lg font-bold", metric.color)}>{metric.value}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

