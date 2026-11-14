'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Loader2, Plus, Search, X } from 'lucide-react'
import type { ProductoParaAnadir } from '@/lib/fba/portal'
import { FUENTE_TITULO, cx, n0 } from '@/components/encaje/marca'

/**
 * AÑADIR PRODUCTOS DE SU CATÁLOGO A LA PROPUESTA.
 *
 * Solo lo que el cliente tiene en FBA en la cuenta de este envío: se busca por nombre, SKU o ASIN en el
 * espejo del catálogo del ERP (no se llama a Amazon). Nada de texto libre: lo que no está en su catálogo no
 * se puede añadir, y el servidor lo vuelve a comprobar.
 */
export function BuscadorCatalogo({ token, yaEstan, onAnadir, onCerrar }: { token: string; yaEstan: Set<string>; onAnadir: (p: ProductoParaAnadir) => void; onCerrar: () => void }) {
  const [q, setQ] = useState('')
  const [cargando, setCargando] = useState(false)
  const [resultado, setResultado] = useState<{ productos: ProductoParaAnadir[]; hayMas: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const entrada = useRef<HTMLInputElement>(null)

  useEffect(() => entrada.current?.focus(), [])

  // Se busca al dejar de escribir, y la última respuesta gana: una búsqueda vieja que llega tarde no pisa a la nueva
  useEffect(() => {
    const control = new AbortController()
    const t = setTimeout(async () => {
      setCargando(true)
      setError(null)
      try {
        const res = await fetch(`/api/publico/envio/${token}/catalogo?q=${encodeURIComponent(q)}`, { signal: control.signal })
        const cuerpo = (await res.json().catch(() => null)) as ({ productos: ProductoParaAnadir[]; hayMas: boolean } & { error?: string }) | null
        if (!res.ok || !cuerpo) throw new Error(cuerpo?.error ?? 'No se ha podido buscar')
        setResultado({ productos: cuerpo.productos, hayMas: cuerpo.hayMas })
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError((e as Error).message)
      } finally {
        if (!control.signal.aborted) setCargando(false)
      }
    }, 300)
    return () => {
      clearTimeout(t)
      control.abort()
    }
  }, [q, token])

  return (
    <section className="rounded-3xl border border-[#F26212]/30 bg-[#FFFFFF] shadow-[0_18px_40px_-24px_rgba(242,98,18,0.45)]" aria-label="Añadir productos de tu catálogo">
      <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-4">
        <h3 className="text-[16px] text-[#141414]" style={{ fontFamily: FUENTE_TITULO, fontWeight: 600 }}>
          Añadir de tu catálogo
        </h3>
        <button type="button" onClick={onCerrar} aria-label="Cerrar el buscador" className="grid h-11 w-11 place-items-center rounded-xl text-[#8C857C] hover:bg-[#F7F5F2] hover:text-[#141414]">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="px-5">
        <label className="flex h-12 items-center gap-2 rounded-2xl border border-[#E5E1DB] bg-[#F7F5F2] px-4 focus-within:border-[#F26212]">
          <Search className="h-4 w-4 shrink-0 text-[#8C857C]" />
          <input
            ref={entrada}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Busca por nombre, SKU o ASIN"
            className="h-full w-full min-w-0 bg-transparent text-[15px] text-[#141414] placeholder:text-[#B8AE9F] focus:outline-none"
            aria-label="Buscar en tu catálogo"
          />
          {cargando && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#F26212]" />}
        </label>
        <p className="mt-2 text-[12.5px] text-[#8C857C]">Solo productos tuyos que están en FBA. Lo que añadas saldrá marcado como «Nuevo» para que lo revisemos.</p>
      </div>

      <div className="mt-3 max-h-[360px] overflow-y-auto px-2 pb-3">
        {error && <p className="mx-3 rounded-xl bg-[#FBE3E0] px-4 py-3 text-[13.5px] text-[#7A2020]">{error}</p>}
        {!error && resultado && resultado.productos.length === 0 && <p className="px-3 py-6 text-center text-[14px] text-[#5E5852]">{q ? 'No hay ningún producto tuyo con eso.' : 'No hay productos en tu catálogo de FBA.'}</p>}
        <ul>
          <AnimatePresence initial={false}>
            {resultado?.productos.map((p) => {
              const esta = yaEstan.has(p.sku)
              return (
                <motion.li key={p.sku} layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                  <button
                    type="button"
                    disabled={esta}
                    onClick={() => onAnadir(p)}
                    className={cx('flex min-h-[56px] w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition', esta ? 'cursor-default opacity-60' : 'hover:bg-[#FBEFE8]')}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-[14px] leading-snug text-[#141414]">{p.titulo ?? p.sku}</span>
                      <span className="mt-0.5 block truncate font-mono text-[11.5px] text-[#8C857C]">
                        {p.sku}
                        {p.asin ? ` · ${p.asin}` : ''}
                        {p.vendible !== null ? ` · ${n0(p.vendible)} en Amazon` : ''}
                      </span>
                    </span>
                    <span className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-xl', esta ? 'bg-[#E4F3EA] text-[#2F9657]' : 'bg-[#F26212] text-[#FFFFFF]')}>
                      {esta ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                    </span>
                  </button>
                </motion.li>
              )
            })}
          </AnimatePresence>
        </ul>
        {resultado?.hayMas && <p className="px-3 pt-2 text-center text-[12.5px] text-[#8C857C]">Hay más: afina la búsqueda para encontrarlo.</p>}
      </div>
    </section>
  )
}
