'use client'

import { useMemo } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { CAJA, Chispa } from '@/components/marketing-test/piezas'
import { entero, porcentaje } from '@/components/marketing-test/formato'
import { cestaFija } from '@/lib/seo/cesta'
import type { ConsultaGuardada } from '@/lib/seo/datos'
import { esDelProducto, diagnosticarTodas } from '@/lib/seo/embudo'
import type { Movimientos } from '@/lib/seo/movimientos'
import { revisarFicha } from '@/lib/seo/norma'
import type { GastoSemanal } from '@/lib/seo/periodo-mostrado'
import { resumenDeProducto } from '@/lib/seo/resumen'
import type { Tarea } from '@/lib/seo/tareas'
import { consultasDe, decisionesDe, diagnosticoDe, fichaDe, nombreDe, TarjetaDeEmbudo, TiraDeCifrasSeo } from './comun'
import type { DatosSeo } from './useCuentaSeo'
import type { CambioGuardado, Rival } from '@/lib/seo/rivales-servidor'
import type { DatosDePublicidad } from './PestanaSeoBusquedas'
import { useDelProducto } from './useDelProducto'

/**
 * EL RESUMEN DE UN PRODUCTO (pestaña Productos, al pulsar su fila). Lo esencial en una pantalla; cada sección acaba en «Ver más» hacia la pestaña que ya existe:
 *   1. Cifras: búsquedas, cuota de compras, cuota de impresiones y keywords en la ficha.   → Búsquedas
 *   2. Evolución con publicidad: la cuota de impresiones de su cesta fija de búsquedas (línea) y el gasto PPC semanal (barras).
 *   3. Búsquedas que pesan: las 8 con más compras del mercado, con su ▲/▼ de la semana (cada una abre su ficha).   → Búsquedas
 *   4. Salud de la ficha (norma 2026): título, viñetas y backend frente a sus límites e incidencias graves.   → Ficha
 *   5. Las 3 tareas más urgentes.   → Qué hacer hoy
 */

export interface FichaDelProductoProps {
  cuentaId: string
  datos: DatosSeo
  asin: string
  historial: readonly ConsultaGuardada[]
  gastoSemanal: GastoSemanal[] | null
  movimientos: Movimientos | null
  tareas: readonly Tarea[]
  volver: () => void
  verBusquedas: (asin: string) => void
  verBusqueda: (asin: string, consulta: string) => void
  verFicha: (asin: string) => void
  verHoy: () => void
  verCompetencia?: (asin: string) => void
  /** Dentro del panel del mosaico: sin la fila de «← Todos los productos» (el panel trae su propia cabecera) */
  enPanel?: boolean
}

