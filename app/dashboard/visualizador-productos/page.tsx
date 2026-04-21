'use client'

import { useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { UploadCloud, FileText, Loader2, Download, RefreshCw } from 'lucide-react'
import { useDropzone } from 'react-dropzone'

type MergedRow = {
  ean: string
  asin?: string
  producto?: string
  precio_venta?: number
  precio_compra?: number
  fba_pick_pack?: number
  referral_fee_percent?: number
  referral_fee_amount?: number
  total_fees?: number
  total_costes?: number
  beneficio?: number
  margen_percent?: number
  source?: {
    keepa?: boolean
    filtrado?: boolean
    compra?: boolean
  }
}

export default function VisualizadorProductosPage() {
  const [keepaFile, setKeepaFile] = useState<File | null>(null)
  const [filtradoFile, setFiltradoFile] = useState<File | null>(null)
  const [compraFile, setCompraFile] = useState<File | null>(null)

  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<MergedRow[]>([])

  const canSubmit = useMemo(() => {
    return Boolean(keepaFile && filtradoFile && compraFile)
  }, [keepaFile, filtradoFile, compraFile])

  const downloadCsv = () => {
    if (!rows.length) return

    const headers = [
      'Producto',
      'ASIN',
      'EAN',
      'Precio venta',
      'Precio compra',
      'Tarifa FBA Pick&Pack',
      '% comision referencia',
      'Comision referencia (importe)',
      'Total fees',
      'Total costes',
      'Beneficio',
      'Margen %',
    ]

    const escape = (v: any) => {
      const s = v === null || v === undefined ? '' : String(v)
      if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
        return '"' + s.replace(/"/g, '""') + '"'
      }
      return s
    }

    const lines = [headers.join(',')]
    for (const r of rows) {
      lines.push(
        [
          r.producto || '',
          r.asin || '',
          r.ean || '',
          r.precio_venta ?? '',
          r.precio_compra ?? '',
          r.fba_pick_pack ?? '',
          r.referral_fee_percent ?? '',
          r.referral_fee_amount ?? '',
          r.total_fees ?? '',
          r.total_costes ?? '',
          r.beneficio ?? '',
          r.margen_percent ?? '',
        ].map(escape).join(',')
      )
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `visualizador-productos-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const onSubmit = async () => {
    if (!canSubmit) {
      toast.error('Sube los 3 archivos')
      return
    }

    setLoading(true)
    setRows([])

    try {
      const formData = new FormData()
      formData.append('keepa_file', keepaFile as File)
      formData.append('filtrado_file', filtradoFile as File)
      formData.append('compra_file', compraFile as File)

      const res = await fetch('/api/visualizador-productos/merge', {
        method: 'POST',
        body: formData,
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Error procesando')

      setRows(data.rows || [])
      toast.success(`Generado: ${(data.rows || []).length} filas`) 
    } catch (err: any) {
      console.error(err)
      toast.error(err?.message || 'Error')
    } finally {
      setLoading(false)
    }
  }

  const FileDropzone = ({
    title,
    desc,
    accept,
    file,
    setFile,
  }: {
    title: string
    desc: string
    accept: { [mime: string]: string[] }
    file: File | null
    setFile: (f: File | null) => void
  }) => {
    const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
      multiple: false,
      accept,
      noClick: true,
      onDrop: (acceptedFiles) => {
        const f = acceptedFiles[0] || null
        setFile(f)
        if (f) toast.success(`Archivo cargado: ${f.name}`)
      },
      onDropRejected: () => {
        toast.error('Formato de archivo no válido')
      },
    })

    return (
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-white">{title}</CardTitle>
          <CardDescription className="text-white/60">{desc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-xl px-6 pt-5 pb-6 transition-colors ${
              isDragActive ? 'border-[#FF6600] bg-[#FF6600]/10' : 'border-white/20'
            }`}
          >
            <input {...getInputProps()} />
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-white/80">
                <UploadCloud className="h-5 w-5" />
                <span className="text-sm">{file ? file.name : 'Arrastra aquí el archivo'}</span>
              </div>
              <div className="flex items-center gap-2">
                {file && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setFile(null)}
                    className="text-white/60"
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Quitar
                  </Button>
                )}
                <Button type="button" variant="outline" onClick={open}>
                  <FileText className="h-4 w-4 mr-2" />
                  Seleccionar
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="heading-medium text-white mb-2">Visualizador de Productos</h1>
        <p className="text-white/50">
          Cruza Keepa + Filtrado + Precios de compra por EAN y calcula fees/costes/beneficio
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <FileDropzone
          title="Archivo Keepa (CSV)"
          desc="Columna clave: Imported by Code (EAN). Incluye fees y Buy Box."
          accept={{ 'text/csv': ['.csv'] }}
          file={keepaFile}
          setFile={setKeepaFile}
        />
        <FileDropzone
          title="Archivo Filtrado (XLSX)"
          desc="Columna clave: EAN. Incluye producto, ASIN y precio."
          accept={{
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
          }}
          file={filtradoFile}
          setFile={setFiltradoFile}
        />
        <FileDropzone
          title="Precios de compra (XLSX)"
          desc="Columna clave: EAN. Usamos PUC como precio de compra (según tarifa)."
          accept={{
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
          }}
          file={compraFile}
          setFile={setCompraFile}
        />
      </div>

      <div className="flex gap-3">
        <Button onClick={onSubmit} disabled={!canSubmit || loading} className="min-w-[220px]">
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Procesando...
            </>
          ) : (
            'Generar tabla'
          )}
        </Button>

        <Button onClick={downloadCsv} variant="glass" disabled={!rows.length} className="gap-2">
          <Download className="h-4 w-4" />
          Exportar CSV
        </Button>

        <div className="text-white/50 text-sm flex items-center">
          {rows.length ? `${rows.length} filas` : ''}
        </div>
      </div>

      {rows.length > 0 && (
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-white">Resultado</CardTitle>
            <CardDescription className="text-white/60">
              Merge por EAN. Si falta info en alguna fuente, se marca igualmente.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left py-3 px-4 text-sm font-semibold text-white/70">Producto</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-white/70">ASIN</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-white/70">EAN</th>
                    <th className="text-right py-3 px-4 text-sm font-semibold text-white/70">Venta</th>
                    <th className="text-right py-3 px-4 text-sm font-semibold text-white/70">Compra</th>
                    <th className="text-right py-3 px-4 text-sm font-semibold text-white/70">Pick&Pack</th>
                    <th className="text-right py-3 px-4 text-sm font-semibold text-white/70">Ref %</th>
                    <th className="text-right py-3 px-4 text-sm font-semibold text-white/70">Ref €</th>
                    <th className="text-right py-3 px-4 text-sm font-semibold text-white/70">Costes</th>
                    <th className="text-right py-3 px-4 text-sm font-semibold text-white/70">Benef.</th>
                    <th className="text-right py-3 px-4 text-sm font-semibold text-white/70">Margen</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => (
                    <tr key={idx} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="py-3 px-4 text-sm text-white/80 max-w-[520px] truncate" title={r.producto || ''}>
                        {r.producto || '-'}
                      </td>
                      <td className="py-3 px-4 text-sm text-white/90 font-mono">{r.asin || '-'}</td>
                      <td className="py-3 px-4 text-sm text-white/90 font-mono">{r.ean}</td>
                      <td className="py-3 px-4 text-sm text-white/90 text-right">{r.precio_venta?.toFixed?.(2) ?? '-'}</td>
                      <td className="py-3 px-4 text-sm text-white/90 text-right">{r.precio_compra?.toFixed?.(2) ?? '-'}</td>
                      <td className="py-3 px-4 text-sm text-white/90 text-right">{r.fba_pick_pack?.toFixed?.(2) ?? '-'}</td>
                      <td className="py-3 px-4 text-sm text-white/90 text-right">{r.referral_fee_percent?.toFixed?.(2) ?? '-'}</td>
                      <td className="py-3 px-4 text-sm text-white/90 text-right">{r.referral_fee_amount?.toFixed?.(2) ?? '-'}</td>
                      <td className="py-3 px-4 text-sm text-white/90 text-right">{r.total_costes?.toFixed?.(2) ?? '-'}</td>
                      <td className={`py-3 px-4 text-sm text-right ${typeof r.beneficio === 'number' && r.beneficio < 0 ? 'text-red-400' : 'text-green-400'}`}>
                        {r.beneficio?.toFixed?.(2) ?? '-'}
                      </td>
                      <td className="py-3 px-4 text-sm text-white/90 text-right">{r.margen_percent?.toFixed?.(1) ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
