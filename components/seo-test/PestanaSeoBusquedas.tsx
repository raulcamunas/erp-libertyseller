'use client'

import { useMemo, useState } from 'react'
import { Megaphone, Search, Swords, TrendingUp } from 'lucide-react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { CAJA, Segmentado, TiraDeCifras } from '@/components/marketing-test/piezas'
import { dinero, entero, porcentaje } from '@/components/marketing-test/formato'
import { Vacio } from '@/components/plataforma/comun'
import { coberturaDe } from '@/lib/seo/cobertura'
import { resumenDeProducto } from '@/lib/seo/resumen'
import type { FilaCompetencia } from '@/lib/seo/datos'
import type { BusquedaSinExacta } from '@/lib/seo/publicidad-calculo'
import { BarraDeCuota, consultasDe, DeltaPuntos, fichaDe, mapaAnterior, Marca, SelectorDeProducto, serieDe } from './comun'
import { useDelProducto } from './useDelProducto'
import type { DatosSeo } from './useCuentaSeo'

type Filtro = 'todas' | 'faltan'

export interface DatosDePublicidad {
  hayMarketingTest: boolean
  campanas: number
  vendePorPublicidad: Array<{ termino: string; pedidos: number; ventas: number; clics: number; gasto: number; faltan: string[] }>
  sinExacta: BusquedaSinExacta[]
}

/**
 * LAS BÚSQUEDAS DE UN PRODUCTO (Brand Analytics): por cada búsqueda de Amazon donde aparece, cuántas veces se buscó, qué parte de las impresiones, clics y compras se llevó y cómo ha cambiado frente al
 * periodo anterior, quién se lleva los clics (los 3 primeros de todo Amazon), a qué precio compra la gente frente al suyo y si la búsqueda está entera en el título, los bullets o el backend.
 * Arriba, la evolución del producto; abajo, las búsquedas que venden y no tienen keyword EXACTA en Marketing Test.
 */
