'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, MoreHorizontal, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatoHoras } from '@/lib/payroll/horas'

const RAPIDAS = [3, 4, 5, 6, 7, 8]

/** Las 6 horas rápidas y «Otra» como control segmentado. 44 px de alto con el dedo. */
function Botonera({ horasHoy, guardando, onApuntar, onOtra, grande }: { horasHoy: number; guardando: boolean; onApuntar: (h: number) => void; onOtra: () => void; grande?: boolean }) {
  const esRapida = RAPIDAS.includes(horasHoy)
  return (
    <div role="group" aria-label="Apuntar las horas de hoy" className="grid grid-cols-7 gap-1 rounded-[12px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-1">
      {RAPIDAS.map((h) => {
        const activa = horasHoy === h
        return (
          <button
            key={h}
            type="button"
            disabled={guardando}
            onClick={() => onApuntar(h)}
            aria-pressed={activa}
            aria-label={`Apuntar ${h} horas hoy`}
            className={cn(
              'relative rounded-[9px] text-[13px] font-semibold tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--ls-acc-graf)] disabled:opacity-50',
              grande ? 'h-11' : 'h-9 [@media(pointer:coarse)]:h-11',
              activa ? 'text-white' : 'text-[var(--ls-t2)] hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]',
            )}
          >
            {activa && (
              <motion.span
                layoutId={grande ? 'apuntar-hoy-movil' : 'apuntar-hoy'}
                aria-hidden
                className="absolute inset-0 rounded-[9px] bg-[var(--ls-acc-graf)] shadow-[0_6px_16px_-8px_var(--ls-acc-graf)]"
                transition={{ type: 'spring', stiffness: 520, damping: 40 }}
              />
            )}
            <span className="relative">{h}h</span>
          </button>
        )
      })}
      <button
        type="button"
        onClick={onOtra}
        aria-label="Otra cantidad u otra nota"
        className={cn(
          'flex items-center justify-center rounded-[9px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--ls-acc-graf)]',
          grande ? 'h-11' : 'h-9 [@media(pointer:coarse)]:h-11',
          horasHoy > 0 && !esRapida ? 'bg-[var(--ls-acc-graf)] text-white' : 'text-[var(--ls-t3)] hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]',
        )}
      >
        {horasHoy > 0 && !esRapida ? <span className="text-[13px] font-semibold tabular-nums">{formatoHoras(horasHoy)}</span> : <MoreHorizontal className="h-4 w-4" />}
      </button>
    </div>
  )
}

function Estado({ horasHoy }: { horasHoy: number }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={horasHoy > 0 ? `si-${horasHoy}` : 'no'}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.18 }}
        className="flex min-w-0 items-center gap-1.5 text-[13px]"
      >
        {horasHoy > 0 ? <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--ls-e-verde)]" /> : <Zap className="h-4 w-4 shrink-0 text-[var(--ls-acc-graf)]" />}
        <span className="truncate text-[var(--ls-t2)]">{horasHoy > 0 ? `Hoy tienes apuntadas ${formatoHoras(horasHoy)} h` : 'Todavía no has apuntado las horas de hoy'}</span>
      </motion.span>
    </AnimatePresence>
  )
}

/** «Apuntar hoy» en el PC: una franja dentro de la tarjeta del calendario. */
export function ApuntarHoyTarjeta(props: { horasHoy: number; guardando: boolean; onApuntar: (h: number) => void; onOtra: () => void }) {
  return (
    <div
      className={cn(
        'mb-4 hidden flex-wrap items-center gap-3 rounded-[12px] border p-3 lg:flex',
        props.horasHoy > 0 ? 'border-[color-mix(in_srgb,var(--ls-e-verde)_28%,var(--ls-linea))] bg-[color-mix(in_srgb,var(--ls-e-verde)_6%,transparent)]' : 'border-[color-mix(in_srgb,var(--ls-acc-graf)_32%,var(--ls-linea))] bg-[color-mix(in_srgb,var(--ls-acc-graf)_7%,transparent)]',
      )}
    >
      <div className="min-w-[200px] flex-1">
        <Estado horasHoy={props.horasHoy} />
      </div>
      <div className="w-[380px] max-w-full">
        <Botonera {...props} />
      </div>
    </div>
  )
}

/**
 * «Apuntar hoy» en el MÓVIL: pegajoso abajo mientras se baja por la pantalla, con fondo esmerilado y el hueco de la
 * barra del sistema. Es `sticky` (no `fixed`), así que no necesita portal y no tapa nada al final de la página.
 */
export function ApuntarHoyPegajoso(props: { horasHoy: number; guardando: boolean; onApuntar: (h: number) => void; onOtra: () => void }) {
  return (
    <div className="sticky bottom-0 z-20 -mx-4 mt-4 border-t border-[var(--ls-linea)] bg-[color-mix(in_srgb,var(--ls-fondo)_88%,transparent)] px-4 pb-[calc(env(safe-area-inset-bottom)+10px)] pt-2.5 shadow-[0_-12px_30px_-18px_rgba(0,0,0,0.6)] backdrop-blur-xl lg:hidden">
      <div className="mb-2">
        <Estado horasHoy={props.horasHoy} />
      </div>
      <Botonera {...props} grande />
    </div>
  )
}
