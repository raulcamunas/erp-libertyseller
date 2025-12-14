'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Trash2, AlertCircle, ExternalLink, DollarSign, TrendingUp, Target, BarChart3, MousePointerClick, Eye, Zap, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

interface HistoryListProps {
  snapshots: Array<{
    id: string
    week_start_date: string
    total_spend: number
    total_sales: number
    global_acos: number
    roas: number | null
    avg_cpc: number | null
    avg_ctr: number | null
    total_clicks: number | null
    ai_summary: string | null
    created_at: string
  }>
  currency: string
  clientId: string
  onDelete: () => void
}

export function HistoryList({ snapshots, currency, clientId, onDelete }: HistoryListProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [snapshotToDelete, setSnapshotToDelete] = useState<string | null>(null)
  const [reportSlugs, setReportSlugs] = useState<Record<string, string>>({})
  const [loadingReports, setLoadingReports] = useState(true)
  
  console.log('🔍 [HISTORY] Estado actual:', {
    snapshotsCount: snapshots.length,
    reportSlugsCount: Object.keys(reportSlugs).length,
    reportSlugs,
    loadingReports,
  })

  // Buscar reportes públicos asociados a cada snapshot
  useEffect(() => {
    const fetchReportSlugs = async () => {
      try {
        const supabase = createClient()
        
        // Obtener todos los reportes del cliente
        const { data: reports, error } = await supabase
          .from('ppc_optimization_reports')
          .select('slug, week_start_date')
          .eq('client_id', clientId)

        if (error) {
          console.error('❌ [HISTORY] Error fetching reports:', error)
          return
        }

        console.log('📊 [HISTORY] Todos los reportes del cliente:', reports)
        console.log('📊 [HISTORY] Snapshots:', snapshots.map(s => ({ id: s.id, week: s.week_start_date })))

        const slugsMap: Record<string, string> = {}
        reports?.forEach(report => {
          // Normalizar fechas para comparación (formato YYYY-MM-DD)
          // Asegurarse de que la fecha esté en formato correcto
          let reportDate: string
          if (typeof report.week_start_date === 'string') {
            reportDate = report.week_start_date.split('T')[0] // Ya está en formato YYYY-MM-DD o tiene timestamp
          } else {
            reportDate = new Date(report.week_start_date).toISOString().split('T')[0]
          }
          slugsMap[reportDate] = report.slug
          console.log('📊 [HISTORY] Mapeando reporte:', { original: report.week_start_date, normalized: reportDate, slug: report.slug })
        })
        
        console.log('📊 [HISTORY] Mapa de slugs creado:', slugsMap)
        console.log('📊 [HISTORY] Snapshots para comparar:', snapshots.map(s => ({
          id: s.id,
          week_start_date: s.week_start_date,
          normalized: new Date(s.week_start_date).toISOString().split('T')[0]
        })))
        setReportSlugs(slugsMap)
      } catch (error) {
        console.error('❌ [HISTORY] Error fetching report slugs:', error)
      } finally {
        setLoadingReports(false)
      }
    }

    if (snapshots.length > 0 && clientId) {
      fetchReportSlugs()
    }
  }, [snapshots, clientId])

  const handleDeleteClick = (snapshotId: string) => {
    setSnapshotToDelete(snapshotId)
    setShowDeleteDialog(true)
  }

  const handleDeleteConfirm = async () => {
    if (!snapshotToDelete) return

    setDeletingId(snapshotToDelete)
    try {
      const supabase = createClient()
      const { error } = await supabase
        .from('ppc_weekly_snapshots')
        .delete()
        .eq('id', snapshotToDelete)

      if (error) throw error

      toast.success('Snapshot eliminado correctamente')
      setShowDeleteDialog(false)
      setSnapshotToDelete(null)
      onDelete() // Recargar datos
    } catch (error: any) {
      console.error('Error deleting snapshot:', error)
      toast.error('Error al eliminar el snapshot')
    } finally {
      setDeletingId(null)
    }
  }

  if (snapshots.length === 0) {
    return (
      <div className="glass-card p-12 text-center">
        <p className="text-white/60">
          No hay datos históricos disponibles aún
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="space-y-4">
        {snapshots.map((snapshot) => (
          <div key={snapshot.id} className="glass-card p-6 rounded-xl">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-white">
                  Semana del {new Date(snapshot.week_start_date).toLocaleDateString('es-ES', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </h3>
                <p className="text-sm text-white/50 mt-1">
                  Creado: {new Date(snapshot.created_at).toLocaleDateString('es-ES', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {/* Botón de Reporte - Siempre visible */}
                {(() => {
                  // Normalizar fecha del snapshot para comparación
                  const snapshotDate = new Date(snapshot.week_start_date).toISOString().split('T')[0]
                  const slug = reportSlugs[snapshotDate]
                  
                  console.log('🔍 [HISTORY] Renderizando botón para snapshot:', {
                    snapshotId: snapshot.id,
                    snapshotDate,
                    slug,
                    reportSlugsKeys: Object.keys(reportSlugs),
                    loadingReports,
                  })
                  
                  if (loadingReports) {
                    return (
                      <Button
                        disabled
                        variant="ghost"
                        size="sm"
                        className="text-white/30"
                      >
                        <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                        <span className="text-xs font-medium">Cargando...</span>
                      </Button>
                    )
                  }
                  
                  if (slug) {
                    return (
                      <Button
                        onClick={() => {
                          console.log('🔗 [HISTORY] Abriendo reporte:', slug)
                          window.open(`/report/ppc/${slug}`, '_blank')
                        }}
                        variant="ghost"
                        size="sm"
                        className="text-orange-400 hover:text-orange-300 hover:bg-orange-500/10 border border-orange-500/20"
                        title="Ver reporte público"
                      >
                        <ExternalLink className="h-4 w-4 mr-1.5" />
                        <span className="text-xs font-medium">Ver Reporte</span>
                      </Button>
                    )
                  }
                  
                  // Si no hay reporte, mostrar botón deshabilitado
                  return (
                    <Button
                      disabled
                      variant="ghost"
                      size="sm"
                      className="text-white/30 cursor-not-allowed border border-white/10"
                      title="No hay reporte público disponible para esta semana. Genera uno desde la pestaña Optimizar."
                    >
                      <ExternalLink className="h-4 w-4 mr-1.5" />
                      <span className="text-xs font-medium">Sin Reporte</span>
                    </Button>
                  )
                })()}
                <Button
                  onClick={() => handleDeleteClick(snapshot.id)}
                  disabled={deletingId === snapshot.id}
                  variant="ghost"
                  size="sm"
                  className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                  title="Eliminar snapshot"
                >
                  {deletingId === snapshot.id ? (
                    <AlertCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
            {/* Todas las métricas con iconos y colores */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mt-4">
              {/* Gasto Total */}
              <div className="glass-card p-4 rounded-lg border border-red-500/20">
                <div className="flex items-center gap-2 mb-2">
                  <div className="p-1.5 rounded-lg bg-red-500/10">
                    <DollarSign className="h-3.5 w-3.5 text-red-400" />
                  </div>
                  <p className="text-xs text-white/50">Gasto Total</p>
                </div>
                <p className="text-lg font-semibold text-red-400">
                  {snapshot.total_spend.toLocaleString('es-ES', {
                    style: 'currency',
                    currency,
                  })}
                </p>
              </div>

              {/* Ventas Totales */}
              <div className="glass-card p-4 rounded-lg border border-green-500/20">
                <div className="flex items-center gap-2 mb-2">
                  <div className="p-1.5 rounded-lg bg-green-500/10">
                    <TrendingUp className="h-3.5 w-3.5 text-green-400" />
                  </div>
                  <p className="text-xs text-white/50">Ventas Totales</p>
                </div>
                <p className="text-lg font-semibold text-green-400">
                  {snapshot.total_sales.toLocaleString('es-ES', {
                    style: 'currency',
                    currency,
                  })}
                </p>
              </div>

              {/* ACOS Global */}
              <div className="glass-card p-4 rounded-lg border border-yellow-500/20">
                <div className="flex items-center gap-2 mb-2">
                  <div className="p-1.5 rounded-lg bg-yellow-500/10">
                    <Target className="h-3.5 w-3.5 text-yellow-400" />
                  </div>
                  <p className="text-xs text-white/50">ACOS Global</p>
                </div>
                <p className={cn(
                  "text-lg font-semibold",
                  snapshot.global_acos > 35 ? "text-red-400" : snapshot.global_acos < 10 ? "text-green-400" : "text-yellow-400"
                )}>
                  {snapshot.global_acos.toFixed(2)}%
                </p>
              </div>

              {/* ROAS */}
              <div className="glass-card p-4 rounded-lg border border-blue-500/20">
                <div className="flex items-center gap-2 mb-2">
                  <div className="p-1.5 rounded-lg bg-blue-500/10">
                    <BarChart3 className="h-3.5 w-3.5 text-blue-400" />
                  </div>
                  <p className="text-xs text-white/50">ROAS</p>
                </div>
                <p className="text-lg font-semibold text-blue-400">
                  {snapshot.roas !== null && snapshot.roas !== undefined
                    ? Number(snapshot.roas).toFixed(2)
                    : snapshot.total_spend > 0
                      ? (snapshot.total_sales / snapshot.total_spend).toFixed(2)
                      : '0.00'
                  }
                </p>
              </div>

              {/* CPC Promedio */}
              <div className="glass-card p-4 rounded-lg border border-purple-500/20">
                <div className="flex items-center gap-2 mb-2">
                  <div className="p-1.5 rounded-lg bg-purple-500/10">
                    <MousePointerClick className="h-3.5 w-3.5 text-purple-400" />
                  </div>
                  <p className="text-xs text-white/50">CPC Promedio</p>
                </div>
                <p className="text-lg font-semibold text-purple-400">
                  {snapshot.avg_cpc !== null && snapshot.avg_cpc !== undefined
                    ? `${Number(snapshot.avg_cpc).toFixed(2)}€`
                    : '-'
                  }
                </p>
              </div>

              {/* CTR Promedio */}
              <div className="glass-card p-4 rounded-lg border border-cyan-500/20">
                <div className="flex items-center gap-2 mb-2">
                  <div className="p-1.5 rounded-lg bg-cyan-500/10">
                    <Eye className="h-3.5 w-3.5 text-cyan-400" />
                  </div>
                  <p className="text-xs text-white/50">CTR Promedio</p>
                </div>
                <p className="text-lg font-semibold text-cyan-400">
                  {snapshot.avg_ctr !== null && snapshot.avg_ctr !== undefined
                    ? `${Number(snapshot.avg_ctr).toFixed(2)}%`
                    : '-'
                  }
                </p>
              </div>

              {/* Clics Totales */}
              <div className="glass-card p-4 rounded-lg border border-orange-500/20">
                <div className="flex items-center gap-2 mb-2">
                  <div className="p-1.5 rounded-lg bg-orange-500/10">
                    <Zap className="h-3.5 w-3.5 text-orange-400" />
                  </div>
                  <p className="text-xs text-white/50">Clics Totales</p>
                </div>
                <p className="text-lg font-semibold text-orange-400">
                  {snapshot.total_clicks !== null && snapshot.total_clicks !== undefined
                    ? Number(snapshot.total_clicks).toLocaleString('es-ES')
                    : '-'
                  }
                </p>
              </div>
            </div>
            {snapshot.ai_summary && (
              <div className="mt-4 pt-4 border-t border-white/10">
                <p className="text-sm text-white/70">{snapshot.ai_summary}</p>
              </div>
            )}
          </div>
        ))}
      </div>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este snapshot?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. Se eliminará permanentemente este registro histórico.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-red-500 hover:bg-red-600"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

