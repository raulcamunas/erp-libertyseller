'use client'

import { motion } from 'framer-motion'
import { ClipboardPaste, TriangleAlert } from 'lucide-react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'

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
