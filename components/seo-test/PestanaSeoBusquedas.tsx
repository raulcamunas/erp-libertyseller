'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Ban, Download, Megaphone, Search, Swords, TrendingUp, Undo2 } from 'lucide-react'
import { llamar } from '@/components/marketing-test/llamar'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { CAJA, Segmentado } from '@/components/marketing-test/piezas'
import { dinero, entero, porcentaje } from '@/components/marketing-test/formato'
import { Vacio } from '@/components/plataforma/comun'
import { coberturaDe } from '@/lib/seo/cobertura'
import { resumenDeProducto } from '@/lib/seo/resumen'
import type { ConsultaGuardada, FilaCompetencia } from '@/lib/seo/datos'
import type { Veredicto } from '@/lib/seo/embudo'
import type { BusquedaSinExacta } from '@/lib/seo/publicidad-calculo'
import { ChipAjena, consultasDe, decisionesDe, DeltaPuntos, DeslizableEnMovil, diagnosticoDe, EmbudoMini, EtiquetaDeVeredicto, estiloDeVeredicto, fichaDe, mapaAnterior, Marca, SelectorDeProducto, serieDe, TarjetaDeEmbudo, TiraDeCifrasSeo, useEsOrdenador } from './comun'
import { claveDeBusqueda, esRelevante } from '@/lib/seo/embudo'
import { useDelProducto } from './useDelProducto'
import type { DatosSeo } from './useCuentaSeo'

type Filtro = 'todas' | 'faltan' | 'seo' | 'no-seo' | 'descartadas'
type Orden = 'volumen' | 'impacto'

export interface DatosDePublicidad {
  hayMarketingTest: boolean
  campanas: number
  vendePorPublicidad: Array<{ termino: string; pedidos: number; ventas: number; clics: number; gasto: number; faltan: string[] }>
  sinExacta: BusquedaSinExacta[]
}

/**
 * LAS BÚSQUEDAS DE UN PRODUCTO (Brand Analytics): por cada búsqueda de Amazon donde aparece, cuántas veces se buscó, qué parte de las impresiones, clics y compras se llevó y cómo ha cambiado frente al
 * periodo anterior, quién se lleva los clics (los 3 primeros de todo Amazon), a qué precio compra la gente frente al suyo y si la búsqueda está entera en el título, los bullets o el backend.
 * Arriba, el embudo del producto entero (dónde se cae y de quién es el trabajo, según el SOP) y su evolución; en cada búsqueda, su diagnóstico; abajo, las búsquedas que venden y no tienen keyword
 * EXACTA en Marketing Test. Se puede descargar en CSV para trabajarla fuera.
 *
 * «No es nuestro producto» (migración 333) guarda la búsqueda como ajena para toda la cuenta y país: deja de contar para la ficha, las tareas y la IA. «Sí es nuestro» quita el chip «¿Ajena?» de la
 * heurística. Las dos se deshacen desde la misma fila.
 */
