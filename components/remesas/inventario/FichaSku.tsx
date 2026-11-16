'use client'

import { useRef, type ReactNode } from 'react'
import { AlertTriangle, Package } from 'lucide-react'
import { PanelLateral } from '@/components/ui-ls'
import { AVISO, COLOR_ESTADO, TABLA } from '@/lib/estilo/denso'
import { costeMensual, mesDe, type SupuestosAlmacenaje } from '@/lib/fba/almacenaje'
import { dentroDe, TRAMOS_EDAD, tramoDe, type SkuInventario } from '@/lib/fba/inventario'
import { TRAMOS_AMAZON } from '@/lib/fba/planificacion'
import type { EnCamino } from '@/lib/fba/plan-tipos'
import { ProyeccionStock } from '../comun/ProyeccionStock'
import { AVISO_LINEA, CONFIANZA } from '../comun/estilo-plan'
import { cx } from '../comun/ui'
import { fecha, fechaCorta, ritmo as fmtRitmo, unidades } from '../formato'
import { Dato, GraficoSerie, InsigniaEstadoStock } from './piezas'
import { COLOR_TRAMO, COLOR_TRAMO_AMAZON, din, eurFino, hace, llegadasAproximadas, m3, n0, n2, pct, type FilaStock } from './formato'

/**
 * LA FICHA DE UN PRODUCTO: TODO LO QUE SE SABE DE UNA REFERENCIA EN AMAZON (spec remesas-pro §8, D38 y D43.1).
 *
 * En un `PanelLateral` (a la derecha en el ordenador; hoja inferior en el móvil). Es de solo lectura, sin portales dentro:
 * por eso puede ir en el panel modal (D38).
 *
 *   · Qué hay ahora, a qué ritmo se vende y cuánto dura. Ritmo, cobertura y rotura salen del PLAN si la referencia está en
 *     él (y se dice), si no, del inventario.
 *   · La proyección del stock día a día (`ProyeccionStock`, D43.1) con el ritmo del plan y lo que viene de camino.
 *   · Ventas de 90 días, antigüedad según Amazon y de qué llegada es lo que queda (FIFO), y los avisos.
 *
 * La agencia ve además por qué el plan propone lo que propone y sus avisos; el cliente externo, no (D26).
 *
 * API
 *   <FichaSku fila hoy leidoHasta supuestos moneda enCamino plazo? esAgencia onCerrar />   fila null = cerrada
 */

const TEXTO_ALERTA: Record<string, (s: SkuInventario) => string> = {
  'devoluciones altas': (s) =>
    `Se devuelve el ${pct(s.tasaDevolucion90)} de lo que se vende (${n0(s.devueltas.d90)} de ${n0(s.vendidas.d90)} unidades en 90 días). Merece mirar el motivo de las devoluciones.`,
  'stock de más de 270 días': (s) =>
    `${n0(s.porTramo.t271 + s.porTramo.t366)} unidades llevan más de 270 días en Amazon. A partir de ahí Amazon puede cobrar un recargo por antigüedad.`,
  'unidades no disponibles': (s) =>
    s.reservadas != null
      ? `${n0(s.noDisponibles)} unidades figuran como «No apto para envío» en Amazon: dañadas o defectuosas. Se mira en Seller Central.`
      : `${n0(s.noDisponibles)} unidades están en la red de Amazon pero no se pueden vender ahora: pueden ser mercancía en tránsito que no está registrada, reservada para un pedido o un traslado, o dañada. Se mira en Seller Central.`,
  'ritmo poco fiable': () => 'Lleva poco tiempo en Amazon o ha vendido pocas unidades en el último mes: el ritmo y los días de stock son orientativos.',
}

export interface FichaSkuProps {
  fila: FilaStock | null
  hoy: string
  /** El último día del libro: el último valor de la serie de ventas es ese día */
  leidoHasta: string | null
  supuestos: SupuestosAlmacenaje
  moneda: string
  /** Los envíos de camino del cliente (del plan): para fechar lo que viene */
  enCamino: readonly EnCamino[]
  /** Plazo hasta la venta y margen (solo agencia) */
  plazo?: { hastaLaVenta: number; margen: number } | null
  esAgencia: boolean
  onCerrar: () => void
}

