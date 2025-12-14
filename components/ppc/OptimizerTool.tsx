'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useDropzone } from 'react-dropzone'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Upload, FileX, FileSpreadsheet, Loader2, Download, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { AIInsightsPanel } from './AIInsightsPanel'
import { ChangesReview } from './ChangesReview'
import { createClient } from '@/lib/supabase/client'

interface OptimizerToolProps {
  clientId: string
  clientName: string
}

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

export function OptimizerTool({ clientId, clientName }: OptimizerToolProps) {
  const router = useRouter()
  const [bulkFile, setBulkFile] = useState<File | null>(null)
  const [targetACOS, setTargetACOS] = useState<string>('20')
  const [processing, setProcessing] = useState(false)
  const [analysisData, setAnalysisData] = useState<any>(null)
  const [changes, setChanges] = useState<ChangeRow[] | null>(null)
  const [showReview, setShowReview] = useState(false)
  const [currentACOS, setCurrentACOS] = useState<number | null>(null)
  const [calculatingACOS, setCalculatingACOS] = useState(false)
  const [fileMetrics, setFileMetrics] = useState<{
    totalSpend: number
    totalSales: number
    totalClicks: number
    globalACOS: number
    avgCPC: number
  } | null>(null)

  const calculateACOS = async (file: File) => {
    setCalculatingACOS(true)
    try {
      const formData = new FormData()
      formData.append('bulkFile', file)

      const response = await fetch('/api/marketing/calculate-acos', {
        method: 'POST',
        body: formData,
      })

      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setCurrentACOS(data.acos)
          // Guardar métricas del archivo para usarlas después
          setFileMetrics({
            totalSpend: data.totalSpend || 0,
            totalSales: data.totalSales || 0,
            totalClicks: data.totalClics || 0,
            globalACOS: data.acos || 0,
            avgCPC: data.avgCPC || 0,
          })
          console.log('✅ [OPTIMIZER] ACOS calculado:', data.acos, 'Métricas guardadas:', data)
        }
      }
    } catch (error) {
      console.error('Error calculating ACOS:', error)
    } finally {
      setCalculatingACOS(false)
    }
  }

  const onBulkDrop = useCallback((acceptedFiles: File[]) => {
    console.log('📁 [OPTIMIZER] Bulk File drop:', acceptedFiles)
    if (acceptedFiles.length > 0) {
      const file = acceptedFiles[0]
      console.log('📁 [OPTIMIZER] Bulk File info:', {
        name: file.name,
        size: file.size,
        type: file.type,
        isExcel: file.name.endsWith('.xlsx') || file.name.endsWith('.xls'),
      })
      if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
        setBulkFile(file)
        console.log('✅ [OPTIMIZER] Bulk File cargado correctamente')
        toast.success('Bulk File cargado correctamente')
        // Calcular ACOS automáticamente
        calculateACOS(file)
      } else {
        console.error('❌ [OPTIMIZER] Bulk File formato incorrecto')
        toast.error('El archivo debe ser Excel (.xlsx o .xls)')
      }
    }
  }, [])

  const { getRootProps: getBulkRootProps, getInputProps: getBulkInputProps, isDragActive: isBulkDragActive } = useDropzone({
    onDrop: onBulkDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
    },
    multiple: false,
  })

  const handleProcess = async () => {
    console.log('🚀 [OPTIMIZER] Ejecutando Fusión Nuclear...')
    console.log('🚀 [OPTIMIZER] Estado inicial:', {
      hasBulkFile: !!bulkFile,
      bulkFileName: bulkFile?.name,
      targetACOS,
    })

    if (!bulkFile) {
      console.error('❌ [OPTIMIZER] Falta archivo')
      toast.error('Por favor, carga el archivo Bulk File')
      return
    }

    setProcessing(true)
    try {
      const formData = new FormData()
      formData.append('bulkFile', bulkFile)
      formData.append('targetACOS', targetACOS)

      console.log('📤 [OPTIMIZER] Enviando archivos al servidor...')
      console.log('📤 [OPTIMIZER] FormData:', {
        bulkFileSize: bulkFile.size,
        targetACOS,
      })

      // Procesar archivos y obtener cambios
      const processResponse = await fetch('/api/marketing/dual-process', {
        method: 'POST',
        body: formData,
      })

      console.log('📥 [OPTIMIZER] Respuesta recibida:', {
        ok: processResponse.ok,
        status: processResponse.status,
        statusText: processResponse.statusText,
      })

      if (!processResponse.ok) {
        const error = await processResponse.json()
        console.error('❌ [OPTIMIZER] Error en respuesta:', error)
        throw new Error(error.error || 'Error al procesar los archivos')
      }

      const processData = await processResponse.json()
      console.log('✅ [OPTIMIZER] Datos procesados:', {
        success: processData.success,
        totalChanges: processData.changes?.length || 0,
        summary: processData.summary,
      })
      
      if (processData.success && processData.changes) {
        setChanges(processData.changes)
        setShowReview(true)
        console.log('✅ [OPTIMIZER] Cambios establecidos, mostrando revisión')
        toast.success(`${processData.changes.length} cambios propuestos. Revisa y edita antes de aplicar.`)
      } else {
        console.error('❌ [OPTIMIZER] No se generaron cambios')
        throw new Error('No se generaron cambios')
      }

      // Analizar datos para IA (usando el mismo archivo)
      console.log('🤖 [OPTIMIZER] Analizando datos para IA...')
      const analyzeFormData = new FormData()
      analyzeFormData.append('bulkFile', bulkFile)
      analyzeFormData.append('targetACOS', targetACOS)

      const analyzeResponse = await fetch('/api/marketing/analyze-data', {
        method: 'POST',
        body: analyzeFormData,
      })

      if (analyzeResponse.ok) {
        const analyzeData = await analyzeResponse.json()
        console.log('✅ [OPTIMIZER] Análisis de IA recibido:', {
          success: analyzeData.success,
          hasData: !!analyzeData.data,
          dataKeys: analyzeData.data ? Object.keys(analyzeData.data) : [],
          clientContext: analyzeData.data?.client_context,
        })
        if (analyzeData.success && analyzeData.data) {
          setAnalysisData(analyzeData.data)
          console.log('✅ [OPTIMIZER] analysisData establecido:', analyzeData.data)
        } else {
          console.warn('⚠️ [OPTIMIZER] analyzeData no tiene la estructura esperada')
        }
      } else {
        const errorText = await analyzeResponse.text()
        console.warn('⚠️ [OPTIMIZER] Error al analizar datos para IA:', analyzeResponse.status, errorText)
      }
    } catch (error: any) {
      console.error('❌ [OPTIMIZER] Error processing:', error)
      console.error('❌ [OPTIMIZER] Error stack:', error.stack)
      toast.error(error.message || 'Error al procesar los archivos')
    } finally {
      setProcessing(false)
      console.log('🏁 [OPTIMIZER] Procesamiento finalizado')
    }
  }

  return (
    <div className="space-y-6">
      {/* Configuración de ACOS Objetivo y Actual */}
      <div className="glass-card p-6 rounded-xl">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="targetACOS" className="text-sm font-semibold text-white mb-3 block">
              ACOS Objetivo (%)
            </Label>
            <Input
              id="targetACOS"
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={targetACOS}
              onChange={(e) => setTargetACOS(e.target.value)}
              className="input-glass max-w-xs"
              placeholder="20"
            />
            <p className="text-xs text-white/50 mt-2">
              ACOS objetivo para ajuste automático de pujas
            </p>
          </div>
          <div>
            <Label className="text-sm font-semibold text-white mb-3 block">
              ACOS Actual del Archivo (%)
            </Label>
            <div className="flex items-center gap-2">
              {calculatingACOS ? (
                <div className="flex items-center gap-2 text-white/70">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">Calculando...</span>
                </div>
              ) : currentACOS !== null ? (
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "text-2xl font-bold",
                    currentACOS > parseFloat(targetACOS) ? "text-red-400" : "text-green-400"
                  )}>
                    {currentACOS.toFixed(2)}%
                  </span>
                  {currentACOS > parseFloat(targetACOS) ? (
                    <span className="text-xs text-red-400">Por encima del objetivo</span>
                  ) : (
                    <span className="text-xs text-green-400">Por debajo del objetivo</span>
                  )}
                </div>
              ) : (
                <span className="text-sm text-white/50">
                  Sube el Bulk File para calcular
                </span>
              )}
            </div>
            <p className="text-xs text-white/50 mt-2">
              ACOS calculado del archivo Bulk File cargado
            </p>
          </div>
        </div>
      </div>

      {/* Zona de Drag & Drop - Bulk File Completo */}
      <div className="glass-card p-6 rounded-xl">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5 text-[#FF6600]" />
          Bulk File Completo (Excel)
        </h3>
        <p className="text-sm text-white/60 mb-4">
          Arrastra tu archivo Excel completo de Amazon. Debe contener las pestañas de estructura y términos de búsqueda.
        </p>
        <div
          {...getBulkRootProps()}
          className={cn(
            "border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all duration-200",
            isBulkDragActive
              ? "border-[#FF6600] bg-[#FF6600]/10"
              : "border-white/20 hover:border-white/40",
            bulkFile && "border-green-500/50 bg-green-500/5"
          )}
        >
          <input {...getBulkInputProps()} />
          {bulkFile ? (
            <div className="space-y-2">
              <FileSpreadsheet className="h-12 w-12 mx-auto text-green-400" />
              <p className="text-white font-medium">{bulkFile.name}</p>
              <p className="text-sm text-white/50">
                {(bulkFile.size / 1024).toFixed(2)} KB
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation()
                  setBulkFile(null)
                }}
                className="text-red-400 hover:text-red-300"
              >
                <FileX className="h-4 w-4 mr-2" />
                Eliminar
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <Upload className="h-12 w-12 mx-auto text-white/40" />
              <div>
                <p className="text-white font-medium mb-1">
                  {isBulkDragActive ? 'Suelta el archivo aquí' : 'Arrastra el Bulk File aquí'}
                </p>
                <p className="text-sm text-white/50">
                  o haz clic para seleccionar
                </p>
                <p className="text-xs text-white/40 mt-2">
                  Formato: .xlsx o .xls
                </p>
              </div>
            </div>
          )}
        </div>
      </div>


      {/* Botón de Procesamiento */}
      <div className="flex justify-center">
        <Button
          onClick={handleProcess}
          disabled={!bulkFile || processing}
          className={cn(
            "bg-[#FF6600] text-white hover:bg-[#FF6600]/90",
            "px-8 py-6 text-lg font-semibold",
            "flex items-center gap-3"
          )}
        >
          {processing ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              Procesando...
            </>
          ) : (
            <>
              <Sparkles className="h-5 w-5" />
              Ejecutar Fusión Nuclear
            </>
          )}
        </Button>
      </div>

      {/* Información de la lógica */}
      <div className="glass-card p-6 rounded-xl bg-[#FF6600]/5 border border-[#FF6600]/20">
        <h4 className="text-sm font-semibold text-[#FF6600] mb-3">
          Lógica de Optimización
        </h4>
        <ul className="space-y-2 text-sm text-white/70">
          <li>
            <strong className="text-white">Harvesting:</strong> Si Pedidos ≥ 1 y ACOS &lt; 30%, crea Keyword Exact
          </li>
          <li>
            <strong className="text-white">Bleeders:</strong> Clics &gt; 15 y Ventas = 0 → Puja = 0.05
          </li>
          <li>
            <strong className="text-white">Winners:</strong> ACOS &lt; 10% → Puja × 1.2
          </li>
          <li>
            <strong className="text-white">Ajuste:</strong> Puja × (TargetACOS / CurrentACOS)
          </li>
        </ul>
      </div>

      {/* Panel de Revisión de Cambios */}
      {showReview && changes && changes.length > 0 && (
        <ChangesReview
          clientId={clientId}
          clientName={clientName}
          changes={changes}
          analysisData={analysisData}
          onFinalize={async (finalChanges) => {
            console.log('🚀 [OPTIMIZER] Iniciando finalización...', {
              changesCount: finalChanges.length,
              hasAnalysisData: !!analysisData,
            })

            // Generar y descargar Excel
            const formData = new FormData()
            formData.append('changes', JSON.stringify(finalChanges))

            const excelResponse = await fetch('/api/marketing/generate-excel', {
              method: 'POST',
              body: formData,
            })

            if (!excelResponse.ok) throw new Error('Error al generar Excel')

            const blob = await excelResponse.blob()
            const url = window.URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `optimizacion_ppc_${Date.now()}.xlsx`
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            window.URL.revokeObjectURL(url)

            console.log('✅ [OPTIMIZER] Excel descargado')

            // Guardar snapshot en el dashboard con métricas REALES del archivo completo
            console.log('💾 [OPTIMIZER] Guardando snapshot...', {
              hasAnalysisData: !!analysisData,
              hasClientContext: !!(analysisData && analysisData.client_context),
              hasFileMetrics: !!fileMetrics,
              analysisDataKeys: analysisData ? Object.keys(analysisData) : [],
            })

            const supabase = createClient()
            const weekStart = new Date()
            weekStart.setDate(weekStart.getDate() - weekStart.getDay()) // Lunes de esta semana
            const weekStartStr = weekStart.toISOString().split('T')[0]

            // Priorizar datos de analysisData, si no están usar fileMetrics
            let totalSpend = 0
            let totalSales = 0
            let totalClics = 0
            let globalACOS = 0
            let avgCPC = 0

            if (analysisData && analysisData.client_context) {
              totalSpend = analysisData.client_context.total_spend_week || 0
              totalSales = analysisData.client_context.total_sales || 0
              totalClics = analysisData.client_context.total_clicks || 0
              globalACOS = (analysisData.client_context.global_acos || 0) * 100
              avgCPC = analysisData.client_context.avg_cpc || 0
            } else if (fileMetrics) {
              totalSpend = fileMetrics.totalSpend
              totalSales = fileMetrics.totalSales
              totalClics = fileMetrics.totalClicks
              globalACOS = fileMetrics.globalACOS
              avgCPC = fileMetrics.avgCPC
            } else {
              console.error('❌ [OPTIMIZER] No hay datos disponibles para guardar snapshot')
              toast.error('No hay datos disponibles para guardar en el dashboard')
              return
            }

            const roas = totalSpend > 0 ? (totalSales / totalSpend) : 0
            const avgCTR = 0 // Se puede calcular si tenemos impresiones en el futuro

            // Top productos desde winners
            const topProducts = (analysisData?.winners_analysis || [])
              .slice(0, 5)
              .map((w: any) => ({
                name: w.term || 'N/A',
                sales: w.sales || 0,
                acos: (w.acos || 0) * 100,
              }))

            const snapshotData = {
              client_id: clientId,
              week_start_date: weekStartStr,
              total_spend: totalSpend,
              total_sales: totalSales,
              total_clicks: totalClics,
              global_acos: globalACOS,
              avg_cpc: avgCPC,
              avg_ctr: avgCTR,
              roas: roas,
              top_products: topProducts,
              ai_summary: null,
            }

            console.log('💾 [OPTIMIZER] Snapshot data completo:', snapshotData)

            const { data: savedSnapshot, error: snapshotError } = await supabase
              .from('ppc_weekly_snapshots')
              .upsert(snapshotData, {
                onConflict: 'client_id,week_start_date',
              })
              .select()

            if (snapshotError) {
              console.error('❌ [OPTIMIZER] Error saving snapshot:', snapshotError)
              console.error('❌ [OPTIMIZER] Snapshot data que intentó guardar:', snapshotData)
              toast.error(`Error al guardar snapshot: ${snapshotError.message}`)
            } else {
              console.log('✅ [OPTIMIZER] Snapshot guardado correctamente:', savedSnapshot)
              
              // Generar reporte público automáticamente
              console.log('📊 [OPTIMIZER] Generando reporte público...', {
                totalSpend,
                totalSales,
                totalClics,
                globalACOS,
                avgCPC,
                analysisData: analysisData?.client_context,
              })
              try {
                // Asegurar que tenemos todos los datos correctos
                const reportClientContext = analysisData?.client_context || {
                  target_acos: parseFloat(targetACOS) / 100,
                  total_spend_week: totalSpend,
                  total_sales: totalSales,
                  total_clicks: totalClics,
                  global_acos: globalACOS / 100,
                  avg_cpc: avgCPC,
                }
                
                // Si analysisData existe pero le faltan datos, completarlos
                if (analysisData?.client_context) {
                  reportClientContext.total_spend_week = totalSpend
                  reportClientContext.total_sales = totalSales
                  reportClientContext.total_clicks = totalClics
                  reportClientContext.global_acos = globalACOS / 100
                  reportClientContext.avg_cpc = avgCPC
                }
                
                console.log('📊 [OPTIMIZER] Datos que se envían al reporte:', {
                  clientContext: reportClientContext,
                  changesCount: finalChanges.length,
                })
                
                const reportResponse = await fetch('/api/marketing/generate-report', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    clientId,
                    clientName,
                    changes: finalChanges,
                    clientContext: reportClientContext,
                    bleeders: analysisData?.bleeders_analysis || [],
                    winners: analysisData?.winners_analysis || [],
                    harvestOpportunities: analysisData?.harvest_opportunities || [],
                  }),
                })

                const reportData = await reportResponse.json()

                if (reportData.success && reportData.publicUrl) {
                  console.log('✅ [OPTIMIZER] Reporte público generado:', reportData.publicUrl)
                } else {
                  console.warn('⚠️ [OPTIMIZER] Error al generar reporte:', reportData.error)
                }
              } catch (reportError: any) {
                console.error('❌ [OPTIMIZER] Error generando reporte:', reportError)
                // No bloquear el flujo si falla el reporte
              }

              console.log('✅ [OPTIMIZER] Redirigiendo al dashboard...')
              toast.success('Optimización completada y guardada en el dashboard')
              // Redirigir al dashboard para ver los datos actualizados
              setTimeout(() => {
                console.log('✅ [OPTIMIZER] Ejecutando redirect a:', `/dashboard/marketing/${clientId}`)
                window.location.href = `/dashboard/marketing/${clientId}`
              }, 2000)
            }

            // Resetear estado
            setShowReview(false)
            setChanges(null)
            setAnalysisData(null)
            setBulkFile(null)
          }}
        />
      )}
    </div>
  )
}

