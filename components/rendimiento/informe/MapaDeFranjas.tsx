'use client'

import { useMemo, type CSSProperties } from 'react'
import { franjasDestacadas, intensidadDeCelda, type DiaDeSemana, type MapaHorario } from '@/lib/rendimiento/informe'

/**
 * EN QUÉ HORAS SE LLAMA: UNA FILA POR DÍA, UNA COLUMNA POR HORA.
 *
 * Cada casilla son las llamadas HECHAS en esa hora de Madrid, más oscura cuanto más. Debajo, el total de cada hora y
 * una frase con la hora en la que más se llama y en la que más se contesta (solo entre horas con llamadas suficientes
 * para que el porcentaje diga algo). Un fin de semana sin llamadas no ocupa fila. Las filas entran una tras otra.
 */

/** Cuánto naranja lleva cada nivel, en tanto por ciento sobre la superficie */
const NARANJA: readonly number[] = [0, 12, 26, 44, 70]

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

  if (mapa.total === 0) return <p className="py-4 text-[12px] text-[var(--ls-t4)]">No hay llamadas hechas esta semana.</p>

  const columnas = `${compacto ? 52 : 64}px repeat(${mapa.horas.length}, minmax(0, 1fr))`
  const alto = compacto ? 'h-6' : 'h-8'

  return (
    <div className="min-w-0 space-y-2.5">
      <div className="overflow-x-auto">
        <div className="min-w-[420px]" role="table" aria-label="Llamadas hechas por día y hora">
          <div className="mb-[3px] grid gap-[3px]" style={{ gridTemplateColumns: columnas }} role="row">
            <span />
            {mapa.horas.map((h) => (
              <span key={h} className="text-center text-[10.5px] tabular-nums text-[var(--ls-t4)]" role="columnheader">
                {hh(h)}
              </span>
            ))}
          </div>

          <div className="space-y-[3px]">
            {filas.map(({ f, d }, fila) => (
              <div key={f.dia} className="rend-entra grid items-center gap-[3px]" style={{ gridTemplateColumns: columnas, '--d': fila } as CSSProperties} role="row">
                <span className={`whitespace-nowrap text-[11px] ${d.esHoy ? 'font-semibold text-[var(--ls-acc)]' : d.finDeSemana ? 'text-[var(--ls-t4)]' : 'text-[var(--ls-t3)]'}`} role="rowheader">
                  {d.etiqueta}
                </span>
                {f.celdas.map((c, k) => {
                  const nivel = intensidadDeCelda(c.hechas, mapa.maximo)
                  return (
                    <span
                      key={k}
                      role="cell"
                      title={`${d.etiqueta} · de ${hh(mapa.horas[k])}:00 a ${hh(mapa.horas[k])}:59: ${c.hechas} ${c.hechas === 1 ? 'llamada hecha' : 'llamadas hechas'}, ${c.contestadas} ${c.contestadas === 1 ? 'contestada' : 'contestadas'}`}
                      className={`${alto} flex items-center justify-center rounded-[4px] text-[10.5px] tabular-nums transition-colors ${nivel === 4 ? 'font-semibold text-[var(--ls-t1)]' : 'text-[var(--ls-t3)]'} ${nivel === 0 ? 'bg-[var(--ls-sup2)]' : ''}`}
                      style={nivel > 0 ? { background: `color-mix(in srgb, var(--ls-acc-graf) ${NARANJA[nivel]}%, transparent)` } : undefined}
                    >
                      {c.hechas > 0 ? c.hechas : ''}
                    </span>
                  )
                })}
              </div>
            ))}

            <div className="grid items-center gap-[3px] border-t border-[var(--ls-linea)] pt-1" style={{ gridTemplateColumns: columnas }} role="row">
              <span className="text-[10.5px] text-[var(--ls-t4)]">Total</span>
              {totalesPorHora.map((n, k) => (
                <span key={k} className={`text-center text-[10.5px] tabular-nums ${n === pico && n > 0 ? 'font-semibold text-[var(--ls-acc)]' : 'text-[var(--ls-t4)]'}`}>
                  {n > 0 ? n : ''}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5">
        <p className="text-[12px] leading-snug text-[var(--ls-t3)]">
          {destacadas.masLlamadas && (
            <>
              Más llamadas entre las <span className="font-medium text-[var(--ls-t1)]">{hh(destacadas.masLlamadas.hora)}</span> y las <span className="font-medium text-[var(--ls-t1)]">{hh(destacadas.masLlamadas.hora + 1)}</span> ({destacadas.masLlamadas.hechas}).{' '}
            </>
          )}
          {destacadas.masContacto && (
            <>
              Se contesta más entre las <span className="font-medium text-[var(--ls-t1)]">{hh(destacadas.masContacto.hora)}</span> y las <span className="font-medium text-[var(--ls-t1)]">{hh(destacadas.masContacto.hora + 1)}</span>:{' '}
              {Math.round(destacadas.masContacto.tasa * 100)} % de {destacadas.masContacto.hechas} llamadas.
            </>
          )}
        </p>
        <p className="flex items-center gap-1.5 text-[10.5px] text-[var(--ls-t4)]">
          Menos
          {NARANJA.map((n, i) => (
            <span key={i} className="h-2.5 w-4 rounded-[3px] bg-[var(--ls-sup2)]" style={n > 0 ? { background: `color-mix(in srgb, var(--ls-acc-graf) ${n}%, transparent)` } : undefined} />
          ))}
          Más
        </p>
      </div>
    </div>
  )
}
