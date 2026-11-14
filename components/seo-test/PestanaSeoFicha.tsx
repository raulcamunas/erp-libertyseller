'use client'

import { useMemo } from 'react'
import { CircleAlert, CircleCheck, FileText, Info, Megaphone, TriangleAlert } from 'lucide-react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { CAJA } from '@/components/marketing-test/piezas'
import { entero, haceCuanto } from '@/components/marketing-test/formato'
import { Vacio } from '@/components/plataforma/comun'
import { bytesDe, coberturaDe, LIMITE_BACKEND_BYTES, LIMITE_BULLETS_BYTES, LIMITE_HIGHLIGHTS_CARACTERES, LIMITE_TITULO_CARACTERES, normalizar } from '@/lib/seo/cobertura'
import { esRelevante, NOMBRE_DE_ETAPA, RESPONSABLE, RESPONSABLE_INFRAEXPUESTA } from '@/lib/seo/embudo'
import { revisarFicha, type Gravedad } from '@/lib/seo/norma'
import { palabrasQuePesan, ventanaDeCambio } from '@/lib/seo/tareas'
import { BotonCopiar, diagnosticoDe, fichaDe, SelectorDeProducto } from './comun'
import type { DatosSeo } from './useCuentaSeo'
import { PropuestaConIa } from './PropuestaConIa'
import { useDelProducto } from './useDelProducto'
import type { DatosDePublicidad } from './PestanaSeoBusquedas'

const COLOR_GRAVEDAD: Record<Gravedad, string> = { grave: COLOR_ESTADO.rojo, atencion: COLOR_ESTADO.ambar, info: COLOR_ESTADO.azul }

/**
 * LA FICHA DE UN PRODUCTO, REVISADA CONTRA EL SOP Y CONTRA LO QUE LA GENTE BUSCA:
 *   · arriba, la «puerta de salida» del SOP (si el embudo dice que se pierde en clics, carrito o compra, reescribir la ficha no es lo primero) y la revisión de la norma de 2026 con los recuentos
 *     calculados (título 75, Item Highlights 125, viñetas 1.000 bytes, backend 249 bytes);
 *   · la propuesta de ficha con IA (que solo llega a Amazon con el OK de una persona);
 *   · el título, las viñetas y el backend tal cual están en Amazon, con lo que se gasta en balde;
 *   · las palabras que pesan en búsquedas DEL producto (sin ruido ni falsos amigos) y dónde está cada una, las búsquedas que venden y no están, y lo que vende por publicidad y la ficha no dice.
 */
