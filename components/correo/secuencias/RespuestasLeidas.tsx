'use client'

import { Sparkles } from 'lucide-react'
import type { CSSProperties } from 'react'
import { CabeceraDePanel, PANEL, Revelar } from '@/components/rendimiento/ui'
import { ETIQUETA_DE_CONFIANZA } from '@/lib/correo/secuencias/clases'
import { hace, queSeHizo, type RespuestaParaLaPantalla } from '@/lib/correo/secuencias/vistas'
import { ChipDeEstado } from './ColaDeLeads'
import type { Tablero } from './datos'

/**
 * LO QUE CONTESTAN LOS LEADS, LEÍDO POR LA IA.
 *
 * Dos piezas: el panel de la pestaña Flujo (cuántas respuestas de cada clase y las últimas) y la tarjeta del detalle de una secuencia (qué dijo, la frase en
 * que se apoya la IA y qué se hizo con la ficha). Con el motor en ensayo todo es «lo que se haría»: ninguna ficha cambia hasta el envío real.
 */

export function ChipDeClase({ r }: { r: Pick<RespuestaParaLaPantalla, 'etiqueta' | 'tono'> }) {
  return <ChipDeEstado tono={r.tono}>{r.etiqueta}</ChipDeEstado>
}

/** «poco segura» solo cuando la IA no está del todo convencida: lo normal no hace falta decirlo */
const dudosa = (r: Pick<RespuestaParaLaPantalla, 'confianza'>): string | null => (r.confianza === 'alta' ? null : ETIQUETA_DE_CONFIANZA[r.confianza])

export function PanelDeRespuestas({ tablero, ahora, onAbrir }: { tablero: Tablero; ahora: number; onAbrir: (id: string) => void }) {
  const res = tablero.respuestas
  const a = tablero.ajustes

  // Por qué no hay nada que enseñar, si es que hay un motivo
  const aviso = !a.respuestasDisponible
    ? 'Aún no está activada: falta lanzar la migración 246 en Supabase. Mientras tanto, cuando un lead contesta la secuencia se para sola, pero nadie lee lo que dice.'
    : !a.respuestasIa
      ? 'La lectura está apagada. Un administrador la enciende en Ajustes.'
      : !a.activa
        ? 'El motor está apagado: no lee nada.'
        : null

  return (
    <section className={PANEL} aria-label="Respuestas de los leads">
      <CabeceraDePanel icono={<Sparkles className="h-3.5 w-3.5" aria-hidden />} titulo="Lo que contestan los leads" contexto={`· leído por la IA, últimos ${res.dias} días`} />

      {aviso ? (
        <p className="px-4 py-6 text-center text-[12.5px] leading-snug text-[var(--ls-t3)]">{aviso}</p>
      ) : (
        <>
          {a.modoEnsayo && (
            <p className="border-b border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-2 text-[11.5px] leading-snug text-[var(--ls-t3)]">
              El motor está en <strong className="font-semibold text-[var(--ls-t2)]">ensayo</strong>: la IA lee cada respuesta y apunta aquí lo que haría, pero no toca ninguna ficha.
            </p>
          )}

          {res.total === 0 && res.pendientes === 0 && res.fallidas === 0 ? (
            <p className="px-4 py-8 text-center text-[12.5px] text-[var(--ls-t3)]">Todavía no ha contestado nadie que la IA haya leído.</p>
          ) : (
            <>
              <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 pb-1 pt-3">
                {res.porClase.map((c) => (
                  <li key={c.clase} className="flex items-center gap-1.5 text-[12px] text-[var(--ls-t2)]">
                    <ChipDeEstado tono={c.tono}>{c.etiqueta}</ChipDeEstado>
                    <span className="font-semibold tabular-nums text-[var(--ls-t1)]">{c.n}</span>
                  </li>
                ))}
                {res.pendientes > 0 && <li className="text-[11.5px] text-[var(--ls-t4)]">{res.pendientes} esperando su turno</li>}
                {res.fallidas > 0 && (
                  <li className="text-[11.5px] text-[var(--ls-e-ambar)]" title="La IA no pudo leerlas tras varios intentos: las tiene que mirar una persona">
                    {res.fallidas} sin poder leer
                  </li>
                )}
              </ul>

              <ul className="mt-2">
                {res.recientes.map((r, i) => {
                  const dudas = dudosa(r)
                  const cuerpo = (
                    <>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="text-[12.5px] font-medium text-[var(--ls-t1)]">{r.lead}</span>
                          <ChipDeClase r={r} />
                          {dudas && <span className="text-[10.5px] text-[var(--ls-t4)]">{dudas}</span>}
                        </span>
                        {r.resumen && <span className="mt-0.5 block text-[12px] leading-snug text-[var(--ls-t2)]">{r.resumen}</span>}
                        <span className="mt-0.5 block text-[11px] leading-snug text-[var(--ls-t4)]" title={r.evidencia ? `Se apoya en: «${r.evidencia}»` : undefined}>
                          {queSeHizo(r)}
                          {r.propietario && ` · ${r.propietario}`}
                        </span>
                      </span>
                      <span className="shrink-0 text-[11px] tabular-nums text-[var(--ls-t4)]">{hace(ahora, r.en)}</span>
                    </>
                  )
                  return (
                    <li key={r.mensajeId} className="sec-sube border-b border-[var(--ls-linea)] last:border-b-0" style={{ '--d': Math.min(i, 14) } as CSSProperties}>
                      {r.inscripcionId ? (
                        <button type="button" onClick={() => onAbrir(r.inscripcionId as string)} className="flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[var(--ls-sup2)]">
                          {cuerpo}
                        </button>
                      ) : (
                        <div className="flex items-start gap-2.5 px-3 py-2">{cuerpo}</div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  )
}

/** Lo que dijo ese lead, dentro del detalle de su secuencia */
export function TarjetaDeLectura({ r, ahora }: { r: RespuestaParaLaPantalla; ahora: number }) {
  const dudas = dudosa(r)
  return (
    <Revelar i={0}>
      <section aria-label="Lo que ha contestado" className="rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-3">
        <header className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <Sparkles className="h-3.5 w-3.5 text-[var(--ls-acc)]" aria-hidden />
          <h3 className="text-[12.5px] font-semibold text-[var(--ls-t1)]">Lo que ha contestado</h3>
          <ChipDeClase r={r} />
          {dudas && <span className="text-[11px] text-[var(--ls-t4)]">{dudas}</span>}
          <span className="ml-auto text-[11px] tabular-nums text-[var(--ls-t4)]">{hace(ahora, r.en)}</span>
        </header>
        {r.resumen && <p className="mt-2 text-[12.5px] leading-snug text-[var(--ls-t2)]">{r.resumen}</p>}
        {r.evidencia && <blockquote className="mt-2 border-l-2 border-[var(--ls-linea2)] pl-2.5 text-[12px] italic leading-snug text-[var(--ls-t3)]">«{r.evidencia}»</blockquote>}
        <p className="mt-2 text-[11.5px] font-medium text-[var(--ls-t2)]">{queSeHizo(r)}</p>
        {r.nota && (
          <p className="mt-1 text-[11.5px] leading-snug text-[var(--ls-t4)]">
            <span className="text-[var(--ls-t3)]">{r.modo === 'real' ? 'Nota en el lead:' : 'Nota que pondría en el lead:'}</span> {r.nota}
          </p>
        )}
      </section>
    </Revelar>
  )
}
