'use client'

import { useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import type { RemesaDePanel } from '@/lib/fba/datos'
import { fecha as formatoFecha } from './formato'

/**
 * LO QUE SE VA VENDIENDO DE UNA REMESA, DÍA A DÍA.
 *
 * Sale del reparto FIFO (lib/fba/fifo.ts): de cada venta del libro mayor, la parte
 * que cae en ESTA remesa y no en otra. Cuenta desde que la mercancía llega al
 * almacén —la llegada confirmada por Amazon, o la fecha de envío mientras no se
 * sepa— y las devoluciones restan del día en que vuelven.
 *
 * Los días sin ventas se pintan con cero: un hueco en una serie de ventas es
 * información, no un fallo.
 */

const DIA = 86_400_000
const MAX_DIAS = 60

const aDia = (iso: string) => Date.parse(`${iso}T00:00:00Z`)
const dehace = (d: number) => new Date(d).toISOString().slice(0, 10)

export function VentasPorDia({ remesa }: { remesa: RemesaDePanel }) {
  const [verTodo, setVerTodo] = useState(false)

  const serie = useMemo(() => {
    const porFecha = new Map(remesa.ventasPorDia.map((v) => [v.fecha, v.vendidas]))
    const desde = aDia(remesa.cuentaDesde)
    const hoy = aDia(new Date().toISOString().slice(0, 10))
    const dias = Math.max(0, Math.round((hoy - desde) / DIA))

    // La base es lo que el reparto repartió: lo que quedaba más lo que se ha consumido
    const consumidas = remesa.lineas.reduce((s, l) => s + l.consumidas, 0)
    const base = remesa.quedan + consumidas

    const filas: Array<{ fecha: string; vendidas: number; acumuladas: number; quedan: number }> = []
    let acum = 0
    for (let i = 0; i <= dias; i += 1) {
      const f = dehace(desde + i * DIA)
      const v = porFecha.get(f) ?? 0
      acum += v
      filas.push({ fecha: f, vendidas: v, acumuladas: acum, quedan: Math.max(0, base - acum) })
    }
    return { filas, base }
  }, [remesa])

  const total = serie.filas.length > 0 ? serie.filas[serie.filas.length - 1].acumuladas : 0
  const visibles = verTodo ? serie.filas : serie.filas.slice(-MAX_DIAS)
  const maximo = Math.max(1, ...visibles.map((f) => f.vendidas))
  const diasConVentas = serie.filas.filter((f) => f.vendidas > 0).length
  const media = serie.filas.length > 0 ? total / serie.filas.length : 0

  if (remesa.ventasPorDia.length === 0) {
    return (
      <div className="glass-card px-3 py-2.5">
        <p className="text-[11px] font-medium text-white/60">Ventas por día</p>
        <p className="mt-1 text-[11px] text-white/35">
          Todavía no hay ventas contadas de esta remesa desde el {formatoFecha(remesa.cuentaDesde)}. Cuando Amazon
          registre ventas de estos productos, aparecerán aquí.
        </p>
      </div>
    )
  }

  function descargar() {
    const celda = (v: string | number) => {
      const t = String(v)
      return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
    }
    const lineas = ['Fecha;SKU;Vendidas'].concat(
      remesa.lineas
        .flatMap((l) => Object.entries(l.porDia).map(([f, n]) => [f, l.sku, n] as const))
        .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]))
        .map((x) => x.map(celda).join(';'))
    )
    const blob = new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ventas-por-dia-${remesa.referenciaEnvio ?? remesa.id.slice(0, 8)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="glass-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] px-3 py-2">
        <p className="text-[11px] font-medium text-white/60">
          Ventas por día
          <span className="ml-2 font-normal text-white/35">
            {total} vendidas en {serie.filas.length} días · {media.toLocaleString('es-ES', { maximumFractionDigits: 1 })} al
            día · {diasConVentas} días con ventas
          </span>
        </p>
        <div className="flex items-center gap-2 text-[10px] text-white/40">
          {serie.filas.length > MAX_DIAS && (
            <button type="button" onClick={() => setVerTodo((v) => !v)} className="hover:text-white/70">
              {verTodo ? `Solo los últimos ${MAX_DIAS} días` : `Ver los ${serie.filas.length} días`}
            </button>
          )}
          <button type="button" onClick={descargar} className="flex items-center gap-1 hover:text-white/70">
            <Download className="h-3 w-3" />
            CSV por SKU
          </button>
        </div>
      </div>

      {/* Las barras: una por día, la altura es lo vendido */}
      <div className="flex h-16 items-end gap-[2px] px-3 pt-2">
        {visibles.map((f) => (
          <div
            key={f.fecha}
            className="flex-1 rounded-t-sm bg-[#FF6600]/70"
            style={{ height: `${Math.max(f.vendidas > 0 ? 6 : 1, (f.vendidas / maximo) * 100)}%`, opacity: f.vendidas > 0 ? 1 : 0.2 }}
            title={`${formatoFecha(f.fecha)}: ${f.vendidas} vendidas`}
          />
        ))}
      </div>

      <div className="max-h-52 overflow-auto px-1 pb-1 pt-2">
        <table className="w-full">
          <thead className="sticky top-0 bg-[#0d0d0d]">
            <tr>
              {['Día', 'Vendidas', 'Acumuladas', 'Quedan'].map((h, i) => (
                <th
                  key={h}
                  className={`border-b border-white/[0.08] px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-white/35 ${i === 0 ? 'text-left' : 'text-right'}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...visibles].reverse().map((f) => (
              <tr key={f.fecha} className="border-b border-white/[0.04] last:border-0">
                <td className="px-2 py-1 text-[11px] text-white/60">{formatoFecha(f.fecha)}</td>
                <td className={`px-2 py-1 text-right text-[12px] ${f.vendidas > 0 ? 'font-semibold text-white' : 'text-white/25'}`}>
                  {f.vendidas}
                </td>
                <td className="px-2 py-1 text-right text-[11px] text-white/45">{f.acumuladas}</td>
                <td className="px-2 py-1 text-right text-[11px] text-white/45">{f.quedan}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
