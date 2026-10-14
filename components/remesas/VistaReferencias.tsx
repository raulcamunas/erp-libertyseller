'use client'

import { useMemo, useState } from 'react'
import { Search, TrendingDown } from 'lucide-react'
import { BOTON, CAMPO, COLOR_ESTADO, TABLA } from '@/lib/estilo/denso'
import type { SkuDePanel } from '@/lib/fba/datos'
import { descargarCsv } from './comun/graficos'
import { cx, Tarjeta, Vacio } from './comun/ui'
import { fecha } from './formato'

/**
 * POR REFERENCIA: LA QUE DICE CUÁNDO HAY QUE REPONER.
 *
 * Cada fila junta todos los envíos reales de ese SKU, así que «quedan» aquí es el
 * total vivo. Por defecto sale ordenada por lo que se agota antes; los filtros
 * sacan lo urgente, lo que no se mueve y lo que no cuadra con Amazon.
 */

type Filtro = 'todas' | 'urgentes' | 'sin_ventas' | 'descuadre'

function tonoDe(dias: number | null): string {
  if (dias === null) return 'var(--ls-t4)'
  if (dias <= 14) return COLOR_ESTADO.rojo
  if (dias <= 30) return COLOR_ESTADO.ambar
  return COLOR_ESTADO.verde
}

