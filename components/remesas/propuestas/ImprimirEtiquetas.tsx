'use client'

import { useState } from 'react'
import { AlertTriangle, Printer, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Boton } from '@/components/ui-ls'
import { CAMPO, COLOR_ESTADO, TIPO } from '@/lib/estilo/denso'
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
 *
 * Lo usan la agencia y el cliente con `puede_editar` (D39), por versión: el aviso compara la versión impresa con
 * la de la propuesta.
 */

export function ImprimirEtiquetas({ remesa, destacado }: { remesa: RemesaDePanel; destacado?: boolean }) {
  const [imprimiendo, setImprimiendo] = useState(false)
  const [formato, setFormato] = useState(FORMATOS[0].id)
  const [leyendo, setLeyendo] = useState(false)
  const vieja = remesa.ultimaImpresion && remesa.ultimaImpresion.version < remesa.version

  /** Le pregunta a Amazon, ahora, el FNSKU de cada referencia y dice qué ha contestado de cada una */
  async function actualizarFnsku() {
    setLeyendo(true)
    try {
      const res = await fetch(`/api/fba/remesas/${remesa.id}/fnsku`, { method: 'POST' })
      const p = (await res.json().catch(() => null)) as {
        error?: string
        reales?: number
        conAsin?: number
        sinFnsku?: number
        leidos?: Array<{ sku: string; estado: 'real' | 'asin' | 'ninguno' }>
      } | null
      if (!res.ok || !p?.leidos) {
        toast.error(p?.error ?? 'No se ha podido leer el FNSKU de Amazon')
        return
      }
      const aparte = (estado: 'asin' | 'ninguno') => p.leidos!.filter((l) => l.estado === estado).map((l) => l.sku)
      const conAsin = aparte('asin')
      const sin = aparte('ninguno')
      const detalle = [
        conAsin.length > 0 ? `Con el código del fabricante (Amazon da su ASIN, sin etiqueta de Amazon): ${conAsin.join(', ')}.` : '',
        sin.length > 0 ? `Sin FNSKU todavía (Amazon se lo da al meterlas en un envío en Seller Central): ${sin.join(', ')}.` : '',
      ]
        .filter(Boolean)
        .join(' ')
      const mensaje = `${p.reales ?? 0} con FNSKU de Amazon · ${conAsin.length} con código del fabricante · ${sin.length} sin FNSKU`
      if (conAsin.length + sin.length === 0) toast.success(mensaje)
      else toast.warning(mensaje, { description: detalle, duration: 14_000 })
    } finally {
      setLeyendo(false)
    }
  }

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
      // Impresas, pero con el ASIN en el código: se dice para que se mire si esa referencia necesita pegatina
      const avisos = decodeURIComponent(res.headers.get('X-Avisos') ?? '')
      if (avisos) toast.info('Hay etiquetas con el ASIN en el código', { description: avisos.slice(0, 300), duration: 12_000 })
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
          className="mb-3 flex items-start gap-2 rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-[10px] py-[8px] text-[12px] leading-[1.5] text-[var(--ls-t2)]"
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
        <Boton variante={destacado ? 'primario' : 'secundario'} tamano="sm" icono={Printer} cargando={imprimiendo} onClick={() => void imprimir()}>
          {imprimiendo ? 'Generando…' : 'Imprimir etiquetas'}
        </Boton>
        <Boton
          variante="secundario"
          tamano="sm"
          icono={RefreshCw}
          cargando={leyendo}
          disabled={imprimiendo}
          title="Le pregunta a Amazon ahora el FNSKU de cada referencia de este envío. Las etiquetas también lo piden solas si falta alguno"
          onClick={() => void actualizarFnsku()}
        >
          {leyendo ? 'Leyendo…' : 'Actualizar FNSKU'}
        </Boton>
        <label className="flex min-w-0 items-center gap-2 text-[12px] text-[var(--ls-t4)]">
          Hoja
          <select value={formato} onChange={(e) => setFormato(e.target.value)} title="En qué hoja se van a imprimir" className={cx(CAMPO.input, 'h-8 w-auto min-w-0 max-w-[220px] pr-6 [@media(pointer:coarse)]:h-11')}>
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
