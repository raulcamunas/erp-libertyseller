'use client'

import { CalendarRange } from 'lucide-react'
import { useMemo, useState, type CSSProperties } from 'react'
import { METRICAS, formatoDe, intensidadDeCelda, matrizDiaria, type DiaDeSemana, type Metrica, type ResultadoSemanal, type Semana } from '@/lib/rendimiento/informe'
import { CabeceraDePanel, ChipDeFiltro, Delta, PANEL } from '../ui'
import { BarrasDeLaSemana, LeyendaDeBarras } from './BarrasDeLaSemana'

/**
 * DÍA A DÍA Y PERSONA A PERSONA: LA TABLA CENTRAL DEL INFORME.
 *
 * Una fila por comercial y una columna por día, de la cifra que se elija arriba. Cada casilla se pinta más oscura
 * cuanto más es, y debajo del número, pequeño, va el del mismo día de la semana anterior: de un vistazo se ve quién
 * ha subido, quién ha bajado y qué día se cayó. Pulsar a una persona, o una casilla, abre su detalle más abajo.
 *
 * Los sábados y domingos solo salen si alguien trabajó (esta semana o la anterior).
 */

/** Cuánto naranja lleva cada nivel de intensidad, en tanto por ciento sobre la superficie */
const NARANJA: readonly number[] = [0, 12, 26, 44, 70]

interface Props {
  semana: Semana
  dias: DiaDeSemana[]
  resultados: ResultadoSemanal[]
  metrica: Metrica
  onMetrica: (m: Metrica) => void
  /** Con qué se compara, para el texto que sale al pasar el ratón por el cambio */
  contra: string
  onAbrirPersona: (id: string, dia?: string) => void
}

