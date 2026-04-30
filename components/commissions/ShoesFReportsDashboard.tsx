'use client'

import { useState } from 'react'
import { CommissionReport } from '@/lib/types/commissions'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Calendar, Copy, ExternalLink, FileText, Trash2, CheckCircle2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

export function ShoesFReportsDashboard({
  reports,
}: {
  reports: (CommissionReport & { clients?: { name: string } })[]
}) {
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const supabase = createClient()

  const handleCopyLink = async (slug: string) => {
    const url = `${window.location.origin}/report/commissions/${slug}`
    try {
      await navigator.clipboard.writeText(url)
      setCopiedSlug(slug)
      setTimeout(() => setCopiedSlug(null), 2000)
    } catch (err) {
      console.error('Error copying link:', err)
    }
  }

  const handleDelete = async (reportId: string) => {
    if (!confirm('¿Estás seguro de eliminar este reporte?')) return

    setDeletingId(reportId)
    try {
      const { error } = await supabase.from('commission_reports').delete().eq('id', reportId)
      if (error) throw error
      window.location.reload()
    } catch (err: any) {
      console.error('Error deleting report:', err)
      alert('Error al eliminar el reporte')
    } finally {
      setDeletingId(null)
    }
  }

  if (reports.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <FileText className="h-12 w-12 text-white/30 mx-auto mb-4" />
          <p className="text-white/50 mb-2">No hay reportes guardados</p>
          <p className="text-white/30 text-sm mb-4">Guarda una comparación para verla aquí</p>
          <a href="/dashboard/commissions-shoes-f" className="btn-glass inline-block">
            Ir a Comparación
          </a>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4">
        {reports.map((report) => {
          const summary = report.data.summary
          const shareUrl = `${window.location.origin}/report/commissions/${report.slug}`

          return (
            <Card key={report.id} className="glass-card">
              <CardHeader className="flex flex-row items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <FileText className="h-5 w-5 text-[#FF6600]" />
                    <CardTitle className="text-white">{report.period || report.slug || 'Sin nombre'}</CardTitle>
                  </div>
                  <div className="flex flex-wrap items-center gap-4 text-sm text-white/60">
                    <div className="flex items-center gap-1.5">
                      <Calendar className="h-4 w-4" />
                      {format(new Date(report.created_at), "dd/MM/yyyy 'a las' HH:mm", { locale: es })}
                    </div>
                    {report.slug && (
                      <div className="flex items-center gap-1.5">
                        <ExternalLink className="h-4 w-4" />
                        <code className="text-xs bg-white/[0.05] px-2 py-0.5 rounded">{report.slug}</code>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  {report.slug && (
                    <Button
                      onClick={() => handleCopyLink(report.slug!)}
                      variant="glass"
                      size="sm"
                      className="gap-2"
                    >
                      {copiedSlug === report.slug ? (
                        <>
                          <CheckCircle2 className="h-4 w-4" />
                          Copiado
                        </>
                      ) : (
                        <>
                          <Copy className="h-4 w-4" />
                          Copiar Link
                        </>
                      )}
                    </Button>
                  )}
                  <Button
                    onClick={() => handleDelete(report.id)}
                    variant="ghost"
                    size="sm"
                    disabled={deletingId === report.id}
                    className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  <div>
                    <div className="text-xs text-white/50 mb-1">Base Año Anterior</div>
                    <div className="text-sm font-semibold text-white/70">
                      €{(summary.previousYearNetBase || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-white/50 mb-1">Base Año Actual</div>
                    <div className="text-sm font-semibold text-green-400">
                      €{(summary.currentYearNetBase || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-white/50 mb-1">Excedente</div>
                    <div className="text-sm font-semibold text-[#FF6600]">
                      €{(summary.excessAmount || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-white/50 mb-1">Comisión Total</div>
                    <div className="text-lg font-bold text-[#FF6600]">
                      €{(summary.totalCommission || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <a
                    href={`/dashboard/commissions-shoes-f/report/${report.slug}`}
                    className="btn-glass"
                  >
                    Ver detalle
                  </a>

                  {report.slug && (
                    <a
                      href={shareUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-white/50 hover:text-white/70"
                    >
                      Abrir link público
                    </a>
                  )}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
