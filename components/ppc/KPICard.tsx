'use client'

import { ArrowUp, ArrowDown, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'

interface KPICardProps {
  title: string
  value: string
  previousValue?: number
  currentValue?: number
  currency?: string
  isPercentage?: boolean
}

export function KPICard({ title, value, previousValue, currentValue, currency = 'EUR', isPercentage = false }: KPICardProps) {
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

  return (
    <div className="glass-card p-6 rounded-xl">
      <p className="text-sm text-white/50 mb-2">{title}</p>
      <div className="flex items-end justify-between">
        <p className="text-2xl font-bold text-white">{value}</p>
        {change !== null && (
          <div className={cn(
            "flex items-center gap-1 text-sm font-semibold",
            hasIncrease && "text-green-400",
            hasDecrease && "text-red-400",
            isNeutral && "text-white/50"
          )}>
            {hasIncrease && <ArrowUp className="h-4 w-4" />}
            {hasDecrease && <ArrowDown className="h-4 w-4" />}
            {isNeutral && <Minus className="h-4 w-4" />}
            <span>{Math.abs(change).toFixed(1)}%</span>
          </div>
        )}
      </div>
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

