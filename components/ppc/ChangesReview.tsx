'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Download, Loader2, CheckCircle2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { AIInsightsPanel } from './AIInsightsPanel'
import { createClient } from '@/lib/supabase/client'

interface ChangeRow {
  'Producto': string
  'Entidad': string
  'Operación': string
  'ID de la campaña': string
  'ID del grupo de anuncios': string
  'ID de palabra clave': string
  'Puja': number
  'Estado': string
  'Texto de palabra clave': string
  'Tipo de coincidencia': string
  'Puja Original'?: number
  'ACOS'?: number
  'Ventas'?: number
  'Origen'?: string
}

interface ChangesReviewProps {
  clientId: string
  changes: ChangeRow[]
  analysisData: any
  onFinalize: (finalChanges: ChangeRow[]) => Promise<void>
}

export function ChangesReview({ clientId, changes, analysisData, onFinalize }: ChangesReviewProps) {
  const [editableChanges, setEditableChanges] = useState<ChangeRow[]>(changes)
  const [finalizing, setFinalizing] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  const handleBidChange = (index: number, newBid: number) => {
    const updated = [...editableChanges]
    updated[index] = { ...updated[index], 'Puja': newBid }
    setEditableChanges(updated)
  }

  const handleRemoveChange = (index: number) => {
    const updated = editableChanges.filter((_, i) => i !== index)
    setEditableChanges(updated)
  }

  const handleFinalize = async () => {
    setFinalizing(true)
    try {
      await onFinalize(editableChanges)
      toast.success('Optimización completada y guardada en el dashboard')
      // Redirigir al dashboard después de un breve delay
      setTimeout(() => {
        router.push(`/dashboard/marketing/${clientId}`)
        router.refresh()
      }, 1500)
    } catch (error: any) {
      console.error('Error finalizing:', error)
      toast.error(error.message || 'Error al finalizar la optimización')
    } finally {
      setFinalizing(false)
    }
  }

  const downloadExcel = async () => {
    try {
      // Generar Excel con los cambios editables
      const formData = new FormData()
      formData.append('changes', JSON.stringify(editableChanges))

      const response = await fetch('/api/marketing/generate-excel', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) throw new Error('Error al generar Excel')

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `optimizacion_ppc_${Date.now()}.xlsx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)

      toast.success('Excel descargado correctamente')
    } catch (error: any) {
      console.error('Error downloading Excel:', error)
      toast.error('Error al descargar el Excel')
    }
  }

  const getActionColor = (action: string) => {
    switch (action) {
      case 'UPDATE':
        return 'text-blue-400'
      case 'CREATE Keyword Exact':
        return 'text-green-400'
      case 'CREATE Negative':
        return 'text-red-400'
      default:
        return 'text-white/70'
    }
  }

  const getActionBadge = (action: string) => {
    switch (action) {
      case 'UPDATE':
        return 'bg-blue-500/20 text-blue-400 border-blue-500/30'
      case 'CREATE Keyword Exact':
        return 'bg-green-500/20 text-green-400 border-green-500/30'
      case 'CREATE Negative':
        return 'bg-red-500/20 text-red-400 border-red-500/30'
      default:
        return 'bg-white/10 text-white/70 border-white/20'
    }
  }

  return (
    <div className="space-y-6 mt-6">
      {/* Resumen */}
      <div className="glass-card p-6 rounded-xl">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-white mb-1">
              Revisión de Cambios
            </h3>
            <p className="text-sm text-white/50">
              {editableChanges.length} cambios propuestos. Revisa y edita las pujas antes de aplicar.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={downloadExcel}
              variant="outline"
              className="border-white/20 hover:border-white/40"
            >
              <Download className="h-4 w-4 mr-2" />
              Descargar Excel
            </Button>
            <Button
              onClick={handleFinalize}
              disabled={finalizing || editableChanges.length === 0}
              className="bg-[#FF6600] text-white hover:bg-[#FF6600]/90"
            >
              {finalizing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Guardando...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Optimizar Finalmente
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Tabla de Cambios */}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-white/10">
                <TableHead className="text-white">Operación</TableHead>
                <TableHead className="text-white">Campaña</TableHead>
                <TableHead className="text-white">Keyword</TableHead>
                <TableHead className="text-white text-right">Puja Original</TableHead>
                <TableHead className="text-white text-right">Puja Nueva</TableHead>
                <TableHead className="text-white text-right">Cambio</TableHead>
                <TableHead className="text-white">Tipo</TableHead>
                <TableHead className="text-white text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {editableChanges.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-white/60 py-8">
                    No hay cambios para aplicar
                  </TableCell>
                </TableRow>
              ) : (
                editableChanges.map((change, index) => {
                  const originalBid = change['Puja Original'] || 0
                  const newBid = change['Puja']
                  const changePercent = originalBid > 0 
                    ? ((newBid - originalBid) / originalBid) * 100 
                    : 0

                  return (
                    <TableRow key={index} className="border-white/10">
                      <TableCell>
                        <span className={cn(
                          "px-2 py-1 rounded-full text-xs font-semibold border",
                          getActionBadge(change['Operación'])
                        )}>
                          {change['Operación']}
                        </span>
                      </TableCell>
                      <TableCell className="text-white/80 text-sm">
                        {change['ID de la campaña']}
                      </TableCell>
                      <TableCell className="text-white/80 text-sm">
                        {change['Texto de palabra clave']}
                      </TableCell>
                      <TableCell className="text-white/70 text-right">
                        {originalBid > 0 ? originalBid.toFixed(2) : '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={change['Puja']}
                          onChange={(e) => handleBidChange(index, parseFloat(e.target.value) || 0)}
                          className="w-24 h-8 input-glass text-right"
                        />
                      </TableCell>
                      <TableCell className={cn(
                        "text-right font-semibold",
                        changePercent > 0 ? "text-green-400" : changePercent < 0 ? "text-red-400" : "text-white/70"
                      )}>
                        {changePercent !== 0 && (
                          <>
                            {changePercent > 0 ? '+' : ''}
                            {changePercent.toFixed(1)}%
                          </>
                        )}
                      </TableCell>
                      <TableCell className="text-white/60 text-xs max-w-xs truncate">
                        {change['Tipo de coincidencia'] || change['Origen'] || '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveChange(index)}
                          className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                        >
                          <XCircle className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Análisis de IA */}
      {analysisData && (
        <AIInsightsPanel
          clientId={clientId}
          clientContext={analysisData.client_context}
          bleeders={analysisData.bleeders_analysis}
          winners={analysisData.winners_analysis}
          harvestOpportunities={analysisData.harvest_opportunities}
        />
      )}
    </div>
  )
}

