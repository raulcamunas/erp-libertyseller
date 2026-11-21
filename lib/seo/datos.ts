/**
 * SEO TEST · LOS DATOS DE LA PANTALLA (SOLO SERVIDOR): clientes y países, productos seguidos, búsquedas de Brand Analytics y fichas.
 *
 * Una «cuenta» aquí es una conexión de vendedor de Amazon + un marketplace (un país). Todo cuelga de ella: no hay lecturas que mezclen clientes.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { AMAZON_MARKETPLACES, mercadosDeConexion } from '@/lib/types/amazon'
import type { EstadoSeo } from './lectura'
import { leerTodo, enTrozos } from './paginar'
import { elegirPeriodo, sinDuplicados } from './periodo-mostrado'

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
  const service = createServiceClient()
  const { data, error } = await service.from('seo_propuestas').select('asin, aplicada_at').eq('connection_id', connectionId).eq('marketplace_id', marketplaceId).eq('estado', 'aplicada').not('aplicada_at', 'is', null).order('aplicada_at', { ascending: false }).limit(200)
  if (error) {
    if (isMissingSchema(error)) return []
    throw error
  }
  const salida = ((data ?? []) as Array<{ asin: string; aplicada_at: string }>).map((r) => ({ asin: r.asin, aplicadaAt: r.aplicada_at }))
  // Migración 312: los cambios de TÍTULO hechos a mano desde el editor también abren la ventana de 30 días del SOP (los de la IA ya están arriba)
  const { data: ediciones, error: e2 } = await service.from('seo_ediciones').select('asin, enviada_at').eq('connection_id', connectionId).eq('marketplace_id', marketplaceId).eq('origen', 'manual').in('estado', ['enviada', 'aplicada', 'parcial']).contains('campos', ['titulo']).not('enviada_at', 'is', null).order('enviada_at', { ascending: false }).limit(200)
  if (!e2) for (const r of (ediciones ?? []) as Array<{ asin: string; enviada_at: string }>) salida.push({ asin: r.asin, aplicadaAt: r.enviada_at })
  return salida.sort((a, b) => b.aplicadaAt.localeCompare(a.aplicadaAt))
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

const COLUMNAS_CONSULTA =
  'asin, periodo, desde, hasta, consulta, puntuacion, volumen, cuota_impresiones, cuota_clics, cuota_carritos, cuota_compras, compras_asin, compras_total, clics_asin, impresiones_asin, impresiones_total, clics_total, carritos_total, carritos_asin, precio_mediano_total, precio_mediano_asin'

const consultaDeFila = (r: Record<string, unknown>): ConsultaGuardada => ({
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

/* ------------------------------------------------------------------ */
/* Qué periodo se enseña (lib/seo/periodo-mostrado.ts)                 */
/* ------------------------------------------------------------------ */

interface EstadoDePeriodos {
  mesOk: string | null
  semanaOk: string | null
  /** undefined sin la migración 299 */
  leidos: string[] | undefined
  /** Los ASIN que Amazon no da en Brand Analytics (migración 332). [] sin la migración */
  asinsSinBa: string[]
}

/** Lo que la lectura ha dado por terminado. Va probando columnas de más nueva a más vieja: sin la 332 o sin la 299 sigue funcionando */
async function estadoDePeriodos(connectionId: string, marketplaceId: string): Promise<EstadoDePeriodos> {
  const service = createServiceClient()
  for (const columnas of ['mes_ok, semana_ok, periodos_leidos, asins_sin_ba', 'mes_ok, semana_ok, periodos_leidos', 'mes_ok, semana_ok']) {
    const { data, error } = await service.from('seo_lecturas').select(columnas).eq('connection_id', connectionId).eq('marketplace_id', marketplaceId).maybeSingle()
    if (error) {
      if (isMissingSchema(error)) continue
      throw error
    }
    const r = (data ?? {}) as { mes_ok?: string | null; semana_ok?: string | null; periodos_leidos?: string[] | null; asins_sin_ba?: string[] | null }
    return {
      mesOk: r.mes_ok ?? null,
      semanaOk: r.semana_ok ?? null,
      leidos: columnas.includes('periodos_leidos') ? (r.periodos_leidos ?? []) : undefined,
      asinsSinBa: Array.isArray(r.asins_sin_ba) ? r.asins_sin_ba : [],
    }
  }
  return { mesOk: null, semanaOk: null, leidos: undefined, asinsSinBa: [] }
}

