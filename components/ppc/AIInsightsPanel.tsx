'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Sparkles, Loader2, AlertCircle } from 'lucide-react'
import { MarkdownRenderer } from './MarkdownRenderer'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface AIInsightsPanelProps {
  clientId: string
  clientContext: {
    target_acos: number
    total_spend_week: number
    global_acos: number
    client_name?: string
  }
  bleeders: Array<{
    term: string
    spend: number
    sales: number
    clicks: number
    acos?: number
  }>
  winners: Array<{
    term: string
    acos: number
    sales: number
    conversion_rate?: number
  }>
  harvestOpportunities: Array<{
    term: string
    origin_campaign: string
    orders: number
    acos?: number
  }>
}

export function AIInsightsPanel({
  clientId,
  clientContext,
  bleeders,
  winners,
  harvestOpportunities,
}: AIInsightsPanelProps) {
  const [insights, setInsights] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isFallback, setIsFallback] = useState(false)

  const generateInsights = async () => {
    setLoading(true)
    setError(null)
    setIsFallback(false)

    try {
      const payload = {
        client_context: clientContext,
        bleeders_analysis: bleeders.slice(0, 5).map((b) => ({
          term: b.term,
          spend: b.spend,
          sales: b.sales,
          clicks: b.clicks,
          acos: b.acos,
        })),
        winners_analysis: winners.slice(0, 5).map((w) => ({
          term: w.term,
          acos: w.acos,
          sales: w.sales,
          conversion_rate: w.conversion_rate,
        })),
        harvest_opportunities: harvestOpportunities.slice(0, 5).map((h) => ({
          term: h.term,
          origin_campaign: h.origin_campaign,
          orders: h.orders,
          acos: h.acos,
        })),
      }

      const response = await fetch('/api/marketing/ai-insights', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      const data = await response.json()

      if (data.error && data.fallback) {
        setIsFallback(true)
        setInsights(data.message)
        toast.warning('La IA no está disponible, pero los datos matemáticos son correctos')
      } else if (data.success && data.insights) {
        setInsights(data.insights)
        toast.success('Análisis de IA generado correctamente')
      } else {
        throw new Error(data.error || 'Error al generar insights')
      }
    } catch (err: any) {
      console.error('Error generating AI insights:', err)
      setError(err.message || 'Error al generar insights de IA')
      toast.error('Error al generar análisis de IA')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="glass-card p-6 rounded-xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-white mb-1 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-[#FF6600]" />
            Análisis Estratégico por IA
          </h3>
          <p className="text-sm text-white/50">
            Auditoría inteligente de tu optimización PPC
          </p>
        </div>
        <Button
          onClick={generateInsights}
          disabled={loading}
          className="bg-[#FF6600] text-white hover:bg-[#FF6600]/90"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Analizando...
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4 mr-2" />
              Generar Análisis
            </>
          )}
        </Button>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2">
          <AlertCircle className="h-5 w-5 text-red-400" />
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {insights && (
        <div className={cn(
          "mt-6 p-6 rounded-lg border",
          isFallback
            ? "bg-yellow-500/10 border-yellow-500/30"
            : "bg-white/[0.02] border-white/10"
        )}>
          {isFallback ? (
            <div className="text-center py-8">
              <AlertCircle className="h-12 w-12 mx-auto mb-4 text-yellow-400" />
              <p className="text-yellow-400 font-semibold mb-2">IA No Disponible</p>
              <p className="text-white/70">{insights}</p>
            </div>
          ) : (
            <MarkdownRenderer content={insights} />
          )}
        </div>
      )}

      {!insights && !loading && !error && (
        <div className="text-center py-8">
          <p className="text-white/50 text-sm">
            Haz clic en "Generar Análisis" para obtener insights estratégicos de IA
          </p>
        </div>
      )}
    </div>
  )
}

