'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Sparkles, Loader2, AlertCircle, ExternalLink, Link as LinkIcon } from 'lucide-react'
import { MarkdownRenderer } from './MarkdownRenderer'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface AIInsightsPanelProps {
  clientId: string
  clientName: string
  clientContext: {
    target_acos: number
    total_spend_week: number
    global_acos: number
    client_name?: string
  }
  changes: Array<{
    'Texto de palabra clave': string
    'Operación': string
    'Puja Original'?: number
    'Puja': number
    'Gasto'?: number
    'ACOS'?: number
    'CPC'?: number
    'ROAS'?: number
    'CTR'?: number
    'Clics'?: number
    'Ventas'?: number
    'Decision Maker'?: 'ALGORITHM' | 'AI'
    'AI Reasoning'?: string
    'Entidad'?: string
  }>
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
  clientName,
  clientContext,
  changes,
  bleeders,
  winners,
  harvestOpportunities,
}: AIInsightsPanelProps) {
  const [insights, setInsights] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isFallback, setIsFallback] = useState(false)
  const [publicReportUrl, setPublicReportUrl] = useState<string | null>(null)
  const [generatingReport, setGeneratingReport] = useState(false)

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

      {/* Generar Reporte Público */}
      {insights && !isFallback && (
        <div className="mt-6 pt-6 border-t border-white/10">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-semibold text-white mb-1">Reporte Público para Cliente</h4>
              <p className="text-xs text-white/50">
                Genera un reporte detallado con gráficos para compartir con el cliente
              </p>
            </div>
            <Button
              onClick={async () => {
                setGeneratingReport(true)
                try {
                  const response = await fetch('/api/marketing/generate-report', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      clientId,
                      clientName,
                      changes,
                      clientContext,
                      bleeders,
                      winners,
                      harvestOpportunities,
                    }),
                  })

                  const data = await response.json()

                  if (data.success && data.publicUrl) {
                    setPublicReportUrl(data.publicUrl)
                    toast.success('Reporte público generado correctamente')
                  } else {
                    throw new Error(data.error || 'Error al generar reporte')
                  }
                } catch (err: any) {
                  console.error('Error generating report:', err)
                  toast.error('Error al generar el reporte público')
                } finally {
                  setGeneratingReport(false)
                }
              }}
              disabled={generatingReport}
              variant="outline"
              className="border-[#FF6600]/30 text-[#FF6600] hover:bg-[#FF6600]/10"
            >
              {generatingReport ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generando...
                </>
              ) : (
                <>
                  <LinkIcon className="h-4 w-4 mr-2" />
                  Generar Reporte Público
                </>
              )}
            </Button>
          </div>

          {publicReportUrl && (
            <div className="mt-4 p-4 bg-white/[0.03] border border-white/10 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <p className="text-xs text-white/50 mb-2">Link público para compartir:</p>
                  <div className="text-sm text-white/70 font-mono break-all bg-black/30 p-2 rounded">
                    {typeof window !== 'undefined' ? `${window.location.origin}${publicReportUrl}` : publicReportUrl}
                  </div>
                  <p className="text-xs text-green-400/70 mt-2">
                    ✓ No requiere autenticación - Comparte este link con tu cliente
                  </p>
                </div>
                <Button
                  onClick={() => {
                    const fullUrl = typeof window !== 'undefined' 
                      ? `${window.location.origin}${publicReportUrl}`
                      : publicReportUrl
                    window.open(fullUrl, '_blank')
                  }}
                  variant="ghost"
                  size="sm"
                  className="ml-4"
                >
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}


