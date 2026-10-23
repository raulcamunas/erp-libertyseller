'use client'

import { Activity, Filter } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { CabeceraDePanel, Numero, PANEL, Revelar } from '@/components/rendimiento/ui'
import { ETIQUETA_DE_ESTADO, hace } from '@/lib/correo/secuencias/vistas'
import { MINIMO_PARA_UNA_TASA } from '@/lib/correo/secuencias/vistas'
import type { EstadoDeInscripcion } from '@/lib/correo/secuencias/tipos'
import type { Tablero } from './datos'
import { COLOR_DE_TONO, ESTILO_DE_EVENTO } from './LineaDeTiempo'

/**
 * EL FLUJO: QUÉ HA PASADO CON LAS SECUENCIAS DE LOS ÚLTIMOS 30 DÍAS.
 *
 * El embudo (cuántos correos salen en cada paso y cuántos leads contestan después de cada uno), en qué estado están las secuencias, por qué se cortan las que
 * se cortan, y lo último que ha hecho el motor.
 */

const COLOR_DE_ESTADO: Record<EstadoDeInscripcion, string> = {
  activa: 'var(--ls-acc-graf)',
  pausada: 'var(--ls-e-ambar)',
  respondida: 'var(--ls-e-verde)',
  parada: 'var(--ls-e-rojo)',
  completada: 'var(--ls-t4)',
  sin_respuesta: 'var(--ls-t4)',
  cancelada: 'var(--ls-linea2)',
}

function Cifra({ titulo, valor, nota, escalon, formato }: { titulo: string; valor: number; nota?: ReactNode; escalon: number; formato?: (n: number) => string }) {
  return (
    <Revelar i={escalon} className={`${PANEL} px-3 py-2.5`}>
      <p className="text-[11px] text-[var(--ls-t4)]">{titulo}</p>
      <p className="text-[22px] font-semibold leading-tight tabular-nums text-[var(--ls-t1)]">
        <Numero valor={valor} formato={formato} />
      </p>
      {nota && <p className="text-[10.5px] text-[var(--ls-t4)]">{nota}</p>}
    </Revelar>
  )
}