export function PestanaSeoBusquedas({ cuentaId, datos, moneda, asin, setAsin, irAProductos, recargar }: { cuentaId: string; datos: DatosSeo; moneda: string | null; asin: string | null; setAsin: (a: string) => void; irAProductos: () => void; recargar?: () => void }) {
  const [periodo, setPeriodo] = useState<'MONTH' | 'WEEK'>('MONTH')
  const [filtro, setFiltro] = useState<Filtro>('todas')
  const [orden, setOrden] = useState<Orden>('impacto')
  const [busqueda, setBusqueda] = useState('')
  const esOrdenador = useEsOrdenador()

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

  // Lo que se acaba de marcar en esta pantalla, mientras llega la recarga (así la fila cambia al instante)
  const [marcadas, setMarcadas] = useState<Map<string, 'ajena' | 'nuestra' | null>>(new Map())
  const datosConMarcas = useMemo(() => {
    if (marcadas.size === 0) return datos
    const d = decisionesDe(datos)
    const ajenas = new Set(d.ajenas.map(claveDeBusqueda))
    const nuestras = new Set(d.nuestras.map(claveDeBusqueda))
    for (const [k, v] of marcadas) {
      ajenas.delete(k)
      nuestras.delete(k)
      if (v === 'ajena') ajenas.add(k)
      if (v === 'nuestra') nuestras.add(k)
    }
    return { ...datos, decisiones: { ajenas: [...ajenas], nuestras: [...nuestras], disponible: datos.decisiones?.disponible ?? false } }
  }, [datos, marcadas])
  const decision = (consulta: string): 'ajena' | 'nuestra' | null => {
    const k = claveDeBusqueda(consulta)
    const d = datosConMarcas.decisiones
    return d?.ajenas.includes(k) ? 'ajena' : d?.nuestras.includes(k) ? 'nuestra' : null
  }
  const puedeDecidir = datos.decisiones?.disponible === true
  async function decidir(consulta: string, nueva: 'ajena' | 'nuestra' | null) {
    const k = claveDeBusqueda(consulta)
    const antes = marcadas.has(k) ? marcadas.get(k) : undefined
    setMarcadas((m) => new Map(m).set(k, nueva))
    try {
      if (nueva) await llamar('/api/seo/ajenas', { metodo: 'POST', cuerpo: { cuenta: cuentaId, consulta, decision: nueva, asin } })
      else await llamar('/api/seo/ajenas', { metodo: 'DELETE', cuerpo: { cuenta: cuentaId, consulta } })
      toast.success(nueva === 'ajena' ? `«${consulta}» ya no cuenta para tus productos. Valora negativizarla en PPC.` : nueva === 'nuestra' ? `«${consulta}» cuenta como búsqueda de tu producto.` : `«${consulta}» vuelve a juzgarse sola.`)
      recargar?.()
    } catch (e) {
      setMarcadas((m) => {
        const x = new Map(m)
        if (antes === undefined) x.delete(k)
        else x.set(k, antes)
        return x
      })
      toast.error(e instanceof Error ? e.message : 'No se ha podido guardar.')
    }
  }

  const diagnostico = useMemo(() => (asin ? diagnosticoDe(datosConMarcas, asin, periodo) : null), [datosConMarcas, asin, periodo])
  const todas = useMemo(() => {
    const porConsulta = new Map((diagnostico?.busquedas ?? []).map((b) => [b.fila.consulta, b]))
    return consultas.map((c) => {
      const d = porConsulta.get(c.consulta)
      // `impacto` ordena; `enJuego` (las compras que aún no son tuyas, sin multiplicador) es lo que se enseña
      return { ...c, cobertura: ficha ? coberturaDe(c.consulta, ficha) : null, previa: anterior.get(c.consulta.trim().toLowerCase()), v: d?.veredicto, impacto: d?.impacto ?? 0, enJuego: d?.compras ?? 0, posibleAjena: d?.posibleAjena ?? false }
    })
  }, [consultas, ficha, anterior, diagnostico])
  const cuenta = (f: Filtro) => todas.filter((c) => pasaFiltro(c, f)).length
  const filas = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return todas
      .filter((c) => (!q || c.consulta.toLowerCase().includes(q)) && pasaFiltro(c, filtro))
      .sort((a, b) => (orden === 'impacto' ? b.impacto - a.impacto : 0) || (b.volumen ?? 0) - (a.volumen ?? 0))
      .slice(0, 400)
  }, [todas, filtro, busqueda, orden])
  const precio = asin ? (datos.precios?.[asin] ?? null) : null
  const r = useMemo(() => resumenDeProducto(consultas, ficha, precio, decisionesDe(datosConMarcas)), [consultas, ficha, precio, datosConMarcas])
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
        <Segmentado etiqueta="Ordenar" opciones={[{ id: 'impacto', texto: 'Compras en juego' }, { id: 'volumen', texto: 'Volumen' }]} valor={orden} cambiar={(v) => setOrden(v as Orden)} />
        {rango && <span className="text-[11.5px] text-[var(--ls-t4)]">{rango}</span>}
        <span className="ml-auto" />
        {filas.length > 0 && (
          <button type="button" onClick={() => descargarCsv(filas, asin ?? '', periodo, moneda)} className="inline-flex h-[30px] items-center gap-[6px] rounded-[9px] px-[10px] text-[12px] font-medium text-[var(--ls-t2)] transition-colors hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]" title="Descargar estas búsquedas (con el filtro puesto) en CSV, para Excel">
            <Download className="h-[13px] w-[13px]" /> CSV
          </button>
        )}
        <label className="relative w-full sm:w-auto">
          <span className="sr-only">Filtrar búsquedas</span>
          {/* Centrada en vertical: al dedo el campo mide 44 px y con top fijo la lupa quedaba arriba */}
          <Search className="pointer-events-none absolute left-[10px] top-1/2 h-[13px] w-[13px] -translate-y-1/2 text-[var(--ls-t4)]" />
          <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Filtrar búsquedas" className="h-[30px] w-full rounded-[9px] sm:w-[220px] [@media(pointer:coarse)]:h-[44px] [@media(pointer:coarse)]:text-[16px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] pl-[30px] pr-2 text-[12.5px] text-[var(--ls-t1)] outline-none placeholder:text-[var(--ls-t4)] focus:border-[var(--ls-acc-graf)]" />
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
          <TiraDeCifrasSeo
            cifras={[
              { etiqueta: 'Búsquedas', valor: entero(r.busquedas), nota: previo ? `antes ${entero(previo.busquedas)}` : undefined },
              { etiqueta: 'Volumen total', valor: entero(r.volumenTotal), nota: previo ? `antes ${entero(previo.volumen)}` : undefined },
              { etiqueta: 'Cuota de impresiones', valor: porcentaje(r.cuotaImpresiones), nota: previo ? `antes ${porcentaje(previo.cuotaImpresiones)}` : undefined },
              { etiqueta: 'Cuota de compras', valor: porcentaje(r.cuotaCompras), color: r.cuotaCompras != null && r.cuotaCompras >= 0.1 ? COLOR_ESTADO.verde : undefined, nota: previo ? `antes ${porcentaje(previo.cuotaCompras)}` : undefined },
              { etiqueta: 'Keywords en la ficha', valor: r.cobertura == null ? '—' : porcentaje(r.cobertura, 0), nota: 'de las 20 principales' },
            ]}
          />

          {diagnostico && <TarjetaDeEmbudo d={diagnostico} />}

          {datos.lectura.mejoras && <TarjetaDeEvolucion serie={serie} periodo={periodo} />}

          {/* Cinco opciones con textos largos: en el móvil medían 690 px y ensanchaban la página entera a 716 px (zoom fuera, la página bailaba de lado) */}
          <DeslizableEnMovil>
          <Segmentado
            etiqueta="Qué búsquedas"
            opciones={[
              { id: 'todas', texto: 'Todas', cuenta: consultas.length },
              { id: 'seo', texto: 'Es SEO', cuenta: cuenta('seo') },
              { id: 'no-seo', texto: 'No es SEO (ficha, precio, PPC…)', cuenta: cuenta('no-seo') },
              { id: 'faltan', texto: 'Les falta algo en la ficha', cuenta: ficha ? cuenta('faltan') : undefined },
              { id: 'descartadas', texto: 'Descartadas', cuenta: cuenta('descartadas') },
            ]}
            valor={filtro}
            cambiar={(v) => setFiltro(v as Filtro)}
          />
          </DeslizableEnMovil>

          {/* Las tarjetas son del móvil y la tabla del ordenador. Antes se pintaban las dos y una se escondía con CSS: en el móvil, cada letra del filtro
              volvía a montar las 400 filas de la tabla escondida. Hasta saber el ancho (en el servidor) van las dos, como antes */}
          {esOrdenador !== true && <TarjetasDeBusquedas filas={filas} decision={decision} decidir={decidir} puedeDecidir={puedeDecidir} />}
          {esOrdenador !== false && (
          <div className={`${CAJA.base} hidden overflow-x-auto md:block`}>
            <table className={`w-full ${conCompetencia ? 'min-w-[1380px]' : 'min-w-[1140px]'} border-separate border-spacing-0 whitespace-nowrap text-[12.5px]`}>
              <thead>
                <tr className="text-[11px] text-[var(--ls-t4)]">
                  <th className="sticky top-0 bg-[var(--ls-sup2)] px-4 py-[9px] text-left font-semibold">Búsqueda</th>
                  <th className="sticky top-0 bg-[var(--ls-sup2)] px-3 py-[9px] text-right font-semibold">Volumen</th>
                  <th className="sticky top-0 bg-[var(--ls-sup2)] px-3 py-[9px] text-left font-semibold" title="Tu cuota en cada escalón: impresiones › clics › carrito › compras. En rojo, donde se cae">Tu cuota · imp › clic › carrito › compra</th>
                  <th className="sticky top-0 bg-[var(--ls-sup2)] px-3 py-[9px] text-left font-semibold" title="Dónde se cae el embudo y de quién es el trabajo (SOP). Pasa el ratón para ver el porqué">Diagnóstico</th>
                  <th className="sticky top-0 bg-[var(--ls-sup2)] px-3 py-[9px] text-right font-semibold" title="Cuota de compras frente al periodo anterior">vs anterior</th>
                  {conCompetencia && <th className="sticky top-0 bg-[var(--ls-sup2)] px-3 py-[9px] text-left font-semibold">Quién se lleva los clics</th>}
                  <th className="sticky top-0 bg-[var(--ls-sup2)] px-3 py-[9px] text-right font-semibold">Precio · tú / mercado</th>
                  <th className="sticky top-0 bg-[var(--ls-sup2)] px-4 py-[9px] text-left font-semibold">En la ficha</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((c) => (
                  <tr key={c.consulta} className="group hover:[&>td]:bg-[var(--ls-sup2)]">
                    <td className="border-t border-[var(--ls-linea)] px-4 py-[8px]">
                      <div className="flex max-w-[300px] flex-wrap items-center gap-[6px] whitespace-normal">
                        <span className="font-medium text-[var(--ls-t1)]">{c.consulta}</span>
                        {c.posibleAjena && <ChipAjena compacto />}
                      </div>
                      {c.comprasAsin != null && c.comprasTotal != null && (
                        <div className="text-[11px] text-[var(--ls-t4)]">
                          {entero(c.comprasAsin)} de {entero(c.comprasTotal)} compras{c.enJuego > 0 && c.v?.tipo !== 'ajena' ? ` · ${entero(c.enJuego)} en juego` : ''}
                        </div>
                      )}
                      <BotonesDeAjena consulta={c.consulta} posibleAjena={c.posibleAjena} decision={decision(c.consulta)} decidir={decidir} puedeDecidir={puedeDecidir} enHover />
                    </td>
                    <td className="border-t border-[var(--ls-linea)] px-3 py-[8px] text-right tabular-nums text-[var(--ls-t1)]">{entero(c.volumen)}</td>
                    <td className="border-t border-[var(--ls-linea)] px-3 py-[8px]"><EmbudoMini fila={c} v={c.v} /></td>
                    <td className="border-t border-[var(--ls-linea)] px-3 py-[8px]"><EtiquetaDeVeredicto v={c.v} /></td>
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
          )}
          <NotaDeCompetencia datos={datos} hay={conCompetencia} desde={competencia.datos?.desde ?? null} />

          <SinExacta publicidad={publicidad.datos} />
          <p className="text-[11px] leading-[1.5] text-[var(--ls-t4)]">
            Datos de Brand Analytics (Search Query Performance). «Tu cuota» es la parte que se llevó este producto de todo lo que pasó en Amazon con esa búsqueda, escalón a escalón. El diagnóstico compara cada
            escalón con el anterior: si te llevas el 3 % de las impresiones, lo normal es llevarte un 3 % de los clics; por debajo del 70 % de lo esperado, ahí se cae (solo se juzga con al menos 3
            esperados). «Infraexpuesta»: te llevas al menos 1,2 veces más cuota de compras que de impresiones, con menos del 20 % de impresiones: convierte de sobra y le falta exposición (PPC). Los
            umbrales son estimaciones de la agencia. «Descartadas»: sin intención de compra, el sector compra a menos de la mitad de tu precio o la has marcado como «No es nuestro producto». «Pocos
            datos»: sales tan poco que no se puede juzgar ningún escalón; si además lleva palabras que no están en tu ficha ni en tus búsquedas habituales, sale «¿Ajena?» y no cuenta para la ficha,
            las tareas ni la IA.
          </p>
        </>
      )}
    </div>
  )
}

