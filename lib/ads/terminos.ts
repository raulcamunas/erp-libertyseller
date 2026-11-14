/**
 * AMAZON ADS · LOS TÉRMINOS DE BÚSQUEDA DE UNA CUENTA (la materia prima del motor).
 * SOLO SERVIDOR. Solo LEE de Amazon; escribe únicamente en las tablas del ERP (migración 294).
 *
 * Una vez al día, por cada cuenta con el motor encendido, se pide a Amazon el informe de términos de búsqueda de 30 días que acaban 3 antes de hoy, YA RESUMIDO (sin desglose por día), y se
 * guarda reemplazando lo anterior. La mecánica es la de lib/ads/sincronizar.ts: pedir y recoger son dos pasadas distintas y el estado vive en la base, así que nada se queda esperando a Amazon.
 *
 * Solo se guardan los términos con algún clic (o alguna compra): los miles de términos con una impresión suelta no sirven a ninguna regla y llenarían la base.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { AdsError } from './oauth'
import { descargarCrudas, estadoDeInforme, pedirInformeDeTerminos, type Periodo } from './rendimiento'
import { debeEmpezar, ESPERA_MAXIMA_MS, type CuentaParaSincronizar } from './sincronizar'
import type { TerminoDeBusqueda } from './reglas'
import { leerUmbrales } from './umbrales-cuenta'

export const INTERVALO_TERMINOS_MS = 24 * 3_600_000
/** 30 días: la cosecha pide «≥ 3 pedidos en 30 días» y con 14 casi ningún término de una cuenta pequeña llega a la muestra */
export const DIAS_DE_TERMINOS = 30
/** Desde el primer clic: la regla de irrelevantes («no comparte nada con el producto») se propone al primer clic. El tope de filas sigue protegiendo la base */
export const CLICS_MINIMOS_PARA_GUARDAR = 1
export const MAX_TERMINOS_GUARDADOS = 20_000

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : Number.NaN
  return Number.isFinite(n) ? n : 0
}

export interface FilaDeTermino extends TerminoDeBusqueda {
  adGroupId: string
  keyword: string | null
  matchType: string | null
  impresiones: number
  ventas: number
}

/** De las filas crudas del informe `spSearchTerm` a filas de término. Se descartan las que no traen término o campaña */
export function terminosDeInforme(crudas: ReadonlyArray<Record<string, unknown>>): FilaDeTermino[] {
  const salida: FilaDeTermino[] = []
  for (const r of crudas) {
    const termino = typeof r.searchTerm === 'string' ? r.searchTerm.trim() : ''
    const campaignId = r.campaignId == null ? '' : String(r.campaignId)
    if (!termino || !campaignId) continue
    salida.push({
      termino,
      campaignId,
      campaignName: typeof r.campaignName === 'string' ? r.campaignName : '',
      adGroupName: typeof r.adGroupName === 'string' ? r.adGroupName : undefined,
      adGroupId: r.adGroupId == null ? '' : String(r.adGroupId),
      keyword: typeof r.keyword === 'string' ? r.keyword : null,
      matchType: typeof r.matchType === 'string' ? r.matchType : null,
      impresiones: num(r.impressions),
      clics: num(r.clicks),
      gasto: num(r.cost),
      ventas: num(r.sales7d),
      compras: num(r.purchases7d),
    })
  }
  return salida
}

/** Se queda con los que tienen señal, suma los repetidos (mismo término en la misma campaña y grupo) y limita el total, de más a menos gasto */
export function paraGuardar(filas: readonly FilaDeTermino[]): FilaDeTermino[] {
  const por = new Map<string, FilaDeTermino>()
  for (const f of filas) {
    const clave = `${f.campaignId}|${f.adGroupId}|${f.termino.toLowerCase()}`
    const x = por.get(clave)
    if (!x) por.set(clave, { ...f })
    else {
      x.impresiones += f.impresiones
      x.clics += f.clics
      x.gasto += f.gasto
      x.ventas += f.ventas
      x.compras += f.compras
    }
  }
  return [...por.values()]
    .filter((f) => f.clics >= CLICS_MINIMOS_PARA_GUARDAR || f.compras >= 1)
    .sort((a, b) => b.gasto - a.gasto)
    .slice(0, MAX_TERMINOS_GUARDADOS)
}

