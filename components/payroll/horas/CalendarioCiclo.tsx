'use client'

import { forwardRef, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { Lock, Plus, StickyNote } from 'lucide-react'
import { cn } from '@/lib/utils'
import { diaDeLaSemana, formatoHoras } from '@/lib/payroll/horas'
import type { WorkHourEntry } from '@/lib/types/payroll'
import { DIAS_LARGOS, INICIALES_SEMANA, diaYMesLargo, numeroDeDia } from './fechas'

/** La barra de una casilla se llena del todo a las 8 h */
export const HORAS_LLENO = 8

/** Cuatro tramos para la leyenda y la intensidad del relleno: 0 h, menos de 4, de 4 a 6, más de 6 */
export function tramoDeHoras(h: number): 0 | 1 | 2 | 3 {
  if (h <= 0) return 0
  if (h < 4) return 1
  if (h <= 6) return 2
  return 3
}
const OPACIDAD_TRAMO = [0, 16, 26, 38]

export function etiquetaDeDia(clave: string, horas: number, futuro: boolean) {
  const base = `${DIAS_LARGOS[diaDeLaSemana(clave)]} ${diaYMesLargo(clave)}`
  if (horas > 0) return `${base}: ${formatoHoras(horas)} horas`
  return futuro ? `${base}: todavía no ha llegado` : `${base}: sin horas`
}

interface CasillaProps {
  clave: string
  horas: number
  nota: string | null
  hoy: boolean
  futuro: boolean
  seleccionado: boolean
  soloMirando: boolean
  onPulsar: () => void
}

/** Una casilla del calendario. forwardRef porque en el PC es el ancla del popover. */
const Casilla = forwardRef<HTMLButtonElement, CasillaProps>(function Casilla({ clave, horas, nota, hoy, futuro, seleccionado, soloMirando, onPulsar, ...resto }, ref) {
  const finde = diaDeLaSemana(clave) >= 5
  const tramo = tramoDeHoras(horas)
  const relleno = Math.min(1, horas / HORAS_LLENO)
  return (
    <button
      ref={ref}
      type="button"
      {...resto}
      onClick={soloMirando ? undefined : onPulsar}
      disabled={soloMirando}
      aria-label={etiquetaDeDia(clave, horas, futuro)}
      aria-current={hoy ? 'date' : undefined}
      aria-expanded={seleccionado || undefined}
      className={cn(
        'group relative flex min-h-[54px] min-w-0 flex-col justify-between overflow-hidden rounded-[11px] border p-1.5 text-left outline-none transition-[border-color,background-color,transform,box-shadow] duration-150 sm:min-h-[64px] sm:p-2 lg:min-h-[78px]',
        'focus-visible:ring-2 focus-visible:ring-[var(--ls-acc-graf)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ls-sup)]',
        !soloMirando && 'hover:-translate-y-px hover:border-[var(--ls-linea2)] hover:shadow-[var(--ls-sombra-1)] active:translate-y-0',
        seleccionado ? 'border-[var(--ls-acc-graf)] bg-[color-mix(in_srgb,var(--ls-acc-graf)_10%,var(--ls-sup2))]' : horas > 0 ? 'border-[color-mix(in_srgb,var(--ls-acc-graf)_26%,var(--ls-linea))] bg-[var(--ls-sup2)]' : finde ? 'border-[var(--ls-linea)] bg-[color-mix(in_srgb,var(--ls-sup2)_45%,transparent)]' : 'border-[var(--ls-linea)] bg-[var(--ls-sup2)]',
        futuro && 'opacity-45',
        soloMirando && 'cursor-default',
      )}
    >
      {/* El relleno: sube desde abajo en proporción a las horas (lleno a 8 h) */}
      {horas > 0 && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 origin-bottom"
          style={{
            height: '100%',
            background: `linear-gradient(180deg, color-mix(in srgb, var(--ls-acc-graf) ${OPACIDAD_TRAMO[tramo] * 0.4}%, transparent), color-mix(in srgb, var(--ls-acc-graf) ${OPACIDAD_TRAMO[tramo]}%, transparent))`,
          }}
          initial={{ scaleY: 0 }}
          animate={{ scaleY: relleno }}
          transition={{ type: 'spring', stiffness: 180, damping: 26 }}
        />
      )}
      {/* Hoy: anillo del acento con un latido suave (quieto con «reducir movimiento») */}
      {hoy && <span aria-hidden className="mh-hoy-anillo pointer-events-none absolute inset-0 rounded-[inherit]" />}

      <span className="relative flex items-center justify-between gap-1">
        <span className={cn('text-[12px] leading-none tabular-nums sm:text-[13px]', hoy ? 'font-bold text-[var(--ls-acc-graf)]' : 'text-[var(--ls-t3)]')}>{numeroDeDia(clave)}</span>
        {nota && <StickyNote aria-label="Tiene nota" className="h-3 w-3 shrink-0 text-[var(--ls-t4)]" />}
        {futuro && !nota && !soloMirando && <Lock aria-hidden className="hidden h-3 w-3 shrink-0 text-[var(--ls-t4)] sm:block" />}
      </span>

      {horas > 0 ? (
        <span className="relative self-end text-[14px] font-semibold leading-none tracking-[-0.02em] text-[var(--ls-t1)] tabular-nums sm:text-[17px] lg:text-[20px]">
          {formatoHoras(horas)}
          <span className="ml-px text-[10px] font-medium text-[var(--ls-t4)] sm:text-[11px]">h</span>
        </span>
      ) : (
        !futuro &&
        !soloMirando && (
          <span aria-hidden className="relative self-end opacity-30 transition-opacity group-hover:opacity-100 [@media(pointer:coarse)]:opacity-40">
            <Plus className="h-3.5 w-3.5 text-[var(--ls-t3)]" />
          </span>
        )
      )}
    </button>
  )
})

