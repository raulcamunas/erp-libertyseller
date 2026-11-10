'use client'

import { useEffect, useState } from 'react'
import type { ProductoDeAds } from '@/lib/ads/cuenta'
import { margenDeProducto } from '@/lib/ads/margen'
import { llamar } from './llamar'

export interface ProductoConocido {
  resumen: string
  /** ACoS de equilibrio como fracción (0,243 = 24,3 %), o null si al producto le falta el precio o el coste */
  equilibrio: number | null
}

/** Los productos ya dados de alta en la cuenta (pestaña «Productos»), por ASIN: su nombre y su ACoS de equilibrio, para ponerlos junto a las cifras de sus campañas */
export function useProductosConocidos(perfilId: string): ReadonlyMap<string, ProductoConocido> {
  const [mapa, setMapa] = useState<ReadonlyMap<string, ProductoConocido>>(new Map())
  useEffect(() => {
    let vivo = true
    llamar<{ productos: ProductoDeAds[] }>(`/api/ads/cuenta/productos?perfilId=${perfilId}`)
      .then((r) => {
        if (!vivo) return
        setMapa(
          new Map(
            r.productos.map((p) => {
              const m = margenDeProducto(p)
              return [p.asin.toUpperCase(), { resumen: p.resumen, equilibrio: m && m.acosEquilibrioPct > 0 ? m.acosEquilibrioPct / 100 : null }]
            })
          )
        )
      })
      .catch(() => undefined) // sin la 292 o sin productos, simplemente no hay nombres ni equilibrios que mostrar
    return () => {
      vivo = false
    }
  }, [perfilId])
  return mapa
}
