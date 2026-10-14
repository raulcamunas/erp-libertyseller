'use client'

import { useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { BOTON, COLOR_ESTADO } from '@/lib/estilo/denso'
import { cx, Tarjeta } from '../comun/ui'

/**
 * LOS DOS EXCEL QUE SE SUBEN A SELLER CENTRAL.
 *
 * Seller Central da, para cada envío, dos plantillas vacías: una con las
 * referencias y otra con las cajas. El ERP las rellena con lo que ya está
 * acordado y encajado, y el vendedor las sube. La plantilla NO vive en el ERP:
 * lleva grabados la cuenta y el envío, así que entra con la petición, se rellena
 * en memoria y sale; no se guarda.
 */

interface Resultado {
  ok: boolean
  texto: string
  avisos?: string
}

export function PlantillasAmazon({ remesaId }: { remesaId: string }) {
  return (
    <Tarjeta
      titulo="Preparar el envío en Seller Central"
      ayuda="Sube a cada tarjeta la plantilla vacía que da Amazon y descarga el Excel ya relleno"
      cuerpo={false}
    >
      <div className="grid divide-y divide-[var(--ls-linea)] md:grid-cols-2 md:divide-x md:divide-y-0">
        <Plantilla
          remesaId={remesaId}
          ruta="manifiesto"
          titulo="1 · Manifiesto"
          ayuda="Qué referencias van y cuántas de cada. Es la plantilla de «Enviar a Amazon» (Cadena de suministro → Crear envío → subir un archivo)."
          leer={(h) => {
            const descartadas = Number(h.get('X-Descartadas') ?? 0)
            return {
              ok: true,
              texto: `${h.get('X-Lineas')} líneas y ${h.get('X-Unidades')} unidades rellenadas.`,
              avisos: descartadas > 0 ? `${descartadas} sin poder rellenar: ${decodeURIComponent(h.get('X-Motivos') ?? '')}` : undefined,
            }
          }}
        />
        <Plantilla
          remesaId={remesaId}
          ruta="embalaje"
          titulo="2 · Embalaje"
          ayuda="En qué caja va cada unidad, con peso y medidas. Es la plantilla de «Información de embalaje de la caja» que da Amazon al elegir el envío."
          leer={(h) => {
            const desc = Number(h.get('X-Descuadres') ?? 0)
            return {
              ok: true,
              texto: `${h.get('X-Cajas')} cajas y ${h.get('X-Unidades')} unidades rellenadas.`,
              avisos: desc > 0 ? `Descuadres con lo que espera Amazon: ${decodeURIComponent(h.get('X-Descuadre-Detalle') ?? '')}` : undefined,
            }
          }}
        />
      </div>
    </Tarjeta>
  )
}

function Plantilla({
  remesaId,
  ruta,
  titulo,
  ayuda,
  leer,
}: {
  remesaId: string
  ruta: 'manifiesto' | 'embalaje'
  titulo: string
  ayuda: string
  leer: (h: Headers) => Resultado
}) {
  const entrada = useRef<HTMLInputElement>(null)
  const [archivo, setArchivo] = useState<File | null>(null)
  const [trabajando, setTrabajando] = useState(false)
  const [resultado, setResultado] = useState<Resultado | null>(null)

  async function generar() {
    if (!archivo) return
    setTrabajando(true)
    setResultado(null)
    try {
      const form = new FormData()
      form.append('plantilla', archivo)
      const res = await fetch(`/api/fba/remesas/${remesaId}/${ruta}`, { method: 'POST', body: form })
      if (!res.ok) {
        const p = (await res.json().catch(() => null)) as { error?: string } | null
        const texto = p?.error ?? 'No se ha podido rellenar la plantilla'
        setResultado({ ok: false, texto })
        toast.error(texto)
        return
      }
      const blob = await res.blob()
      const nombre = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? `${ruta}.xlsx`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = nombre
      a.click()
      URL.revokeObjectURL(url)
      const r = leer(res.headers)
      setResultado(r)
      if (r.avisos) toast.warning(r.avisos, { duration: 10_000 })
      else toast.success(r.texto)
    } finally {
      setTrabajando(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex items-start gap-2">
        <FileSpreadsheet className="mt-[2px] h-4 w-4 shrink-0 text-[var(--ls-t3)]" />
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-[var(--ls-t1)]">{titulo}</p>
          <p className="text-[11.5px] leading-[1.5] text-[var(--ls-t3)]">{ayuda}</p>
        </div>
      </div>

      <input ref={entrada} type="file" accept=".xlsx" className="hidden" onChange={(e) => { setArchivo(e.target.files?.[0] ?? null); setResultado(null) }} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => entrada.current?.click()} className={cx(BOTON.base, BOTON.alto, BOTON.secundario)}>
          <Upload className="h-3 w-3" />
          {archivo ? 'Cambiar plantilla' : 'Elegir plantilla (.xlsx)'}
        </button>
        {archivo && (
          <span className="max-w-[220px] truncate text-[11.5px] text-[var(--ls-t2)]" title={archivo.name}>
            {archivo.name}
          </span>
        )}
      </div>
      <div>
        <button type="button" onClick={generar} disabled={!archivo || trabajando} className={cx(BOTON.base, BOTON.alto, BOTON.primario)}>
          {trabajando ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileSpreadsheet className="h-3 w-3" />}
          {trabajando ? 'Rellenando…' : 'Rellenar y descargar'}
        </button>
      </div>

      {resultado && (
        <div className="flex items-start gap-2 text-[11.5px] leading-[1.5] text-[var(--ls-t2)]">
          {resultado.ok ? (
            <CheckCircle2 className="mt-[2px] h-[14px] w-[14px] shrink-0" style={{ color: COLOR_ESTADO.verde }} />
          ) : (
            <AlertTriangle className="mt-[2px] h-[14px] w-[14px] shrink-0" style={{ color: COLOR_ESTADO.rojo }} />
          )}
          <span>
            {resultado.texto}
            {resultado.avisos && <span className="mt-[2px] block text-[var(--ls-t3)]">{resultado.avisos}</span>}
          </span>
        </div>
      )}
    </div>
  )
}
