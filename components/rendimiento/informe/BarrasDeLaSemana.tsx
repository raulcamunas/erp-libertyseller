'use client'

import type { DiaDeSemana } from '@/lib/rendimiento/informe'

/**
 * LOS SIETE DÍAS DE LA SEMANA EN BARRAS, CADA UNO CONTRA EL MISMO DÍA DE LA ANTERIOR.
 *
 * Por cada día, dos barras juntas: la de la semana anterior, apagada, y la de esta semana, en naranja. Los días que
 * todavía no han llegado se dejan como un hueco punteado y no como un cero: no se ha hecho «nada», es que no ha llegado.
 * Todas las barras comparten la misma escala, la del valor mayor de las dos semanas.
 *
 * En su forma compacta son solo las barras (para dentro de una cifra pequeña); en la normal llevan encima el valor de
 * cada día y debajo su nombre.
 */

interface Props {
  dias: DiaDeSemana[]
  actual: ReadonlyArray<number | null>
  anterior: ReadonlyArray<number | null>
  formato: (n: number) => string
  /** Alto de la zona de barras, en píxeles */
  alto?: number
  compacto?: boolean
  /** Qué se dibuja, para el texto que leen los lectores de pantalla: «llamadas» */
  nombre: string
}

export function BarrasDeLaSemana({ dias, actual, anterior, formato, alto = 120, compacto = false, nombre }: Props) {
  const maximo = Math.max(1, ...actual.map((v) => v ?? 0), ...anterior.map((v) => v ?? 0))
  const px = (v: number | null) => (v === null || v <= 0 ? 0 : Math.max(2, Math.round((v / maximo) * alto)))
  const resumen = dias
    .map((d, i) => `${d.etiqueta}: ${actual[i] === null ? 'todavía no ha llegado' : formato(actual[i] as number)}${anterior[i] !== null ? `, la semana anterior ${formato(anterior[i] as number)}` : ''}`)
    .join('. ')

  return (
    <div role="img" aria-label={`${nombre}, día a día. ${resumen}`} className="flex items-end gap-1 sm:gap-1.5 w-full">
      {dias.map((d, i) => {
        const v = actual[i]
        const antes = anterior[i]
        return (
          <div key={d.dia} className="flex-1 min-w-0 flex flex-col items-center" title={`${d.etiqueta}: ${v === null ? 'todavía no ha llegado' : formato(v)}${antes !== null ? ` · la semana anterior, ${formato(antes)}` : ''}`}>
            {!compacto && <span className={`mb-1 h-4 text-[11px] tabular-nums ${d.esHoy ? 'text-[#FF8A3D] font-semibold' : 'text-white/75'}`}>{v === null ? '' : formato(v)}</span>}
            <div className="flex items-end justify-center gap-[3px] w-full" style={{ height: alto }}>
              <span className="w-[40%] max-w-[18px] rounded-t-[3px] bg-white/[0.14]" style={{ height: px(antes) }} />
              {v === null ? (
                <span className="w-[40%] max-w-[18px] rounded-t-[3px] border border-dashed border-white/15" style={{ height: 6 }} />
              ) : (
                <span className="w-[40%] max-w-[18px] rounded-t-[3px] bg-[#FF6600]" style={{ height: px(v) }} />
              )}
            </div>
            {!compacto && (
              <span className={`mt-1.5 text-[10px] whitespace-nowrap ${d.esHoy ? 'text-[#FF8A3D] font-semibold' : d.finDeSemana ? 'text-white/25' : 'text-white/45'}`}>{d.etiqueta}</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** La leyenda de las dos barras */
export function LeyendaDeBarras({ semanaAnterior = 'Semana anterior' }: { semanaAnterior?: string }) {
  return (
    <p className="flex items-center gap-4 text-[11px] text-white/40">
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-[2px] bg-[#FF6600]" /> Esta semana
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-[2px] bg-white/[0.14]" /> {semanaAnterior}
      </span>
    </p>
  )
}
