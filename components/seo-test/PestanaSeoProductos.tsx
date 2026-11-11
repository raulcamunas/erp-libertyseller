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
import { consultasDe, fichaDe, nombreDe, serieDe } from './comun'
import type { PuntoDeEvolucion } from '@/lib/seo/datos'
import type { DatosSeo } from './useCuentaSeo'

/**
 * LOS PRODUCTOS SEGUIDOS de la cuenta y país, cada uno con su resumen: en cuántas búsquedas aparece, cuánto volumen arrastran, qué parte de las compras y de las impresiones se lleva y cuántas de sus
 * búsquedas principales están enteras en la ficha. Desde aquí se añaden (del catálogo o los mismos que en Marketing Test) y se quitan.
 */
export function PestanaSeoProductos({ cuentaId, datos, recargar, verBusquedas, verFicha }: { cuentaId: string; datos: DatosSeo; recargar: () => void; verBusquedas: (asin: string) => void; verFicha: (asin: string) => void }) {
  const [anadiendo, setAnadiendo] = useState(false)
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
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {datos.productos.map((p) => {
            const ficha = fichaDe(datos, p.asin)
            const mes = consultasDe(datos, p.asin, 'MONTH')
            const consultas = mes.length > 0 ? mes : consultasDe(datos, p.asin, 'WEEK')
            const r = resumenDeProducto(consultas, ficha)
            const nombre = nombreDe(p, ficha)
            return (
              <article key={p.id} className={`${CAJA.base} flex flex-col transition-colors hover:border-[var(--ls-linea2)]`}>
                <div className="flex items-start gap-3 px-4 pb-3 pt-4">
                  <div className="min-w-0 flex-1">
                    <h3 className="line-clamp-2 text-[14px] font-semibold leading-[1.35] text-[var(--ls-t1)]" title={nombre}>{nombre}</h3>
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
                <div className="grid grid-cols-4 border-t border-[var(--ls-linea)]">
                  <Dato etiqueta="Búsquedas" valor={consultas.length > 0 ? entero(r.busquedas) : '—'} nota={consultas.length > 0 ? `${entero(r.volumenTotal)} de volumen` : 'sin datos aún'} />
                  <Dato etiqueta="Cuota de compras" valor={porcentaje(r.cuotaCompras)} nota="de lo que se compra en sus búsquedas" color={r.cuotaCompras != null && r.cuotaCompras >= 0.1 ? COLOR_ESTADO.verde : undefined} />
                  <Dato etiqueta="Cuota de impresiones" valor={porcentaje(r.cuotaImpresiones)} nota="cuánto sale cuando se busca" />
                  <Dato etiqueta="Keywords en la ficha" valor={r.cobertura == null ? '—' : porcentaje(r.cobertura, 0)} nota={r.faltanEnFicha ? `${r.faltanEnFicha} de las 20 principales no están` : ficha ? 'de las 20 principales' : 'ficha sin leer aún'} color={r.cobertura == null ? undefined : r.cobertura >= 0.8 ? COLOR_ESTADO.verde : r.cobertura >= 0.5 ? COLOR_ESTADO.ambar : COLOR_ESTADO.rojo} />
                </div>
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

function Dato({ etiqueta, valor, nota, color }: { etiqueta: string; valor: string; nota: string; color?: string }) {
  return (
    <div className="min-w-0 border-l border-[var(--ls-linea)] px-4 py-3 first:border-l-0">
      <div className="truncate text-[11px] text-[var(--ls-t4)]">{etiqueta}</div>
      <div className="mt-[2px] text-[18px] font-semibold tabular-nums tracking-[-0.015em]" style={{ color: color ?? 'var(--ls-t1)' }}>{valor}</div>
      <div className="text-[10.5px] leading-[1.35] text-[var(--ls-t4)]">{nota}</div>
    </div>
  )
}

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
          <button type="button" onClick={cerrar} className="h-[28px] rounded-[8px] px-[10px] text-[12px] font-medium text-[var(--ls-t3)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]">Cancelar</button>
          <button type="button" disabled={n === 0 || guardando} onClick={guardar} className="h-[28px] rounded-[8px] bg-[var(--ls-acc-relleno)] px-[12px] text-[12px] font-semibold text-[var(--ls-acc-tinta)] disabled:opacity-45">
            {guardando ? 'Añadiendo…' : n === 0 ? 'Elige productos' : `Seguir ${n}`}
          </button>
        </div>
      </header>
      <div className={`${CAJA.cuerpo} flex flex-col gap-2`}>
        <label className="relative">
          <Search className="pointer-events-none absolute left-[10px] top-[9px] h-[13px] w-[13px] text-[var(--ls-t4)]" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por SKU, ASIN o título" className="h-[32px] w-full rounded-[9px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] pl-[30px] pr-2 text-[12.5px] text-[var(--ls-t1)] outline-none placeholder:text-[var(--ls-t4)] focus:border-[var(--ls-acc-graf)]" />
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
