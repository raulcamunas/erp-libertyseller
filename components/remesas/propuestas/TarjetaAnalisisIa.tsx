'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, ArrowUpRight, CalendarRange, ChevronDown, Sparkles } from 'lucide-react'
import { Insignia } from '@/components/ui-ls'
import { AVISO, COLOR_ESTADO, TABLA } from '@/lib/estilo/denso'
import type { AnalisisIa } from '@/lib/fba/analisis-ia'
import type { LineaDePanel } from '@/lib/fba/datos'
import type { Nivel } from '@/lib/fba/reposicion'
import { urlDeEnvioPropuesto } from '@/lib/fba/trabajo-plan'
import { cx } from '../comun/ui'
import { fecha } from '../formato'
import { n0 } from '../inventario/formato'

/**
 * POR QUÉ SE PROPUSO ESTO.
 *
 * Una propuesta que nació con IA guarda el porqué: el resumen, el criterio, los riesgos, lo que habría que
 * confirmar con el cliente y el motivo de cada línea. Aquí se enseña. Meses después, cuando el cliente pregunte
 * «¿por qué mandamos 120 de esto?», la respuesta está a un clic y no depende de que alguien se acuerde.
 *
 * TRES ORÍGENES:
 *   · la propuesta a medida con IA (`usada`): «Por qué la IA propuso esto»;
 *   · la propuesta a medida sin IA: «Cómo se calculó esta propuesta»;
 *   · el PLANIFICADOR (`origen: 'planificador'`, lo pone «Convertir en remesa», spec §4.2): «Por qué el plan
 *     propuso esto». Las cantidades salen de la aritmética del plan; la IA, si revisó el envío, solo comenta. Va
 *     con un enlace al envío propuesto del que nació.
 *
 * Es de la AGENCIA que edita el cliente (antes solo el admin; D21): habla del inventario y de los riesgos como
 * los ve un planificador, y no es lo que se le enseña tal cual al cliente (para él está el Excel). Al cliente de
 * fuera ni le llega (D26).
 *
 * Lo que enseña es lo que se guardó al crear la propuesta. Si después se cambia una cantidad, la línea sigue
 * diciendo «propuso 120» y al lado «ahora 100»: se ve qué se tocó, no se reescribe el pasado.
 */

const TONO_PRIORIDAD: Record<Nivel, { texto: string; color: string }> = {
  alta: { texto: 'Alta', color: COLOR_ESTADO.rojo },
  media: { texto: 'Media', color: COLOR_ESTADO.ambar },
  baja: { texto: 'Baja', color: COLOR_ESTADO.gris },
}

type AnalisisConOrigen = AnalisisIa & { origen?: unknown; envioPropuestoId?: unknown }

