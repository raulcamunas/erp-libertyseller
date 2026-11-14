'use client'

import { motion } from 'framer-motion'
import { Check, ClipboardList, Package, Tags, Truck, type LucideIcon } from 'lucide-react'
import { FASES_DEL_PORTAL, indiceDeFase, type FaseDelPortal } from '@/lib/fba/propuesta-cliente'
import { cx } from '@/components/encaje/marca'

const ICONOS: Record<FaseDelPortal, LucideIcon> = { propuesta: ClipboardList, etiquetas: Tags, cajas: Package, envio: Truck }

/**
 * LAS CUATRO FASES DEL ENVÍO, ARRIBA DEL PORTAL.
 *
 * Dice dónde está el envío (la fase actual, en naranja), qué ya está hecho (con su marca) y qué viene. Se
 * puede volver a mirar una fase anterior —las etiquetas siguen descargándose mientras se encaja—, pero no
 * saltar a una que todavía no ha llegado. El subrayado de la elegida se desliza (layoutId).
 *
 * En el móvil es una tira con desplazamiento horizontal, con objetivos de 44 px.
 */
export function BarraDeFases({
  actual,
  vista,
  onVer,
  pegada = true,
}: {
  actual: FaseDelPortal
  vista: FaseDelPortal
  onVer: (f: FaseDelPortal) => void
  /** Pegada arriba al bajar. En «Cajas» no: ahí la que se pega es la barra de progreso del encaje */
  pegada?: boolean
}) {
  const iActual = indiceDeFase(actual)
  return (
    <nav aria-label="Fases del envío" className={cx(pegada && 'sticky top-0 z-30', 'border-b border-[#E5E1DB] bg-[#F7F5F2]/95 backdrop-blur')}>
      <ol className="mx-auto flex max-w-[1180px] gap-1 overflow-x-auto px-3 [scrollbar-width:none] sm:px-6 [&::-webkit-scrollbar]:hidden" role="tablist">
        {FASES_DEL_PORTAL.map((f, i) => {
          const Icono = ICONOS[f.id]
          const hecha = i < iActual
          const esActual = i === iActual
          const futura = i > iActual
          const elegida = f.id === vista
          return (
            <li key={f.id} className="shrink-0">
              <button
                type="button"
                role="tab"
                aria-selected={elegida}
                aria-current={esActual ? 'step' : undefined}
                disabled={futura}
                onClick={() => onVer(f.id)}
                title={f.pista}
                className={cx(
                  'relative flex min-h-[52px] items-center gap-2.5 px-3 text-[14px] font-medium transition-colors sm:px-4',
                  futura ? 'cursor-not-allowed text-[#B8AE9F]' : elegida ? 'text-[#141414]' : 'text-[#5E5852] hover:text-[#141414]'
                )}
              >
                <span
                  className={cx(
                    'grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-semibold transition-colors',
                    hecha ? 'bg-[#2F9657] text-[#FFFFFF]' : esActual ? 'bg-[#F26212] text-[#FFFFFF] shadow-[0_0_0_4px_rgba(242,98,18,0.15)]' : 'border border-[#D9D2C7] text-[#B8AE9F]'
                  )}
                >
                  {hecha ? <Check className="h-3.5 w-3.5" /> : <Icono className="h-3.5 w-3.5" />}
                </span>
                <span className="whitespace-nowrap">
                  <span className="mr-1 text-[#B8AE9F] tabular-nums">{i + 1}.</span>
                  {f.texto}
                </span>
                {elegida && <motion.span layoutId="portal-fase-elegida" className="absolute inset-x-2 bottom-0 h-[3px] rounded-full bg-[#F26212]" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
