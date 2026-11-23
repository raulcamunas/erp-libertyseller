/**
 * SEO · LOS CSV DE HELIUM 10 DE UN PRODUCTO: GUARDARLOS CON SU FECHA Y CRUZARLOS CON BRAND ANALYTICS. SOLO SERVIDOR. No toca Amazon.
 *
 * El CSV se lee en el navegador (lib/ads/helium10.ts) y llega como filas. Cada subida es una importación (seo_helium_importaciones, migración 312) con
 * sus palabras (seo_helium_keywords). Para cruzar se usan la última de Cerebro/Magnet y la última del Keyword Tracker de ese producto.
 */

import { fichasGuardadas } from './datos'
import { decisionesDeBusquedas } from './ajenas-servidor'
import { revisarPalabrasConIa } from './helium-ia'
import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import type { TextosDeFicha } from './cobertura'
import { cruzarConBrandAnalytics, juntarImportaciones, type KeywordCruzada, type KeywordH10 } from './helium'

export type TipoImportacion = 'cerebro' | 'magnet' | 'keyword_tracker'

export interface Importacion {
  id: string
  tipo: TipoImportacion
  fichero: string | null
  filas: number
  asinsRivales: string[]
  subidoAt: string
  subidoPor: string | null
}

export interface FilaRecibida {
  keyword: string
  volumen?: number | null
  cerebroIq?: number | null
  tendencia?: number | null
  competidores?: number | null
  densidad?: number | null
  pujaSugerida?: number | null
  rangoOrganico?: number | null
  rangoPatrocinado?: number | null
  rangosRivales?: Record<string, number>
}

const MAX_FILAS = 5000
const entero = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : null)
const decimal = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : null)

/** Guarda una importación con sus palabras. Devuelve su id */
export async function guardarImportacion(c: { connectionId: string; marketplaceId: string }, e: { asin: string; tipo: TipoImportacion; fichero: string | null; filas: readonly FilaRecibida[]; asinsRivales: string[]; userId: string }): Promise<{ id: string; filas: number }> {
  const service = createServiceClient()
  const unicas = [...new Map(e.filas.filter((f) => typeof f.keyword === 'string' && f.keyword.trim()).map((f) => [f.keyword.trim().toLowerCase().slice(0, 200), f])).entries()].slice(0, MAX_FILAS)
  if (unicas.length === 0) throw new Error('El fichero no trae ninguna palabra.')
  const { data, error } = await service
    .from('seo_helium_importaciones')
    .insert({ connection_id: c.connectionId, marketplace_id: c.marketplaceId, asin: e.asin, tipo: e.tipo, fichero: e.fichero?.slice(0, 200) ?? null, filas: unicas.length, asins_rivales: e.asinsRivales.filter((a) => /^[A-Z0-9]{10}$/.test(a)).slice(0, 30), subido_por: e.userId })
    .select('id')
    .single()
  if (error) throw error
  const id = String((data as { id: string }).id)
  const registros = unicas.map(([keyword, f]) => ({
    importacion_id: id,
    keyword,
    volumen: entero(f.volumen),
    cerebro_iq: decimal(f.cerebroIq),
    tendencia: decimal(f.tendencia),
    competidores: entero(f.competidores),
    densidad: entero(f.densidad),
    puja_sugerida: decimal(f.pujaSugerida),
    rango_organico: entero(f.rangoOrganico),
    rango_patrocinado: entero(f.rangoPatrocinado),
    rangos_rivales: f.rangosRivales && typeof f.rangosRivales === 'object' ? Object.fromEntries(Object.entries(f.rangosRivales).filter(([k, v]) => /^[A-Z0-9]{10}$/.test(k) && typeof v === 'number').slice(0, 30)) : {},
  }))
  for (let i = 0; i < registros.length; i += 1000) {
    const { error: e2 } = await service.from('seo_helium_keywords').insert(registros.slice(i, i + 1000))
    if (e2) {
      // Sin palabras, la importación no sirve: se quita para no dejarla a medias
      await service.from('seo_helium_importaciones').delete().eq('id', id)
      throw e2
    }
  }
  return { id, filas: registros.length }
}

export async function borrarImportacion(c: { connectionId: string; marketplaceId: string }, id: string): Promise<void> {
  const { error } = await createServiceClient().from('seo_helium_importaciones').delete().eq('id', id).eq('connection_id', c.connectionId).eq('marketplace_id', c.marketplaceId)
  if (error) throw error
}

async function keywordsDe(importacionId: string): Promise<KeywordH10[]> {
  const salida: KeywordH10[] = []
  for (let i = 0; i < MAX_FILAS; i += 1000) {
    const { data, error } = await createServiceClient().from('seo_helium_keywords').select('keyword, volumen, cerebro_iq, tendencia, competidores, densidad, puja_sugerida, rango_organico, rango_patrocinado, rangos_rivales').eq('importacion_id', importacionId).range(i, i + 999)
    if (error) throw error
    for (const r of (data ?? []) as Array<Record<string, unknown>>)
      salida.push({
        keyword: String(r.keyword),
        volumen: (r.volumen as number | null) ?? null,
        cerebroIq: r.cerebro_iq == null ? null : Number(r.cerebro_iq),
        tendencia: r.tendencia == null ? null : Number(r.tendencia),
        competidores: (r.competidores as number | null) ?? null,
        densidad: (r.densidad as number | null) ?? null,
        pujaSugerida: r.puja_sugerida == null ? null : Number(r.puja_sugerida),
        rangoOrganico: (r.rango_organico as number | null) ?? null,
        rangoPatrocinado: (r.rango_patrocinado as number | null) ?? null,
        rangosRivales: (r.rangos_rivales as Record<string, number>) ?? {},
      })
    if (!data || data.length < 1000) break
  }
  return salida
}

