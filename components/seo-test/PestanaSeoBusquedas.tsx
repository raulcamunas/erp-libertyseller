'use client'

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { CAJA, Segmentado, TiraDeCifras } from '@/components/marketing-test/piezas'
import { dinero, entero, porcentaje } from '@/components/marketing-test/formato'
import { Vacio } from '@/components/plataforma/comun'
import { coberturaDe } from '@/lib/seo/cobertura'
import { resumenDeProducto } from '@/lib/seo/resumen'
import { BarraDeCuota, consultasDe, fichaDe, Marca, SelectorDeProducto } from './comun'
import type { DatosSeo } from './useCuentaSeo'

type Filtro = 'todas' | 'faltan'

/**
 * LAS BÚSQUEDAS DE UN PRODUCTO (Brand Analytics): por cada búsqueda de Amazon donde aparece, cuántas veces se buscó, qué parte de las impresiones, clics y compras se llevó, a qué precio compra la
 * gente frente al suyo, y si la búsqueda está entera en su título, sus bullets o su backend. Las que venden y no están en la ficha son las primeras que hay que mirar.
 */
export function PestanaSeoBusquedas({ datos, moneda, asin, setAsin, irAProductos }: { datos: DatosSeo; moneda: string | null; asin: string | null; setAsin: (a: string) => void; irAProductos: () => void }) {
  const [periodo, setPeriodo] = useState<'MONTH' | 'WEEK'>('MONTH')
  const [filtro, setFiltro] = useState<Filtro>('todas')
  const [busqueda, setBusqueda] = useState('')

  const ficha = asin ? fichaDe(datos, asin) : null
  const consultas = useMemo(() => (asin ? consultasDe(datos, asin, periodo) : []), [datos, asin, periodo])
  const filas = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return consultas
      .map((c) => ({ ...c, cobertura: ficha ? coberturaDe(c.consulta, ficha) : null }))
      .filter((c) => (!q || c.consulta.toLowerCase().includes(q)) && (filtro === 'todas' || (c.cobertura && c.cobertura.faltan.length > 0)))
      .sort((a, b) => (b.volumen ?? 0) - (a.volumen ?? 0))
      .slice(0, 400)
  }, [consultas, ficha, filtro, busqueda])
  const r = useMemo(() => resumenDeProducto(consultas, ficha), [consultas, ficha])
  const rango = consultas[0] ? `${new Date(`${consultas[0].desde}T00:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' })} – ${new Date(`${consultas[0].hasta}T00:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}` : null

  if (datos.productos.length === 0)
    return (
      <Vacio icono={<Search />} titulo="Primero hay que seguir algún producto" accion={<button type="button" onClick={irAProductos} className="h-[30px] rounded-[9px] bg-[var(--ls-acc-relleno)] px-3 text-[12.5px] font-semibold text-[var(--ls-acc-tinta)]">Ir a Productos</button>}>
        Las búsquedas salen del informe de Brand Analytics de los productos que sigues.
      </Vacio>
    )

  return (
    <div className="flex max-w-[1240px] flex-col gap-3 pb-8">
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
              { etiqueta: 'Búsquedas', valor: entero(r.busquedas) },
              { etiqueta: 'Volumen total', valor: entero(r.volumenTotal) },
              { etiqueta: 'Cuota de impresiones', valor: porcentaje(r.cuotaImpresiones) },
              { etiqueta: 'Cuota de compras', valor: porcentaje(r.cuotaCompras), color: r.cuotaCompras != null && r.cuotaCompras >= 0.1 ? COLOR_ESTADO.verde : undefined },
              { etiqueta: 'Keywords en la ficha', valor: r.cobertura == null ? '—' : porcentaje(r.cobertura, 0), nota: 'de las 20 principales' },
            ]}
          />
          <div className={`${CAJA.base} overflow-x-auto`}>
            <table className="w-full min-w-[980px] border-separate border-spacing-0 text-[12.5px]">
              <thead>
                <tr className="text-[11px] text-[var(--ls-t4)]">
                  <th className="sticky top-0 bg-[var(--ls-sup2)] px-4 py-[9px] text-left font-semibold">Búsqueda</th>
                  <th className="sticky top-0 bg-[var(--ls-sup2)] px-3 py-[9px] text-right font-semibold">Volumen</th>
                  <th className="sticky top-0 bg-[var(--ls-sup2)] px-3 py-[9px] text-right font-semibold">Tus impresiones</th>
                  <th className="sticky top-0 bg-[var(--ls-sup2)] px-3 py-[9px] text-right font-semibold">Tus clics</th>
                  <th className="sticky top-0 bg-[var(--ls-sup2)] px-3 py-[9px] text-right font-semibold">Tus compras</th>
                  <th className="sticky top-0 bg-[var(--ls-sup2)] px-3 py-[9px] text-right font-semibold">Precio · tú / mercado</th>
                  <th className="sticky top-0 bg-[var(--ls-sup2)] px-4 py-[9px] text-left font-semibold">En la ficha</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((c) => (
                  <tr key={c.consulta} className="hover:[&>td]:bg-[var(--ls-sup2)]">
                    <td className="border-t border-[var(--ls-linea)] px-4 py-[8px]">
                      <div className="font-medium text-[var(--ls-t1)]">{c.consulta}</div>
                      {c.comprasAsin != null && c.comprasTotal != null && <div className="text-[11px] text-[var(--ls-t4)]">{entero(c.comprasAsin)} de {entero(c.comprasTotal)} compras</div>}
                    </td>
                    <td className="border-t border-[var(--ls-linea)] px-3 py-[8px] text-right tabular-nums text-[var(--ls-t1)]">{entero(c.volumen)}</td>
                    <td className="border-t border-[var(--ls-linea)] px-3 py-[8px] text-right"><BarraDeCuota valor={c.cuotaImpresiones} color={COLOR_ESTADO.cian} /></td>
                    <td className="border-t border-[var(--ls-linea)] px-3 py-[8px] text-right"><BarraDeCuota valor={c.cuotaClics} color={COLOR_ESTADO.azul} /></td>
                    <td className="border-t border-[var(--ls-linea)] px-3 py-[8px] text-right"><BarraDeCuota valor={c.cuotaCompras} color={COLOR_ESTADO.verde} /></td>
                    <td className="border-t border-[var(--ls-linea)] px-3 py-[8px] text-right tabular-nums">
                      <span className="text-[var(--ls-t1)]">{dinero(c.precioMedianoAsin, moneda)}</span>
                      <span className="text-[var(--ls-t4)]"> / {dinero(c.precioMedianoTotal, moneda)}</span>
                    </td>
                    <td className="border-t border-[var(--ls-linea)] px-4 py-[8px]">
                      {c.cobertura ? (
                        <div className="flex flex-wrap items-center gap-[4px]">
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
          <p className="text-[11px] text-[var(--ls-t4)]">Datos de Brand Analytics (Search Query Performance). «Tus impresiones / clics / compras» es la parte que se llevó este producto de todo lo que pasó en Amazon con esa búsqueda.</p>
        </>
      )}
    </div>
  )
}
