'use client'

import { ArrowDownRight, ArrowUpRight, LogOut, TriangleAlert } from 'lucide-react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { CAJA } from '@/components/marketing-test/piezas'
import { entero } from '@/components/marketing-test/formato'
import type { Movimientos, Mov } from '@/lib/seo/movimientos'
import type { GastoSemanal } from '@/lib/seo/periodo-mostrado'
import { frasesSinVentas, sinVentasEnPeriodo, type TramoSinVentas } from '@/lib/seo/sin-stock'

/**
 * «MOVIMIENTOS DE LA SEMANA» (encima de las tareas de Qué hacer hoy). Un bloque por producto:
 *   ▲ N suben · ▼ N bajan · N salen del informe, y las 3 búsquedas que más pesan con su cambio en puntos (pulsar abre la búsqueda).
 * La regla está en lib/seo/movimientos.ts (última semana frente a la media de las 4 anteriores, solo búsquedas relevantes con volumen).
 * CAÍDA GENERAL: si más de la mitad de las búsquedas de un producto bajan o salen a la vez, banner rojo con el gasto PPC de esas semanas: suele ser publicidad, stock o
 * supresión, no SEO.
 */

const pt = (d: number | null) => (d == null ? 'fuera' : `${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d).toLocaleString('es-ES', { maximumFractionDigits: 1 })} pt`)

export function FranjaDeMovimientos({
  porProducto,
  nombreDe,
  gastoSemanal,
  sinVentas = null,
  verBusqueda,
}: {
  porProducto: ReadonlyArray<{ asin: string; mov: Movimientos }>
  nombreDe: (asin: string) => string
  gastoSemanal: GastoSemanal[] | null
  /** Por ASIN, los tramos sin ventas en FBA (lib/seo/sin-stock.ts): si la semana tuvo días sin stock, el banner lo dice */
  sinVentas?: Record<string, TramoSinVentas[]> | null
  verBusqueda: (asin: string, consulta: string) => void
}) {
  if (porProducto.length === 0) return null
  const semanas = Math.max(...porProducto.map((p) => p.mov.semanasLeidas))
  if (semanas < 5) {
    return (
      <div className={`${CAJA} px-4 py-3 text-[12.5px] text-[var(--ls-t3)]`}>
        <b className="font-semibold text-[var(--ls-t2)]">Movimientos de la semana:</b> salen con 5 semanas de historial de Brand Analytics (hay {semanas}).
      </div>
    )
  }
  const conAlgo = porProducto.filter((p) => p.mov.suben.length + p.mov.bajan.length + p.mov.salen.length > 0)
  return (
    <section className={`${CAJA} px-4 py-3`} aria-label="Movimientos de la semana">
      <h3 className="text-[13px] font-semibold text-[var(--ls-t1)]">Movimientos de la semana</h3>
      {conAlgo.length === 0 ? (
        <p className="mt-1 text-[12.5px] text-[var(--ls-t3)]">Semana estable: ninguna búsqueda se ha movido más del 40 %.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2.5">
          {conAlgo.map(({ asin, mov }) => {
            const top = [...mov.suben, ...mov.bajan, ...mov.salen].sort((a, b) => b.comprasTotalMedia - a.comprasTotalMedia).slice(0, 3)
            const gasto = gastoSemanal ? semanasDeGasto(gastoSemanal, asin, mov.semana) : null
            const sv = sinVentas?.[asin] && mov.semana ? sinVentasEnPeriodo(sinVentas[asin], mov.semana, new Date(Date.parse(`${mov.semana}T00:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10)) : null
            const sinStock = sv != null && sv.dias >= 3
            return (
              <li key={asin} className="min-w-0">
                {mov.caidaGeneral && (
                  <p className="mb-1.5 flex items-start gap-1.5 rounded-[8px] px-2.5 py-1.5 text-[12.5px]" style={{ color: COLOR_ESTADO.rojo, background: `color-mix(in srgb, ${COLOR_ESTADO.rojo} 10%, transparent)` }}>
                    <TriangleAlert className="mt-[2px] h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span>
                      {sinStock
                        ? `Caen a la vez más de la mitad de sus búsquedas y esa semana se quedó sin stock: ${frasesSinVentas(sv.tramos)} No es SEO.`
                        : 'Caen a la vez más de la mitad de sus búsquedas: probablemente no es SEO, revisa campañas, stock o supresión.'}
                      {gasto && gasto.length > 1 ? ` Gasto PPC: ${gasto.map((g) => entero(g)).join(' → ')}.` : ''}
                    </span>
                  </p>
                )}
                <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[12.5px]">
                  <span className="min-w-0 truncate font-semibold text-[var(--ls-t1)]">{nombreDe(asin)}</span>
                  <span className="tabular-nums text-[var(--ls-t3)]">
                    <span style={{ color: COLOR_ESTADO.verde }}>▲ {mov.suben.length}</span> suben · <span style={{ color: COLOR_ESTADO.rojo }}>▼ {mov.bajan.length}</span> bajan · {mov.salen.length} salen del informe
                  </span>
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {top.map((m) => (
                    <ChipDeMovimiento key={m.consulta} m={m} tipo={mov.suben.includes(m) ? 'sube' : mov.bajan.includes(m) ? 'baja' : 'sale'} onClick={() => verBusqueda(asin, m.consulta)} />
                  ))}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function ChipDeMovimiento({ m, tipo, onClick }: { m: Mov; tipo: 'sube' | 'baja' | 'sale'; onClick: () => void }) {
  const color = tipo === 'sube' ? COLOR_ESTADO.verde : tipo === 'baja' ? COLOR_ESTADO.rojo : COLOR_ESTADO.gris
  const Icono = tipo === 'sube' ? ArrowUpRight : tipo === 'baja' ? ArrowDownRight : LogOut
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Cuota de impresiones: ${m.cuotaAhora == null ? 'fuera del informe' : `${m.cuotaAhora.toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`} frente a una media de ${m.cuotaMedia.toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`}
      className="inline-flex max-w-full items-center gap-1 rounded-full border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-2 py-0.5 text-[12px] hover:bg-[var(--ls-sup2)] [@media(pointer:coarse)]:min-h-[36px]"
    >
      <Icono className="h-3 w-3 shrink-0" style={{ color }} aria-hidden />
      <span className="max-w-[220px] truncate text-[var(--ls-t2)]">{m.consulta}</span>
      <span className="shrink-0 font-semibold tabular-nums" style={{ color }}>
        {pt(m.deltaPt)}
      </span>
    </button>
  )
}

/** El gasto PPC de las 5 semanas que se miran (las 4 anteriores y la de ahora), en orden */
function semanasDeGasto(gasto: GastoSemanal[], asin: string, semana: string | null): number[] | null {
  if (!semana) return null
  const delAsin = gasto.filter((g) => g.asin === asin)
  if (delAsin.length === 0) return null
  // La semana de Brand Analytics empieza en domingo, igual que el gasto semanal
  const desde = new Date(Date.parse(`${semana}T00:00:00Z`) - 28 * 86_400_000).toISOString().slice(0, 10)
  return delAsin.filter((g) => g.desde >= desde && g.desde <= semana).sort((a, b) => a.desde.localeCompare(b.desde)).map((g) => Math.round(g.gasto))
}
