/**
 * AMAZON ADS · LAS VENTAS TOTALES DE CADA PRODUCTO (orgánicas + publicidad), para el TACoS de Marketing Test.
 * SOLO SERVIDOR. Solo LEE de Amazon (SP-API, de la cuenta de VENDEDOR del mismo cliente y país).
 *
 * TACoS = gasto en publicidad ÷ ventas TOTALES. Amazon Ads solo sabe lo que vende la publicidad; lo total sale del informe de Ventas y tráfico de Seller Central (GET_SALES_AND_TRAFFIC_REPORT, por ASIN
 * hijo). Ese informe da el periodo ENTERO por ASIN (no día a día), así que se piden tres —los últimos 7, 14 y 30 días hasta ayer, los mismos periodos que la pantalla— una vez al día.
 *
 * Máquina de estados en ads_ventas_sync (migración 298), como el resto: reposo → pide los tres → esperando → los recoge en una pasada posterior → reposo. Nunca espera a Amazon.
 * Exige el rol Brand Analytics en la app de Amazon del ERP (el mismo que SEO Test).
 */

import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { connectionCredentials } from '@/lib/amazon/data'
import { spApiRequest } from '@/lib/amazon/sp-api'
import { AmazonApiError } from '@/lib/amazon/errors'
import { consultarInforme, descargarInforme } from '@/lib/plataforma/amazon/informes'
import { marketplaceDePais } from './cuenta'
import { SIN_VENDEDOR } from './tacos'

export const PERIODOS_VENTAS = [7, 14, 30] as const
const CADA_MS = 20 * 3_600_000
const REINTENTO_MS = 6 * 3_600_000
const ESPERA_MAXIMA_MS = 60 * 60_000
const DIA_MS = 86_400_000

export interface VentaDeAsin {
  asin: string
  ventas: number
  unidades: number
  pedidos: number
  sesiones: number
  moneda: string | null
}

const n = (v: unknown) => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

/** Del JSON del informe a una fila por ASIN hijo (las repetidas se suman). Puro, para probarlo sin red */
export function ventasDeInforme(json: unknown): VentaDeAsin[] {
  const filas = ((json as { salesAndTrafficByAsin?: unknown[] } | null)?.salesAndTrafficByAsin ?? []) as Array<Record<string, unknown>>
  const por = new Map<string, VentaDeAsin>()
  for (const f of filas) {
    const asin = String(f.childAsin ?? f.parentAsin ?? '').toUpperCase()
    if (!/^[A-Z0-9]{10}$/.test(asin)) continue
    const s = (f.salesByAsin ?? {}) as Record<string, unknown>
    const t = (f.trafficByAsin ?? {}) as Record<string, unknown>
    const importe = (s.orderedProductSales ?? {}) as { amount?: unknown; currencyCode?: unknown }
    const x = por.get(asin) ?? { asin, ventas: 0, unidades: 0, pedidos: 0, sesiones: 0, moneda: null }
    x.ventas += n(importe.amount)
    x.unidades += n(s.unitsOrdered)
    x.pedidos += n(s.totalOrderItems)
    x.sesiones += n(t.sessions)
    x.moneda = x.moneda ?? (typeof importe.currencyCode === 'string' ? importe.currencyCode : null)
    por.set(asin, x)
  }
  return [...por.values()]
}

const desplazar = (dia: string, dias: number) => new Date(Date.parse(`${dia}T00:00:00Z`) + dias * DIA_MS).toISOString().slice(0, 10)

interface Estado {
  estado: 'reposo' | 'esperando'
  informes: Array<{ id: string; dias: number; desde: string; hasta: string }>
  pedido_at: string | null
  ultimo_ok_at: string | null
  error: string | null
  intentos: number
}

/** La conexión de vendedor del cliente de esta cuenta de anunciante, y el marketplace de su país */
async function vendedorDe(perfilId: string): Promise<{ connectionId: string; marketplaceId: string } | null> {
  const service = createServiceClient()
  const { data } = await service.from('ads_profiles').select('pais, ads_connections(client_id)').eq('id', perfilId).maybeSingle()
  const d = data as { pais: string | null; ads_connections: { client_id: string } | { client_id: string }[] | null } | null
  const con = Array.isArray(d?.ads_connections) ? d?.ads_connections[0] : d?.ads_connections
  const marketplaceId = d?.pais ? marketplaceDePais(d.pais) : null
  if (!con?.client_id || !marketplaceId) return null
  const { data: conexiones } = await service.from('amazon_connections').select('id, marketplace_ids').eq('client_id', con.client_id).eq('is_active', true)
  const c = ((conexiones ?? []) as Array<{ id: string; marketplace_ids: string[] | null }>).find((x) => (x.marketplace_ids ?? []).includes(marketplaceId)) ?? ((conexiones ?? []) as Array<{ id: string }>)[0]
  return c ? { connectionId: c.id, marketplaceId } : null
}