async function maxDesdeDe(connectionId: string, marketplaceId: string, periodo: 'WEEK' | 'MONTH'): Promise<string | null> {
  const { data, error } = await createServiceClient().from('seo_consultas').select('desde').eq('connection_id', connectionId).eq('marketplace_id', marketplaceId).eq('periodo', periodo).order('desde', { ascending: false }).limit(1).maybeSingle()
  if (error) throw error
  return (data as { desde: string } | null)?.desde ?? null
}

/**
 * El periodo que se enseña de cada tipo: el que la lectura dio por terminado, luego el último leído entero del histórico y, si no, el más alto de la tabla. Así no sale una semana a medias (con
 * solo los productos de las primeras tandas) mientras Amazon prepara las demás.
 */
export async function periodosMostrados(connectionId: string, marketplaceId: string): Promise<{ WEEK: string | null; MONTH: string | null; asinsSinBa: string[] }> {
  const [estado, maxSemana, maxMes] = await Promise.all([estadoDePeriodos(connectionId, marketplaceId), maxDesdeDe(connectionId, marketplaceId, 'WEEK'), maxDesdeDe(connectionId, marketplaceId, 'MONTH')])
  return {
    WEEK: elegirPeriodo({ periodo: 'WEEK', ok: estado.semanaOk, leidos: estado.leidos, maxDesde: maxSemana }),
    MONTH: elegirPeriodo({ periodo: 'MONTH', ok: estado.mesOk, leidos: estado.leidos, maxDesde: maxMes }),
    asinsSinBa: estado.asinsSinBa,
  }
}

export async function periodoMostrado(connectionId: string, marketplaceId: string, periodo: 'WEEK' | 'MONTH'): Promise<string | null> {
  return (await periodosMostrados(connectionId, marketplaceId))[periodo]
}

/**
 * Las búsquedas guardadas de la cuenta en el periodo que se enseña de cada tipo (ver periodosMostrados). `desde` permite pasar el periodo ya calculado (la ruta de la cuenta lo calcula una vez
 * para todo). Orden estable (volumen, asin, consulta) y sin repetidos.
 */
export async function consultasGuardadas(connectionId: string, marketplaceId: string, periodo: 'WEEK' | 'MONTH', desde?: string | null): Promise<ConsultaGuardada[]> {
  const elegido = desde === undefined ? await periodoMostrado(connectionId, marketplaceId, periodo) : desde
  if (!elegido) return []
  const service = createServiceClient()
  const filas = await leerTodo<Record<string, unknown>>(
    (a, b) =>
      service
        .from('seo_consultas')
        .select(COLUMNAS_CONSULTA)
        .eq('connection_id', connectionId)
        .eq('marketplace_id', marketplaceId)
        .eq('periodo', periodo)
        .eq('desde', elegido)
        .order('volumen', { ascending: false, nullsFirst: false })
        .order('asin')
        .order('consulta')
        .range(a, b),
    { etiqueta: `búsquedas ${periodo}` }
  )
  return sinDuplicados(filas.map(consultaDeFila), (c) => `${c.asin}|${c.consulta}`)
}

/** Una fila de cualquier periodo, para la evolución de cada búsqueda (el historial) */
export type ConsultaHistorica = ConsultaGuardada

const DIA = 86_400_000
const restarDias = (fecha: string, dias: number) => new Date(Date.parse(`${fecha}T00:00:00Z`) - dias * DIA).toISOString().slice(0, 10)
const restarMeses = (fecha: string, meses: number) => {
  const d = new Date(`${fecha}T00:00:00Z`)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - meses, 1)).toISOString().slice(0, 10)
}

/**
 * Las búsquedas de todos los periodos leídos (o de las N últimas semanas / meses), para ver cómo se mueve cada una. Nunca pasa del periodo mostrado: la semana a medias no entra.
 *   · sin `semanas` ni `meses` → todas las semanas y todos los meses;
 *   · con uno de los dos → solo ese tipo; con los dos → los dos.
 * Ordenado por asin, periodo, desde y consulta (va por el índice idx_seo_consultas_asin).
 */
