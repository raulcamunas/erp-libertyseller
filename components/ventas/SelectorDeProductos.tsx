'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Check, Search, X } from 'lucide-react'
import { ImagenDeProducto } from '@/components/productos/ImagenDeProducto'
import { bandera, pais } from './piezas'

/**
 * VENTAS · «SELECCIONAR» PRODUCTOS (la barra de arriba de Sellerboard): elegir uno o varios productos y que TODAS las vistas (Baldosas, Gráfico y P&L) se
 * calculen solo con ellos. Busca por título, ASIN o SKU; cada fila con su foto y su país. Sin nada elegido, la cuenta entera.
 */

export interface ProductoElegible {
  sku: string
  asin: string | null
  titulo: string | null
  mkt: string
  ventas?: number
}

export function SelectorDeProductos({ productos, seleccion, onCambio, className = 'mb-5' }: { productos: ProductoElegible[]; seleccion: Set<string> | null; onCambio: (s: Set<string> | null) => void; className?: string }) {
  const [abierto, setAbierto] = useState(false)
  const [q, setQ] = useState('')
  const caja = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!abierto) return
    const fuera = (e: MouseEvent) => !caja.current?.contains(e.target as Node) && setAbierto(false)
    document.addEventListener('mousedown', fuera)
    return () => document.removeEventListener('mousedown', fuera)
  }, [abierto])

  const lista = useMemo(() => {
    const t = q.trim().toLowerCase()
    return productos
      .filter((p) => !t || p.sku.toLowerCase().includes(t) || (p.asin ?? '').toLowerCase().includes(t) || (p.titulo ?? '').toLowerCase().includes(t))
      .sort((a, b) => Number(seleccion?.has(b.sku) ?? 0) - Number(seleccion?.has(a.sku) ?? 0) || (b.ventas ?? 0) - (a.ventas ?? 0) || a.sku.localeCompare(b.sku))
  }, [productos, q, seleccion])
  const elegidos = productos.filter((p) => seleccion?.has(p.sku))

  const alternar = (sku: string) => {
    const s = new Set(seleccion ?? [])
    if (s.has(sku)) s.delete(sku)
    else s.add(sku)
    onCambio(s.size ? s : null)
  }

  return (
    <div ref={caja} className={`relative ${className}`}>
      <div
        onClick={() => setAbierto(true)}
        className="flex min-h-[44px] cursor-text flex-wrap items-center gap-2 rounded-[14px] border bg-[var(--ls-sup)] px-3 py-[6px] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-colors"
        style={{ borderColor: abierto ? 'color-mix(in srgb, #F26212 45%, var(--ls-linea))' : 'var(--ls-linea)' }}
      >
        <Search className="h-[15px] w-[15px] shrink-0 text-[var(--ls-t4)]" />
        {elegidos.slice(0, 6).map((p) => (
          <span key={p.sku} className="inline-flex max-w-[260px] items-center gap-[6px] rounded-[9px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] py-[3px] pl-[3px] pr-[6px] text-[12px] text-[var(--ls-t1)]">
            <span className="rounded-[5px] bg-white p-[1px]">
              <ImagenDeProducto asin={p.asin} mkt={p.mkt} lado={20} redondeo={4} borde={false} className="shadow-[0_1px_4px_rgba(0,0,0,0.35)]" />
            </span>
            <span className="truncate">{p.sku}</span>
            <button type="button" onClick={(e) => (e.stopPropagation(), alternar(p.sku))} aria-label={`Quitar ${p.sku}`} className="text-[var(--ls-t4)] hover:text-[var(--ls-t1)]">
              <X className="h-[12px] w-[12px]" />
            </button>
          </span>
        ))}
        {elegidos.length > 6 && <span className="text-[12px] text-[var(--ls-t3)]">y {elegidos.length - 6} más</span>}
        <input value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => setAbierto(true)} placeholder={elegidos.length ? 'Añadir otro producto…' : 'Seleccionar productos para analizarlos solos (título, ASIN o SKU)'} className="min-w-[200px] flex-1 bg-transparent text-[13px] text-[var(--ls-t1)] outline-none placeholder:text-[var(--ls-t4)]" />
        {seleccion && (
          <button type="button" onClick={(e) => (e.stopPropagation(), onCambio(null))} className="rounded-[8px] px-2 py-1 text-[12px] text-[var(--ls-t3)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]">
            Toda la cuenta
          </button>
        )}
      </div>
      {abierto && (
        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15 }} className="absolute inset-x-0 top-[50px] z-40 overflow-hidden rounded-[16px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] shadow-[var(--ls-sombra-3)]">
          <div className="flex items-center gap-3 border-b border-[var(--ls-linea)] px-4 py-[10px]">
            <span className="text-[12.5px] font-semibold text-[var(--ls-t1)]">Productos</span>
            <span className="text-[11.5px] text-[var(--ls-t4)]">{lista.length}</span>
            <button type="button" onClick={() => onCambio(new Set(lista.map((p) => p.sku)))} className="ml-auto text-[12px] text-[var(--ls-t2)] underline-offset-2 hover:underline">
              Seleccionar {q ? 'los encontrados' : 'todos'}
            </button>
            <button type="button" onClick={() => onCambio(null)} className="text-[12px] text-[var(--ls-t4)] underline-offset-2 hover:underline">
              Deseleccionar todos
            </button>
          </div>
          <div className="max-h-[380px] overflow-y-auto">
            {lista.length === 0 && <p className="px-4 py-6 text-[12.5px] text-[var(--ls-t4)]">Ningún producto con «{q}».</p>}
            {lista.slice(0, 300).map((p) => {
              const on = Boolean(seleccion?.has(p.sku))
              return (
                <button key={p.sku} type="button" onClick={() => alternar(p.sku)} className="flex w-full items-center gap-3 border-b border-[var(--ls-linea)] px-4 py-[8px] text-left transition-colors last:border-b-0 hover:bg-[var(--ls-sup2)]">
                  <span className="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[5px] border transition-colors" style={on ? { background: '#F26212', borderColor: '#F26212' } : { borderColor: 'var(--ls-t4)' }}>
                    {on && <Check className="h-[11px] w-[11px] text-[#141414]" strokeWidth={3} />}
                  </span>
                  <span className="shrink-0 rounded-[7px]">
                    <ImagenDeProducto asin={p.asin} mkt={p.mkt} lado={34} redondeo={5} borde={false} className="shadow-[0_1px_4px_rgba(0,0,0,0.35)]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] text-[var(--ls-t1)]">{p.titulo ?? p.sku}</span>
                    <span className="block text-[11px] text-[var(--ls-t4)]">
                      <span title={pais(p.mkt)}>{bandera(p.mkt)}</span> {p.asin ?? '—'} · SKU {p.sku}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </motion.div>
      )}
    </div>
  )
}
