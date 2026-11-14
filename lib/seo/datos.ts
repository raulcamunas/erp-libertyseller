/**
 * SEO TEST · LOS DATOS DE LA PANTALLA (SOLO SERVIDOR): clientes y países, productos seguidos, búsquedas de Brand Analytics y fichas.
 *
 * Una «cuenta» aquí es una conexión de vendedor de Amazon + un marketplace (un país). Todo cuelga de ella: no hay lecturas que mezclen clientes.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { AMAZON_MARKETPLACES, mercadosDeConexion } from '@/lib/types/amazon'
import type { EstadoSeo } from './lectura'

export interface CuentaDeSeo {
  /** «connectionId~marketplaceId»: el identificador que viaja por la dirección y las rutas */
  id: string
  connectionId: string
  marketplaceId: string
  pais: string
  moneda: string | null
  nombre: string | null
}

export const idDeCuenta = (connectionId: string, marketplaceId: string) => `${connectionId}~${marketplaceId}`
export function partirIdDeCuenta(id: string): { connectionId: string; marketplaceId: string } | null {
  const [connectionId, marketplaceId] = id.split('~')
  if (!connectionId || !marketplaceId || !/^[0-9a-f-]{36}$/i.test(connectionId) || !/^[A-Z0-9]{8,20}$/.test(marketplaceId)) return null
  return { connectionId, marketplaceId }
}

/** Las cuentas (conexión × país) de varios clientes de una vez, con España primero */
export async function cuentasSeoDeClientes(amazonClientIds: readonly string[]): Promise<Map<string, CuentaDeSeo[]>> {
  const salida = new Map<string, CuentaDeSeo[]>(amazonClientIds.map((id) => [id, []]))
  if (amazonClientIds.length === 0) return salida
  const { data, error } = await createServiceClient().from('amazon_connections').select('id, client_id, name, marketplace_ids, marketplaces_activos').in('client_id', [...amazonClientIds]).eq('is_active', true).eq('status', 'activa')
  if (error) throw error
  for (const c of (data ?? []) as Array<{ id: string; client_id: string; name: string | null; marketplace_ids: string[]; marketplaces_activos: string[] | null }>) {
    for (const m of mercadosDeConexion(c)) {
      const mk = AMAZON_MARKETPLACES.find((x) => x.id === m)
      if (!mk) continue
      salida.get(c.client_id)?.push({ id: idDeCuenta(c.id, m), connectionId: c.id, marketplaceId: m, pais: mk.countryCode, moneda: mk.currency, nombre: c.name })
    }
  }
  for (const lista of salida.values()) lista.sort((a, b) => Number(b.pais === 'ES') - Number(a.pais === 'ES') || a.pais.localeCompare(b.pais))
  return salida
}

/** El cliente (amazon_clients) de una conexión: para comprobar que la cuenta pedida existe y está activa */
export async function conexionActiva(connectionId: string): Promise<{ clientId: string; marketplaces: string[] } | null> {
  const { data, error } = await createServiceClient().from('amazon_connections').select('client_id, marketplace_ids, marketplaces_activos, is_active, status').eq('id', connectionId).maybeSingle()
  if (error) throw error
  const c = data as { client_id: string; marketplace_ids: string[]; marketplaces_activos: string[] | null; is_active: boolean; status: string } | null
  if (!c || !c.is_active || c.status !== 'activa') return null
  return { clientId: c.client_id, marketplaces: mercadosDeConexion(c) }
}

/* ------------------------------------------------------------------ */
/* Productos seguidos                                                  */
/* ------------------------------------------------------------------ */

export interface ProductoSeguido {
  id: string
  asin: string
  sku: string | null
  nombre: string | null
}

export async function productosSeguidos(connectionId: string, marketplaceId: string): Promise<ProductoSeguido[]> {
  const { data, error } = await createServiceClient().from('seo_productos').select('id, asin, sku, nombre').eq('connection_id', connectionId).eq('marketplace_id', marketplaceId).order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as ProductoSeguido[]
}

