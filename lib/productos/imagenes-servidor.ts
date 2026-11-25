/**
 * LA IMAGEN PRINCIPAL DE LOS PRODUCTOS, CON CACHÉ. SOLO SERVIDOR. Solo LEE de Amazon.
 *
 * Se lee del catálogo (Catalog Items, includedData=images; el catálogo es público, así que vale cualquier conexión de vendedor activa en ese país) y se guarda en
 * `producto_imagenes` (migración 337) 30 días; un ASIN sin imagen se vuelve a preguntar a los 7. Sin la migración, se pide cada vez (y se recuerda en memoria del proceso).
 */
import { createServiceClient } from '@/lib/supabase/service'
import { connectionCredentials } from '@/lib/amazon/data'
import { spApiRequest } from '@/lib/amazon/sp-api'
import { isMissingSchema } from '@/lib/plataforma/eventos'

const DIA = 86_400_000
const VIGENCIA_MS = 30 * DIA
const VIGENCIA_SIN_IMAGEN_MS = 7 * DIA
const memoria = new Map<string, { url: string | null; at: number }>()
const clave = (m: string, a: string) => `${m}|${a}`

/** Una conexión de vendedor activa en ese país (la que se pida, si vale) */
async function conexionPara(marketplaceId: string, preferida?: string | null): Promise<string | null> {
  const service = createServiceClient()
  const { data } = await service.from('amazon_connections').select('id, marketplace_ids, is_active, status').eq('is_active', true).eq('status', 'activa')
  const filas = (data ?? []) as Array<{ id: string; marketplace_ids: string[] | null }>
  const validas = filas.filter((f) => (f.marketplace_ids ?? []).includes(marketplaceId))
  return validas.find((f) => f.id === preferida)?.id ?? validas[0]?.id ?? null
}

function principalDe(item: Record<string, unknown>, marketplaceId: string): string | null {
  const grupos = (item.images ?? []) as Array<{ marketplaceId?: string; images?: Array<{ variant?: string; link?: string; height?: number; width?: number }> }>
  const grupo = grupos.find((g) => g.marketplaceId === marketplaceId) ?? grupos[0]
  const principales = (grupo?.images ?? []).filter((i) => i.variant === 'MAIN' && i.link)
  const mejor = principales.sort((a, b) => (b.height ?? 0) * (b.width ?? 0) - (a.height ?? 0) * (a.width ?? 0))[0]
  return mejor?.link ?? null
}

export async function imagenesDe(marketplaceId: string, asinsCrudos: readonly string[], opciones: { connectionId?: string | null } = {}): Promise<Record<string, string | null>> {
  const asins = [...new Set(asinsCrudos.map((a) => a.trim().toUpperCase()).filter((a) => /^[A-Z0-9]{10}$/.test(a)))].slice(0, 200)
  const salida: Record<string, string | null> = {}
  if (asins.length === 0) return salida
  const ahora = Date.now()
  const vigente = (url: string | null, at: number) => ahora - at < (url ? VIGENCIA_MS : VIGENCIA_SIN_IMAGEN_MS)
  const service = createServiceClient()

  let conTabla = true
  const { data, error } = await service.from('producto_imagenes').select('asin, url, leida_at').eq('marketplace_id', marketplaceId).in('asin', asins)
  if (error) {
    if (!isMissingSchema(error)) throw error
    conTabla = false
  }
  for (const f of (data ?? []) as Array<{ asin: string; url: string | null; leida_at: string }>) if (vigente(f.url, Date.parse(f.leida_at))) salida[f.asin] = f.url
  for (const a of asins) {
    const m = memoria.get(clave(marketplaceId, a))
    if (!(a in salida) && m && vigente(m.url, m.at)) salida[a] = m.url
  }

  const faltan = asins.filter((a) => !(a in salida))
  if (faltan.length === 0) return salida
  const conexion = await conexionPara(marketplaceId, opciones.connectionId)
  const resuelta = conexion ? await connectionCredentials(conexion) : null
  if (!resuelta) {
    for (const a of faltan) salida[a] = null
    return salida
  }
  const nuevas: Array<{ marketplace_id: string; asin: string; url: string | null; leida_at: string }> = []
  for (let i = 0; i < faltan.length; i += 20) {
    const tanda = faltan.slice(i, i + 20)
    try {
      const { data: r } = await spApiRequest<{ items?: Array<Record<string, unknown>> }>(resuelta.credentials, 'searchCatalogItems', {
        method: 'GET',
        path: '/catalog/2022-04-01/items',
        query: { identifiers: tanda, identifiersType: 'ASIN', marketplaceIds: [marketplaceId], includedData: ['images'], pageSize: 20 },
      })
      const porAsin = new Map<string, string | null>()
      for (const item of r.items ?? []) if (typeof item.asin === 'string') porAsin.set(item.asin, principalDe(item, marketplaceId))
      for (const a of tanda) {
        const url = porAsin.get(a) ?? null
        salida[a] = url
        memoria.set(clave(marketplaceId, a), { url, at: ahora })
        nuevas.push({ marketplace_id: marketplaceId, asin: a, url, leida_at: new Date(ahora).toISOString() })
      }
    } catch (e) {
      // Un fallo de Amazon no rompe la pantalla: sin imagen esta vez, y no se guarda (se vuelve a pedir la próxima)
      console.error('Imágenes de producto:', e instanceof Error ? e.message : e)
      for (const a of tanda) salida[a] = null
    }
  }
  if (conTabla && nuevas.length > 0) {
    const { error: e } = await service.from('producto_imagenes').upsert(nuevas, { onConflict: 'marketplace_id,asin' })
    if (e && !isMissingSchema(e)) console.error('Imágenes de producto: guardar:', e.message)
  }
  return salida
}