/**
 * EL CALENDARIO DEL CICLO, del 15 al 14, en 7 columnas.
 *
 * Cada casilla se llena desde abajo según las horas (a 8 h, llena), hoy lleva un anillo, los fines de semana van en otro
 * tono y los días futuros salen apagados con un candado: se pueden apuntar, pero pidiendo confirmación (lo decide
 * `onPulsarDia`). `envolver` deja meter cada casilla en el popover del editor en el PC.
 */
export function CalendarioCiclo({
  dias,
  hoy,
  horasPorDia,
  diaAbierto,
  soloMirando,
  onPulsarDia,
  envolver,
  claveCiclo,
}: {
  dias: string[]
  hoy: string
  horasPorDia: Map<string, WorkHourEntry>
  diaAbierto: string | null
  soloMirando: boolean
  onPulsarDia: (clave: string) => void
  envolver?: (clave: string, casilla: ReactNode) => ReactNode
  claveCiclo: string
}) {
  const huecos = dias.length ? diaDeLaSemana(dias[0]) : 0
  return (
    <div>
      <div className="mb-1.5 grid grid-cols-7 gap-1 sm:gap-1.5" aria-hidden>
        {INICIALES_SEMANA.map((d, i) => (
          <div key={`${d}-${i}`} className={cn('text-center text-[11px] font-semibold uppercase tracking-wider', i >= 5 ? 'text-[var(--ls-t4)]' : 'text-[var(--ls-t3)]')}>
            {d}
          </div>
        ))}
      </div>
      {/* Una sola entrada suave por ciclo (no casilla a casilla) */}
      <div key={claveCiclo} className="ls-aparecer grid grid-cols-7 gap-1 sm:gap-1.5">
        {Array.from({ length: huecos }).map((_, i) => (
          <div key={`hueco-${i}`} aria-hidden />
        ))}
        {dias.map((clave) => {
          const fila = horasPorDia.get(clave)
          const casilla = (
            <Casilla
              key={clave}
              clave={clave}
              horas={Number(fila?.hours ?? 0)}
              nota={fila?.note ?? null}
              hoy={clave === hoy}
              futuro={clave > hoy}
              seleccionado={clave === diaAbierto}
              soloMirando={soloMirando}
              onPulsar={() => onPulsarDia(clave)}
            />
          )
          return envolver ? <span key={clave} className="contents">{envolver(clave, casilla)}</span> : casilla
        })}
      </div>
      <Leyenda />
    </div>
  )
}

function Leyenda() {
  const tramos = [
    { t: 0, texto: '0 h' },
    { t: 1, texto: 'menos de 4' },
    { t: 2, texto: '4 a 6' },
    { t: 3, texto: 'más de 6' },
  ]
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11.5px] text-[var(--ls-t4)]">
      {tramos.map(({ t, texto }) => (
        <span key={t} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="h-3 w-3 rounded-[4px] border border-[var(--ls-linea)]"
            style={{ background: t === 0 ? 'var(--ls-sup2)' : `color-mix(in srgb, var(--ls-acc-graf) ${OPACIDAD_TRAMO[t]}%, var(--ls-sup2))` }}
          />
          {texto}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <Lock aria-hidden className="h-3 w-3" /> futuro: pide confirmación
      </span>
    </div>
  )
}

export { Casilla }