/**
 * El periodo que se pide: 30 días que acaban `diasSinCerrar` antes de hoy (por defecto 3; como mínimo ayer, porque hoy está a medias). Los últimos días se dejan fuera porque Amazon sigue
 * reajustando las conversiones (atribución a 7 días): un término que vendió anteayer todavía puede salir con cero pedidos. `hoy` = 'YYYY-MM-DD'
 */
export function periodoDeTerminos(hoy: string, diasSinCerrar = 3): Periodo {
  const dia = (d: number) => new Date(Date.parse(`${hoy}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10)
  const fin = -Math.max(1, Math.round(diasSinCerrar))
  return { desde: dia(fin - DIAS_DE_TERMINOS + 1), hasta: dia(fin) }
}

interface FilaSync {
  estado: 'reposo' | 'esperando'
  informe_id: string | null
  desde: string | null
  hasta: string | null
  pedido_at: string | null
  ultimo_ok_at: string | null
  error: string | null
  intentos: number
}

async function leerSync(perfilId: string): Promise<FilaSync | null> {
  const { data, error } = await createServiceClient().from('ads_terminos_sync').select('estado, informe_id, desde, hasta, pedido_at, ultimo_ok_at, error, intentos').eq('perfil_id', perfilId).maybeSingle()
  if (error) throw error
  return (data as unknown as FilaSync | null) ?? null
}

async function guardarSync(perfilId: string, cambios: Record<string, unknown>): Promise<void> {
  const { error } = await createServiceClient().from('ads_terminos_sync').upsert({ perfil_id: perfilId, ...cambios, updated_at: new Date().toISOString() }, { onConflict: 'perfil_id' })
  if (error) throw error
}

export type ResultadoDeTerminos = { accion: 'nada' | 'pedido' | 'esperando' | 'guardado' | 'error'; detalle?: string }

/** Da UN paso en la lectura de términos de una cuenta. Nunca espera a Amazon. Lanza solo si falta la migración o la base falla */
export async function avanzarTerminos(cuenta: CuentaParaSincronizar, opciones: { forzar?: boolean } = {}): Promise<ResultadoDeTerminos> {
  const ahora = Date.now()
  const estado = await leerSync(cuenta.id)
  try {
    if (estado?.estado === 'esperando' && estado.informe_id) {
      const pedidoAt = estado.pedido_at ? Date.parse(estado.pedido_at) : ahora
      if (ahora - pedidoAt > ESPERA_MAXIMA_MS) {
        await guardarSync(cuenta.id, { estado: 'reposo', informe_id: null, error: 'Amazon ha tardado más de 25 minutos en preparar el informe de términos.', intentos: (estado.intentos ?? 0) + 1, pedido_at: new Date(ahora).toISOString() })
        return { accion: 'error', detalle: 'caducado' }
      }
      const e = await estadoDeInforme(cuenta.conexionId, cuenta.profileId, estado.informe_id)
      if (e.estado === 'FAILED') {
        await guardarSync(cuenta.id, { estado: 'reposo', informe_id: null, error: `Amazon no ha podido generar el informe de términos${e.detalle ? `: ${e.detalle}` : '.'}`.slice(0, 500), intentos: (estado.intentos ?? 0) + 1, pedido_at: new Date(ahora).toISOString() })
        return { accion: 'error', detalle: e.detalle }
      }
      if (e.estado !== 'COMPLETED' || !e.url) return { accion: 'esperando' }

      const filas = paraGuardar(terminosDeInforme(await descargarCrudas(e.url)))
      const service = createServiceClient()
      // Se REEMPLAZA lo anterior: es la última ventana de 30 días, no un histórico
      const { error: errorBorrar } = await service.from('ads_terminos').delete().eq('perfil_id', cuenta.id)
      if (errorBorrar) throw errorBorrar
      const ahoraIso = new Date().toISOString()
      const registros = filas.map((f) => ({
        perfil_id: cuenta.id,
        campaign_id: f.campaignId,
        ad_group_id: f.adGroupId,
        termino: f.termino.slice(0, 300),
        keyword: f.keyword?.slice(0, 300) ?? null,
        match_type: f.matchType,
        campaign_nombre: f.campaignName.slice(0, 300),
        impresiones: Math.round(f.impresiones),
        clics: Math.round(f.clics),
        gasto: Number(f.gasto.toFixed(2)),
        ventas: Number(f.ventas.toFixed(2)),
        pedidos: Math.round(f.compras),
        desde: estado.desde,
        hasta: estado.hasta,
        actualizado_at: ahoraIso,
      }))
      for (let i = 0; i < registros.length; i += 500) {
        const { error } = await service.from('ads_terminos').upsert(registros.slice(i, i + 500), { onConflict: 'perfil_id,campaign_id,ad_group_id,termino' })
        if (error) throw error
      }
      await guardarSync(cuenta.id, { estado: 'reposo', informe_id: null, ultimo_ok_at: new Date().toISOString(), filas: registros.length, error: null, intentos: 0 })
      return { accion: 'guardado', detalle: `${registros.length} términos` }
    }

    const toca = debeEmpezar(
      { ultimoOkAt: estado?.ultimo_ok_at ? Date.parse(estado.ultimo_ok_at) : null, pedidoAt: estado?.pedido_at ? Date.parse(estado.pedido_at) : null, hayError: Boolean(estado?.error), ahora, forzar: Boolean(opciones.forzar) },
      INTERVALO_TERMINOS_MS
    )
    if (!toca) return { accion: 'nada' }
    const periodo = periodoDeTerminos(new Date().toISOString().slice(0, 10), (await leerUmbrales(cuenta.id)).umbrales.diasSinCerrar)
    const id = await pedirInformeDeTerminos(cuenta.conexionId, cuenta.profileId, periodo)
    await guardarSync(cuenta.id, { estado: 'esperando', informe_id: id, desde: periodo.desde, hasta: periodo.hasta, pedido_at: new Date(ahora).toISOString(), error: null })
    return { accion: 'pedido' }
  } catch (error) {
    if (isMissingSchema(error) || !(error instanceof AdsError)) throw error
    await guardarSync(cuenta.id, { estado: 'reposo', informe_id: null, error: error.message.slice(0, 500), intentos: (estado?.intentos ?? 0) + 1, pedido_at: new Date(ahora).toISOString() }).catch(() => undefined)
    return { accion: 'error', detalle: error.message }
  }
}

export interface EstadoDeTerminos {
  actualizadoAt: string | null
  sincronizando: boolean
  error: string | null
  desde: string | null
  hasta: string | null
  filas: number
}

export async function estadoDeTerminos(perfilId: string): Promise<EstadoDeTerminos> {
  const s = await leerSync(perfilId)
  const { count } = await createServiceClient().from('ads_terminos').select('termino', { count: 'exact', head: true }).eq('perfil_id', perfilId)
  return { actualizadoAt: s?.ultimo_ok_at ?? null, sincronizando: s?.estado === 'esperando', error: s?.error ?? null, desde: s?.desde ?? null, hasta: s?.hasta ?? null, filas: count ?? 0 }
}

/** Los términos guardados de la cuenta (PostgREST devuelve como mucho 1.000 por consulta: se pagina) */
export async function leerTerminos(perfilId: string): Promise<FilaDeTermino[]> {
  const salida: FilaDeTermino[] = []
  const service = createServiceClient()
  for (let desde = 0; desde < MAX_TERMINOS_GUARDADOS; desde += 1000) {
    const { data, error } = await service
      .from('ads_terminos')
      .select('campaign_id, ad_group_id, termino, keyword, match_type, campaign_nombre, impresiones, clics, gasto, ventas, pedidos')
      .eq('perfil_id', perfilId)
      .order('gasto', { ascending: false })
      .range(desde, desde + 999)
    if (error) throw error
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      salida.push({
        termino: String(r.termino),
        campaignId: String(r.campaign_id),
        campaignName: String(r.campaign_nombre),
        adGroupId: String(r.ad_group_id ?? ''),
        keyword: (r.keyword as string | null) ?? null,
        matchType: (r.match_type as string | null) ?? null,
        impresiones: Number(r.impresiones),
        clics: Number(r.clics),
        gasto: Number(r.gasto),
        ventas: Number(r.ventas),
        compras: Number(r.pedidos),
      })
    }
    if (!data || data.length < 1000) break
  }
  return salida
}
