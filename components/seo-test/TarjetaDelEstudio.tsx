'use client'

import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { ClipboardPaste, TriangleAlert, Wand2 } from 'lucide-react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { puntuarListing } from '@/lib/seo/puntuacion'
import type { ConsultaGuardada } from '@/lib/seo/datos'
import type { BusquedaDiagnosticada } from '@/lib/seo/embudo'
import type { TextosFicha } from '@/lib/seo/edicion'
import { ImagenDeProducto } from '@/components/productos/ImagenDeProducto'

export const colorDePuntuacion = (n: number) => (n >= 90 ? COLOR_ESTADO.verde : n >= 70 ? '#a3d65c' : n >= 50 ? COLOR_ESTADO.ambar : COLOR_ESTADO.rojo)

/** Un anillo pequeño con la puntuación (tarjetas de producto y la entrada al estudio) */
export function AnilloDePuntuacion({ valor, lado = 44, grosor = 5 }: { valor: number; lado?: number; grosor?: number }) {
  const r = (lado - grosor) / 2
  const L = 2 * Math.PI * r
  const color = colorDePuntuacion(valor)
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: lado, height: lado }} title={`Puntuación SEO del listing: ${valor} de 100`}>
      <svg viewBox={`0 0 ${lado} ${lado}`} className="absolute inset-0 -rotate-90">
        <circle cx={lado / 2} cy={lado / 2} r={r} fill="none" stroke="var(--ls-sup2)" strokeWidth={grosor} />
        <motion.circle cx={lado / 2} cy={lado / 2} r={r} fill="none" stroke={color} strokeWidth={grosor} strokeLinecap="round" strokeDasharray={L} initial={{ strokeDashoffset: L }} animate={{ strokeDashoffset: L * (1 - valor / 100) }} transition={{ type: 'spring', stiffness: 90, damping: 18 }} />
      </svg>
      <span className="relative font-bold tabular-nums text-[var(--ls-t1)]" style={{ fontSize: lado * 0.32 }}>
        {valor}
      </span>
    </span>
  )
}

/** La entrada al Estudio de listing en la pestaña Ficha: la nota de la ficha de Amazon y lo que más sumaría */
export function TarjetaDelEstudio({ textos, busquedas, abrir, asin, mkt }: { textos: TextosFicha; busquedas: ReadonlyArray<BusquedaDiagnosticada<ConsultaGuardada>>; abrir: () => void; asin: string; mkt: string | null }) {
  const p = useMemo(() => puntuarListing(textos, busquedas), [textos, busquedas])
  return (
    <motion.button
      type="button"
      onClick={abrir}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.995 }}
      className="group relative flex w-full items-center gap-4 overflow-hidden rounded-[16px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-4 text-left transition-[border-color,box-shadow] hover:border-[var(--ls-linea2)] hover:shadow-[var(--ls-sombra-2)]"
    >
      <span aria-hidden className="pointer-events-none absolute -left-10 -top-16 h-40 w-40 rounded-full opacity-20 blur-3xl transition-opacity group-hover:opacity-35" style={{ background: colorDePuntuacion(p.total) }} />
      <ImagenDeProducto asin={asin} mkt={mkt} lado={56} redondeo={12} className="hidden sm:inline-flex" />
      <AnilloDePuntuacion valor={p.total} lado={60} grosor={6} />
      <span className="relative min-w-0 flex-1">
        <span className="flex items-center gap-2 text-[14px] font-semibold text-[var(--ls-t1)]">
          <Wand2 className="h-[15px] w-[15px]" style={{ color: 'var(--ls-acc)' }} /> Estudio de listing
          <span className="text-[12px] font-normal text-[var(--ls-t4)]">puntuación SEO de la ficha actual</span>
        </span>
        <span className="mt-1 block text-[12.5px] leading-[1.45] text-[var(--ls-t3)]">
          {p.siguientes.length > 0 ? (
            <>
              Lo que más suma: <span className="text-[var(--ls-t2)]">{p.siguientes[0].texto}</span> <span className="font-semibold" style={{ color: COLOR_ESTADO.verde }}>+{p.siguientes[0].puntos}</span>
            </>
          ) : (
            'La ficha está al máximo según las búsquedas de Brand Analytics.'
          )}
        </span>
      </span>
      <span className="relative hidden h-[34px] shrink-0 items-center rounded-[10px] bg-[var(--ls-acc-relleno)] px-3 text-[12.5px] font-semibold text-[var(--ls-acc-tinta)] sm:inline-flex">Abrir el estudio</span>
    </motion.button>
  )
}

/** El aviso de arriba de la pestaña Ficha cuando no hay Item Highlights guardados (ni de Amazon ni puestos a mano) */
export function AvisoDeHighlights({ pegar }: { pegar: () => void }) {
  return (
    <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-center gap-3 rounded-[14px] border px-4 py-3" style={{ borderColor: `color-mix(in srgb, ${COLOR_ESTADO.ambar} 40%, transparent)`, background: `color-mix(in srgb, ${COLOR_ESTADO.ambar} 9%, transparent)` }}>
      <TriangleAlert className="h-[18px] w-[18px] shrink-0" style={{ color: COLOR_ESTADO.ambar }} />
      <div className="min-w-0 flex-1 text-[12.5px] leading-[1.5] text-[var(--ls-t2)]">
        <b className="text-[var(--ls-t1)]">No están guardados los Item Highlights de este producto.</b> Amazon todavía no deja leerlos por la API para este tipo de producto. Si el producto los tiene en Seller Central, pégalos aquí para que cuenten en el SEO (búsquedas cubiertas, puntuación y propuesta con IA).
      </div>
      <button type="button" onClick={pegar} className="inline-flex h-[32px] shrink-0 items-center gap-[6px] rounded-[9px] px-3 text-[12.5px] font-semibold transition-[filter] hover:brightness-110" style={{ color: '#1a1205', background: COLOR_ESTADO.ambar }}>
        <ClipboardPaste className="h-[14px] w-[14px]" /> Pegarlos ahora
      </button>
    </motion.div>
  )
}
