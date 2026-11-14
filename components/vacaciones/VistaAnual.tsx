'use client'

import { useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { MONTHS_LONG } from '@/lib/types/employees'
import { isWeekend, monthDayKeys, weekdayIndex, WEEKDAYS_SHORT } from '@/lib/types/vacations'
import type { DiaOcupado } from '@/lib/vacations/calendario'
import { mezcla, TACTIL_CUADRADO } from '@/components/ui-ls'
import { cn } from '@/lib/utils'
import { RAYADO } from './modelo'

/**
 * EL AÑO DE UN VISTAZO: doce meses pequeños. Cada día laborable se tiñe según cuánta gente está fuera (más intenso =
 * más gente), con el color de la persona si es solo una, los tuyos con un anillo, los festivos con un punto ámbar y
 * los días con el cupo lleno en rayado. Pulsar un mes abre la vista del mes.
 *
 * 365 casillas: NO se animan una a una (solo aparece el bloque entero).
 */
export function VistaAnual({
  anio,
  onAnio,
  hoy,
  ocupacion,
  festivos,
  yoId,
  onAbrirMes,
}: {
  anio: number
  onAnio: (anio: number) => void
  hoy: string
  ocupacion: Map<string, DiaOcupado>
  festivos: Map<string, { nombre: string; descuenta: boolean }>
  yoId: string | null
  onAbrirMes: (mes: string) => void
}) {
  const meses = useMemo(() => Array.from({ length: 12 }, (_, i) => `${anio}-${String(i + 1).padStart(2, '0')}-01`), [anio])

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => onAnio(anio - 1)} aria-label="Año anterior" className={cn('flex h-9 w-9 items-center justify-center rounded-[10px] text-[var(--ls-t3)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]', TACTIL_CUADRADO)}>
          <ChevronLeft className="h-[18px] w-[18px]" />
        </button>
        <h3 className="min-w-[4.5rem] text-center text-[16px] font-semibold tabular-nums text-[var(--ls-t1)]">{anio}</h3>
        <button type="button" onClick={() => onAnio(anio + 1)} aria-label="Año siguiente" className={cn('flex h-9 w-9 items-center justify-center rounded-[10px] text-[var(--ls-t3)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]', TACTIL_CUADRADO)}>
          <ChevronRight className="h-[18px] w-[18px]" />
        </button>
      </div>

      <div className="ls-aparecer grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {meses.map((mes, i) => {
          const dias = monthDayKeys(mes)
          const huecos = weekdayIndex(dias[0])
          const fuera = new Set<string>()
          for (const d of dias) for (const p of ocupacion.get(d)?.personas ?? []) fuera.add(p.employee_id)
          return (
            <button
              key={mes}
              type="button"
              onClick={() => onAbrirMes(mes)}
              className="ls-elevar group rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-2.5 text-left shadow-[var(--ls-sombra-1)] outline-none hover:border-[var(--ls-linea2)] focus-visible:ring-2 focus-visible:ring-[var(--ls-acc-graf)]"
              aria-label={`Abrir ${MONTHS_LONG[i]} de ${anio}${fuera.size ? `: ${fuera.size} ${fuera.size === 1 ? 'persona fuera' : 'personas fuera'}` : ''}`}
            >
              <span className="mb-1.5 flex items-center justify-between gap-2">
                <span className="text-[13px] font-semibold capitalize text-[var(--ls-t1)]">{MONTHS_LONG[i]}</span>
                {fuera.size > 0 && <span className="rounded-full bg-[var(--ls-sup3)] px-1.5 text-[10.5px] font-semibold tabular-nums text-[var(--ls-t2)]">{fuera.size}</span>}
              </span>
              <span className="grid grid-cols-7 gap-[2px]" aria-hidden>
                {WEEKDAYS_SHORT.map((d, j) => (
                  <span key={`c${j}`} className="text-center text-[8.5px] font-semibold text-[var(--ls-t4)]">{d}</span>
                ))}
                {Array.from({ length: huecos }).map((_, j) => <span key={`h${j}`} />)}
                {dias.map((d) => {
                  const o = ocupacion.get(d)
                  const n = o?.personas.length ?? 0
                  const mio = o?.personas.some((p) => p.employee_id === yoId)
                  const unico = n === 1 ? o!.personas[0] : null
                  const f = festivos.get(d)
                  const fondo = isWeekend(d)
                    ? undefined
                    : unico
                      ? mezcla(unico.color, unico.status === 'aprobada' ? 70 : 30)
                      : n > 1
                        ? mezcla('var(--ls-mod-personas)', Math.min(95, 45 + n * 15))
                        : undefined
                  return (
                    <span
                      key={d}
                      className={cn(
                        'relative flex aspect-square items-center justify-center rounded-[4px] text-[9px] tabular-nums',
                        isWeekend(d) ? 'text-[var(--ls-t4)] opacity-40' : 'bg-[var(--ls-sup2)] text-[var(--ls-t3)]',
                        n > 0 && 'font-semibold text-white',
                        d === hoy && 'ring-1 ring-[var(--ls-acc-graf)]',
                        mio && 'ring-1 ring-[var(--ls-t1)]',
                      )}
                      style={{ backgroundColor: fondo, backgroundImage: o?.lleno && !mio && !isWeekend(d) ? RAYADO : undefined }}
                    >
                      {Number(d.slice(8))}
                      {f && <span className="absolute right-[1px] top-[1px] h-[3px] w-[3px] rounded-full" style={{ background: f.descuenta ? 'var(--ls-e-ambar)' : 'var(--ls-t4)' }} />}
                    </span>
                  )
                })}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
