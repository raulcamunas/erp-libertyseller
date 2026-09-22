'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Loader2, Package, RefreshCw, Search, X } from 'lucide-react'
import { toast } from 'sonner'

/**
 * ELEGIR LOS PRODUCTOS DE FBA DEL CLIENTE.
 *
 * Sustituye a pegar una tabla. Pegar sirve para migrar una hoja de cálculo de
 * golpe —y por eso se deja—, pero para montar un envío del día a día obliga a
 * salir a otro sitio a copiar códigos, que es justo lo que este módulo viene a
 * quitar.
 *
 * Solo salen los de FBA: un producto que gestiona el vendedor no se manda a un
 * almacén de Amazon, y ofrecerlo aquí solo sirve para que alguien lo elija por
 * error y el envío nazca mal.
 *
 *
 * ============ EL BOTÓN DE REFRESCAR ============
 *
 * Existe para un caso concreto: acabas de crear el producto a mano en Seller
 * Central y todavía no ha entrado por el ciclo de quince minutos. Relee el
 * catálogo contra Amazon en ese momento.
 *
 * Y dice cuántas ha leído de cuántas hay. La API de Amazon no pagina más allá
 * de mil referencias por pasada: con un catálogo de cuarenta mil, una pasada ve
 * el 2 %. Si el producto buscado no cae ahí, el botón parecería no hacer nada —
 * y eso es peor que no tener botón.
 */

export interface ProductoFba {
  sku: string
  titulo: string | null
  asin: string | null
  fnsku: string | null
  stock: number | null
  vendible: number | null
}

export interface Elegido extends ProductoFba {
  unidades: number
}

