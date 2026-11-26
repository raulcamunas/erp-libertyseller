'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import { Calendar, ChevronDown, ChevronRight, Download, Flame, GitCompareArrows, Globe, Loader2 } from 'lucide-react'
import { Segmentado } from '@/components/ui-ls'
import { sumarDias, totalizar, variacion, type FilaPanel, type Totales } from '@/lib/ventas/panel'
import type { CuentaDelPanel, LineaDelPanel } from '@/lib/ventas/panel-servidor'
import { AltoEstable, bandera, Buscador, entero, euros, fechaCorta, pais, pct, ROJO, TablaPedidos, TablaProductos, VERDE, type Agrupar } from './piezas'
import { cubetas, Fila, lunesDe, Menu, menosUnAnio, MODOS, RangoLibre, type Cubeta, type Modo } from './VistaGrafico'

/**
 * VENTAS · LA VISTA «P&L» (la cuenta de resultados por periodos, como la de Sellerboard). Una fila por concepto (con su detalle desplegable) y una columna por
 * mes, semana o día, del más reciente al más antiguo, y el total. Se compara cada columna con el periodo anterior o con el mismo del año anterior (el porcentaje
 * debajo de cada cifra), y el mapa de calor colorea cada fila de peor a mejor. Pulsar una columna enseña sus productos y pedidos abajo. Se exporta a CSV.
 */

type Datos = { filas: FilaPanel[]; productos: { titulos: Record<string, { titulo: string | null; asin: string | null }>; costes: Record<string, number> } | null; lineas: LineaDelPanel[] | null }
type Comparar = 'no' | 'anterior' | 'anio'
type Formato = 'euros' | 'numero' | 'porcentaje'

interface FilaPyG {
  id: string
  texto: string
  valor: (t: Totales) => number | null
  formato: Formato
  /** Cuanto más alto, mejor (ventas, ganancia) o peor (reembolsos, tasa de reembolso). Para los gastos (negativos) más alto también es mejor */
  mejor?: 'sube' | 'baja'
  fuerte?: boolean
  hijos?: FilaPyG[]
  gris?: boolean
}

const FILAS: FilaPyG[] = [
  {
    id: 'ventas',
    texto: 'Ventas',
    valor: (t) => t.ventas,
    formato: 'euros',
    fuerte: true,
    hijos: [
      { id: 'ventasOrg', texto: 'Orgánico', valor: (t) => t.ventas - t.ventasPpc, formato: 'euros' },
      { id: 'ventasPpc', texto: 'Publicidad (mismo día)', valor: (t) => t.ventasPpc, formato: 'euros' },
    ],
  },
  {
    id: 'unidades',
    texto: 'Unidades',
    valor: (t) => t.unidades,
    formato: 'numero',
    hijos: [
      { id: 'udsOrg', texto: 'Orgánico', valor: (t) => t.unidades - t.unidadesPpc, formato: 'numero' },
      { id: 'udsPpc', texto: 'Publicidad (mismo día)', valor: (t) => t.unidadesPpc, formato: 'numero' },
    ],
  },
  { id: 'pedidos', texto: 'Pedidos', valor: (t) => t.pedidos, formato: 'numero' },
  { id: 'reembolsos', texto: 'Reembolsos', valor: (t) => t.reembolsos, formato: 'numero', mejor: 'baja' },
  { id: 'promo', texto: 'Promociones', valor: (t) => -t.promo, formato: 'euros' },
  { id: 'publicidad', texto: 'Costes publicitarios', valor: (t) => -t.publicidad, formato: 'euros' },
  {
    id: 'costeReembolso',
    texto: 'Coste de reembolso',
    valor: (t) => t.costeReembolso,
    formato: 'euros',
    hijos: [
      { id: 'devuelto', texto: 'Importe reembolsado', valor: (t) => -t.reembolsado, formato: 'euros' },
      { id: 'comDevueltas', texto: 'Comisiones que devuelve Amazon', valor: (t) => t.costeReembolso + t.reembolsado, formato: 'euros' },
    ],
  },
  {
    id: 'tarifas',
    texto: 'Tarifas de Amazon',
    valor: (t) => t.tarifas,
    formato: 'euros',
    hijos: [
      { id: 'referral', texto: 'Comisión de venta', valor: (t) => t.referral, formato: 'euros' },
      { id: 'fba', texto: 'Logística de Amazon (FBA)', valor: (t) => t.fba, formato: 'euros' },
      { id: 'otras', texto: 'Otras (envío retenido, suscripción, almacenamiento…)', valor: (t) => t.otras, formato: 'euros' },
    ],
  },
  { id: 'cogs', texto: 'Coste de los productos', valor: (t) => -t.cogs, formato: 'euros' },
  { id: 'iva', texto: 'IVA', valor: (t) => -t.iva, formato: 'euros' },
  { id: 'ajustes', texto: 'Ajustes y reembolsos de Amazon', valor: (t) => t.ajustes, formato: 'euros' },
  { id: 'bruto', texto: 'Ganancia bruta', valor: (t) => t.bruto, formato: 'euros' },
  { id: 'neto', texto: 'Ganancia neta', valor: (t) => t.neto, formato: 'euros', fuerte: true },
  { id: 'tacos', texto: 'TACOS', valor: (t) => t.tacos, formato: 'porcentaje', mejor: 'baja', gris: true },
  { id: 'tasa', texto: 'Tasa de reembolso', valor: (t) => t.tasaReembolso, formato: 'porcentaje', mejor: 'baja', gris: true },
  { id: 'margen', texto: 'Margen', valor: (t) => t.margen, formato: 'porcentaje', gris: true },
  { id: 'roi', texto: 'ROI', valor: (t) => t.roi, formato: 'porcentaje', gris: true },
  { id: 'precio', texto: 'Precio medio de venta', valor: (t) => t.precioMedio, formato: 'euros', gris: true },
]

