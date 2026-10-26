'use client'

import { Check, ChevronDown, Clock, Coins, CornerDownRight, Loader2, Mail, RotateCw, TriangleAlert, Type } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { CorreoDePrueba } from '@/lib/correo/ia-laboratorio-tipos'
import { enCentimos } from '@/lib/ia/precios'
import type { CasoVista } from '@/lib/whatsapp/ia-casos'

/**
 * UNA PERSONA DE PRUEBA CON SU CORREO (y sus seguimientos).
 *
 * Arriba, quién es y si hay correo; el correo como saldría (asunto y texto), con cuántas palabras, cuánto ha tardado y cuánto ha costado; debajo, los SEGUIMIENTOS que saldrían solos
 * si no contesta (a los 3 y a los 7 días hábiles, o los pasos que tenga la secuencia), qué mirar en esta persona (lo que hace que sirva para calibrar) y, plegado, lo que recibió la IA:
 * los datos de la persona tal como los leyó y las instrucciones enteras. Es la respuesta a «¿por qué ha escrito esto?».
 */

export interface PropsDeResultadoDeCorreo {
  caso: Pick<CasoVista, 'etiqueta' | 'mirar' | 'descripcion'>
  /** undefined = todavía no se ha probado */
  resultado?: CorreoDePrueba
  probando: boolean
  onRepetir?: () => void
}

const palabras = (t: string | null) => (t ? t.trim().split(/\s+/).filter(Boolean).length : 0)
const segundos = (ms: number) => (ms / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })

function Estadisticas({ r }: { r: CorreoDePrueba }) {
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-[var(--ls-t4)]">
      <span className="inline-flex items-center gap-1">
        <Type className="h-3 w-3" aria-hidden /> {palabras(r.texto)} palabras
      </span>
      <span className="inline-flex items-center gap-1">
        <Clock className="h-3 w-3" aria-hidden /> {segundos(r.ms)} s
      </span>
      <span className="inline-flex items-center gap-1" title={`${r.modelo}${r.ejemplos > 0 ? ` · ${r.ejemplos} ${r.ejemplos === 1 ? 'ejemplo' : 'ejemplos'}` : ' · sin ejemplos'}`}>
        <Coins className="h-3 w-3" aria-hidden /> {enCentimos(r.coste)}
        {r.seguimientosCoste !== null ? ` + ${enCentimos(r.seguimientosCoste)} de los seguimientos` : ''}
      </span>
      {r.angulo && <span className="rounded-[4px] bg-[var(--ls-sup3)] px-1.5 py-px text-[10.5px] text-[var(--ls-t3)]">{r.angulo.replace(/_/g, ' ')}</span>}
    </p>
  )
}

