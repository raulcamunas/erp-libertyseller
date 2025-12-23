'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, FileText, X, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { toast } from 'sonner'

export default function ValidatorNewPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  
  // Datos del proveedor
  const [productName, setProductName] = useState('')
  const [targetPrice, setTargetPrice] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [shippingCost, setShippingCost] = useState('')
  const [minRoi, setMinRoi] = useState('100')
  
  // Archivos CSV
  const [xrayFile, setXrayFile] = useState<File | null>(null)
  const [cerebroFile, setCerebroFile] = useState<File | null>(null)
  const [draggingXray, setDraggingXray] = useState(false)
  const [draggingCerebro, setDraggingCerebro] = useState(false)

  const handleDragOver = (e: React.DragEvent, type: 'xray' | 'cerebro') => {
    e.preventDefault()
    if (type === 'xray') setDraggingXray(true)
    else setDraggingCerebro(true)
  }

  const handleDragLeave = (e: React.DragEvent, type: 'xray' | 'cerebro') => {
    e.preventDefault()
    if (type === 'xray') setDraggingXray(false)
    else setDraggingCerebro(false)
  }

  const handleDrop = (e: React.DragEvent, type: 'xray' | 'cerebro') => {
    e.preventDefault()
    if (type === 'xray') setDraggingXray(false)
    else setDraggingCerebro(false)

    const file = e.dataTransfer.files[0]
    if (file && file.type === 'text/csv') {
      if (type === 'xray') setXrayFile(file)
      else setCerebroFile(file)
      toast.success(`Archivo ${file.name} cargado`)
    } else {
      toast.error('Por favor, sube un archivo CSV')
    }
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>, type: 'xray' | 'cerebro') => {
    const file = e.target.files?.[0]
    if (file && file.type === 'text/csv') {
      if (type === 'xray') setXrayFile(file)
      else setCerebroFile(file)
      toast.success(`Archivo ${file.name} cargado`)
    } else {
      toast.error('Por favor, sube un archivo CSV')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!productName || !targetPrice || !unitCost || !shippingCost) {
      toast.error('Por favor, completa todos los campos requeridos')
      return
    }

    if (!xrayFile || !cerebroFile) {
      toast.error('Por favor, sube ambos archivos CSV')
      return
    }

    setLoading(true)

    try {
      const formData = new FormData()
      formData.append('product_name', productName)
      formData.append('target_price', targetPrice)
      formData.append('unit_cost', unitCost)
      formData.append('shipping_cost', shippingCost)
      formData.append('min_roi', minRoi)
      formData.append('xray_file', xrayFile)
      formData.append('cerebro_file', cerebroFile)

      const response = await fetch('/api/validator/calculate', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Error al procesar la validación')
      }

      const result = await response.json()
      
      // Guardar resultado en sessionStorage para la página de resultados
      sessionStorage.setItem('validator_result', JSON.stringify(result))
      
      router.push('/dashboard/validator/result')
    } catch (error: any) {
      console.error('Error:', error)
      toast.error(error.message || 'Error al procesar la validación')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="heading-medium text-white mb-2">Validador de Productos Amazon FBA</h1>
        <p className="text-white/50">Digitaliza y valida la rentabilidad de tus productos</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Datos del Proveedor */}
        <Card className="glass-card p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Datos del Proveedor</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="product_name" className="text-white/70">
                Nombre de la Idea *
              </Label>
              <Input
                id="product_name"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="Ej: Soporte para móvil premium"
                required
                className="mt-1"
              />
            </div>

            <div>
              <Label htmlFor="target_price" className="text-white/70">
                Precio de Venta Objetivo (US$) *
              </Label>
              <Input
                id="target_price"
                type="number"
                step="0.01"
                value={targetPrice}
                onChange={(e) => setTargetPrice(e.target.value)}
                placeholder="29.99"
                required
                className="mt-1"
              />
            </div>

            <div>
              <Label htmlFor="unit_cost" className="text-white/70">
                Coste de Fabricación por Unidad (US$) *
              </Label>
              <Input
                id="unit_cost"
                type="number"
                step="0.01"
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
                placeholder="5.50"
                required
                className="mt-1"
              />
            </div>

            <div>
              <Label htmlFor="shipping_cost" className="text-white/70">
                Coste de Envío Unitario (China → Amazon) (US$) *
              </Label>
              <Input
                id="shipping_cost"
                type="number"
                step="0.01"
                value={shippingCost}
                onChange={(e) => setShippingCost(e.target.value)}
                placeholder="2.50"
                required
                className="mt-1"
              />
            </div>

            <div>
              <Label htmlFor="min_roi" className="text-white/70">
                ROI Mínimo Deseado (%)
              </Label>
              <Input
                id="min_roi"
                type="number"
                step="0.01"
                value={minRoi}
                onChange={(e) => setMinRoi(e.target.value)}
                placeholder="100"
                className="mt-1"
              />
            </div>
          </div>
        </Card>

        {/* Archivos CSV */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Helium 10 Xray */}
          <Card className="glass-card p-6">
            <h3 className="text-md font-semibold text-white mb-4 flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Helium 10 Xray CSV
            </h3>
            <div
              onDragOver={(e) => handleDragOver(e, 'xray')}
              onDragLeave={(e) => handleDragLeave(e, 'xray')}
              onDrop={(e) => handleDrop(e, 'xray')}
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                draggingXray
                  ? 'border-[#FF6600] bg-[#FF6600]/10'
                  : 'border-white/20 hover:border-white/40'
              }`}
            >
              {xrayFile ? (
                <div className="space-y-2">
                  <FileText className="h-12 w-12 mx-auto text-[#FF6600]" />
                  <p className="text-white font-medium">{xrayFile.name}</p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setXrayFile(null)}
                    className="text-white/50 hover:text-red-400"
                  >
                    <X className="h-4 w-4 mr-1" />
                    Eliminar
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <Upload className="h-12 w-12 mx-auto text-white/40" />
                  <div>
                    <p className="text-white/70 mb-2">Arrastra el archivo aquí</p>
                    <p className="text-white/50 text-sm">o</p>
                    <label className="cursor-pointer">
                      <input
                        type="file"
                        accept=".csv"
                        onChange={(e) => handleFileInput(e, 'xray')}
                        className="hidden"
                      />
                      <span className="text-[#FF6600] hover:underline">selecciona un archivo</span>
                    </label>
                  </div>
                  <p className="text-white/40 text-xs">Formato: CSV</p>
                </div>
              )}
            </div>
          </Card>

          {/* US Amazon Cerebro */}
          <Card className="glass-card p-6">
            <h3 className="text-md font-semibold text-white mb-4 flex items-center gap-2">
              <FileText className="h-5 w-5" />
              US Amazon Cerebro CSV
            </h3>
            <div
              onDragOver={(e) => handleDragOver(e, 'cerebro')}
              onDragLeave={(e) => handleDragLeave(e, 'cerebro')}
              onDrop={(e) => handleDrop(e, 'cerebro')}
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                draggingCerebro
                  ? 'border-[#FF6600] bg-[#FF6600]/10'
                  : 'border-white/20 hover:border-white/40'
              }`}
            >
              {cerebroFile ? (
                <div className="space-y-2">
                  <FileText className="h-12 w-12 mx-auto text-[#FF6600]" />
                  <p className="text-white font-medium">{cerebroFile.name}</p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setCerebroFile(null)}
                    className="text-white/50 hover:text-red-400"
                  >
                    <X className="h-4 w-4 mr-1" />
                    Eliminar
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <Upload className="h-12 w-12 mx-auto text-white/40" />
                  <div>
                    <p className="text-white/70 mb-2">Arrastra el archivo aquí</p>
                    <p className="text-white/50 text-sm">o</p>
                    <label className="cursor-pointer">
                      <input
                        type="file"
                        accept=".csv"
                        onChange={(e) => handleFileInput(e, 'cerebro')}
                        className="hidden"
                      />
                      <span className="text-[#FF6600] hover:underline">selecciona un archivo</span>
                    </label>
                  </div>
                  <p className="text-white/40 text-xs">Formato: CSV</p>
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* Botón Submit */}
        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={loading}
            className="min-w-[200px]"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Procesando...
              </>
            ) : (
              'Validar Producto'
            )}
          </Button>
        </div>
      </form>
    </div>
  )
}