export function FichaSku({ fila, ...resto }: FichaSkuProps) {
  // Se recuerda la última abierta: al cerrar, el panel sale con su contenido y no en blanco
  const ultima = useRef<FilaStock | null>(null)
  if (fila) ultima.current = fila
  const f = fila ?? ultima.current
  return (
    <PanelLateral
      abierto={!!fila}
      onCambio={(a) => !a && resto.onCerrar()}
      titulo={<span className="font-mono">{f?.sku.sku ?? ''}</span>}
      descripcion={
        f ? (
          <span>
            {f.sku.nombre ?? 'Sin título en el catálogo'}
            {f.sku.asin && <span className="ml-2 font-mono text-[11px] text-[var(--ls-t4)]">{f.sku.asin}</span>}
            {f.sku.precio !== null && <span className="ml-2">· {din(f.sku.precio, f.sku.moneda ?? resto.moneda)}</span>}
          </span>
        ) : undefined
      }
      icono={Package}
      acento="remesas"
      ancho={600}
      acciones={f ? <InsigniaEstadoStock estado={f.estado} /> : undefined}
    >
      {f && <Contenido fila={f} {...resto} />}
    </PanelLateral>
  )
}

function Seccion({ titulo, nota, children }: { titulo: string; nota?: string; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <h4 className="mb-2 text-[12.5px] font-semibold text-[var(--ls-t2)]">
        {titulo}
        {nota && <span className="ml-2 font-normal text-[var(--ls-t4)]">{nota}</span>}
      </h4>
      {children}
    </section>
  )
}

