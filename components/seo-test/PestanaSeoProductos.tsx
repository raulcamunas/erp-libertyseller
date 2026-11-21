'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ArrowRight, Download, Plus, Search, Trash2 } from 'lucide-react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { CAJA, Chispa } from '@/components/marketing-test/piezas'
import { entero, porcentaje } from '@/components/marketing-test/formato'
import { llamar } from '@/components/marketing-test/llamar'
import { Vacio } from '@/components/plataforma/comun'
import { resumenDeProducto } from '@/lib/seo/resumen'
import { consultasDe, decisionesDe, diagnosticoDe, estiloDeVeredicto, fichaDe, nombreDe, serieDe, useEsOrdenador } from './comun'
import { revisarFicha } from '@/lib/seo/norma'
import { RESPONSABLE, RESPONSABLE_INFRAEXPUESTA } from '@/lib/seo/embudo'
import type { PuntoDeEvolucion } from '@/lib/seo/datos'
import type { DatosSeo } from './useCuentaSeo'
import { movimientosDe, type Movimientos } from '@/lib/seo/movimientos'
import { tareasDeLaCuenta, type Tarea } from '@/lib/seo/tareas'
import type { ConsultaHistorica } from '@/lib/seo/datos'
import type { GastoSemanal } from '@/lib/seo/periodo-mostrado'
import { FichaDelProducto } from './FichaDelProducto'
import { leerRevisadas } from './PestanaSeoHoy'

/**
 * LOS PRODUCTOS SEGUIDOS de la cuenta y país, cada uno con su resumen: en cuántas búsquedas aparece, cuánto volumen arrastran, qué parte de las compras y de las impresiones se lleva y cuántas de sus
 * búsquedas principales están enteras en la ficha. Desde aquí se añaden (del catálogo o los mismos que en Marketing Test) y se quitan.
 */