export async function seguirProductos(connectionId: string, marketplaceId: string, productos: ReadonlyArray<{ asin: string; sku: string | null; nombre: string | null }>, userId: string): Promise<number> {
  const filas = productos
    .map((p) => ({ connection_id: connectionId, marketplace_id: marketplaceId, asin: p.asin.trim().toUpperCase(), sku: p.sku?.trim() || null, nombre: p.nombre?.trim().slice(0, 200) || null, created_by: userId }))
    .filter((p) => /^[A-Z0-9]{10}$/.test(p.asin))
  if (filas.length === 0) return 0
  // Lo que viene de Marketing Test puede no traer SKU, y sin SKU la ficha no se lee nunca: se completa con el catálogo de la cuenta en ese país
  const sinSku = filas.filter((f) => !f.sku).map((f) => f.asin)
  if (sinSku.length > 0) {
    const skus = await skusDelCatalogo(connectionId, marketplaceId, sinSku)
    for (const f of filas) if (!f.sku) f.sku = skus.get(f.asin) ?? null
  }
  const { data, error } = await createServiceClient().from('seo_productos').upsert(filas, { onConflict: 'connection_id,marketplace_id,asin', ignoreDuplicates: true }).select('id')
  if (error) throw error
  return data?.length ?? 0
}

/**
 * El SKU de cada ASIN según el catálogo de la cuenta en ese país (amazon_listings). Si un ASIN tiene varios SKU, gana el que se puede comprar (BUYABLE): es el que lleva la ficha que ve el cliente.
 */
export async function skusDelCatalogo(connectionId: string, marketplaceId: string, asins: readonly string[]): Promise<Map<string, string>> {
  const salida = new Map<string, string>()
  if (asins.length === 0) return salida
  const { data, error } = await createServiceClient().from('amazon_listings').select('sku, asin, listing_status').eq('connection_id', connectionId).eq('marketplace_id', marketplaceId).in('asin', [...asins])
  if (error) throw error
  const filas = ((data ?? []) as Array<{ sku: string; asin: string; listing_status: string[] | null }>).sort((a, b) => Number((b.listing_status ?? []).includes('BUYABLE')) - Number((a.listing_status ?? []).includes('BUYABLE')))
  for (const f of filas) if (f.asin && !salida.has(f.asin.toUpperCase())) salida.set(f.asin.toUpperCase(), f.sku)
  return salida
}

/** El precio de cada ASIN en el catálogo de la cuenta (amazon_listings): es «nuestro precio» para saber si una búsqueda compra a otro precio (falso amigo) */
export async function preciosDeListings(connectionId: string, marketplaceId: string, asins: readonly string[]): Promise<Record<string, number | null>> {
  const salida: Record<string, number | null> = {}
  if (asins.length === 0) return salida
  const { data, error } = await createServiceClient().from('amazon_listings').select('asin, price, listing_status').eq('connection_id', connectionId).eq('marketplace_id', marketplaceId).in('asin', [...asins])
  if (error) throw error
  // Con varios SKU del mismo ASIN, el del que se puede comprar
  const filas = ((data ?? []) as Array<{ asin: string; price: number | string | null; listing_status: string[] | null }>).sort((a, b) => Number((b.listing_status ?? []).includes('BUYABLE')) - Number((a.listing_status ?? []).includes('BUYABLE')))
  for (const f of filas) {
    const k = f.asin?.toUpperCase()
    const precio = f.price == null ? null : Number(f.price)
    if (k && salida[k] == null && precio != null && precio > 0) salida[k] = precio
  }
  return salida
}

/** Las propuestas de ficha que ya se aplicaron en Amazon (para la ventana de 30 días del SOP). [] si falta la migración 299 */
export async function cambiosAplicados(connectionId: string, marketplaceId: string): Promise<Array<{ asin: string; aplicadaAt: string }>> {
  const { data, error } = await createServiceClient().from('seo_propuestas').select('asin, aplicada_at').eq('connection_id', connectionId).eq('marketplace_id', marketplaceId).eq('estado', 'aplicada').not('aplicada_at', 'is', null).order('aplicada_at', { ascending: false }).limit(200)
  if (error) {
    if (isMissingSchema(error)) return []
    throw error
  }
  return ((data ?? []) as Array<{ asin: string; aplicada_at: string }>).map((r) => ({ asin: r.asin, aplicadaAt: r.aplicada_at }))
}

export async function dejarDeSeguir(connectionId: string, marketplaceId: string, id: string): Promise<void> {
  const { error } = await createServiceClient().from('seo_productos').delete().eq('connection_id', connectionId).eq('marketplace_id', marketplaceId).eq('id', id)
  if (error) throw error
}

