'use client'

import { motion, MotionConfig } from 'framer-motion'
import { CalendarRange, Megaphone, SearchCheck, ShieldCheck, Truck, type LucideIcon } from 'lucide-react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { NOMBRE_AREA, type AreaDeSalud, type Semaforo, type TonoDeSalud } from '@/lib/cuentas/salud'
import { colorDeAcento, mezcla, TACTIL, type Modulo } from '@/components/ui-ls'
import { cn } from '@/lib/utils'

/** Las piezas visuales de la salud de una cuenta: semáforos por área y el anillo del progreso de la semana */

export const AREA_UI: Record<AreaDeSalud, { icono: LucideIcon; acento: Modulo }> = {
  ciclo: { icono: CalendarRange, acento: 'cuentas' },
  marketing: { icono: Megaphone, acento: 'marketing' },
  seo: { icono: SearchCheck, acento: 'seo' },
  cumplimiento: { icono: ShieldCheck, acento: 'cumplimiento' },
  remesas: { icono: Truck, acento: 'remesas' },
}

export const colorDeTono = (t: TonoDeSalud) => COLOR_ESTADO[t]

export const TEXTO_TONO: Record<TonoDeSalud, string> = { verde: 'Bien', ambar: 'Mirar', rojo: 'Urgente', gris: 'Sin datos', azul: 'En curso' }

/** El punto de un semáforo: late suave cuando está en rojo (y se queda quieto con «reducir movimiento», por el CSS de .ls-latido) */
export function PuntoDeSalud({ tono, tamano = 8 }: { tono: TonoDeSalud; tamano?: number }) {
  const color = colorDeTono(tono)
  return (
    <span className="relative inline-flex shrink-0" style={{ width: tamano, height: tamano }} aria-hidden>
      {tono === 'rojo' && <span className="absolute inset-0 animate-ping rounded-full opacity-50 motion-reduce:animate-none" style={{ background: color }} />}
      <span className="relative inline-flex rounded-full" style={{ width: tamano, height: tamano, background: color, boxShadow: `0 0 8px ${mezcla(color, 60)}` }} />
    </span>
  )
}

/** Fila compacta para la tarjeta de la lista: un chip por área con su icono, el punto y la palabra */
export function SemaforosCompactos({ semaforos }: { semaforos: readonly Semaforo[] }) {
  return (
    <ul className="grid grid-cols-5 gap-1" aria-label="Salud de la cuenta">
      {semaforos.map((s) => {
        const { icono: Icono } = AREA_UI[s.area]
        const color = colorDeTono(s.tono)
        return (
          <li
            key={s.area}
            title={`${NOMBRE_AREA[s.area]}: ${s.texto}`}
            className="flex min-w-0 flex-col items-center gap-[5px] rounded-[10px] border px-1 py-[7px]"
            style={{ borderColor: s.tono === 'gris' ? 'var(--ls-linea)' : mezcla(color, 30), background: s.tono === 'gris' ? 'transparent' : mezcla(color, 8) }}
          >
            <span className="flex items-center gap-[5px]">
              <Icono className="h-[13px] w-[13px] text-[var(--ls-t3)]" aria-hidden />
              <PuntoDeSalud tono={s.tono} tamano={7} />
            </span>
            <span className="w-full truncate text-center text-[10.5px] font-medium leading-none text-[var(--ls-t3)]">{s.texto}</span>
            <span className="sr-only">
              {NOMBRE_AREA[s.area]}: {TEXTO_TONO[s.tono]}, {s.texto}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/** Las cinco losetas grandes del Resumen: cada una lleva a su pestaña */
export function SemaforosGrandes({ semaforos, alPulsar }: { semaforos: readonly Semaforo[]; alPulsar: (a: AreaDeSalud) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {semaforos.map((s, i) => {
        const { icono: Icono, acento } = AREA_UI[s.area]
        const color = colorDeTono(s.tono)
        const ac = colorDeAcento(acento)
        return (
          <button
            key={s.area}
            type="button"
            onClick={() => alPulsar(s.area)}
            className={cn(
              'ls-aparecer ls-elevar group relative flex min-w-0 flex-col items-start gap-2 overflow-hidden rounded-[12px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-3 text-left',
              'outline-none hover:border-[var(--ls-linea2)] focus-visible:ring-2 focus-visible:ring-[var(--ls-acc-graf)]',
              TACTIL,
              i === 4 && 'col-span-2 sm:col-span-1',
            )}
            style={{ ['--ls-i' as string]: i }}
          >
            {/* Velo del color del semáforo, de abajo arriba */}
            <span aria-hidden className="pointer-events-none absolute inset-0" style={{ background: `linear-gradient(0deg, ${mezcla(color, s.tono === 'gris' ? 0 : 12)}, transparent 70%)` }} />
            <span className="relative flex w-full items-center gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px]" style={{ background: mezcla(ac, 16), color: ac }}>
                <Icono className="h-[14px] w-[14px]" aria-hidden />
              </span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-[var(--ls-t2)]">{NOMBRE_AREA[s.area]}</span>
              <PuntoDeSalud tono={s.tono} tamano={9} />
            </span>
            <span className="relative w-full truncate text-[15px] font-semibold tracking-[-0.01em] text-[var(--ls-t1)]">{s.texto}</span>
            <span className="relative text-[11px] font-semibold uppercase tracking-[0.06em]" style={{ color: s.tono === 'gris' ? 'var(--ls-t4)' : color }}>
              {TEXTO_TONO[s.tono]}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** Anillo de progreso (los pasos de la semana hechos). Dibuja el arco con framer-motion; con «reducir movimiento» aparece ya lleno */
export function AnilloDeProgreso({ hechos, total, tamano = 44, grosor = 4, color, children }: { hechos: number; total: number; tamano?: number; grosor?: number; color?: string; children?: React.ReactNode }) {
  const r = (tamano - grosor) / 2
  const p = total > 0 ? Math.min(1, hechos / total) : 0
  const c = color ?? (p >= 1 ? COLOR_ESTADO.verde : 'var(--ls-mod-cuentas)')
  return (
    <MotionConfig reducedMotion="user">
      <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: tamano, height: tamano }} role="img" aria-label={`${hechos} de ${total} hechos`}>
        <svg width={tamano} height={tamano} className="-rotate-90" aria-hidden>
          <circle cx={tamano / 2} cy={tamano / 2} r={r} fill="none" stroke="var(--ls-sup3)" strokeWidth={grosor} />
          <motion.circle
            cx={tamano / 2}
            cy={tamano / 2}
            r={r}
            fill="none"
            stroke={c}
            strokeWidth={grosor}
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: p }}
            transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
            style={{ filter: `drop-shadow(0 0 4px ${mezcla(c, 50)})` }}
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold tabular-nums text-[var(--ls-t1)]">{children ?? `${hechos}/${total}`}</span>
      </span>
    </MotionConfig>
  )
}
