/**
 * SEO · LO QUE SE LEE DE MARKETING TEST (SOLO SERVIDOR, SOLO LECTURA). Desde SEO Test no se escribe nada en Amazon Ads.
 *
 * Une la cuenta de vendedor con las cuentas de anunciante del MISMO cliente y país (como productosDeMarketingTest). Las campañas de un producto son las que llevan su ASIN en el nombre: es la
 * nomenclatura de Marketing Test («ASIN | SKU | RESUMEN | ESTRATEGIA») y la que se usa para agrupar en su pantalla.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { normalizar } from './cobertura'
import type { TerminoDeAds } from './publicidad-calculo'

export async function perfilesAdsDe(clientId: string, pais: string): Promise<string[]> {
  const service = createServiceClient()
  const { data: conexiones } = await service.from('ads_connections').select('id').eq('client_id', clientId)
  const ids = ((conexiones ?? []) as Array<{ id: string }>).map((c) => c.id)
  if (ids.length === 0) return []
  const { data: perfiles } = await service.from('ads_profiles').select('id').in('connection_id', ids).eq('pais', pais === 'GB' ? 'UK' : pais)
  return ((perfiles ?? []) as Array<{ id: string }>).map((p) => p.id)
}

/** Los términos de búsqueda de las campañas del producto (los últimos que leyó el motor de Marketing Test) */
export async function terminosDeAdsDelAsin(perfilIds: readonly string[], asin: string): Promise<TerminoDeAds[]> {
  if (perfilIds.length === 0) return []
  const { data, error } = await createServiceClient()
    .from('ads_terminos')
    .select('termino, pedidos, ventas, clics, gasto')
    .in('perfil_id', [...perfilIds])
    .ilike('campaign_nombre', `%${asin}%`)
    .gt('clics', 0)
    .limit(5000)
  if (error) {
    if (isMissingSchema(error)) return []
    throw error
  }
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({ termino: String(r.termino), pedidos: Number(r.pedidos) || 0, ventas: Number(r.ventas) || 0, clics: Number(r.clics) || 0, gasto: Number(r.gasto) || 0 }))
}

/** Las keywords por las que ya pujan las campañas del producto: las EXACTAS y las demás (amplia y frase), normalizadas */
export async function keywordsDelAsin(perfilIds: readonly string[], asin: string): Promise<{ exactas: Set<string>; otras: Set<string>; campanas: number }> {
  const exactas = new Set<string>()
  const otras = new Set<string>()
  if (perfilIds.length === 0) return { exactas, otras, campanas: 0 }
  const service = createServiceClient()
  const hace45 = new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10)
  const { data: camp, error: e1 } = await service.from('ads_rendimiento_diario').select('campaign_id').in('perfil_id', [...perfilIds]).ilike('nombre', `%${asin}%`).gte('fecha', hace45).limit(5000)
  if (e1 && !isMissingSchema(e1)) throw e1
  const campanas = [...new Set(((camp ?? []) as Array<{ campaign_id: string }>).map((c) => c.campaign_id))]
  const anotar = (texto: string | null, coincidencia: string | null) => {
    const k = normalizar(texto ?? '')
    if (!k) return
    if ((coincidencia ?? '').toUpperCase() === 'EXACT') exactas.add(k)
    else if (['BROAD', 'PHRASE'].includes((coincidencia ?? '').toUpperCase())) otras.add(k)
  }
  if (campanas.length > 0) {
    // Las segmentaciones de Marketing Test (migración 298), si está
    const { data: obj, error: e2 } = await service.from('ads_objetivos_diario').select('texto, coincidencia').in('perfil_id', [...perfilIds]).in('campaign_id', campanas.slice(0, 300)).gte('fecha', hace45).limit(10000)
    if (e2 && !isMissingSchema(e2)) throw e2
    for (const o of (obj ?? []) as Array<{ texto: string | null; coincidencia: string | null }>) anotar(o.texto, o.coincidencia)
  }
  // Y las keywords que aparecen en el informe de términos de búsqueda
  const { data: ter, error: e3 } = await service.from('ads_terminos').select('keyword, match_type').in('perfil_id', [...perfilIds]).ilike('campaign_nombre', `%${asin}%`).not('keyword', 'is', null).limit(5000)
  if (e3 && !isMissingSchema(e3)) throw e3
  for (const t of (ter ?? []) as Array<{ keyword: string | null; match_type: string | null }>) anotar(t.keyword, t.match_type)
  return { exactas, otras, campanas: campanas.length }
}
