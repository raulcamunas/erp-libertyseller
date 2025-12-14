'use client'

import { ArrowUp, ArrowDown, Minus, TrendingUp, DollarSign, Target, BarChart3, MousePointerClick, Eye, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'

interface KPICardProps {
  title: string
  value: string
  previousValue?: number
  currentValue?: number
  currency?: string
  isPercentage?: boolean
  icon?: 'spend' | 'sales' | 'acos' | 'roas' | 'cpc' | 'ctr' | 'clicks'
  color?: string
}

const iconMap = {
  spend: DollarSign,
  sales: TrendingUp,
  acos: Target,
  roas: BarChart3,
  cpc: MousePointerClick,
  ctr: Eye,
  clicks: Zap,
}

const colorMap = {
  spend: { bg: 'bg-red-500/10', border: 'border-red-500/20', icon: 'text-red-400', accent: '#ef4444' },
  sales: { bg: 'bg-green-500/10', border: 'border-green-500/20', icon: 'text-green-400', accent: '#22c55e' },
  acos: { bg: 'bg-yellow-500/10', border: 'border-yellow-500/20', icon: 'text-yellow-400', accent: '#eab308' },
  roas: { bg: 'bg-blue-500/10', border: 'border-blue-500/20', icon: 'text-blue-400', accent: '#3b82f6' },
  cpc: { bg: 'bg-purple-500/10', border: 'border-purple-500/20', icon: 'text-purple-400', accent: '#a855f7' },
  ctr: { bg: 'bg-cyan-500/10', border: 'border-cyan-500/20', icon: 'text-cyan-400', accent: '#06b6d4' },
  clicks: { bg: 'bg-orange-500/10', border: 'border-orange-500/20', icon: 'text-orange-400', accent: '#FF6600' },
}

export function KPICard({ 
  title, 
  value, 
  previousValue, 
  currentValue, 
  currency = 'EUR', 
  isPercentage = false,
  icon,
  color
}: KPICardProps) {
  const calculateChange = () => {
    if (previousValue === undefined || currentValue === undefined || previousValue === 0) {
      return null
    }
    const change = ((currentValue - previousValue) / previousValue) * 100
    return change
  }

  const change = calculateChange()
  const hasIncrease = change !== null && change > 0
  const hasDecrease = change !== null && change < 0
  const isNeutral = change === null || change === 0

  const IconComponent = icon ? iconMap[icon] : null
  const colorScheme = icon ? colorMap[icon] : null

  return (
    <div className={cn(
      "glass-card p-6 rounded-xl border transition-all hover:border-white/20",
      colorScheme?.border
    )}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          {IconComponent && colorScheme && (
            <div className={cn("p-2 rounded-lg", colorScheme.bg)}>
              <IconComponent className={cn("h-4 w-4", colorScheme.icon)} />
            </div>
          )}
          <p className="text-sm text-white/50">{title}</p>
        </div>
        {change !== null && (
          <div className={cn(
            "flex items-center gap-1 text-xs font-semibold",
            hasIncrease && "text-green-400",
            hasDecrease && "text-red-400",
            isNeutral && "text-white/50"
          )}>
            {hasIncrease && <ArrowUp className="h-3 w-3" />}
            {hasDecrease && <ArrowDown className="h-3 w-3" />}
            {isNeutral && <Minus className="h-3 w-3" />}
            <span>{Math.abs(change).toFixed(1)}%</span>
          </div>
        )}
      </div>
      <p className={cn(
        "text-2xl font-bold",
        colorScheme ? colorScheme.icon : "text-white"
      )}>{value}</p>
      {previousValue !== undefined && currentValue !== undefined && change !== null && (
        <p className="text-xs text-white/40 mt-2">
          {isPercentage 
            ? `Semana anterior: ${previousValue.toFixed(2)}%`
            : `Semana anterior: ${previousValue.toLocaleString('es-ES', {
                style: 'currency',
                currency: currency,
              })}`
          }
        </p>
      )}
    </div>
  )
}


