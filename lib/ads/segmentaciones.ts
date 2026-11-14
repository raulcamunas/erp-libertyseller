/**
 * AMAZON ADS · LAS SEGMENTACIONES DE UNA CAMPAÑA Y LOS CAMBIOS A MANO (Marketing Test, al abrir una campaña).
 * SOLO SERVIDOR.
 *
 * LEER: los grupos de anuncios, las keywords y las segmentaciones por producto se piden a Amazon EN VIVO (la puja y el estado cambian a cualquier hora, también desde la consola de Amazon); las
 * métricas salen de `ads_objetivos_diario`, que el proceso de cada 3 h llena con el informe spTargeting.
 *
 * ESCRIBIR (esto toca la cuenta del cliente y gasta su dinero): la puja de una keyword o segmentación, la puja por defecto de un grupo, pausar o activar una segmentación, y el presupuesto diario de la
 * campaña. Cada cambio deja su línea en el log de cambios (con el antes y el después y quién lo hizo), salga bien o mal.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { llamarAds } from './datos'
import { AdsError } from './oauth'
import { anotarCambio } from './cuenta'
import { CLAUSULA_AUTO, METRICAS_VACIAS, conDerivadas, pujaValida, textoDeExpresion, type MetricasDeObjetivo } from './segmentaciones-calculo'

const T_GRUPO = 'application/vnd.spAdGroup.v3+json'
const T_KEYWORD = 'application/vnd.spKeyword.v3+json'
const T_TARGET = 'application/vnd.spTargetingClause.v3+json'
const T_CAMPANA = 'application/vnd.spCampaign.v3+json'
const cab = (t: string) => ({ Accept: t, 'Content-Type': t })

export type TipoDeObjetivo = 'keyword' | 'producto' | 'auto'

export interface Segmentacion {
  /** keywordId o targetId */
  id: string
  tipo: TipoDeObjetivo
  adGroupId: string
  texto: string
  /** Exacta / Frase / Amplia en keywords; null en el resto */
  coincidencia: string | null
  estado: 'ENABLED' | 'PAUSED' | 'ARCHIVED' | string
  /** null = usa la puja por defecto del grupo */
  puja: number | null
  metricas: MetricasDeObjetivo
}

export interface GrupoDeAnuncios {
  adGroupId: string
  nombre: string
  estado: string
  pujaPorDefecto: number | null
  segmentaciones: Segmentacion[]
}

export interface DetalleDeCampana {
  campaignId: string
  grupos: GrupoDeAnuncios[]
  /** Segmentaciones con gasto en el periodo que ya no están en la campaña (borradas o archivadas): se enseñan aparte para que las cifras cuadren */
  sinEstructura: Array<{ id: string; texto: string; metricas: MetricasDeObjetivo }>
  /** Hay métricas guardadas (si no, falta la migración 298 o la primera lectura) */
  conMetricas: boolean
  periodo: { desde: string; hasta: string }
}

async function listarTodo<T>(conexionId: string, profileId: number, ruta: string, tipo: string, clave: string, filtro: Record<string, unknown>): Promise<T[]> {
  const salida: T[] = []
  let token: string | undefined
  for (let i = 0; i < 10; i++) {
    const res = await llamarAds<Record<string, unknown>>(conexionId, ruta, { perfilId: profileId, metodo: 'POST', cabeceras: cab(tipo), cuerpo: { ...filtro, maxResults: 1000, ...(token ? { nextToken: token } : {}) } })
    salida.push(...((res[clave] as T[] | undefined) ?? []))
    token = res.nextToken as string | undefined
    if (!token) break
  }
  return salida
}

