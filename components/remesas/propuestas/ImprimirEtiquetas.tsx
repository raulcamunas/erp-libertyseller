'use client'

import { useState } from 'react'
import { AlertTriangle, Loader2, Printer } from 'lucide-react'
import { toast } from 'sonner'
import { BOTON, CAMPO, COLOR_ESTADO, TIPO } from '@/lib/estilo/denso'
import { FORMATOS } from '@/lib/fba/formatos-etiqueta'
import type { RemesaDePanel } from '@/lib/fba/datos'
import { cx, Tarjeta } from '../comun/ui'
import { fecha } from '../formato'

/**
 * IMPRIMIR LAS ETIQUETAS DE PRODUCTO.
 *
 * Se abren en una pestaña en vez de descargarse: casi siempre se miran antes de
 * mandarlas a la impresora, y así no se llena la carpeta de descargas. Si alguna
 * referencia no puede llevar etiqueta (sin FNSKU, por ejemplo), se dice cuáles.
 *
 * Y se avisa cuando lo impreso es de una versión anterior: si la propuesta se
 * reabrió después de imprimir, hay pegatinas puestas en mercancía que pueden
 * haber dejado de valer.
 */

export function ImprimirEtiquetas({ remesa, destacado }: { remesa: RemesaDePanel; destacado?: boolean }) {
  const [imprimiendo, setImprimiendo] = useState(false)
  const [formato, setFormato] = useState(FORMATOS[0].id)
  const vieja = remesa.ultimaImpresion && remesa.ultimaImpresion.version < remesa.version

  async function imprimir() {
    setImprimiendo(true)
    try {
      const res = await fetch(`/api/fba/remesas/${remesa.id}/etiquetas?formato=${formato}`)
      if (!res.ok) {
        const p = (await res.json().catch(() => null)) as { error?: string } | null
        toast.error(p?.error ?? 'No se han podido generar las etiquetas')
        return
      }
      const descartadas = Number(res.headers.get('X-Descartadas') ?? 0)
      const impresas = res.headers.get('X-Etiquetas')
      const paginas = res.headers.get('X-Paginas')

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank')
      setTimeout(() => URL.revokeObjectURL(url), 60_000)

      if (descartadas > 0) {
        const motivos = decodeURIComponent(res.headers.get('X-Motivos') ?? '')
        toast.warning(`${impresas} etiquetas en ${paginas} páginas, pero ${descartadas} sin imprimir`, { description: motivos.slice(0, 200), duration: 10_000 })
      } else {
        toast.success(`${impresas} etiquetas en ${paginas} página${paginas === '1' ? '' : 's'}`)
      }
    } finally {
      setImprimiendo(false)
    }
  }

  return (
    <Tarjeta
      titulo="Etiquetas de producto"
      ayuda="Una por unidad, con el FNSKU de cada referencia"
      derecha={
        remesa.ultimaImpresion && !vieja ? (
          <span className="text-[11px] text-[var(--ls-t4)]">
            Última tirada: {remesa.ultimaImpresion.etiquetas.toLocaleString('es-ES')} el {fecha(remesa.ultimaImpresion.impresoAt)}
          </span>
        ) : undefined
      }
    >
      {vieja && remesa.ultimaImpresion && (
        <div
          className="mb-3 flex items-start gap-2 rounded-[6px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-[10px] py-[8px] text-[12px] leading-[1.5] text-[var(--ls-t2)]"
          style={{ borderLeft: `3px solid ${COLOR_ESTADO.ambar}` }}
        >
          <AlertTriangle className="mt-[2px] h-[14px] w-[14px] shrink-0" style={{ color: COLOR_ESTADO.ambar }} />
          <div>
            <b className="font-semibold text-[var(--ls-t1)]">Las etiquetas impresas son de una versión anterior.</b> Se imprimieron{' '}
            {remesa.ultimaImpresion.etiquetas.toLocaleString('es-ES')} el {fecha(remesa.ultimaImpresion.impresoAt)}, cuando la propuesta iba por la versión{' '}
            {remesa.ultimaImpresion.version}; ahora va por la {remesa.version}. Las pegatinas de lo que se haya quitado están en mercancía que ya no va, y las de lo que se haya
            añadido no existen. Vuelve a imprimir antes de cerrar las cajas.
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={imprimir}
          disabled={imprimiendo}
          className={cx(BOTON.base, 'h-8 px-3 text-[12.5px]', destacado ? BOTON.primario : BOTON.secundario)}
        >
          {imprimiendo ? <Loader2 className="h-[14px] w-[14px] animate-spin" /> : <Printer className="h-[14px] w-[14px]" />}
          {imprimiendo ? 'Generando…' : 'Imprimir etiquetas'}
        </button>
        <label className="flex items-center gap-2 text-[11.5px] text-[var(--ls-t4)]">
          Hoja
          <select value={formato} onChange={(e) => setFormato(e.target.value)} title="En qué hoja se van a imprimir" className={cx(CAMPO.input, 'h-[30px] w-auto pr-6')}>
            {FORMATOS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nombre}
              </option>
            ))}
          </select>
        </label>
        <p className={cx(TIPO.s, 'basis-full text-[var(--ls-t3)]')}>Se abre en una pestaña nueva para revisarlas antes de mandarlas a la impresora.</p>
      </div>
    </Tarjeta>
  )
}
