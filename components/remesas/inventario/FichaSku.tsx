'use client'

import { AlertTriangle } from 'lucide-react'
import { Dialogo } from '@/components/plataforma/comun'
import { AVISO, COLOR_ESTADO, TABLA } from '@/lib/estilo/denso'
import { costeMensual, mesDe, type SupuestosAlmacenaje } from '@/lib/fba/almacenaje'
import { TRAMOS_EDAD, tramoDe, type SkuInventario } from '@/lib/fba/inventario'
import { TRAMOS_AMAZON } from '@/lib/fba/planificacion'
import { ChipEstado, Dato, GraficoSerie } from './piezas'
import { COLOR_TRAMO, COLOR_TRAMO_AMAZON, eur, eur2, eurFino, hace, m3, n0, n2, pct } from './formato'
import { cx } from '../comun/ui'
import { fecha } from '../formato'

/**
 * LA FICHA DE UN PRODUCTO: TODO LO QUE SE SABE DE UNA REFERENCIA EN AMAZON.
 *
 * Qué hay, a qué ritmo se vende, cuánto se devuelve, de qué llegada es cada unidad y
 * cuánto lleva esperando. Los lotes son los de la convención FIFO (lib/fba/fifo.ts): la
 * mercancía de Amazon está mezclada y esto es la forma de contarla, no un dato de Amazon.
 */

const TEXTO_ALERTA: Record<string, (s: SkuInventario) => string> = {
  'devoluciones altas': (s) =>
    `Se devuelve el ${pct(s.tasaDevolucion90)} de lo que se vende (${n0(s.devueltas.d90)} de ${n0(s.vendidas.d90)} unidades en 90 días). Merece mirar el motivo de las devoluciones.`,
  'stock de más de 270 días': (s) =>
    `${n0(s.porTramo.t271 + s.porTramo.t366)} unidades llevan más de 270 días en Amazon. A partir de ahí Amazon puede cobrar un recargo por antigüedad.`,
  'unidades no disponibles': (s) =>
    `${n0(s.noDisponibles)} unidades están en la red de Amazon pero no se pueden vender ahora: pueden ser mercancía en tránsito que no está registrada, reservada para un pedido o un traslado, o dañada. Se mira en Seller Central.`,
  'ritmo poco fiable': () => 'Lleva poco tiempo en Amazon o ha vendido pocas unidades en el último mes: el ritmo y los días de stock son orientativos.',
}

