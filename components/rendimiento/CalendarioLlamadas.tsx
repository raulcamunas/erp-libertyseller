'use client'

import { CalendarDays, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { etiquetaDeDia, etiquetaDeMes, sumarDias } from '@/lib/rendimiento/dia'
import { intensidad, type MesDeLlamadas } from '@/lib/rendimiento/metricas'
import { etiquetaDeRango, lunesDe } from '@/lib/rendimiento/periodos'
import { Numero, PANEL } from './ui'

/**
 * EL CALENDARIO DEL MES: un día por casilla, más oscura cuantas más llamadas hechas, y un clic en un día
 * abre sus llamadas al lado.
 *
 * Es un calendario de LLAMADAS HECHAS (las salientes), que es lo que se cuenta como trabajo. Las recibidas
 * y el resto de cifras están en el panel del día.
 *
 * A LA DERECHA DE CADA SEMANA va su total («Sem.»): de un vistazo se ve qué semanas fueron fuertes, y pulsarlo abre
 * esa semana entera en el panel.
 *
 * EN PANTALLAS ANCHAS LLENA LA ALTURA QUE LE DAN: el panel le pone al lado la lista de llamadas del día y las dos
 * tienen que medir lo mismo, así que las filas de semanas se reparten el alto sobrante (un mes de cinco semanas queda
 * con las casillas más altas que uno de seis, y la tarjeta no cambia de tamaño al pasar de mes).
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
  /** Pulsar el total de una semana: pasar a mirarla entera. Sin esto, el total no se puede pulsar */
  onSemana?: (lunes: string) => void
}

const SEMANA = ['L', 'M', 'X', 'J', 'V', 'S', 'D']

/** Cuánto naranja lleva cada nivel de intensidad, en tanto por ciento sobre la superficie */
const NARANJA_POR_NIVEL: Record<0 | 1 | 2 | 3 | 4, number> = { 0: 0, 1: 9, 2: 18, 3: 30, 4: 46 }

const COLUMNAS = 'grid-cols-[repeat(7,minmax(0,1fr))_minmax(38px,auto)]'

const numero = (n: number) => n.toLocaleString('es-ES')