export function FichaDelProducto({ cuentaId, verCompetencia, datos, asin, historial, gastoSemanal, movimientos, tareas, volver, verBusquedas, verBusqueda, verFicha, verHoy, enPanel = false }: FichaDelProductoProps) {
  const producto = datos.productos.find((p) => p.asin === asin)
  const ficha = fichaDe(datos, asin)
  const precio = datos.precios?.[asin] ?? null
  const mes = consultasDe(datos, asin, 'MONTH')
  const consultas = mes.length > 0 ? mes : consultasDe(datos, asin, 'WEEK')
  const r = resumenDeProducto(consultas, ficha, precio, decisionesDe(datos))
  const sinBa = (datos.lectura.asinsSinBa ?? []).includes(asin)
  const publicidad = useDelProducto<DatosDePublicidad>(`/api/seo/publicidad?cuenta=${encodeURIComponent(cuentaId)}&asin=${asin}`)
  const rivales = useDelProducto<{ rivales: Rival[]; cambios: CambioGuardado[]; sinMigracion?: boolean }>(`/api/seo/rivales?cuenta=${encodeURIComponent(cuentaId)}`)
  const misRivales = (rivales.datos?.rivales ?? []).filter((x) => x.asinPropio === asin && x.activo)
  const haceUnaSemana = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)
  const cambiosDe = (asinRival: string) => (rivales.datos?.cambios ?? []).filter((c) => c.asinRival === asinRival && c.fecha >= haceUnaSemana).length

  // 2 · Cesta fija semanal + gasto PPC por semana
  const evolucion = useMemo(() => {
    const { serie } = cestaFija(historial, asin, 'WEEK', precio)
    const gasto = new Map((gastoSemanal ?? []).filter((g) => g.asin === asin).map((g) => [g.desde, g.gasto]))
    return serie.map((p) => ({
      desde: p.desde,
      etiqueta: new Date(`${p.desde}T00:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
      cuota: p.cuotaImpresiones == null ? null : Math.round(p.cuotaImpresiones * 1000) / 10,
      gasto: gasto.get(p.desde) ?? null,
    }))
  }, [historial, asin, precio, gastoSemanal])

  // 3 · Búsquedas que pesan (relevantes, por compras del mercado)
  const pesan = useMemo(() => {
    const d = diagnosticarTodas(consultas, precio, { ...decisionesDe(datos), ficha })
    return d.busquedas
      .filter((b) => esDelProducto(b))
      .sort((a, b) => (b.fila.comprasTotal ?? 0) - (a.fila.comprasTotal ?? 0))
      .slice(0, 8)
      .map((b) => b.fila)
  }, [consultas, precio, datos, ficha])
  const movDe = (consulta: string): 'sube' | 'baja' | 'sale' | null => {
    if (!movimientos) return null
    const k = consulta.trim().toLowerCase()
    if (movimientos.suben.some((m) => m.consulta.trim().toLowerCase() === k)) return 'sube'
    if (movimientos.bajan.some((m) => m.consulta.trim().toLowerCase() === k)) return 'baja'
    if (movimientos.salen.some((m) => m.consulta.trim().toLowerCase() === k)) return 'sale'
    return null
  }

  // 4 · Salud de la ficha
  const salud = ficha ? revisarFicha(ficha) : null
  const graves = salud ? salud.incidencias.filter((i) => i.gravedad === 'grave') : []

  const urgentes = [...tareas].sort((a, b) => (a.gravedad === 'grave' ? 0 : 1) - (b.gravedad === 'grave' ? 0 : 1) || b.impacto - a.impacto).slice(0, 3)

  return (
    <div className="flex max-w-[1240px] flex-col gap-3 pb-8">
      <div className={enPanel ? 'hidden' : 'flex flex-wrap items-center gap-2'}>
        <button type="button" onClick={volver} className="inline-flex h-[30px] items-center gap-[6px] rounded-[9px] px-2 text-[12.5px] font-medium text-[var(--ls-t2)] hover:bg-[var(--ls-sup2)]">
          <ArrowLeft className="h-[14px] w-[14px]" /> Todos los productos
        </button>
        <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-[var(--ls-t1)]">{producto ? nombreDe(producto, ficha) : asin}</h2>
        <span className="rounded-[5px] bg-[var(--ls-sup2)] px-[6px] py-[1px] font-mono text-[11px] text-[var(--ls-t3)]">{asin}</span>
      </div>

      {sinBa ? (
        <p className={`${CAJA.base} px-4 py-3 text-[12.5px] text-[var(--ls-t3)]`}>Amazon no da datos de Brand Analytics de este producto: sin búsquedas no hay cifras, evolución ni embudo. La ficha sí se revisa.</p>
      ) : (
        <>
          {/* 1 · Cifras */}
          <Seccion titulo="Cifras" verMas={() => verBusquedas(asin)} textoVerMas="Búsquedas">
            <TiraDeCifrasSeo
              cifras={[
                { etiqueta: 'Búsquedas', valor: consultas.length > 0 ? entero(r.busquedas) : '—', nota: consultas.length > 0 ? `${entero(r.volumenTotal)} de volumen` : 'sin datos aún' },
                { etiqueta: 'Cuota de compras', valor: porcentaje(r.cuotaCompras), nota: 'de lo que se compra en sus búsquedas' },
                { etiqueta: 'Cuota de impresiones', valor: porcentaje(r.cuotaImpresiones), nota: 'cuánto sale cuando se busca' },
                { etiqueta: 'Keywords en la ficha', valor: r.cobertura == null ? '—' : porcentaje(r.cobertura, 0), nota: r.faltanEnFicha ? `${r.faltanEnFicha} de las 20 principales no están` : 'de las 20 principales' },
              ]}
            />
          </Seccion>

          {/* 2 · Evolución con publicidad */}
          <Seccion titulo="Evolución con publicidad">
            {evolucion.length < 2 ? (
              <p className="text-[12.5px] text-[var(--ls-t3)]">Se va llenando: hacen falta al menos 2 semanas de Brand Analytics.</p>
            ) : (
              <>
                <div className="h-[200px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={evolucion} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
                      <CartesianGrid stroke="var(--ls-linea)" vertical={false} />
                      <XAxis dataKey="etiqueta" tick={{ fontSize: 10.5, fill: 'var(--ls-t4)' }} tickLine={false} axisLine={false} />
                      <YAxis yAxisId="c" tick={{ fontSize: 10.5, fill: 'var(--ls-t4)' }} tickLine={false} axisLine={false} unit="%" />
                      <YAxis yAxisId="g" orientation="right" tick={{ fontSize: 10.5, fill: 'var(--ls-t4)' }} tickLine={false} axisLine={false} hide={!gastoSemanal} />
                      <Tooltip contentStyle={{ background: 'var(--ls-sup2)', border: '1px solid var(--ls-linea2)', borderRadius: 10, fontSize: 12 }} />
                      {gastoSemanal && <Bar yAxisId="g" dataKey="gasto" name="Gasto PPC" fill="var(--ls-t4)" opacity={0.3} radius={[3, 3, 0, 0]} />}
                      <Line yAxisId="c" dataKey="cuota" name="Cuota de impresiones (%)" stroke={COLOR_ESTADO.azul} strokeWidth={2} dot={{ r: 2 }} connectNulls={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-[11.5px] text-[var(--ls-t4)]">
                  Cuota de impresiones de sus 20 búsquedas que más venden (siempre las mismas){gastoSemanal ? ' y gasto PPC semanal en gris' : ''}. Amazon cuenta juntas las impresiones orgánicas y las de pago: si sube el gasto, sube la cuota.
                </p>
              </>
            )}
          </Seccion>

          {/* · El embudo del producto frente al mercado */}
          {consultas.length > 0 && (
            <Seccion titulo="Embudo frente al mercado" verMas={() => verBusquedas(asin)} textoVerMas="Búsquedas">
              <TarjetaDeEmbudo d={diagnosticoDe(datos, asin)} compacta />
            </Seccion>
          )}

          {/* 3 · Búsquedas que pesan */}
          <Seccion titulo="Búsquedas que pesan" verMas={() => verBusquedas(asin)} textoVerMas="Búsquedas">
            {pesan.length === 0 ? (
              <p className="text-[12.5px] text-[var(--ls-t3)]">Todavía no hay búsquedas de Brand Analytics.</p>
            ) : (
              <ul className="divide-y divide-[var(--ls-linea)]">
                {pesan.map((c) => {
                  const m = movDe(c.consulta)
                  return (
                    <li key={c.consulta}>
                      <button type="button" onClick={() => verBusqueda(asin, c.consulta)} className="flex w-full min-w-0 items-center gap-3 py-1.5 text-left text-[12.5px] hover:bg-[var(--ls-sup2)] [@media(pointer:coarse)]:min-h-[44px]">
                        <span className="min-w-0 flex-1 truncate text-[var(--ls-t1)]">{c.consulta}</span>
                        {m && <span className="shrink-0 text-[11.5px] font-semibold" style={{ color: m === 'sube' ? COLOR_ESTADO.verde : m === 'baja' ? COLOR_ESTADO.rojo : COLOR_ESTADO.gris }}>{m === 'sube' ? '▲' : m === 'baja' ? '▼' : 'fuera'}</span>}
                        <span className="w-[64px] shrink-0 text-right tabular-nums text-[var(--ls-t3)]">{porcentaje(c.cuotaCompras)}</span>
                        <span className="w-[80px] shrink-0 text-right tabular-nums text-[var(--ls-t4)]">{entero(c.comprasTotal)} compras</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </Seccion>
        </>
      )}

      {/* 4 · Salud de la ficha */}
      <Seccion titulo="Salud de la ficha (norma 2026)" verMas={() => verFicha(asin)} textoVerMas="Ficha">
        {!salud ? (
          <p className="text-[12.5px] text-[var(--ls-t3)]">La ficha todavía no se ha leído de Amazon.</p>
        ) : (
          <div className="flex flex-col gap-2">
            <Medida etiqueta="Título" valor={salud.medidas.tituloCaracteres} maximo={75} unidad="caracteres" />
            <Medida etiqueta="Viñetas" valor={salud.medidas.bulletsBytes} maximo={1000} unidad="bytes" />
            <Medida etiqueta="Backend" valor={salud.medidas.backendBytes} maximo={249} unidad="bytes" />
            {graves.length > 0 ? (
              <ul className="mt-1 flex flex-col gap-0.5 text-[12px]" style={{ color: COLOR_ESTADO.rojo }}>
                {graves.slice(0, 5).map((i) => (
                  <li key={i.texto}>• {i.texto}</li>
                ))}
              </ul>
            ) : (
              <p className="text-[12px]" style={{ color: COLOR_ESTADO.verde }}>
                {salud.incidencias.length > 0 ? `Dentro de norma, con ${salud.incidencias.length} mejora${salud.incidencias.length === 1 ? '' : 's'} posible${salud.incidencias.length === 1 ? '' : 's'}` : 'Dentro de norma'}
              </p>
            )}
          </div>
        )}
      </Seccion>

      {/* · Cruce con publicidad */}
      <Seccion titulo="Cruce con publicidad">
        {publicidad.cargando && !publicidad.datos ? (
          <div className="h-[48px] animate-pulse rounded-[8px] bg-[var(--ls-sup2)]" />
        ) : !publicidad.datos?.hayMarketingTest ? (
          <p className="text-[12.5px] text-[var(--ls-t3)]">Este cliente no está en Marketing Test en este país: no hay datos de publicidad con los que cruzar.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <ListaCorta
              titulo={`${entero(publicidad.datos.sinExacta.length)} búsquedas que venden sin keyword EXACTA`}
              vacio="Todas las búsquedas que venden tienen su EXACTA."
              items={publicidad.datos.sinExacta.slice(0, 3).map((b) => ({ clave: b.consulta, texto: b.consulta, nota: `${entero(b.comprasTotal)} compras${b.enOtraConcordancia ? ' · en amplia o frase' : ''}`, abrir: () => verBusqueda(asin, b.consulta) }))}
            />
            <ListaCorta
              titulo={`${entero(publicidad.datos.vendePorPublicidad.filter((t) => t.faltan.length > 0).length)} términos que venden por PPC y no están en la ficha`}
              vacio="Lo que vende por publicidad ya está en la ficha."
              items={publicidad.datos.vendePorPublicidad.filter((t) => t.faltan.length > 0).slice(0, 3).map((t) => ({ clave: t.termino, texto: t.termino, nota: `${entero(t.pedidos)} pedidos · falta «${t.faltan.join(', ')}»` }))}
            />
          </div>
        )}
      </Seccion>

      {/* · Rivales del producto */}
      <Seccion titulo="Rivales" verMas={verCompetencia ? () => verCompetencia(asin) : undefined} textoVerMas="Competencia">
        {rivales.cargando && !rivales.datos ? (
          <div className="h-[48px] animate-pulse rounded-[8px] bg-[var(--ls-sup2)]" />
        ) : misRivales.length === 0 ? (
          <p className="text-[12.5px] text-[var(--ls-t3)]">No sigues rivales de este producto. Se añaden en «Competencia» (a mano, desde el Top 3 o desde el Cerebro).</p>
        ) : (
          <ul className="divide-y divide-[var(--ls-linea)]">
            {misRivales.slice(0, 6).map((x) => {
              const precios = x.serie.map((p) => p.precio).filter((n): n is number => n != null)
              const bsr = x.ultima?.bsr?.[0]
              const n = cambiosDe(x.asinRival)
              return (
                <li key={x.id} className="flex min-w-0 items-center gap-3 py-1.5 text-[12.5px]">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[var(--ls-t1)]">{x.nombre ?? x.asinRival}</span>
                    <span className="font-mono text-[11px] text-[var(--ls-t4)]">{x.asinRival}</span>
                  </span>
                  <div className="w-[70px] shrink-0"><Chispa valores={precios} color={COLOR_ESTADO.ambar} /></div>
                  <span className="w-[70px] shrink-0 text-right tabular-nums text-[var(--ls-t1)]">{x.ultima?.precio == null ? '—' : x.ultima.precio.toLocaleString('es-ES', { style: 'currency', currency: x.ultima.moneda || 'EUR' })}</span>
                  <span className="w-[86px] shrink-0 text-right tabular-nums text-[var(--ls-t3)]" title={bsr ? `Puesto en ${bsr.categoria ?? 'su categoría'}` : undefined}>{bsr ? `#${entero(bsr.rank)}` : '—'}</span>
                  <span className="w-[72px] shrink-0 text-right text-[11.5px]" style={{ color: n > 0 ? COLOR_ESTADO.ambar : 'var(--ls-t4)' }}>{n > 0 ? `${n} cambio${n === 1 ? '' : 's'} 7 d` : 'sin cambios'}</span>
                </li>
              )
            })}
          </ul>
        )}
      </Seccion>

      {/* 5 · Tareas */}
      <Seccion titulo="Lo más urgente" verMas={verHoy} textoVerMas="Qué hacer hoy">
        {urgentes.length === 0 ? (
          <p className="text-[12.5px] text-[var(--ls-t3)]">Nada pendiente para este producto.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {urgentes.map((t) => (
              <li key={t.id} className="text-[12.5px]">
                <span className="font-semibold" style={{ color: t.gravedad === 'grave' ? COLOR_ESTADO.rojo : t.gravedad === 'atencion' ? COLOR_ESTADO.ambar : 'var(--ls-t1)' }}>
                  {t.titulo}
                </span>
                <span className="text-[var(--ls-t3)]"> · {t.accion}</span>
              </li>
            ))}
          </ul>
        )}
      </Seccion>
    </div>
  )
}