export function MatrizDeLaSemana({ semana, dias, resultados, metrica, onMetrica, contra, onAbrirPersona }: Props) {
  const [verAnterior, setVerAnterior] = useState(true)
  const matriz = useMemo(() => matrizDiaria(resultados, semana, metrica), [resultados, semana, metrica])
  const info = METRICAS.find((m) => m.id === metrica) ?? METRICAS[0]
  const formato = (n: number) => formatoDe(metrica, n)

  const hayFinDeSemana = matriz.filas.some((f) => f.celdas.some((c, i) => dias[i].finDeSemana && ((c.valor ?? 0) > 0 || (c.anterior ?? 0) > 0)))
  const visibles = dias.map((d, i) => ({ d, i })).filter(({ d }) => !d.finDeSemana || hayFinDeSemana)

  return (
    <section className={`${PANEL} rend-aparece overflow-hidden`} aria-label="Día a día">
      <CabeceraDePanel
        icono={<CalendarRange className="h-3.5 w-3.5" />}
        titulo="Día a día"
        contexto={`· ${info.ayuda}`}
        derecha={
          <label className="flex cursor-pointer select-none items-center gap-2 text-[11.5px] text-[var(--ls-t3)]">
            <input type="checkbox" checked={verAnterior} onChange={(e) => setVerAnterior(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--ls-acc-graf)]" />
            Ver también la semana anterior
          </label>
        }
      />

      <div className="space-y-3 p-3">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Qué cifra se enseña">
          {METRICAS.map((m) => (
            <ChipDeFiltro key={m.id} activo={metrica === m.id} onClick={() => onMetrica(m.id)} ayuda={m.ayuda}>
              {m.corta}
            </ChipDeFiltro>
          ))}
        </div>

        <div className="rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-[12px] text-[var(--ls-t3)]">
              Todo el equipo · <span className="text-[var(--ls-t1)]">{info.etiqueta.toLowerCase()}</span>
            </p>
            <LeyendaDeBarras />
          </div>
          <BarrasDeLaSemana
            dias={visibles.map((v) => v.d)}
            actual={visibles.map((v) => matriz.porDia[v.i].valor)}
            anterior={visibles.map((v) => matriz.porDia[v.i].anterior)}
            formato={formato}
            alto={110}
            nombre={`${info.etiqueta} del equipo`}
          />
        </div>

        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[640px] border-separate border-spacing-0 text-[12.5px]">
            <thead>
              <tr className="text-[11px] font-semibold text-[var(--ls-t4)]">
                <th scope="col" className="h-7 border-b border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-2.5 text-left font-semibold">
                  Persona
                </th>
                {visibles.map(({ d }) => (
                  <th key={d.dia} scope="col" className={`h-7 whitespace-nowrap border-b border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-1 text-center font-semibold ${d.esHoy ? 'text-[var(--ls-acc)]' : ''}`}>
                    {d.etiqueta}
                    {d.esHoy && <span className="ml-1 text-[10px] font-normal">· hoy</span>}
                  </th>
                ))}
                <th scope="col" className="h-7 border-b border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-2.5 text-right font-semibold">
                  Total
                </th>
                <th scope="col" className="h-7 whitespace-nowrap border-b border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-2.5 text-right font-semibold">
                  Cambio
                </th>
              </tr>
            </thead>
            <tbody>
              {matriz.filas.map((f, indice) => (
                <tr key={f.persona.id} className="group rend-entra" style={{ '--d': indice } as CSSProperties}>
                  <th scope="row" className="h-[46px] whitespace-nowrap border-b border-[var(--ls-linea)] px-2.5 text-left font-normal transition-colors group-hover:bg-[var(--ls-sup3)]">
                    <button type="button" onClick={() => onAbrirPersona(f.persona.id)} className="text-left text-[var(--ls-t2)] underline-offset-2 hover:text-[var(--ls-t1)] hover:underline">
                      {f.persona.nombre}
                      {!f.persona.vinculado && <span className="ml-2 text-[10.5px] text-[var(--ls-t4)]">sin Rinkel</span>}
                    </button>
                  </th>
                  {visibles.map(({ d, i }) => {
                    const c = f.celdas[i]
                    const nivel = c.valor === null ? 0 : intensidadDeCelda(c.valor, matriz.maximo)
                    // Un cero en un día de trabajo de quien sí tiene Rinkel es lo que hay que mirar en las llamadas
                    const cero = metrica === 'llamadas' && f.persona.vinculado && c.valor === 0 && !d.finDeSemana && !d.esHoy
                    return (
                      <td key={d.dia} className={`border-b border-[var(--ls-linea)] p-0 text-center ${d.esHoy ? 'bg-[var(--ls-sup2)]' : ''}`}>
                        <button
                          type="button"
                          disabled={c.valor === null}
                          onClick={() => onAbrirPersona(f.persona.id, d.dia)}
                          title={c.valor === null ? `${d.etiqueta}: todavía no ha llegado` : `${f.persona.nombre} · ${d.etiqueta}: ${formato(c.valor)}${c.anterior !== null ? ` · el mismo día de la semana anterior, ${formato(c.anterior)}` : ''}`}
                          className="block h-[46px] w-full px-1 tabular-nums transition-colors disabled:cursor-default enabled:hover:shadow-[inset_0_0_0_1px_var(--ls-t3)]"
                          style={nivel > 0 ? { background: `color-mix(in srgb, var(--ls-acc-graf) ${NARANJA[nivel]}%, transparent)` } : undefined}
                        >
                          <span className={`block text-[14px] font-semibold leading-tight ${c.valor === null ? 'text-[var(--ls-t4)]' : cero ? 'text-[var(--ls-e-rojo)]' : 'text-[var(--ls-t1)]'}`}>{c.valor === null ? '·' : formato(c.valor)}</span>
                          {verAnterior && c.anterior !== null && <span className="block text-[10px] leading-tight text-[var(--ls-t4)]">{formato(c.anterior)}</span>}
                        </button>
                      </td>
                    )
                  })}
                  <td className="h-[46px] border-b border-[var(--ls-linea)] px-2.5 text-right tabular-nums transition-colors group-hover:bg-[var(--ls-sup3)]">
                    <span className="font-semibold text-[var(--ls-t1)]">{formato(f.total)}</span>
                    {verAnterior && f.totalBase !== null && <span className="block text-[10px] leading-tight text-[var(--ls-t4)]">{formato(f.totalBase)}</span>}
                  </td>
                  <td className="h-[46px] whitespace-nowrap border-b border-[var(--ls-linea)] px-2.5 text-right transition-colors group-hover:bg-[var(--ls-sup3)]">
                    <span className="inline-flex justify-end">
                      <Delta v={f.cambio} contra={contra} />
                    </span>
                  </td>
                </tr>
              ))}

              <tr className="font-semibold">
                <th scope="row" className="h-[46px] bg-[var(--ls-sup2)] px-2.5 text-left font-semibold text-[var(--ls-t1)]">
                  Equipo
                </th>
                {visibles.map(({ d, i }) => {
                  const c = matriz.porDia[i]
                  return (
                    <td key={d.dia} className="bg-[var(--ls-sup2)] text-center tabular-nums">
                      <span className={`block text-[14px] leading-tight ${c.valor === null ? 'text-[var(--ls-t4)]' : 'text-[var(--ls-t1)]'}`}>{c.valor === null ? '·' : formato(c.valor)}</span>
                      {verAnterior && c.anterior !== null && <span className="block text-[10px] font-normal leading-tight text-[var(--ls-t4)]">{formato(c.anterior)}</span>}
                    </td>
                  )
                })}
                <td className="bg-[var(--ls-sup2)] px-2.5 text-right tabular-nums text-[var(--ls-t1)]">
                  {formato(matriz.total)}
                  {verAnterior && matriz.totalBase !== null && <span className="block text-[10px] font-normal leading-tight text-[var(--ls-t4)]">{formato(matriz.totalBase)}</span>}
                </td>
                <td className="whitespace-nowrap bg-[var(--ls-sup2)] px-2.5 text-right">
                  <span className="inline-flex justify-end">
                    <Delta v={matriz.cambio} contra={contra} />
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {verAnterior && <p className="text-[11px] text-[var(--ls-t4)]">El número pequeño de debajo es el del mismo día de la semana anterior. Una casilla con «·» es un día que todavía no ha llegado.</p>}
      </div>
    </section>
  )
}
