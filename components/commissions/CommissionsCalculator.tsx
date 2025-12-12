'use client'

import { useState, useCallback, useEffect } from 'react'
import { Client, CommissionCalculationData, CommissionRow, CommissionException } from '@/lib/types/commissions'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { 
  Upload, 
  FileText, 
  X, 
  Download,
  Save,
  Calculator,
  AlertCircle,
  Info
} from 'lucide-react'
import { LibertyButton } from '@/components/ui/LibertyButton'
import { SaveReportModal } from './SaveReportModal'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'

interface CommissionsCalculatorProps {
  clients: Client[]
}

export function CommissionsCalculator({ clients }: CommissionsCalculatorProps) {
  const [selectedClientId, setSelectedClientId] = useState<string>('')
  const [file, setFile] = useState<File | null>(null)
  const [filePreviousYear, setFilePreviousYear] = useState<File | null>(null) // Para ShoesF
  const [fileCurrentYear, setFileCurrentYear] = useState<File | null>(null) // Para ShoesF
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState<CommissionCalculationData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [isDraggingPrevious, setIsDraggingPrevious] = useState(false)
  const [isDraggingCurrent, setIsDraggingCurrent] = useState(false)
  const [exceptions, setExceptions] = useState<CommissionException[]>([])
  const supabase = createClient()

  // Obtener cliente seleccionado
  const selectedClient = clients.find(c => c.id === selectedClientId)
  
  // Detectar si el cliente es ShoesF
  const isShoesF = selectedClient?.name === 'ShoesF'

  // Cargar excepciones cuando se selecciona un cliente
  useEffect(() => {
    if (selectedClientId) {
      supabase
        .from('commission_exceptions')
        .select('*')
        .eq('client_id', selectedClientId)
        .then(({ data }) => {
          setExceptions(data || [])
        })
    } else {
      setExceptions([])
    }
    // Limpiar archivos al cambiar de cliente
    setFile(null)
    setFilePreviousYear(null)
    setFileCurrentYear(null)
  }, [selectedClientId, supabase])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)

    const droppedFile = e.dataTransfer.files[0]
    if (droppedFile && droppedFile.type === 'text/csv' || droppedFile.name.endsWith('.csv')) {
      setFile(droppedFile)
      setError(null)
    } else {
      setError('Por favor, sube un archivo CSV válido')
    }
  }, [])

  // Handlers para ShoesF (año anterior)
  const handleDragOverPrevious = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDraggingPrevious(true)
  }, [])

  const handleDragLeavePrevious = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDraggingPrevious(false)
  }, [])

  const handleDropPrevious = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDraggingPrevious(false)
    const droppedFile = e.dataTransfer.files[0]
    if (droppedFile && (droppedFile.type === 'text/csv' || droppedFile.name.endsWith('.csv'))) {
      setFilePreviousYear(droppedFile)
      setError(null)
    } else {
      setError('Por favor, sube un archivo CSV válido')
    }
  }, [])

  // Handlers para ShoesF (año actual)
  const handleDragOverCurrent = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDraggingCurrent(true)
  }, [])

  const handleDragLeaveCurrent = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDraggingCurrent(false)
  }, [])

  const handleDropCurrent = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDraggingCurrent(false)
    const droppedFile = e.dataTransfer.files[0]
    if (droppedFile && (droppedFile.type === 'text/csv' || droppedFile.name.endsWith('.csv'))) {
      setFileCurrentYear(droppedFile)
      setError(null)
    } else {
      setError('Por favor, sube un archivo CSV válido')
    }
  }, [])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      setFile(selectedFile)
      setError(null)
    }
  }

  const handleProcess = async () => {
    if (isShoesF) {
      // Para ShoesF necesitamos ambos archivos
      if (!filePreviousYear || !fileCurrentYear || !selectedClientId) {
        setError('Por favor, sube ambos archivos CSV (año pasado y año actual)')
        return
      }
    } else {
      // Para otros clientes, solo un archivo
      if (!file || !selectedClientId) {
        setError('Por favor, selecciona un cliente y sube un archivo CSV')
        return
      }
    }

    setProcessing(true)
    setError(null)
    setResult(null)

    try {
      const formData = new FormData()
      formData.append('clientId', selectedClientId)
      
      if (isShoesF) {
        formData.append('filePreviousYear', filePreviousYear!)
        formData.append('fileCurrentYear', fileCurrentYear!)
      } else {
        formData.append('file', file!)
      }

      const response = await fetch('/api/commissions/process', {
        method: 'POST',
        body: formData
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Error al procesar el archivo')
      }

      setResult(data.data)
    } catch (err: any) {
      setError(err.message || 'Error al procesar el archivo')
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header con botón Ver Reportes */}
      <div className="flex items-center justify-end">
        <Button
          onClick={() => window.location.href = '/dashboard/commissions/reports'}
          variant="glass"
          className="gap-2"
        >
          <FileText className="h-4 w-4" />
          Ver Reportes
        </Button>
      </div>

      {/* Paso 1: Selector y Upload */}
      <Card>
        <CardHeader>
          <CardTitle className="text-white">Paso 1: Configurar Cálculo</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Selector de Cliente con Botones */}
          <div className="space-y-2">
            <label className="label-uppercase text-white/70 block mb-3">
              Seleccionar Cliente *
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {clients.map((client) => {
                const isSelected = selectedClientId === client.id
                return (
                  <button
                    key={client.id}
                    onClick={() => setSelectedClientId(client.id)}
                    className={cn(
                      "p-4 rounded-xl border-2 transition-all text-left",
                      isSelected
                        ? "bg-[#FF6600]/[0.15] border-[#FF6600] text-white"
                        : "bg-white/[0.03] border-white/10 text-white/70 hover:bg-white/[0.05] hover:border-white/20"
                    )}
                  >
                    <div className="font-semibold text-sm mb-1">{client.name}</div>
                    <div className="text-xs text-white/60">
                      Tasa base: {(client.base_commission_rate * 100).toFixed(0)}%
                    </div>
                  </button>
                )
              })}
            </div>
            {selectedClientId && (() => {
              const client = clients.find(c => c.id === selectedClientId)
              if (!client) return null
              
              return (
                <div className="mt-2 p-3 bg-white/[0.03] border border-white/10 rounded-lg">
                  <div className="flex items-start gap-2 mb-2">
                    <Info className="h-4 w-4 text-[#FF6600] mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <div className="text-xs text-white/70 mb-1.5">Reglas de comisión:</div>
                      <div className="text-sm text-white font-semibold mb-1">
                        Tasa base: {(client.base_commission_rate * 100).toFixed(0)}%
                      </div>
                      {exceptions.length > 0 && (
                        <div className="mt-2 space-y-1">
                          <div className="text-xs text-white/60">Excepciones:</div>
                          {exceptions.map((exc) => (
                            <div key={exc.id} className="text-xs text-[#FF6600]">
                              • <span className="font-semibold">{exc.keyword}</span>: {(exc.special_rate * 100).toFixed(0)}%
                            </div>
                          ))}
                        </div>
                      )}
                      {exceptions.length === 0 && !isShoesF && (
                        <div className="text-xs text-white/50 mt-1">
                          Sin excepciones - se aplica la tasa base a todos los productos
                        </div>
                      )}
                      {isShoesF && (
                        <div className="text-xs text-[#FF6600] mt-1">
                          ⚠ Este cliente requiere comparar facturación entre dos años. Se calculará el 5% sobre el excedente (año actual - año anterior).
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })()}
          </div>

          {/* Upload de Archivo - Normal o ShoesF */}
          {isShoesF ? (
            <div className="space-y-4">
              <label className="label-uppercase text-white/70 block">
                Subir Archivos CSV para Comparación *
              </label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Año Anterior */}
                <div className="space-y-2">
                  <label className="text-sm text-white/70">Año Anterior (CSV)</label>
                  <div
                    onDragOver={handleDragOverPrevious}
                    onDragLeave={handleDragLeavePrevious}
                    onDrop={handleDropPrevious}
                    className={cn(
                      "border-2 border-dashed rounded-xl p-6 text-center transition-all flex flex-col items-center justify-center min-h-[150px]",
                      isDraggingPrevious
                        ? "border-[#FF6600] bg-[#FF6600]/[0.1]"
                        : "border-white/20 bg-white/[0.02] hover:border-white/30"
                    )}
                  >
                    {filePreviousYear ? (
                      <div className="flex flex-col items-center justify-center gap-2">
                        <FileText className="h-5 w-5 text-[#FF6600]" />
                        <span className="text-white text-sm">{filePreviousYear.name}</span>
                        <button
                          onClick={() => setFilePreviousYear(null)}
                          className="mt-2 p-1 hover:bg-white/[0.1] rounded"
                        >
                          <X className="h-4 w-4 text-white/70" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <Upload className="h-6 w-6 text-white/50 mb-2" />
                        <p className="text-white/70 text-xs mb-2">
                          Arrastra CSV aquí
                        </p>
                        <label className="inline-block">
                          <span className="btn-glass cursor-pointer text-xs px-3 py-2">
                            Seleccionar
                          </span>
                          <input
                            type="file"
                            accept=".csv"
                            onChange={(e) => {
                              const selectedFile = e.target.files?.[0]
                              if (selectedFile) {
                                setFilePreviousYear(selectedFile)
                                setError(null)
                              }
                            }}
                            className="hidden"
                          />
                        </label>
                      </>
                    )}
                  </div>
                </div>

                {/* Año Actual */}
                <div className="space-y-2">
                  <label className="text-sm text-white/70">Año Actual (CSV)</label>
                  <div
                    onDragOver={handleDragOverCurrent}
                    onDragLeave={handleDragLeaveCurrent}
                    onDrop={handleDropCurrent}
                    className={cn(
                      "border-2 border-dashed rounded-xl p-6 text-center transition-all flex flex-col items-center justify-center min-h-[150px]",
                      isDraggingCurrent
                        ? "border-[#FF6600] bg-[#FF6600]/[0.1]"
                        : "border-white/20 bg-white/[0.02] hover:border-white/30"
                    )}
                  >
                    {fileCurrentYear ? (
                      <div className="flex flex-col items-center justify-center gap-2">
                        <FileText className="h-5 w-5 text-[#FF6600]" />
                        <span className="text-white text-sm">{fileCurrentYear.name}</span>
                        <button
                          onClick={() => setFileCurrentYear(null)}
                          className="mt-2 p-1 hover:bg-white/[0.1] rounded"
                        >
                          <X className="h-4 w-4 text-white/70" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <Upload className="h-6 w-6 text-white/50 mb-2" />
                        <p className="text-white/70 text-xs mb-2">
                          Arrastra CSV aquí
                        </p>
                        <label className="inline-block">
                          <span className="btn-glass cursor-pointer text-xs px-3 py-2">
                            Seleccionar
                          </span>
                          <input
                            type="file"
                            accept=".csv"
                            onChange={(e) => {
                              const selectedFile = e.target.files?.[0]
                              if (selectedFile) {
                                setFileCurrentYear(selectedFile)
                                setError(null)
                              }
                            }}
                            className="hidden"
                          />
                        </label>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="label-uppercase text-white/70 block">
                Subir Archivo CSV *
              </label>
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={cn(
                  "border-2 border-dashed rounded-xl p-8 text-center transition-all flex flex-col items-center justify-center",
                  isDragging
                    ? "border-[#FF6600] bg-[#FF6600]/[0.1]"
                    : "border-white/20 bg-white/[0.02] hover:border-white/30"
                )}
              >
                {file ? (
                  <div className="flex items-center justify-center gap-3">
                    <FileText className="h-5 w-5 text-[#FF6600]" />
                    <span className="text-white">{file.name}</span>
                    <button
                      onClick={() => setFile(null)}
                      className="ml-2 p-1 hover:bg-white/[0.1] rounded"
                    >
                      <X className="h-4 w-4 text-white/70" />
                    </button>
                  </div>
                ) : (
                  <>
                    <Upload className="h-8 w-8 text-white/50 mb-3" />
                    <p className="text-white/70 mb-2 text-center">
                      Arrastra tu archivo CSV aquí o
                    </p>
                    <label className="inline-block">
                      <span className="btn-glass cursor-pointer">
                        Seleccionar archivo
                      </span>
                      <input
                        type="file"
                        accept=".csv"
                        onChange={handleFileChange}
                        className="hidden"
                      />
                    </label>
                  </>
                )}
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}

          <div className="flex justify-center">
            <button
              onClick={handleProcess}
              disabled={
                processing || 
                !selectedClientId || 
                (isShoesF ? (!filePreviousYear || !fileCurrentYear) : !file)
              }
              className={cn(
                "px-8 py-4 rounded-xl font-semibold text-base transition-all duration-300",
                "bg-white/[0.03] border-2 border-white/10 text-white",
                "hover:bg-white/[0.05] hover:border-white/20 hover:scale-[1.02]",
                "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:bg-white/[0.03] disabled:hover:border-white/10",
                "gap-2 flex items-center justify-center"
              )}
            >
              {processing ? (
                <>
                  <Calculator className="h-4 w-4 animate-spin" />
                  Procesando...
                </>
              ) : (
                <>
                  <Calculator className="h-4 w-4" />
                  Calcular Comisiones
                </>
              )}
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Paso 2: Resultados */}
      {result && (
        <div className="space-y-4">
          {/* Resumen Detallado - Diferente para ShoesF */}
          {isShoesF && result.summary.excessAmount !== undefined ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-white/70">
                    Base Neta Año Anterior
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="text-xl font-bold text-white/70">
                    €{result.summary.previousYearNetBase!.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div className="text-xs text-white/50 mt-1">
                    Sin IVA
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-white/70">
                    Base Neta Año Actual
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="text-xl font-bold text-green-400">
                    €{result.summary.currentYearNetBase!.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div className="text-xs text-white/50 mt-1">
                    Sin IVA
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-white/70">
                    Excedente (Diferencia)
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="text-xl font-bold text-[#FF6600]">
                    €{result.summary.excessAmount.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div className="text-xs text-white/50 mt-1">
                    Año Actual - Año Anterior
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-white/70">
                    Comisión Total (5%)
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="text-2xl font-bold text-[#FF6600]">
                    €{result.summary.totalCommission.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div className="text-xs text-white/50 mt-1">
                    5% sobre excedente
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-white/70">
                  Ventas Brutas Totales
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-xl font-bold text-white">
                  €{result.summary.totalSales.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className="text-xs text-white/50 mt-1">
                  {result.summary.totalOrders} pedido{result.summary.totalOrders !== 1 ? 's' : ''}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-white/70">
                  Reembolsos Totales
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-xl font-bold text-red-400">
                  -€{result.summary.totalRefunds.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-white/70">
                  Facturación Real (con IVA)
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-xl font-bold text-white">
                  €{result.summary.realTurnover.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className="text-xs text-white/50 mt-1">
                  Ventas - Reembolsos
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-white/70">
                  IVA Descontado (21%)
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-xl font-bold text-yellow-400">
                  -€{result.summary.totalIva.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className="text-xs text-white/50 mt-1">
                  IVA eliminado del cálculo
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-white/70">
                  Base Neta (SIN IVA)
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-xl font-bold text-green-400">
                  €{result.summary.netBase.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className="text-xs text-white/50 mt-1">
                  Sobre esta base se calcula la comisión
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-white/70">
                  Tasa Promedio
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-xl font-bold text-white">
                  {(result.summary.averageCommissionRate * 100).toFixed(2)}%
                </div>
                <div className="text-xs text-white/50 mt-1">
                  Tasa promedio aplicada
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-white/70">
                  Comisión Total
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-2xl font-bold text-[#FF6600]">
                  €{result.summary.totalCommission.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className="text-xs text-white/50 mt-1">
                  Base neta × Tasa
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-white/70">
                  Resumen
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-1 text-xs">
                <div className="text-white/70">
                  <span className="text-white/50">Productos:</span> {result.rows.length}
                </div>
                <div className="text-white/70">
                  <span className="text-white/50">Pedidos:</span> {result.summary.totalOrders}
                </div>
                {result.errors.length > 0 && (
                  <div className="text-red-400">
                    <span className="text-white/50">Errores:</span> {result.errors.length}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
          )}

          {/* Tabla Detallada */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-white">Detalle de Productos</CardTitle>
              <Button
                onClick={() => setIsSaveModalOpen(true)}
                variant="glass"
                className="gap-2"
              >
                <Save className="h-4 w-4" />
                Guardar Reporte
              </Button>
            </CardHeader>
            <CardContent>
              <CommissionsTable rows={result.rows} isShoesF={isShoesF} />
              
              {result.errors.length > 0 && (
                <div className="mt-4 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                  <h4 className="text-yellow-400 font-semibold mb-2 flex items-center gap-2">
                    <AlertCircle className="h-4 w-4" />
                    Errores de Parsing ({result.errors.length})
                  </h4>
                  <ul className="text-yellow-300/70 text-sm space-y-1">
                    {result.errors.map((err, idx) => (
                      <li key={idx}>• {err}</li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Modal Guardar Reporte */}
      {isSaveModalOpen && result && selectedClient && (
        <SaveReportModal
          clientId={selectedClientId}
          clientName={selectedClient.name}
          data={result}
          onClose={() => setIsSaveModalOpen(false)}
          onSaved={() => {
            setIsSaveModalOpen(false)
            // Opcional: mostrar mensaje de éxito
          }}
        />
      )}
    </div>
  )
}

function CommissionsTable({ rows, isShoesF = false }: { rows: CommissionRow[], isShoesF?: boolean }) {
  if (rows.length === 0) {
    return (
      <div className="text-center py-8 text-white/50">
        No hay datos para mostrar
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10">
            <th className="text-left py-3 px-3 text-xs font-semibold text-white/70 uppercase">#</th>
            <th className="text-left py-3 px-3 text-xs font-semibold text-white/70 uppercase">Producto</th>
            <th className="text-left py-3 px-3 text-xs font-semibold text-white/70 uppercase">ASIN</th>
            {!isShoesF && (
              <>
                <th className="text-left py-3 px-3 text-xs font-semibold text-white/70 uppercase">Pedido</th>
                <th className="text-right py-3 px-3 text-xs font-semibold text-white/70 uppercase">Ventas</th>
                <th className="text-right py-3 px-3 text-xs font-semibold text-white/70 uppercase">Reembolsos</th>
                <th className="text-right py-3 px-3 text-xs font-semibold text-white/70 uppercase">Fact. Real</th>
                <th className="text-right py-3 px-3 text-xs font-semibold text-white/70 uppercase">IVA (-21%)</th>
                <th className="text-right py-3 px-3 text-xs font-semibold text-white/70 uppercase">Base Neta</th>
                <th className="text-right py-3 px-3 text-xs font-semibold text-white/70 uppercase">% Comisión</th>
                <th className="text-right py-3 px-3 text-xs font-semibold text-white/70 uppercase">Comisión</th>
              </>
            )}
            {isShoesF && (
              <>
                <th className="text-right py-3 px-3 text-xs font-semibold text-white/70 uppercase">Base Neta Año Anterior</th>
                <th className="text-right py-3 px-3 text-xs font-semibold text-white/70 uppercase">Base Neta Año Actual</th>
                <th className="text-right py-3 px-3 text-xs font-semibold text-white/70 uppercase">Excedente</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={idx} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
              <td className="py-3 px-3 text-white/50 text-xs">
                {row.rowNumber}
              </td>
              <td className="py-3 px-3 text-white text-sm">
                <div className="max-w-xs truncate" title={row.productTitle}>
                  {row.productTitle}
                </div>
                {row.appliedException && (
                  <span className="text-xs text-[#FF6600] block mt-1">
                    ⚠ Excepción: {row.appliedException}
                  </span>
                )}
              </td>
              <td className="py-3 px-3 text-white/70 text-xs font-mono">
                {row.asin}
              </td>
              {!isShoesF && (
                <>
                  <td className="py-3 px-3 text-white/60 text-xs">
                    {row.orderId ? (
                      <span className="font-mono">{row.orderId}</span>
                    ) : (
                      <span className="text-white/30">-</span>
                    )}
                  </td>
                  <td className="py-3 px-3 text-white/70 text-xs text-right">
                    €{row.grossSales.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="py-3 px-3 text-red-400/70 text-xs text-right">
                    {row.refunds > 0 ? (
                      <>-€{row.refunds.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</>
                    ) : (
                      <span className="text-white/30">-</span>
                    )}
                  </td>
                  <td className="py-3 px-3 text-white/70 text-xs text-right">
                    €{row.realTurnover.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="py-3 px-3 text-yellow-400/70 text-xs text-right">
                    -€{row.iva.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="py-3 px-3 text-green-400/70 text-xs text-right font-semibold">
                    €{row.netBase.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="py-3 px-3 text-white/70 text-xs text-right">
                    <span className={row.appliedException ? 'text-[#FF6600] font-semibold' : ''}>
                      {(row.commissionRate * 100).toFixed(2)}%
                    </span>
                  </td>
                  <td className="py-3 px-3 text-[#FF6600] font-bold text-sm text-right">
                    €{row.commission.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                </>
              )}
              {isShoesF && (
                <>
                  <td className="py-3 px-3 text-white/70 text-xs text-right">
                    €{(row.previousYearNetBase || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="py-3 px-3 text-green-400/70 text-xs text-right font-semibold">
                    €{(row.currentYearNetBase || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="py-3 px-3 text-[#FF6600] font-bold text-sm text-right">
                    €{Math.max(0, (row.currentYearNetBase || 0) - (row.previousYearNetBase || 0)).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-white/20 bg-white/[0.02]">
            {!isShoesF && (
              <>
                <td colSpan={4} className="py-4 px-3 text-white font-semibold text-right">
                  TOTALES:
                </td>
                <td className="py-4 px-3 text-white font-semibold text-right">
                  €{rows.reduce((sum, r) => sum + r.grossSales, 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td className="py-4 px-3 text-red-400 font-semibold text-right">
                  -€{rows.reduce((sum, r) => sum + r.refunds, 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td className="py-4 px-3 text-white font-semibold text-right">
                  €{rows.reduce((sum, r) => sum + r.realTurnover, 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td className="py-4 px-3 text-yellow-400 font-semibold text-right">
                  -€{rows.reduce((sum, r) => sum + r.iva, 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td className="py-4 px-3 text-green-400 font-semibold text-right">
                  €{rows.reduce((sum, r) => sum + r.netBase, 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td className="py-4 px-3 text-white/70 text-right">
                  -
                </td>
                <td className="py-4 px-3 text-[#FF6600] font-bold text-lg text-right">
                  €{rows.reduce((sum, r) => sum + r.commission, 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
              </>
            )}
            {isShoesF && (
              <>
                <td colSpan={3} className="py-4 px-3 text-white font-semibold text-right">
                  TOTALES:
                </td>
                <td className="py-4 px-3 text-white/70 font-semibold text-right">
                  €{rows.reduce((sum, r) => sum + (r.previousYearNetBase || 0), 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td className="py-4 px-3 text-green-400 font-semibold text-right">
                  €{rows.reduce((sum, r) => sum + (r.currentYearNetBase || 0), 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td className="py-4 px-3 text-[#FF6600] font-bold text-lg text-right">
                  €{rows.reduce((sum, r) => sum + Math.max(0, (r.currentYearNetBase || 0) - (r.previousYearNetBase || 0)), 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
              </>
            )}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

