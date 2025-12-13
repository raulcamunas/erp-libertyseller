'use client'

import { useState, useCallback } from 'react'
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

export function OptimizerTool({ clientId }: OptimizerToolProps) {
  const [bulkFile, setBulkFile] = useState<File | null>(null)
  const [searchFile, setSearchFile] = useState<File | null>(null)
  const [targetACOS, setTargetACOS] = useState<string>('20')
  const [processing, setProcessing] = useState(false)
  const [analysisData, setAnalysisData] = useState<any>(null)
  const [changes, setChanges] = useState<ChangeRow[] | null>(null)
  const [showReview, setShowReview] = useState(false)

  const onBulkDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      const file = acceptedFiles[0]
      if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
        setBulkFile(file)
        toast.success('Bulk File cargado correctamente')
      } else {
        toast.error('El archivo debe ser Excel (.xlsx o .xls)')
      }
    }
  }, [])

  const onSearchDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      const file = acceptedFiles[0]
      if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
        setSearchFile(file)
        toast.success('Search Term Report cargado correctamente')
      } else {
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

  const { getRootProps: getSearchRootProps, getInputProps: getSearchInputProps, isDragActive: isSearchDragActive } = useDropzone({
    onDrop: onSearchDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
    },
    multiple: false,
  })

  const handleProcess = async () => {
    if (!bulkFile || !searchFile) {
      toast.error('Por favor, carga ambos archivos')
      return
    }

    setProcessing(true)
    try {
      const formData = new FormData()
      formData.append('bulkFile', bulkFile)
      formData.append('searchFile', searchFile)
      formData.append('targetACOS', targetACOS)

      // Procesar archivos y obtener cambios
      const processResponse = await fetch('/api/marketing/dual-process', {
        method: 'POST',
        body: formData,
      })

      if (!processResponse.ok) {
        const error = await processResponse.json()
        throw new Error(error.error || 'Error al procesar los archivos')
      }

      const processData = await processResponse.json()
      
      if (processData.success && processData.changes) {
        setChanges(processData.changes)
        setShowReview(true)
        toast.success(`${processData.changes.length} cambios propuestos. Revisa y edita antes de aplicar.`)
      } else {
        throw new Error('No se generaron cambios')
      }

      // Analizar datos para IA
      const analyzeResponse = await fetch('/api/marketing/analyze-data', {
        method: 'POST',
        body: formData,
      })

      if (analyzeResponse.ok) {
        const analyzeData = await analyzeResponse.json()
        if (analyzeData.success) {
          setAnalysisData(analyzeData.data)
        }
      }
    } catch (error: any) {
      console.error('Error processing:', error)
      toast.error(error.message || 'Error al procesar los archivos')
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Configuración de ACOS Objetivo */}
      <div className="glass-card p-6 rounded-xl">
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

      {/* Zona de Drag & Drop - Bulk File */}
      <div className="glass-card p-6 rounded-xl">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5 text-[#FF6600]" />
          Bulk File (Excel)
        </h3>
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

      {/* Zona de Drag & Drop - Search Term Report */}
      <div className="glass-card p-6 rounded-xl">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5 text-[#FF6600]" />
          Search Term Report (CSV)
        </h3>
        <div
          {...getSearchRootProps()}
          className={cn(
            "border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all duration-200",
            isSearchDragActive
              ? "border-[#FF6600] bg-[#FF6600]/10"
              : "border-white/20 hover:border-white/40",
            searchFile && "border-green-500/50 bg-green-500/5"
          )}
        >
          <input {...getSearchInputProps()} />
          {searchFile ? (
            <div className="space-y-2">
              <FileSpreadsheet className="h-12 w-12 mx-auto text-green-400" />
              <p className="text-white font-medium">{searchFile.name}</p>
              <p className="text-sm text-white/50">
                {(searchFile.size / 1024).toFixed(2)} KB
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation()
                  setSearchFile(null)
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
                  {isSearchDragActive ? 'Suelta el archivo aquí' : 'Arrastra el Search Term Report aquí'}
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
          disabled={!bulkFile || !searchFile || processing}
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
      {showReview && changes && (
        <ChangesReview
          clientId={clientId}
          changes={changes}
          analysisData={analysisData}
          onFinalize={async (finalChanges) => {
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

            // Guardar snapshot en el dashboard
            if (analysisData && analysisData.client_context) {
              const supabase = createClient()
              const weekStart = new Date()
              weekStart.setDate(weekStart.getDate() - weekStart.getDay()) // Lunes de esta semana

              // Calcular métricas desde los cambios finales
              const totalSpend = analysisData.client_context.total_spend_week || 0
              const globalACOS = analysisData.client_context.global_acos || 0.01
              const totalSales = totalSpend / globalACOS

              const { error: snapshotError } = await supabase
                .from('ppc_weekly_snapshots')
                .upsert({
                  client_id: clientId,
                  week_start_date: weekStart.toISOString().split('T')[0],
                  total_spend: totalSpend,
                  total_sales: totalSales,
                  global_acos: globalACOS * 100,
                  top_products: (analysisData.winners_analysis || []).slice(0, 5).map((w: any) => ({
                    name: w.term || 'N/A',
                    sales: w.sales || 0,
                    acos: (w.acos || 0) * 100,
                  })),
                  ai_summary: null, // Se puede actualizar después con el análisis de IA
                }, {
                  onConflict: 'client_id,week_start_date',
                })

              if (snapshotError) {
                console.error('Error saving snapshot:', snapshotError)
                // No fallar si no se puede guardar el snapshot
              }
            }

            // Resetear estado
            setShowReview(false)
            setChanges(null)
            setAnalysisData(null)
            setBulkFile(null)
            setSearchFile(null)
          }}
        />
      )}
    </div>
  )
}

