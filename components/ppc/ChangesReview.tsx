'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Download, Loader2, CheckCircle2, XCircle, Calculator, Brain } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { AIInsightsPanel } from './AIInsightsPanel'
import { createClient } from '@/lib/supabase/client'
import { ChangeReasonPanel } from './ChangeReasonPanel'
import { GlobalMetricsPanel } from './GlobalMetricsPanel'

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
  'Gasto'?: number
  'CPC'?: number
  'ROAS'?: number
  'CTR'?: number
  'Clics'?: number
  'Pedidos'?: number
  'Origen'?: string
  'Decision Maker'?: 'ALGORITHM' | 'AI'
  'AI Reasoning'?: string
}

interface ChangesReviewProps {
  clientId: string
  clientName: string
  changes: ChangeRow[]
  analysisData: any
  onFinalize: (finalChanges: ChangeRow[]) => Promise<void>
}

export function ChangesReview({ clientId, clientName, changes, analysisData, onFinalize }: ChangesReviewProps) {
  const [editableChanges, setEditableChanges] = useState<ChangeRow[]>(changes)
  const [finalizing, setFinalizing] = useState(false)
  const [selectedChangeIndex, setSelectedChangeIndex] = useState<number | null>(null)
  const router = useRouter()
  const supabase = createClient()

  // Actualizar editableChanges cuando changes cambie
  useEffect(() => {
    console.log('🔄 [CHANGES-REVIEW] Cambios recibidos:', {
      changesLength: changes?.length || 0,
      changes: changes,
      firstChange: changes?.[0],
    })
    if (changes && changes.length > 0) {
      // Añadir Puja Original si no existe
      const changesWithOriginal = changes.map(change => ({
        ...change,
        'Puja Original': change['Puja Original'] || change['Puja'],
      }))
      console.log('✅ [CHANGES-REVIEW] Cambios procesados:', {
        total: changesWithOriginal.length,
        firstChange: changesWithOriginal[0],
      })
      setEditableChanges(changesWithOriginal)
    } else {
      console.warn('⚠️ [CHANGES-REVIEW] No hay cambios para mostrar')
      setEditableChanges([])
    }
  }, [changes])

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

  const getActionBadge = (change: ChangeRow) => {
    const operation = change['Operación']
    const entity = change['Entidad']
    
    if (operation === 'UPDATE') {
      return {
        label: 'UPDATE',
        className: 'bg-blue-500/20 text-blue-400 border-blue-500/30'
      }
    }
    
    if (operation === 'CREATE') {
      if (entity === 'Palabra clave negativa') {
        return {
          label: 'NEGATIVIZAR',
          className: 'bg-red-500/20 text-red-400 border-red-500/30'
        }
      }
      
      // Si es harvesting (viene de AUTO o tiene metadata con orders)
      if (change['Pedidos'] || change['Origen']?.includes('AUTO')) {
        return {
          label: 'EXACTA',
          className: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
        }
      }
      
      // Si es creación manual normal
      return {
        label: 'MANUAL',
        className: 'bg-green-500/20 text-green-400 border-green-500/30'
      }
    }
    
    return {
      label: operation,
      className: 'bg-white/10 text-white/70 border-white/20'
    }
  }

  console.log('🎨 [CHANGES-REVIEW] Renderizando con:', {
    editableChangesLength: editableChanges.length,
    changesLength: changes.length,
    editableChanges: editableChanges,
  })

  return (
    <div className="space-y-6 mt-6">
      {/* Resumen y Botones */}
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
      </div>

      {/* Métricas Globales */}
      <GlobalMetricsPanel changes={editableChanges} />

      {/* Layout de 2 columnas - Tabla más ancha */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Columna izquierda: Tabla de cambios (4/5) */}
        <div className="lg:col-span-4">
          <div className="glass-card p-6 rounded-xl">
            {/* Tabla de Cambios */}
            <div className="overflow-x-auto max-h-[calc(100vh-300px)] overflow-y-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-[#080808] backdrop-blur-sm">
              <TableRow className="border-white/10">
                <TableHead className="text-white bg-[#080808]/95 backdrop-blur-sm sticky top-0 z-10">Operación</TableHead>
                <TableHead className="text-white bg-[#080808]/95 backdrop-blur-sm sticky top-0 z-10">Decision Maker</TableHead>
                <TableHead className="text-white bg-[#080808]/95 backdrop-blur-sm sticky top-0 z-10">Campaña</TableHead>
                <TableHead className="text-white bg-[#080808]/95 backdrop-blur-sm sticky top-0 z-10">Keyword</TableHead>
                <TableHead className="text-white text-right bg-[#080808]/95 backdrop-blur-sm sticky top-0 z-10">Puja Original</TableHead>
                <TableHead className="text-white text-right bg-[#080808]/95 backdrop-blur-sm sticky top-0 z-10">Puja Nueva</TableHead>
                <TableHead className="text-white text-right bg-[#080808]/95 backdrop-blur-sm sticky top-0 z-10">Cambio</TableHead>
                <TableHead className="text-white text-right bg-[#080808]/95 backdrop-blur-sm sticky top-0 z-10">Gasto</TableHead>
                <TableHead className="text-white text-right bg-[#080808]/95 backdrop-blur-sm sticky top-0 z-10">ACOS</TableHead>
                <TableHead className="text-white text-right bg-[#080808]/95 backdrop-blur-sm sticky top-0 z-10">CPC</TableHead>
                <TableHead className="text-white text-right bg-[#080808]/95 backdrop-blur-sm sticky top-0 z-10">ROAS</TableHead>
                <TableHead className="text-white text-right bg-[#080808]/95 backdrop-blur-sm sticky top-0 z-10">CTR</TableHead>
                <TableHead className="text-white text-right bg-[#080808]/95 backdrop-blur-sm sticky top-0 z-10">Clics</TableHead>
                <TableHead className="text-white text-right bg-[#080808]/95 backdrop-blur-sm sticky top-0 z-10">Ventas</TableHead>
                <TableHead className="text-white bg-[#080808]/95 backdrop-blur-sm sticky top-0 z-10">Tipo</TableHead>
                <TableHead className="text-white text-right bg-[#080808]/95 backdrop-blur-sm sticky top-0 z-10">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {editableChanges.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={16} className="text-center text-white/60 py-8">
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
                  const decisionMaker = change['Decision Maker'] || 'ALGORITHM'
                  const aiReasoning = change['AI Reasoning']
                  const gasto = change['Gasto'] || 0
                  const acos = change['ACOS'] || 0
                  const clics = change['Clics'] || 0
                  const ventas = change['Ventas'] || 0
                  const actionBadge = getActionBadge(change)
                  
                  // Usar métricas del backend o calcular si no están disponibles
                  const cpc = change['CPC'] || (clics > 0 ? (gasto / clics) : (newBid || 0))
                  const roas = change['ROAS'] || (gasto > 0 ? (ventas / gasto) : 0)
                  const ctr = change['CTR'] || 0

                  return (
                    <TableRow 
                      key={index} 
                      className={cn(
                        "border-white/10 cursor-pointer transition-colors",
                        selectedChangeIndex === index ? "bg-white/5" : "hover:bg-white/2"
                      )}
                      onClick={() => setSelectedChangeIndex(selectedChangeIndex === index ? null : index)}
                    >
                      <TableCell>
                        <span className={cn(
                          "px-2 py-1 rounded-full text-xs font-semibold border",
                          actionBadge.className
                        )}>
                          {actionBadge.label}
                        </span>
                      </TableCell>
                      <TableCell>
                        {decisionMaker === 'AI' ? (
                          <div className="group relative">
                            <div className="flex items-center gap-1 text-purple-400">
                              <Brain className="h-4 w-4" />
                              <span className="text-xs font-semibold">IA</span>
                            </div>
                            {aiReasoning && (
                              <div className="absolute left-0 top-full mt-2 w-64 p-2 bg-black/95 border border-white/20 rounded-lg text-xs text-white/80 z-50 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                                {aiReasoning}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 text-blue-400">
                            <Calculator className="h-4 w-4" />
                            <span className="text-xs font-semibold">Algoritmo</span>
                          </div>
                        )}
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
                          className="w-32 min-w-[120px] h-8 input-glass text-right"
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
                      <TableCell className="text-white/70 text-right text-sm">
                        {gasto > 0 ? `${gasto.toFixed(2)}€` : '-'}
                      </TableCell>
                      <TableCell className={cn(
                        "text-right text-sm font-semibold",
                        acos > 0 
                          ? (acos > 35 ? "text-red-400" : acos < 10 ? "text-green-400" : "text-yellow-400")
                          : "text-white/70"
                      )}>
                        {acos > 0 ? `${acos.toFixed(2)}%` : '-'}
                      </TableCell>
                      <TableCell className="text-white/70 text-right text-sm">
                        {cpc > 0 ? `${cpc.toFixed(2)}€` : '-'}
                      </TableCell>
                      <TableCell className={cn(
                        "text-right text-sm font-semibold",
                        roas > 0 
                          ? (roas > 3 ? "text-green-400" : roas > 1 ? "text-yellow-400" : "text-red-400")
                          : "text-white/70"
                      )}>
                        {roas > 0 ? `${roas.toFixed(2)}x` : '-'}
                      </TableCell>
                      <TableCell className="text-white/70 text-right text-sm">
                        {ctr > 0 ? `${ctr.toFixed(2)}%` : '-'}
                      </TableCell>
                      <TableCell className="text-white/70 text-right text-sm">
                        {clics > 0 ? clics : '-'}
                      </TableCell>
                      <TableCell className={cn(
                        "text-right text-sm font-semibold",
                        ventas > 0 ? "text-green-400" : "text-white/70"
                      )}>
                        {ventas > 0 ? `${ventas.toFixed(2)}€` : '-'}
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
        </div>

        {/* Columna derecha: Panel de razones (1/5) */}
        <div className="lg:col-span-1">
          <ChangeReasonPanel
            changes={editableChanges}
            selectedIndex={selectedChangeIndex}
            onSelectChange={setSelectedChangeIndex}
          />
        </div>
      </div>

      {/* Análisis de IA */}
      {analysisData && (
        <AIInsightsPanel
          clientId={clientId}
          clientName={clientName}
          clientContext={analysisData.client_context}
          changes={editableChanges}
          bleeders={analysisData.bleeders_analysis}
          winners={analysisData.winners_analysis}
          harvestOpportunities={analysisData.harvest_opportunities}
        />
      )}
    </div>
  )
}

