'use client'

import { CircleAlert } from 'lucide-react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'

/** Piezas pequeñas de «Cuentas de clientes» */

export function Chip({ tono, children }: { tono: keyof typeof COLOR_ESTADO; children: React.ReactNode }) {
  const color = COLOR_ESTADO[tono]
  return (
    <span className="inline-flex h-[22px] items-center rounded-full px-[9px] text-[11px] font-semibold" style={{ color, background: `color-mix(in srgb, ${color} 13%, transparent)` }}>
      {children}
    </span>
  )
}

export function Nota({ tono, children }: { tono: 'ambar' | 'rojo' | 'azul'; children: React.ReactNode }) {
  const color = COLOR_ESTADO[tono]
  return (
    <div className="flex items-start gap-2 rounded-[10px] px-3 py-2 text-[12.5px] leading-[1.5] text-[var(--ls-t2)]" style={{ background: `color-mix(in srgb, ${color} 10%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 30%, transparent)` }}>
      <CircleAlert className="mt-[2px] h-3.5 w-3.5 shrink-0" style={{ color }} />
      <div className="min-w-0">{children}</div>
    </div>
  )
}
