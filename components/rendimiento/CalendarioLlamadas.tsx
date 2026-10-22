'use client'

import { CalendarDays, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { etiquetaDeDia, etiquetaDeMes } from '@/lib/rendimiento/dia'
import { intensidad, type MesDeLlamadas } from '@/lib/rendimiento/metricas'

/**
 * EL CALENDARIO DEL MES: un día por casilla, más oscura cuantas más llamadas hechas, y un clic en un día
 * abre sus llamadas al lado.
 *
 * Es un calendario de LLAMADAS HECHAS (las salientes), que es lo que se cuenta como trabajo. Las recibidas
 * y el resto de cifras están en el panel del día.
 */

interface Props {
  anio: number
  mes: number
  datos: MesDeLlamadas
  /** Día seleccionado, «2026-10-21» */
  dia: string
  /** Los días del periodo que se está mirando (una semana, un mes): se marcan con un contorno suave */
  resaltado?: { desde: string; hasta: string }
  hoy: string
  cargando: boolean
  /** Sin cuenta de Rinkel vinculada no hay nada que pintar: se avisa en vez de enseñar un mes vacío */
  sinRinkel: boolean
  onDia: (dia: string) => void
  onMes: (delta: number) => void
  onHoy: () => void
}

const SEMANA = ['L', 'M', 'X', 'J', 'V', 'S', 'D']

const FONDO_POR_INTENSIDAD: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: '',
  1: 'bg-[#FF6600]/[0.07]',
  2: 'bg-[#FF6600]/[0.15]',
  3: 'bg-[#FF6600]/[0.26]',
  4: 'bg-[#FF6600]/[0.40]',
}

const numero = (n: number) => n.toLocaleString('es-ES')

export function CalendarioLlamadas({ anio, mes, datos, dia, resaltado, hoy, cargando, sinRinkel, onDia, onMes, onHoy }: Props) {
  const total = datos.total
  const esMesActual = hoy.startsWith(`${anio}-${String(mes).padStart(2, '0')}`)

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3 sm:p-4 flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-1.5 py-1">
          <button
            type="button"
            onClick={() => onMes(-1)}
            aria-label="Mes anterior"
            className="h-7 w-7 flex items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-[13px] font-semibold text-white px-1.5 flex items-center gap-1.5 whitespace-nowrap capitalize">
            <CalendarDays className="h-3.5 w-3.5 text-[#FF6600]" />
            {etiquetaDeMes(anio, mes)}
          </span>
          <button
            type="button"
            onClick={() => onMes(1)}
            aria-label="Mes siguiente"
            className="h-7 w-7 flex items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          {!esMesActual && (
            <button type="button" onClick={onHoy} className="text-[11px] text-white/40 hover:text-white px-2 transition-colors">
              Hoy
            </button>
          )}
        </div>

        <p className="text-[12px] text-white/45 flex items-center gap-2">
          {cargando && <Loader2 className="h-3.5 w-3.5 animate-spin text-white/40" />}
          {sinRinkel ? (
            'Sin Rinkel vinculado'
          ) : (
            <span>
              <span className="text-white font-semibold tabular-nums">{numero(total.realizadas)}</span> llamadas hechas ·{' '}
              <span className="text-white/70 tabular-nums">{numero(total.contestadas)}</span> contestadas
            </span>
          )}
        </p>
      </div>

      <div className="grid grid-cols-7 gap-1.5 mb-1.5">
        {SEMANA.map((l) => (
          <div key={l} className="text-center text-[10px] font-medium uppercase tracking-wider text-white/30">
            {l}
          </div>
        ))}
      </div>

      <div className={`grid grid-cols-7 gap-1.5 transition-opacity ${cargando ? 'opacity-50' : ''}`}>
        {Array.from({ length: datos.huecos }).map((_, i) => (
          <div key={`hueco-${i}`} />
        ))}
        {datos.celdas.map(({ dia: d, resumen }) => {
          const numeroDeDia = Number(d.slice(8))
          const esHoy = d === hoy
          const seleccionado = d === dia
          const futuro = d > hoy
          const enElPeriodo = resaltado !== undefined && resaltado.desde !== resaltado.hasta && d >= resaltado.desde && d <= resaltado.hasta
          const nivel = intensidad(resumen.realizadas, datos.maximoRealizadas)
          const etiqueta = `${etiquetaDeDia(d)}: ${
            resumen.realizadas === 0 ? 'sin llamadas hechas' : `${resumen.realizadas} llamadas hechas, ${resumen.contestadas} contestadas`
          }`

          return (
            <button
              key={d}
              type="button"
              onClick={() => onDia(d)}
              disabled={futuro}
              aria-label={etiqueta}
              aria-pressed={seleccionado}
              title={etiqueta}
              className={`group relative aspect-square sm:aspect-auto sm:min-h-[62px] rounded-xl border flex flex-col items-start justify-between p-1.5 sm:p-2 transition-colors disabled:cursor-default ${
                seleccionado
                  ? 'border-[#FF6600] ring-1 ring-[#FF6600]/60'
                  : enElPeriodo
                    ? 'border-white/40 ring-1 ring-white/15 hover:border-[#FF6600]/55'
                    : nivel > 0
                      ? 'border-[#FF6600]/20 hover:border-[#FF6600]/55'
                      : 'border-white/[0.07] hover:border-white/20'
              } ${FONDO_POR_INTENSIDAD[nivel]} ${futuro ? 'opacity-30' : ''}`}
            >
              <span className={`text-[12px] sm:text-[13px] leading-none ${esHoy ? 'text-[#FF6600] font-bold' : 'text-white/50'}`}>
                {numeroDeDia}
              </span>
              {resumen.realizadas > 0 && (
                <span className="self-end text-[16px] sm:text-[20px] font-bold text-white leading-none tabular-nums">{resumen.realizadas}</span>
              )}
              {esHoy && <span className="absolute top-1.5 right-1.5 sm:top-2 sm:right-2 h-1.5 w-1.5 rounded-full bg-[#FF6600]" />}
            </button>
          )
        })}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 text-[10px] text-white/30">
        <span>Cada casilla es el número de llamadas hechas ese día.</span>
        <span className="flex items-center gap-1 shrink-0">
          Menos
          {([1, 2, 3, 4] as const).map((n) => (
            <span key={n} className={`h-2.5 w-2.5 rounded-[3px] border border-[#FF6600]/20 ${FONDO_POR_INTENSIDAD[n]}`} />
          ))}
          Más
        </span>
      </div>
    </div>
  )
}