async function guardarEstado(perfilId: string, cambios: Partial<Estado>) {
  const { error } = await createServiceClient().from('ads_ventas_sync').upsert({ perfil_id: perfilId, ...cambios, updated_at: new Date().toISOString() }, { onConflict: 'perfil_id' })
  if (error) throw error
}

/** ¿Le toca algo a esta cuenta? (barato: solo la base) */
export async function ventasConTrabajo(perfilIds: readonly string[]): Promise<string[]> {
  if (perfilIds.length === 0) return []
  const { data, error } = await createServiceClient().from('ads_ventas_sync').select('perfil_id, estado, ultimo_ok_at, pedido_at, error').in('perfil_id', [...perfilIds])
  if (error) {
    if (isMissingSchema(error)) return []
    throw error
  }
  const por = new Map(((data ?? []) as Array<{ perfil_id: string; estado: string; ultimo_ok_at: string | null; pedido_at: string | null; error: string | null }>).map((r) => [r.perfil_id, r]))
  const ahora = Date.now()
  return perfilIds.filter((id) => {
    const e = por.get(id)
    if (!e) return true
    if (e.estado === 'esperando') return true
    if (e.error && e.pedido_at && ahora - Date.parse(e.pedido_at) < REINTENTO_MS) return false
    return !e.ultimo_ok_at || ahora - Date.parse(e.ultimo_ok_at) >= CADA_MS
  })
}