type FilaDeTabla = ConsultaGuardada & { cobertura: ReturnType<typeof coberturaDe> | null; v: Veredicto | undefined; impacto: number; enJuego: number; posibleAjena: boolean; previa?: { cuotaCompras: number | null } }

function pasaFiltro(c: FilaDeTabla, f: Filtro): boolean {
  if (f === 'todas') return true
  if (f === 'faltan') return !!c.cobertura && c.cobertura.faltan.length > 0 && (!c.v || esRelevante(c.v))
  if (!c.v) return false
  if (f === 'seo') return (c.v.tipo === 'visibilidad' || c.v.tipo === 'sin-datos') && !c.posibleAjena
  if (f === 'no-seo') return c.v.tipo === 'fuga' || c.v.tipo === 'infraexpuesta'
  return !esRelevante(c.v) || c.posibleAjena
}

/**
 * «No es nuestro producto» / «Sí es nuestro» de una búsqueda (migración 333). En la tabla del ordenador, el botón de marcar ajena sale al pasar el ratón por la fila (o con el teclado) para no
 * llenar 400 filas de botones; si la búsqueda es «¿Ajena?» o ya está decidida, se ve siempre.
 */
function BotonesDeAjena({ consulta, posibleAjena, decision, decidir, puedeDecidir, enHover = false }: { consulta: string; posibleAjena: boolean; decision: 'ajena' | 'nuestra' | null; decidir: (consulta: string, d: 'ajena' | 'nuestra' | null) => void; puedeDecidir: boolean; enHover?: boolean }) {
  const titulo = puedeDecidir ? undefined : 'Falta lanzar la migración 333 en Supabase para guardar esta decisión.'
  const boton = 'inline-flex h-[24px] items-center gap-[4px] rounded-[6px] px-[6px] text-[11px] font-medium text-[var(--ls-t3)] transition-colors hover:bg-[var(--ls-sup)] hover:text-[var(--ls-t1)] disabled:cursor-not-allowed disabled:opacity-40 [@media(pointer:coarse)]:h-[36px] [@media(pointer:coarse)]:text-[12.5px]'
  if (decision === 'ajena')
    return (
      <div className="mt-[3px] flex flex-wrap items-center gap-1">
        <span className="text-[11px] text-[var(--ls-t4)]">Marcada: no es de tu producto</span>
        <button type="button" disabled={!puedeDecidir} title={titulo} onClick={() => decidir(consulta, null)} className={boton}>
          <Undo2 className="h-3 w-3" /> Deshacer
        </button>
      </div>
    )
  if (decision === 'nuestra')
    return posibleAjena || enHover ? (
      <div className={`mt-[3px] flex flex-wrap items-center gap-1 ${enHover ? 'opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100' : ''}`}>
        <span className="text-[11px] text-[var(--ls-t4)]">Marcada como tuya</span>
        <button type="button" disabled={!puedeDecidir} title={titulo} onClick={() => decidir(consulta, null)} className={boton}>
          <Undo2 className="h-3 w-3" /> Deshacer
        </button>
      </div>
    ) : null
  const oculto = enHover && !posibleAjena
  return (
    <div className={`mt-[3px] flex flex-wrap items-center gap-1 ${oculto ? 'opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100' : ''}`}>
      <button type="button" disabled={!puedeDecidir} title={titulo ?? 'Deja de contar para la ficha, las tareas y la IA en toda la cuenta y país. Valora negativizarla en PPC.'} onClick={() => decidir(consulta, 'ajena')} className={boton}>
        <Ban className="h-3 w-3" /> No es nuestro producto
      </button>
      {posibleAjena && (
        <button type="button" disabled={!puedeDecidir} title={titulo ?? 'Quita el aviso «¿Ajena?»: vuelve a contar como búsqueda de tu producto.'} onClick={() => decidir(consulta, 'nuestra')} className={boton}>
          Sí es nuestro
        </button>
      )}
    </div>
  )
}

