'use client'

import { Check, X } from 'lucide-react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import type { ConsultaAnterior, ConsultaGuardada, FichaGuardada, ProductoSeguido, PuntoDeEvolucion } from '@/lib/seo/datos'
import type { DatosSeo } from './useCuentaSeo'

/** Las búsquedas de un producto en el periodo pedido (o, si no hay del mes, las de la semana) */
export function consultasDe(datos: DatosSeo, asin: string, periodo: 'MONTH' | 'WEEK'): ConsultaGuardada[] {
  return datos.consultas[periodo].filter((c) => c.asin === asin)
}

export function fichaDe(datos: DatosSeo, asin: string): FichaGuardada | null {
  return datos.fichas.find((f) => f.asin === asin) ?? null
}

export const nombreDe = (p: ProductoSeguido, ficha: FichaGuardada | null) => p.nombre || ficha?.titulo || p.asin

/** El selector de producto de las pestañas Búsquedas y Ficha */
export function SelectorDeProducto({ productos, datos, asin, setAsin }: { productos: ProductoSeguido[]; datos: DatosSeo; asin: string | null; setAsin: (a: string) => void }) {
  return (
    <label className="inline-flex min-w-0 items-center gap-2">
      <span className="text-[12px] text-[var(--ls-t4)]">Producto</span>
      <select value={asin ?? ''} onChange={(e) => setAsin(e.target.value)} className="h-[30px] max-w-[420px] rounded-[9px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2 text-[12.5px] text-[var(--ls-t1)] outline-none focus:border-[var(--ls-acc-graf)]">
        {productos.map((p) => (
          <option key={p.id} value={p.asin}>
            {nombreDe(p, fichaDe(datos, p.asin)).slice(0, 70)} · {p.asin}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Una marca de «está» / «no está» para la cobertura en la ficha */
export function Marca({ si, texto }: { si: boolean; texto: string }) {
  return (
    <span className="inline-flex h-[20px] items-center gap-[3px] rounded-[5px] px-[5px] text-[10.5px] font-semibold" style={si ? { color: COLOR_ESTADO.verde, background: `color-mix(in srgb, ${COLOR_ESTADO.verde} 13%, transparent)` } : { color: 'var(--ls-t4)', background: 'var(--ls-sup2)' }} title={`${texto}: ${si ? 'está entera' : 'no está entera'}`}>
      {si ? <Check className="h-[10px] w-[10px]" /> : <X className="h-[10px] w-[10px]" />}
      {texto}
    </span>
  )
}

/** Una barra de cuota (0..1) con su porcentaje */
export function BarraDeCuota({ valor, color = COLOR_ESTADO.azul }: { valor: number | null; color?: string }) {
  if (valor == null) return <span className="text-[var(--ls-t4)]">—</span>
  const pct = Math.max(0, Math.min(1, valor))
  return (
    <div className="ml-auto flex w-[96px] items-center justify-end gap-2">
      <div className="h-[5px] flex-1 overflow-hidden rounded-full bg-[var(--ls-sup2)]">
        <div className="h-full rounded-full" style={{ width: `${Math.max(pct * 100, 2)}%`, background: color }} />
      </div>
      <span className="w-[42px] text-right tabular-nums">{(pct * 100).toLocaleString('es-ES', { maximumFractionDigits: 1 })} %</span>
    </div>
  )
}

/** La evolución de un producto en un tipo de periodo, de la más vieja a la más nueva */
export function serieDe(datos: DatosSeo, asin: string, periodo: 'MONTH' | 'WEEK'): PuntoDeEvolucion[] {
  return (datos.evolucion ?? []).filter((p) => p.asin === asin && p.periodo === periodo).sort((a, b) => a.desde.localeCompare(b.desde))
}

/** La misma búsqueda en el periodo anterior (por texto normalizado) */
export function mapaAnterior(datos: DatosSeo, asin: string, periodo: 'MONTH' | 'WEEK'): Map<string, ConsultaAnterior> {
  return new Map((datos.anteriores?.[periodo] ?? []).filter((c) => c.asin === asin).map((c) => [c.consulta.trim().toLowerCase(), c]))
}

/** Una variación en puntos porcentuales (cuotas): verde si sube, rojo si baja */
export function DeltaPuntos({ actual, anterior }: { actual: number | null; anterior: number | null | undefined }) {
  if (actual == null || anterior == null) return <span className="text-[var(--ls-t4)]">—</span>
  const d = (actual - anterior) * 100
  if (Math.abs(d) < 0.05) return <span className="text-[var(--ls-t4)]">=</span>
  const color = d > 0 ? COLOR_ESTADO.verde : COLOR_ESTADO.rojo
  return (
    <span className="tabular-nums font-medium" style={{ color }} title="Variación de la cuota de compras frente al periodo anterior, en puntos">
      {d > 0 ? '▲' : '▼'} {Math.abs(d).toLocaleString('es-ES', { maximumFractionDigits: 1 })} pt
    </span>
  )
}
