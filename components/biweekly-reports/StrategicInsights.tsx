'use client'

import { useMemo } from 'react'
import { AlertTriangle, Lightbulb, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

type TopProductRow = {
  sku: string
  title: string
  profit: number
  units: number
  sessions: number
  conversionRate: number
}

type StrategicInsightsProps = {
  totalNetProfit: number
  tacosPct: number
  roas: number
  topProducts: TopProductRow[]
}

const pct = (v: number) => `${v.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`

export function StrategicInsights({ totalNetProfit, tacosPct, roas, topProducts }: StrategicInsightsProps) {
  const best = topProducts[0]

  const bestShare = useMemo(() => {
    if (!best) return 0
    if (!Number.isFinite(totalNetProfit) || totalNetProfit <= 0) return 0
    return (best.profit / totalNetProfit) * 100
  }, [best, totalNetProfit])

  const acosPct = useMemo(() => {
    if (Number.isFinite(roas) && roas > 0) return 100 / roas
    return 0
  }, [roas])

  const lowConvHighTraffic = useMemo(() => {
    const candidates = topProducts
      .filter((p) => Number.isFinite(p.sessions) && p.sessions > 0)
      .sort((a, b) => b.sessions - a.sessions)

    const low = candidates.find((p) => p.conversionRate > 0 && p.conversionRate < 7)
    return low || candidates[0]
  }, [topProducts])

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-slate-900">Strategic Insights</div>
          <div className="text-xs text-slate-500">Lectura ejecutiva para toma de decisiones</div>
        </div>
        <div className="h-10 w-10 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center">
          <Sparkles className="h-5 w-5 text-slate-700" />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-start gap-3">
            <div className="h-9 w-9 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center">
              <Lightbulb className="h-4 w-4 text-emerald-600" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-500">Rentabilidad</div>
              <div className="mt-1 text-sm text-slate-900">
                {best
                  ? `Tu producto estrella es ${best.title || best.sku}, aportando un ${pct(bestShare)} del beneficio total.`
                  : 'No hay suficientes datos para identificar el producto estrella.'}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-start gap-3">
            <div className="h-9 w-9 rounded-xl bg-violet-50 border border-violet-100 flex items-center justify-center">
              <AlertTriangle className="h-4 w-4 text-violet-600" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-500">Alerta de publicidad</div>
              <div className="mt-1 text-sm text-slate-900">
                {acosPct > 0
                  ? `El ACOS estimado está en ${pct(acosPct)}. Se recomienda revisar pujas en términos genéricos y buscar oportunidades de eficiencia.`
                  : tacosPct > 0
                  ? `El TACOS está en ${pct(tacosPct)}. Revisa campañas con menor retorno para reducir dependencia de publicidad.`
                  : 'No hay suficientes datos de publicidad para generar una alerta.'}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-start gap-3">
            <div className="h-9 w-9 rounded-xl bg-slate-900 flex items-center justify-center">
              <Sparkles className={cn('h-4 w-4 text-white')} />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-500">Conversión</div>
              <div className="mt-1 text-sm text-slate-900">
                {lowConvHighTraffic
                  ? `El producto ${lowConvHighTraffic.title || lowConvHighTraffic.sku} tiene tráfico alto pero conversión baja (${pct(
                      lowConvHighTraffic.conversionRate
                    )}). Sugerimos optimizar imágenes y la primera pantalla del listing.`
                  : 'No hay suficientes datos para evaluar conversión.'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
