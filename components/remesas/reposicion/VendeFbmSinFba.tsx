'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, Store } from 'lucide-react'
import { Boton } from '@/components/ui-ls/Boton'
import { Tarjeta } from '@/components/ui-ls/Tarjeta'
import type { FbmSinFbaPlan } from '@/lib/fba/plan-tipos'
import { decimal, entero, fechaCorta } from '../formato'

/**
 * «VENDE POR FBM Y NO ESTÁ EN FBA» (24 nov 2026, Raúl). Los ASIN que el cliente vende desde su almacén y que no tienen stock ni movimientos en FBA:
 * candidatos a mandar a Amazon que el plan no ve porque solo planifica lo que ya está en FBA. Sale del informe de pedidos (lib/fba/pedidos.ts) y se
 * guarda con la pasada (`calidad.fbmSinFba`). Para mandar uno hace falta que tenga su listing FBA (SKU FBA en Seller Central).
 */
const VISIBLES = 8

export function VendeFbmSinFba({ lista, leidoHasta, hoy }: { lista: FbmSinFbaPlan[]; leidoHasta: string | null | undefined; hoy: string }) {
  const [todos, setTodos] = useState(false)
  const conVentas = lista.filter((x) => x.ventas90 > 0)
  if (conVentas.length === 0) return null
  const vistas = todos ? conVentas : conVentas.slice(0, VISIBLES)
  return (
    <Tarjeta
      titulo="Vende por FBM y no está en FBA"
      subtitulo={`Lo que el cliente vende desde su almacén sin stock en Amazon: candidatos a mandar${leidoHasta ? ` · pedidos hasta el ${fechaCorta(leidoHasta, hoy)}` : ''}`}
      icono={Store}
      acento="remesas"
    >
      <div className="min-w-0 overflow-x-auto">
        <table className="w-full min-w-[520px] text-[12.5px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--ls-t4)]">
              <th className="py-1 pr-3 font-medium">Producto</th>
              <th className="py-1 pr-3 text-right font-medium">30 días</th>
              <th className="py-1 pr-3 text-right font-medium">90 días</th>
              <th className="py-1 pr-3 text-right font-medium">Ritmo</th>
              <th className="py-1 text-right font-medium">Última venta</th>
            </tr>
          </thead>
          <tbody>
            {vistas.map((x) => (
              <tr key={x.asin ?? x.skus.join('|')} className="border-t border-[var(--ls-linea)]">
                <td className="max-w-[340px] py-[6px] pr-3">
                  <p className="truncate text-[var(--ls-t1)]">{x.nombre ?? x.skus[0]}</p>
                  <p className="truncate font-mono text-[11px] text-[var(--ls-t4)]">{[x.asin, ...x.skus].filter(Boolean).join(' · ')}</p>
                </td>
                <td className="py-[6px] pr-3 text-right tabular-nums text-[var(--ls-t1)]">{entero(x.ventas30)}</td>
                <td className="py-[6px] pr-3 text-right tabular-nums text-[var(--ls-t2)]">{entero(x.ventas90)}</td>
                <td className="py-[6px] pr-3 text-right tabular-nums text-[var(--ls-t2)]">{decimal(x.ventas90 / 90, 2)} ud/día</td>
                <td className="py-[6px] text-right text-[var(--ls-t3)]">{fechaCorta(x.ultimaVenta, hoy)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {conVentas.length > VISIBLES && (
        <div className="mt-2 flex justify-center">
          <Boton tamano="sm" variante="fantasma" icono={todos ? ChevronDown : ChevronRight} onClick={() => setTodos((t) => !t)}>
            {todos ? 'Ver menos' : `Ver los ${entero(conVentas.length)}`}
          </Boton>
        </div>
      )}
      <p className="mt-2 text-[11.5px] text-[var(--ls-t4)]">Para mandar uno, el producto necesita su oferta FBA (un SKU FBA en Seller Central). Las ventas FBM de lo que sí está en FBA ya cuentan en el ritmo del plan.</p>
    </Tarjeta>
  )
}
