'use client'

import { useMemo } from 'react'
import { franjasDestacadas, intensidadDeCelda, type DiaDeSemana, type MapaHorario } from '@/lib/rendimiento/informe'

/**
 * EN QUÉ HORAS SE LLAMA: UNA FILA POR DÍA, UNA COLUMNA POR HORA.
 *
 * Cada casilla son las llamadas HECHAS en esa hora de Madrid, más oscura cuanto más. Debajo, el total de cada hora y
 * una frase con la hora en la que más se llama y en la que más se contesta (solo entre horas con llamadas suficientes
 * para que el porcentaje diga algo). Un fin de semana sin llamadas no ocupa fila.
 */

const CALOR = ['bg-white/[0.03]', 'bg-[#FF6600]/[0.14]', 'bg-[#FF6600]/[0.28]', 'bg-[#FF6600]/[0.48]', 'bg-[#FF6600]/[0.75]'] as const

const hh = (h: number) => String(h).padStart(2, '0')

interface Props {
  mapa: MapaHorario
  dias: DiaDeSemana[]
  /** Casillas más bajas, para dentro de la tarjeta de una persona */
  compacto?: boolean
}

export function MapaDeFranjas({ mapa, dias, compacto = false }: Props) {
  const destacadas = useMemo(() => franjasDestacadas(mapa), [mapa])
  const filas = mapa.filas.map((f, i) => ({ f, d: dias[i] })).filter(({ f, d }) => !d.finDeSemana || f.total > 0)
  const totalesPorHora = mapa.horas.map((_, k) => mapa.filas.reduce((s, f) => s + f.celdas[k].hechas, 0))
  const pico = Math.max(...totalesPorHora)

  if (mapa.total === 0) return <p className="text-[12px] text-white/35 py-4">No hay llamadas hechas esta semana.</p>

  const columnas = `${compacto ? 52 : 64}px repeat(${mapa.horas.length}, minmax(0, 1fr))`
  const alto = compacto ? 'h-6' : 'h-8'

  return (
    <div className="space-y-2.5 min-w-0">
      <div className="overflow-x-auto">
        <div className="min-w-[420px]" role="table" aria-label="Llamadas hechas por día y hora">
          <div className="grid gap-[3px] mb-[3px]" style={{ gridTemplateColumns: columnas }} role="row">
            <span />
            {mapa.horas.map((h) => (
              <span key={h} className="text-center text-[10px] text-white/35 tabular-nums" role="columnheader">
                {hh(h)}
              </span>
            ))}
          </div>

          <div className="space-y-[3px]">
            {filas.map(({ f, d }) => (
              <div key={f.dia} className="grid gap-[3px] items-center" style={{ gridTemplateColumns: columnas }} role="row">
                <span className={`text-[11px] whitespace-nowrap ${d.esHoy ? 'text-[#FF8A3D] font-semibold' : d.finDeSemana ? 'text-white/30' : 'text-white/55'}`} role="rowheader">
                  {d.etiqueta}
                </span>
                {f.celdas.map((c, k) => {
                  const nivel = intensidadDeCelda(c.hechas, mapa.maximo)
                  return (
                    <span
                      key={k}
                      role="cell"
                      title={`${d.etiqueta} · de ${hh(mapa.horas[k])}:00 a ${hh(mapa.horas[k])}:59: ${c.hechas} ${c.hechas === 1 ? 'llamada hecha' : 'llamadas hechas'}, ${c.contestadas} ${c.contestadas === 1 ? 'contestada' : 'contestadas'}`}
                      className={`${alto} rounded-[4px] flex items-center justify-center text-[10px] tabular-nums ${CALOR[nivel]} ${nivel === 4 ? 'text-white font-semibold' : 'text-white/60'}`}
                    >
                      {c.hechas > 0 ? c.hechas : ''}
                    </span>
                  )
                })}
              </div>
            ))}

            <div className="grid gap-[3px] items-center pt-1 border-t border-white/[0.06]" style={{ gridTemplateColumns: columnas }} role="row">
              <span className="text-[10px] uppercase tracking-[0.1em] text-white/35">Total</span>
              {totalesPorHora.map((n, k) => (
                <span key={k} className={`text-center text-[10px] tabular-nums ${n === pico && n > 0 ? 'text-[#FF8A3D] font-semibold' : 'text-white/40'}`}>
                  {n > 0 ? n : ''}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5">
        <p className="text-[12px] text-white/55 leading-snug">
          {destacadas.masLlamadas && (
            <>
              Más llamadas entre las <span className="text-white/85 font-medium">{hh(destacadas.masLlamadas.hora)}</span> y las <span className="text-white/85 font-medium">{hh(destacadas.masLlamadas.hora + 1)}</span> ({destacadas.masLlamadas.hechas}).{' '}
            </>
          )}
          {destacadas.masContacto && (
            <>
              Se contesta más entre las <span className="text-white/85 font-medium">{hh(destacadas.masContacto.hora)}</span> y las <span className="text-white/85 font-medium">{hh(destacadas.masContacto.hora + 1)}</span>:{' '}
              {Math.round(destacadas.masContacto.tasa * 100)} % de {destacadas.masContacto.hechas} llamadas.
            </>
          )}
        </p>
        <p className="flex items-center gap-1.5 text-[10px] text-white/30">
          Menos
          {CALOR.map((c, i) => (
            <span key={i} className={`h-2.5 w-4 rounded-[3px] ${c}`} />
          ))}
          Más
        </p>
      </div>
    </div>
  )
}
