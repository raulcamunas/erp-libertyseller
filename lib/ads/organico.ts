import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { marketplaceDePais } from './cuenta'
import { todasLasFilas } from './paginar'
import { cuotaOrganica, normalizarConsulta, type CuotaOrganica } from './organico-calculo'

/**
 * AMAZON ADS · LO ORGÁNICO DE CADA BÚSQUEDA (SOLO SERVIDOR). Las reglas están en organico-calculo.ts.
 *
 * Por producto y búsqueda, las últimas 4 semanas cerradas de Brand Analytics (seo_consultas, semanales) menos los clics y pedidos de publicidad en ese término
 * en las mismas semanas (ads_terminos_semana, por campaña → producto por su nombre). Sin Brand Analytics (sin marca registrada, o el SEO sin leer) devuelve
 * vacío y no se propone nada.
 */

const DIA = 86_400_000

export async function cuotasOrganicasDeCuenta(perfilId: string, asinDeCampana: ReadonlyMap<string, string>): Promise<Map<string, Map<string, CuotaOrganica>>> {
  const salida = new Map<string, Map<string, CuotaOrganica>>()
  const asins = [...new Set([...asinDeCampana.values()].map((a) => a.toUpperCase()))]
  if (asins.length === 0) return salida
  const service = createServiceClient()
  const { data: perfil, error: ePerfil } = await service.from('ads_profiles').select('pais, ads_connections(client_id)').eq('id', perfilId).maybeSingle()
  if (ePerfil) throw ePerfil
  const p = perfil as { pais: string | null; ads_connections: { client_id: string | null } | Array<{ client_id: string | null }> | null } | null
  const con = Array.isArray(p?.ads_connections) ? p?.ads_connections[0] : p?.ads_connections
  const mk = p?.pais ? marketplaceDePais(String(p.pais).toUpperCase()) : null
  if (!con?.client_id || !mk) return salida
  const { data: conexiones, error: eCon } = await service.from('amazon_connections').select('id').eq('client_id', con.client_id).eq('is_active', true)
  if (eCon) throw eCon
  const ids = ((conexiones ?? []) as Array<{ id: string }>).map((c) => c.id)
  if (ids.length === 0) return salida

  const desde = new Date(Date.now() - 35 * DIA).toISOString().slice(0, 10)
  const sqp = await todasLasFilas<Record<string, unknown>>(
    (a, b) =>
      service
        .from('seo_consultas')
        .select('asin, consulta, desde, hasta, clics_total, clics_asin, compras_asin')
        .in('connection_id', ids)
        .eq('marketplace_id', mk)
        .eq('periodo', 'WEEK')
        .gte('desde', desde)
        .in('asin', asins)
        .order('asin')
        .order('desde')
        .order('consulta')
        .range(a, b) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: { code?: string; message?: string } | null }>,
    50_000,
  )
  if (sqp.error) {
    if (isMissingSchema(sqp.error as { code?: string; message?: string })) return salida
    throw sqp.error
  }
  if (sqp.data.length === 0) return salida
  // Las semanas que hay en Brand Analytics: lo de publicidad se suma en ese mismo tramo
  let min = '9999-12-31'
  let max = '0000-01-01'
  const suma = new Map<string, { clicsTotal: number; clicsAsin: number; comprasAsin: number }>()
  for (const r of sqp.data) {
    const k = `${String(r.asin).toUpperCase()}|${normalizarConsulta(String(r.consulta ?? ''))}`
    const x = suma.get(k) ?? { clicsTotal: 0, clicsAsin: 0, comprasAsin: 0 }
    x.clicsTotal += Number(r.clics_total ?? 0) || 0
    x.clicsAsin += Number(r.clics_asin ?? 0) || 0
    x.comprasAsin += Number(r.compras_asin ?? 0) || 0
    suma.set(k, x)
    if (String(r.desde) < min) min = String(r.desde)
    if (String(r.hasta ?? r.desde) > max) max = String(r.hasta ?? r.desde)
  }

  const ads = await todasLasFilas<Record<string, unknown>>(
    (a, b) =>
      service
        .from('ads_terminos_semana')
        .select('campaign_id, termino, clics, pedidos')
        .eq('perfil_id', perfilId)
        .gte('semana', min)
        .lte('semana', max)
        .order('semana')
        .order('campaign_id')
        .order('termino')
        .range(a, b) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: { code?: string; message?: string } | null }>,
    100_000,
  )
  if (ads.error && !isMissingSchema(ads.error as { code?: string; message?: string })) throw ads.error
  const porTermino = new Map<string, { clics: number; pedidos: number }>()
  for (const r of ads.data ?? []) {
    const asin = asinDeCampana.get(String(r.campaign_id))
    if (!asin) continue
    const k = `${asin.toUpperCase()}|${normalizarConsulta(String(r.termino ?? ''))}`
    const x = porTermino.get(k) ?? { clics: 0, pedidos: 0 }
    x.clics += Number(r.clics ?? 0) || 0
    x.pedidos += Number(r.pedidos ?? 0) || 0
    porTermino.set(k, x)
  }
  for (const [k, s] of suma) {
    const [asin, consulta] = k.split('|')
    const m = salida.get(asin) ?? new Map<string, CuotaOrganica>()
    m.set(consulta, cuotaOrganica(s, porTermino.get(k) ?? { clics: 0, pedidos: 0 }))
    salida.set(asin, m)
  }
  return salida
}