/** Los productos del catálogo de la cuenta (SP-API) en ese país, para elegir cuál seguir. `q` busca en SKU, ASIN y título */
export async function catalogoSeo(connectionId: string, marketplaceId: string, q: string): Promise<Array<{ sku: string; asin: string; titulo: string | null; seguido: boolean }>> {
  const service = createServiceClient()
  let consulta = service.from('amazon_listings').select('sku, asin, title, listing_status').eq('connection_id', connectionId).eq('marketplace_id', marketplaceId).not('asin', 'is', null).order('listing_status', { ascending: true }).limit(60)
  const termino = q.trim().replace(/[%,()]/g, ' ').slice(0, 60)
  if (termino) consulta = consulta.or(`sku.ilike.%${termino}%,asin.ilike.%${termino}%,title.ilike.%${termino}%`)
  const [{ data, error }, ya] = await Promise.all([consulta, productosSeguidos(connectionId, marketplaceId)])
  if (error) throw error
  const seguidos = new Set(ya.map((p) => p.asin))
  return ((data ?? []) as Array<{ sku: string; asin: string; title: string | null }>).map((l) => ({ sku: l.sku, asin: l.asin, titulo: l.title, seguido: seguidos.has(l.asin.toUpperCase()) }))
}

/**
 * Los productos que ya se trabajan en Marketing Test para el mismo cliente y país (con su SKU y su resumen), para traerlos de un clic. Une por el cliente de la conexión de Ads
 * (`ads_connections.client_id` = el cliente de esta conexión de vendedor) y por el país.
 */
export async function productosDeMarketingTest(clientId: string, pais: string): Promise<Array<{ asin: string; sku: string | null; nombre: string | null }>> {
  const service = createServiceClient()
  const { data: conexiones } = await service.from('ads_connections').select('id').eq('client_id', clientId)
  const ids = ((conexiones ?? []) as Array<{ id: string }>).map((c) => c.id)
  if (ids.length === 0) return []
  const paisAds = pais === 'GB' ? 'UK' : pais
  const { data: perfiles } = await service.from('ads_profiles').select('id').in('connection_id', ids).eq('pais', paisAds)
  const perfilIds = ((perfiles ?? []) as Array<{ id: string }>).map((p) => p.id)
  if (perfilIds.length === 0) return []
  const { data, error } = await service.from('ads_productos').select('asin, sku, resumen').in('perfil_id', perfilIds)
  if (error) return [] // sin la migración 292, simplemente no hay nada que traer
  return ((data ?? []) as Array<{ asin: string; sku: string | null; resumen: string | null }>).map((p) => ({ asin: p.asin, sku: p.sku, nombre: p.resumen }))
}

/* ------------------------------------------------------------------ */
/* Lo leído: búsquedas y fichas                                        */
/* ------------------------------------------------------------------ */

export interface ConsultaGuardada {
  asin: string
  periodo: 'WEEK' | 'MONTH'
  desde: string
  hasta: string
  consulta: string
  puntuacion: number | null
  volumen: number | null
  cuotaImpresiones: number | null
  cuotaClics: number | null
  cuotaCarritos: number | null
  cuotaCompras: number | null
  comprasAsin: number | null
  comprasTotal: number | null
  clicsAsin: number | null
  impresionesAsin: number | null
  /** Los totales de cada escalón (todo Amazon) y los carritos del producto: con ellos se diagnostica el embudo (lib/seo/embudo.ts) con recuentos, no solo con cuotas */
  impresionesTotal: number | null
  clicsTotal: number | null
  carritosTotal: number | null
  carritosAsin: number | null
  precioMedianoTotal: number | null
  precioMedianoAsin: number | null
}

const n = (v: unknown) => (v == null ? null : Number(v))

