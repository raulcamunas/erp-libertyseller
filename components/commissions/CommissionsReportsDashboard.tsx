'use client'

import { useState } from 'react'
import { CommissionReport, Client } from '@/lib/types/commissions'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { 
  FileText, 
  Copy, 
  ExternalLink,
  Trash2,
  Calendar,
  User,
  CheckCircle2,
  XCircle
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { cn } from '@/lib/utils'

interface CommissionsReportsDashboardProps {
  reports: (CommissionReport & { clients?: { name: string } })[]
  clients: Client[]
}

export function CommissionsReportsDashboard({ reports, clients }: CommissionsReportsDashboardProps) {
  const [selectedClient, setSelectedClient] = useState<string>('all')
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const supabase = createClient()

  const filteredReports = selectedClient === 'all' 
    ? reports 
    : reports.filter(r => r.client_id === selectedClient)

  const handleCopyLink = async (slug: string) => {
    const url = `${window.location.origin}/dashboard/commissions/report/${slug}`
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
      const { error } = await supabase
        .from('commission_reports')
        .delete()
        .eq('id', reportId)

      if (error) throw error

      // Recargar la página para actualizar la lista
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
          <p className="text-white/30 text-sm mb-4">
            Crea tu primer reporte desde la calculadora de comisiones
          </p>
          <a
            href="/dashboard/commissions"
            className="btn-glass inline-block"
          >
            Ir a Calculadora
          </a>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Filtro por Cliente */}
      <Card>
        <CardHeader>
          <CardTitle className="text-white text-sm">Filtrar por Cliente</CardTitle>
        </CardHeader>
        <CardContent>
          <select
            value={selectedClient}
            onChange={(e) => setSelectedClient(e.target.value)}
            className="input-glass w-full md:w-auto"
          >
            <option value="all">Todos los clientes</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
        </CardContent>
      </Card>

      {/* Lista de Reportes */}
      <div className="grid grid-cols-1 gap-4">
        {filteredReports.map((report) => {
          const clientName = report.clients?.name || 'Cliente desconocido'
          const summary = report.data.summary
          const shareUrl = `${window.location.origin}/dashboard/commissions/report/${report.slug}`

          return (
            <Card key={report.id} className="glass-card">
              <CardHeader className="flex flex-row items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <FileText className="h-5 w-5 text-[#FF6600]" />
                    <CardTitle className="text-white">
                      {report.period || 'Sin período'}
                    </CardTitle>
                    <span className={cn(
                      "text-xs px-2 py-1 rounded-full font-semibold",
                      report.status === 'final' 
                        ? "bg-green-500/20 text-green-400 border border-green-500/30"
                        : report.status === 'archived'
                        ? "bg-gray-500/20 text-gray-400 border border-gray-500/30"
                        : "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30"
                    )}>
                      {report.status === 'final' ? 'Final' : report.status === 'archived' ? 'Archivado' : 'Borrador'}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-4 text-sm text-white/60">
                    <div className="flex items-center gap-1.5">
                      <User className="h-4 w-4" />
                      {clientName}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Calendar className="h-4 w-4" />
                      {format(new Date(report.created_at), "dd/MM/yyyy 'a las' HH:mm", { locale: es })}
                    </div>
                    {report.slug && (
                      <div className="flex items-center gap-1.5">
                        <ExternalLink className="h-4 w-4" />
                        <code className="text-xs bg-white/[0.05] px-2 py-0.5 rounded">
                          {report.slug}
                        </code>
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
                {/* Resumen del Reporte */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
                  <div>
                    <div className="text-xs text-white/50 mb-1">Ventas Totales</div>
                    <div className="text-sm font-semibold text-white">
                      €{summary.totalSales.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-white/50 mb-1">Reembolsos</div>
                    <div className="text-sm font-semibold text-red-400">
                      €{summary.totalRefunds.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-white/50 mb-1">Base Neta</div>
                    <div className="text-sm font-semibold text-green-400">
                      €{summary.netBase.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-white/50 mb-1">Tasa Promedio</div>
                    <div className="text-sm font-semibold text-white">
                      {(summary.averageCommissionRate * 100).toFixed(2)}%
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-white/50 mb-1">Comisión Total</div>
                    <div className="text-lg font-bold text-[#FF6600]">
                      €{summary.totalCommission.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                </div>

                {/* Link para compartir */}
                {report.slug && (
                  <div className="flex items-center gap-2 p-3 bg-white/[0.03] border border-white/10 rounded-lg">
                    <div className="flex-1">
                      <div className="text-xs text-white/50 mb-1">Link para compartir:</div>
                      <div className="text-sm text-white/70 font-mono break-all">
                        {shareUrl}
                      </div>
                    </div>
                    <Button
                      onClick={() => window.open(shareUrl, '_blank')}
                      variant="ghost"
                      size="sm"
                      className="gap-2"
                    >
                      <ExternalLink className="h-4 w-4" />
                      Abrir
                    </Button>
                  </div>
                )}

                {/* Estadísticas adicionales */}
                <div className="mt-4 flex flex-wrap gap-4 text-xs text-white/50">
                  <span>{report.data.rows.length} productos procesados</span>
                  <span>{summary.totalOrders} pedidos</span>
                  {report.data.errors.length > 0 && (
                    <span className="text-yellow-400">
                      {report.data.errors.length} errores de parsing
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {filteredReports.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-white/50">No hay reportes para el cliente seleccionado</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