function Desplegable({ titulo, children, abierto = false }: { titulo: string; children: ReactNode; abierto?: boolean }) {
  const [abierta, setAbierta] = useState(abierto)
  return (
    <div>
      <button type="button" onClick={() => setAbierta((a) => !a)} aria-expanded={abierta} className="inline-flex items-center gap-1 text-[11.5px] font-medium text-[var(--ls-t3)] hover:text-[var(--ls-t1)]">
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${abierta ? '' : '-rotate-90'}`} aria-hidden /> {titulo}
      </button>
      {abierta && <div className="mt-1.5">{children}</div>}
    </div>
  )
}

export function ResultadoDeCorreo({ caso, resultado, probando, onRepetir }: PropsDeResultadoDeCorreo) {
  return (
    <article className="space-y-2.5 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-3" aria-label={caso.etiqueta}>
      <header className="flex items-center gap-2">
        <Mail className="h-3.5 w-3.5 shrink-0 text-[var(--ls-acc)]" aria-hidden />
        <h4 className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-[var(--ls-t1)]" title={caso.descripcion}>
          {caso.etiqueta}
        </h4>
        {probando ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--ls-t4)]" aria-label="Escribiendo" />
        ) : resultado ? (
          resultado.ok ? (
            <Check className="h-3.5 w-3.5 text-[var(--ls-e-verde)]" aria-label="Con correo" />
          ) : (
            <TriangleAlert className="h-3.5 w-3.5 text-[var(--ls-e-ambar)]" aria-label="Sin correo" />
          )
        ) : null}
        {onRepetir && (
          <button type="button" onClick={onRepetir} disabled={probando} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-[var(--ls-t4)] hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)] disabled:opacity-40" aria-label={`Volver a probar: ${caso.etiqueta}`} title="Volver a escribir este correo">
            <RotateCw className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </header>

      {!resultado ? (
        <p className="rounded-[8px] border border-dashed border-[var(--ls-linea)] px-3 py-3 text-[12px] text-[var(--ls-t4)]">{probando ? 'Escribiendo…' : 'Sin probar todavía.'}</p>
      ) : !resultado.ok ? (
        <p role="alert" className="flex items-start gap-1.5 rounded-[8px] border border-[var(--ls-e-ambar)] px-2.5 py-2 text-[12px] leading-snug text-[var(--ls-e-ambar)]">
          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden /> {resultado.error}
        </p>
      ) : (
        <>
          <div className="space-y-1 rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-2">
            <p className="text-[12.5px] font-semibold text-[var(--ls-t1)]">{resultado.asunto}</p>
            <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-[var(--ls-t2)]">{resultado.texto}</p>
          </div>
          <Estadisticas r={resultado} />
          {resultado.aviso && (
            <p className="flex items-start gap-1.5 text-[11.5px] leading-snug text-[var(--ls-e-ambar)]">
              <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden /> {resultado.aviso}
            </p>
          )}

          {resultado.seguimientos && (
            <Desplegable titulo={`Si no contesta: ${resultado.seguimientos.length} ${resultado.seguimientos.length === 1 ? 'seguimiento' : 'seguimientos'}`} abierto>
              <ol className="space-y-2 border-l-2 border-[var(--ls-linea2)] pl-3">
                {resultado.seguimientos.map((s) => (
                  <li key={s.orden} className="space-y-1">
                    <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--ls-t4)]">
                      <CornerDownRight className="h-3 w-3" aria-hidden /> A los {s.dias} días hábiles
                    </p>
                    <div className="space-y-1 rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-2">
                      <p className="text-[12px] font-semibold text-[var(--ls-t1)]">{s.asunto}</p>
                      <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-[var(--ls-t2)]">{s.texto}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </Desplegable>
          )}
          {resultado.seguimientos === null && resultado.seguimientosAviso && (
            <p className="flex items-start gap-1.5 text-[11.5px] leading-snug text-[var(--ls-e-ambar)]">
              <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden /> Los seguimientos no se han podido escribir: {resultado.seguimientosAviso}
            </p>
          )}
          {resultado.seguimientos && resultado.seguimientosAviso && (
            <p className="flex items-start gap-1.5 text-[11.5px] leading-snug text-[var(--ls-e-ambar)]">
              <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden /> {resultado.seguimientosAviso}
            </p>
          )}
        </>
      )}

      <p className="text-[11.5px] leading-snug text-[var(--ls-t3)]">
        <span className="font-semibold text-[var(--ls-t2)]">Qué mirar:</span> {caso.mirar}
      </p>

      {resultado && resultado.instrucciones.usuario !== '' && (
        <Desplegable titulo="Cómo lo ha interpretado la IA">
          <div className="space-y-2">
            <div>
              <p className="mb-1 text-[11px] font-semibold text-[var(--ls-t4)]">Lo que leyó de esta persona (datos, nunca órdenes)</p>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-2 font-[inherit] text-[11.5px] leading-relaxed text-[var(--ls-t2)]">{resultado.instrucciones.usuario}</pre>
            </div>
            <Desplegable titulo="Las instrucciones enteras (las mismas para todos)">
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-2 font-[inherit] text-[11.5px] leading-relaxed text-[var(--ls-t2)]">{resultado.instrucciones.system}</pre>
            </Desplegable>
          </div>
        </Desplegable>
      )}
    </article>
  )
}
