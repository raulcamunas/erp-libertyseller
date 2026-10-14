'use client'

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { BOTON, CAMPO, COLOR_ESTADO, TABLA } from '@/lib/estilo/denso'
import type { FilaProducto } from '@/lib/fba/analisis'
import { descargarCsv } from '../comun/graficos'
import { cx, Segmentado, Tarjeta } from '../comun/ui'
import { fecha } from '../formato'
import { ChipRotacion } from './ChipRotacion'

/**
 * REFERENCIAS: TODAS LAS LÍNEAS DEL ENVÍO CON TODAS SUS COLUMNAS.
 *
 * Es la tabla de siempre, la que sirve para cuadrar con el Excel o con Amazon:
 * enviadas, recibidas, vendidas, devueltas y lo que queda de cada referencia. El
 * resto de pestañas la miran desde un ángulo; esta es el dato crudo.
 */

type Orden = 'urgencia' | 'quedan' | 'vendidas' | 'sku'

export function TablaReferencias({ filas, conectado, nombreArchivo }: { filas: FilaProducto[]; conectado: boolean; nombreArchivo: string }) {
  const [orden, setOrden] = useState<Orden>('urgencia')
  const [busca, setBusca] = useState('')

  const visibles = useMemo(() => {
    const t = busca.trim().toLowerCase()
    const l = filas.filter((f) => !t || f.sku.toLowerCase().includes(t) || (f.nombre ?? '').toLowerCase().includes(t) || (f.asin ?? '').toLowerCase().includes(t))
    switch (orden) {
      case 'quedan':
        return l.sort((a, b) => b.quedan - a.quedan || a.sku.localeCompare(b.sku))
      case 'vendidas':
        return l.sort((a, b) => b.vendidas - a.vendidas || a.sku.localeCompare(b.sku))
      case 'sku':
        return l.sort((a, b) => a.sku.localeCompare(b.sku))
      default: {
        const cob = (f: FilaProducto) => (f.clase === 'sin_stock' ? 1e9 : (f.cobertura ?? 1e8))
        return l.sort((a, b) => cob(a) - cob(b) || a.sku.localeCompare(b.sku))
      }
    }
  }, [filas, orden, busca])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11.5px] text-[var(--ls-t4)]">Ordenar por</span>
        <Segmentado
          valor={orden}
          onCambio={setOrden}
          etiqueta="Ordenar"
          opciones={[
            { id: 'urgencia', texto: 'Urgencia', titulo: 'Los que se agotan antes, primero' },
            { id: 'quedan', texto: 'Quedan' },
            { id: 'vendidas', texto: 'Vendidas' },
            { id: 'sku', texto: 'SKU' },
          ]}
        />
        <label className="relative ml-auto block w-[220px]">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--ls-t4)]" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="SKU, ASIN o nombre" className={cx(CAMPO.input, 'pl-[26px]')} />
        </label>
        <button
          type="button"
          className={cx(BOTON.base, BOTON.alto, BOTON.secundario)}
          disabled={visibles.length === 0}
          onClick={() =>
            descargarCsv(`referencias-${nombreArchivo}.csv`, ['SKU', 'Producto', 'Variante', 'ASIN', 'Enviadas', 'Recibidas', 'Vendidas', 'Devueltas', 'Quedan', 'Ud/día 7 d', 'Días de stock', 'Se agota'], visibles.map((f) => [f.sku, f.nombre, f.variante, f.asin, f.enviadas, f.recibidas, f.vendidas, f.devueltas, f.quedan, f.udDia7, f.cobertura, f.seAgotaEl]))
          }
        >
          CSV
        </button>
      </div>

      <Tarjeta cuerpo={false}>
        <div className="max-h-[calc(100vh-290px)] min-h-[280px] overflow-auto">
          <table className={TABLA.tabla}>
            <thead>
              <tr>
                <th className={cx(TABLA.cabecera, TABLA.cabeceraFija, 'min-w-[240px]')}>Producto</th>
                <th className={cx(TABLA.cabecera, 'hidden 2xl:table-cell')}>ASIN</th>
                <th className={cx(TABLA.cabecera, TABLA.derecha)}>Env.</th>
                <th className={cx(TABLA.cabecera, TABLA.derecha)} title="Lo que Amazon dice que ha recibido de las que mandamos">
                  Recib.
                </th>
                <th className={cx(TABLA.cabecera, TABLA.derecha)}>Vend.</th>
                <th className={cx(TABLA.cabecera, TABLA.derecha)}>Dev.</th>
                <th className={cx(TABLA.cabecera, TABLA.derecha)}>Quedan</th>
                {conectado && (
                  <>
                    <th className={cx(TABLA.cabecera, TABLA.derecha)} title="Unidades por día en la última semana">
                      Ud/día
                    </th>
                    <th className={cx(TABLA.cabecera, TABLA.derecha)} title="Días hasta agotar lo que queda de esta línea">
                      Stock para
                    </th>
                  </>
                )}
                <th className={TABLA.cabecera}>Rotación</th>
                <th className={cx(TABLA.cabecera, 'hidden 2xl:table-cell')}>Agotada</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((f) => {
                const faltan = f.recibidas !== null && f.recibidas < f.enviadas
                return (
                  <tr key={f.sku} className={cx(TABLA.fila, f.quedan === 0 && 'opacity-60')}>
                    <td className={cx(TABLA.celda, TABLA.celdaFija, 'max-w-[300px]')}>
                      <div className="flex items-baseline gap-2 overflow-hidden">
                        <span className="shrink-0 font-mono text-[11.5px] text-[var(--ls-t3)]">{f.sku}</span>
                        <span className="truncate text-[var(--ls-t1)]" title={f.nombre ?? ''}>
                          {f.nombre ?? '—'}
                        </span>
                        {f.variante && <span className="shrink-0 text-[var(--ls-t4)]">{f.variante}</span>}
                      </div>
                    </td>
                    <td className={cx(TABLA.celda, 'hidden font-mono text-[11px] text-[var(--ls-t4)] 2xl:table-cell')}>{f.asin ?? '—'}</td>
                    <td className={cx(TABLA.celda, TABLA.numero, 'text-[var(--ls-t3)]')}>{f.enviadas}</td>
                    <td
                      className={cx(TABLA.celda, TABLA.numero, faltan && 'font-semibold')}
                      style={faltan ? { color: COLOR_ESTADO.ambar } : undefined}
                      title={f.recibidas === null ? 'Todavía sin preguntar a Amazon' : faltan ? `Faltan ${f.enviadas - (f.recibidas ?? 0)} unidades por registrar` : undefined}
                    >
                      {f.recibidas ?? '—'}
                    </td>
                    <td className={cx(TABLA.celda, TABLA.numero)}>{f.vendidas}</td>
                    <td className={cx(TABLA.celda, TABLA.numero, f.devueltas > 0 ? 'text-[var(--ls-e-ambar)]' : 'text-[var(--ls-t4)]')}>{f.devueltas || '—'}</td>
                    <td className={cx(TABLA.celda, TABLA.numero, 'font-semibold text-[var(--ls-t1)]')}>{f.quedan}</td>
                    {conectado && (
                      <>
                        <td className={cx(TABLA.celda, TABLA.numero, 'text-[var(--ls-t3)]')}>{f.udDia7 > 0 ? f.udDia7.toLocaleString('es-ES', { maximumFractionDigits: 2 }) : '—'}</td>
                        <td className={cx(TABLA.celda, TABLA.numero)}>{f.cobertura === null ? '—' : `${Math.round(f.cobertura)} d`}</td>
                      </>
                    )}
                    <td className={TABLA.celda}>
                      <ChipRotacion clase={f.clase} />
                    </td>
                    <td className={cx(TABLA.celda, 'hidden text-[var(--ls-t4)] 2xl:table-cell')}>{fecha(f.agotadaEl)}</td>
                  </tr>
                )
              })}
              {visibles.length === 0 && (
                <tr>
                  <td colSpan={conectado ? 11 : 9} className={cx(TABLA.celda, 'h-16 text-center text-[var(--ls-t4)]')}>
                    Nada que coincida con la búsqueda.
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
