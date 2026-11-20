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
import { enTrozos, leerTodo } from './paginar'
import { agruparGastoSemanal, type GastoSemanal } from './periodo-mostrado'

export async function perfilesAdsDe(clientId: string, pais: string): Promise<string[]> {
  const service = createServiceClient()
  const { data: conexiones } = await service.from('ads_connections').select('id').eq('client_id', clientId)
  const ids = ((conexiones ?? []) as Array<{ id: string }>).map((c) => c.id)
  if (ids.length === 0) return []
  const { data: perfiles } = await service.from('ads_profiles').select('id').in('connection_id', ids).eq('pais', pais === 'GB' ? 'UK' : pais)
  return ((perfiles ?? []) as Array<{ id: string }>).map((p) => p.id)
}

type Respuesta = PromiseLike<{ data: Array<Record<string, unknown>> | null; error: unknown }>

/** Lee entero y, si la tabla de Marketing Test aún no existe (migración sin lanzar), devuelve [] */
async function leerTodoOVacio(construir: (desde: number, hasta: number) => Respuesta, etiqueta: string): Promise<Array<Record<string, unknown>>> {
  try {
    return await leerTodo(construir, { etiqueta })
  } catch (error) {
    if (isMissingSchema(error)) return []
    throw error
  }
}

const hace = (dias: number) => new Date(Date.now() - dias * 86_400_000).toISOString().slice(0, 10)

/** Los términos de búsqueda de las campañas del producto (los últimos que leyó el motor de Marketing Test), todos y de más a menos pedidos */
export async function terminosDeAdsDelAsin(perfilIds: readonly string[], asin: string): Promise<TerminoDeAds[]> {
  if (perfilIds.length === 0) return []
  const service = createServiceClient()
  const filas = await leerTodoOVacio(
    (a, b) =>
      service
        .from('ads_terminos')
        .select('termino, pedidos, ventas, clics, gasto')
        .in('perfil_id', [...perfilIds])
        .ilike('campaign_nombre', `%${asin}%`)
        .gt('clics', 0)
        .order('pedidos', { ascending: false })
        .order('perfil_id')
        .order('campaign_id')
        .order('ad_group_id')
        .order('termino')
        .range(a, b),
    'términos de Ads'
  )
  return filas.map((r) => ({ termino: String(r.termino), pedidos: Number(r.pedidos) || 0, ventas: Number(r.ventas) || 0, clics: Number(r.clics) || 0, gasto: Number(r.gasto) || 0 }))
}

/** Las campañas del producto (las que llevan su ASIN en el nombre) con actividad desde `desde` */
async function campanasDelAsin(perfilIds: readonly string[], asin: string, desde: string): Promise<string[]> {
  const service = createServiceClient()
  const filas = await leerTodoOVacio(
    (a, b) => service.from('ads_rendimiento_diario').select('campaign_id').in('perfil_id', [...perfilIds]).ilike('nombre', `%${asin}%`).gte('fecha', desde).order('campaign_id').order('fecha').order('perfil_id').range(a, b),
    'campañas de Ads'
  )
  return [...new Set(filas.map((c) => String(c.campaign_id)))]
}

/**
 * Las keywords por las que ya pujan las campañas del producto: las EXACTAS y las demás (amplia y frase), normalizadas. Las segmentaciones salen de los últimos 7 días (lo que está vivo ahora),
 * solo de las tres concordancias de keyword, y se leen enteras: antes el tope de 1000 filas dejaba fuera keywords EXACTAS y decía «sin exacta» sin serlo.
 */
