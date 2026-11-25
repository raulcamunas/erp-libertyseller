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
const memoria = new Map<string, { url: string | null; marca?: string | null; at: number }>()
const clave = (m: string, a: string) => `${m}|${a}`

/** Una conexión de vendedor activa en ese país (la que se pida, si vale) */
async function conexionPara(marketplaceId: string, preferida?: string | null): Promise<string | null> {
  const service = createServiceClient()
  const { data } = await service.from('amazon_connections').select('id, marketplace_ids, is_active, status').eq('is_active', true).eq('status', 'activa')
  const filas = (data ?? []) as Array<{ id: string; marketplace_ids: string[] | null }>
  const validas = filas.filter((f) => (f.marketplace_ids ?? []).includes(marketplaceId))
  return validas.find((f) => f.id === preferida)?.id ?? validas[0]?.id ?? null
}

function marcaDe(item: Record<string, unknown>, marketplaceId: string): string | null {
  const res = (item.summaries ?? []) as Array<{ marketplaceId?: string; brand?: string; brandName?: string }>
  const r = res.find((x) => x.marketplaceId === marketplaceId) ?? res[0]
  const m = (r?.brand ?? r?.brandName ?? '').trim()
  return m ? m.slice(0, 80) : null
}

function principalDe(item: Record<string, unknown>, marketplaceId: string): string | null {
  const grupos = (item.images ?? []) as Array<{ marketplaceId?: string; images?: Array<{ variant?: string; link?: string; height?: number; width?: number }> }>
  const grupo = grupos.find((g) => g.marketplaceId === marketplaceId) ?? grupos[0]
  const principales = (grupo?.images ?? []).filter((i) => i.variant === 'MAIN' && i.link)
  const mejor = principales.sort((a, b) => (b.height ?? 0) * (b.width ?? 0) - (a.height ?? 0) * (a.width ?? 0))[0]
  return mejor?.link ?? null
}

export interface DatoDeCatalogo {
  url: string | null
  marca: string | null
}

/** Las marcas de unos ASIN (catálogo de Amazon, con la misma caché que las imágenes). null si Amazon no la da */
export async function marcasDe(marketplaceId: string, asins: readonly string[], opciones: { connectionId?: string | null; necesitaMarca?: boolean } = {}): Promise<Record<string, string | null>> {
  const d = await datosDeCatalogo(marketplaceId, asins, { ...opciones, necesitaMarca: true })
  return Object.fromEntries(Object.entries(d).map(([a, x]) => [a, x.marca]))
}

export async function imagenesDe(marketplaceId: string, asins: readonly string[], opciones: { connectionId?: string | null } = {}): Promise<Record<string, string | null>> {
  const d = await datosDeCatalogo(marketplaceId, asins, opciones)
  return Object.fromEntries(Object.entries(d).map(([a, x]) => [a, x.url]))
}

/**
 * La imagen y la marca de unos ASIN. De la caché si está vigente (y, si se pide la marca, si la caché ya la tiene: las filas de antes de la migración 338 no la llevan); si no, del catálogo.
 */
export async function datosDeCatalogo(marketplaceId: string, asinsCrudos: readonly string[], opciones: { connectionId?: string | null; necesitaMarca?: boolean } = {}): Promise<Record<string, DatoDeCatalogo>> {
  const asins = [...new Set(asinsCrudos.map((a) => a.trim().toUpperCase()).filter((a) => /^[A-Z0-9]{10}$/.test(a)))].slice(0, 400)
  const salida: Record<string, DatoDeCatalogo> = {}
  if (asins.length === 0) return salida
  const ahora = Date.now()
  const vigente = (url: string | null, at: number) => ahora - at < (url ? VIGENCIA_MS : VIGENCIA_SIN_IMAGEN_MS)
  const service = createServiceClient()

  let conTabla = true
  let conMarca = true
  const filas: Array<{ asin: string; url: string | null; leida_at: string; marca?: string | null; marca_leida?: boolean }> = []
  for (let i = 0; i < asins.length; i += 150) {
    const trozo = asins.slice(i, i + 150)
    let r = await service.from('producto_imagenes').select('asin, url, leida_at, marca, marca_leida').eq('marketplace_id', marketplaceId).in('asin', trozo)
    if (r.error && isMissingSchema(r.error)) {
      conMarca = false
      r = (await service.from('producto_imagenes').select('asin, url, leida_at').eq('marketplace_id', marketplaceId).in('asin', trozo)) as typeof r
    }
    if (r.error) {
      if (!isMissingSchema(r.error)) throw r.error
      conTabla = false
      break
    }
    filas.push(...((r.data ?? []) as typeof filas))
  }
  for (const f of filas) {
    if (!vigente(f.url, Date.parse(f.leida_at))) continue
    if (opciones.necesitaMarca && !f.marca_leida) continue
    salida[f.asin] = { url: f.url, marca: f.marca ?? null }
  }
  for (const a of asins) {
    const m = memoria.get(clave(marketplaceId, a))
    if (!(a in salida) && m && vigente(m.url, m.at) && (!opciones.necesitaMarca || m.marca !== undefined)) salida[a] = { url: m.url, marca: m.marca ?? null }
  }

  const faltan = asins.filter((a) => !(a in salida))
  if (faltan.length === 0) return salida
  const conexion = await conexionPara(marketplaceId, opciones.connectionId)
  const resuelta = conexion ? await connectionCredentials(conexion) : null
  if (!resuelta) {
    for (const a of faltan) salida[a] = { url: null, marca: null }
    return salida
  }
  const nuevas: Array<Record<string, unknown>> = []
  for (let i = 0; i < faltan.length; i += 20) {
    const tanda = faltan.slice(i, i + 20)
    try {
      const { data: r } = await spApiRequest<{ items?: Array<Record<string, unknown>> }>(resuelta.credentials, 'searchCatalogItems', {
        method: 'GET',
        path: '/catalog/2022-04-01/items',
        query: { identifiers: tanda, identifiersType: 'ASIN', marketplaceIds: [marketplaceId], includedData: ['images', 'summaries'], pageSize: 20 },
      })
      const porAsin = new Map<string, DatoDeCatalogo>()
      for (const item of r.items ?? []) if (typeof item.asin === 'string') porAsin.set(item.asin, { url: principalDe(item, marketplaceId), marca: marcaDe(item, marketplaceId) })
      for (const a of tanda) {
        const d = porAsin.get(a) ?? { url: null, marca: null }
        salida[a] = d
        memoria.set(clave(marketplaceId, a), { url: d.url, marca: d.marca, at: ahora })
        nuevas.push({ marketplace_id: marketplaceId, asin: a, url: d.url, leida_at: new Date(ahora).toISOString(), ...(conMarca ? { marca: d.marca, marca_leida: true } : {}) })
      }
    } catch (e) {
      // Un fallo de Amazon no rompe la pantalla: sin imagen esta vez, y no se guarda (se vuelve a pedir la próxima)
      console.error('Catálogo de producto:', e instanceof Error ? e.message : e)
      for (const a of tanda) salida[a] = { url: null, marca: null }
    }
  }
  if (conTabla && nuevas.length > 0) {
    const { error: e } = await service.from('producto_imagenes').upsert(nuevas, { onConflict: 'marketplace_id,asin' })
    if (e && !isMissingSchema(e)) console.error('Imágenes de producto: guardar:', e.message)
  }
  return salida
}
