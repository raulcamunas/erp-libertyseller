'use client'

import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { TABLA } from '@/lib/estilo/denso'
import type { FilaProducto, ResumenRitmo } from '@/lib/fba/analisis'
import { descargarCsv, EJE, TablaDeDatos, TarjetaGrafico, tooltipDe, VIZ } from '../comun/graficos'
import { Clave, cx, Segmentado, Tarjeta } from '../comun/ui'
import { fecha } from '../formato'
import { ChipRotacion } from './ChipRotacion'

/**
 * ROTACIÓN: A QUÉ RITMO SALE CADA PRODUCTO Y CUÁNDO SE AGOTA.
 *
 * El gráfico enseña los diez que más se han vendido con lo que les queda a cada
 * uno: un producto con mucha venta y poco stock es el que hay que reponer ya. Las
 * barras son finas, con 2 px de superficie entre lo vendido y lo que queda.
 */

export function TabRotacion({ filas, ritmo, nombreArchivo }: { filas: FilaProducto[]; ritmo: ResumenRitmo; nombreArchivo: string }) {
  const [orden, setOrden] = useState<'urgencia' | 'ritmo' | 'vendidas'>('urgencia')

  const ordenadas = useMemo(() => {
    const l = [...filas]
    if (orden === 'ritmo') return l.sort((a, b) => b.udDia7 - a.udDia7 || a.sku.localeCompare(b.sku))
    if (orden === 'vendidas') return l.sort((a, b) => b.vendidas - a.vendidas || a.sku.localeCompare(b.sku))
    // Primero lo que se agota antes; los agotados y los que no se venden, al final
    const cob = (f: FilaProducto) => (f.clase === 'sin_stock' ? 1e9 : (f.cobertura ?? 1e8))
    return l.sort((a, b) => cob(a) - cob(b) || a.sku.localeCompare(b.sku))
  }, [filas, orden])

  const top = useMemo(
    () =>
      [...filas]
        .filter((f) => f.vendidas > 0)
        .sort((a, b) => b.vendidas - a.vendidas)
        .slice(0, 10)
        .map((f) => ({
          etiqueta: f.variante ? `${f.sku.slice(-9)} · ${f.variante}` : f.sku.slice(-14),
          vendidas: f.vendidas,
          quedan: f.quedan,
        })),
    [filas]
  )

  const Contenido = tooltipDe(
    [
      { key: 'vendidas', nombre: 'Vendidas', color: VIZ.vendidas },
      { key: 'quedan', nombre: 'Quedan', color: VIZ.quedan },
    ],
    (l) => String(l)
  )

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 overflow-hidden rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] sm:grid-cols-5">
        <Dato rotulo="Ritmo · 7 días" valor={ritmo.udDia7.toLocaleString('es-ES', { maximumFractionDigits: 1 })} unidad="ud/día" />
        <Dato rotulo="Ritmo · 30 días" valor={ritmo.udDia30.toLocaleString('es-ES', { maximumFractionDigits: 1 })} unidad="ud/día" />
        <Dato rotulo="Desde la llegada" valor={ritmo.udDiaRemesa.toLocaleString('es-ES', { maximumFractionDigits: 1 })} unidad="ud/día" />
        <Dato rotulo="Días con ventas" valor={`${ritmo.diasConVentas}`} unidad={`de ${ritmo.diasTotales}`} />
        <Dato rotulo="Se agota" valor={ritmo.seAgotaEl ? fecha(ritmo.seAgotaEl) : '—'} sub="al ritmo actual" ultima />
      </div>

      {top.length > 0 && (
        <TarjetaGrafico
          titulo="Los 10 que más se han vendido"
          ayuda="Lo vendido y lo que queda de cada uno: mucha venta y poco stock es lo que toca reponer"
          leyenda={
            <>
              <Clave color={VIZ.vendidas}>Vendidas</Clave>
              <Clave color={VIZ.quedan}>Quedan</Clave>
            </>
          }
          grafico={
            <div style={{ height: top.length * 28 + 34 }} className="w-full" role="img" aria-label="Los diez productos más vendidos y lo que queda de cada uno">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={top} layout="vertical" margin={{ top: 2, right: 14, left: 0, bottom: 0 }} barSize={14} barCategoryGap="30%">
                  <CartesianGrid stroke={EJE.rejilla} horizontal={false} />
                  <XAxis type="number" tick={EJE.tick} axisLine={{ stroke: EJE.linea }} tickLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="etiqueta" width={118} tick={EJE.tick} axisLine={false} tickLine={false} />
                  <Tooltip content={<Contenido />} cursor={{ fill: 'var(--ls-sup3)', opacity: 0.7 }} isAnimationActive={false} />
                  <Bar dataKey="vendidas" stackId="a" fill={VIZ.vendidas} stroke="var(--ls-sup)" strokeWidth={2} isAnimationActive={false} />
                  <Bar dataKey="quedan" stackId="a" fill={VIZ.quedan} stroke="var(--ls-sup)" strokeWidth={2} radius={[0, 4, 4, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          }
          tabla={
            <TablaDeDatos
              columnas={[
                { clave: 'etiqueta', titulo: 'Producto' },
                { clave: 'vendidas', titulo: 'Vendidas', numero: true },
                { clave: 'quedan', titulo: 'Quedan', numero: true },
              ]}
              filas={top}
            />
          }
        />
      )}

      <Tarjeta
        titulo="Rotación por producto"
        derecha={
          <>
            <Segmentado
              valor={orden}
              onCambio={setOrden}
              etiqueta="Ordenar por"
              opciones={[
                { id: 'urgencia', texto: 'Urgencia', titulo: 'Los que se agotan antes, primero' },
                { id: 'ritmo', texto: 'Ritmo' },
                { id: 'vendidas', texto: 'Vendidas' },
              ]}
            />
            <button
              type="button"
              className="inline-flex h-6 items-center rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-[9px] text-[11.5px] text-[var(--ls-t2)] hover:bg-[var(--ls-sup3)]"
              onClick={() =>
                descargarCsv(`rotacion-${nombreArchivo}.csv`, ['SKU', 'Producto', 'Vendidas', 'Ud/día 7 d', 'Ud/día total', 'Quedan', 'Días de stock', 'Se agota', 'Rotación'], ordenadas.map((f) => [f.sku, f.nombre, f.vendidas, f.udDia7, f.udDiaRemesa, f.quedan, f.cobertura, f.seAgotaEl, f.clase]))
              }
            >
              CSV
            </button>
          </>
        }
        cuerpo={false}
      >
        <div className="max-h-[420px] overflow-auto">
          <table className={TABLA.tabla}>
            <thead>
              <tr>
                <th className={cx(TABLA.cabecera, TABLA.cabeceraFija, 'min-w-[230px]')}>Producto</th>
                <th className={cx(TABLA.cabecera, TABLA.derecha)}>Vendidas</th>
                <th className={cx(TABLA.cabecera, TABLA.derecha)}>Ud/día · 7 d</th>
                <th className={cx(TABLA.cabecera, TABLA.derecha, 'hidden 2xl:table-cell')}>Ud/día · total</th>
                <th className={cx(TABLA.cabecera, TABLA.derecha)}>Quedan</th>
                <th className={cx(TABLA.cabecera, TABLA.derecha)}>Días de stock</th>
                <th className={TABLA.cabecera}>Se agota</th>
                <th className={TABLA.cabecera}>Rotación</th>
              </tr>
            </thead>
            <tbody>
              {ordenadas.map((f) => (
                <tr key={f.sku} className={TABLA.fila}>
                  <td className={cx(TABLA.celda, TABLA.celdaFija, 'max-w-[270px]')}>
                    <div className="flex items-baseline gap-2 overflow-hidden">
                      <span className="shrink-0 font-mono text-[11.5px] text-[var(--ls-t3)]">{f.sku}</span>
                      <span className="truncate text-[var(--ls-t1)]" title={f.nombre ?? ''}>
                        {f.nombre ?? '—'}
                      </span>
                      {f.variante && <span className="shrink-0 text-[var(--ls-t4)]">{f.variante}</span>}
                    </div>
                  </td>
                  <td className={cx(TABLA.celda, TABLA.numero)}>{f.vendidas}</td>
                  <td className={cx(TABLA.celda, TABLA.numero)}>{f.udDia7.toLocaleString('es-ES', { maximumFractionDigits: 2 })}</td>
                  <td className={cx(TABLA.celda, TABLA.numero, 'hidden text-[var(--ls-t3)] 2xl:table-cell')}>{f.udDiaRemesa.toLocaleString('es-ES', { maximumFractionDigits: 2 })}</td>
                  <td className={cx(TABLA.celda, TABLA.numero, 'font-semibold text-[var(--ls-t1)]')}>{f.quedan}</td>
                  <td className={cx(TABLA.celda, TABLA.numero)}>{f.cobertura === null ? '—' : Math.round(f.cobertura)}</td>
                  <td className={cx(TABLA.celda, 'text-[var(--ls-t3)]')}>{f.quedan === 0 ? 'agotado' : f.seAgotaEl ? fecha(f.seAgotaEl) : '—'}</td>
                  <td className={TABLA.celda}>
                    <ChipRotacion clase={f.clase} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Tarjeta>
      <p className="px-1 text-[11px] leading-[1.5] text-[var(--ls-t4)]">
        Los días de stock salen de lo que queda de este envío entre lo vendido por día en la última semana. Rápida: menos de 14 días.
        Media: hasta 45. Lenta: más. Sin ventas: nada en 30 días.
      </p>
    </div>
  )
}

function Dato({ rotulo, valor, unidad, sub, ultima }: { rotulo: string; valor: string; unidad?: string; sub?: string; ultima?: boolean }) {
  return (
    <div className={cx('min-w-0 border-b border-r border-[var(--ls-linea)] px-3 py-[9px] sm:border-b-0', ultima && 'sm:border-r-0')}>
      <div className="text-[11px] font-semibold text-[var(--ls-t4)]">{rotulo}</div>
      <div className="mt-[3px] flex items-baseline gap-[4px]">
        <span className="text-[19px] font-semibold leading-[1.1] tracking-[-0.02em] text-[var(--ls-t1)]">{valor}</span>
        {unidad && <span className="text-[11.5px] text-[var(--ls-t3)]">{unidad}</span>}
      </div>
      {sub && <div className="mt-[1px] text-[11px] text-[var(--ls-t3)]">{sub}</div>}
    </div>
  )
}
