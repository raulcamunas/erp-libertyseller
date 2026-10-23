'use client'

import { ChevronDown, Info, Loader2, RefreshCw, Trophy } from 'lucide-react'
import { Fragment, useCallback, useEffect, useState } from 'react'
import { pedir } from '@/components/correo/api'
import { Esqueleto, PANEL } from '@/components/rendimiento/ui'
import type { RespuestaDeResultados, ResultadosDeVersion } from '@/lib/correo/ia-laboratorio-tipos'
import type { ResumenDeGrupo } from '@/lib/correo/ia-resultados'
import { AYUDA, fechaCorta, pct, rangoPct } from './ui'

/**
 * RESULTADOS: qué versión de la IA consigue más respuestas.
 *
 * Por versión: cuántos correos escribió que se llegaron a enviar, a cuántos contestó una persona de fuera (incluido un «no, gracias») y a cuántos
 * contestó con interés (alguien que no dijo que no), con su intervalo, y cuánto cambió el comercial lo que escribió la IA. Debajo, los correos
 * fríos que salieron SIN IA, como referencia. La apertura no se mide: sin un píxel de seguimiento (que perjudica la entrega) no hay forma.
 *
 * Las tasas son bajas y los números pequeños: el veredicto solo da un ganador cuando su intervalo queda por encima del de la segunda.
 */

const PERIODOS = [
  { dias: 30, texto: '30 días' },
  { dias: 45, texto: '45 días' },
  { dias: 90, texto: '90 días' },
] as const

const celda = 'px-3 py-2 align-top'
const cabecera = 'px-3 py-1.5 text-left text-[10.5px] font-semibold uppercase tracking-[0.04em] text-[var(--ls-t4)]'