export function FichaSku({
  sku,
  hoy,
  leidoHasta,
  supuestos,
  onCerrar,
}: {
  sku: SkuInventario
  hoy: string
  /** El último día del libro: el último valor de la serie de ventas es ese día */
  leidoHasta: string | null
  supuestos: SupuestosAlmacenaje
  onCerrar: () => void
}) {
  const mes = mesDe(hoy)
  const enAlmacen = Math.max(0, sku.enAmazon - sku.entrante)
  const tendencia = sku.tendencia === 'sube' ? '↑ al alza' : sku.tendencia === 'baja' ? '↓ a la baja' : sku.tendencia === 'estable' ? '→ estable' : null

  return (
    <Dialogo
      titulo={sku.sku}
      entradilla={
        <span>
          {sku.nombre ?? 'Sin título en el catálogo'}
          {sku.asin && <span className="ml-2 font-mono text-[11px] text-[var(--ls-t4)]">{sku.asin}</span>}
          {sku.precio !== null && <span className="ml-2 text-[var(--ls-t3)]">· {eur2(sku.precio)}</span>}
        </span>
      }
      onCerrar={onCerrar}
      ancho="max-w-[900px]"
    >
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <ChipEstado estado={sku.estado} />
          {sku.muestraCorta && sku.ritmoPlan > 0 && <span className="text-[11.5px] text-[var(--ls-t4)]">ritmo orientativo</span>}
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Dato rotulo="En Amazon" valor={n0(sku.enAmazon)} sub={`vendibles ${n0(sku.vendibles)} · de camino ${n0(sku.entrante)} · no vendibles ${n0(sku.noDisponibles)}`} />
          <Dato
            rotulo="Días de stock"
            valor={sku.vendibles <= 0 ? (sku.entrante > 0 ? 'de camino' : 'agotado') : sku.cobertura === null ? '—' : `${n0(sku.cobertura)} d`}
            sub={sku.seAgotaEl ? `se agota el ${fecha(sku.seAgotaEl)}` : undefined}
            tono={sku.estado === 'agotado' ? 'rojo' : sku.estado === 'urgente' ? 'naranja' : sku.estado === 'bajo' ? 'ambar' : undefined}
          />
          <Dato rotulo="Ritmo de venta" valor={`${n2(sku.ritmoPlan)} ud/día`} sub={`7 d: ${n2(sku.ritmo7)} · 30 d: ${n2(sku.ritmo30)} · 90 d: ${n2(sku.ritmo90)}`} />
          <Dato rotulo="Tendencia" valor={tendencia ?? '—'} sub={tendencia ? 'últimas dos semanas frente a los dos meses' : 'pocas ventas para saberlo'} />
          <Dato rotulo="Vendidas" valor={`${n0(sku.vendidas.d30)} en 30 d`} sub={`7 d: ${n0(sku.vendidas.d7)} · 90 d: ${n0(sku.vendidas.d90)}`} />
          <Dato rotulo="Última venta" valor={sku.ultimaVenta ? hace(sku.diasSinVenta) : 'nunca'} sub={sku.ultimaVenta ? fecha(sku.ultimaVenta) : 'en lo que cubre el libro'} tono={sku.estado === 'parado' ? 'magenta' : undefined} />
          <Dato
            rotulo="Devoluciones (90 d)"
            valor={`${n0(sku.devueltas.d90)} uds`}
            sub={sku.tasaDevolucion90 === null ? 'sin ventas' : `${pct(sku.tasaDevolucion90)} de lo vendido`}
            tono={sku.alertas.includes('devoluciones altas') ? 'ambar' : undefined}
          />
          <Dato rotulo="Tiempo medio de venta" valor={sku.diasMedioDeVenta === null ? '—' : `${n0(sku.diasMedioDeVenta)} d`} sub="desde que llega hasta que se vende" />
          <Dato rotulo="Edad del stock" valor={sku.edadMediaDias === null ? '—' : `${n0(sku.edadMediaDias)} d de media`} sub={sku.edadMaxDias === null ? undefined : `la más vieja: ${n0(sku.edadMaxDias)} d`} />
          <Dato rotulo="Valor del stock" valor={eur(sku.valorStock)} sub={sku.precio === null ? 'sin precio en el catálogo' : 'a precio de venta'} />
          {sku.edadAmazon?.costeMes != null ? (
            <Dato
              rotulo="Almacenaje (Amazon)"
              valor={`${eurFino(sku.edadAmazon.costeMes)}/mes`}
              sub={sku.edadAmazon.recargoMes > 0 ? `lo que calcula Amazon · recargo ${eurFino(sku.edadAmazon.recargoMes)}` : 'lo que calcula Amazon para el mes que viene'}
            />
          ) : (
            <Dato rotulo="Almacenaje (estimado)" valor={`${eur2(costeMensual(enAlmacen, mes, supuestos))}/mes`} sub={`${m3((enAlmacen * supuestos.litrosPorUnidad) / 1000)} · supuesto de ${n0(supuestos.litrosPorUnidad)} L/ud`} />
          )}
          <Dato rotulo="Retiradas y mermas" valor={`${n0(sku.retiradas)} · ${n0(sku.mermas)}`} sub="unidades retiradas del almacén · dadas por perdidas" />
        </dl>

        {sku.serie90 && leidoHasta && (
          <section>
            <h4 className="mb-1 text-[12px] font-semibold text-[var(--ls-t2)]">Ventas por día, últimos 90 días</h4>
            <GraficoSerie serie={sku.serie90} fin={leidoHasta} />
          </section>
        )}

        {sku.edadAmazon && (
          <section>
            <h4 className="mb-1 text-[12px] font-semibold text-[var(--ls-t2)]">
              Antigüedad según Amazon
              <span className="ml-2 font-normal text-[var(--ls-t4)]">la que usa para cobrar el almacenaje: unidades por tramo, en días</span>
            </h4>
            <div className="grid grid-cols-4 gap-[6px] sm:grid-cols-7">
              {TRAMOS_AMAZON.map((t) => {
                const u = sku.edadAmazon?.edad[t.id] ?? 0
                return (
                  <div key={t.id} className="rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2 py-[6px] text-center">
                    <div className="flex items-center justify-center gap-[5px] text-[10.5px] text-[var(--ls-t4)]">
                      <span className="h-[7px] w-[7px] rounded-[2px]" style={{ background: COLOR_TRAMO_AMAZON[t.id] }} aria-hidden />
                      {t.texto.replace(' días', '')}
                    </div>
                    <div className={cx('mt-[2px] text-[15px] font-semibold tabular-nums', u > 0 ? 'text-[var(--ls-t1)]' : 'text-[var(--ls-t4)]')}>{n0(u)}</div>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        <section>
          <h4 className="mb-1 text-[12px] font-semibold text-[var(--ls-t2)]">
            De qué llegada es lo que queda
            <span className="ml-2 font-normal text-[var(--ls-t4)]">
              {sku.edadAmazon ? 'estimado con el libro mayor: lo más antiguo se vende primero (FIFO)' : 'la mercancía más antigua se vende primero (FIFO)'}
            </span>
          </h4>
          {sku.lotes.length === 0 ? (
            <p className="rounded-[6px] border border-dashed border-[var(--ls-linea2)] px-3 py-3 text-[12px] leading-[1.5] text-[var(--ls-t3)]">
              {sku.anteriorALaLectura > 0
                ? `Las ${n0(sku.anteriorALaLectura)} unidades vendibles ya estaban en Amazon antes de que empezara el libro mayor, y no hay entrada que diga cuándo llegaron.`
                : 'Ninguna llegada registrada en el libro explica lo que hay ahora.'}
            </p>
          ) : (
            <div className="overflow-hidden rounded-[6px] border border-[var(--ls-linea)]">
              <table className={TABLA.tabla}>
                <thead>
                  <tr>
                    <th className={cx(TABLA.cabecera, '!static')}>Llegó</th>
                    <th className={cx(TABLA.cabecera, '!static')}>Envío</th>
                    <th className={cx(TABLA.cabecera, TABLA.derecha, '!static')}>Recibidas</th>
                    <th className={cx(TABLA.cabecera, TABLA.derecha, '!static')}>Quedan</th>
                    <th className={cx(TABLA.cabecera, TABLA.derecha, '!static')}>Lleva</th>
                  </tr>
                </thead>
                <tbody>
                  {[...sku.lotes]
                    .sort((a, b) => a.desde.localeCompare(b.desde))
                    .map((l) => (
                      <tr key={`${l.referencia}|${l.desde}`} className={TABLA.fila}>
                        <td className={TABLA.celda}>{fecha(l.desde)}</td>
                        <td className={cx(TABLA.celda, 'text-[var(--ls-t3)]')}>
                          {l.nombreEnvio ? `${l.nombreEnvio} · ` : ''}
                          <span className="font-mono text-[11.5px]">{l.referencia ?? '—'}</span>
                        </td>
                        <td className={cx(TABLA.celda, TABLA.numero, 'text-[var(--ls-t3)]')}>{n0(l.recibidas)}</td>
                        <td className={cx(TABLA.celda, TABLA.numero, 'font-semibold text-[var(--ls-t1)]')}>{n0(l.quedan)}</td>
                        <td className={cx(TABLA.celda, TABLA.numero)}>
                          <span className="inline-flex items-center justify-end gap-[6px]">
                            <span className="h-[7px] w-[7px] rounded-[2px]" style={{ background: COLOR_TRAMO[tramoDe(l.edadDias)] }} aria-hidden />
                            {n0(l.edadDias)} d
                            <span className="text-[11px] text-[var(--ls-t4)]">({TRAMOS_EDAD.find((t) => t.id === tramoDe(l.edadDias))?.texto})</span>
                          </span>
                        </td>
                      </tr>
                    ))}
                  {sku.anteriorALaLectura > 0 && (
                    <tr>
                      <td className={cx(TABLA.celda, 'text-[var(--ls-t4)]')} colSpan={3}>
                        Anterior al libro mayor: sin entrada que diga cuándo llegó
                      </td>
                      <td className={cx(TABLA.celda, TABLA.numero, 'font-semibold text-[var(--ls-t1)]')}>{n0(sku.anteriorALaLectura)}</td>
                      <td className={cx(TABLA.celda, TABLA.numero, 'text-[var(--ls-t4)]')}>más de lo que cubre el libro</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {sku.alertas.length > 0 && (
          <ul className="space-y-[6px]">
            {sku.alertas.map((a) => (
              <li key={a} className={cx(AVISO.base, AVISO.conTono)} style={{ borderLeftColor: COLOR_ESTADO.ambar }}>
                <AlertTriangle className={AVISO.icono} style={{ color: COLOR_ESTADO.ambar }} />
                <span>{TEXTO_ALERTA[a]?.(sku) ?? a}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialogo>
  )
}
