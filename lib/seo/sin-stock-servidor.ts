import { createServiceClient } from '@/lib/supabase/service'
import { tramosSinVentas, type TramoSinVentas } from './sin-stock'

/**
 * SEO · DÍAS SIN VENTAS POR PRODUCTO, del libro mayor de FBA (fba_movimientos). SOLO SERVIDOR, SOLO LECTURA. La regla está en lib/seo/sin-stock.ts.
 *
 * Se suman todos los países de la conexión: con Pan-Europeo/EFN el stock de un ASIN está repartido por almacenes de varios países, y un día sin ninguna salida en
 * ninguno es un día sin stock (o con la ficha caída). Un ASIN sin ninguna fila en el libro mayor queda FUERA del resultado: no hay dato, no se afirma nada.
 */
const DIA = 86_400_000
export const DIAS_MIRADOS = 150

export async function sinVentasPorAsin(connectionId: string, asins: readonly string[], ahora = Date.now()): Promise<Record<string, TramoSinVentas[]>> {
  const lista = [...new Set(asins.map((a) => a.trim().toUpperCase()).filter(Boolean))]
  if (lista.length === 0) return {}
  const db = createServiceClient()
  const desde = new Date(ahora - DIAS_MIRADOS * DIA).toISOString().slice(0, 10)

  // Hasta dónde está leído el libro mayor de esta conexión (cualquier SKU): un tramo que llegue ahí no se afirma
  const { data: ultima, error: eU } = await db.from('fba_movimientos').select('fecha').eq('connection_id', connectionId).order('fecha', { ascending: false }).limit(1)
  if (eU) throw new Error(eU.message)
  const leidoHasta = (ultima?.[0] as { fecha: string } | undefined)?.fecha?.slice(0, 10)
  if (!leidoHasta || leidoHasta < desde) return {}

  type Fila = { asin: string | null; fecha: string; tipo: string; cantidad: number }
  const filas: Fila[] = []
  for (let a = 0; ; a += 1000) {
    const { data, error } = await db
      .from('fba_movimientos')
      .select('asin, fecha, tipo, cantidad')
      .eq('connection_id', connectionId)
      .in('asin', lista)
      .in('tipo', ['Shipments', 'Receipts'])
      .gte('fecha', desde)
      .order('fecha')
      .order('id')
      .range(a, a + 999)
    if (error) throw new Error(error.message)
    filas.push(...((data ?? []) as Fila[]))
    if ((data ?? []).length < 1000 || a > 60_000) break
  }

  const ventas = new Map<string, Record<string, number>>()
  const entradas = new Map<string, Record<string, number>>()
  for (const f of filas) {
    const asin = (f.asin ?? '').toUpperCase()
    if (!asin) continue
    const d = f.fecha.slice(0, 10)
    const n = Number(f.cantidad) || 0
    if (f.tipo === 'Shipments' && n < 0) {
      const m = ventas.get(asin) ?? {}
      m[d] = (m[d] ?? 0) - n
      ventas.set(asin, m)
    } else if (f.tipo === 'Receipts' && n > 0) {
      const m = entradas.get(asin) ?? {}
      m[d] = (m[d] ?? 0) + n
      entradas.set(asin, m)
    }
  }
  const salida: Record<string, TramoSinVentas[]> = {}
  for (const asin of lista) {
    if (!ventas.has(asin)) continue
    salida[asin] = tramosSinVentas(ventas.get(asin) ?? {}, entradas.get(asin) ?? {}, desde, leidoHasta)
  }
  return salida
}