export function TabResultados() {
  const [dias, setDias] = useState<number>(45)
  const [datos, setDatos] = useState<RespuestaDeResultados | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [abierta, setAbierta] = useState<string | null>(null)

  const cargar = useCallback(async (d: number) => {
    setCargando(true)
    const r = await pedir<RespuestaDeResultados>(`/api/correo/laboratorio/resultados?dias=${d}`)
    setCargando(false)
    if (!r.ok) return setError(r.mensaje)
    setError(null)
    setDatos(r.datos)
  }, [])

  useEffect(() => {
    void cargar(dias)
  }, [dias, cargar])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-[var(--ls-t4)]">Correos enviados en los últimos</span>
        {PERIODOS.map((p) => (
          <button
            key={p.dias}
            type="button"
            onClick={() => setDias(p.dias)}
            aria-pressed={dias === p.dias}
            className={`inline-flex h-7 items-center rounded-[6px] border px-2.5 text-[12px] transition-colors ${dias === p.dias ? 'border-[var(--ls-acc-graf)] bg-[var(--ls-acc-suave)] text-[var(--ls-t1)]' : 'border-[var(--ls-linea)] bg-[var(--ls-sup)] text-[var(--ls-t3)] hover:text-[var(--ls-t1)]'}`}
          >
            {p.texto}
          </button>
        ))}
        <button type="button" onClick={() => void cargar(dias)} className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-[var(--ls-t4)] hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]" aria-label="Volver a calcular" title="Volver a calcular">
          {cargando ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
        </button>
      </div>

      {error ? (
        <p className="text-[12.5px] text-[var(--ls-e-ambar)]" role="alert">
          {error}
        </p>
      ) : !datos ? (
        <div className="space-y-2" aria-busy="true">
          <Esqueleto className="h-12" />
          <Esqueleto className="h-40" />
        </div>
      ) : (
        <>
          <Veredicto datos={datos} />

          <div className={`${PANEL} overflow-x-auto`}>
            <table className="w-full min-w-[760px] border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-[var(--ls-linea)]">
                  <th className={cabecera}>Versión</th>
                  <th className={`${cabecera} text-right`}>Enviados</th>
                  <th className={`${cabecera} text-right`} title="Una persona de fuera contestó, incluso un «no, gracias»">
                    Contestaron
                  </th>
                  <th className={`${cabecera} text-right`} title="Contestó alguien y no fue un «no»">
                    Con interés
                  </th>
                  <th className={`${cabecera} text-right`}>% con interés</th>
                  <th className={`${cabecera} text-right`} title="Cuánto cambia el comercial lo que escribe la IA antes de enviarlo">
                    Lo cambian
                  </th>
                </tr>
              </thead>
              <tbody>
                {datos.versiones.map((v) => (
                  <FilaDeVersion key={v.id ?? 'sin-version'} v={v} abierta={abierta === (v.id ?? 'sin-version')} onAbrir={() => setAbierta(abierta === (v.id ?? 'sin-version') ? null : (v.id ?? 'sin-version'))} lider={datos.veredicto.tipo === 'lider' && datos.veredicto.id === v.id} />
                ))}
                {datos.aMano && (
                  <tr className="border-t border-[var(--ls-linea)] bg-[var(--ls-sup2)]">
                    <td className={celda}>
                      <span className="font-medium text-[var(--ls-t2)]">Enviados sin IA</span>
                      <span className="block text-[11.5px] text-[var(--ls-t4)]">Correos fríos escritos a mano, para comparar</span>
                    </td>
                    <Cifras r={datos.aMano} />
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-start gap-2 text-[11.5px] leading-snug text-[var(--ls-t4)]">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <p>
              <strong className="text-[var(--ls-t3)]">Contestaron</strong>: una persona de fuera respondió (no cuentan los compañeros probándose, los avisos automáticos ni los «no-reply»).{' '}
              <strong className="text-[var(--ls-t3)]">Con interés</strong>: contestó y no fue un «no». Entre paréntesis, el margen de error: con tasas tan bajas hacen falta cientos de envíos por versión para notar una
              diferencia. La apertura de los correos no se mide: sin un píxel de seguimiento, que perjudica la entrega, no hay forma de saberlo.
            </p>
          </div>
        </>
      )}
    </div>
  )
}

function Veredicto({ datos }: { datos: RespuestaDeResultados }) {
  const v = datos.veredicto
  return (
    <div className={`${PANEL} flex items-start gap-3 p-3 ${v.tipo === 'lider' ? 'border-[var(--ls-e-verde)]' : ''}`} role="status">
      <Trophy className={`mt-0.5 h-4 w-4 shrink-0 ${v.tipo === 'lider' ? 'text-[var(--ls-e-verde)]' : 'text-[var(--ls-t4)]'}`} aria-hidden />
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-[var(--ls-t1)]">{v.tipo === 'lider' ? 'Hay una versión ganadora' : v.tipo === 'sin-diferencia' ? 'Todavía no hay una ganadora' : 'Todavía es pronto'}</p>
        <p className="text-[12.5px] leading-snug text-[var(--ls-t3)]">{v.texto}</p>
        {v.tipo === 'lider' && <p className={AYUDA}>Para que todo el equipo la use: pestaña «Versiones», elige la versión y pulsa «Que todos usen ésta».</p>}
      </div>
    </div>
  )
}

function Cifras({ r }: { r: ResumenDeGrupo }) {
  return (
    <>
      <td className={`${celda} text-right tabular-nums`}>{r.enviados.toLocaleString('es-ES')}</td>
      <td className={`${celda} text-right tabular-nums`}>
        {r.respondieron.toLocaleString('es-ES')}
        {r.tasaRespuesta !== null && <span className="block text-[11px] text-[var(--ls-t4)]">{pct(r.tasaRespuesta)}</span>}
      </td>
      <td className={`${celda} text-right tabular-nums`}>{r.interesadas.toLocaleString('es-ES')}</td>
      <td className={`${celda} text-right tabular-nums`}>
        <span className="font-semibold text-[var(--ls-t1)]">{pct(r.tasaInteres)}</span>
        {r.intervaloInteres && <span className="block text-[11px] text-[var(--ls-t4)]">({rangoPct(r.intervaloInteres)})</span>}
      </td>
      <td className={`${celda} text-right tabular-nums`}>{r.cambiosMedios === null ? '—' : `${r.cambiosMedios} %`}</td>
    </>
  )
}

function FilaDeVersion({ v, abierta, onAbrir, lider }: { v: ResultadosDeVersion; abierta: boolean; onAbrir: () => void; lider: boolean }) {
  const hayCorreos = v.conRespuesta.length > 0
  return (
    <Fragment>
      <tr className="border-t border-[var(--ls-linea)] first:border-t-0">
        <td className={celda}>
          <button type="button" onClick={onAbrir} disabled={!hayCorreos} aria-expanded={abierta} className="flex items-start gap-1.5 text-left disabled:cursor-default">
            <ChevronDown className={`mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ls-t4)] transition-transform ${abierta ? '' : '-rotate-90'} ${hayCorreos ? '' : 'opacity-20'}`} aria-hidden />
            <span>
              <span className="flex flex-wrap items-center gap-1.5 font-medium text-[var(--ls-t1)]">
                {v.nombre}
                {v.esBase && <span className="rounded-[4px] bg-[var(--ls-sup3)] px-1.5 py-px text-[10px] font-medium text-[var(--ls-t3)]">Original</span>}
                {lider && <span className="rounded-[4px] bg-[color-mix(in_srgb,var(--ls-e-verde)_16%,transparent)] px-1.5 py-px text-[10px] font-medium text-[var(--ls-e-verde)]">Gana</span>}
              </span>
              <span className="block text-[11.5px] text-[var(--ls-t4)]">{v.enMarcha ? 'En marcha' : v.id === null ? 'Borradores de antes de las versiones' : 'Pausada o archivada'}</span>
            </span>
          </button>
        </td>
        <Cifras r={v.resumen} />
      </tr>
      {abierta && hayCorreos && (
        <tr className="bg-[var(--ls-sup2)]">
          <td colSpan={6} className="px-4 py-3">
            <p className="mb-2 text-[11.5px] font-semibold text-[var(--ls-t3)]">Correos de esta versión que consiguieron respuesta con interés (como salieron)</p>
            <ul className="space-y-3">
              {v.conRespuesta.map((c, i) => (
                <li key={i} className="rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-3">
                  <p className="text-[12.5px] font-semibold text-[var(--ls-t1)]">{c.asunto || 'Sin asunto'}</p>
                  <p className="text-[11px] text-[var(--ls-t4)]">
                    Enviado el {fechaCorta(c.enviadoAt)}
                    {c.cambios !== null ? ` · el comercial cambió un ${c.cambios} %` : ''}
                  </p>
                  <p className="mt-1.5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-[var(--ls-t2)]">{c.texto}</p>
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </Fragment>
  )
}