/** Las búsquedas guardadas de la cuenta en el ÚLTIMO periodo leído de cada tipo (el mes y la semana más recientes) */
export async function consultasGuardadas(connectionId: string, marketplaceId: string, periodo: 'WEEK' | 'MONTH'): Promise<ConsultaGuardada[]> {
  const service = createServiceClient()
  const { data: ultimo } = await service.from('seo_consultas').select('desde').eq('connection_id', connectionId).eq('marketplace_id', marketplaceId).eq('periodo', periodo).order('desde', { ascending: false }).limit(1).maybeSingle()
  const desde = (ultimo as { desde: string } | null)?.desde
  if (!desde) return []
  const salida: ConsultaGuardada[] = []
  for (let i = 0; i < 20_000; i += 1000) {
    const { data, error } = await service
      .from('seo_consultas')
      .select('asin, periodo, desde, hasta, consulta, puntuacion, volumen, cuota_impresiones, cuota_clics, cuota_carritos, cuota_compras, compras_asin, compras_total, clics_asin, impresiones_asin, impresiones_total, clics_total, carritos_total, carritos_asin, precio_mediano_total, precio_mediano_asin')
      .eq('connection_id', connectionId)
      .eq('marketplace_id', marketplaceId)
      .eq('periodo', periodo)
      .eq('desde', desde)
      .order('volumen', { ascending: false, nullsFirst: false })
      .range(i, i + 999)
    if (error) throw error
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      salida.push({
        asin: String(r.asin),
        periodo: r.periodo as 'WEEK' | 'MONTH',
        desde: String(r.desde),
        hasta: String(r.hasta),
        consulta: String(r.consulta),
        puntuacion: n(r.puntuacion),
        volumen: n(r.volumen),
        cuotaImpresiones: n(r.cuota_impresiones),
        cuotaClics: n(r.cuota_clics),
        cuotaCarritos: n(r.cuota_carritos),
        cuotaCompras: n(r.cuota_compras),
        comprasAsin: n(r.compras_asin),
        comprasTotal: n(r.compras_total),
        clicsAsin: n(r.clics_asin),
        impresionesAsin: n(r.impresiones_asin),
        impresionesTotal: n(r.impresiones_total),
        clicsTotal: n(r.clics_total),
        carritosTotal: n(r.carritos_total),
        carritosAsin: n(r.carritos_asin),
        precioMedianoTotal: n(r.precio_mediano_total),
        precioMedianoAsin: n(r.precio_mediano_asin),
      })
    }
    if (!data || data.length < 1000) break
  }
  return salida
}

export interface FichaGuardada {
  asin: string
  sku: string | null
  titulo: string | null
  bullets: string[]
  descripcion: string | null
  backend: string | null
  leidaAt: string
  /** El vigía de títulos (migración 304): el título de antes del último cambio detectado y cuándo. Sin la 304, no vienen */
  tituloAnterior?: string | null
  tituloCambiadoAt?: string | null
}

/** ¿Está la migración 304 (vigía de títulos)? Se pregunta una vez por proceso */
let hayVigia: boolean | null = null
export async function vigiaLanzado(): Promise<boolean> {
  if (hayVigia === true) return true
  const { error } = await createServiceClient().from('seo_fichas').select('titulo_anterior').limit(1)
  if (error && !isMissingSchema(error)) throw error
  hayVigia = !error
  return hayVigia
}

export async function fichasGuardadas(connectionId: string, marketplaceId: string): Promise<FichaGuardada[]> {
  const vigia = await vigiaLanzado().catch(() => false)
  const { data, error } = await createServiceClient()
    .from('seo_fichas')
    .select(`asin, sku, titulo, bullets, descripcion, backend, leida_at${vigia ? ', titulo_anterior, titulo_cambiado_at' : ''}`)
    .eq('connection_id', connectionId)
    .eq('marketplace_id', marketplaceId)
  if (error) throw error
  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((f) => ({
    asin: String(f.asin),
    sku: (f.sku as string | null) ?? null,
    titulo: (f.titulo as string | null) ?? null,
    bullets: Array.isArray(f.bullets) ? (f.bullets as string[]) : [],
    descripcion: (f.descripcion as string | null) ?? null,
    backend: (f.backend as string | null) ?? null,
    leidaAt: String(f.leida_at),
    ...(vigia ? { tituloAnterior: (f.titulo_anterior as string | null) ?? null, tituloCambiadoAt: (f.titulo_cambiado_at as string | null) ?? null } : {}),
  }))
}

export type { EstadoSeo }

/* ------------------------------------------------------------------ */
/* Migración 299: evolución, periodo anterior y competencia            */
/* ------------------------------------------------------------------ */

export interface PuntoDeEvolucion {
  asin: string
  periodo: 'WEEK' | 'MONTH'
  desde: string
  hasta: string
  busquedas: number
  volumen: number
  compras: number
  /** Compras del producto ÷ compras de todas sus búsquedas */
  cuotaCompras: number | null
  cuotaImpresiones: number | null
}

