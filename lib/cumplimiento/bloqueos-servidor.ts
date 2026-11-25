/**
 * CUMPLIMIENTO · LO QUE IMPIDE VENDER, LEÍDO DE LA BASE. SOLO SERVIDOR Y SOLO LECTURA (de listing_cumplimiento, migración 227: lo que deja la revisión horaria).
 *
 * Dos lecturas por conexión: los listings SUPRIMIDOS (lo que ya no se vende) y los que tienen stock y alguna incidencia de normativa (por si alguna tiene un plazo cercano:
 * en riesgo). La clasificación es la de lib/cumplimiento/bloqueos.ts. Y un recuento de los listings con stock, para el porcentaje de vendibles.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { leerTodo } from '@/lib/seo/paginar'
import { conexionesDeCliente } from './conexiones'
import { resumirBloqueos, type ResumenDeBloqueos } from './bloqueos'
import type { FilaCumplimiento } from './tipos'

const COLUMNAS = 'sku, asin, titulo, marketplace_id, con_stock, suprimido, incidencias, es_padre'
/** Tope de filas leídas por lectura y conexión: ShoesF tiene unos 3.000 suprimidos en cuatro países */
const MAX_FILAS = 8000

export async function bloqueosDeCliente(amazonClientId: string, mercado: string | null): Promise<(ResumenDeBloqueos & { ok: true; revisadoAt: string | null }) | { ok: false; error: string }> {
  const conexiones = await conexionesDeCliente(amazonClientId)
  if (conexiones.length === 0) return { ok: false, error: 'Este cliente no tiene ninguna cuenta de Amazon activa.' }
  const service = createServiceClient()
  const filas: Array<Pick<FilaCumplimiento, 'sku' | 'asin' | 'titulo' | 'marketplace_id' | 'con_stock' | 'suprimido' | 'incidencias' | 'es_padre'>> = []
  let conStock = 0
  let revisadoAt: string | null = null
  for (const c of conexiones) {
    const base = () => {
      let q = service.from('listing_cumplimiento').select(COLUMNAS).eq('connection_id', c.id).eq('en_amazon', true)
      if (mercado) q = q.eq('marketplace_id', mercado)
      return q
    }
    const suprimidos = await leerTodo<(typeof filas)[number]>((a, b) => base().eq('suprimido', true).order('marketplace_id').order('sku').range(a, b), { etiqueta: 'cumplimiento suprimidos', tamano: 1000, maxPaginas: MAX_FILAS / 1000 })
    const vistos = new Set(suprimidos.map((f) => `${f.marketplace_id}|${f.sku}`))
    const normativa = await leerTodo<(typeof filas)[number]>(
      (a, b) => base().eq('suprimido', false).eq('con_stock', true).contains('temas', ['normativa']).order('marketplace_id').order('sku').range(a, b),
      { etiqueta: 'cumplimiento normativa', tamano: 1000, maxPaginas: MAX_FILAS / 1000 }
    )
    filas.push(...suprimidos, ...normativa.filter((f) => !vistos.has(`${f.marketplace_id}|${f.sku}`)))

    let qc = service.from('listing_cumplimiento').select('sku', { count: 'exact', head: true }).eq('connection_id', c.id).eq('en_amazon', true).eq('con_stock', true).eq('es_padre', false)
    if (mercado) qc = qc.eq('marketplace_id', mercado)
    const { count, error } = await qc
    if (error) throw error
    conStock += count ?? 0

    let qr = service.from('listing_cumplimiento').select('revisado_at').eq('connection_id', c.id).order('revisado_at', { ascending: false }).limit(1)
    if (mercado) qr = qr.eq('marketplace_id', mercado)
    const { data: r } = await qr
    const at = ((r ?? []) as Array<{ revisado_at: string }>)[0]?.revisado_at ?? null
    if (at && (!revisadoAt || at > revisadoAt)) revisadoAt = at
  }
  return { ok: true, revisadoAt, ...resumirBloqueos(filas, conStock, new Date()) }
}