function Seccion({ titulo, verMas, textoVerMas, children }: { titulo: string; verMas?: () => void; textoVerMas?: string; children: React.ReactNode }) {
  return (
    <section className={`${CAJA.base} flex flex-col gap-2 px-4 py-3`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-[var(--ls-t1)]">{titulo}</h3>
        {verMas && (
          <button type="button" onClick={verMas} className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--ls-t3)] hover:text-[var(--ls-t1)]">
            {textoVerMas ?? 'Ver más'} <ArrowRight className="h-3 w-3" />
          </button>
        )}
      </div>
      {children}
    </section>
  )
}

function Medida({ etiqueta, valor, maximo, unidad }: { etiqueta: string; valor: number; maximo: number; unidad: string }) {
  const pctUso = Math.min(100, (valor / maximo) * 100)
  const pasa = valor > maximo
  const color = pasa ? COLOR_ESTADO.rojo : pctUso >= 90 ? COLOR_ESTADO.verde : COLOR_ESTADO.ambar
  return (
    <div className="grid grid-cols-[80px_minmax(0,1fr)_auto] items-center gap-2 text-[12px]">
      <span className="text-[var(--ls-t3)]">{etiqueta}</span>
      <span className="h-2 rounded-full bg-[var(--ls-sup2)]">
        <span className="block h-2 rounded-full" style={{ width: `${pctUso}%`, background: color }} />
      </span>
      <span className="tabular-nums text-[var(--ls-t2)]">
        {entero(valor)} / {entero(maximo)} {unidad}
      </span>
    </div>
  )
}

function ListaCorta({ titulo, vacio, items }: { titulo: string; vacio: string; items: Array<{ clave: string; texto: string; nota: string; abrir?: () => void }> }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[12px] font-medium text-[var(--ls-t2)]">{titulo}</p>
      {items.length === 0 ? (
        <p className="text-[12px] text-[var(--ls-t4)]">{vacio}</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {items.map((i) => (
            <li key={i.clave}>
              {i.abrir ? (
                <button type="button" onClick={i.abrir} className="w-full min-w-0 truncate text-left text-[12.5px] text-[var(--ls-t1)] hover:underline">
                  {i.texto} <span className="text-[var(--ls-t4)]">· {i.nota}</span>
                </button>
              ) : (
                <p className="truncate text-[12.5px] text-[var(--ls-t1)]">
                  {i.texto} <span className="text-[var(--ls-t4)]">· {i.nota}</span>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
