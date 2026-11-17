import 'server-only'
import { createServiceClient } from '@/lib/supabase/service'
import { fetchAll } from '@/lib/supabase/paginacion'
import { leerPedidos } from './mirakl'
import { lineasDePedidos, resumir } from './ventas'

/** Las ventas de un periodo (OR11 + el coste de hoy de cada SKU). Se guardan 5 minutos en memoria: los pedidos no cambian tan deprisa y la API tiene límite */
const cache = new Map<string, { at: number; valor: Awaited<ReturnType<typeof calcular>> }>()

async function calcular(desde: string, hasta: string) {
  const pedidos = await leerPedidos(desde, hasta)
  const service = createServiceClient()
  const filas = await fetchAll<{ sku: string; ean: string | null; coste: number | null; porte: number | null }>((a, b) => service.from('entrais_precios').select('sku, ean, coste, porte').order('sku', { ascending: true }).range(a, b))
  const costes = new Map<string, { coste: number; porte: number }>()
  for (const f of filas) {
    if (f.coste === null) continue
    const v = { coste: Number(f.coste), porte: Number(f.porte ?? 0) }
    costes.set(f.sku, v)
    // En algunos pedidos el código de la oferta es el EAN, no el SKU
    if (f.ean && !costes.has(f.ean)) costes.set(f.ean, v)
  }
  const lineas = lineasDePedidos(pedidos, (sku) => costes.get(sku) ?? null)
  return { lineas, ...resumir(lineas) }
}

export async function ventasDe(desde: string, hasta: string) {
  const k = `${desde}|${hasta}`
  const c = cache.get(k)
  if (c && Date.now() - c.at < 5 * 60_000) return c.valor
  const valor = await calcular(desde, hasta)
  cache.set(k, { at: Date.now(), valor })
  return valor
}
