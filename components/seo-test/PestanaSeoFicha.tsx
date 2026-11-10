'use client'

import { useMemo } from 'react'
import { FileText } from 'lucide-react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { CAJA } from '@/components/marketing-test/piezas'
import { entero, haceCuanto } from '@/components/marketing-test/formato'
import { Vacio } from '@/components/plataforma/comun'
import { bytesDe, coberturaDe, LIMITE_BACKEND_BYTES, LIMITE_TITULO_CARACTERES } from '@/lib/seo/cobertura'
import { palabrasQueFaltanEnElTitulo } from '@/lib/seo/resumen'
import { consultasDe, fichaDe, SelectorDeProducto } from './comun'
import type { DatosSeo } from './useCuentaSeo'

/**
 * LA FICHA DE UN PRODUCTO, REVISADA CONTRA LO QUE LA GENTE BUSCA: el título, los bullets y el backend tal cual están en Amazon (con sus límites), las palabras que más pesan en sus búsquedas y no
 * están en el título, y las búsquedas que venden y no aparecen enteras en ninguna parte. Solo enseña: cambiar la ficha se hace en Seller Central (o con la propuesta de ficha de la agencia).
 */
export function PestanaSeoFicha({ datos, asin, setAsin, irAProductos }: { datos: DatosSeo; asin: string | null; setAsin: (a: string) => void; irAProductos: () => void }) {
  const ficha = asin ? fichaDe(datos, asin) : null
  const consultas = useMemo(() => {
    if (!asin) return []
    const m = consultasDe(datos, asin, 'MONTH')
    return m.length > 0 ? m : consultasDe(datos, asin, 'WEEK')
  }, [datos, asin])
  const faltan = useMemo(() => (ficha ? palabrasQueFaltanEnElTitulo(consultas, ficha) : []), [consultas, ficha])
  const sinCubrir = useMemo(
    () =>
      ficha
        ? consultas
            .map((c) => ({ ...c, cob: coberturaDe(c.consulta, ficha) }))
            .filter((c) => c.cob.faltan.length > 0 && (c.comprasTotal ?? 0) > 0)
            .sort((a, b) => (b.comprasTotal ?? 0) - (a.comprasTotal ?? 0))
            .slice(0, 12)
        : [],
    [consultas, ficha]
  )

  if (datos.productos.length === 0)
    return (
      <Vacio icono={<FileText />} titulo="Primero hay que seguir algún producto" accion={<button type="button" onClick={irAProductos} className="h-[30px] rounded-[9px] bg-[var(--ls-acc-relleno)] px-3 text-[12.5px] font-semibold text-[var(--ls-acc-tinta)]">Ir a Productos</button>}>
        La ficha se lee de Amazon para cada producto que sigues.
      </Vacio>
    )

  const titulo = ficha?.titulo ?? ''
  const backendBytes = bytesDe(ficha?.backend)

  return (
    <div className="flex max-w-[1240px] flex-col gap-3 pb-8">
      <div className="flex flex-wrap items-center gap-2">
        <SelectorDeProducto productos={datos.productos} datos={datos} asin={asin} setAsin={setAsin} />
        {ficha && <span className="text-[11.5px] text-[var(--ls-t4)]">Leída de Amazon {haceCuanto(Date.parse(ficha.leidaAt))}</span>}
      </div>

      {!ficha ? (
        <Vacio icono={<FileText />} titulo="Todavía no se ha leído la ficha de este producto">
          Se lee de Amazon una vez al día. Si acabas de añadirlo, pulsa «Actualizar» arriba. Si no aparece, comprueba que el producto tiene el SKU puesto.
        </Vacio>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-3">
            <Bloque titulo="Título" medida={`${titulo.length} / ${LIMITE_TITULO_CARACTERES} caracteres`} lleno={titulo.length / LIMITE_TITULO_CARACTERES} alerta={titulo.length > LIMITE_TITULO_CARACTERES}>
              <p className="text-[13.5px] leading-[1.5] text-[var(--ls-t1)]">{titulo || <span className="text-[var(--ls-t4)]">Sin título</span>}</p>
            </Bloque>
            <Bloque titulo="Bullets" medida={`${ficha.bullets.length} de 5`} lleno={ficha.bullets.length / 5} alerta={ficha.bullets.length < 5}>
              {ficha.bullets.length === 0 ? (
                <p className="text-[12.5px] text-[var(--ls-t4)]">Sin bullets.</p>
              ) : (
                <ul className="flex flex-col gap-[6px]">
                  {ficha.bullets.map((b, i) => (
                    <li key={i} className="flex gap-2 text-[12.5px] leading-[1.5] text-[var(--ls-t2)]">
                      <span className="mt-[7px] h-[5px] w-[5px] shrink-0 rounded-full bg-[var(--ls-t4)]" />
                      {b}
                    </li>
                  ))}
                </ul>
              )}
            </Bloque>
            <Bloque titulo="Palabras clave ocultas (backend)" medida={`${backendBytes} / ${LIMITE_BACKEND_BYTES} bytes`} lleno={backendBytes / LIMITE_BACKEND_BYTES} alerta={backendBytes > LIMITE_BACKEND_BYTES}>
              <p className="font-mono text-[12px] leading-[1.6] text-[var(--ls-t2)]">{ficha.backend || <span className="font-sans text-[var(--ls-t4)]">Vacío: es espacio gratis para keywords que no caben en el título.</span>}</p>
              {backendBytes > LIMITE_BACKEND_BYTES && <p className="mt-2 text-[11.5px]" style={{ color: COLOR_ESTADO.rojo }}>Pasa de 250 bytes: Amazon puede ignorar el backend entero.</p>}
            </Bloque>
          </div>

          <div className="flex min-w-0 flex-col gap-3">
            <section className={CAJA.base}>
              <header className={CAJA.cabecera}>
                <h3 className="text-[13px] font-semibold text-[var(--ls-t1)]">Lo que se busca y no está en el título</h3>
              </header>
              <div className={CAJA.cuerpo}>
                {consultas.length === 0 ? (
                  <p className="text-[12px] text-[var(--ls-t4)]">Llega con el informe de Brand Analytics.</p>
                ) : faltan.length === 0 ? (
                  <p className="text-[12.5px]" style={{ color: COLOR_ESTADO.verde }}>Las palabras de sus búsquedas principales ya están en el título.</p>
                ) : (
                  <div className="flex flex-col gap-[6px]">
                    {faltan.map((p) => (
                      <div key={p.palabra} className="flex items-center gap-2">
                        <span className="rounded-[6px] bg-[var(--ls-sup2)] px-[7px] py-[2px] text-[12.5px] font-medium text-[var(--ls-t1)]">{p.palabra}</span>
                        <span className="text-[11px] text-[var(--ls-t4)]">
                          {entero(p.peso)} de volumen · en {p.busquedas} {p.busquedas === 1 ? 'búsqueda' : 'búsquedas'}
                        </span>
                        <span className="ml-auto text-[11px]" style={{ color: p.enBullets || p.enBackend ? 'var(--ls-t3)' : COLOR_ESTADO.ambar }}>
                          {p.enBullets ? 'en bullets' : p.enBackend ? 'en backend' : 'en ninguna parte'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section className={CAJA.base}>
              <header className={CAJA.cabecera}>
                <h3 className="text-[13px] font-semibold text-[var(--ls-t1)]">Búsquedas que venden y no están en la ficha</h3>
              </header>
              <div className={CAJA.cuerpo}>
                {sinCubrir.length === 0 ? (
                  <p className="text-[12.5px] text-[var(--ls-t3)]">{consultas.length === 0 ? 'Llega con el informe de Brand Analytics.' : 'Ninguna: las búsquedas con compras tienen todas sus palabras en algún sitio de la ficha.'}</p>
                ) : (
                  <div className="flex flex-col divide-y divide-[var(--ls-linea)]">
                    {sinCubrir.map((c) => (
                      <div key={c.consulta} className="flex items-center gap-2 py-[7px]">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[12.5px] font-medium text-[var(--ls-t1)]">{c.consulta}</div>
                          <div className="text-[11px] text-[var(--ls-t4)]">{entero(c.comprasTotal)} compras en Amazon · tú {entero(c.comprasAsin)}</div>
                        </div>
                        <span className="text-[11px]" style={{ color: COLOR_ESTADO.ambar }}>falta: {c.cob.faltan.join(', ')}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  )
}

function Bloque({ titulo, medida, lleno, alerta, children }: { titulo: string; medida: string; lleno: number; alerta: boolean; children: React.ReactNode }) {
  return (
    <section className={CAJA.base}>
      <header className={`${CAJA.cabecera} justify-between`}>
        <h3 className="text-[13px] font-semibold text-[var(--ls-t1)]">{titulo}</h3>
        <div className="flex items-center gap-2">
          <div className="h-[5px] w-[80px] overflow-hidden rounded-full bg-[var(--ls-sup2)]">
            <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(2, lleno * 100))}%`, background: alerta ? COLOR_ESTADO.ambar : COLOR_ESTADO.verde }} />
          </div>
          <span className="text-[11px] tabular-nums text-[var(--ls-t4)]">{medida}</span>
        </div>
      </header>
      <div className={CAJA.cuerpo}>{children}</div>
    </section>
  )
}