const desplazar = (dia: string, dias: number) => new Date(Date.parse(`${dia}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10)

export async function detalleDeCampana(cuenta: { id: string; conexionId: string; profileId: number }, campaignId: string, dias: number): Promise<DetalleDeCampana> {
  const hasta = desplazar(new Date().toISOString().slice(0, 10), -1)
  const desde = desplazar(hasta, -(dias - 1))
  const filtro = { campaignIdFilter: { include: [campaignId] }, stateFilter: { include: ['ENABLED', 'PAUSED'] } }

  const [grupos, keywords, targets, metricas] = await Promise.all([
    listarTodo<{ adGroupId?: string | number; name?: string; state?: string; defaultBid?: number }>(cuenta.conexionId, cuenta.profileId, '/sp/adGroups/list', T_GRUPO, 'adGroups', filtro),
    listarTodo<{ keywordId?: string | number; adGroupId?: string | number; keywordText?: string; matchType?: string; state?: string; bid?: number }>(cuenta.conexionId, cuenta.profileId, '/sp/keywords/list', T_KEYWORD, 'keywords', filtro),
    listarTodo<{ targetId?: string | number; adGroupId?: string | number; expression?: Array<{ type?: string; value?: string }>; resolvedExpression?: Array<{ type?: string; value?: string }>; expressionType?: string; state?: string; bid?: number }>(cuenta.conexionId, cuenta.profileId, '/sp/targets/list', T_TARGET, 'targetingClauses', filtro),
    metricasGuardadas(cuenta.id, campaignId, desde, hasta),
  ])

  const usadas = new Set<string>()
  const met = (id: string) => {
    usadas.add(id)
    return metricas.porId.get(id) ?? METRICAS_VACIAS
  }
  const segs: Segmentacion[] = [
    ...keywords
      .filter((k) => k.keywordId != null)
      .map((k) => ({ id: String(k.keywordId), tipo: 'keyword' as const, adGroupId: String(k.adGroupId ?? ''), texto: k.keywordText ?? '', coincidencia: k.matchType ?? null, estado: k.state ?? 'ENABLED', puja: typeof k.bid === 'number' ? k.bid : null, metricas: met(String(k.keywordId)) })),
    ...targets
      .filter((t) => t.targetId != null)
      .map((t) => {
        const auto = t.expressionType === 'AUTO' || Boolean(t.expression?.[0]?.type && CLAUSULA_AUTO[t.expression[0].type])
        return { id: String(t.targetId), tipo: (auto ? 'auto' : 'producto') as TipoDeObjetivo, adGroupId: String(t.adGroupId ?? ''), texto: textoDeExpresion(t.resolvedExpression?.length ? t.resolvedExpression : t.expression), coincidencia: null, estado: t.state ?? 'ENABLED', puja: typeof t.bid === 'number' ? t.bid : null, metricas: met(String(t.targetId)) }
      }),
  ]

  const salidaGrupos: GrupoDeAnuncios[] = grupos
    .filter((g) => g.adGroupId != null)
    .map((g) => ({
      adGroupId: String(g.adGroupId),
      nombre: g.name ?? '',
      estado: g.state ?? 'ENABLED',
      pujaPorDefecto: typeof g.defaultBid === 'number' ? g.defaultBid : null,
      segmentaciones: segs.filter((s) => s.adGroupId === String(g.adGroupId)).sort((a, b) => b.metricas.gasto - a.metricas.gasto || b.metricas.impresiones - a.metricas.impresiones || a.texto.localeCompare(b.texto)),
    }))

  const sinEstructura = [...metricas.porId]
    .filter(([id, m]) => !usadas.has(id) && (m.gasto > 0 || m.clics > 0))
    .map(([id, m]) => ({ id, texto: metricas.textos.get(id) ?? id, metricas: m }))
    .sort((a, b) => b.metricas.gasto - a.metricas.gasto)

  return { campaignId, grupos: salidaGrupos, sinEstructura, conMetricas: metricas.hay, periodo: { desde, hasta } }
}

/** Las métricas de las segmentaciones de una campaña en el periodo, sumadas. Sin la tabla (migración 298 sin lanzar), vacías */
async function metricasGuardadas(perfilId: string, campaignId: string, desde: string, hasta: string): Promise<{ hay: boolean; porId: Map<string, MetricasDeObjetivo>; textos: Map<string, string> }> {
  const suma = new Map<string, { impresiones: number; clics: number; gasto: number; ventas: number; pedidos: number; unidades: number }>()
  const textos = new Map<string, string>()
  const service = createServiceClient()
  for (let desdeFila = 0; desdeFila < 50_000; desdeFila += 1000) {
    const { data, error } = await service
      .from('ads_objetivos_diario')
      .select('objetivo_id, texto, impresiones, clics, gasto, ventas, pedidos, unidades')
      .eq('perfil_id', perfilId)
      .eq('campaign_id', campaignId)
      .gte('fecha', desde)
      .lte('fecha', hasta)
      .order('fecha', { ascending: true })
      .order('objetivo_id', { ascending: true })
      .range(desdeFila, desdeFila + 999)
    if (error) {
      if (isMissingSchema(error)) return { hay: false, porId: new Map(), textos }
      throw error
    }
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      const id = String(r.objetivo_id)
      const x = suma.get(id) ?? { impresiones: 0, clics: 0, gasto: 0, ventas: 0, pedidos: 0, unidades: 0 }
      x.impresiones += Number(r.impresiones)
      x.clics += Number(r.clics)
      x.gasto += Number(r.gasto)
      x.ventas += Number(r.ventas)
      x.pedidos += Number(r.pedidos)
      x.unidades += Number(r.unidades)
      suma.set(id, x)
      if (r.texto) textos.set(id, String(r.texto))
    }
    if (!data || data.length < 1000) break
  }
  const { count } = await service.from('ads_objetivos_diario').select('perfil_id', { count: 'exact', head: true }).eq('perfil_id', perfilId)
  return { hay: (count ?? 0) > 0, porId: new Map([...suma].map(([id, s]) => [id, conDerivadas(s)])), textos }
}

/* ------------------------------------------------------------------ */
/* Cambios a mano                                                      */
/* ------------------------------------------------------------------ */

type Multi = Record<string, { success?: Array<Record<string, unknown>>; error?: Array<{ errors?: Array<{ errorType?: string; errorValue?: unknown }> }> }>

function comprobar(res: unknown, clave: string): void {
  const r = (res as Multi | null)?.[clave]
  if (r?.success?.length) return
  const e = r?.error?.[0]?.errors?.[0]
  const dentro = /"(?:message|reason)":"([^"]+)"/.exec(JSON.stringify(e?.errorValue ?? {}))?.[1]
  throw new AdsError(`Amazon no ha aplicado el cambio: ${e?.errorType ?? 'ERROR'}${dentro ? ` — ${dentro}` : ''}`)
}

export interface ContextoDeCambio {
  cuenta: { id: string; conexionId: string; profileId: number }
  campaignId: string
  nombreCampana: string | null
  userId: string
}

const fmt = (n: number | null | undefined) => (n == null ? null : n.toFixed(2).replace('.', ','))

/** Cambia la puja de una keyword, de una segmentación (producto o automática) o la puja por defecto de un grupo */
export async function cambiarPuja(ctx: ContextoDeCambio, o: { tipo: TipoDeObjetivo | 'grupo'; id: string; texto: string; pujaAnterior: number | null; pujaNueva: unknown }): Promise<number> {
  const puja = pujaValida(o.pujaNueva)
  if (puja == null) throw new AdsError('La puja tiene que ser un número mayor que cero.')
  const entidad = o.tipo === 'keyword' ? 'keyword' : o.tipo === 'grupo' ? 'grupo' : 'target'
  try {
    if (o.tipo === 'keyword') comprobar(await llamarAds(ctx.cuenta.conexionId, '/sp/keywords', { perfilId: ctx.cuenta.profileId, metodo: 'PUT', cabeceras: cab(T_KEYWORD), cuerpo: { keywords: [{ keywordId: o.id, bid: puja }] } }), 'keywords')
    else if (o.tipo === 'grupo') comprobar(await llamarAds(ctx.cuenta.conexionId, '/sp/adGroups', { perfilId: ctx.cuenta.profileId, metodo: 'PUT', cabeceras: cab(T_GRUPO), cuerpo: { adGroups: [{ adGroupId: o.id, defaultBid: puja }] } }), 'adGroups')
    else comprobar(await llamarAds(ctx.cuenta.conexionId, '/sp/targets', { perfilId: ctx.cuenta.profileId, metodo: 'PUT', cabeceras: cab(T_TARGET), cuerpo: { targetingClauses: [{ targetId: o.id, bid: puja }] } }), 'targetingClauses')
    await anotarCambio({ perfilId: ctx.cuenta.id, campaignId: ctx.campaignId, nombreCampana: ctx.nombreCampana, entidad, accion: 'cambiar', campo: o.tipo === 'grupo' ? 'puja por defecto' : 'puja', valorAnterior: fmt(o.pujaAnterior), valorNuevo: fmt(puja), motivo: `Cambio a mano en «${o.texto.slice(0, 120)}»`, origen: 'manual', userId: ctx.userId })
    return puja
  } catch (e) {
    await anotarCambio({ perfilId: ctx.cuenta.id, campaignId: ctx.campaignId, nombreCampana: ctx.nombreCampana, entidad, accion: 'cambiar', campo: 'puja', valorAnterior: fmt(o.pujaAnterior), valorNuevo: fmt(puja), motivo: `Cambio a mano en «${o.texto.slice(0, 120)}»`, origen: 'manual', ok: false, error: e instanceof Error ? e.message : String(e), userId: ctx.userId })
    throw e
  }
}

/** Pausa o activa una keyword o una segmentación */
export async function cambiarEstado(ctx: ContextoDeCambio, o: { tipo: TipoDeObjetivo; id: string; texto: string; activar: boolean; motivo?: string; origen?: 'manual' | 'automatico' }): Promise<void> {
  const state = o.activar ? 'ENABLED' : 'PAUSED'
  const entidad = o.tipo === 'keyword' ? 'keyword' : 'target'
  // El motor la usa al aplicar una propuesta de pausa: entonces el log lleva SU motivo (el dato que la justifica), no «cambio a mano»
  const motivo = o.motivo ?? `Cambio a mano en «${o.texto.slice(0, 120)}»`
  const origen = o.origen ?? 'manual'
  try {
    if (o.tipo === 'keyword') comprobar(await llamarAds(ctx.cuenta.conexionId, '/sp/keywords', { perfilId: ctx.cuenta.profileId, metodo: 'PUT', cabeceras: cab(T_KEYWORD), cuerpo: { keywords: [{ keywordId: o.id, state }] } }), 'keywords')
    else comprobar(await llamarAds(ctx.cuenta.conexionId, '/sp/targets', { perfilId: ctx.cuenta.profileId, metodo: 'PUT', cabeceras: cab(T_TARGET), cuerpo: { targetingClauses: [{ targetId: o.id, state }] } }), 'targetingClauses')
    await anotarCambio({ perfilId: ctx.cuenta.id, campaignId: ctx.campaignId, nombreCampana: ctx.nombreCampana, entidad, accion: o.activar ? 'activar' : 'pausar', campo: `estado de «${o.texto.slice(0, 120)}»`, valorAnterior: o.activar ? 'pausada' : 'activa', valorNuevo: o.activar ? 'activa' : 'pausada', motivo, origen, userId: ctx.userId })
  } catch (e) {
    await anotarCambio({ perfilId: ctx.cuenta.id, campaignId: ctx.campaignId, nombreCampana: ctx.nombreCampana, entidad, accion: o.activar ? 'activar' : 'pausar', campo: `estado de «${o.texto.slice(0, 120)}»`, motivo, origen, ok: false, error: e instanceof Error ? e.message : String(e), userId: ctx.userId })
    throw e
  }
}

/** Cambia el presupuesto diario de una campaña */
export async function cambiarPresupuesto(ctx: ContextoDeCambio, o: { anterior: number | null; nuevo: unknown }): Promise<number> {
  const n = typeof o.nuevo === 'string' ? Number(o.nuevo.replace(',', '.')) : Number(o.nuevo)
  if (!Number.isFinite(n) || n < 1) throw new AdsError('El presupuesto diario tiene que ser al menos 1.')
  const presupuesto = Math.round(n * 100) / 100
  try {
    comprobar(await llamarAds(ctx.cuenta.conexionId, '/sp/campaigns', { perfilId: ctx.cuenta.profileId, metodo: 'PUT', cabeceras: cab(T_CAMPANA), cuerpo: { campaigns: [{ campaignId: ctx.campaignId, budget: { budgetType: 'DAILY', budget: presupuesto } }] } }), 'campaigns')
    await anotarCambio({ perfilId: ctx.cuenta.id, campaignId: ctx.campaignId, nombreCampana: ctx.nombreCampana, entidad: 'campaña', accion: 'cambiar', campo: 'presupuesto diario', valorAnterior: fmt(o.anterior), valorNuevo: fmt(presupuesto), motivo: 'Cambio a mano', origen: 'manual', userId: ctx.userId })
    return presupuesto
  } catch (e) {
    await anotarCambio({ perfilId: ctx.cuenta.id, campaignId: ctx.campaignId, nombreCampana: ctx.nombreCampana, entidad: 'campaña', accion: 'cambiar', campo: 'presupuesto diario', valorAnterior: fmt(o.anterior), valorNuevo: fmt(presupuesto), motivo: 'Cambio a mano', origen: 'manual', ok: false, error: e instanceof Error ? e.message : String(e), userId: ctx.userId })
    throw e
  }
}