export function PestanaSeoBusquedas({ cuentaId, datos, moneda, asin, setAsin, irAProductos }: { cuentaId: string; datos: DatosSeo; moneda: string | null; asin: string | null; setAsin: (a: string) => void; irAProductos: () => void }) {
  const [periodo, setPeriodo] = useState<'MONTH' | 'WEEK'>('MONTH')
  const [filtro, setFiltro] = useState<Filtro>('todas')
  const [busqueda, setBusqueda] = useState('')

  const ficha = asin ? fichaDe(datos, asin) : null
  const consultas = useMemo(() => (asin ? consultasDe(datos, asin, periodo) : []), [datos, asin, periodo])
  const anterior = useMemo(() => (asin ? mapaAnterior(datos, asin, periodo) : new Map()), [datos, asin, periodo])
  const serie = useMemo(() => (asin ? serieDe(datos, asin, periodo) : []), [datos, asin, periodo])
  const competencia = useDelProducto<{ desde: string | null; filas: FilaCompetencia[]; sinMigracion?: boolean }>(asin && datos.lectura.mejoras ? `/api/seo/competencia?cuenta=${encodeURIComponent(cuentaId)}&asin=${asin}` : null)
  const publicidad = useDelProducto<DatosDePublicidad>(asin ? `/api/seo/publicidad?cuenta=${encodeURIComponent(cuentaId)}&asin=${asin}` : null)
  const top3 = useMemo(() => {
    const m = new Map<string, FilaCompetencia[]>()
    for (const f of competencia.datos?.filas ?? []) {
      const k = f.consulta.trim().toLowerCase()
      m.set(k, [...(m.get(k) ?? []), f].sort((a, b) => a.posicion - b.posicion))
    }
    return m
  }, [competencia.datos])

  const filas = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return consultas
      .map((c) => ({ ...c, cobertura: ficha ? coberturaDe(c.consulta, ficha) : null, previa: anterior.get(c.consulta.trim().toLowerCase()) }))
      .filter((c) => (!q || c.consulta.toLowerCase().includes(q)) && (filtro === 'todas' || (c.cobertura && c.cobertura.faltan.length > 0)))
      .sort((a, b) => (b.volumen ?? 0) - (a.volumen ?? 0))
      .slice(0, 400)
  }, [consultas, ficha, filtro, busqueda, anterior])
  const r = useMemo(() => resumenDeProducto(consultas, ficha), [consultas, ficha])
  const rango = consultas[0] ? `${new Date(`${consultas[0].desde}T00:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' })} – ${new Date(`${consultas[0].hasta}T00:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}` : null
  const previo = serie.length >= 2 ? serie[serie.length - 2] : null
  const conCompetencia = (competencia.datos?.filas.length ?? 0) > 0

  if (datos.productos.length === 0)
    return (
      <Vacio icono={<Search />} titulo="Primero hay que seguir algún producto" accion={<button type="button" onClick={irAProductos} className="h-[30px] rounded-[9px] bg-[var(--ls-acc-relleno)] px-3 text-[12.5px] font-semibold text-[var(--ls-acc-tinta)]">Ir a Productos</button>}>
        Las búsquedas salen del informe de Brand Analytics de los productos que sigues.
      </Vacio>
    )

  return (
    <div className="flex max-w-[1320px] flex-col gap-3 pb-8">
      <div className="flex flex-wrap items-center gap-2">
        <SelectorDeProducto productos={datos.productos} datos={datos} asin={asin} setAsin={setAsin} />
        <Segmentado etiqueta="Periodo" opciones={[{ id: 'MONTH', texto: 'Último mes' }, { id: 'WEEK', texto: 'Última semana' }]} valor={periodo} cambiar={(v) => setPeriodo(v as 'MONTH' | 'WEEK')} />
        <Segmentado etiqueta="Qué búsquedas" opciones={[{ id: 'todas', texto: 'Todas', cuenta: consultas.length }, { id: 'faltan', texto: 'Les falta algo en la ficha', cuenta: ficha ? consultas.filter((c) => coberturaDe(c.consulta, ficha).faltan.length > 0).length : undefined }]} valor={filtro} cambiar={(v) => setFiltro(v as Filtro)} />
        {rango && <span className="text-[11.5px] text-[var(--ls-t4)]">{rango}</span>}
        <label className="relative ml-auto">
          <span className="sr-only">Filtrar búsquedas</span>
          <Search className="pointer-events-none absolute left-[10px] top-[9px] h-[13px] w-[13px] text-[var(--ls-t4)]" />
          <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Filtrar búsquedas" className="h-[30px] w-[220px] rounded-[9px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] pl-[30px] pr-2 text-[12.5px] text-[var(--ls-t1)] outline-none placeholder:text-[var(--ls-t4)] focus:border-[var(--ls-acc-graf)]" />
        </label>
      </div>

      {consultas.length === 0 ? (
        <Vacio icono={<Search />} titulo={datos.lectura.acceso === 'no' ? 'Sin acceso a Brand Analytics en esta cuenta' : 'Todavía no hay búsquedas de este producto'}>
          {datos.lectura.acceso === 'no'
            ? 'Amazon no deja leer el informe: a la app del ERP le falta el rol «Brand Analytics» o el cliente no tiene Brand Registry en este país.'
            : datos.lectura.sincronizando
              ? 'Amazon está preparando el informe. Suele tardar unos minutos; la pantalla se actualiza sola.'
              : 'Amazon no ha devuelto búsquedas de este ASIN en este periodo (puede ser un producto nuevo o con muy poco tráfico).'}
        </Vacio>
      ) : (
        <>
          <TiraDeCifras
            cifras={[
              { etiqueta: 'Búsquedas', valor: entero(r.busquedas), nota: previo ? `antes ${entero(previo.busquedas)}` : undefined },
              { etiqueta: 'Volumen total', valor: entero(r.volumenTotal), nota: previo ? `antes ${entero(previo.volumen)}` : undefined },
              { etiqueta: 'Cuota de impresiones', valor: porcentaje(r.cuotaImpresiones), nota: previo ? `antes ${porcentaje(previo.cuotaImpresiones)}` : undefined },
              { etiqueta: 'Cuota de compras', valor: porcentaje(r.cuotaCompras), color: r.cuotaCompras != null && r.cuotaCompras >= 0.1 ? COLOR_ESTADO.verde : undefined, nota: previo ? `antes ${porcentaje(previo.cuotaCompras)}` : undefined },
              { etiqueta: 'Keywords en la ficha', valor: r.cobertura == null ? '—' : porcentaje(r.cobertura, 0), nota: 'de las 20 principales' },
            ]}
          />

          {datos.lectura.mejoras && <TarjetaDeEvolucion serie={serie} periodo={periodo} />}

          <div className={`${CAJA.base} overflow-x-auto`}>
            <table className={`w-full ${conCompetencia ? 'min-w-[1360px]' : 'min-w-[1120px]'} border-separate border-spacing-0 whitespace-nowrap text-[12.5px]`}>
              <thead>
                <tr className="text-[11px] text-[var(--ls-t4)]">
                  <th className="sticky top-0 bg-[var(--ls-sup2)] px-4 py-[9px] text-left font-semibold">Búsqueda</th>
                  <th className="sticky top-0 bg-[var(--ls-sup2)] px-3 py-[9px] text-right font-semibold">Volumen</th>
                  <th className="sticky top-0 bg-[var(--ls-sup2)] px-3 py-[9px] text-right font-semibold">Tus impresiones</th>
                  <th className="sticky top-0 bg-[var(--ls-sup2)] px-3 py-[9px] text-right font-semibold">Tus clics</th>
                  <th className="sticky top-0 bg-[var(--ls-sup2)] px-3 py-[9px] text-right font-semibold">Tus compras</th>
                  <th className="sticky top-0 bg-[var(--ls-sup2)] px-3 py-[9px] text-right font-semibold" title="Cuota de compras frente al periodo anterior">vs anterior</th>
                  {conCompetencia && <th className="sticky top-0 bg-[var(--ls-sup2)] px-3 py-[9px] text-left font-semibold">Quién se lleva los clics</th>}
                  <th className="sticky top-0 bg-[var(--ls-sup2)] px-3 py-[9px] text-right font-semibold">Precio · tú / mercado</th>
                  <th className="sticky top-0 bg-[var(--ls-sup2)] px-4 py-[9px] text-left font-semibold">En la ficha</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((c) => (
                  <tr key={c.consulta} className="hover:[&>td]:bg-[var(--ls-sup2)]">
                    <td className="border-t border-[var(--ls-linea)] px-4 py-[8px]">
                      <div className="max-w-[260px] whitespace-normal font-medium text-[var(--ls-t1)]">{c.consulta}</div>
                      {c.comprasAsin != null && c.comprasTotal != null && <div className="text-[11px] text-[var(--ls-t4)]">{entero(c.comprasAsin)} de {entero(c.comprasTotal)} compras</div>}
                    </td>
                    <td className="border-t border-[var(--ls-linea)] px-3 py-[8px] text-right tabular-nums text-[var(--ls-t1)]">{entero(c.volumen)}</td>
                    <td className="border-t border-[var(--ls-linea)] px-3 py-[8px] text-right"><BarraDeCuota valor={c.cuotaImpresiones} color={COLOR_ESTADO.cian} /></td>
                    <td className="border-t border-[var(--ls-linea)] px-3 py-[8px] text-right"><BarraDeCuota valor={c.cuotaClics} color={COLOR_ESTADO.azul} /></td>
                    <td className="border-t border-[var(--ls-linea)] px-3 py-[8px] text-right"><BarraDeCuota valor={c.cuotaCompras} color={COLOR_ESTADO.verde} /></td>
                    <td className="border-t border-[var(--ls-linea)] px-3 py-[8px] text-right text-[11.5px]">
                      {c.previa ? <DeltaPuntos actual={c.cuotaCompras} anterior={c.previa.cuotaCompras} /> : anterior.size > 0 ? <span className="text-[var(--ls-t4)]" title="No salía en el periodo anterior">nueva</span> : <span className="text-[var(--ls-t4)]">—</span>}
                    </td>
                    {conCompetencia && (
                      <td className="border-t border-[var(--ls-linea)] px-3 py-[8px]">
                        <Top3 filas={top3.get(c.consulta.trim().toLowerCase()) ?? []} asinPropio={asin} />
                      </td>
                    )}
                    <td className="border-t border-[var(--ls-linea)] px-3 py-[8px] text-right tabular-nums">
                      <span className="text-[var(--ls-t1)]">{dinero(c.precioMedianoAsin, moneda)}</span>
                      <span className="text-[var(--ls-t4)]"> / {dinero(c.precioMedianoTotal, moneda)}</span>
                    </td>
                    <td className="border-t border-[var(--ls-linea)] px-4 py-[8px]">
                      {c.cobertura ? (
                        <div className="flex min-w-[240px] flex-wrap items-center gap-[4px] whitespace-normal">
                          <Marca si={c.cobertura.titulo} texto="Título" />
                          <Marca si={c.cobertura.bullets} texto="Bullets" />
                          <Marca si={c.cobertura.backend} texto="Backend" />
                          {c.cobertura.faltan.length === 0 && !c.cobertura.titulo && !c.cobertura.bullets && !c.cobertura.backend && (
                            <span className="text-[11px] text-[var(--ls-t4)]" title="Todas sus palabras están en la ficha, pero ninguna parte la tiene entera">repartida</span>
                          )}
                          {c.cobertura.faltan.length > 0 && (
                            <span className="text-[11px]" style={{ color: COLOR_ESTADO.ambar }} title="Palabras de la búsqueda que no aparecen en ninguna parte de la ficha">
                              falta: {c.cobertura.faltan.join(', ')}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-[11px] text-[var(--ls-t4)]">ficha sin leer</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <NotaDeCompetencia datos={datos} hay={conCompetencia} desde={competencia.datos?.desde ?? null} />

          <SinExacta publicidad={publicidad.datos} />
          <p className="text-[11px] text-[var(--ls-t4)]">Datos de Brand Analytics (Search Query Performance). «Tus impresiones / clics / compras» es la parte que se llevó este producto de todo lo que pasó en Amazon con esa búsqueda.</p>
        </>
      )}
    </div>
  )
}

function TarjetaDeEvolucion({ serie, periodo }: { serie: ReturnType<typeof serieDe>; periodo: 'MONTH' | 'WEEK' }) {
  const unidad = periodo === 'WEEK' ? 'semanas' : 'meses'
  return (
    <section className={CAJA.base}>
      <header className={CAJA.cabecera}>
        <TrendingUp className="h-[14px] w-[14px] text-[var(--ls-t3)]" />
        <h3 className="text-[13px] font-semibold text-[var(--ls-t1)]">Evolución</h3>
        <span className="text-[11.5px] text-[var(--ls-t4)]">cuota de compras y de impresiones, {periodo === 'WEEK' ? 'semana a semana' : 'mes a mes'}</span>
      </header>
      <div className={CAJA.cuerpo}>
        {serie.length < 2 ? (
          <p className="text-[12px] text-[var(--ls-t3)]">
            Se va llenando sola: hay {serie.length} {serie.length === 1 ? (periodo === 'WEEK' ? 'semana' : 'mes') : unidad}. El ERP pide hacia atrás hasta 8 semanas y 3 meses, uno cada pocos minutos, y después suma uno nuevo cada semana y cada mes.
          </p>
        ) : (
          <div className="h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={serie.map((p) => ({ dia: new Date(`${p.desde}T00:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' }), compras: p.cuotaCompras == null ? null : Number((p.cuotaCompras * 100).toFixed(2)), impresiones: p.cuotaImpresiones == null ? null : Number((p.cuotaImpresiones * 100).toFixed(2)) }))} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--ls-linea)" vertical={false} />
                <XAxis dataKey="dia" tick={{ fontSize: 11, fill: 'var(--ls-t4)' }} tickLine={false} axisLine={{ stroke: 'var(--ls-linea2)' }} interval="preserveStartEnd" minTickGap={18} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--ls-t4)' }} tickLine={false} axisLine={false} width={40} tickFormatter={(v) => `${v} %`} />
                <Tooltip contentStyle={{ background: 'var(--ls-sup)', border: '1px solid var(--ls-linea2)', borderRadius: 6, fontSize: 12, color: 'var(--ls-t1)' }} labelStyle={{ color: 'var(--ls-t3)' }} formatter={(v: number, nombre: string) => [`${v.toLocaleString('es-ES', { maximumFractionDigits: 2 })} %`, nombre]} />
                <Line type="monotone" dataKey="compras" name="Cuota de compras" stroke={COLOR_ESTADO.verde} strokeWidth={2} dot={{ r: 2.5 }} connectNulls />
                <Line type="monotone" dataKey="impresiones" name="Cuota de impresiones" stroke={COLOR_ESTADO.cian} strokeWidth={2} dot={{ r: 2.5 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </section>
  )
}

/** Los 3 ASIN que más clics se llevan en una búsqueda (de todo Amazon), con su cuota de clics; el propio, marcado */
function Top3({ filas, asinPropio }: { filas: FilaCompetencia[]; asinPropio: string | null }) {
  if (filas.length === 0) return <span className="text-[11px] text-[var(--ls-t4)]">—</span>
  return (
    <div className="flex flex-col gap-[3px]">
      {filas.map((f) => {
        const tuyo = f.asin === asinPropio
        return (
          <span
            key={f.posicion}
            className="inline-flex w-fit items-center gap-[6px] rounded-[5px] px-[5px] py-[1px] text-[11px] tabular-nums"
            style={tuyo ? { color: COLOR_ESTADO.verde, background: `color-mix(in srgb, ${COLOR_ESTADO.verde} 13%, transparent)` } : { color: 'var(--ls-t2)' }}
            title={`${f.posicion}º en clics · se lleva el ${porcentaje(f.cuotaClics)} de los clics y el ${porcentaje(f.cuotaConversion)} de las compras${tuyo ? ' · es tu producto' : ''}`}
          >
            <span className="text-[var(--ls-t4)]">{f.posicion}.</span>
            <span className="font-mono">{f.asin}</span>
            <span>{porcentaje(f.cuotaClics)}</span>
            {tuyo && <span className="font-semibold">tú</span>}
          </span>
        )
      })}
    </div>
  )
}

function NotaDeCompetencia({ datos, hay, desde }: { datos: DatosSeo; hay: boolean; desde: string | null }) {
  const l = datos.lectura
  if (!l.mejoras) return null
  let texto: string
  if (hay && desde) texto = `«Quién se lleva los clics»: los 3 productos con más clics en esa búsqueda en todo Amazon, de la semana del ${new Date(`${desde}T00:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', timeZone: 'UTC' })} (informe de los términos más buscados de Brand Analytics).`
  else if (l.competenciaEnCurso) texto = 'Amazon está preparando el informe de los términos más buscados del país (la competencia de cada búsqueda). Es grande: puede tardar un rato.'
  else if (l.competenciaError) texto = l.competenciaError
  else texto = 'La competencia de cada búsqueda llega con el informe semanal de los términos más buscados, en cuanto el mes y la semana estén leídos.'
  return (
    <p className="flex items-start gap-2 text-[11.5px] text-[var(--ls-t4)]">
      <Swords className="mt-[2px] h-3 w-3 shrink-0" /> {texto}
    </p>
  )
}

function SinExacta({ publicidad }: { publicidad: DatosDePublicidad | null }) {
  if (!publicidad || !publicidad.hayMarketingTest || publicidad.campanas === 0) return null
  return (
    <section className={CAJA.base}>
      <header className={CAJA.cabecera}>
        <Megaphone className="h-[14px] w-[14px] text-[var(--ls-t3)]" />
        <h3 className="text-[13px] font-semibold text-[var(--ls-t1)]">Búsquedas que venden sin keyword EXACTA en Marketing Test</h3>
        <span className="ml-auto text-[11.5px] text-[var(--ls-t4)]">{publicidad.campanas} campañas del producto · solo sugerencias</span>
      </header>
      {publicidad.sinExacta.length === 0 ? (
        <p className={`${CAJA.cuerpo} text-[12.5px]`} style={{ color: COLOR_ESTADO.verde }}>Todas las búsquedas con compras ya tienen su keyword exacta.</p>
      ) : (
        <div className="flex flex-col divide-y divide-[var(--ls-linea)]">
          {publicidad.sinExacta.map((b) => (
            <div key={b.consulta} className="flex items-center gap-3 px-4 py-[8px]">
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-[var(--ls-t1)]">{b.consulta}</span>
              {b.enOtraConcordancia && <span className="rounded-[5px] bg-[var(--ls-sup2)] px-[6px] py-[1px] text-[10.5px] text-[var(--ls-t3)]" title="Ya se puja por ella en amplia o frase, pero no en exacta">en amplia/frase</span>}
              <span className="w-[120px] text-right text-[11.5px] tabular-nums text-[var(--ls-t3)]">{entero(b.comprasTotal)} compras</span>
              <span className="w-[110px] text-right text-[11.5px] tabular-nums text-[var(--ls-t4)]">{entero(b.volumen)} búsquedas</span>
              <span className="w-[80px] text-right text-[11.5px] tabular-nums text-[var(--ls-t3)]" title="Tu cuota de compras en esa búsqueda">{porcentaje(b.cuotaCompras)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
