'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, Sparkles } from 'lucide-react'
import { AVISO, COLOR_ESTADO, TABLA, TIPO } from '@/lib/estilo/denso'
import type { AnalisisIa } from '@/lib/fba/analisis-ia'
import type { LineaDePanel } from '@/lib/fba/datos'
import type { Nivel } from '@/lib/fba/reposicion'
import { cx } from '../comun/ui'
import { fecha } from '../formato'
import { n0 } from '../inventario/formato'

/**
 * POR QUÉ LA IA PROPUSO ESTO.
 *
 * Una propuesta que nació con IA guarda el porqué: el resumen, el criterio, los riesgos, lo que
 * habría que confirmar con el cliente y el motivo de cada línea. Aquí se enseña. Meses después,
 * cuando el cliente pregunte «¿por qué mandamos 120 de esto?», la respuesta está a un clic y no
 * depende de que alguien se acuerde.
 *
 * Es de la AGENCIA: el análisis habla del inventario y de los riesgos como los ve un
 * planificador, y no es lo que se le enseña tal cual al cliente (para él está el Excel).
 *
 * Lo que enseña es lo que se guardó al crear la propuesta. Si después se cambia una cantidad, la
 * línea sigue diciendo «la IA propuso 120» y al lado «ahora 100»: se ve qué se tocó, no se
 * reescribe el pasado.
 */

const TONO_PRIORIDAD: Record<Nivel, { texto: string; color: string }> = {
  alta: { texto: 'Alta', color: COLOR_ESTADO.rojo },
  media: { texto: 'Media', color: COLOR_ESTADO.ambar },
  baja: { texto: 'Baja', color: COLOR_ESTADO.gris },
}

