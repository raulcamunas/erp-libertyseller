'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { useDropzone } from 'react-dropzone'
import { FileText, UploadCloud, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

export default function NewAuditorPage() {
  const router = useRouter()
  const [sellerUrl, setSellerUrl] = useState('')
  const [xrayFile, setXrayFile] = useState<File | null>(null)
  const [cerebroFile, setCerebroFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)

  const onDropXray = (acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setXrayFile(acceptedFiles[0])
      toast.success(`Archivo Xray: ${acceptedFiles[0].name} cargado.`)
    }
  }

  const onDropCerebro = (acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setCerebroFile(acceptedFiles[0])
      toast.success(`Archivo Cerebro: ${acceptedFiles[0].name} cargado.`)
    }
  }

  const { getRootProps: getXrayRootProps, getInputProps: getXrayInputProps, isDragActive: isXrayDragActive } = 
    useDropzone({ onDrop: onDropXray, multiple: false, accept: { 'text/csv': ['.csv'] } })
  
  const { getRootProps: getCerebroRootProps, getInputProps: getCerebroInputProps, isDragActive: isCerebroDragActive } = 
    useDropzone({ onDrop: onDropCerebro, multiple: false, accept: { 'text/csv': ['.csv'] } })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!sellerUrl || !xrayFile) {
      toast.error('Por favor, rellena la URL del vendedor y sube el archivo Xray.')
      return
    }

    setLoading(true)
    try {
      const formData = new FormData()
      formData.append('seller_url', sellerUrl)
      formData.append('xray_file', xrayFile)
      if (cerebroFile) {
        formData.append('cerebro_file', cerebroFile)
      }

      const response = await fetch('/api/auditor/upload', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Error al procesar la auditoría')
      }

      const data = await response.json()
      toast.success('Auditoría creada correctamente. Generando análisis...')
      
      // Redirigir a la página de resultados con el token
      router.push(`/audit/share/${data.public_token}`)
    } catch (error: any) {
      console.error('Error submitting audit:', error)
      toast.error(error.message || 'Error al procesar la auditoría.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto py-8">
      <h1 className="heading-medium text-white mb-6">Nueva Auditoría de Cuenta</h1>
      <p className="text-white/60 mb-8">
        Sube los archivos de Helium 10 para generar un análisis completo de la cuenta con métricas precisas y recomendaciones de IA.
      </p>

      <form onSubmit={handleSubmit} className="space-y-8">
        <Card className="glass-card">
          <CardHeader>
            <CardTitle>Datos de la Cuenta</CardTitle>
            <CardDescription>Introduce la URL del vendedor de Amazon.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="seller_url">URL del Vendedor</Label>
              <Input
                id="seller_url"
                value={sellerUrl}
                onChange={(e) => setSellerUrl(e.target.value)}
                placeholder="https://www.amazon.com/s?me=XXXXXXXXX"
                required
              />
              <p className="text-xs text-white/50 mt-1">
                Puedes encontrar esta URL en tu perfil de vendedor de Amazon
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader>
            <CardTitle>Datos de Mercado (Helium 10)</CardTitle>
            <CardDescription>Sube los archivos CSV de Helium 10 para el análisis.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Helium 10 Xray (.csv) *</Label>
              <div
                {...getXrayRootProps()}
                className={`mt-2 flex justify-center items-center px-6 pt-5 pb-6 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${
                  isXrayDragActive
                    ? 'border-[#FF6600] bg-[#FF6600]/10'
                    : 'border-white/20 hover:border-[#FF6600]/50'
                }`}
              >
                <input {...getXrayRootProps()} />
                {xrayFile ? (
                  <div className="flex items-center gap-2 text-white/80">
                    <FileText className="h-5 w-5" />
                    <span>{xrayFile.name}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        setXrayFile(null)
                      }}
                      className="text-white/50 hover:text-red-400"
                    >
                      X
                    </Button>
                  </div>
                ) : (
                  <div className="text-center">
                    <UploadCloud className="mx-auto h-12 w-12 text-white/30" />
                    <p className="mt-1 text-sm text-white/60">
                      Arrastra y suelta tu archivo aquí, o{' '}
                      <span className="text-[#FF6600] font-semibold">haz clic para seleccionar</span>
                    </p>
                    <p className="text-xs text-white/40 mt-1">Solo archivos .csv</p>
                  </div>
                )}
              </div>
            </div>

            <div>
              <Label>US_AMAZON_cerebro.csv (.csv) - Opcional</Label>
              <div
                {...getCerebroRootProps()}
                className={`mt-2 flex justify-center items-center px-6 pt-5 pb-6 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${
                  isCerebroDragActive
                    ? 'border-[#FF6600] bg-[#FF6600]/10'
                    : 'border-white/20 hover:border-[#FF6600]/50'
                }`}
              >
                <input {...getCerebroInputProps()} />
                {cerebroFile ? (
                  <div className="flex items-center gap-2 text-white/80">
                    <FileText className="h-5 w-5" />
                    <span>{cerebroFile.name}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        setCerebroFile(null)
                      }}
                      className="text-white/50 hover:text-red-400"
                    >
                      X
                    </Button>
                  </div>
                ) : (
                  <div className="text-center">
                    <UploadCloud className="mx-auto h-12 w-12 text-white/30" />
                    <p className="mt-1 text-sm text-white/60">
                      Arrastra y suelta tu archivo aquí, o{' '}
                      <span className="text-[#FF6600] font-semibold">haz clic para seleccionar</span>
                    </p>
                    <p className="text-xs text-white/40 mt-1">Solo archivos .csv (Opcional)</p>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Procesando Auditoría...
            </>
          ) : (
            'Crear Auditoría'
          )}
        </Button>
      </form>
    </div>
  )
}