function Contenido({ fila, hoy, leidoHasta, supuestos, moneda, enCamino, plazo, esAgencia }: Omit<FichaSkuProps, 'fila' | 'onCerrar'> & { fila: FilaStock }) {
  const sku = fila.sku
  const l = fila.linea
  const mes = mesDe(hoy)
  const enAlmacen = dentroDe(sku)
  const tendencia = sku.tendencia === 'sube' ? '↑ al alza' : sku.tendencia === 'baja' ? '↓ a la baja' : sku.tendencia === 'estable' ? '→ estable' : null
  const consumo = l ? (l.ritmo.consumoNeto ?? l.ritmo.previsto ?? l.ritmo.base ?? 0) : (fila.ritmo ?? 0)
  const llegadas = l ? llegadasAproximadas(l, enCamino, hoy, plazo?.hastaLaVenta ?? null) : sku.entrante > 0 ? llegadasAproximadas({ deCamino: sku.entrante }, enCamino, hoy, plazo?.hastaLaVenta ?? null) : []
  const conf = fila.confianza ? CONFIANZA[fila.confianza] : null
  const cantidad = esAgencia && l?.cantidad && l.cantidad > 0 ? l.cantidad : null
  const vendibles = l ? l.vendibles : sku.vendibles

  return (
    <div className="space-y-5">
      {/* ---------- Ahora ---------- */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <Dato rotulo="En Amazon" valor={n0(enAlmacen)} sub={`vendibles ${n0(sku.vendibles)} · de camino ${n0(sku.entrante)} · no vendibles ${n0(sku.noDisponibles)}`} />
        <Dato
          rotulo="Dura"
          valor={sku.vendibles <= 0 && (fila.cobertura ?? 0) <= 0 ? (sku.entrante > 0 ? 'de camino' : 'agotado') : fila.cobertura === null ? '—' : `${n0(fila.cobertura)} d`}
          sub={fila.rotura ? `sin stock el ${fechaCorta(fila.rotura, hoy)}` : fila.origen === 'plan' ? 'con lo que viene de camino' : undefined}
          tono={fila.estado === 'agotado' || fila.estado === 'urgente' ? 'rojo' : fila.estado === 'bajo' ? 'ambar' : undefined}
        />
        <Dato
          rotulo="Ritmo de venta"
          valor={fila.ritmo === null ? '—' : fmtRitmo(fila.ritmo)}
          sub={fila.origen === 'plan' ? (conf ? conf.texto.toLowerCase() : 'confianza alta') : `7 d: ${n2(sku.ritmo7)} · 30 d: ${n2(sku.ritmo30)} · 90 d: ${n2(sku.ritmo90)}`}
        />
        <Dato rotulo="Tendencia" valor={tendencia ?? '—'} sub={tendencia ? 'dos últimas semanas frente a los dos meses' : 'pocas ventas para saberlo'} />
        <Dato rotulo="Vendidas" valor={`${n0(sku.vendidas.d30)} en 30 d`} sub={`7 d: ${n0(sku.vendidas.d7)} · 90 d: ${n0(sku.vendidas.d90)}`} />
        <Dato rotulo="Última venta" valor={sku.ultimaVenta ? hace(sku.diasSinVenta) : 'nunca'} sub={sku.ultimaVenta ? fecha(sku.ultimaVenta) : 'en lo que cubre el libro'} tono={fila.estado === 'parado' ? 'magenta' : undefined} />
        <Dato
          rotulo="Devoluciones (90 d)"
          valor={`${n0(sku.devueltas.d90)} uds`}
          sub={sku.tasaDevolucion90 === null ? 'sin ventas' : `${pct(sku.tasaDevolucion90)} de lo vendido`}
          tono={sku.alertas.includes('devoluciones altas') ? 'ambar' : undefined}
        />
        <Dato rotulo="Tiempo medio de venta" valor={sku.diasMedioDeVenta === null ? '—' : `${n0(sku.diasMedioDeVenta)} d`} sub="desde que llega hasta que se vende" />
        <Dato rotulo="Edad del stock" valor={sku.edadMediaDias === null ? '—' : `${n0(sku.edadMediaDias)} d de media`} sub={sku.edadMaxDias === null ? undefined : `la más vieja: ${n0(sku.edadMaxDias)} d`} />
        <Dato rotulo="Valor del stock" valor={din(sku.valorStock, sku.moneda ?? moneda)} sub={sku.precio === null ? 'sin precio en el catálogo' : 'a precio de venta'} />
        {sku.edadAmazon?.costeMes != null ? (
          <Dato
            rotulo="Almacenaje (Amazon)"
            valor={`${eurFino(sku.edadAmazon.costeMes)}/mes`}
            sub={sku.edadAmazon.recargoMes > 0 ? `lo que calcula Amazon · recargo ${eurFino(sku.edadAmazon.recargoMes)}` : 'lo que calcula Amazon para el mes que viene'}
          />
        ) : (
          <Dato
            rotulo="Almacenaje (estimado)"
            valor={`${eurFino(costeMensual(enAlmacen, mes, supuestos))}/mes`}
            sub={`${m3((enAlmacen * supuestos.litrosPorUnidad) / 1000)} · supuesto de ${n0(supuestos.litrosPorUnidad)} L/ud`}
          />
        )}
        <Dato rotulo="Retiradas y mermas" valor={`${n0(sku.retiradas)} · ${n0(sku.mermas)}`} sub="retiradas del almacén · dadas por perdidas" />
      </dl>

      <p className="rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-2 text-[11.5px] leading-[1.5] text-[var(--ls-t3)]">
        {fila.origen === 'plan' ? (
          <>
            <b className="font-semibold text-[var(--ls-t2)]">Ritmo, cobertura y rotura salen del plan de reposición.</b> {fila.ritmoExplicacion ?? ''}
            {fila.stockViejo && ' El stock de esta referencia sale de otro mercado y no es de hoy (Amazon no la da en el de la lectura).'}
          </>
        ) : (
          <>
            <b className="font-semibold text-[var(--ls-t2)]">Esta referencia no está en el plan:</b> ritmo y días de stock salen del inventario (mezcla de las dos últimas semanas y el último
            mes, sin contar lo que viene de camino).
          </>
        )}
      </p>

      {/* ---------- Proyección ---------- */}
      {consumo > 0 && (
        <Seccion titulo="Cómo va a ir el stock" nota="si se vende al ritmo del plan">
          <ProyeccionStock
            hoy={hoy}
            vendibles={vendibles}
            consumoDia={consumo}
            llegadas={llegadas}
            fechaRotura={fila.rotura}
            aLaVenta={cantidad ? (l?.aLaVentaObjetivo ?? null) : null}
            cantidadPropuesta={cantidad}
          />
          {llegadas.length > 0 && (
            <p className="mt-2 text-[11px] leading-[1.5] text-[var(--ls-t4)]">
              El plan sabe cuánto viene de camino de esta referencia, no en qué envío: se dibuja en la llegada del envío de camino más próximo. Lo dudoso no cuenta.
            </p>
          )}
        </Seccion>
      )}

      {/* ---------- Lo que dice el plan (agencia) ---------- */}
      {esAgencia && l && (l.porque || (l.avisos?.length ?? 0) > 0) && (
        <Seccion titulo="Lo que dice el plan">
          {l.porque && <p className="text-[12.5px] leading-[1.55] text-[var(--ls-t2)]">{l.porque}</p>}
          {cantidad && l.salirAntesDe && (
            <p className="mt-1 text-[12px] text-[var(--ls-t3)]">
              Propone {unidades(cantidad)}, que salgan antes del {fechaCorta(l.salirAntesDe, hoy)}
              {l.eurosEnRiesgo != null && l.eurosEnRiesgo > 0 ? ` · ${din(l.eurosEnRiesgo, l.moneda ?? moneda)} en juego si no sale` : ''}.
            </p>
          )}
          {(l.avisos?.length ?? 0) > 0 && (
            <ul className="mt-2 flex flex-wrap gap-[6px]">
              {(l.avisos ?? []).map((a) => (
                <li key={a} className="inline-flex items-center gap-[6px] rounded-full border border-[var(--ls-linea)] px-[9px] py-[3px] text-[11.5px] text-[var(--ls-t2)]">
                  <span className="h-[6px] w-[6px] rounded-full" style={{ background: COLOR_ESTADO[AVISO_LINEA[a].tono] }} aria-hidden />
                  {AVISO_LINEA[a].texto}
                </li>
              ))}
            </ul>
          )}
        </Seccion>
      )}

      {/* ---------- Ventas de 90 días ---------- */}
      {sku.serie90 && leidoHasta && (
        <Seccion titulo="Ventas por día, últimos 90 días">
          <GraficoSerie serie={sku.serie90} fin={leidoHasta} />
        </Seccion>
      )}

      {/* ---------- Antigüedad según Amazon ---------- */}
      {sku.edadAmazon && (
        <Seccion titulo="Antigüedad según Amazon" nota="la que usa para cobrar el almacenaje">
          <div className="grid grid-cols-4 gap-[6px] sm:grid-cols-7">
            {TRAMOS_AMAZON.map((t) => {
              const u = sku.edadAmazon?.edad[t.id] ?? 0
              return (
                <div key={t.id} className="rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2 py-[6px] text-center">
                  <div className="flex items-center justify-center gap-[5px] text-[10.5px] text-[var(--ls-t4)]">
                    <span className="h-[7px] w-[7px] rounded-[2px]" style={{ background: COLOR_TRAMO_AMAZON[t.id] }} aria-hidden />
                    {t.texto.replace(' días', '')}
                  </div>
                  <div className={cx('mt-[2px] text-[15px] font-semibold tabular-nums', u > 0 ? 'text-[var(--ls-t1)]' : 'text-[var(--ls-t4)]')}>{n0(u)}</div>
                </div>
              )
            })}
          </div>
        </Seccion>
      )}

      {/* ---------- FIFO ---------- */}
      <Seccion titulo="De qué llegada es lo que queda" nota="lo más antiguo se vende primero (FIFO)">
        {sku.lotes.length === 0 ? (
          <p className="rounded-[10px] border border-dashed border-[var(--ls-linea2)] px-3 py-3 text-[12px] leading-[1.5] text-[var(--ls-t3)]">
            {sku.anteriorALaLectura > 0
              ? `Las ${n0(sku.anteriorALaLectura)} unidades vendibles ya estaban en Amazon antes de que empezara el libro mayor, y no hay entrada que diga cuándo llegaron.`
              : 'Ninguna llegada registrada en el libro explica lo que hay ahora.'}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-[10px] border border-[var(--ls-linea)]">
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
                  .map((lote) => (
                    <tr key={`${lote.referencia}|${lote.desde}`} className={TABLA.fila}>
                      <td className={TABLA.celda}>{fecha(lote.desde)}</td>
                      <td className={cx(TABLA.celda, 'max-w-[180px] truncate text-[var(--ls-t3)]')}>
                        {lote.nombreEnvio ? `${lote.nombreEnvio} · ` : ''}
                        <span className="font-mono text-[11.5px]">{lote.referencia ?? '—'}</span>
                      </td>
                      <td className={cx(TABLA.celda, TABLA.numero, 'text-[var(--ls-t3)]')}>{n0(lote.recibidas)}</td>
                      <td className={cx(TABLA.celda, TABLA.numero, 'font-semibold text-[var(--ls-t1)]')}>{n0(lote.quedan)}</td>
                      <td className={cx(TABLA.celda, TABLA.numero)}>
                        <span className="inline-flex items-center justify-end gap-[6px]" title={TRAMOS_EDAD.find((t) => t.id === tramoDe(lote.edadDias))?.texto}>
                          <span className="h-[7px] w-[7px] rounded-[2px]" style={{ background: COLOR_TRAMO[tramoDe(lote.edadDias)] }} aria-hidden />
                          {n0(lote.edadDias)} d
                        </span>
                      </td>
                    </tr>
                  ))}
                {sku.anteriorALaLectura > 0 && (
                  <tr>
                    <td className={cx(TABLA.celda, 'text-[var(--ls-t4)]')} colSpan={3}>
                      Anterior al libro mayor
                    </td>
                    <td className={cx(TABLA.celda, TABLA.numero, 'font-semibold text-[var(--ls-t1)]')}>{n0(sku.anteriorALaLectura)}</td>
                    <td className={cx(TABLA.celda, TABLA.numero, 'text-[var(--ls-t4)]')}>más</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Seccion>

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
  )
}