export function TarjetaAnalisisIa({ analisis, lineas, abierto = false }: { analisis: AnalisisIa; lineas: LineaDePanel[]; abierto?: boolean }) {
  const [ver, setVer] = useState(abierto)
  const [verFuera, setVerFuera] = useState(false)

  const enLaPropuesta = useMemo(() => new Set(lineas.map((l) => l.sku)), [lineas])
  // Las que la IA proponía y alguien quitó al revisar. Lo uno y lo otro es información: se ve qué se decidió
  const quitadas = useMemo(
    () => Object.entries(analisis.lineas).filter(([sku]) => !enLaPropuesta.has(sku)).map(([sku, l]) => ({ sku, ...l })),
    [analisis.lineas, enLaPropuesta]
  )
  // Si la IA no contestó, lo primero que hay que saber es por qué. Si contestó, el aviso ya no pinta nada
  const aviso = !analisis.usada ? analisis.aviso : null
  const avisos = analisis.notas

  return (
    <section className="rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]">
      <button type="button" onClick={() => setVer((v) => !v)} className="flex w-full items-center justify-between gap-3 px-3 py-[9px] text-left" aria-expanded={ver}>
        <span className="flex min-w-0 items-center gap-2">
          <Sparkles className="h-[14px] w-[14px] shrink-0 text-[var(--ls-acc)]" />
          <span className={cx(TIPO.l, 'truncate text-[var(--ls-t1)]')}>
            {analisis.usada ? 'Por qué la IA propuso esto' : 'Cómo se calculó esta propuesta'}
            <span className="ml-2 text-[11.5px] font-normal text-[var(--ls-t3)]">
              {fecha(analisis.generadaEn)}
              {analisis.usada && analisis.modelo ? ` · ${analisis.modelo}` : ' · solo el cálculo, sin IA'}
            </span>
          </span>
        </span>
        <ChevronDown className={cx('h-4 w-4 shrink-0 text-[var(--ls-t4)] transition-transform', ver && 'rotate-180')} />
      </button>

      {ver && (
        <div className="space-y-3 border-t border-[var(--ls-linea)] p-3">
          {aviso && (
            <div className={cx(AVISO.base, AVISO.conTono, 'items-center')} style={{ borderLeftColor: COLOR_ESTADO.ambar }}>
              <AlertTriangle className={AVISO.icono} style={{ color: COLOR_ESTADO.ambar }} />
              {aviso}
            </div>
          )}

          {analisis.resumen && (
            <div>
              <p className="text-[12.5px] leading-[1.55] text-[var(--ls-t1)]">{analisis.resumen}</p>
              {analisis.estrategia && <p className="mt-1 text-[12px] leading-[1.55] text-[var(--ls-t3)]">Criterio: {analisis.estrategia}</p>}
            </div>
          )}

          {avisos.length > 0 && (
            <ul className="space-y-[6px]">
              {avisos.map((a) => (
                <li key={a} className={cx(AVISO.base, AVISO.conTono, 'items-center')} style={{ borderLeftColor: COLOR_ESTADO.ambar }}>
                  <AlertTriangle className={AVISO.icono} style={{ color: COLOR_ESTADO.ambar }} />
                  {a}
                </li>
              ))}
            </ul>
          )}

          {(analisis.riesgos.length > 0 || analisis.dudas.length > 0) && (
            <div className="grid gap-3 md:grid-cols-2">
              {analisis.riesgos.length > 0 && <Lista titulo="Riesgos a vigilar" textos={analisis.riesgos} />}
              {analisis.dudas.length > 0 && <Lista titulo="Por confirmar con el cliente" textos={analisis.dudas} />}
            </div>
          )}

          {analisis.usada && analisis.parametros.notas && (
            <p className="text-[11.5px] leading-[1.5] text-[var(--ls-t3)]">
              <span className="font-semibold text-[var(--ls-t2)]">Lo que se le pidió tener en cuenta:</span> {analisis.parametros.notas}
            </p>
          )}

          {/* ---------- el motivo de cada línea ---------- */}
          {lineas.some((l) => analisis.lineas[l.sku]) && (
            <div className="overflow-hidden rounded-[8px] border border-[var(--ls-linea)]">
              <div className="max-h-[360px] overflow-auto">
                <table className={TABLA.tabla}>
                  <thead>
                    <tr>
                      <th className={cx(TABLA.cabecera, 'min-w-[220px]')}>Producto</th>
                      <th className={cx(TABLA.cabecera, TABLA.derecha)} title="Lo que salía de la cuenta, sin la IA">Cálculo</th>
                      <th className={cx(TABLA.cabecera, TABLA.derecha)} title="Lo que se propuso al crearla">Propuesto</th>
                      <th className={cx(TABLA.cabecera, TABLA.derecha)} title="Lo que lleva la propuesta ahora">Ahora</th>
                      <th className={TABLA.cabecera}>Prioridad</th>
                      <th className={TABLA.cabecera}>Por qué</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineas.map((l) => {
                      const a = analisis.lineas[l.sku]
                      if (!a) return null
                      const pri = TONO_PRIORIDAD[a.prioridad]
                      return (
                        <tr key={l.sku} className={TABLA.fila}>
                          <td className={cx(TABLA.celda, 'max-w-[280px]')}>
                            <div className="flex items-baseline gap-2 overflow-hidden">
                              <span className="shrink-0 font-mono text-[11.5px] text-[var(--ls-t3)]">{l.sku}</span>
                              <span className="truncate text-[var(--ls-t1)]" title={l.nombre ?? ''}>
                                {l.referencia && <span className="mr-1 text-[var(--ls-t3)]">{l.referencia}</span>}
                                {l.nombre ?? '—'}
                                {l.variante && <span className="ml-1 text-[var(--ls-t3)]">· {l.variante}</span>}
                              </span>
                            </div>
                          </td>
                          <td className={cx(TABLA.celda, TABLA.numero, 'text-[var(--ls-t3)]')}>{n0(a.base)}</td>
                          <td className={cx(TABLA.celda, TABLA.numero)}>{n0(a.propuestas)}</td>
                          <td className={cx(TABLA.celda, TABLA.numero, 'font-semibold text-[var(--ls-t1)]')} style={l.enviadas !== a.propuestas ? { color: COLOR_ESTADO.ambar } : undefined} title={l.enviadas !== a.propuestas ? 'Se ha cambiado después de proponerla' : undefined}>
                            {n0(l.enviadas)}
                          </td>
                          <td className={TABLA.celda}>
                            <span className="inline-flex items-center gap-[6px] text-[11.5px] text-[var(--ls-t2)]">
                              <span className="h-[7px] w-[7px] rounded-full" style={{ background: pri.color }} aria-hidden />
                              {pri.texto}
                            </span>
                          </td>
                          {/* La anchura la pone el div: una celda con texto largo se estira a una sola línea */}
                          <td className={cx(TABLA.celda, '!whitespace-normal py-[4px]')} style={{ height: 'auto' }}>
                            <div className="w-[420px] text-[12px] leading-[1.4] text-[var(--ls-t2)]">{a.motivo || <span className="text-[var(--ls-t4)]">—</span>}</div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ---------- lo que se quitó y lo que se dejó fuera ---------- */}
          {(quitadas.length > 0 || analisis.descartadas.length > 0) && (
            <div className="rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]">
              <button type="button" onClick={() => setVerFuera((v) => !v)} className="flex w-full items-center justify-between gap-3 px-3 py-[8px] text-left" aria-expanded={verFuera}>
                <span className="text-[12.5px] font-semibold text-[var(--ls-t1)]">
                  Lo que se dejó fuera
                  <span className="ml-2 text-[11.5px] font-normal text-[var(--ls-t3)]">
                    {quitadas.length > 0 && `${quitadas.length} quitada${quitadas.length === 1 ? '' : 's'} al revisar`}
                    {quitadas.length > 0 && analisis.descartadas.length > 0 && ' · '}
                    {analisis.descartadas.length > 0 && `${analisis.descartadas.length} que no se propusieron`}
                  </span>
                </span>
                <ChevronDown className={cx('h-4 w-4 text-[var(--ls-t4)] transition-transform', verFuera && 'rotate-180')} />
              </button>
              {verFuera && (
                <div className="max-h-[260px] overflow-auto border-t border-[var(--ls-linea)]">
                  <table className={TABLA.tabla}>
                    <thead>
                      <tr>
                        <th className={TABLA.cabecera}>SKU</th>
                        <th className={cx(TABLA.cabecera, TABLA.derecha)} title="Lo que habría salido de la cuenta">Cálculo</th>
                        <th className={TABLA.cabecera}>Por qué no</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quitadas.map((q) => (
                        <tr key={`q-${q.sku}`} className={TABLA.fila}>
                          <td className={cx(TABLA.celda, 'font-mono text-[11.5px] text-[var(--ls-t3)]')}>{q.sku}</td>
                          <td className={cx(TABLA.celda, TABLA.numero, 'text-[var(--ls-t3)]')}>{n0(q.base)}</td>
                          <td className={cx(TABLA.celda, '!whitespace-normal py-[4px]')} style={{ height: 'auto' }}>
                            <div className="w-[420px] text-[12px] leading-[1.4]">
                              <span className="text-[var(--ls-t4)]">Quitada al revisar. </span>
                              {q.motivo && <span className="text-[var(--ls-t3)]">La IA proponía {n0(q.propuestas)}: {q.motivo}</span>}
                            </div>
                          </td>
                        </tr>
                      ))}
                      {analisis.descartadas.map((d) => (
                        <tr key={`d-${d.sku}`} className={TABLA.fila}>
                          <td className={cx(TABLA.celda, 'max-w-[320px]')}>
                            <div className="flex items-baseline gap-2 overflow-hidden">
                              <span className="shrink-0 font-mono text-[11.5px] text-[var(--ls-t3)]">{d.sku}</span>
                              <span className="truncate text-[var(--ls-t2)]">{d.nombre ?? ''}</span>
                            </div>
                          </td>
                          <td className={cx(TABLA.celda, TABLA.numero, 'text-[var(--ls-t3)]')}>{n0(d.base)}</td>
                          <td className={cx(TABLA.celda, '!whitespace-normal py-[4px]')} style={{ height: 'auto' }}>
                            <div className="w-[420px] text-[12px] leading-[1.4]">{d.motivo}</div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <p className="text-[11px] leading-[1.5] text-[var(--ls-t4)]">
            Cobertura objetivo {analisis.parametros.coberturaObjetivo} días, {analisis.parametros.plazoDias} hasta que está a la venta
            {analisis.parametros.topeUnidades ? `, tope de ${n0(analisis.parametros.topeUnidades)} unidades` : ''}. Es lo que se vio el {fecha(analisis.generadaEn)}: no se actualiza con las ventas de después.
          </p>
        </div>
      )}
    </section>
  )
}

function Lista({ titulo, textos }: { titulo: string; textos: string[] }) {
  return (
    <div className="rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 py-[9px]">
      <h4 className="mb-1 text-[12px] font-semibold text-[var(--ls-t1)]">{titulo}</h4>
      <ul className="space-y-[4px]">
        {textos.map((t) => (
          <li key={t} className="flex gap-2 text-[12px] leading-[1.5] text-[var(--ls-t2)]">
            <span className="mt-[7px] h-[4px] w-[4px] shrink-0 rounded-full bg-[var(--ls-t4)]" />
            {t}
          </li>
        ))}
      </ul>
    </div>
  )
}