export async function keywordsDelAsin(perfilIds: readonly string[], asin: string): Promise<{ exactas: Set<string>; otras: Set<string>; campanas: number }> {
  const exactas = new Set<string>()
  const otras = new Set<string>()
  if (perfilIds.length === 0) return { exactas, otras, campanas: 0 }
  const service = createServiceClient()
  const campanas = await campanasDelAsin(perfilIds, asin, hace(45))
  const anotar = (texto: unknown, coincidencia: unknown) => {
    const k = normalizar(texto == null ? '' : String(texto))
    if (!k) return
    const tipo = String(coincidencia ?? '').toUpperCase()
    if (tipo === 'EXACT') exactas.add(k)
    else if (tipo === 'BROAD' || tipo === 'PHRASE') otras.add(k)
  }
  // Las segmentaciones de Marketing Test (migración 298), si está. Las campañas van en trozos de 300 (antes se cortaban en silencio en las 300 primeras)
  const hace7 = hace(7)
  for (const trozo of enTrozos(campanas, 300)) {
    const obj = await leerTodoOVacio(
      (a, b) =>
        service
          .from('ads_objetivos_diario')
          .select('texto, coincidencia')
          .in('perfil_id', [...perfilIds])
          .in('campaign_id', trozo)
          .in('coincidencia', ['EXACT', 'BROAD', 'PHRASE'])
          .gte('fecha', hace7)
          .order('fecha', { ascending: false })
          .order('campaign_id')
          .order('texto')
          .order('perfil_id')
          .order('objetivo_id')
          .range(a, b),
      'segmentaciones de Ads'
    )
    for (const o of obj) anotar(o.texto, o.coincidencia)
  }
  // Y las keywords que aparecen en el informe de términos de búsqueda
  const ter = await leerTodoOVacio(
    (a, b) =>
      service
        .from('ads_terminos')
        .select('keyword, match_type')
        .in('perfil_id', [...perfilIds])
        .ilike('campaign_nombre', `%${asin}%`)
        .not('keyword', 'is', null)
        .order('pedidos', { ascending: false })
        .order('perfil_id')
        .order('campaign_id')
        .order('ad_group_id')
        .order('termino')
        .range(a, b),
    'keywords de los términos de Ads'
  )
  for (const t of ter) anotar(t.keyword, t.match_type)
  return { exactas, otras, campanas: campanas.length }
}

/**
 * El gasto de publicidad de cada producto por semana de Amazon (de domingo a sábado, como las de Brand Analytics), desde `desde`. Una campaña es del producto si lleva su ASIN en el nombre (la
 * misma convención que el resto del cruce con Marketing Test). Las semanas sin gasto no salen.
 */
export async function gastoSemanalPorAsin(perfilIds: readonly string[], asins: readonly string[], desde: string): Promise<GastoSemanal[]> {
  const limpios = [...new Set(asins.map((a) => a.trim().toUpperCase()).filter((a) => /^[A-Z0-9]{10}$/.test(a)))]
  if (perfilIds.length === 0 || limpios.length === 0) return []
  const service = createServiceClient()
  const salida: GastoSemanal[] = []
  // De 20 en 20 ASIN para que el «or» de la dirección no crezca sin límite. Cada trozo suma solo a sus ASIN: una campaña que saliera en dos trozos no se cuenta dos veces para el mismo
  for (const trozo of enTrozos(limpios, 20)) {
    const datos = await leerTodoOVacio(
      (a, b) =>
        service
          .from('ads_rendimiento_diario')
          .select('campaign_id, nombre, fecha, gasto')
          .in('perfil_id', [...perfilIds])
          .gte('fecha', desde)
          .or(trozo.map((x) => `nombre.ilike.%${x}%`).join(','))
          .order('campaign_id')
          .order('fecha')
          .order('perfil_id')
          .range(a, b),
      'gasto semanal de Ads'
    )
    salida.push(...agruparGastoSemanal(datos.map((r) => ({ nombre: String(r.nombre ?? ''), fecha: String(r.fecha), gasto: Number(r.gasto) || 0 })), trozo))
  }
  return salida.sort((x, y) => x.asin.localeCompare(y.asin) || x.desde.localeCompare(y.desde))
}