export function PestanaSeoProductos({
  cuentaId,
  datos,
  recargar,
  verBusquedas,
  verFicha,
  historial,
  verBusqueda,
  verHoy,
  verCompetencia,
}: {
  cuentaId: string
  datos: DatosSeo
  recargar: () => void
  verBusquedas: (asin: string) => void
  verFicha: (asin: string) => void
  historial?: { filas: ConsultaHistorica[]; gastoSemanal: GastoSemanal[] | null; cargando: boolean }
  verBusqueda?: (asin: string, consulta: string) => void
  verHoy?: () => void
  verCompetencia?: (asin: string) => void
}) {
  const [anadiendo, setAnadiendo] = useState(false)
  // El producto abierto en su «Resumen» (en la misma pestaña, con «← Todos los productos»)
  const [abierto, setAbierto] = useState<string | null>(null)
  const esOrdenador = useEsOrdenador()

  // Movimientos de la semana y tareas pendientes de cada producto (las «Revisadas» de Qué hacer hoy no cuentan)
  const movimientos = useMemo(() => {
    const m = new Map<string, Movimientos>()
    if (!historial || historial.filas.length === 0) return m
    for (const p of datos.productos) m.set(p.asin, movimientosDe(historial.filas, p.asin, datos.precios?.[p.asin] ?? null))
    return m
  }, [historial, datos.productos, datos.precios])
  const [revisadas, setRevisadas] = useState<Record<string, number>>({})
  useEffect(() => setRevisadas(leerRevisadas(cuentaId)), [cuentaId])
  const tareas = useMemo(
    () =>
      tareasDeLaCuenta(
        { hoy: new Date().toISOString().slice(0, 10), lectura: datos.lectura, productos: datos.productos, fichas: datos.fichas, consultas: datos.consultas, evolucion: datos.evolucion, precios: datos.precios, cambios: datos.cambios },
        { movimientos }
      ).filter((t) => !revisadas[t.id]),
    [datos, movimientos, revisadas]
  )
  // Gasto PPC de las 4 últimas semanas por producto (null sin Marketing Test)
  const gasto4 = (asin: string): number | null => {
    if (!historial?.gastoSemanal) return null
    const delAsin = historial.gastoSemanal.filter((g) => g.asin === asin).sort((a, b) => b.desde.localeCompare(a.desde)).slice(0, 4)
    return delAsin.reduce((s, g) => s + g.gasto, 0)
  }
  const [ocupado, setOcupado] = useState(false)

  async function importar() {
    setOcupado(true)
    try {
      const r = await llamar<{ anadidos: number }>('/api/seo/productos', { metodo: 'POST', cuerpo: { cuenta: cuentaId, accion: 'importar-marketing' } })
      toast.success(r.anadidos > 0 ? `${r.anadidos} productos añadidos desde Marketing Test.` : 'Ya seguías todos los de Marketing Test.')
      recargar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido importar.')
    } finally {
      setOcupado(false)
    }
  }

  async function quitar(id: string, nombre: string) {
    if (!window.confirm(`¿Dejar de seguir «${nombre}»? Sus búsquedas guardadas se quedan, pero no se volverán a leer.`)) return
    try {
      await llamar('/api/seo/productos', { metodo: 'DELETE', cuerpo: { cuenta: cuentaId, id } })
      recargar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido quitar.')
    }
  }

  if (abierto && datos.productos.some((p) => p.asin === abierto)) {
    return (
      <FichaDelProducto
        cuentaId={cuentaId}
        verCompetencia={verCompetencia}
        datos={datos}
        asin={abierto}
        historial={historial?.filas ?? []}
        gastoSemanal={historial?.gastoSemanal ?? null}
        movimientos={movimientos.get(abierto) ?? null}
        tareas={tareas.filter((t) => t.asin === abierto)}
        volver={() => setAbierto(null)}
        verBusquedas={verBusquedas}
        verBusqueda={verBusqueda ?? ((a) => verBusquedas(a))}
        verFicha={verFicha}
        verHoy={verHoy ?? (() => undefined)}
      />
    )
  }

  return (
    <div className="flex max-w-[1240px] flex-col gap-3 pb-8">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setAnadiendo((v) => !v)} className="inline-flex h-[32px] items-center gap-[6px] rounded-[9px] bg-[var(--ls-acc-relleno)] px-3 text-[12.5px] font-semibold text-[var(--ls-acc-tinta)] transition-[filter] hover:brightness-110">
          <Plus className="h-[14px] w-[14px]" /> Añadir productos
        </button>
        <button type="button" disabled={ocupado} onClick={importar} className="inline-flex h-[32px] items-center gap-[6px] rounded-[9px] border border-[var(--ls-linea)] px-3 text-[12.5px] font-medium text-[var(--ls-t2)] transition-colors hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)] disabled:opacity-50">
          <Download className="h-[14px] w-[14px]" /> Traer los de Marketing Test
        </button>
        <span className="text-[12px] text-[var(--ls-t4)]">{datos.productos.length} {datos.productos.length === 1 ? 'producto seguido' : 'productos seguidos'}</span>
      </div>

      {anadiendo && <SelectorDelCatalogo cuentaId={cuentaId} cerrar={() => setAnadiendo(false)} hecho={recargar} />}

      {datos.productos.length === 0 ? (
        <Vacio icono={<Search />} titulo="Todavía no sigues ningún producto en este país">
          Añádelos del catálogo de la cuenta o tráete los mismos que trabajas en Marketing Test. En cuanto haya alguno, el ERP lee su ficha y pide a Amazon las búsquedas donde aparece.
        </Vacio>
      ) : esOrdenador ? (
        <TablaDeProductos datos={datos} abrir={setAbierto} quitar={quitar} movimientos={movimientos} tareas={tareas} gasto4={gasto4} conGasto={!!historial?.gastoSemanal} />
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {datos.productos.map((p) => {
            const ficha = fichaDe(datos, p.asin)
            const mes = consultasDe(datos, p.asin, 'MONTH')
            const consultas = mes.length > 0 ? mes : consultasDe(datos, p.asin, 'WEEK')
            const r = resumenDeProducto(consultas, ficha, datos.precios?.[p.asin] ?? null, decisionesDe(datos))
            const nombre = nombreDe(p, ficha)
            const v = consultas.length > 0 ? diagnosticoDe(datos, p.asin).producto.veredicto : null
            const norma = ficha ? revisarFicha(ficha).incidencias : []
            const graves = norma.filter((i) => i.gravedad === 'grave').length
            return (
              <article key={p.id} className={`${CAJA.base} flex flex-col transition-colors hover:border-[var(--ls-linea2)]`}>
                <div className="flex items-start gap-3 px-4 pb-3 pt-4">
                  <div className="min-w-0 flex-1">
                    <button type="button" onClick={() => setAbierto(p.asin)} className="text-left">
                      <h3 className="line-clamp-2 text-[14px] font-semibold leading-[1.35] text-[var(--ls-t1)]" title={nombre}>{nombre}</h3>
                    </button>
                    <div className="mt-[6px] flex flex-wrap items-center gap-2 text-[11.5px] text-[var(--ls-t4)]">
                      <span className="rounded-[5px] bg-[var(--ls-sup2)] px-[6px] py-[1px] font-mono text-[11px] text-[var(--ls-t3)]">{p.asin}</span>
                      {p.sku && <span className="truncate">{p.sku}</span>}
                      {mes.length === 0 && consultas.length > 0 && <span>· datos de la última semana</span>}
                    </div>
                  </div>
                  <button type="button" onClick={() => quitar(p.id, nombre)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-[var(--ls-t4)] transition-colors hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]" title="Dejar de seguir">
                    <Trash2 className="h-[14px] w-[14px]" />
                  </button>
                </div>
                {/* Cuatro cifras: de dos en dos en el móvil (en cuatro columnas de 80 px cada «6,7 %» partía en dos líneas y las notas en seis) */}
                <div className="grid grid-cols-2 border-t border-[var(--ls-linea)] sm:grid-cols-4">
                  <Dato i={0} etiqueta="Búsquedas" valor={consultas.length > 0 ? entero(r.busquedas) : '—'} nota={consultas.length > 0 ? `${entero(r.volumenTotal)} de volumen` : 'sin datos aún'} />
                  <Dato i={1} etiqueta="Cuota de compras" valor={porcentaje(r.cuotaCompras)} nota="de lo que se compra en sus búsquedas" color={r.cuotaCompras != null && r.cuotaCompras >= 0.1 ? COLOR_ESTADO.verde : undefined} />
                  <Dato i={2} etiqueta="Cuota de impresiones" valor={porcentaje(r.cuotaImpresiones)} nota="cuánto sale cuando se busca" />
                  <Dato i={3} etiqueta="Keywords en la ficha" valor={r.cobertura == null ? '—' : porcentaje(r.cobertura, 0)} nota={r.faltanEnFicha ? `${r.faltanEnFicha} de las 20 principales no están` : ficha ? 'de las 20 principales' : 'ficha sin leer aún'} color={r.cobertura == null ? undefined : r.cobertura >= 0.8 ? COLOR_ESTADO.verde : r.cobertura >= 0.5 ? COLOR_ESTADO.ambar : COLOR_ESTADO.rojo} />
                </div>
                {(v || ficha) && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-[var(--ls-linea)] px-4 py-[8px] text-[11.5px]">
                    {v && (
                      <span className="inline-flex items-center gap-[6px]" title={v.motivo}>
                        <span className="text-[var(--ls-t4)]">Embudo:</span>
                        <span className="rounded-[5px] px-[6px] py-[1px] font-semibold" style={{ color: estiloDeVeredicto(v).color, background: `color-mix(in srgb, ${estiloDeVeredicto(v).color} 13%, transparent)` }}>{estiloDeVeredicto(v).texto}</span>
                        <span className="text-[var(--ls-t3)]">{v.tipo === 'fuga' ? `le toca a ${RESPONSABLE[v.etapa].quien}` : v.tipo === 'infraexpuesta' ? `le toca a ${RESPONSABLE_INFRAEXPUESTA.quien}` : v.tipo === 'visibilidad' ? 'es SEO' : ''}</span>
                      </span>
                    )}
                    {ficha && (
                      <span className="ml-auto" style={{ color: graves > 0 ? COLOR_ESTADO.rojo : norma.length > 0 ? COLOR_ESTADO.ambar : COLOR_ESTADO.verde }} title={norma.map((i) => i.texto).join('\n')}>
                        {graves > 0 ? `Ficha fuera de norma 2026 (${graves})` : norma.length > 0 ? `${norma.length} ${norma.length === 1 ? 'mejora' : 'mejoras'} de norma` : 'Ficha dentro de norma 2026'}
                      </span>
                    )}
                  </div>
                )}
                <Evolucion serie={serieDe(datos, p.asin, 'WEEK')} />
                <div className="flex items-center gap-2 border-t border-[var(--ls-linea)] px-4 py-[10px]">
                  {r.principal ? (
                    <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--ls-t3)]">
                      Búsqueda principal: <span className="font-medium text-[var(--ls-t1)]">{r.principal}</span>
                    </span>
                  ) : (
                    <span className="flex-1 text-[12px] text-[var(--ls-t4)]">Las búsquedas llegan con el informe de Brand Analytics.</span>
                  )}
                  <button type="button" onClick={() => verBusquedas(p.asin)} className="inline-flex h-[28px] items-center gap-[5px] rounded-[8px] px-[9px] text-[12px] font-medium text-[var(--ls-t2)] transition-colors hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]">
                    Búsquedas <ArrowRight className="h-3 w-3" />
                  </button>
                  <button type="button" onClick={() => verFicha(p.asin)} className="inline-flex h-[28px] items-center gap-[5px] rounded-[8px] px-[9px] text-[12px] font-medium text-[var(--ls-t2)] transition-colors hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]">
                    Ficha <ArrowRight className="h-3 w-3" />
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** La cuota de compras semana a semana, en pequeño, con la variación de la última semana. Sin dos semanas no se pinta */
function Evolucion({ serie }: { serie: PuntoDeEvolucion[] }) {
  const puntos = serie.filter((p) => p.cuotaCompras != null)
  if (puntos.length < 2) return null
  const ultima = puntos[puntos.length - 1]
  const previa = puntos[puntos.length - 2]
  const d = ((ultima.cuotaCompras ?? 0) - (previa.cuotaCompras ?? 0)) * 100
  const color = d >= 0 ? COLOR_ESTADO.verde : COLOR_ESTADO.rojo
  return (
    <div className="flex items-center gap-3 border-t border-[var(--ls-linea)] px-4 py-[8px]">
      <span className="text-[11px] text-[var(--ls-t4)]">Cuota de compras, {puntos.length} semanas</span>
      <div className="h-[28px] w-[120px]">
        <Chispa valores={puntos.map((p) => (p.cuotaCompras ?? 0) * 100)} color={color} />
      </div>
      <span className="ml-auto text-[11.5px] font-medium tabular-nums" style={{ color }} title="Frente a la semana anterior">
        {d >= 0 ? '▲' : '▼'} {Math.abs(d).toLocaleString('es-ES', { maximumFractionDigits: 1 })} pt
      </span>
    </div>
  )
}

function Dato({ i, etiqueta, valor, nota, color }: { i: number; etiqueta: string; valor: string; nota: string; color?: string }) {
  // Rayas: en el móvil (2 × 2) a la izquierda de la segunda columna y encima de la segunda fila; en sm (1 × 4) a la izquierda de todas menos la primera
  const rayas = `${i % 2 === 1 ? 'border-l' : i > 0 ? 'sm:border-l' : ''} ${i >= 2 ? 'border-t sm:border-t-0' : ''}`
  return (
    <div className={`min-w-0 border-[var(--ls-linea)] px-4 py-3 ${rayas}`}>
      <div className="truncate text-[11px] text-[var(--ls-t4)]">{etiqueta}</div>
      <div className="mt-[2px] text-[18px] font-semibold tabular-nums tracking-[-0.015em]" style={{ color: color ?? 'var(--ls-t1)' }}>{valor}</div>
      <div className="text-[10.5px] leading-[1.35] text-[var(--ls-t4)]">{nota}</div>
    </div>
  )
}

const esTactil = () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

function SelectorDelCatalogo({ cuentaId, cerrar, hecho }: { cuentaId: string; cerrar: () => void; hecho: () => void }) {
  const [q, setQ] = useState('')
  const [lista, setLista] = useState<Array<{ sku: string; asin: string; titulo: string | null; seguido: boolean }> | null>(null)
  const [elegidos, setElegidos] = useState<ReadonlyMap<string, { asin: string; sku: string; nombre: string | null }>>(new Map())
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    let vivo = true
    setLista(null)
    const t = setTimeout(async () => {
      try {
        const r = await llamar<{ productos: Array<{ sku: string; asin: string; titulo: string | null; seguido: boolean }> }>(`/api/seo/productos?cuenta=${encodeURIComponent(cuentaId)}&q=${encodeURIComponent(q)}`)
        if (vivo) setLista(r.productos)
      } catch (e) {
        if (vivo) toast.error(e instanceof Error ? e.message : 'No se ha podido leer el catálogo.')
      }
    }, q ? 300 : 0)
    return () => {
      vivo = false
      clearTimeout(t)
    }
  }, [cuentaId, q])

  const n = elegidos.size
  const alternar = (p: { asin: string; sku: string; titulo: string | null }) =>
    setElegidos((prev) => {
      const m = new Map(prev)
      if (m.has(p.asin)) m.delete(p.asin)
      else m.set(p.asin, { asin: p.asin, sku: p.sku, nombre: p.titulo })
      return m
    })

  async function guardar() {
    setGuardando(true)
    try {
      await llamar('/api/seo/productos', { metodo: 'POST', cuerpo: { cuenta: cuentaId, productos: [...elegidos.values()] } })
      toast.success(`${n} ${n === 1 ? 'producto añadido' : 'productos añadidos'}.`)
      hecho()
      cerrar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se han podido añadir.')
    } finally {
      setGuardando(false)
    }
  }

  const visibles = useMemo(() => lista ?? [], [lista])

  return (
    <section className={CAJA.base}>
      <header className={`${CAJA.cabecera} justify-between`}>
        <h2 className="text-[13px] font-semibold text-[var(--ls-t1)]">Elegir del catálogo de la cuenta</h2>
        <div className="flex items-center gap-2">
          <button type="button" onClick={cerrar} className="h-[28px] rounded-[8px] px-[10px] [@media(pointer:coarse)]:h-[40px] text-[12px] font-medium text-[var(--ls-t3)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]">Cancelar</button>
          <button type="button" disabled={n === 0 || guardando} onClick={guardar} className="h-[28px] rounded-[8px] [@media(pointer:coarse)]:h-[40px] bg-[var(--ls-acc-relleno)] px-[12px] text-[12px] font-semibold text-[var(--ls-acc-tinta)] disabled:opacity-45">
            {guardando ? 'Añadiendo…' : n === 0 ? 'Elige productos' : `Seguir ${n}`}
          </button>
        </div>
      </header>
      <div className={`${CAJA.cuerpo} flex flex-col gap-2`}>
        <label className="relative">
          <Search className="pointer-events-none absolute left-[10px] top-1/2 h-[13px] w-[13px] -translate-y-1/2 text-[var(--ls-t4)]" />
          {/* Al dedo, 16 px: con menos, Safari del iPhone amplía la página al enfocar y se queda ampliada. Y sin autoFocus en táctil (abría el teclado de golpe y tapaba la lista) */}
          <input autoFocus={!esTactil()} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por SKU, ASIN o título" className="h-[32px] w-full rounded-[9px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] pl-[30px] pr-2 text-[12.5px] text-[var(--ls-t1)] outline-none placeholder:text-[var(--ls-t4)] focus:border-[var(--ls-acc-graf)] [@media(pointer:coarse)]:h-[44px] [@media(pointer:coarse)]:text-[16px]" />
        </label>
        {!lista ? (
          <p className="text-[12px] text-[var(--ls-t4)]">Cargando…</p>
        ) : visibles.length === 0 ? (
          <p className="text-[12px] text-[var(--ls-t4)]">No hay productos con ASIN {q ? 'que coincidan' : 'en el catálogo de este país'}.</p>
        ) : (
          <div className="max-h-[320px] overflow-auto rounded-[10px] border border-[var(--ls-linea)]">
            {visibles.map((p) => {
              const elegido = elegidos.has(p.asin)
              return (
                <label key={`${p.asin}|${p.sku}`} className={`flex cursor-pointer items-center gap-3 border-b border-[var(--ls-linea)] px-3 py-[8px] last:border-b-0 ${p.seguido ? 'opacity-50' : 'hover:bg-[var(--ls-sup2)]'}`}>
                  <input type="checkbox" disabled={p.seguido} checked={p.seguido || elegido} onChange={() => alternar(p)} className="h-4 w-4 accent-[var(--ls-acc-graf)]" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] text-[var(--ls-t1)]">{p.titulo ?? '(sin título)'}</div>
                    <div className="text-[11px] text-[var(--ls-t4)]">{p.asin} · {p.sku}{p.seguido ? ' · ya lo sigues' : ''}</div>
                  </div>
                </label>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}

/** En el ordenador, una tabla: una fila por producto con lo esencial; al pulsarla se abre su resumen */
function TablaDeProductos({
  datos,
  abrir,
  quitar,
  movimientos,
  tareas,
  gasto4,
  conGasto,
}: {
  datos: DatosSeo
  abrir: (asin: string) => void
  quitar: (id: string, nombre: string) => void
  movimientos: ReadonlyMap<string, Movimientos>
  tareas: readonly Tarea[]
  gasto4: (asin: string) => number | null
  conGasto: boolean
}) {
  const sinBa = new Set(datos.lectura.asinsSinBa ?? [])
  const th = 'px-3 py-2 text-left text-[11px] font-medium text-[var(--ls-t4)]'
  const td = 'border-t border-[var(--ls-linea)] px-3 py-[9px] align-middle'
  return (
    <div className={`${CAJA.base} overflow-x-auto`}>
      <table className="w-full min-w-[920px] text-[12.5px]">
        <thead>
          <tr>
            <th className={`${th} pl-4`}>Producto</th>
            <th className={th}>Cuota de compras</th>
            <th className={th}>Embudo</th>
            <th className={th}>Ficha</th>
            <th className={`${th} text-right`}>Tareas</th>
            <th className={th}>Esta semana</th>
            {conGasto && <th className={`${th} text-right`}>PPC 4 sem.</th>}
            <th className={th} />
          </tr>
        </thead>
        <tbody>
          {datos.productos.map((p) => {
            const ficha = fichaDe(datos, p.asin)
            const nombre = nombreDe(p, ficha)
            const mes = consultasDe(datos, p.asin, 'MONTH')
            const consultas = mes.length > 0 ? mes : consultasDe(datos, p.asin, 'WEEK')
            const r = resumenDeProducto(consultas, ficha, datos.precios?.[p.asin] ?? null, decisionesDe(datos))
            const v = consultas.length > 0 ? diagnosticoDe(datos, p.asin).producto.veredicto : null
            const norma = ficha ? revisarFicha(ficha).incidencias : []
            const graves = norma.filter((i) => i.gravedad === 'grave').length
            const serie = serieDe(datos, p.asin, 'WEEK').map((x) => x.cuotaCompras).filter((x): x is number => x != null)
            const mov = movimientos.get(p.asin)
            const nTareas = tareas.filter((t) => t.asin === p.asin).length
            const graveTarea = tareas.some((t) => t.asin === p.asin && t.gravedad === 'grave')
            const g = gasto4(p.asin)
            return (
              <tr key={p.id} className="cursor-pointer hover:[&>td]:bg-[var(--ls-sup2)]" onClick={(ev) => { if (!(ev.target as HTMLElement).closest('button')) abrir(p.asin) }}>
                <td className={`${td} pl-4`}>
                  <div className="max-w-[300px] truncate font-medium text-[var(--ls-t1)]" title={nombre}>{nombre}</div>
                  <div className="flex items-center gap-1.5 text-[11px] text-[var(--ls-t4)]">
                    <span className="font-mono">{p.asin}</span>
                    {sinBa.has(p.asin) && <span className="rounded-[4px] bg-[var(--ls-sup2)] px-1 text-[10.5px] text-[var(--ls-t3)]" title="Amazon no da datos de Brand Analytics de este producto">Sin Brand Analytics</span>}
                  </div>
                </td>
                <td className={td}>
                  <div className="flex items-center gap-2">
                    <span className="w-[52px] tabular-nums text-[var(--ls-t1)]">{porcentaje(r.cuotaCompras)}</span>
                    <div className="w-[80px]"><Chispa valores={serie} color={COLOR_ESTADO.verde} /></div>
                  </div>
                </td>
                <td className={td}>
                  {v ? (
                    <span className="rounded-[5px] px-[6px] py-[1px] text-[11.5px] font-semibold" style={{ color: estiloDeVeredicto(v).color, background: `color-mix(in srgb, ${estiloDeVeredicto(v).color} 13%, transparent)` }} title={v.motivo}>
                      {estiloDeVeredicto(v).texto}
                    </span>
                  ) : (
                    <span className="text-[var(--ls-t4)]">—</span>
                  )}
                </td>
                <td className={td} title={norma.map((i) => i.texto).join('\n')}>
                  {!ficha ? (
                    <span className="text-[var(--ls-t4)]">sin leer</span>
                  ) : (
                    <span style={{ color: graves > 0 ? COLOR_ESTADO.rojo : COLOR_ESTADO.verde }}>{graves > 0 ? `${graves} grave${graves === 1 ? '' : 's'}` : 'OK'}</span>
                  )}
                </td>
                <td className={`${td} text-right tabular-nums`} style={{ color: graveTarea ? COLOR_ESTADO.rojo : nTareas > 0 ? 'var(--ls-t1)' : 'var(--ls-t4)' }}>
                  {nTareas}
                </td>
                <td className={`${td} tabular-nums`}>
                  {mov && mov.semanasLeidas >= 5 ? (
                    <span className="text-[11.5px]">
                      <span style={{ color: COLOR_ESTADO.verde }}>▲{mov.suben.length}</span> <span style={{ color: COLOR_ESTADO.rojo }}>▼{mov.bajan.length}</span>
                      {mov.caidaGeneral && <span className="ml-1 font-semibold" style={{ color: COLOR_ESTADO.rojo }}>caída</span>}
                    </span>
                  ) : (
                    <span className="text-[var(--ls-t4)]">—</span>
                  )}
                </td>
                {conGasto && <td className={`${td} text-right tabular-nums text-[var(--ls-t2)]`}>{g == null ? '—' : entero(Math.round(g))}</td>}
                <td className={`${td} text-right`}>
                  <button type="button" onClick={() => quitar(p.id, nombre)} className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] text-[var(--ls-t4)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]" title="Dejar de seguir">
                    <Trash2 className="h-[14px] w-[14px]" />
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