export async function historialDeConsultas(connectionId: string, marketplaceId: string, opciones: { asin?: string | null; semanas?: number | null; meses?: number | null } = {}): Promise<ConsultaHistorica[]> {
  const mostrados = await periodosMostrados(connectionId, marketplaceId)
  const pedidos: Array<{ periodo: 'WEEK' | 'MONTH'; cuantos: number | null }> = []
  const semanas = opciones.semanas && opciones.semanas > 0 ? Math.floor(opciones.semanas) : null
  const meses = opciones.meses && opciones.meses > 0 ? Math.floor(opciones.meses) : null
  if (semanas == null && meses == null) pedidos.push({ periodo: 'WEEK', cuantos: null }, { periodo: 'MONTH', cuantos: null })
  else {
    if (semanas != null) pedidos.push({ periodo: 'WEEK', cuantos: semanas })
    if (meses != null) pedidos.push({ periodo: 'MONTH', cuantos: meses })
  }
  const service = createServiceClient()
  const asin = opciones.asin?.trim().toUpperCase() || null
  const salida: ConsultaHistorica[] = []
  for (const { periodo, cuantos } of pedidos) {
    const hasta = mostrados[periodo]
    if (!hasta) continue
    const desdeMinimo = cuantos == null ? null : periodo === 'WEEK' ? restarDias(hasta, 7 * (cuantos - 1)) : restarMeses(hasta, cuantos - 1)
    const filas = await leerTodo<Record<string, unknown>>(
      (a, b) => {
        let q = service.from('seo_consultas').select(COLUMNAS_CONSULTA).eq('connection_id', connectionId).eq('marketplace_id', marketplaceId)
        if (asin) q = q.eq('asin', asin)
        q = q.eq('periodo', periodo).lte('desde', hasta)
        if (desdeMinimo) q = q.gte('desde', desdeMinimo)
        return q.order('asin').order('periodo').order('desde').order('consulta').range(a, b)
      },
      { etiqueta: `historial ${periodo}` }
    )
    salida.push(...filas.map(consultaDeFila))
  }
  return sinDuplicados(salida, (c) => `${c.asin}|${c.periodo}|${c.desde}|${c.consulta}`)
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
  /** Migración 312: los Item Highlights (si el listing los trae con un atributo conocido), el tipo de producto y lo que Amazon dice que le pasa */
  highlights?: string | null
  productType?: string | null
  issues?: Array<{ code: string | null; message: string; severity: string | null; atributos: string[] }>
}