/** Las búsquedas en CSV (separado por «;» y con BOM, que es como lo abre bien el Excel en español) */
function descargarCsv(filas: FilaDeTabla[], asin: string, periodo: 'MONTH' | 'WEEK', moneda: string | null) {
  const n = (x: number | null | undefined, dec = 0) => (x == null ? '' : x.toLocaleString('es-ES', { maximumFractionDigits: dec, useGrouping: false }))
  const p = (x: number | null | undefined) => (x == null ? '' : (x * 100).toLocaleString('es-ES', { maximumFractionDigits: 2, useGrouping: false }))
  const q = (t: string) => `"${t.replace(/"/g, '""')}"`
  const cabecera = ['Búsqueda', 'Volumen', 'Compras en Amazon', 'Tus compras', 'Compras en juego', '% impresiones', '% clics', '% carrito', '% compras', 'Diagnóstico', 'De quién es', 'Por qué', `Tu precio (${moneda ?? ''})`, `Precio del sector (${moneda ?? ''})`, 'En título', 'En bullets', 'En backend', 'Falta en la ficha']
  const lineas = filas.map((c) => {
    const e = c.v ? estiloDeVeredicto(c.v) : null
    return [q(c.consulta), n(c.volumen), n(c.comprasTotal), n(c.comprasAsin), n(c.enJuego), p(c.cuotaImpresiones), p(c.cuotaClics), p(c.cuotaCarritos), p(c.cuotaCompras), q(e?.texto ?? ''), q(e?.pista ?? ''), q(c.v?.motivo ?? ''), n(c.precioMedianoAsin, 2), n(c.precioMedianoTotal, 2), c.cobertura?.titulo ? 'sí' : 'no', c.cobertura?.bullets ? 'sí' : 'no', c.cobertura?.backend ? 'sí' : 'no', q(c.cobertura?.faltan.join(' ') ?? '')].join(';')
  })
  const blob = new Blob([`\ufeff${[cabecera.map(q).join(';'), ...lineas].join('\r\n')}`], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `busquedas-${asin}-${periodo === 'MONTH' ? 'mes' : 'semana'}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
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
      <header className={`${CAJA.cabecera} flex-wrap`}>
        <Megaphone className="h-[14px] w-[14px] shrink-0 text-[var(--ls-t3)]" />
        <h3 className="text-[13px] font-semibold text-[var(--ls-t1)]">Búsquedas que venden sin keyword EXACTA en Marketing Test</h3>
        <span className="ml-auto text-[11.5px] text-[var(--ls-t4)]">{publicidad.campanas} campañas del producto · solo sugerencias</span>
      </header>
      {/* En el móvil la búsqueda va en su línea y las cifras debajo: con los tres anchos fijos (310 px) en la misma fila, el texto se quedaba en 0 px */}
      {publicidad.sinExacta.length === 0 ? (
        <p className={`${CAJA.cuerpo} text-[12.5px]`} style={{ color: COLOR_ESTADO.verde }}>Todas las búsquedas con compras ya tienen su keyword exacta.</p>
      ) : (
        <div className="flex flex-col divide-y divide-[var(--ls-linea)]">
          {publicidad.sinExacta.map((b) => (
            <div key={b.consulta} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-[8px] sm:flex-nowrap">
              <span className="w-full min-w-0 truncate text-[12.5px] font-medium text-[var(--ls-t1)] sm:w-auto sm:flex-1">{b.consulta}</span>
              {b.enOtraConcordancia && <span className="shrink-0 whitespace-nowrap rounded-[5px] bg-[var(--ls-sup2)] px-[6px] py-[1px] text-[10.5px] text-[var(--ls-t3)]" title="Ya se puja por ella en amplia o frase, pero no en exacta">en amplia/frase</span>}
              <span className="whitespace-nowrap text-right text-[11.5px] tabular-nums text-[var(--ls-t3)] sm:w-[120px]">{entero(b.comprasTotal)} compras</span>
              <span className="whitespace-nowrap text-right text-[11.5px] tabular-nums text-[var(--ls-t4)] sm:w-[110px]">{entero(b.volumen)} búsquedas</span>
              <span className="ml-auto whitespace-nowrap text-right text-[11.5px] tabular-nums text-[var(--ls-t3)] sm:ml-0 sm:w-[80px]" title="Tu cuota de compras en esa búsqueda">{porcentaje(b.cuotaCompras)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/** En el móvil la tabla de 1.100 px no cabe: una tarjeta por búsqueda con lo esencial, de 30 en 30 (no se pintan 400 de golpe) */
function TarjetasDeBusquedas({ filas, decision, decidir, puedeDecidir }: { filas: FilaDeTabla[]; decision: (consulta: string) => 'ajena' | 'nuestra' | null; decidir: (consulta: string, d: 'ajena' | 'nuestra' | null) => void; puedeDecidir: boolean }) {
  const [cuantas, setCuantas] = useState(30)
  return (
    <div className="flex flex-col gap-2 md:hidden">
      {filas.slice(0, cuantas).map((c) => (
        <div key={c.consulta} className={`${CAJA.base} flex flex-col gap-2 p-3`}>
          <div className="flex items-start gap-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-[6px] text-[14px] font-medium leading-[1.35] text-[var(--ls-t1)]">
              {c.consulta}
              {c.posibleAjena && <ChipAjena />}
            </div>
            <span className="shrink-0 text-[13px] tabular-nums text-[var(--ls-t2)]">{entero(c.volumen)}</span>
          </div>
          {c.comprasAsin != null && c.comprasTotal != null && (
            <div className="text-[12px] text-[var(--ls-t4)]">
              {entero(c.comprasAsin)} de {entero(c.comprasTotal)} compras{c.enJuego > 0 && c.v?.tipo !== 'ajena' ? ` · ${entero(c.enJuego)} en juego` : ''}
            </div>
          )}
          <EmbudoMini fila={c} v={c.v} />
          <div className="flex flex-wrap items-center gap-[4px]">
            <EtiquetaDeVeredicto v={c.v} />
            {c.cobertura && (
              <>
                <Marca si={c.cobertura.titulo} texto="Título" />
                <Marca si={c.cobertura.bullets} texto="Bullets" />
                <Marca si={c.cobertura.backend} texto="Backend" />
              </>
            )}
          </div>
          {c.cobertura && c.cobertura.faltan.length > 0 && <div className="text-[12px]" style={{ color: COLOR_ESTADO.ambar }}>falta: {c.cobertura.faltan.join(', ')}</div>}
          <BotonesDeAjena consulta={c.consulta} posibleAjena={c.posibleAjena} decision={decision(c.consulta)} decidir={decidir} puedeDecidir={puedeDecidir} />
        </div>
      ))}
      {filas.length > cuantas && (
        <button type="button" onClick={() => setCuantas((n) => n + 30)} className="h-11 rounded-[10px] border border-[var(--ls-linea)] text-[13px] font-medium text-[var(--ls-t2)]">
          Ver 30 más ({filas.length - cuantas} quedan)
        </button>
      )}
    </div>
  )
}
