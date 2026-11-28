'use client'

import { useEffect, useMemo, useState } from 'react'
import { Star, TriangleAlert } from 'lucide-react'

/**
 * VALORACIONES: la nota media y el número de reseñas de los productos anunciados y seguidos en SEO de todos los clientes (Keepa, una foto al día), con
 * el cambio en 7 días. Primero los que empeoran. /api/ventas/resenas/valoraciones. Sin fotos todavía (migración 357 o primer día), no se pinta.
 */

interface Producto {
  cliente: string
  asin: string
  pais: string
  titulo: string | null
  valoracion: number | null
  num: number | null
  valoracion7: number | null
  num7: number | null
  aviso: string | null
  dia: string
}

export function ValoracionesDeProductos() {
  const [productos, setProductos] = useState<Producto[] | null>(null)
  const [todos, setTodos] = useState(false)
  useEffect(() => {
    fetch('/api/ventas/resenas/valoraciones')
      .then((r) => (r.ok ? (r.json() as Promise<{ productos: Producto[] }>) : { productos: [] }))
      .then((d) => setProductos(d.productos))
      .catch(() => setProductos([]))
  }, [])
  const lista = useMemo(() => {
    const p = [...(productos ?? [])].sort((a, b) => Number(Boolean(b.aviso)) - Number(Boolean(a.aviso)) || (a.valoracion ?? 9) - (b.valoracion ?? 9))
    return todos ? p : p.slice(0, 12)
  }, [productos, todos])
  if (!productos || productos.length === 0) return null
  const conAviso = productos.filter((p) => p.aviso).length
  const dif = (a: number | null, b: number | null, d = 1) => (a == null || b == null || a === b ? '' : `${a > b ? '+' : ''}${(a - b).toFixed(d).replace('.', ',')}`)
  return (
    <section className="mb-4 rounded-[16px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-3 sm:p-4">
      <header className="mb-2.5 flex flex-wrap items-center gap-2">
        <Star className="h-4 w-4 text-[#F5B942]" aria-hidden />
        <h2 className="text-[13.5px] font-semibold text-[var(--ls-t1)]">Valoraciones de los productos</h2>
        <span className="text-[12px] text-[var(--ls-t4)]">
          · {productos.length} productos · {conAviso ? `${conAviso} empeoran esta semana` : 'ninguno empeora esta semana'}
        </span>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-[12.5px]">
          <thead className="text-[11px] uppercase tracking-wide text-[var(--ls-t4)]">
            <tr>
              <th className="px-2 py-1.5 text-left">Producto</th>
              <th className="px-2 py-1.5 text-left">Cliente</th>
              <th className="px-2 py-1.5 text-right">Nota</th>
              <th className="px-2 py-1.5 text-right">7 días</th>
              <th className="px-2 py-1.5 text-right">Reseñas</th>
              <th className="px-2 py-1.5 text-right">7 días</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((p) => (
              <tr key={`${p.pais}|${p.asin}`} className="border-t border-[var(--ls-linea)]">
                <td className="max-w-[300px] px-2 py-1.5">
                  <div className="truncate text-[var(--ls-t1)]" title={p.titulo ?? p.asin}>{p.titulo ?? p.asin}</div>
                  <div className="text-[11px] text-[var(--ls-t4)]">
                    {p.asin} · {p.pais}
                    {p.aviso && (
                      <span className="ml-1 inline-flex items-center gap-1 text-[#F87171]">
                        <TriangleAlert className="h-3 w-3" aria-hidden /> {p.aviso}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-2 py-1.5 text-[var(--ls-t3)]">{p.cliente}</td>
                <td className="px-2 py-1.5 text-right font-semibold tabular-nums" style={{ color: p.valoracion == null ? 'var(--ls-t4)' : p.valoracion >= 4.3 ? '#34D399' : p.valoracion >= 4 ? '#F5B942' : '#F87171' }}>
                  {p.valoracion == null ? '—' : p.valoracion.toFixed(1).replace('.', ',')}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-[var(--ls-t3)]">{dif(p.valoracion, p.valoracion7)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{p.num?.toLocaleString('es-ES') ?? '—'}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-[var(--ls-t3)]">{dif(p.num, p.num7, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {productos.length > 12 && (
        <button type="button" onClick={() => setTodos((t) => !t)} className="mt-2 text-[12px] font-medium text-[var(--ls-acc)] hover:underline">
          {todos ? 'Ver menos' : `Ver los ${productos.length}`}
        </button>
      )}
    </section>
  )
}