async function pedir<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: 'no-store' })
  const j = (await r.json().catch(() => null)) as (T & { error?: string }) | null
  if (!r.ok) throw new Error(j?.error ?? `Error ${r.status}`)
  return j as T
}

const fmt = (f: Formato, v: number | null) => (v == null ? '—' : f === 'euros' ? euros(v) : f === 'porcentaje' ? pct(v, 2) : entero(v))

/** Un periodo antes (para comparar la columna más antigua con su anterior) */
function haciaAtras(modo: Modo, desde: string, hasta: string): string {
  if (modo === 'dias') return sumarDias(desde, -1)
  if (modo === 'semanas') return sumarDias(lunesDe(desde), -7)
  if (modo === 'meses') {
    const d = new Date(`${desde}T00:00:00Z`)
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 10)
  }
  return sumarDias(desde, -(Math.round((Date.parse(hasta) - Date.parse(desde)) / 86_400_000) + 1))
}

export function VistaPyG({ cuenta, hoy, skus }: { cuenta: CuentaDelPanel; hoy: string; skus: Set<string> | null }) {
  const [modo, setModo] = useState<Modo>('meses')
  const [rango, setRango] = useState({ desde: sumarDias(hoy, -89), hasta: hoy })
  const [comparar, setComparar] = useState<Comparar>('anterior')
  const [calor, setCalor] = useState(false)
  const [mercados, setMercados] = useState<Set<string> | null>(null)
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set())
  const [columna, setColumna] = useState<string | null>(null)
  const [pestana, setPestana] = useState<'productos' | 'pedidos'>('productos')
  const [agrupar, setAgrupar] = useState<Agrupar>('sku')
  const [buscar, setBuscar] = useState('')
  const [datos, setDatos] = useState<Datos | null>(null)
  const [anio, setAnio] = useState<FilaPanel[]>([])
  const [lineas, setLineas] = useState<LineaDelPanel[] | null>(null)
  const [cargando, setCargando] = useState(false)

  const rangoTotal = useMemo(() => {
    if (modo === 'dias') return { desde: sumarDias(hoy, -29), hasta: hoy }
    if (modo === 'semanas') return { desde: lunesDe(sumarDias(hoy, -12 * 7)), hasta: hoy }
    if (modo === 'meses') {
      const d = new Date(`${hoy}T00:00:00Z`)
      return { desde: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 12, 1)).toISOString().slice(0, 10), hasta: hoy }
    }
    return rango
  }, [modo, rango, hoy])
  const extra = haciaAtras(modo, rangoTotal.desde, rangoTotal.hasta)
  // Con un periodo más por detrás, para comparar la columna más antigua con la anterior
  const todas = useMemo(() => cubetas(modo, extra, rangoTotal.hasta), [modo, extra, rangoTotal.hasta])
  const columnas = useMemo(() => todas.filter((c) => c.hasta >= rangoTotal.desde).reverse(), [todas, rangoTotal.desde])
  useEffect(() => setColumna(null), [modo, rangoTotal])

  useEffect(() => {
    let vivo = true
    setCargando(true)
    const a = pedir<Datos>(`/api/ventas?cuenta=${cuenta.id}&desde=${extra}&hasta=${rangoTotal.hasta}`)
    const b = comparar === 'anio' ? pedir<Datos>(`/api/ventas?cuenta=${cuenta.id}&desde=${menosUnAnio(rangoTotal.desde)}&hasta=${menosUnAnio(rangoTotal.hasta)}&productos=0`) : Promise.resolve({ filas: [] as FilaPanel[], productos: null, lineas: null })
    Promise.all([a, b])
      .then(([x, y]) => {
        if (!vivo) return
        setDatos(x)
        setAnio(y.filas)
      })
      .finally(() => vivo && setCargando(false))
    return () => {
      vivo = false
    }
  }, [cuenta.id, extra, rangoTotal, comparar])

  const filtrar = (fs: readonly FilaPanel[]) => fs.filter((f) => (!mercados || mercados.has(f.mkt)) && (!skus || skus.has(f.sku)))
  const filas = useMemo(() => filtrar(datos?.filas ?? []), [datos, mercados, skus]) // eslint-disable-line react-hooks/exhaustive-deps
  const filasAnio = useMemo(() => filtrar(anio), [anio, mercados, skus]) // eslint-disable-line react-hooks/exhaustive-deps
  const costes = useMemo(() => datos?.productos?.costes ?? {}, [datos])
  const titulos = useMemo(() => datos?.productos?.titulos ?? {}, [datos])
  const iva = useMemo(() => ({ pct: cuenta.iva, porPais: cuenta.ivaPorPais }), [cuenta.iva, cuenta.ivaPorPais])
  const mercadosConDatos = useMemo(() => [...new Set((datos?.filas ?? []).map((f) => f.mkt))].sort((a, b) => pais(a).localeCompare(pais(b), 'es')), [datos])

  const tDe = (c: Cubeta, fs: readonly FilaPanel[] = filas) => totalizar(fs.filter((f) => f.dia >= c.desde && f.dia <= c.hasta), iva, costes)
  const totales = useMemo(() => columnas.map((c) => tDe(c)), [columnas, filas, iva, costes]) // eslint-disable-line react-hooks/exhaustive-deps
  const totalGeneral = useMemo(() => totalizar(filas.filter((f) => f.dia >= rangoTotal.desde && f.dia <= rangoTotal.hasta), iva, costes), [filas, rangoTotal, iva, costes])
  const anteriores: Array<Totales | null> = useMemo(() => {
    if (comparar === 'no') return columnas.map(() => null)
    if (comparar === 'anio') return columnas.map((c) => tDe({ ...c, desde: menosUnAnio(c.desde), hasta: menosUnAnio(c.hasta) }, filasAnio))
    return columnas.map((c) => {
      const i = todas.findIndex((x) => x.clave === c.clave)
      return i > 0 ? tDe(todas[i - 1]) : null
    })
  }, [columnas, todas, comparar, filas, filasAnio, iva, costes]) // eslint-disable-line react-hooks/exhaustive-deps

  const colElegida = columnas.find((c) => c.clave === columna) ?? null
  const rangoDetalle = colElegida ?? rangoTotal
  const filasDetalle = useMemo(() => filas.filter((f) => f.dia >= rangoDetalle.desde && f.dia <= rangoDetalle.hasta), [filas, rangoDetalle])

  useEffect(() => {
    if (pestana !== 'pedidos') return
    let vivo = true
    setLineas(null)
    pedir<Datos>(`/api/ventas?cuenta=${cuenta.id}&desde=${rangoDetalle.desde}&hasta=${rangoDetalle.desde}&productos=0&lineasDesde=${rangoDetalle.desde}&lineasHasta=${rangoDetalle.hasta}`)
      .then((r) => vivo && setLineas(r.lineas ?? []))
      .catch(() => vivo && setLineas([]))
    return () => {
      vivo = false
    }
  }, [pestana, cuenta.id, rangoDetalle.desde, rangoDetalle.hasta])

  const titulo = (c: Cubeta, i: number) => (modo === 'meses' ? (i === 0 ? `${fechaCorta(c.desde).slice(0, 5)} – ${fechaCorta(c.hasta).slice(0, 5)}` : new Date(`${c.desde}T00:00:00Z`).toLocaleDateString('es-ES', { month: 'long', year: c.desde.slice(0, 4) === hoy.slice(0, 4) ? undefined : 'numeric', timeZone: 'UTC' })) : c.desde === c.hasta ? fechaCorta(c.desde).slice(0, 5) : `${fechaCorta(c.desde).slice(0, 5)} – ${fechaCorta(c.hasta).slice(0, 5)}`)

  /** El mapa de calor de una fila: cada valor entre el peor y el mejor de la fila, de rojo a verde */
  const tinte = (f: FilaPyG, i: number) => {
    if (!calor) return undefined
    const vals = totales.map((t) => f.valor(t)).filter((v): v is number => v != null)
    const v = f.valor(totales[i])
    if (v == null || vals.length < 2) return undefined
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    if (max === min) return undefined
    let x = (v - min) / (max - min)
    if (f.mejor === 'baja') x = 1 - x
    const color = x >= 0.5 ? VERDE : ROJO
    const fuerza = Math.round(Math.abs(x - 0.5) * 2 * 34)
    return { background: `color-mix(in srgb, ${color} ${fuerza}%, transparent)` }
  }

  const exportar = () => {
    const filasCsv: string[][] = [['Concepto', ...columnas.map((c, i) => titulo(c, i)), 'Total']]
    const recorrer = (f: FilaPyG, nivel: number) => {
      filasCsv.push([`${nivel ? '  ' : ''}${f.texto}`, ...totales.map((t) => numCsv(f, f.valor(t))), numCsv(f, f.valor(totalGeneral))])
      f.hijos?.forEach((h) => recorrer(h, 1))
    }
    FILAS.forEach((f) => recorrer(f, 0))
    const blob = new Blob(['﻿' + filasCsv.map((r) => r.join(';')).join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `pyg-${(cuenta.cliente ?? cuenta.nombre).toLowerCase().replace(/\s+/g, '-')}-${rangoTotal.desde}-${rangoTotal.hasta}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const fila = (f: FilaPyG, nivel: number) => {
    const abierta = abiertas.has(f.id)
    return (
      <Fragment key={f.id}>
        <tr className={`border-b border-[var(--ls-linea)] ${f.gris ? 'bg-[color-mix(in_srgb,var(--ls-sup2)_55%,transparent)]' : ''} ${f.fuerte ? 'bg-[color-mix(in_srgb,var(--ls-sup2)_45%,transparent)]' : ''}`}>
          <td className="sticky left-0 z-[1] min-w-[230px] bg-[var(--ls-sup)] px-3 py-[9px]" style={{ paddingLeft: 12 + nivel * 20 }}>
            <button type="button" disabled={!f.hijos} onClick={() => setAbiertas((s) => { const n = new Set(s); if (n.has(f.id)) n.delete(f.id); else n.add(f.id); return n })} className="flex items-center gap-[6px] text-left disabled:cursor-default">
              <span className="w-[13px] text-[var(--ls-t4)]">{f.hijos ? abierta ? <ChevronDown className="h-[13px] w-[13px]" /> : <ChevronRight className="h-[13px] w-[13px]" /> : null}</span>
              <span className={`text-[12.5px] ${f.fuerte ? 'font-semibold text-[var(--ls-t1)]' : nivel ? 'text-[var(--ls-t3)]' : 'text-[var(--ls-t2)]'}`}>{f.texto}</span>
            </button>
          </td>
          {totales.map((t, i) => {
            const v = f.valor(t)
            const ant = anteriores[i] ? f.valor(anteriores[i] as Totales) : null
            const d = comparar !== 'no' && v != null && f.formato !== 'porcentaje' ? variacion(v, ant) : null
            const bueno = d == null ? null : (f.mejor === 'baja' ? d <= 0 : d >= 0)
            return (
              <td key={columnas[i].clave} onClick={() => setColumna((x) => (x === columnas[i].clave ? null : columnas[i].clave))} className={`cursor-pointer whitespace-nowrap px-3 py-[7px] text-right tabular-nums transition-colors ${columna === columnas[i].clave ? 'bg-[color-mix(in_srgb,#F26212_9%,transparent)]' : i === 0 ? 'bg-[color-mix(in_srgb,var(--ls-sup2)_60%,transparent)]' : ''}`} style={tinte(f, i)}>
                <div className={`text-[12.5px] ${f.fuerte ? 'font-semibold' : ''}`} style={{ color: f.id === 'neto' && v != null ? (v >= 0 ? VERDE : ROJO) : nivel ? 'var(--ls-t3)' : 'var(--ls-t1)' }}>
                  {fmt(f.formato, v)}
                </div>
                {d != null && Math.abs(d) >= 0.005 && (
                  <div className="text-[10px]" style={{ color: bueno ? VERDE : ROJO }}>
                    {d >= 0 ? '+' : '−'}
                    {Math.abs(Math.round(d * 100)).toLocaleString('es-ES')} %
                  </div>
                )}
              </td>
            )
          })}
          <td className="whitespace-nowrap border-l border-[var(--ls-linea)] px-3 text-right text-[12.5px] font-semibold tabular-nums text-[var(--ls-t1)]">{fmt(f.formato, f.valor(totalGeneral))}</td>
        </tr>
        {abierta && f.hijos?.map((h) => fila(h, nivel + 1))}
      </Fragment>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Menu icono={Calendar} texto={modo === 'rango' ? `${fechaCorta(rango.desde)} – ${fechaCorta(rango.hasta)}` : (MODOS.find((m) => m.id === modo)?.texto ?? '')}>
          {(cerrar) => (
            <>
              {MODOS.map((m) => (
                <Fila key={m.id} activa={modo === m.id} onClick={() => (setModo(m.id), cerrar())}>
                  {m.texto}
                </Fila>
              ))}
              <RangoLibre inicial={rango} hoy={hoy} activo={modo === 'rango'} onAplicar={(r) => (setRango(r), setModo('rango'), cerrar())} />
            </>
          )}
        </Menu>
        <Menu icono={Globe} texto={!mercados ? 'Todos los países' : `${mercados.size} ${mercados.size === 1 ? 'país' : 'países'}`}>
          {() => (
            <>
              <Fila activa={!mercados} onClick={() => setMercados(null)}>
                Todos los países
              </Fila>
              {mercadosConDatos.map((m) => (
                <Fila
                  key={m}
                  activa={!mercados || mercados.has(m)}
                  onClick={() => {
                    const base = new Set(mercados ?? mercadosConDatos)
                    if (base.has(m)) base.delete(m)
                    else base.add(m)
                    setMercados(base.size === mercadosConDatos.length || base.size === 0 ? null : base)
                  }}
                >
                  {bandera(m)} {pais(m)}
                </Fila>
              ))}
            </>
          )}
        </Menu>
        <Menu icono={GitCompareArrows} texto={comparar === 'no' ? 'Sin comparar' : comparar === 'anterior' ? 'Comparar con el periodo anterior' : 'Comparar año sobre año'}>
          {(cerrar) => (
            <>
              {(
                [
                  ['no', 'No comparar'],
                  ['anterior', 'Comparar con el periodo anterior'],
                  ['anio', 'Comparar año sobre año'],
                ] as Array<[Comparar, string]>
              ).map(([v, t]) => (
                <Fila key={v} activa={comparar === v} onClick={() => (setComparar(v), cerrar())}>
                  {t}
                </Fila>
              ))}
            </>
          )}
        </Menu>
        <button type="button" onClick={() => setCalor((x) => !x)} className="inline-flex h-9 items-center gap-2 rounded-[11px] border px-3 text-[12.5px] transition-colors" style={calor ? { borderColor: 'color-mix(in srgb, #F26212 50%, var(--ls-linea))', color: 'var(--ls-t1)', background: 'color-mix(in srgb, #F26212 10%, transparent)' } : { borderColor: 'var(--ls-linea)', color: 'var(--ls-t2)', background: 'var(--ls-sup)' }}>
          <Flame className="h-[14px] w-[14px]" style={{ color: calor ? '#FF8A3D' : 'var(--ls-t4)' }} />
          Mapa de calor {calor ? 'activado' : 'desactivado'}
        </button>
        {cargando && <Loader2 className="h-[14px] w-[14px] animate-spin text-[var(--ls-t4)]" />}
        <button type="button" onClick={exportar} title="Pulsa una columna de la tabla para ver sus productos y pedidos abajo" className="ml-auto inline-flex h-9 items-center gap-2 rounded-[11px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 text-[12.5px] text-[var(--ls-t2)] hover:text-[var(--ls-t1)]">
          <Download className="h-[14px] w-[14px]" /> Exportar
        </button>
      </div>

      <section className="overflow-hidden rounded-[20px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="sticky left-0 z-[2] border-b border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 py-3 text-left text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--ls-t4)]">Concepto</th>
                {columnas.map((c, i) => (
                  <th key={c.clave} onClick={() => setColumna((x) => (x === c.clave ? null : c.clave))} className={`cursor-pointer whitespace-nowrap border-b px-3 py-3 text-right text-[11.5px] font-semibold capitalize transition-colors ${columna === c.clave ? 'border-[#F26212] text-[var(--ls-t1)]' : 'border-[var(--ls-linea)] text-[var(--ls-t3)] hover:text-[var(--ls-t1)]'}`}>
                    {titulo(c, i)}
                  </th>
                ))}
                <th className="border-b border-l border-[var(--ls-linea)] px-3 py-3 text-right text-[11.5px] font-semibold text-[var(--ls-t2)]">Total</th>
              </tr>
            </thead>
            <tbody>{FILAS.map((f) => fila(f, 0))}</tbody>
          </table>
        </div>
      </section>

      <section className="overflow-hidden rounded-[20px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
        <div className="flex flex-wrap items-center gap-3 border-b border-[var(--ls-linea)] px-5 py-4">
          <div className="mr-2">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--ls-t4)]">Detalle</div>
            <div className="mt-1 text-[15px] font-semibold capitalize text-[var(--ls-t1)]">{colElegida ? titulo(colElegida, columnas.indexOf(colElegida)) : 'Todos los periodos'}</div>
          </div>
          <Segmentado etiqueta="Vista" tamano="sm" valor={pestana} onCambio={setPestana} opciones={[{ id: 'productos', texto: 'Productos' }, { id: 'pedidos', texto: 'Pedidos' }]} />
          {pestana === 'productos' && <Segmentado etiqueta="Agrupar por" tamano="sm" valor={agrupar} onCambio={setAgrupar} opciones={[{ id: 'sku', texto: 'SKU' }, { id: 'asin', texto: 'ASIN' }, { id: 'mercado', texto: 'País' }]} />}
          <span className="ml-auto" />
          <Buscador valor={buscar} onCambio={setBuscar} />
        </div>
        <AltoEstable clave={pestana}>
          {pestana === 'productos' ? (
          <TablaProductos filas={filasDetalle} ivaPct={iva} costes={costes} titulos={titulos} buscar={buscar} agrupar={agrupar} />
        ) : lineas == null ? (
          <p className="flex items-center justify-center gap-2 py-10 text-[12.5px] text-[var(--ls-t4)]">
            <Loader2 className="h-[14px] w-[14px] animate-spin" /> Cargando los pedidos…
          </p>
        ) : (
          <TablaPedidos lineas={lineas.filter((l) => (!mercados || mercados.has(l.mkt)) && (!skus || skus.has(l.sku)))} titulos={titulos} ivaPct={iva} costes={costes} buscar={buscar} />
        )}
        </AltoEstable>
      </section>
    </div>
  )
}

function numCsv(f: FilaPyG, v: number | null) {
  if (v == null) return ''
  return (f.formato === 'porcentaje' ? (v * 100).toFixed(2) : String(Math.round(v * 100) / 100)).replace('.', ',')
}
