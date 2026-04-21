'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { FileText, UploadCloud, Loader2, Download } from 'lucide-react'

type BuilderResult = {
  title: string
  bullets: string[]
  description: string
  backendKeywords: string
  validations: {
    titleChars: number
    bulletsBytes: number
    backendBytes: number
    forbiddenCharsFound: string[]
    repeatedTokens: Array<{ token: string; count: number }>
  }
  tsv: {
    filename: string
    content: string
  }
}

export default function ListingBuilderPage() {
  const router = useRouter()

  const [brandName, setBrandName] = useState('')
  const [itemSku, setItemSku] = useState('')
  const [productId, setProductId] = useState('')
  const [productIdType, setProductIdType] = useState<'EAN' | 'UPC' | 'ASIN'>('EAN')
  const [feedProductType, setFeedProductType] = useState('')
  const [updateDelete, setUpdateDelete] = useState<'PartialUpdate' | 'Update'>('PartialUpdate')

  const [cerebroFile, setCerebroFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<BuilderResult | null>(null)

  const canSubmit = useMemo(() => {
    return Boolean(
      brandName.trim() &&
        itemSku.trim() &&
        productId.trim() &&
        feedProductType.trim() &&
        cerebroFile
    )
  }, [brandName, itemSku, productId, feedProductType, cerebroFile])

  const downloadTSV = () => {
    if (!result) return
    const blob = new Blob([result.tsv.content], { type: 'text/tab-separated-values;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = result.tsv.filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) {
      toast.error('Completa los campos y sube el CSV de Cerebro')
      return
    }

    setLoading(true)
    setResult(null)

    try {
      const formData = new FormData()
      formData.append('brand_name', brandName)
      formData.append('item_sku', itemSku)
      formData.append('external_product_id', productId)
      formData.append('external_product_id_type', productIdType)
      formData.append('feed_product_type', feedProductType)
      formData.append('update_delete', updateDelete)
      formData.append('cerebro_file', cerebroFile as File)

      const res = await fetch('/api/listing-builder/generate', {
        method: 'POST',
        body: formData,
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data?.error || 'Error generando el listing')
      }

      setResult(data)
      toast.success('Listing generado y validado')
    } catch (err: any) {
      toast.error(err?.message || 'Error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="heading-medium text-white mb-2">Listing Builder</h1>
          <p className="text-white/50">
            Genera contenido optimizado (COSMO 2025) y exporta un TSV listo para subir
          </p>
        </div>
        <Button variant="outline" onClick={() => router.push('/dashboard/listing-builder')}>
          Volver
        </Button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-white">Datos del producto</CardTitle>
            <CardDescription className="text-white/60">
              Campos mínimos para generar un TSV base. (MVP)
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="brand_name" className="text-white/70">Marca (brand_name) *</Label>
              <Input id="brand_name" value={brandName} onChange={(e) => setBrandName(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="item_sku" className="text-white/70">SKU (item_sku) *</Label>
              <Input id="item_sku" value={itemSku} onChange={(e) => setItemSku(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="product_id" className="text-white/70">ID (EAN/UPC/ASIN) *</Label>
              <Input id="product_id" value={productId} onChange={(e) => setProductId(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label className="text-white/70">Tipo de ID *</Label>
              <select
                value={productIdType}
                onChange={(e) => setProductIdType(e.target.value as any)}
                className="mt-1 w-full bg-white/[0.03] border border-white/10 rounded-md px-3 py-2 text-white"
              >
                <option value="EAN">EAN</option>
                <option value="UPC">UPC</option>
                <option value="ASIN">ASIN</option>
              </select>
            </div>
            <div>
              <Label htmlFor="feed_product_type" className="text-white/70">feed_product_type *</Label>
              <Input id="feed_product_type" value={feedProductType} onChange={(e) => setFeedProductType(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label className="text-white/70">update_delete</Label>
              <select
                value={updateDelete}
                onChange={(e) => setUpdateDelete(e.target.value as any)}
                className="mt-1 w-full bg-white/[0.03] border border-white/10 rounded-md px-3 py-2 text-white"
              >
                <option value="PartialUpdate">PartialUpdate (seguro)</option>
                <option value="Update">Update (crear/reescribir)</option>
              </select>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-white">Helium 10 (Cerebro) *</CardTitle>
            <CardDescription className="text-white/60">
              Sube el CSV de palabras clave para alimentar la IA
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="border-2 border-dashed rounded-xl px-6 pt-5 pb-6 border-white/20">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-white/80">
                  <UploadCloud className="h-5 w-5" />
                  <span className="text-sm">{cerebroFile ? cerebroFile.name : 'Selecciona un CSV de Cerebro'}</span>
                </div>
                <label className="cursor-pointer">
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(e) => {
                      const f = e.target.files?.[0] || null
                      setCerebroFile(f)
                      if (f) toast.success(`Archivo cargado: ${f.name}`)
                    }}
                    className="hidden"
                  />
                  <Button type="button" variant="outline">
                    <FileText className="h-4 w-4 mr-2" />
                    Seleccionar
                  </Button>
                </label>
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={loading || !canSubmit}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generando...
                </>
              ) : (
                'Generar Listing'
              )}
            </Button>
          </CardContent>
        </Card>
      </form>

      {result && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-white">Resultado</CardTitle>
              <CardDescription className="text-white/60">Contenido generado</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="text-xs text-white/50 mb-1">Título</div>
                <div className="text-white/90 text-sm">{result.title}</div>
              </div>
              <div>
                <div className="text-xs text-white/50 mb-1">Bullets</div>
                <ol className="space-y-2">
                  {result.bullets.map((b, idx) => (
                    <li key={idx} className="text-white/80 text-sm">{idx + 1}. {b}</li>
                  ))}
                </ol>
              </div>
              <div>
                <div className="text-xs text-white/50 mb-1">Descripción</div>
                <div className="text-white/80 text-sm whitespace-pre-wrap">{result.description}</div>
              </div>
              <div>
                <div className="text-xs text-white/50 mb-1">Backend keywords</div>
                <div className="text-white/80 text-sm whitespace-pre-wrap">{result.backendKeywords}</div>
              </div>
              <Button onClick={downloadTSV} variant="glass" className="w-full gap-2">
                <Download className="h-4 w-4" />
                Descargar TSV
              </Button>
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-white">Validaciones</CardTitle>
              <CardDescription className="text-white/60">Reglas Amazon 2025</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between text-white/70">
                <span>Título (chars)</span>
                <span className={result.validations.titleChars > 200 ? 'text-red-400' : 'text-green-400'}>
                  {result.validations.titleChars}/200
                </span>
              </div>
              <div className="flex justify-between text-white/70">
                <span>Bullets total (bytes)</span>
                <span className={result.validations.bulletsBytes > 1000 ? 'text-red-400' : 'text-green-400'}>
                  {result.validations.bulletsBytes}/1000
                </span>
              </div>
              <div className="flex justify-between text-white/70">
                <span>Backend keywords (bytes)</span>
                <span className={result.validations.backendBytes > 250 ? 'text-red-400' : 'text-green-400'}>
                  {result.validations.backendBytes}/250
                </span>
              </div>
              <div className="pt-2 border-t border-white/10">
                <div className="text-white/70">Caracteres prohibidos encontrados</div>
                <div className="text-white/50">
                  {result.validations.forbiddenCharsFound.length === 0 ? 'Ninguno' : result.validations.forbiddenCharsFound.join(', ')}
                </div>
              </div>
              <div className="pt-2 border-t border-white/10">
                <div className="text-white/70">Tokens repetidos (&gt;2)</div>
                <div className="text-white/50">
                  {result.validations.repeatedTokens.length === 0
                    ? 'Ninguno'
                    : result.validations.repeatedTokens.map(t => `${t.token}(${t.count})`).join(', ')}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
