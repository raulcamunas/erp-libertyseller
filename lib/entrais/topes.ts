/**
 * ENTRAIS · TOPE DE UNIDADES POR PRODUCTO. SOLO SERVIDOR.
 *
 * Un producto con tope se publica, en Amazon y en PcComponentes, con como mucho «tope − lo vendido desde `desde`»
 * (los dos canales juntos), hasta `hasta` incluido. Pasada la fecha, vuelve al stock del proveedor sin tocar nada.
 *
 * Si no se pueden leer las ventas, el producto con tope se publica a 0: vender de más a un precio que ya no es el de
 * la oferta cuesta dinero; no vender un rato, no.
 */
import 'server-only'
import { createServiceClient } from '@/lib/supabase/service'
import { ventasDe } from '@/lib/pccomponentes/ventas-servidor'

export const CONEXION_ENTRAIS = '2549d0c9-1ee1-49db-a943-bbf1615fda9e'

export interface Tope {
  sku: string
  unidades: number
  desde: string
  hasta: string
  nota: string | null
}

export interface EstadoTope extends Tope {
  vigente: boolean
  amazon: number | null
  pcc: number | null
  /** Lo que se puede publicar como mucho ahora (null si el tope no está vigente) */
  quedan: number | null
}

const CANCELADOS_PCC = new Set(['REFUSED', 'CANCELED', 'CLOSED_CANCELED'])

const hoyEnMadrid = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())

let cache: { at: number; valor: Map<string, number> } | null = null

export async function leerTopes(): Promise<Tope[]> {
  const { data, error } = await createServiceClient().from('entrais_topes').select('sku, unidades, desde, hasta, nota').order('hasta', { ascending: false })
  // Sin la tabla (migración 350 sin lanzar) no hay topes
  if (error) return []
  return (data ?? []).map((t) => ({ ...t, unidades: Number(t.unidades) })) as Tope[]
}

/** Unidades vendidas de cada SKU con tope desde su fecha, por canal */
async function vendidas(topes: readonly Tope[]): Promise<{ amazon: Map<string, number>; pcc: Map<string, number> }> {
  const amazon = new Map<string, number>()
  const pcc = new Map<string, number>()
  if (topes.length === 0) return { amazon, pcc }
  const desde = topes.reduce((m, t) => (t.desde < m ? t.desde : m), topes[0].desde)
  const hoy = hoyEnMadrid()
  const porSku = new Map(topes.map((t) => [t.sku, t]))

  const s = createServiceClient()
  const { data, error } = await s.from('ventas_lineas').select('sku, dia, estado, unidades').eq('connection_id', CONEXION_ENTRAIS).in('sku', [...porSku.keys()]).gte('dia', desde)
  if (error) throw new Error(`No se pudieron leer las ventas de Amazon: ${error.message}`)
  for (const l of data ?? []) {
    const t = porSku.get(l.sku)
    if (!t || l.dia < t.desde || String(l.estado ?? '').toLowerCase() === 'cancelled') continue
    amazon.set(l.sku, (amazon.get(l.sku) ?? 0) + Number(l.unidades ?? 0))
  }

  // En PcComponentes el código de la oferta a veces es el EAN
  const { data: eans } = await s.from('entrais_precios').select('sku, ean').in('sku', [...porSku.keys()])
  const deEan = new Map((eans ?? []).filter((e) => e.ean).map((e) => [String(e.ean), e.sku as string]))
  const { lineas } = await ventasDe(`${desde}T00:00:00Z`, `${hoy}T23:59:59Z`)
  for (const l of lineas) {
    const sku = porSku.has(l.sku) ? l.sku : deEan.get(l.sku)
    const t = sku ? porSku.get(sku) : undefined
    if (!sku || !t || l.fecha.slice(0, 10) < t.desde || CANCELADOS_PCC.has(l.estado)) continue
    pcc.set(sku, (pcc.get(sku) ?? 0) + l.unidades)
  }
  return { amazon, pcc }
}

/** Cómo va cada tope (para la pantalla) */
export async function estadoDeTopes(): Promise<EstadoTope[]> {
  const topes = await leerTopes()
  const hoy = hoyEnMadrid()
  const vigentes = topes.filter((t) => t.desde <= hoy && hoy <= t.hasta)
  let v: Awaited<ReturnType<typeof vendidas>> | null = null
  try {
    v = await vendidas(vigentes)
  } catch {
    v = null
  }
  return topes.map((t) => {
    const vigente = t.desde <= hoy && hoy <= t.hasta
    const amazon = v ? v.amazon.get(t.sku) ?? 0 : null
    const pcc = v ? v.pcc.get(t.sku) ?? 0 : null
    const quedan = !vigente ? null : amazon === null || pcc === null ? 0 : Math.max(0, t.unidades - amazon - pcc)
    return { ...t, vigente, amazon, pcc, quedan }
  })
}

/**
 * Lo máximo que se puede publicar ahora de cada SKU con tope vigente. Los SKU sin tope no están en el mapa.
 * Se guarda 2 minutos: lo llaman el ciclo de stock de Amazon y la pasada de PcComponentes.
 */
export async function maximosPorTope(): Promise<Map<string, number>> {
  if (cache && Date.now() - cache.at < 2 * 60_000) return cache.valor
  const hoy = hoyEnMadrid()
  const vigentes = (await leerTopes()).filter((t) => t.desde <= hoy && hoy <= t.hasta)
  const valor = new Map<string, number>()
  if (vigentes.length) {
    try {
      const v = await vendidas(vigentes)
      for (const t of vigentes) valor.set(t.sku, Math.max(0, t.unidades - (v.amazon.get(t.sku) ?? 0) - (v.pcc.get(t.sku) ?? 0)))
    } catch {
      for (const t of vigentes) valor.set(t.sku, 0)
    }
  }
  cache = { at: Date.now(), valor }
  return valor
}

export function olvidarTopes() {
  cache = null
}

export function conTope(sku: string, stock: number, maximos: Map<string, number>): number {
  const m = maximos.get(sku)
  return m === undefined ? stock : Math.min(stock, m)
}
