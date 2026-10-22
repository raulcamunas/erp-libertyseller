'use client'

import type { CSSProperties } from 'react'
import type { DiaDeSemana } from '@/lib/rendimiento/informe'

/**
 * LOS SIETE DÍAS DE LA SEMANA EN BARRAS, CADA UNO CONTRA EL MISMO DÍA DE LA ANTERIOR.
 *
 * Por cada día, dos barras juntas: la de la semana anterior, apagada, y la de esta semana, en naranja. Los días que
 * todavía no han llegado se dejan como un hueco punteado y no como un cero: no se ha hecho «nada», es que no ha llegado.
 * Todas las barras comparten la misma escala, la del valor mayor de las dos semanas. Crecen desde su base al aparecer
 * y se ajustan con suavidad si llegan otros datos.
 *
 * Lleva encima el valor de cada día y debajo su nombre. (Para barritas pequeñas dentro de una tarjeta, MiniBarras.)
 */

interface Props {
  dias: DiaDeSemana[]
  actual: ReadonlyArray<number | null>
  anterior: ReadonlyArray<number | null>
  formato: (n: number) => string
  /** Alto de la zona de barras, en píxeles */
  alto?: number
  /** Qué se dibuja, para el texto que leen los lectores de pantalla: «llamadas» */
  nombre: string
}

export function BarrasDeLaSemana({ dias, actual, anterior, formato, alto = 120, nombre }: Props) {
  const maximo = Math.max(1, ...actual.map((v) => v ?? 0), ...anterior.map((v) => v ?? 0))
  const px = (v: number | null) => (v === null || v <= 0 ? 0 : Math.max(2, Math.round((v / maximo) * alto)))
  const resumen = dias
    .map((d, i) => `${d.etiqueta}: ${actual[i] === null ? 'todavía no ha llegado' : formato(actual[i] as number)}${anterior[i] !== null ? `, la semana anterior ${formato(anterior[i] as number)}` : ''}`)
    .join('. ')

  return (
    <div role="img" aria-label={`${nombre}, día a día. ${resumen}`} className="flex w-full items-end gap-1 sm:gap-1.5">
      {dias.map((d, i) => {
        const v = actual[i]
        const antes = anterior[i]
        return (
          <div key={d.dia} className="flex min-w-0 flex-1 flex-col items-center" title={`${d.etiqueta}: ${v === null ? 'todavía no ha llegado' : formato(v)}${antes !== null ? ` · la semana anterior, ${formato(antes)}` : ''}`}>
            <span className={`mb-1 h-4 text-[11px] tabular-nums ${d.esHoy ? 'font-semibold text-[var(--ls-acc)]' : 'text-[var(--ls-t2)]'}`}>{v === null ? '' : formato(v)}</span>
            <div className="flex w-full items-end justify-center gap-[3px]" style={{ height: alto }}>
              <span className="block w-[40%] max-w-[18px] rounded-t-[3px] bg-[var(--ls-sup3)] transition-[height] duration-500" style={{ height: px(antes) }} />
              {v === null ? (
                <span className="block w-[40%] max-w-[18px] rounded-t-[3px] border border-dashed border-[var(--ls-linea2)]" style={{ height: 6 }} />
              ) : (
                <span
                  className="rend-crece-y block w-[40%] max-w-[18px] rounded-t-[3px] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--ls-acc-graf)_78%,white),var(--ls-acc-graf))] transition-[height] duration-500"
                  style={{ height: px(v), '--d': i } as CSSProperties}
                />
              )}
            </div>
            <span className={`mt-1.5 whitespace-nowrap text-[10.5px] ${d.esHoy ? 'font-semibold text-[var(--ls-acc)]' : 'text-[var(--ls-t4)]'}`}>{d.etiqueta}</span>
          </div>
        )
      })}
    </div>
  )
}

/** La leyenda de las dos barras */
export function LeyendaDeBarras({ semanaAnterior = 'Semana anterior' }: { semanaAnterior?: string }) {
  return (
    <p className="flex items-center gap-4 text-[11px] text-[var(--ls-t4)]">
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-[2px] bg-[var(--ls-acc-graf)]" /> Esta semana
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-[2px] bg-[var(--ls-sup3)]" /> {semanaAnterior}
      </span>
    </p>
  )
}
