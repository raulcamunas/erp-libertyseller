'use client'

import { forwardRef, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Lock, Pencil, Plus } from 'lucide-react'
import { motion } from 'framer-motion'
import { Boton } from '@/components/ui-ls'
import { cn } from '@/lib/utils'
import { diaDeLaSemana, formatoHoras, semanasDelCiclo } from '@/lib/payroll/horas'
import type { WorkHourEntry } from '@/lib/types/payroll'
import { DIAS_LARGOS, diaYMes } from './fechas'
import { HORAS_LLENO, etiquetaDeDia } from './CalendarioCiclo'

interface FilaProps {
  clave: string
  horas: number
  nota: string | null
  hoy: boolean
  futuro: boolean
  abierto: boolean
  soloMirando: boolean
  onPulsar: () => void
}

/** Un día de la semana como fila: nombre, barra de horas, cifra y el lápiz. Ancla del popover en el PC. */
const FilaDia = forwardRef<HTMLButtonElement, FilaProps>(function FilaDia({ clave, horas, nota, hoy, futuro, abierto, soloMirando, onPulsar, ...resto }, ref) {
  const finde = diaDeLaSemana(clave) >= 5
  return (
    <button
      ref={ref}
      type="button"
      {...resto}
      onClick={soloMirando ? undefined : onPulsar}
      disabled={soloMirando}
      aria-label={etiquetaDeDia(clave, horas, futuro)}
      aria-current={hoy ? 'date' : undefined}
      aria-expanded={abierto || undefined}
      className={cn(
        'group flex min-h-[56px] w-full items-center gap-3 rounded-[12px] border px-3 py-2 text-left outline-none transition-colors',
        'focus-visible:ring-2 focus-visible:ring-[var(--ls-acc-graf)]',
        abierto ? 'border-[var(--ls-acc-graf)] bg-[color-mix(in_srgb,var(--ls-acc-graf)_8%,var(--ls-sup2))]' : 'border-[var(--ls-linea)] bg-[var(--ls-sup2)] hover:border-[var(--ls-linea2)]',
        hoy && !abierto && 'border-[color-mix(in_srgb,var(--ls-acc-graf)_55%,var(--ls-linea))]',
        futuro && 'opacity-50',
        finde && !hoy && 'bg-[color-mix(in_srgb,var(--ls-sup2)_50%,transparent)]',
      )}
    >
      <div className="w-[92px] shrink-0">
        <p className={cn('text-[13px] font-semibold', hoy ? 'text-[var(--ls-acc-graf)]' : 'text-[var(--ls-t1)]')}>{hoy ? 'Hoy' : DIAS_LARGOS[diaDeLaSemana(clave)]}</p>
        <p className="text-[12px] text-[var(--ls-t4)]">{diaYMes(clave)}</p>
      </div>
      <div className="min-w-0 flex-1">
        <div className="relative h-2 overflow-hidden rounded-full bg-[var(--ls-sup3)]">
          <motion.div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{ background: 'linear-gradient(90deg, color-mix(in srgb, var(--ls-acc-graf) 55%, transparent), var(--ls-acc-graf))' }}
            initial={{ width: 0 }}
            animate={{ width: `${Math.min(1, horas / HORAS_LLENO) * 100}%` }}
            transition={{ duration: 0.5, ease: [0.2, 0.7, 0.2, 1] }}
          />
        </div>
        {nota && <p className="mt-1 truncate text-[12px] text-[var(--ls-t3)]">{nota}</p>}
      </div>
      <span className="w-[52px] shrink-0 text-right text-[16px] font-semibold tabular-nums text-[var(--ls-t1)]">
        {horas > 0 ? (
          <>
            {formatoHoras(horas)}
            <span className="ml-px text-[11px] font-medium text-[var(--ls-t4)]">h</span>
          </>
        ) : (
          <span className="text-[13px] font-normal text-[var(--ls-t4)]">—</span>
        )}
      </span>
      {!soloMirando && (
        <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] text-[var(--ls-t3)] transition-colors group-hover:bg-[var(--ls-sup3)] group-hover:text-[var(--ls-t1)]">
          {futuro ? <Lock className="h-3.5 w-3.5" /> : horas > 0 ? <Pencil className="h-3.5 w-3.5" /> : <Plus className="h-4 w-4" />}
        </span>
      )}
    </button>
  )
})

/**
 * LA SEMANA COMO LISTA: la vista alternativa al calendario, cómoda en el móvil (una fila de 56 px por día en vez de
 * casillas de 40). Empieza en la semana de hoy y se mueve con las flechas por las semanas del ciclo.
 */
export function ListaSemana({
  dias,
  hoy,
  horasPorDia,
  diaAbierto,
  soloMirando,
  onPulsarDia,
  envolver,
}: {
  dias: string[]
  hoy: string
  horasPorDia: Map<string, WorkHourEntry>
  diaAbierto: string | null
  soloMirando: boolean
  onPulsarDia: (clave: string) => void
  envolver?: (clave: string, fila: ReactNode) => ReactNode
}) {
  const semanas = useMemo(() => semanasDelCiclo(dias), [dias])
  const deHoy = useMemo(() => {
    const i = semanas.findIndex((s) => s.includes(hoy))
    if (i >= 0) return i
    // Ciclo pasado: la última semana; ciclo futuro: la primera
    return dias.length && dias[0] > hoy ? 0 : Math.max(0, semanas.length - 1)
  }, [semanas, hoy, dias])
  const [semana, setSemana] = useState(deHoy)
  useEffect(() => setSemana(deHoy), [deHoy])

  const actual = semanas[semana] ?? []
  const totalSemana = actual.reduce((s, d) => s + Number(horasPorDia.get(d)?.hours ?? 0), 0)

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Boton variante="fantasma" tamano="sm" soloIcono icono={ChevronLeft} aria-label="Semana anterior" disabled={semana <= 0} onClick={() => setSemana((s) => s - 1)} />
        <div className="min-w-0 flex-1 text-center">
          <p className="text-[13px] font-semibold text-[var(--ls-t1)]">
            Semana {semana + 1} de {semanas.length}
          </p>
          {actual.length > 0 && (
            <p className="text-[12px] text-[var(--ls-t4)]">
              {diaYMes(actual[0])} – {diaYMes(actual[actual.length - 1])} · {formatoHoras(totalSemana)} h
            </p>
          )}
        </div>
        <Boton variante="fantasma" tamano="sm" soloIcono icono={ChevronRight} aria-label="Semana siguiente" disabled={semana >= semanas.length - 1} onClick={() => setSemana((s) => s + 1)} />
      </div>
      <div key={semana} className="ls-aparecer space-y-1.5">
        {actual.map((clave) => {
          const fila = horasPorDia.get(clave)
          const el = (
            <FilaDia
              key={clave}
              clave={clave}
              horas={Number(fila?.hours ?? 0)}
              nota={fila?.note ?? null}
              hoy={clave === hoy}
              futuro={clave > hoy}
              abierto={clave === diaAbierto}
              soloMirando={soloMirando}
              onPulsar={() => onPulsarDia(clave)}
            />
          )
          return envolver ? <div key={clave}>{envolver(clave, el)}</div> : el
        })}
      </div>
    </div>
  )
}