export function PestanaSeoFicha({ cuentaId, datos, asin, setAsin, irAProductos }: { cuentaId: string; datos: DatosSeo; asin: string | null; setAsin: (a: string) => void; irAProductos: () => void }) {
  const publicidad = useDelProducto<DatosDePublicidad>(asin ? `/api/seo/publicidad?cuenta=${encodeURIComponent(cuentaId)}&asin=${asin}` : null)
  const ficha = asin ? fichaDe(datos, asin) : null
  const diagnostico = useMemo(() => (asin ? diagnosticoDe(datos, asin) : null), [datos, asin])
  const revision = useMemo(() => (ficha ? revisarFicha(ficha) : null), [ficha])
  const pesan = useMemo(() => (diagnostico ? palabrasQuePesan(diagnostico.busquedas, ficha, 30).filter((p) => !p.enTitulo).slice(0, 15) : []), [diagnostico, ficha])
  const sinCubrir = useMemo(
    () =>
      ficha && diagnostico
        ? diagnostico.busquedas
            .filter((d) => esRelevante(d.veredicto) && (d.fila.comprasTotal ?? 0) > 0)
            .map((d) => ({ ...d.fila, cob: coberturaDe(d.fila.consulta, ficha) }))
            .filter((c) => c.cob.faltan.length > 0)
            .sort((a, b) => (b.comprasTotal ?? 0) - (a.comprasTotal ?? 0))
            .slice(0, 12)
        : [],
    [ficha, diagnostico]
  )
  const ventana = asin ? ventanaDeCambio(datos.cambios ?? [], asin, new Date().toISOString().slice(0, 10)) : null
  const hayBusquedas = (diagnostico?.busquedas.length ?? 0) > 0

  if (datos.productos.length === 0)
    return (
      <Vacio icono={<FileText />} titulo="Primero hay que seguir algún producto" accion={<button type="button" onClick={irAProductos} className="h-[30px] rounded-[9px] bg-[var(--ls-acc-relleno)] px-3 text-[12.5px] font-semibold text-[var(--ls-acc-tinta)]">Ir a Productos</button>}>
        La ficha se lee de Amazon para cada producto que sigues.
      </Vacio>
    )

  const titulo = ficha?.titulo ?? ''
  const m = revision?.medidas
  const repetidas = new Set((m?.backendRepetidas ?? []).map((w) => normalizar(w)))

  return (
    <div className="flex max-w-[1240px] flex-col gap-3 pb-8">
      <div className="flex flex-wrap items-center gap-2">
        <SelectorDeProducto productos={datos.productos} datos={datos} asin={asin} setAsin={setAsin} />
        {ficha && <span className="text-[11.5px] text-[var(--ls-t4)]">Leída de Amazon {haceCuanto(Date.parse(ficha.leidaAt))}{ficha.sku ? ` · SKU ${ficha.sku}` : ''}</span>}
      </div>

      {!ficha ? (
        <Vacio icono={<FileText />} titulo="Todavía no se ha leído la ficha de este producto">
          {datos.productos.find((p) => p.asin === asin)?.sku ? 'Se lee de Amazon una vez al día. Si acabas de añadirlo, pulsa «Actualizar» arriba y espera un par de minutos.' : 'Este producto no tiene SKU apuntado y sin él no se puede leer la ficha. El ERP lo busca solo en el catálogo de la cuenta; si no aparece, quítalo y vuelve a añadirlo desde «Añadir productos».'}
        </Vacio>
      ) : (
        <>
          <PuertaDeSalida d={diagnostico} hayBusquedas={hayBusquedas} ventana={ventana} />
          {revision && <RevisionDeNorma incidencias={revision.incidencias} />}
          {asin && <PropuestaConIa key={asin} cuentaId={cuentaId} asin={asin} hayBusquedas={hayBusquedas} hayFicha={!!ficha.titulo} mejoras={!!datos.lectura.mejoras} diagnostico={diagnostico} ventana={ventana} />}

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-3">
              <Bloque titulo="Título" medida={`${m?.tituloCaracteres ?? 0} / ${LIMITE_TITULO_CARACTERES} caracteres`} lleno={(m?.tituloCaracteres ?? 0) / LIMITE_TITULO_CARACTERES} alerta={(m?.tituloCaracteres ?? 0) > LIMITE_TITULO_CARACTERES} copiar={titulo}>
                <p className="text-[13.5px] leading-[1.5] text-[var(--ls-t1)]">
                  {titulo ? (
                    <>
                      {[...titulo].slice(0, LIMITE_TITULO_CARACTERES).join('')}
                      {/* Lo que pasa de 75: lo que Amazon recorta o reescribe */}
                      {[...titulo].length > LIMITE_TITULO_CARACTERES && (
                        <span className="rounded-[3px] px-[1px]" style={{ color: COLOR_ESTADO.rojo, background: `color-mix(in srgb, ${COLOR_ESTADO.rojo} 12%, transparent)` }} title="Lo que pasa de 75 caracteres">
                          {[...titulo].slice(LIMITE_TITULO_CARACTERES).join('')}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-[var(--ls-t4)]">Sin título</span>
                  )}
                </p>
              </Bloque>
              <Bloque titulo="Item Highlights" medida={`— / ${LIMITE_HIGHLIGHTS_CARACTERES} caracteres`} lleno={0} alerta={false}>
                <p className="flex items-start gap-2 text-[12px] leading-[1.5] text-[var(--ls-t3)]">
                  <Info className="mt-[3px] h-3 w-3 shrink-0" /> La API de Amazon no los devuelve en lo que lee el ERP: revísalos en Seller Central. Se indexan igual que el título; ahí va lo que no cabe en los 75 caracteres (formato, cantidad, duración). La propuesta con IA los escribe.
                </p>
              </Bloque>
              <Bloque titulo="Viñetas (bullets)" medida={`${ficha.bullets.length} de 5 · ${entero(m?.bulletsBytes ?? 0)} / ${entero(LIMITE_BULLETS_BYTES)} bytes`} lleno={(m?.bulletsBytes ?? 0) / LIMITE_BULLETS_BYTES} alerta={ficha.bullets.length < 5 || (m?.bulletsBytes ?? 0) > LIMITE_BULLETS_BYTES} copiar={ficha.bullets.join('\n')}>
                {ficha.bullets.length === 0 ? (
                  <p className="text-[12.5px] text-[var(--ls-t4)]">Sin viñetas.</p>
                ) : (
                  <ul className="flex flex-col gap-[6px]">
                    {ficha.bullets.map((b, i) => (
                      <li key={i} className="flex gap-2 text-[12.5px] leading-[1.5] text-[var(--ls-t2)]">
                        <span className="mt-[7px] h-[5px] w-[5px] shrink-0 rounded-full bg-[var(--ls-t4)]" />
                        <span className="min-w-0 flex-1">{b}</span>
                        <span className="shrink-0 text-[10.5px] tabular-nums text-[var(--ls-t4)]" title="Bytes de esta viñeta (lo ideal, unos 200)">{bytesDe(b)} B</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Bloque>
              <Bloque titulo="Palabras clave ocultas (backend)" medida={`${m?.backendBytes ?? 0} / ${LIMITE_BACKEND_BYTES} bytes`} lleno={(m?.backendBytes ?? 0) / LIMITE_BACKEND_BYTES} alerta={(m?.backendBytes ?? 0) > LIMITE_BACKEND_BYTES} copiar={ficha.backend ?? ''}>
                {ficha.backend ? (
                  <p className="font-mono text-[12px] leading-[1.6] text-[var(--ls-t2)]">
                    {ficha.backend.split(/(\s+)/).map((w, i) =>
                      repetidas.has(normalizar(w)) ? (
                        <span key={i} className="line-through decoration-[1.5px]" style={{ color: COLOR_ESTADO.ambar }} title="Ya está en el título o en las viñetas (o repetida): gasta bytes sin sumar">
                          {w}
                        </span>
                      ) : (
                        <span key={i}>{w}</span>
                      )
                    )}
                  </p>
                ) : (
                  <p className="text-[12px] text-[var(--ls-t4)]">Vacío: son 249 bytes gratis para búsquedas que no caben arriba.</p>
                )}
                {(m?.backendDesperdiciado ?? 0) > 0 && <p className="mt-2 text-[11.5px]" style={{ color: COLOR_ESTADO.ambar }}>Tachado: {m?.backendDesperdiciado} bytes en palabras que ya están arriba. Amazon indexa palabras sueltas: repetir no suma.</p>}
                {(m?.backendBytes ?? 0) > LIMITE_BACKEND_BYTES && <p className="mt-2 text-[11.5px]" style={{ color: COLOR_ESTADO.rojo }}>Pasa de {LIMITE_BACKEND_BYTES} bytes: Amazon ignora el backend ENTERO.</p>}
              </Bloque>
            </div>

            <div className="flex min-w-0 flex-col gap-3">
              <section className={CAJA.base}>
                <header className={`${CAJA.cabecera} justify-between`}>
                  <h3 className="text-[13px] font-semibold text-[var(--ls-t1)]">Palabras que pesan y no están en el título</h3>
                  {pesan.length > 0 && <BotonCopiar texto={pesan.map((p) => p.palabra).join(' ')} compacto />}
                </header>
                <div className={CAJA.cuerpo}>
                  {!hayBusquedas ? (
                    <p className="text-[12px] text-[var(--ls-t4)]">Llega con el informe de Brand Analytics.</p>
                  ) : pesan.length === 0 ? (
                    <p className="text-[12.5px]" style={{ color: COLOR_ESTADO.verde }}>Las palabras de las búsquedas del producto ya están en el título.</p>
                  ) : (
                    <div className="flex flex-col gap-[6px]">
                      {pesan.map((p) => {
                        const donde = p.enBullets ? 'en viñetas' : p.enBackend ? 'en backend' : 'en ninguna parte'
                        return (
                          <div key={p.palabra} className="flex items-center gap-2">
                            <span className="rounded-[6px] bg-[var(--ls-sup2)] px-[7px] py-[2px] text-[12.5px] font-medium text-[var(--ls-t1)]">{p.palabra}</span>
                            <span className="text-[11px] text-[var(--ls-t4)]">
                              {entero(p.compras)} compras · {entero(p.volumen)} búsquedas · en {p.busquedas} {p.busquedas === 1 ? 'búsqueda' : 'búsquedas'}
                            </span>
                            <span className="ml-auto text-[11px]" style={{ color: p.enBullets || p.enBackend ? 'var(--ls-t3)' : COLOR_ESTADO.ambar }}>
                              {donde}
                            </span>
                          </div>
                        )
                      })}
                      <p className="mt-1 text-[11px] text-[var(--ls-t4)]">Solo de búsquedas del producto: sin ruido ni falsos amigos por precio. Antes de meter una, comprueba que describe el producto (SOP, paso 3).</p>
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
                    <p className="text-[12.5px] text-[var(--ls-t3)]">{!hayBusquedas ? 'Llega con el informe de Brand Analytics.' : 'Ninguna: las búsquedas del producto con compras tienen todas sus palabras en algún sitio de la ficha.'}</p>
                  ) : (
                    <div className="flex flex-col divide-y divide-[var(--ls-linea)]">
                      {sinCubrir.map((c) => (
                        <div key={c.consulta} className="flex items-center gap-2 py-[7px]">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[12.5px] font-medium text-[var(--ls-t1)]">{c.consulta}</div>
                            <div className="text-[11px] text-[var(--ls-t4)]">
                              {entero(c.comprasTotal)} compras en Amazon · tú {entero(c.comprasAsin)}
                            </div>
                          </div>
                          <span className="text-[11px]" style={{ color: COLOR_ESTADO.ambar }}>
                            falta: {c.cob.faltan.join(', ')}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>

              <VendePorPublicidad publicidad={publicidad.datos} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * LA PUERTA DE SALIDA DEL SOP: antes de tocar la ficha, ¿es de verdad un problema de SEO? Si el embudo del producto se cae en clics, carrito o compra, se dice claro y quién lo tiene que arreglar.
 * Y si la ficha se cambió hace menos de 30 días, también: no se toca.
 */
function PuertaDeSalida({ d, hayBusquedas, ventana }: { d: ReturnType<typeof diagnosticoDe> | null; hayBusquedas: boolean; ventana: ReturnType<typeof ventanaDeCambio> }) {
  const v = d?.producto.veredicto
  const fecha = (x: string) => new Date(`${x}T00:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', timeZone: 'UTC' })
  const bloques: Array<{ color: string; Icono: typeof CircleAlert; titulo: string; texto: string }> = []
  if (ventana?.bloqueada) bloques.push({ color: COLOR_ESTADO.ambar, Icono: TriangleAlert, titulo: `Ficha cambiada el ${fecha(ventana.ultimo)}: no se toca el título hasta el ${fecha(ventana.puedeDesde)}`, texto: `El SOP pide como mucho un cambio de título cada 30 días y 21 días antes de juzgarlo (${ventana.juzgable ? 'ya se puede juzgar' : `se juzga desde el ${fecha(ventana.juzgarDesde)}`}). Si no, el resultado no se puede atribuir a ningún cambio.` })
  if (v?.tipo === 'fuga') {
    const r = RESPONSABLE[v.etapa]
    bloques.push({ color: COLOR_ESTADO.ambar, Icono: CircleAlert, titulo: `Antes de reescribir: el embudo se cae en ${NOMBRE_DE_ETAPA[v.etapa].toLowerCase()}. No es SEO, es de: ${r.quien}`, texto: `${v.motivo} ${r.accion} Reescribir el título aquí no cambia nada y gasta la ventana de cambio del mes.` })
  } else if (v?.tipo === 'infraexpuesta') {
    bloques.push({ color: COLOR_ESTADO.violeta, Icono: Info, titulo: 'Convierte de sobra y sale poco: lo más rápido es publicidad', texto: `${v.motivo} ${RESPONSABLE_INFRAEXPUESTA.accion}` })
  } else if (v?.tipo === 'visibilidad' || v?.tipo === 'lider') {
    bloques.push({ color: COLOR_ESTADO.verde, Icono: CircleCheck, titulo: v.tipo === 'lider' ? 'El producto ya manda en sus búsquedas' : 'El embudo dice que es SEO: el trabajo está en la ficha', texto: v.motivo })
  } else if (!hayBusquedas) {
    bloques.push({ color: 'var(--ls-t4)', Icono: Info, titulo: 'Sin búsquedas de Brand Analytics todavía', texto: 'Sin ellas no se puede saber si el problema es de SEO. La revisión de la norma de abajo sí vale ya.' })
  }
  if (bloques.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      {bloques.map((b) => (
        <div key={b.titulo} className="flex items-start gap-3 rounded-[12px] border px-4 py-3" style={{ borderColor: `color-mix(in srgb, ${b.color} 35%, var(--ls-linea))`, background: `color-mix(in srgb, ${b.color} 6%, var(--ls-sup))` }}>
          <b.Icono className="mt-[2px] h-[15px] w-[15px] shrink-0" style={{ color: b.color }} />
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-[var(--ls-t1)]">{b.titulo}</div>
            <div className="mt-[2px] text-[12.5px] leading-[1.5] text-[var(--ls-t3)]">{b.texto}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

/** Lo que incumple la norma de 2026, de lo más grave a lo menos, con qué hacer. Sin nada, una línea verde */
function RevisionDeNorma({ incidencias }: { incidencias: ReturnType<typeof revisarFicha>['incidencias'] }) {
  const graves = incidencias.filter((i) => i.gravedad === 'grave').length
  return (
    <section className={CAJA.base}>
      <header className={CAJA.cabecera}>
        <h3 className="text-[13px] font-semibold text-[var(--ls-t1)]">Norma de 2026</h3>
        <span className="text-[11.5px] text-[var(--ls-t4)]">título 75 · Item Highlights 125 · viñetas 1.000 bytes · backend 249 bytes · recuentos calculados</span>
        {incidencias.length > 0 && (
          <span className="ml-auto text-[11.5px] font-medium" style={{ color: graves > 0 ? COLOR_ESTADO.rojo : COLOR_ESTADO.ambar }}>
            {graves > 0 ? `${graves} ${graves === 1 ? 'incumplimiento' : 'incumplimientos'}` : `${incidencias.length} ${incidencias.length === 1 ? 'mejora' : 'mejoras'}`}
          </span>
        )}
      </header>
      {incidencias.length === 0 ? (
        <p className={`${CAJA.cuerpo} flex items-center gap-2 text-[12.5px]`} style={{ color: COLOR_ESTADO.verde }}>
          <CircleCheck className="h-[14px] w-[14px]" /> Cumple las reglas de 2026 en título, viñetas y backend.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--ls-linea)]">
          {incidencias.map((i) => (
            <li key={i.id} className="flex items-start gap-3 px-4 py-[9px]">
              <span className="mt-[6px] h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: COLOR_GRAVEDAD[i.gravedad] }} />
              <div className="min-w-0 text-[12.5px] leading-[1.5]">
                <div className="text-[var(--ls-t1)]">{i.texto}</div>
                <div className="text-[var(--ls-t3)]">{i.accion}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Términos que han traído pedidos en las campañas de Marketing Test del producto y cuyas palabras no están en la ficha */
function VendePorPublicidad({ publicidad }: { publicidad: DatosDePublicidad | null }) {
  if (!publicidad || !publicidad.hayMarketingTest) return null
  return (
    <section className={CAJA.base}>
      <header className={CAJA.cabecera}>
        <Megaphone className="h-[14px] w-[14px] text-[var(--ls-t3)]" />
        <h3 className="text-[13px] font-semibold text-[var(--ls-t1)]">Vende por publicidad y no está en la ficha</h3>
      </header>
      <div className={CAJA.cuerpo}>
        {publicidad.vendePorPublicidad.length === 0 ? (
          <p className="text-[12.5px] text-[var(--ls-t3)]">{publicidad.campanas === 0 ? 'Este producto no tiene campañas en Marketing Test (o aún no se han leído sus términos).' : 'Nada: lo que convierte en publicidad ya está en la ficha.'}</p>
        ) : (
          <div className="flex flex-col divide-y divide-[var(--ls-linea)]">
            {publicidad.vendePorPublicidad.map((t) => (
              <div key={t.termino} className="flex items-center gap-2 py-[7px]">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-medium text-[var(--ls-t1)]">{t.termino}</div>
                  <div className="text-[11px] text-[var(--ls-t4)]">
                    {entero(t.pedidos)} {t.pedidos === 1 ? 'pedido' : 'pedidos'} por publicidad · {entero(t.clics)} clics
                  </div>
                </div>
                <span className="text-[11px]" style={{ color: COLOR_ESTADO.ambar }}>
                  falta: {t.faltan.join(', ')}
                </span>
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 text-[11px] text-[var(--ls-t4)]">Términos de búsqueda de las campañas de Marketing Test del producto. La propuesta con IA los tiene en cuenta.</p>
      </div>
    </section>
  )
}

function Bloque({ titulo, medida, lleno, alerta, copiar, children }: { titulo: string; medida: string; lleno: number; alerta: boolean; copiar?: string; children: React.ReactNode }) {
  return (
    <section className={CAJA.base}>
      <header className={`${CAJA.cabecera} justify-between`}>
        <h3 className="text-[13px] font-semibold text-[var(--ls-t1)]">{titulo}</h3>
        <div className="flex items-center gap-2">
          <div className="h-[5px] w-[80px] overflow-hidden rounded-full bg-[var(--ls-sup2)]">
            <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(lleno > 0 ? 2 : 0, lleno * 100))}%`, background: alerta ? COLOR_ESTADO.ambar : COLOR_ESTADO.verde }} />
          </div>
          <span className="text-[11px] tabular-nums" style={{ color: alerta ? COLOR_ESTADO.ambar : 'var(--ls-t4)' }}>{medida}</span>
          {copiar != null && <BotonCopiar texto={copiar} compacto />}
        </div>
      </header>
      <div className={CAJA.cuerpo}>{children}</div>
    </section>
  )
}