export function VistaReferencias({ skus }: { skus: SkuDePanel[] }) {
  const [filtro, setFiltro] = useState<Filtro>('todas')
  const [busca, setBusca] = useState('')

  const cuentas = useMemo(
    () => ({
      todas: skus.length,
      urgentes: skus.filter((s) => s.quedan > 0 && s.diasDeCobertura !== null && s.diasDeCobertura <= 14).length,
      sin_ventas: skus.filter((s) => s.quedan > 0 && s.diasDeCobertura === null).length,
      descuadre: skus.filter((s) => s.descuadre !== null && s.descuadre !== 0).length,
    }),
    [skus]
  )

  const visibles = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return skus
      .filter((s) => {
        if (filtro === 'urgentes') return s.quedan > 0 && s.diasDeCobertura !== null && s.diasDeCobertura <= 14
        if (filtro === 'sin_ventas') return s.quedan > 0 && s.diasDeCobertura === null
        if (filtro === 'descuadre') return s.descuadre !== null && s.descuadre !== 0
        return true
      })
      .filter((s) => !q || s.sku.toLowerCase().includes(q) || (s.nombre ?? '').toLowerCase().includes(q) || (s.asin ?? '').toLowerCase().includes(q))
  }, [skus, filtro, busca])

  if (skus.length === 0) {
    return (
      <div className="rounded-[8px] border border-dashed border-[var(--ls-linea2)]">
        <Vacio icono={<TrendingDown />} titulo="Sin referencias todavía">
          Aquí se juntan todos los envíos reales de cada producto para decir cuándo hay que reponer. Sale en cuanto haya un envío enlazado con Amazon.
        </Vacio>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex shrink-0 flex-wrap items-center gap-[6px]">
        {(
          [
            ['todas', 'Todas'],
            ['urgentes', 'Urgentes (≤ 14 días)'],
            ['sin_ventas', 'Sin ventas'],
            ['descuadre', 'Con descuadre'],
          ] as Array<[Filtro, string]>
        ).map(([k, t]) => (
          <button key={k} type="button" onClick={() => setFiltro(k)} className={cx(BOTON.chip, filtro === k && BOTON.chipEncendido)}>
            {k === 'urgentes' && cuentas.urgentes > 0 && <span className="h-[7px] w-[7px] rounded-full" style={{ background: COLOR_ESTADO.rojo }} />}
            {t}
            <span className="tabular-nums text-[var(--ls-t4)]">{cuentas[k]}</span>
          </button>
        ))}
        <label className="relative ml-auto block w-[240px]">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--ls-t4)]" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="SKU, ASIN o nombre" className={cx(CAMPO.input, 'pl-[26px]')} />
        </label>
        <button
          type="button"
          disabled={visibles.length === 0}
          className={cx(BOTON.base, BOTON.alto, BOTON.secundario)}
          onClick={() =>
            descargarCsv('referencias.csv', ['SKU', 'Producto', 'ASIN', 'Enviadas', 'Quedan', 'Vendibles', 'Ud/día', 'Días de stock', 'Se agota', 'En Amazon', 'Descuadre', 'Sin envío'], visibles.map((s) => [s.sku, s.nombre, s.asin, s.enviadas, s.quedan, s.quedanVendibles, s.velocidad, s.diasDeCobertura, s.seAgotaEl, s.stockReal, s.descuadre, s.sinAtribuir]))
          }
        >
          CSV
        </button>
      </div>

      <Tarjeta cuerpo={false} className="min-h-0 flex-1 overflow-hidden">
        <div className="h-full overflow-auto">
          <table className={TABLA.tabla}>
            <thead>
              <tr>
                <th className={cx(TABLA.cabecera, TABLA.cabeceraFija, 'min-w-[300px]')}>Producto</th>
                <th className={TABLA.cabecera}>ASIN</th>
                <th className={cx(TABLA.cabecera, TABLA.derecha)}>Enviadas</th>
                <th className={cx(TABLA.cabecera, TABLA.derecha)}>Quedan</th>
                <th className={cx(TABLA.cabecera, TABLA.derecha)} title="Lo que queda sin contar lo que volvió inservible">
                  Vendibles
                </th>
                <th className={cx(TABLA.cabecera, TABLA.derecha)}>Ud/día</th>
                <th className={cx(TABLA.cabecera, TABLA.derecha)}>Stock para</th>
                <th className={TABLA.cabecera}>Se agota</th>
                <th className={cx(TABLA.cabecera, TABLA.derecha)}>En Amazon</th>
                <th className={cx(TABLA.cabecera, TABLA.derecha)} title="Lo que Amazon tiene menos lo que explican los envíos">
                  Descuadre
                </th>
                <th className={cx(TABLA.cabecera, TABLA.derecha)} title="Ventas que ningún envío registrado podía absorber: stock de antes">
                  Sin envío
                </th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((s) => (
                <tr key={s.sku} className={cx(TABLA.fila, s.quedan === 0 && 'opacity-60')}>
                  <td className={cx(TABLA.celda, TABLA.celdaFija, 'max-w-[360px]')}>
                    <div className="flex items-baseline gap-2 overflow-hidden">
                      <span className="shrink-0 font-mono text-[11.5px] text-[var(--ls-t3)]">{s.sku}</span>
                      <span className="truncate text-[var(--ls-t1)]" title={s.nombre ?? ''}>
                        {s.nombre ?? '—'}
                      </span>
                    </div>
                  </td>
                  <td className={cx(TABLA.celda, 'font-mono text-[11px] text-[var(--ls-t4)]')}>{s.asin ?? '—'}</td>
                  <td className={cx(TABLA.celda, TABLA.numero, 'text-[var(--ls-t3)]')}>{s.enviadas}</td>
                  <td className={cx(TABLA.celda, TABLA.numero, 'font-semibold text-[var(--ls-t1)]')}>{s.quedan}</td>
                  <td className={cx(TABLA.celda, TABLA.numero)} style={s.quedanVendibles !== s.quedan ? { color: COLOR_ESTADO.ambar } : undefined}>
                    {s.quedanVendibles}
                  </td>
                  <td className={cx(TABLA.celda, TABLA.numero, 'text-[var(--ls-t3)]')}>{s.velocidad || '—'}</td>
                  <td className={cx(TABLA.celda, TABLA.numero)}>
                    <span className="inline-flex items-center justify-end gap-[6px]">
                      {s.quedan > 0 && <span className="h-[7px] w-[7px] rounded-full" style={{ background: tonoDe(s.diasDeCobertura) }} aria-hidden />}
                      {s.quedan === 0 ? 'agotada' : s.diasDeCobertura === null ? 'sin ventas' : `${s.diasDeCobertura} d`}
                    </span>
                  </td>
                  <td className={cx(TABLA.celda, 'text-[var(--ls-t3)]')}>{s.quedan === 0 ? '—' : fecha(s.seAgotaEl)}</td>
                  <td className={cx(TABLA.celda, TABLA.numero, 'text-[var(--ls-t3)]')}>{s.stockReal ?? '—'}</td>
                  <td className={cx(TABLA.celda, TABLA.numero, s.descuadre ? 'font-semibold' : 'text-[var(--ls-t4)]')} style={s.descuadre ? { color: COLOR_ESTADO.ambar } : undefined}>
                    {s.descuadre === null ? '—' : s.descuadre > 0 ? `+${s.descuadre}` : s.descuadre}
                  </td>
                  <td className={cx(TABLA.celda, TABLA.numero, s.sinAtribuir > 0 ? 'text-[var(--ls-t2)]' : 'text-[var(--ls-t4)]')}>{s.sinAtribuir || '—'}</td>
                </tr>
              ))}
              {visibles.length === 0 && (
                <tr>
                  <td colSpan={11} className={cx(TABLA.celda, 'h-16 text-center text-[var(--ls-t4)]')}>
                    Nada con este filtro.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Tarjeta>
    </div>
  )
}