export function VistaDeFlujo({ tablero, ahora, onAbrir }: { tablero: Tablero; ahora: number; onAbrir: (id: string) => void }) {
  const f = tablero.flujo
  const maximo = Math.max(1, ...f.embudo.map((e) => e.enviados))
  const estados = (Object.keys(ETIQUETA_DE_ESTADO) as EstadoDeInscripcion[]).filter((e) => (f.porEstado[e] ?? 0) > 0)
  const terminadas = f.total - f.vivas
  const tasaFiable = f.tasaDeRespuesta !== null && terminadas >= MINIMO_PARA_UNA_TASA

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Cifra escalon={0} titulo="Secuencias iniciadas" valor={f.total} nota={`últimos ${f.dias} días`} />
        <Cifra escalon={1} titulo="En marcha" valor={f.vivas} nota="siguen su calendario" />
        <Cifra escalon={2} titulo="Han contestado" valor={f.respondidas} nota="la secuencia se paró sola" />
        <Cifra
          escalon={3}
          titulo="Tasa de respuesta"
          valor={f.tasaDeRespuesta !== null ? f.tasaDeRespuesta * 100 : 0}
          formato={(n) => (f.tasaDeRespuesta === null ? '—' : `${n.toFixed(n < 10 ? 1 : 0)} %`)}
          nota={f.tasaDeRespuesta === null ? 'aún no ha terminado ninguna' : tasaFiable ? `de ${terminadas} terminadas` : `de solo ${terminadas} terminadas: aún es pronto para fiarse`}
        />
      </div>

      <section className={PANEL} aria-label="Embudo">
        <CabeceraDePanel icono={<Filter className="h-3.5 w-3.5" aria-hidden />} titulo="El embudo" contexto="· cuántos salen en cada paso y cuántos contestan después" />
        <ul className="space-y-3 p-3">
          {f.embudo.map((e, i) => (
            <Revelar key={e.paso} i={i}>
              <li>
                <div className="mb-1 flex items-baseline justify-between gap-2 text-[12px]">
                  <span className="font-medium text-[var(--ls-t1)]">{e.etiqueta}</span>
                  <span className="tabular-nums text-[var(--ls-t3)]">
                    <span className="font-semibold text-[var(--ls-t1)]">{e.enviados}</span> enviados
                    {e.respuestas > 0 && (
                      <>
                        {' · '}
                        <span className="font-semibold text-[var(--ls-e-verde)]">{e.respuestas}</span> contestaron después
                      </>
                    )}
                  </span>
                </div>
                <div className="relative h-[10px] overflow-hidden rounded-full bg-[var(--ls-sup3)]">
                  <span className="sec-barra absolute inset-y-0 left-0 rounded-full bg-[var(--ls-acc-graf)]" style={{ width: `${(e.enviados / maximo) * 100}%`, '--d': i } as CSSProperties} />
                  <span className="sec-barra absolute inset-y-0 left-0 rounded-full bg-[var(--ls-e-verde)]" style={{ width: `${(e.respuestas / maximo) * 100}%`, '--d': i + 1 } as CSSProperties} />
                </div>
              </li>
            </Revelar>
          ))}
        </ul>
      </section>

      <div className="grid gap-3 lg:grid-cols-2">
        <section className={PANEL} aria-label="Estados">
          <CabeceraDePanel titulo="En qué estado están" />
          <div className="space-y-3 p-3">
            <div className="flex h-[10px] overflow-hidden rounded-full bg-[var(--ls-sup3)]">
              {estados.map((e, i) => (
                <span key={e} className="sec-barra block h-full" style={{ width: `${((f.porEstado[e] ?? 0) / Math.max(1, f.total)) * 100}%`, background: COLOR_DE_ESTADO[e], '--d': i } as CSSProperties} title={`${ETIQUETA_DE_ESTADO[e].texto}: ${f.porEstado[e]}`} />
              ))}
            </div>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1">
              {estados.length === 0 && <li className="col-span-2 text-[12px] text-[var(--ls-t4)]">Todavía no hay secuencias.</li>}
              {estados.map((e) => (
                <li key={e} className="flex items-center gap-2 text-[12px] text-[var(--ls-t2)]">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: COLOR_DE_ESTADO[e] }} />
                  <span className="min-w-0 flex-1 truncate">{ETIQUETA_DE_ESTADO[e].texto}</span>
                  <span className="tabular-nums text-[var(--ls-t1)]">{f.porEstado[e]}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className={PANEL} aria-label="Por qué se cortan">
          <CabeceraDePanel titulo="Por qué se cortan" />
          <ul className="space-y-1.5 p-3">
            {f.motivosDeCorte.length === 0 && <li className="text-[12px] text-[var(--ls-t4)]">Ninguna se ha cortado todavía.</li>}
            {f.motivosDeCorte.map((m) => (
              <li key={m.codigo} className="flex items-center gap-2 text-[12px] text-[var(--ls-t2)]">
                <span className="min-w-0 flex-1 truncate">{m.etiqueta}</span>
                <span className="relative h-[6px] w-24 overflow-hidden rounded-full bg-[var(--ls-sup3)]">
                  <span className="sec-barra absolute inset-y-0 left-0 rounded-full" style={{ width: `${(m.n / Math.max(1, f.motivosDeCorte[0].n)) * 100}%`, background: m.codigo === 'respuesta' ? 'var(--ls-e-verde)' : 'var(--ls-e-ambar)' } as CSSProperties} />
                </span>
                <span className="w-6 text-right tabular-nums text-[var(--ls-t1)]">{m.n}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className={PANEL} aria-label="Actividad reciente">
        <CabeceraDePanel icono={<Activity className="h-3.5 w-3.5" aria-hidden />} titulo="Lo último que ha hecho el motor" />
        {tablero.actividad.length === 0 ? (
          <p className="px-4 py-8 text-center text-[12.5px] text-[var(--ls-t3)]">Todavía no ha pasado nada.</p>
        ) : (
          <ul>
            {tablero.actividad.map((a, i) => {
              const est = ESTILO_DE_EVENTO[a.tipo] ?? { Icono: Activity, tono: 'gris' as const }
              const Icono = est.Icono
              const cuerpo = (
                <>
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2" style={{ borderColor: COLOR_DE_TONO[est.tono], color: COLOR_DE_TONO[est.tono] }}>
                    <Icono className="h-2.5 w-2.5" strokeWidth={2.6} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] leading-snug text-[var(--ls-t2)]">
                      {a.lead && <span className="font-medium text-[var(--ls-t1)]">{a.lead} · </span>}
                      {a.detalle ?? a.tipo}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-[var(--ls-t4)]">{hace(ahora, a.en)}</span>
                </>
              )
              return (
                <li key={a.id} className="sec-sube border-b border-[var(--ls-linea)] last:border-b-0" style={{ '--d': Math.min(i, 14) } as CSSProperties}>
                  {a.inscripcionId ? (
                    <button type="button" onClick={() => onAbrir(a.inscripcionId as string)} className="flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[var(--ls-sup2)]">
                      {cuerpo}
                    </button>
                  ) : (
                    <div className="flex items-start gap-2.5 px-3 py-2">{cuerpo}</div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
