'use client'

import { useMemo, useState } from 'react'
import { METRICAS, formatoDe, intensidadDeCelda, matrizDiaria, type DiaDeSemana, type Metrica, type ResultadoSemanal, type Semana } from '@/lib/rendimiento/informe'
import { Cambio } from '../CifrasDelPeriodo'
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

const CALOR = ['', 'bg-[#FF6600]/[0.12]', 'bg-[#FF6600]/[0.24]', 'bg-[#FF6600]/[0.42]', 'bg-[#FF6600]/[0.66]'] as const

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
    <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:p-5 space-y-4" aria-label="Día a día">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div>
          <h2 className="text-[13px] font-semibold text-white">Día a día</h2>
          <p className="text-[12px] text-white/40 mt-0.5 max-w-[60ch]">{info.ayuda}.</p>
        </div>
        <label className="flex items-center gap-2 text-[12px] text-white/55 cursor-pointer select-none">
          <input type="checkbox" checked={verAnterior} onChange={(e) => setVerAnterior(e.target.checked)} className="h-3.5 w-3.5 accent-[#FF6600]" />
          Ver también la semana anterior
        </label>
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Qué cifra se enseña">
        {METRICAS.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onMetrica(m.id)}
            aria-pressed={metrica === m.id}
            title={m.ayuda}
            className={`px-3 h-8 rounded-full border text-[12px] font-medium transition-colors ${
              metrica === m.id ? 'border-[#FF6600]/50 bg-[#FF6600]/15 text-white' : 'border-white/10 text-white/55 hover:text-white hover:border-white/25'
            }`}
          >
            {m.corta}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-white/[0.06] bg-black/20 p-3 sm:p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <p className="text-[12px] text-white/60">
            Todo el equipo · <span className="text-white/85">{info.etiqueta.toLowerCase()}</span>
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

      <div className="overflow-x-auto -mx-1 px-1">
        <table className="w-full min-w-[640px] border-separate border-spacing-y-[3px] text-[13px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-[0.12em] text-white/40">
              <th scope="col" className="text-left font-medium px-2 pb-1">
                Persona
              </th>
              {visibles.map(({ d }) => (
                <th key={d.dia} scope="col" className={`font-medium px-1 pb-1 whitespace-nowrap ${d.esHoy ? 'text-[#FF8A3D]' : d.finDeSemana ? 'text-white/25' : ''}`}>
                  {d.etiqueta}
                  {d.esHoy && <span className="block text-[9px] normal-case tracking-normal">hoy</span>}
                </th>
              ))}
              <th scope="col" className="text-right font-medium px-2 pb-1">
                Total
              </th>
              <th scope="col" className="text-right font-medium px-2 pb-1 whitespace-nowrap">
                Cambio
              </th>
            </tr>
          </thead>
          <tbody>
            {matriz.filas.map((f) => (
              <tr key={f.persona.id} className="group">
                <th scope="row" className="text-left font-normal px-2 rounded-l-lg bg-white/[0.02] group-hover:bg-white/[0.05] transition-colors">
                  <button type="button" onClick={() => onAbrirPersona(f.persona.id)} className="text-left text-white/90 hover:text-white hover:underline underline-offset-2 py-2 whitespace-nowrap">
                    {f.persona.nombre}
                    {!f.persona.vinculado && <span className="ml-2 text-[10px] text-white/30">sin Rinkel</span>}
                  </button>
                </th>
                {visibles.map(({ d, i }) => {
                  const c = f.celdas[i]
                  const nivel = c.valor === null ? 0 : intensidadDeCelda(c.valor, matriz.maximo)
                  // Un cero en un día de trabajo de quien sí tiene Rinkel es lo que hay que mirar en las llamadas
                  const cero = metrica === 'llamadas' && f.persona.vinculado && c.valor === 0 && !d.finDeSemana && !d.esHoy
                  return (
                    <td key={d.dia} className={`p-0 text-center ${d.esHoy ? 'outline outline-1 -outline-offset-1 outline-[#FF6600]/30' : ''}`}>
                      <button
                        type="button"
                        disabled={c.valor === null}
                        onClick={() => onAbrirPersona(f.persona.id, d.dia)}
                        title={c.valor === null ? `${d.etiqueta}: todavía no ha llegado` : `${f.persona.nombre} · ${d.etiqueta}: ${formato(c.valor)}${c.anterior !== null ? ` · el mismo día de la semana anterior, ${formato(c.anterior)}` : ''}`}
                        className={`block w-full h-full min-h-[44px] px-1 py-1.5 tabular-nums transition-colors disabled:cursor-default enabled:hover:ring-1 enabled:hover:ring-inset enabled:hover:ring-white/30 ${CALOR[nivel] || 'bg-white/[0.02]'}`}
                      >
                        <span className={`block text-[14px] font-semibold ${c.valor === null ? 'text-white/20' : cero ? 'text-red-300/80' : nivel === 4 ? 'text-white' : 'text-white/85'}`}>
                          {c.valor === null ? '·' : formato(c.valor)}
                        </span>
                        {verAnterior && c.anterior !== null && <span className="block text-[10px] text-white/30">{formato(c.anterior)}</span>}
                      </button>
                    </td>
                  )
                })}
                <td className="px-2 text-right tabular-nums font-semibold text-white bg-white/[0.02] group-hover:bg-white/[0.05] transition-colors">
                  {formato(f.total)}
                  {verAnterior && f.totalBase !== null && <span className="block text-[10px] font-normal text-white/30">{formato(f.totalBase)}</span>}
                </td>
                <td className="px-2 text-right rounded-r-lg bg-white/[0.02] group-hover:bg-white/[0.05] transition-colors whitespace-nowrap">
                  <span className="inline-flex justify-end">
                    <Cambio v={f.cambio} contra={contra} />
                  </span>
                </td>
              </tr>
            ))}

            <tr>
              <th scope="row" className="text-left font-semibold text-white px-2 py-2 rounded-l-lg bg-white/[0.06]">
                Equipo
              </th>
              {visibles.map(({ d, i }) => {
                const c = matriz.porDia[i]
                return (
                  <td key={d.dia} className="text-center tabular-nums bg-white/[0.06] py-1.5">
                    <span className={`block text-[14px] font-semibold ${c.valor === null ? 'text-white/20' : 'text-white'}`}>{c.valor === null ? '·' : formato(c.valor)}</span>
                    {verAnterior && c.anterior !== null && <span className="block text-[10px] text-white/30">{formato(c.anterior)}</span>}
                  </td>
                )
              })}
              <td className="px-2 text-right tabular-nums font-bold text-white bg-white/[0.06]">
                {formato(matriz.total)}
                {verAnterior && matriz.totalBase !== null && <span className="block text-[10px] font-normal text-white/30">{formato(matriz.totalBase)}</span>}
              </td>
              <td className="px-2 text-right rounded-r-lg bg-white/[0.06] whitespace-nowrap">
                <span className="inline-flex justify-end">
                  <Cambio v={matriz.cambio} contra={contra} />
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {verAnterior && <p className="text-[11px] text-white/30">El número pequeño de debajo es el del mismo día de la semana anterior. Una casilla con «·» es un día que todavía no ha llegado.</p>}
    </section>
  )
}
