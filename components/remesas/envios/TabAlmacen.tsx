'use client'

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { BOTON, CAMPO, TABLA, TEXTO } from '@/lib/estilo/denso'
import type { FilaProducto } from '@/lib/fba/analisis'
import { descargarCsv } from '../comun/graficos'
import { cx, Tarjeta } from '../comun/ui'
import { ChipRotacion } from './ChipRotacion'

/**
 * ALMACÉN: LO QUE HAY AHORA DE ESTE ENVÍO, PRODUCTO A PRODUCTO.
 *
 * «Quedan» es lo recibido menos lo vendido de ESTE envío. «En Amazon» es el stock
 * real de ese SKU sumando todos sus envíos, y la diferencia es el descuadre: si
 * no coincide, el número bueno es el de Amazon.
 */

type Filtro = 'con_stock' | 'agotadas' | 'descuadre' | 'todas'

export function TabAlmacen({ filas, nombreArchivo }: { filas: FilaProducto[]; nombreArchivo: string }) {
  const [filtro, setFiltro] = useState<Filtro>('con_stock')
  const [busca, setBusca] = useState('')

  const cuenta = useMemo(
    () => ({
      con_stock: filas.filter((f) => f.quedan > 0).length,
      agotadas: filas.filter((f) => f.quedan === 0).length,
      descuadre: filas.filter((f) => f.descuadre !== null && f.descuadre !== 0).length,
      todas: filas.length,
    }),
    [filas]
  )

  const visibles = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return filas
      .filter((f) => (filtro === 'con_stock' ? f.quedan > 0 : filtro === 'agotadas' ? f.quedan === 0 : filtro === 'descuadre' ? f.descuadre !== null && f.descuadre !== 0 : true))
      .filter((f) => !t || f.sku.toLowerCase().includes(t) || (f.nombre ?? '').toLowerCase().includes(t))
      .sort((a, b) => b.quedan - a.quedan || a.sku.localeCompare(b.sku))
  }, [filas, filtro, busca])

  const maxQuedan = Math.max(1, ...filas.map((f) => f.quedan))

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-[6px]">
        {(
          [
            ['con_stock', 'Con stock'],
            ['agotadas', 'Agotadas'],
            ['descuadre', 'Con descuadre'],
            ['todas', 'Todas'],
          ] as Array<[Filtro, string]>
        ).map(([k, t]) => (
          <button key={k} type="button" onClick={() => setFiltro(k)} className={cx(BOTON.chip, filtro === k && BOTON.chipEncendido)}>
            {t}
            <span className="tabular-nums text-[var(--ls-t4)]">{cuenta[k]}</span>
          </button>
        ))}
        <label className="relative ml-auto block w-[210px]">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--ls-t4)]" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="SKU o nombre" className={cx(CAMPO.input, 'pl-[26px]')} />
        </label>
        <button
          type="button"
          className={cx(BOTON.base, BOTON.alto, BOTON.secundario)}
          disabled={visibles.length === 0}
          onClick={() =>
            descargarCsv(`almacen-${nombreArchivo}.csv`, ['SKU', 'Producto', 'Variante', 'Recibidas', 'Vendidas', 'Quedan', 'En Amazon', 'Descuadre'], visibles.map((f) => [f.sku, f.nombre, f.variante, f.recibidas ?? f.enviadas, f.vendidas, f.quedan, f.stockReal, f.descuadre]))
          }
        >
          CSV
        </button>
      </div>

      <Tarjeta cuerpo={false}>
        <div className="max-h-[calc(100vh-300px)] min-h-[260px] overflow-auto">
          <table className={TABLA.tabla}>
            <thead>
              <tr>
                <th className={cx(TABLA.cabecera, TABLA.cabeceraFija, 'min-w-[230px]')}>Producto</th>
                <th className={cx(TABLA.cabecera, TABLA.derecha)}>Recibidas</th>
                <th className={cx(TABLA.cabecera, TABLA.derecha)}>Vendidas</th>
                <th className={cx(TABLA.cabecera, TABLA.derecha)}>Quedan</th>
                <th className={cx(TABLA.cabecera, 'w-[80px]')} />
                <th className={cx(TABLA.cabecera, TABLA.derecha)} title="Lo que Amazon dice que hay AHORA de este SKU, sumando todos sus envíos">
                  En Amazon
                </th>
                <th className={cx(TABLA.cabecera, TABLA.derecha)} title="Stock real de Amazon menos lo que explican las remesas. Positivo: hay más de lo que las remesas explican">
                  Descuadre
                </th>
                <th className={TABLA.cabecera}>Rotación</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((f) => (
                <tr key={f.sku} className={cx(TABLA.fila, f.quedan === 0 && 'opacity-60')}>
                  <td className={cx(TABLA.celda, TABLA.celdaFija, 'max-w-[270px]')}>
                    <div className="flex items-baseline gap-2 overflow-hidden">
                      <span className="shrink-0 font-mono text-[11.5px] text-[var(--ls-t3)]">{f.sku}</span>
                      <span className="truncate text-[var(--ls-t1)]" title={f.nombre ?? ''}>
                        {f.nombre ?? '—'}
                      </span>
                      {f.variante && <span className="shrink-0 text-[var(--ls-t4)]">{f.variante}</span>}
                    </div>
                  </td>
                  <td className={cx(TABLA.celda, TABLA.numero)}>{f.recibidas ?? f.enviadas}</td>
                  <td className={cx(TABLA.celda, TABLA.numero)}>{f.vendidas}</td>
                  <td className={cx(TABLA.celda, TABLA.numero, 'font-semibold', TEXTO.t1)}>{f.quedan}</td>
                  <td className={TABLA.celda}>
                    <div className="h-[6px] w-[64px] overflow-hidden rounded-[3px] bg-[var(--ls-sup3)]">
                      <div className="h-full rounded-[3px]" style={{ width: `${(f.quedan / maxQuedan) * 100}%`, background: 'var(--viz-2)' }} />
                    </div>
                  </td>
                  <td className={cx(TABLA.celda, TABLA.numero)}>{f.stockReal ?? '—'}</td>
                  <td className={cx(TABLA.celda, TABLA.numero, f.descuadre ? 'font-semibold text-[var(--ls-e-ambar)]' : 'text-[var(--ls-t4)]')}>
                    {f.descuadre === null ? '—' : f.descuadre > 0 ? `+${f.descuadre}` : f.descuadre}
                  </td>
                  <td className={TABLA.celda}>
                    <ChipRotacion clase={f.clase} />
                  </td>
                </tr>
              ))}
              {visibles.length === 0 && (
                <tr>
                  <td colSpan={8} className={cx(TABLA.celda, 'h-16 text-center text-[var(--ls-t4)]')}>
                    Nada que enseñar con este filtro.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Tarjeta>
      <p className="px-1 text-[11px] leading-[1.5] text-[var(--ls-t4)]">
        El stock real de Amazon se refresca una vez al día. El reparto entre envíos del mismo producto es una convención contable: Amazon
        mezcla los lotes físicamente.
      </p>
    </div>
  )
}