export function SelectorProductos({
  clienteId,
  esAdmin,
  elegidos,
  onCambio,
}: {
  clienteId: string
  esAdmin: boolean
  elegidos: Elegido[]
  onCambio: (e: Elegido[]) => void
}) {
  const [busqueda, setBusqueda] = useState('')
  const [productos, setProductos] = useState<ProductoFba[]>([])
  const [total, setTotal] = useState(0)
  const [hayMas, setHayMas] = useState(false)
  const [conectado, setConectado] = useState(true)
  const [cargando, setCargando] = useState(true)
  const [refrescando, setRefrescando] = useState(false)
  const peticion = useRef(0)

  const buscar = useCallback(
    async (q: string) => {
      const mia = ++peticion.current
      setCargando(true)
      try {
        const res = await fetch(
          `/api/fba/productos?cliente=${clienteId}${q ? `&q=${encodeURIComponent(q)}` : ''}`
        )
        // Si mientras tanto se ha lanzado otra búsqueda, esta respuesta ya no
        // vale: sin esto, una búsqueda lenta pisa a otra más reciente.
        if (mia !== peticion.current) return
        const p = (await res.json()) as {
          productos?: ProductoFba[]
          total?: number
          hayMas?: boolean
          conectado?: boolean
          error?: string
        }
        if (!res.ok) {
          toast.error(p.error ?? 'No se han podido leer los productos')
          return
        }
        setProductos(p.productos ?? [])
        setTotal(p.total ?? 0)
        setHayMas(p.hayMas ?? false)
        setConectado(p.conectado !== false)
      } finally {
        if (mia === peticion.current) setCargando(false)
      }
    },
    [clienteId]
  )

  // Se espera a que deje de teclear: una consulta por letra sobre 42.000
  // referencias es trabajo que nadie llega a leer.
  useEffect(() => {
    const t = setTimeout(() => buscar(busqueda), busqueda ? 280 : 0)
    return () => clearTimeout(t)
  }, [busqueda, buscar])

  async function refrescar() {
    setRefrescando(true)
    try {
      const res = await fetch(`/api/fba/productos?cliente=${clienteId}`, { method: 'POST' })
      const p = (await res.json()) as {
        referencias?: number
        declaradas?: number
        truncado?: boolean
        error?: string
      }
      if (!res.ok) {
        toast.error(p.error ?? 'No se ha podido refrescar')
        return
      }
      if (p.truncado) {
        toast.warning(`Leídas ${p.referencias} de ${p.declaradas} referencias`, {
          description:
            'Amazon no deja leer más de mil por pasada. Si el producto que buscas no aparece, ' +
            'escribe su SKU en el buscador: se busca sobre todo el catálogo guardado.',
          duration: 9000,
        })
      } else {
        toast.success(`Catálogo releído: ${p.referencias} referencias`)
      }
      await buscar(busqueda)
    } finally {
      setRefrescando(false)
    }
  }

  const porSku = useMemo(() => new Map(elegidos.map((e) => [e.sku, e])), [elegidos])

  function alternar(p: ProductoFba) {
    if (porSku.has(p.sku)) onCambio(elegidos.filter((e) => e.sku !== p.sku))
    else onCambio([...elegidos, { ...p, unidades: 1 }])
  }

  function cambiarUnidades(sku: string, unidades: number) {
    onCambio(elegidos.map((e) => (e.sku === sku ? { ...e, unidades: Math.max(1, unidades) } : e)))
  }

  if (!conectado) {
    return (
      <div className="rounded-lg border border-amber-400/20 bg-amber-400/[0.06] p-3 text-[11px] text-amber-200/90">
        Este cliente no tiene la API de Amazon conectada, así que no hay catálogo del que elegir.
        Pega las referencias a mano abajo.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/30" />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por SKU, nombre o ASIN"
            className="w-full rounded-lg border border-white/10 bg-white/[0.03] py-1.5 pl-8 pr-2 text-[12px] text-white placeholder:text-white/25 focus:border-[#FF6600]/40 focus:outline-none"
          />
          {cargando && (
            <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-white/30" />
          )}
        </div>
        {esAdmin && (
          <motion.button
            type="button"
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            onClick={refrescar}
            disabled={refrescando}
            title="Releer el catálogo contra Amazon. Para cuando acabas de crear un producto a mano"
            className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] text-white/60 hover:border-white/25 hover:text-white disabled:opacity-40"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refrescando ? 'animate-spin' : ''}`} />
            {refrescando ? 'Leyendo…' : 'Refrescar'}
          </motion.button>
        )}
      </div>

      {/* Lo elegido, arriba y siempre visible */}
      <AnimatePresence initial={false}>
        {elegidos.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="rounded-lg border border-[#FF6600]/25 bg-[#FF6600]/[0.05] p-2">
              <p className="mb-1.5 text-[10px] uppercase tracking-wide text-[#FF6600]/80">
                {elegidos.length} referencia{elegidos.length === 1 ? '' : 's'} ·{' '}
                {elegidos.reduce((s, e) => s + e.unidades, 0)} unidades
              </p>
              <div className="max-h-44 space-y-0.5 overflow-y-auto">
                {elegidos.map((e) => (
                  <motion.div
                    key={e.sku}
                    layout
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-white/[0.03]"
                  >
                    <span className="font-mono text-[11px] text-white/70">{e.sku}</span>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-white/40">
                      {e.titulo ?? ''}
                    </span>
                    {!e.fnsku && (
                      <span
                        className="text-[9px] text-amber-400"
                        title="Sin FNSKU no se puede imprimir su etiqueta. La pasada de esta noche lo rellena"
                      >
                        sin FNSKU
                      </span>
                    )}
                    <input
                      type="number"
                      min="1"
                      value={e.unidades}
                      onChange={(ev) => cambiarUnidades(e.sku, Math.floor(Number(ev.target.value) || 1))}
                      className="w-[58px] rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-right text-[11px] tabular-nums text-white focus:border-[#FF6600]/40 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => onCambio(elegidos.filter((x) => x.sku !== e.sku))}
                      className="rounded p-0.5 text-white/30 hover:text-red-400"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* El catálogo */}
      <div className="max-h-64 overflow-y-auto rounded-lg border border-white/10">
        {productos.length === 0 && !cargando && (
          <div className="flex flex-col items-center gap-1.5 p-6 text-center">
            <Package className="h-6 w-6 text-white/15" />
            <p className="text-[11px] text-white/35">
              {busqueda ? 'Nada que coincida' : 'Este cliente no tiene productos de FBA guardados'}
            </p>
            {!busqueda && esAdmin && (
              <p className="text-[10px] text-white/25">Prueba a refrescar el catálogo</p>
            )}
          </div>
        )}
        {productos.map((p) => {
          const elegido = porSku.has(p.sku)
          return (
            <button
              key={p.sku}
              type="button"
              onClick={() => alternar(p)}
              className={`flex w-full items-center gap-2 border-b border-white/[0.04] px-2 py-1.5 text-left last:border-0 transition-colors ${
                elegido ? 'bg-[#FF6600]/[0.07]' : 'hover:bg-white/[0.03]'
              }`}
            >
              <div
                className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                  elegido ? 'border-[#FF6600] bg-[#FF6600]' : 'border-white/20'
                }`}
              >
                {elegido && <Check className="h-2.5 w-2.5 text-white" />}
              </div>
              <span className="font-mono text-[11px] text-white/60">{p.sku}</span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-white/45">
                {p.titulo ?? '—'}
              </span>
              {p.stock !== null && (
                <span className="shrink-0 text-[10px] text-white/30" title="Lo que hay hoy en Amazon">
                  {p.stock} en FBA
                </span>
              )}
            </button>
          )
        })}
      </div>

      <p className="text-[10px] text-white/25">
        {total} producto{total === 1 ? '' : 's'} de FBA
        {hayMas && ' · escribe para afinar, solo se ven los primeros'}
      </p>
    </div>
  )
}
