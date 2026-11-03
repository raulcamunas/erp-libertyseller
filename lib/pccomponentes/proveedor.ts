import 'server-only'
import { EntraisError, faltaConfigurar, llamarEntraisDetalle, type ProductoEntrais } from '@/lib/entrais/api'
import { limpiarEan } from './datos'

/**
 * LOS PRODUCTOS DEL PROVEEDOR DE ENTRAIS, VISTOS DESDE PCCOMPONENTES — SOLO SERVIDOR.
 * ==================================================================================
 * Es la misma API (y la misma caché y el mismo contador de cuota) que ya usan el ciclo de stock y el motor de precios de Amazon: `/api/v1/Products`
 * admite muy pocas llamadas por hora (el proveedor ha llegado a decir 2) y el ciclo de stock se las gasta. Por eso aquí NUNCA se llama: se aprovecha
 * el catálogo que el ciclo ya trajo, que sirve a Amazon y a PcComponentes a la vez. Si no hay ninguno en memoria, se avisa y se espera a la próxima pasada.
 *
 * De cada producto salen los datos con los que se publica en PcComponentes: `code` (el SKU de siempre), el EAN y la referencia del fabricante para que
 * PcComponentes lo reconozca, y el coste y el stock. El stock del proveedor PUEDE SER NEGATIVO: aquí se recorta a cero.
 */

export interface ProductoParaPcc {
  codigo: string
  descripcion: string
  marca: string | null
  /** El EAN ya limpio y válido. null = el producto no se puede cruzar con PcComponentes */
  ean: string | null
  mpn: string | null
  /** El coste del proveedor, SIN IVA */
  coste: number
  canon: number
  stock: number
  digital: boolean
}

const aProducto = (p: ProductoEntrais): ProductoParaPcc => ({
  codigo: String(p.code),
  descripcion: p.description,
  marca: p.brand?.description ?? null,
  ean: limpiarEan(p.ean),
  mpn: p.partNumber?.trim() || null,
  coste: p.price,
  canon: p.digitalCanon ?? 0,
  stock: Math.max(0, Math.round(p.stock)),
  digital: p.digital,
})

export interface LecturaDeProductos {
  productos: ProductoParaPcc[]
  /** true si no se ha llamado al proveedor: salía de memoria */
  deCache: boolean
  edadMin: number
  llamadasQueQuedan: number | null
}

export async function productosDelProveedor(): Promise<LecturaDeProductos> {
  const falta = faltaConfigurar('real')
  if (falta) throw new EntraisError(falta, 0)
  // Una hora y media de margen: el ciclo de stock lo renueva cada ~30 min y aquí no se pide nunca uno nuevo
  const lectura = await llamarEntraisDetalle<ProductoEntrais[]>('real', '/api/v1/Products', { nuncaLlamar: true, frescuraMs: 90 * 60_000 })
  return {
    productos: (Array.isArray(lectura.datos) ? lectura.datos : []).map(aProducto),
    deCache: lectura.deCache,
    edadMin: Math.round(lectura.edadMs / 60_000),
    llamadasQueQuedan: lectura.cuota?.quedan ?? null,
  }
}

/** Busca por código, EAN, referencia del fabricante o parte de la descripción. Hasta `max` resultados */
export function buscarProductos(productos: readonly ProductoParaPcc[], consulta: string, max = 20): ProductoParaPcc[] {
  const q = consulta.trim().toLowerCase()
  if (q.length < 3) return []
  const salida: ProductoParaPcc[] = []
  for (const p of productos) {
    if (p.codigo === q || p.ean === q || (p.mpn ?? '').toLowerCase() === q || p.descripcion.toLowerCase().includes(q)) {
      salida.push(p)
      if (salida.length >= max) break
    }
  }
  return salida
}
