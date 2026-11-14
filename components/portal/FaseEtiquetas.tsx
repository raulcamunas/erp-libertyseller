'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { CircleCheck, Download, Loader2, Lock, Printer, Tags, TriangleAlert } from 'lucide-react'
import type { DatosDelPortal } from '@/lib/fba/portal'
import { FORMATOS } from '@/lib/fba/formatos-etiqueta'
import { FUENTE_TITULO, cx, n0 } from '@/components/encaje/marca'
import { Aviso, Franja } from './FasePropuesta'

/**
 * LA FASE «ETIQUETAS» DEL PORTAL: DESCARGAR LAS FNSKU.
 *
 * Con la propuesta aprobada, el cliente descarga el PDF (una etiqueta por unidad, en la hoja que use) y las
 * pega. Lo genera el mismo código que en el ERP (lib/fba/etiquetas-remesa.ts) y la tirada queda registrada
 * con origen 'enlace'. Si alguna referencia no tiene FNSKU todavía, se dice cuál y se avisa a la agencia.
 */
export function FaseEtiquetas({ token, datos }: { token: string; datos: DatosDelPortal }) {
  const [formato, setFormato] = useState('a4-21')
  const [descargando, setDescargando] = useState(false)
  const [resultado, setResultado] = useState<{ etiquetas: number; paginas: number; descartadas: number; motivos: string[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!datos.etiquetas.disponibles) {
    return (
      <Aviso icono={<Lock className="h-7 w-7" />} titulo="Las etiquetas llegan con la aprobación">
        Cuando aprobemos la propuesta podrás descargarlas aquí. Así nunca se pega una etiqueta de algo que al final no se manda.
      </Aviso>
    )
  }

  const unidades = datos.lineas.reduce((s, l) => s + l.unidades, 0)

  async function descargar() {
    setDescargando(true)
    setError(null)
    try {
      const res = await fetch(`/api/publico/envio/${token}/etiquetas?formato=${encodeURIComponent(formato)}`)
      if (!res.ok) {
        const cuerpo = (await res.json().catch(() => null)) as { error?: string } | null
        setError(cuerpo?.error ?? `No se han podido generar (código ${res.status}).`)
        return
      }
      const blob = await res.blob()
      const nombre = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'etiquetas.pdf'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = nombre
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
      setResultado({
        etiquetas: Number(res.headers.get('X-Etiquetas') ?? 0),
        paginas: Number(res.headers.get('X-Paginas') ?? 0),
        descartadas: Number(res.headers.get('X-Descartadas') ?? 0),
        motivos: decodeURIComponent(res.headers.get('X-Motivos') ?? '').split(' | ').filter(Boolean),
      })
    } catch {
      setError('Sin conexión. Vuelve a probar en un momento.')
    } finally {
      setDescargando(false)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl border border-[#E5E1DB] bg-[#FFFFFF] p-6 sm:p-8">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-[#FF8A3D] to-[#F26212] text-[#FFFFFF] shadow-[0_12px_28px_-12px_rgba(242,98,18,0.9)]">
          <Tags className="h-7 w-7" />
        </span>
        <h2 className="mt-5 text-[24px] leading-tight text-[#141414]" style={{ fontFamily: FUENTE_TITULO, fontWeight: 600 }}>
          Tus etiquetas FNSKU
        </h2>
        <p className="mt-2 max-w-[520px] text-[14.5px] leading-relaxed text-[#5E5852]">
          Una por unidad: {n0(unidades)} etiquetas de {n0(datos.lineas.filter((l) => l.unidades > 0).length)} productos. Pégalas en cada unidad tapando cualquier otro código de barras.
        </p>

        <fieldset className="mt-6">
          <legend className="text-[13px] font-semibold text-[#141414]">¿En qué hoja imprimes?</legend>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {FORMATOS.map((f) => (
              <label key={f.id} className={cx('flex min-h-[48px] cursor-pointer items-center gap-3 rounded-2xl border px-4 py-2.5 text-[14px] transition', formato === f.id ? 'border-[#F26212] bg-[#FBEFE8] text-[#141414]' : 'border-[#E5E1DB] text-[#5E5852] hover:border-[#B8AE9F]')}>
                <input type="radio" name="formato" value={f.id} checked={formato === f.id} onChange={() => setFormato(f.id)} className="accent-[#F26212]" />
                {f.nombre}
              </label>
            ))}
          </div>
        </fieldset>

        <button type="button" onClick={() => void descargar()} disabled={descargando} className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#F26212] px-6 text-[15px] font-semibold text-[#FFFFFF] shadow-[0_10px_24px_-10px_rgba(242,98,18,0.9)] transition hover:bg-[#E0560C] disabled:opacity-60 sm:w-auto">
          {descargando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {descargando ? 'Preparando el PDF…' : 'Descargar etiquetas'}
        </button>

        <div className="mt-5 space-y-3">
          {error && (
            <Franja tono="error" icono={<TriangleAlert className="h-5 w-5" />}>
              {error}
            </Franja>
          )}
          {resultado && (
            <Franja tono={resultado.descartadas > 0 ? 'error' : 'ok'} icono={resultado.descartadas > 0 ? <TriangleAlert className="h-5 w-5" /> : <CircleCheck className="h-5 w-5" />}>
              {n0(resultado.etiquetas)} etiquetas en {n0(resultado.paginas)} página{resultado.paginas === 1 ? '' : 's'}.
              {resultado.descartadas > 0 && <> {n0(resultado.descartadas)} producto{resultado.descartadas === 1 ? '' : 's'} sin FNSKU todavía: avísanos y te las mandamos. {resultado.motivos.slice(0, 3).join(' · ')}</>}
            </Franja>
          )}
        </div>
      </motion.section>

      <aside className="space-y-3">
        <div className="rounded-3xl border border-[#E5E1DB] bg-[#FFFFFF] p-5">
          <p className="flex items-center gap-2 text-[14px] font-semibold text-[#141414]">
            <Printer className="h-4 w-4 text-[#F26212]" />
            Consejos
          </p>
          <ul className="mt-3 space-y-2 text-[13.5px] leading-relaxed text-[#5E5852]">
            <li>Imprime al 100 % (sin «ajustar a la página»): si no, el código no se lee.</li>
            <li>Una etiqueta por unidad, en una cara lisa.</li>
            <li>Tapa el código de barras del fabricante si lo hay.</li>
          </ul>
        </div>
        {datos.etiquetas.ultima && (
          <p className="rounded-2xl border border-[#E5E1DB] bg-[#FFFFFF] px-5 py-4 text-[13px] text-[#5E5852]">
            Última descarga: {n0(datos.etiquetas.ultima.etiquetas)} etiquetas el {new Date(datos.etiquetas.ultima.at).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}.
          </p>
        )}
      </aside>
    </div>
  )
}