export function CalendarioLlamadas({ anio, mes, datos, dia, resaltado, hoy, cargando, sinRinkel, onDia, onMes, onHoy, onSemana }: Props) {
  const total = datos.total
  const esMesActual = hoy.startsWith(`${anio}-${String(mes).padStart(2, '0')}`)

  // Las semanas del mes, de siete casillas cada una (con huecos al principio y al final)
  const casillas = [...Array.from({ length: datos.huecos }, () => null), ...datos.celdas]
  while (casillas.length % 7 !== 0) casillas.push(null)
  const semanas = Array.from({ length: casillas.length / 7 }, (_, i) => casillas.slice(i * 7, i * 7 + 7))

  return (
    <div className={`${PANEL} rend-aparece flex h-full flex-col p-3`}>
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-1 py-0.5">
          <button
            type="button"
            onClick={() => onMes(-1)}
            aria-label="Mes anterior"
            className="flex h-6 w-6 items-center justify-center rounded-[6px] text-[var(--ls-t3)] transition-colors hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span key={`${anio}-${mes}`} className="rend-desliza flex items-center gap-1.5 whitespace-nowrap px-1.5 text-[12.5px] font-semibold capitalize text-[var(--ls-t1)]">
            <CalendarDays className="h-3.5 w-3.5 text-[var(--ls-acc)]" />
            {etiquetaDeMes(anio, mes)}
          </span>
          <button
            type="button"
            onClick={() => onMes(1)}
            aria-label="Mes siguiente"
            className="flex h-6 w-6 items-center justify-center rounded-[6px] text-[var(--ls-t3)] transition-colors hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          {!esMesActual && (
            <button type="button" onClick={onHoy} className="rounded-[6px] px-2 text-[11.5px] text-[var(--ls-t3)] transition-colors hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]">
              Hoy
            </button>
          )}
        </div>

        <p className="flex items-center gap-2 text-[12px] text-[var(--ls-t4)]">
          {cargando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {sinRinkel ? (
            'Sin Rinkel vinculado'
          ) : (
            <span>
              <span className="font-semibold tabular-nums text-[var(--ls-t1)]">
                <Numero valor={total.realizadas} formato={numero} />
              </span>{' '}
              llamadas hechas ·{' '}
              <span className="tabular-nums text-[var(--ls-t2)]">
                <Numero valor={total.contestadas} formato={numero} />
              </span>{' '}
              contestadas
              {total.intentos > total.realizadas && (
                <>
                  {' '}
                  · <span className="tabular-nums">{numero(total.intentos)}</span> intentos
                </>
              )}
            </span>
          )}
        </p>
      </div>

      <div className={`mb-1 grid ${COLUMNAS} gap-1.5`}>
        {SEMANA.map((l) => (
          <div key={l} className="text-center text-[10.5px] font-medium text-[var(--ls-t4)]">
            {l}
          </div>
        ))}
        <div className="text-center text-[10.5px] font-medium text-[var(--ls-t4)]" title="Llamadas hechas en la semana (solo los días de este mes)">
          Sem.
        </div>
      </div>

      <div key={`${anio}-${mes}`} className={`rend-aparece flex min-h-0 flex-1 flex-col gap-1.5 transition-opacity ${cargando ? 'opacity-50' : ''}`}>
        {semanas.map((fila, f) => {
          const primera = fila.find((c) => c !== null)
          const suma = fila.reduce((s, c) => s + (c ? c.resumen.realizadas : 0), 0)
          const lunes = primera ? lunesDe(primera.dia) : null
          const domingo = lunes ? sumarDias(lunes, 6) : null
          const futura = lunes !== null && lunes > hoy
          return (
            <div key={f} className={`grid min-h-[52px] flex-1 ${COLUMNAS} gap-1.5`}>
              {fila.map((celda, c) => {
                if (!celda) return <div key={`hueco-${f}-${c}`} />
                const { dia: d, resumen } = celda
                const numeroDeDia = Number(d.slice(8))
                const esHoy = d === hoy
                const seleccionado = d === dia
                const futuro = d > hoy
                const enElPeriodo = resaltado !== undefined && resaltado.desde !== resaltado.hasta && d >= resaltado.desde && d <= resaltado.hasta
                const nivel = intensidad(resumen.realizadas, datos.maximoRealizadas)
                const etiqueta = `${etiquetaDeDia(d)}: ${resumen.realizadas === 0 ? 'sin llamadas hechas' : `${resumen.realizadas} llamadas hechas, ${resumen.contestadas} contestadas`}`

                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => onDia(d)}
                    disabled={futuro}
                    aria-label={etiqueta}
                    aria-pressed={seleccionado}
                    title={etiqueta}
                    className={`group relative flex min-h-[52px] flex-col items-start justify-between rounded-[8px] border p-1.5 text-left transition-[border-color,box-shadow,background-color] duration-150 disabled:cursor-default ${
                      seleccionado
                        ? 'border-[var(--ls-acc-graf)] shadow-[0_0_0_1px_var(--ls-acc-graf)]'
                        : enElPeriodo
                          ? 'border-[var(--ls-t4)] hover:border-[var(--ls-acc-graf)]'
                          : nivel > 0
                            ? 'border-[color-mix(in_srgb,var(--ls-acc-graf)_22%,transparent)] hover:border-[var(--ls-acc-graf)]'
                            : 'border-[var(--ls-linea)] hover:border-[var(--ls-linea2)]'
                    } ${futuro ? 'opacity-30' : ''}`}
                    style={nivel > 0 ? { background: `color-mix(in srgb, var(--ls-acc-graf) ${NARANJA_POR_NIVEL[nivel]}%, transparent)` } : undefined}
                  >
                    <span className={`text-[11px] leading-none tabular-nums ${esHoy ? 'font-bold text-[var(--ls-acc)]' : 'text-[var(--ls-t4)]'}`}>{numeroDeDia}</span>
                    {resumen.realizadas > 0 && <span className="self-end text-[16px] font-bold leading-none tabular-nums text-[var(--ls-t1)] sm:text-[18px]">{resumen.realizadas}</span>}
                    {esHoy && <span className="rend-latido absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[var(--ls-acc-graf)]" />}
                  </button>
                )
              })}

              {sinRinkel ? (
                <div className="rounded-[8px] bg-[var(--ls-sup2)]" />
              ) : onSemana && lunes && domingo && !futura ? (
                <button
                  type="button"
                  onClick={() => onSemana(lunes)}
                  title={`Ver la semana del ${etiquetaDeRango({ desde: lunes, hasta: domingo })}: ${numero(suma)} ${suma === 1 ? 'llamada hecha' : 'llamadas hechas'} este mes`}
                  aria-label={`Ver la semana del ${etiquetaDeRango({ desde: lunes, hasta: domingo })}`}
                  className="flex flex-col items-center justify-center rounded-[8px] border border-transparent bg-[var(--ls-sup2)] px-1 text-[var(--ls-t3)] transition-colors hover:border-[var(--ls-acc-graf)] hover:text-[var(--ls-t1)]"
                >
                  <span className={`text-[13px] font-semibold tabular-nums ${suma > 0 ? 'text-[var(--ls-t2)]' : 'text-[var(--ls-t4)]'}`}>{numero(suma)}</span>
                </button>
              ) : (
                <div className="flex items-center justify-center rounded-[8px] bg-[var(--ls-sup2)] text-[13px] font-semibold tabular-nums text-[var(--ls-t4)]">{futura ? '' : numero(suma)}</div>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-3 text-[10.5px] text-[var(--ls-t4)]">
        <span>Cada casilla son los clientes a los que se llamó ese día (uno cuenta una vez). «Sem.» suma la semana.</span>
        <span className="flex shrink-0 items-center gap-1">
          Menos
          {([1, 2, 3, 4] as const).map((n) => (
            <span key={n} className="h-2.5 w-2.5 rounded-[3px] border border-[color-mix(in_srgb,var(--ls-acc-graf)_25%,transparent)]" style={{ background: `color-mix(in srgb, var(--ls-acc-graf) ${NARANJA_POR_NIVEL[n]}%, transparent)` }} />
          ))}
          Más
        </span>
      </div>
    </div>
  )
}