/** Por producto y periodo, lo sumado de todas sus búsquedas. [] si falta la migración 299 */
export async function evolucionDeCuenta(connectionId: string, marketplaceId: string): Promise<PuntoDeEvolucion[]> {
  const { data, error } = await createServiceClient().rpc('seo_evolucion', { p_conexion: connectionId, p_mercado: marketplaceId })
  if (error) {
    if (isMissingSchema(error)) return []
    throw error
  }
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
    const comprasTotal = Number(r.compras_total) || 0
    const impTotal = Number(r.impresiones_total) || 0
    return {
      asin: String(r.asin),
      periodo: r.periodo as 'WEEK' | 'MONTH',
      desde: String(r.desde),
      hasta: String(r.hasta),
      busquedas: Number(r.busquedas) || 0,
      volumen: Number(r.volumen) || 0,
      compras: Number(r.compras_asin) || 0,
      cuotaCompras: comprasTotal > 0 ? (Number(r.compras_asin) || 0) / comprasTotal : null,
      cuotaImpresiones: impTotal > 0 ? (Number(r.impresiones_asin) || 0) / impTotal : null,
    }
  })
}

export interface ConsultaAnterior {
  asin: string
  consulta: string
  volumen: number | null
  cuotaCompras: number | null
  cuotaImpresiones: number | null
}

/** Las búsquedas del periodo ANTERIOR al último leído (para el «vs anterior» de cada búsqueda) */
export async function consultasDelAnterior(connectionId: string, marketplaceId: string, periodo: 'WEEK' | 'MONTH'): Promise<ConsultaAnterior[]> {
  const service = createServiceClient()
  const { data: ultimos } = await service.from('seo_consultas').select('desde').eq('connection_id', connectionId).eq('marketplace_id', marketplaceId).eq('periodo', periodo).order('desde', { ascending: false }).limit(1)
  const ultimo = ((ultimos ?? []) as Array<{ desde: string }>)[0]?.desde
  if (!ultimo) return []
  const { data: previo } = await service.from('seo_consultas').select('desde').eq('connection_id', connectionId).eq('marketplace_id', marketplaceId).eq('periodo', periodo).lt('desde', ultimo).order('desde', { ascending: false }).limit(1)
  const desde = ((previo ?? []) as Array<{ desde: string }>)[0]?.desde
  if (!desde) return []
  const salida: ConsultaAnterior[] = []
  for (let i = 0; i < 20_000; i += 1000) {
    const { data, error } = await service.from('seo_consultas').select('asin, consulta, volumen, cuota_compras, cuota_impresiones').eq('connection_id', connectionId).eq('marketplace_id', marketplaceId).eq('periodo', periodo).eq('desde', desde).range(i, i + 999)
    if (error) throw error
    for (const r of (data ?? []) as Array<Record<string, unknown>>) salida.push({ asin: String(r.asin), consulta: String(r.consulta), volumen: n(r.volumen), cuotaCompras: n(r.cuota_compras), cuotaImpresiones: n(r.cuota_impresiones) })
    if (!data || data.length < 1000) break
  }
  return salida
}

export interface FilaCompetencia {
  consulta: string
  posicion: number
  asin: string
  cuotaClics: number | null
  cuotaConversion: number | null
}

/** Los 3 ASIN que más clics se llevan en cada una de esas búsquedas, de la última semana leída. null si falta la migración 299 */
export async function competenciaDe(connectionId: string, marketplaceId: string, consultas: readonly string[]): Promise<{ desde: string | null; filas: FilaCompetencia[] } | null> {
  const service = createServiceClient()
  const { data: ultimo, error } = await service.from('seo_top_terminos').select('desde').eq('connection_id', connectionId).eq('marketplace_id', marketplaceId).eq('periodo', 'WEEK').order('desde', { ascending: false }).limit(1)
  if (error) {
    if (isMissingSchema(error)) return null
    throw error
  }
  const desde = ((ultimo ?? []) as Array<{ desde: string }>)[0]?.desde ?? null
  if (!desde || consultas.length === 0) return { desde, filas: [] }
  const filas: FilaCompetencia[] = []
  // Se guardan normalizadas (minúsculas, espacios simples): se buscan igual
  const lista = [...new Set(consultas.map((q) => q.trim().toLowerCase().replace(/\s+/g, ' ')))]
  for (let i = 0; i < lista.length; i += 150) {
    const { data, error: e } = await service.from('seo_top_terminos').select('consulta, posicion, asin, cuota_clics, cuota_conversion').eq('connection_id', connectionId).eq('marketplace_id', marketplaceId).eq('periodo', 'WEEK').eq('desde', desde).in('consulta', lista.slice(i, i + 150))
    if (e) throw e
    for (const r of (data ?? []) as Array<Record<string, unknown>>) filas.push({ consulta: String(r.consulta), posicion: Number(r.posicion), asin: String(r.asin), cuotaClics: n(r.cuota_clics), cuotaConversion: n(r.cuota_conversion) })
  }
  return { desde, filas }
}