export function TarjetaAnalisisIa({ analisis, lineas, abierto = false, clienteId }: { analisis: AnalisisIa; lineas: LineaDePanel[]; abierto?: boolean; clienteId?: string }) {
  const [ver, setVer] = useState(abierto)
  const [verFuera, setVerFuera] = useState(false)

  const extra = analisis as AnalisisConOrigen
  const delPlan = extra.origen === 'planificador' || typeof extra.envioPropuestoId === 'string'
  const envioId = typeof extra.envioPropuestoId === 'string' ? extra.envioPropuestoId : null

  const enLaPropuesta = useMemo(() => new Set(lineas.map((l) => l.sku)), [lineas])
  // Las que se proponían y alguien quitó al revisar. Lo uno y lo otro es información: se ve qué se decidió
  const quitadas = useMemo(
    () => Object.entries(analisis.lineas).filter(([sku]) => !enLaPropuesta.has(sku)).map(([sku, l]) => ({ sku, ...l })),
    [analisis.lineas, enLaPropuesta]
  )
  // Si la IA no contestó, lo primero que hay que saber es por qué. Si contestó, el aviso ya no pinta nada
  const aviso = !analisis.usada && !delPlan ? analisis.aviso : null
  const avisos = analisis.notas
  const quien = delPlan ? 'el plan' : 'la IA'
  const titulo = delPlan ? 'Por qué el plan propuso esto' : analisis.usada ? 'Por qué la IA propuso esto' : 'Cómo se calculó esta propuesta'
  const conMotivo = lineas.filter((l) => analisis.lineas[l.sku])

  return (
    <section className="overflow-hidden rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] shadow-[var(--ls-sombra-1)]">
      <button type="button" onClick={() => setVer((v) => !v)} className="flex min-h-[52px] w-full items-center justify-between gap-3 px-4 py-[10px] text-left" aria-expanded={ver}>
        <span className="flex min-w-0 items-center gap-3">
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]"
            style={{ background: 'color-mix(in srgb, var(--ls-mod-remesas) 14%, transparent)', color: 'var(--ls-mod-remesas)' }}
            aria-hidden
          >
            {delPlan ? <CalendarRange className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
          </span>
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-[13.5px] font-semibold text-[var(--ls-t1)]">{titulo}</span>
              {delPlan && (
                <Insignia tono="cian" variante="contorno" tamano="sm" punto={false}>
                  Del plan
                </Insignia>
              )}
            </span>
            <span className="block truncate text-[12px] text-[var(--ls-t3)]">
              {fecha(analisis.generadaEn)}
              {delPlan ? (analisis.usada && analisis.modelo ? ` · revisado por ${analisis.modelo}` : ' · aritmética del planificador') : analisis.usada && analisis.modelo ? ` · ${analisis.modelo}` : ' · solo el cálculo, sin IA'}
            </span>
          </span>
        </span>
        <ChevronDown className={cx('h-4 w-4 shrink-0 text-[var(--ls-t4)] transition-transform motion-reduce:transition-none', ver && 'rotate-180')} aria-hidden />
      </button>

      {ver && (
        <div className="space-y-3 border-t border-[var(--ls-linea)] p-4">
          {aviso && (
            <div className={cx(AVISO.base, AVISO.conTono, 'items-center')} style={{ borderLeftColor: COLOR_ESTADO.ambar }}>
              <AlertTriangle className={AVISO.icono} style={{ color: COLOR_ESTADO.ambar }} />
              {aviso}
            </div>
          )}

          {analisis.resumen && (
            <div>
              <p className="text-[13px] leading-[1.6] text-[var(--ls-t1)]">{analisis.resumen}</p>
              {analisis.estrategia && <p className="mt-1 text-[12.5px] leading-[1.55] text-[var(--ls-t3)]">Criterio: {analisis.estrategia}</p>}
            </div>
          )}

          {avisos.length > 0 && (
            <ul className="space-y-[6px]">
              {avisos.map((a) => (
                <li key={a} className={cx(AVISO.base, AVISO.conTono, 'items-center')} style={{ borderLeftColor: delPlan ? COLOR_ESTADO.cian : COLOR_ESTADO.ambar }}>
                  <AlertTriangle className={AVISO.icono} style={{ color: delPlan ? COLOR_ESTADO.cian : COLOR_ESTADO.ambar }} />
                  {a}
                </li>
              ))}
            </ul>
          )}

          {(analisis.riesgos.length > 0 || analisis.dudas.length > 0) && (
            <div className="grid gap-3 md:grid-cols-2">
              {analisis.riesgos.length > 0 && <Lista titulo={delPlan ? 'Lo que vio la revisión de la IA' : 'Riesgos a vigilar'} textos={analisis.riesgos} />}
              {analisis.dudas.length > 0 && <Lista titulo="Por confirmar con el cliente" textos={analisis.dudas} />}
            </div>
          )}

          {analisis.usada && analisis.parametros.notas && (
            <p className="text-[12px] leading-[1.5] text-[var(--ls-t3)]">
              <span className="font-semibold text-[var(--ls-t2)]">Lo que se le pidió tener en cuenta:</span> {analisis.parametros.notas}
            </p>
          )}

          {/* ---------- el motivo de cada línea ---------- */}
          {conMotivo.length > 0 && (
            <div className="overflow-hidden rounded-[10px] border border-[var(--ls-linea)]">
              <div className="hidden max-h-[360px] overflow-auto md:block">
                <table className={TABLA.tabla}>
                  <thead>
                    <tr>
                      <th className={cx(TABLA.cabecera, 'min-w-[220px]')}>Producto</th>
                      <th className={cx(TABLA.cabecera, TABLA.derecha)} title={delPlan ? 'Lo que pedía la necesidad del plan antes de redondear y topar' : 'Lo que salía de la cuenta, sin la IA'}>
                        {delPlan ? 'Necesidad' : 'Cálculo'}
                      </th>
                      <th className={cx(TABLA.cabecera, TABLA.derecha)} title="Lo que se propuso al crearla">
                        Propuesto
                      </th>
                      <th className={cx(TABLA.cabecera, TABLA.derecha)} title="Lo que lleva la propuesta ahora">
                        Ahora
                      </th>
                      <th className={TABLA.cabecera}>Prioridad</th>
                      <th className={TABLA.cabecera}>Por qué</th>
                    </tr>
                  </thead>
                  <tbody>
                    {conMotivo.map((l) => {
                      const a = analisis.lineas[l.sku]
                      const pri = TONO_PRIORIDAD[a.prioridad]
                      const cambiada = l.enviadas !== a.propuestas
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
                          <td className={cx(TABLA.celda, TABLA.numero, 'font-semibold text-[var(--ls-t1)]')} style={cambiada ? { color: COLOR_ESTADO.ambar } : undefined} title={cambiada ? 'Se ha cambiado después de proponerla' : undefined}>
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
              {/* En el móvil, una tarjeta por línea */}
              <ul className="max-h-[420px] divide-y divide-[var(--ls-linea)] overflow-auto md:hidden">
                {conMotivo.map((l) => {
                  const a = analisis.lineas[l.sku]
                  const pri = TONO_PRIORIDAD[a.prioridad]
                  const cambiada = l.enviadas !== a.propuestas
                  return (
                    <li key={l.sku} className="px-3 py-[10px]">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-[13px] text-[var(--ls-t1)]">
                            {l.referencia && <span className="mr-1 text-[var(--ls-t3)]">{l.referencia}</span>}
                            {l.nombre ?? l.sku}
                            {l.variante && <span className="ml-1 text-[var(--ls-t3)]">· {l.variante}</span>}
                          </p>
                          <p className="truncate font-mono text-[11.5px] text-[var(--ls-t4)]">{l.sku}</p>
                        </div>
                        <span className="shrink-0 text-right text-[12px] tabular-nums text-[var(--ls-t3)]">
                          {n0(a.propuestas)} →{' '}
                          <b className="font-semibold" style={{ color: cambiada ? COLOR_ESTADO.ambar : 'var(--ls-t1)' }}>
                            {n0(l.enviadas)}
                          </b>
                        </span>
                      </div>
                      <p className="mt-1 flex items-start gap-[6px] text-[12px] leading-[1.45] text-[var(--ls-t2)]">
                        <span className="mt-[5px] h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: pri.color }} title={`Prioridad ${pri.texto.toLowerCase()}`} aria-hidden />
                        <span className="min-w-0">{a.motivo || '—'}</span>
                      </p>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {/* ---------- lo que se quitó y lo que se dejó fuera ---------- */}
          {(quitadas.length > 0 || analisis.descartadas.length > 0) && (
            <div className="overflow-hidden rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]">
              <button type="button" onClick={() => setVerFuera((v) => !v)} className="flex min-h-[44px] w-full items-center justify-between gap-3 px-3 py-[8px] text-left" aria-expanded={verFuera}>
                <span className="min-w-0 text-[13px] font-semibold text-[var(--ls-t1)]">
                  Lo que se dejó fuera
                  <span className="ml-2 text-[12px] font-normal text-[var(--ls-t3)]">
                    {quitadas.length > 0 && `${quitadas.length} quitada${quitadas.length === 1 ? '' : 's'} al revisar`}
                    {quitadas.length > 0 && analisis.descartadas.length > 0 && ' · '}
                    {analisis.descartadas.length > 0 && `${analisis.descartadas.length} que no se propusieron`}
                  </span>
                </span>
                <ChevronDown className={cx('h-4 w-4 shrink-0 text-[var(--ls-t4)] transition-transform motion-reduce:transition-none', verFuera && 'rotate-180')} aria-hidden />
              </button>
              {verFuera && (
                <ul className="max-h-[300px] divide-y divide-[var(--ls-linea)] overflow-auto border-t border-[var(--ls-linea)]">
                  {quitadas.map((q) => (
                    <li key={`q-${q.sku}`} className="grid gap-x-3 gap-y-[2px] px-3 py-2 md:grid-cols-[minmax(0,240px)_70px_minmax(0,1fr)]">
                      <span className="truncate font-mono text-[11.5px] text-[var(--ls-t3)]">{q.sku}</span>
                      <span className="text-[12px] tabular-nums text-[var(--ls-t3)] md:text-right">{n0(q.base)}</span>
                      <span className="text-[12px] leading-[1.4]">
                        <span className="text-[var(--ls-t4)]">Quitada al revisar. </span>
                        {q.motivo && (
                          <span className="text-[var(--ls-t3)]">
                            {delPlan ? 'El plan' : 'La IA'} proponía {n0(q.propuestas)}: {q.motivo}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                  {analisis.descartadas.map((d) => (
                    <li key={`d-${d.sku}`} className="grid gap-x-3 gap-y-[2px] px-3 py-2 md:grid-cols-[minmax(0,240px)_70px_minmax(0,1fr)]">
                      <span className="min-w-0 truncate">
                        <span className="mr-2 font-mono text-[11.5px] text-[var(--ls-t3)]">{d.sku}</span>
                        <span className="text-[12px] text-[var(--ls-t2)]">{d.nombre ?? ''}</span>
                      </span>
                      <span className="text-[12px] tabular-nums text-[var(--ls-t3)] md:text-right">{n0(d.base)}</span>
                      <span className="text-[12px] leading-[1.4] text-[var(--ls-t2)]">{d.motivo}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 flex-1 text-[11.5px] leading-[1.5] text-[var(--ls-t4)]">
              Cobertura objetivo {analisis.parametros.coberturaObjetivo} días, {analisis.parametros.plazoDias} hasta que está a la venta
              {analisis.parametros.topeUnidades ? `, tope de ${n0(analisis.parametros.topeUnidades)} unidades` : ''}. Es lo que vio {quien} el {fecha(analisis.generadaEn)}
              {analisis.ventasHasta ? `, con las ventas leídas hasta el ${fecha(analisis.ventasHasta)}` : ''}: no se actualiza con las ventas de después.
            </p>
            {delPlan && envioId && (
              <a
                href={urlDeEnvioPropuesto(envioId, clienteId)}
                className="inline-flex min-h-[36px] items-center gap-1 rounded-[10px] px-2 text-[12.5px] font-medium text-[var(--ls-mod-remesas)] hover:underline"
              >
                Ver el envío propuesto
                <ArrowUpRight className="h-[14px] w-[14px]" aria-hidden />
              </a>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

function Lista({ titulo, textos }: { titulo: string; textos: string[] }) {
  return (
    <div className="rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-[9px]">
      <h4 className="mb-1 text-[12.5px] font-semibold text-[var(--ls-t1)]">{titulo}</h4>
      <ul className="space-y-[4px]">
        {textos.map((t) => (
          <li key={t} className="flex gap-2 text-[12.5px] leading-[1.5] text-[var(--ls-t2)]">
            <span className="mt-[8px] h-[4px] w-[4px] shrink-0 rounded-full bg-[var(--ls-t4)]" />
            {t}
          </li>
        ))}
      </ul>
    </div>
  )
}