/** ¿Está la migración 312 (editor, Helium 10 y competencia)? Se pregunta una vez por proceso (si sí) */
let hay312: boolean | null = null
export async function migracion312Lanzada(): Promise<boolean> {
  if (hay312 === true) return true
  const { error } = await createServiceClient().from('seo_ediciones').select('id').limit(1)
  if (error && !isMissingSchema(error)) throw error
  hay312 = !error
  return hay312
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
  const [vigia, m312] = await Promise.all([vigiaLanzado().catch(() => false), migracion312Lanzada().catch(() => false)])
  const { data, error } = await createServiceClient()
    .from('seo_fichas')
    .select(`asin, sku, titulo, bullets, descripcion, backend, leida_at${vigia ? ', titulo_anterior, titulo_cambiado_at' : ''}${m312 ? ', highlights, product_type, issues' : ''}`)
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
    ...(m312 ? { highlights: (f.highlights as string | null) ?? null, productType: (f.product_type as string | null) ?? null, issues: Array.isArray(f.issues) ? (f.issues as NonNullable<FichaGuardada['issues']>) : [] } : {}),
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

/**
 * Por producto y periodo, lo sumado de todas sus búsquedas. [] si falta la migración 299. La función de la base devuelve una fila por ASIN y periodo de TODO lo guardado (también de productos
 * que ya no se siguen): se filtra a los seguidos y se pagina (antes se cortaba en 1000 filas). Va ordenada por asin, periodo y desde, que es única.
 */
export async function evolucionDeCuenta(connectionId: string, marketplaceId: string): Promise<PuntoDeEvolucion[]> {
  const seguidos = (await productosSeguidos(connectionId, marketplaceId)).map((p) => p.asin.toUpperCase())
  if (seguidos.length === 0) return []
  const service = createServiceClient()
  let filas: Array<Record<string, unknown>> = []
  try {
    for (const trozo of enTrozos(seguidos, 200)) {
      filas = filas.concat(
        await leerTodo<Record<string, unknown>>(
          (a, b) =>
            service
              .rpc('seo_evolucion', { p_conexion: connectionId, p_mercado: marketplaceId })
              .in('asin', trozo)
              .order('asin')
              .order('periodo')
              .order('desde')
              .range(a, b) as unknown as PromiseLike<{ data: Array<Record<string, unknown>> | null; error: unknown }>,
          { etiqueta: 'evolución' }
        )
      )
    }
  } catch (error) {
    if (isMissingSchema(error)) return []
    throw error
  }
  return filas.map((r) => {
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

/**
 * Las búsquedas del periodo ANTERIOR al que se enseña (para el «vs anterior» de cada búsqueda): el mayor `desde` por debajo del mostrado, no del más alto de la tabla. `mostrado` permite pasar el
 * periodo ya calculado.
 */
export async function consultasDelAnterior(connectionId: string, marketplaceId: string, periodo: 'WEEK' | 'MONTH', mostrado?: string | null): Promise<ConsultaAnterior[]> {
  const service = createServiceClient()
  const ultimo = mostrado === undefined ? await periodoMostrado(connectionId, marketplaceId, periodo) : mostrado
  if (!ultimo) return []
  const { data: previo, error: e } = await service.from('seo_consultas').select('desde').eq('connection_id', connectionId).eq('marketplace_id', marketplaceId).eq('periodo', periodo).lt('desde', ultimo).order('desde', { ascending: false }).limit(1)
  if (e) throw e
  const desde = ((previo ?? []) as Array<{ desde: string }>)[0]?.desde
  if (!desde) return []
  const filas = await leerTodo<Record<string, unknown>>(
    (a, b) =>
      service
        .from('seo_consultas')
        .select('asin, consulta, volumen, cuota_compras, cuota_impresiones')
        .eq('connection_id', connectionId)
        .eq('marketplace_id', marketplaceId)
        .eq('periodo', periodo)
        .eq('desde', desde)
        .order('asin')
        .order('consulta')
        .range(a, b),
    { etiqueta: `búsquedas anteriores ${periodo}` }
  )
  return sinDuplicados(
    filas.map((r) => ({ asin: String(r.asin), consulta: String(r.consulta), volumen: n(r.volumen), cuotaCompras: n(r.cuota_compras), cuotaImpresiones: n(r.cuota_impresiones) })),
    (c) => `${c.asin}|${c.consulta}`
  )
}

export interface FilaCompetencia {
  consulta: string
  posicion: number
  asin: string
  cuotaClics: number | null
  cuotaConversion: number | null
  /** La semana (domingo) de la fila: con `semanas` > 1 llegan varias */
  desde: string
}

/**
 * Los 3 ASIN que más clics se llevan en cada una de esas búsquedas, de la última semana leída (o de las `semanas` últimas). `desde` es la última; `semanas` (en la respuesta), las que han entrado,
 * de la más vieja a la más nueva. null si falta la migración 299.
 */
export async function competenciaDe(connectionId: string, marketplaceId: string, consultas: readonly string[], opciones: { semanas?: number } = {}): Promise<{ desde: string | null; semanas: string[]; filas: FilaCompetencia[] } | null> {
  const service = createServiceClient()
  const { data: ultimo, error } = await service.from('seo_top_terminos').select('desde').eq('connection_id', connectionId).eq('marketplace_id', marketplaceId).eq('periodo', 'WEEK').order('desde', { ascending: false }).limit(1)
  if (error) {
    if (isMissingSchema(error)) return null
    throw error
  }
  const desde = ((ultimo ?? []) as Array<{ desde: string }>)[0]?.desde ?? null
  if (!desde || consultas.length === 0) return { desde, semanas: desde ? [desde] : [], filas: [] }
  const cuantas = Math.max(1, Math.floor(opciones.semanas ?? 1))
  const primera = restarDias(desde, 7 * (cuantas - 1))
  const filas: FilaCompetencia[] = []
  // Se guardan normalizadas (minúsculas, espacios simples): se buscan igual
  const lista = [...new Set(consultas.map((q) => q.trim().toLowerCase().replace(/\s+/g, ' ')))]
  for (const trozo of enTrozos(lista, 150)) {
    const datos = await leerTodo<Record<string, unknown>>(
      (a, b) => {
        let q = service.from('seo_top_terminos').select('desde, consulta, posicion, asin, cuota_clics, cuota_conversion').eq('connection_id', connectionId).eq('marketplace_id', marketplaceId).eq('periodo', 'WEEK')
        q = cuantas === 1 ? q.eq('desde', desde) : q.gte('desde', primera).lte('desde', desde)
        return q.in('consulta', trozo).order('desde').order('consulta').order('posicion').range(a, b)
      },
      { etiqueta: 'competencia' }
    )
    for (const r of datos) filas.push({ consulta: String(r.consulta), posicion: Number(r.posicion), asin: String(r.asin), cuotaClics: n(r.cuota_clics), cuotaConversion: n(r.cuota_conversion), desde: String(r.desde) })
  }
  const semanas = [...new Set(filas.map((f) => f.desde))].sort()
  return { desde, semanas: semanas.length ? semanas : [desde], filas }
}