/** Las búsquedas de Brand Analytics donde ya aparece el producto (los últimos ~100 días, mes y semana) */
async function consultasDelProducto(c: { connectionId: string; marketplaceId: string }, asin: string): Promise<string[]> {
  const desde = new Date(Date.now() - 100 * 86_400_000).toISOString().slice(0, 10)
  const salida = new Set<string>()
  for (let i = 0; i < 10_000; i += 1000) {
    const { data, error } = await createServiceClient().from('seo_consultas').select('consulta').eq('connection_id', c.connectionId).eq('marketplace_id', c.marketplaceId).eq('asin', asin).gte('desde', desde).range(i, i + 999)
    if (error) throw error
    for (const r of (data ?? []) as Array<{ consulta: string }>) salida.add(r.consulta)
    if (!data || data.length < 1000) break
  }
  return [...salida]
}

async function fichaDe(c: { connectionId: string; marketplaceId: string }, asin: string): Promise<TextosDeFicha | null> {
  // Con los Item Highlights (de Amazon o puestos a mano, migración 334): una palabra que está ahí no «falta en la ficha»
  const f = (await fichasGuardadas(c.connectionId, c.marketplaceId)).find((x) => x.asin === asin)
  if (!f) return null
  return { titulo: f.titulo, bullets: f.bullets, descripcion: f.descripcion, backend: f.backend, highlights: f.highlights ?? null }
}

export interface DatosDeHelium {
  importaciones: Importacion[]
  palabras: KeywordCruzada[]
  /** Cuántas búsquedas de Brand Analytics tiene el producto (para decir si el cruce vale) */
  busquedasBA: number
  sinMigracion?: boolean
}

/** Todo lo de Helium 10 de un producto, cruzado con Brand Analytics y con su ficha */
export async function heliumDe(c: { connectionId: string; marketplaceId: string }, asin: string): Promise<DatosDeHelium> {
  const service = createServiceClient()
  const { data, error } = await service.from('seo_helium_importaciones').select('id, tipo, fichero, filas, asins_rivales, subido_at, subido_por').eq('connection_id', c.connectionId).eq('marketplace_id', c.marketplaceId).eq('asin', asin).order('subido_at', { ascending: false }).limit(20)
  if (error) {
    if (isMissingSchema(error)) return { importaciones: [], palabras: [], busquedasBA: 0, sinMigracion: true }
    throw error
  }
  const filas = (data ?? []) as Array<Record<string, unknown>>
  const ids = [...new Set(filas.map((f) => f.subido_por).filter((x): x is string => typeof x === 'string'))]
  const { data: perfiles } = ids.length > 0 ? await service.from('profiles').select('id, full_name').in('id', ids) : { data: [] }
  const nombres = new Map(((perfiles ?? []) as Array<{ id: string; full_name: string | null }>).map((p) => [p.id, p.full_name ?? 'alguien del equipo']))
  const importaciones: Importacion[] = filas.map((f) => ({ id: String(f.id), tipo: f.tipo as TipoImportacion, fichero: (f.fichero as string | null) ?? null, filas: Number(f.filas ?? 0), asinsRivales: (f.asins_rivales as string[]) ?? [], subidoAt: String(f.subido_at), subidoPor: typeof f.subido_por === 'string' ? (nombres.get(f.subido_por) ?? null) : null }))

  const cerebro = importaciones.find((i) => i.tipo === 'cerebro' || i.tipo === 'magnet')
  const tracker = importaciones.find((i) => i.tipo === 'keyword_tracker')
  if (!cerebro && !tracker) return { importaciones, palabras: [], busquedasBA: 0 }
  const [kc, kt, consultas, ficha, dec] = await Promise.all([
    cerebro ? keywordsDe(cerebro.id) : [],
    tracker ? keywordsDe(tracker.id) : [],
    consultasDelProducto(c, asin),
    fichaDe(c, asin),
    decisionesDeBusquedas(c.connectionId, c.marketplaceId).catch(() => ({ ajenas: [] as string[], nuestras: [] as string[], disponible: false })),
  ])
  const juntas = juntarImportaciones(kc, kt)
  const cruzar = (d: { ajenas: string[]; nuestras: string[] }) => cruzarConBrandAnalytics(juntas, consultas, ficha, { ajenas: new Set(d.ajenas), nuestras: new Set(d.nuestras) })
  let palabras = cruzar(dec)
  // Las oportunidades sin decidir las mira la IA (¿son de este producto?): las de otro producto o de otra marca salen de la lista y de la propuesta
  if (dec.disponible && ficha) {
    const sinDecidir = palabras.filter((p) => p.oportunidad > 0 && p.decision == null).map((p) => p.keyword)
    if (sinDecidir.length > 0) {
      try {
        const n = await revisarPalabrasConIa(c, asin, { titulo: ficha.titulo, bullets: ficha.bullets }, sinDecidir)
        if (n > 0) palabras = cruzar(await decisionesDeBusquedas(c.connectionId, c.marketplaceId))
      } catch (e) {
        console.error('SEO: revisar las palabras de Helium 10 con la IA:', e instanceof Error ? e.message : e)
      }
    }
  }
  return { importaciones, palabras, busquedasBA: consultas.length }
}