/** Un paso: pedir los tres informes, o recogerlos. Nunca espera a Amazon */
export async function avanzarVentas(perfilId: string): Promise<'nada' | 'pedido' | 'esperando' | 'guardado' | 'error' | 'sin-vendedor'> {
  const service = createServiceClient()
  const { data, error } = await service.from('ads_ventas_sync').select('estado, informes, pedido_at, ultimo_ok_at, error, intentos').eq('perfil_id', perfilId).maybeSingle()
  if (error) {
    if (isMissingSchema(error)) return 'nada'
    throw error
  }
  const e = data as Estado | null
  const vendedor = await vendedorDe(perfilId)
  if (!vendedor) return 'sin-vendedor'
  const resuelta = await connectionCredentials(vendedor.connectionId)
  if (!resuelta) return 'sin-vendedor'
  const ahora = Date.now()

  try {
    if (e?.estado === 'esperando' && e.informes.length > 0) {
      if (e.pedido_at && ahora - Date.parse(e.pedido_at) > ESPERA_MAXIMA_MS) {
        await guardarEstado(perfilId, { estado: 'reposo', informes: [], error: 'Amazon ha tardado más de una hora en preparar el informe de ventas.', intentos: (e.intentos ?? 0) + 1, pedido_at: new Date(ahora).toISOString() })
        return 'error'
      }
      const estados = await Promise.all(e.informes.map((i) => consultarInforme(resuelta.credentials, i.id)))
      if (estados.some((s) => s.estado === 'FATAL' || s.estado === 'CANCELLED')) {
        await guardarEstado(perfilId, { estado: 'reposo', informes: [], error: 'Amazon no ha podido generar el informe de Ventas y tráfico (¿la cuenta no tiene Brand Registry en este país?).', intentos: (e.intentos ?? 0) + 1, pedido_at: new Date(ahora).toISOString() })
        return 'error'
      }
      if (!estados.every((s) => s.estado === 'DONE' && s.documentId)) return 'esperando'
      for (let i = 0; i < e.informes.length; i++) {
        const inf = e.informes[i]
        const doc = await descargarInforme(resuelta.credentials, estados[i].documentId as string)
        const filas = ventasDeInforme(JSON.parse(doc.texto))
        await service.from('ads_ventas_asin').delete().eq('perfil_id', perfilId).eq('dias', inf.dias)
        if (filas.length > 0) {
          const { error: eIns } = await service.from('ads_ventas_asin').insert(filas.map((f) => ({ perfil_id: perfilId, dias: inf.dias, asin: f.asin, desde: inf.desde, hasta: inf.hasta, ventas: Number(f.ventas.toFixed(2)), unidades: Math.round(f.unidades), pedidos: Math.round(f.pedidos), sesiones: Math.round(f.sesiones), moneda: f.moneda, leido_at: new Date().toISOString() })))
          if (eIns) throw eIns
        }
      }
      await guardarEstado(perfilId, { estado: 'reposo', informes: [], ultimo_ok_at: new Date().toISOString(), error: null, intentos: 0 })
      return 'guardado'
    }

    // En reposo: tres informes, los últimos 7, 14 y 30 días hasta ayer
    const hasta = desplazar(new Date().toISOString().slice(0, 10), -1)
    const informes: Estado['informes'] = []
    for (const dias of PERIODOS_VENTAS) {
      const desde = desplazar(hasta, -(dias - 1))
      const { data: r } = await spApiRequest<{ reportId?: string }>(resuelta.credentials, 'createReport', {
        method: 'POST',
        path: '/reports/2021-06-30/reports',
        body: { reportType: 'GET_SALES_AND_TRAFFIC_REPORT', marketplaceIds: [vendedor.marketplaceId], dataStartTime: `${desde}T00:00:00Z`, dataEndTime: `${hasta}T23:59:59Z`, reportOptions: { dateGranularity: 'DAY', asinGranularity: 'CHILD' } },
        repeatable: false,
        maxAttempts: 1,
      })
      if (!r.reportId) throw new Error('Amazon ha aceptado el informe pero no ha dado su identificador.')
      informes.push({ id: r.reportId, dias, desde, hasta })
    }
    await guardarEstado(perfilId, { estado: 'esperando', informes, pedido_at: new Date(ahora).toISOString(), error: null })
    return 'pedido'
  } catch (err) {
    if (isMissingSchema(err)) throw err
    const texto =
      err instanceof AmazonApiError && err.kind === 'permisos'
        ? 'Sin acceso al informe de Ventas y tráfico: a la app de Amazon del ERP le falta el rol Brand Analytics.'
        : err instanceof AmazonApiError
          ? err.humanMessage
          : err instanceof Error
            ? err.message
            : String(err)
    await guardarEstado(perfilId, { estado: 'reposo', informes: [], error: texto.slice(0, 500), intentos: (e?.intentos ?? 0) + 1, pedido_at: new Date(ahora).toISOString() }).catch(() => undefined)
    return 'error'
  }
}

/** Las ventas totales guardadas de un periodo, por ASIN (vacío si aún no se han leído o falta la migración). Si no hay nada y es porque falta la cuenta de vendedor, lo dice en `error` */
export async function ventasTotales(perfilId: string, dias: number): Promise<{ porAsin: Record<string, VentaDeAsin>; leidoAt: string | null; error: string | null }> {
  const service = createServiceClient()
  const [{ data, error }, { data: sync }] = await Promise.all([
    service.from('ads_ventas_asin').select('asin, ventas, unidades, pedidos, sesiones, moneda, leido_at').eq('perfil_id', perfilId).eq('dias', dias).limit(5000),
    service.from('ads_ventas_sync').select('error, ultimo_ok_at').eq('perfil_id', perfilId).maybeSingle(),
  ])
  if (error) {
    if (isMissingSchema(error)) return { porAsin: {}, leidoAt: null, error: null }
    throw error
  }
  const porAsin: Record<string, VentaDeAsin> = {}
  let leidoAt: string | null = null
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    porAsin[String(r.asin)] = { asin: String(r.asin), ventas: n(r.ventas), unidades: n(r.unidades), pedidos: n(r.pedidos), sesiones: n(r.sesiones), moneda: (r.moneda as string | null) ?? null }
    leidoAt = leidoAt ?? (r.leido_at as string)
  }
  const s = sync as { error: string | null; ultimo_ok_at: string | null } | null
  if (!s && Object.keys(porAsin).length === 0 && !(await vendedorDe(perfilId))) return { porAsin, leidoAt: null, error: SIN_VENDEDOR }
  return { porAsin, leidoAt: s?.ultimo_ok_at ?? leidoAt, error: s?.error ?? null }
}
