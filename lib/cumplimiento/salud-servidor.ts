/**
 * CUMPLIMIENTO · LA SALUD DE LA CUENTA: PEDIR, ESPERAR Y GUARDAR EL INFORME DE AMAZON. SOLO SERVIDOR. Solo LEE de Amazon. Migración 339 (`cuenta_salud`).
 *
 * Un informe de Amazon es una máquina de estados (lib/plataforma/amazon/informes.ts): se pide, se espera y se descarga. Aquí, una fila por cuenta y país guarda por
 * dónde va, y cada pasada del proceso horario `cumplimiento` da el paso que toque:
 *   · sin fila, o con la lectura de hace más de 20 h y nada pedido → se pide (GET_V2_SELLER_PERFORMANCE_REPORT);
 *   · pedido → se pregunta: DONE → se descarga, se interpreta (lib/cumplimiento/salud.ts) y se guarda SOLO lo interpretado; CANCELLED/FATAL → error.
 * Sin el rol «Selling Partner Insights» en la app de Amazon, createReport da 403: se guarda el error con esa explicación y se reintenta al día siguiente.
 * El contenido del informe nunca se escribe en disco (regla de Amazon): se lee en memoria.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { connectionCredentials } from '@/lib/amazon/data'
import { AmazonApiError } from '@/lib/amazon/errors'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { consultarInforme, descargarInforme, pedirInforme } from '@/lib/plataforma/amazon/informes'
import { saludDeInforme, type SaludDeCuenta } from './salud'
import { conexionesDeCliente } from './conexiones'

export const INFORME_SALUD = 'GET_V2_SELLER_PERFORMANCE_REPORT'
const CADA_MS = 20 * 3_600_000
/** Un pedido que lleva más de esto sin terminar se da por perdido y se vuelve a pedir */
const PEDIDO_CADUCA_MS = 6 * 3_600_000

export interface FilaDeSalud {
  connection_id: string
  marketplace_id: string
  report_id: string | null
  estado: 'pedido' | 'listo' | 'error'
  pedido_at: string | null
  leido_at: string | null
  datos: SaludDeCuenta | null
  error: string | null
}

const explicar = (e: unknown): string => {
  if (e instanceof AmazonApiError && e.kind === 'permisos') return 'Amazon no deja leer el informe de rendimiento: a la app del ERP le falta el rol «Selling Partner Insights» (o el cliente no lo ha autorizado).'
  if (e instanceof AmazonApiError) return e.humanMessage ?? e.message
  return e instanceof Error ? e.message : String(e)
}

/** Da el paso que toque para una cuenta y país. Devuelve qué ha hecho */
export async function avanzarSalud(connectionId: string, marketplaceId: string, opciones: { forzar?: boolean } = {}): Promise<'pedido' | 'esperando' | 'listo' | 'error' | 'al-dia'> {
  const service = createServiceClient()
  const { data, error } = await service.from('cuenta_salud').select('*').eq('connection_id', connectionId).eq('marketplace_id', marketplaceId).maybeSingle()
  if (error) throw error
  const fila = data as FilaDeSalud | null
  const ahora = Date.now()
  const resuelta = await connectionCredentials(connectionId)
  if (!resuelta) return 'error'
  const creds = resuelta.credentials

  const pedidoVivo = fila?.estado === 'pedido' && fila.report_id && fila.pedido_at && ahora - Date.parse(fila.pedido_at) < PEDIDO_CADUCA_MS
  if (pedidoVivo) {
    try {
      const e = await consultarInforme(creds, fila!.report_id as string)
      if (e.estado === 'IN_QUEUE' || e.estado === 'IN_PROGRESS') return 'esperando'
      if (e.estado !== 'DONE' || !e.documentId) {
        await service.from('cuenta_salud').update({ estado: 'error', error: e.estado === 'CANCELLED' ? 'Amazon no tiene datos de rendimiento de esta cuenta en este país.' : 'Amazon no ha podido generar el informe.' }).eq('connection_id', connectionId).eq('marketplace_id', marketplaceId)
        return 'error'
      }
      const doc = await descargarInforme(creds, e.documentId)
      const salud = saludDeInforme(JSON.parse(doc.texto), marketplaceId)
      await service.from('cuenta_salud').update({ estado: 'listo', datos: salud, leido_at: new Date().toISOString(), error: null }).eq('connection_id', connectionId).eq('marketplace_id', marketplaceId)
      return 'listo'
    } catch (e) {
      await service.from('cuenta_salud').update({ estado: 'error', error: explicar(e) }).eq('connection_id', connectionId).eq('marketplace_id', marketplaceId)
      return 'error'
    }
  }

  const ultima = fila?.leido_at ? Date.parse(fila.leido_at) : 0
  const ultimoIntento = fila?.pedido_at ? Date.parse(fila.pedido_at) : 0
  if (!opciones.forzar && (ahora - ultima < CADA_MS || ahora - ultimoIntento < CADA_MS)) return 'al-dia'
  try {
    const p = await pedirInforme(creds, { tipo: INFORME_SALUD, marketplaceId })
    await service.from('cuenta_salud').upsert({ connection_id: connectionId, marketplace_id: marketplaceId, report_id: p.reportId, estado: 'pedido', pedido_at: new Date().toISOString(), error: null }, { onConflict: 'connection_id,marketplace_id' })
    return 'pedido'
  } catch (e) {
    await service.from('cuenta_salud').upsert({ connection_id: connectionId, marketplace_id: marketplaceId, estado: 'error', pedido_at: new Date().toISOString(), error: explicar(e) }, { onConflict: 'connection_id,marketplace_id' })
    return 'error'
  }
}

/** Las cuentas y países activos (los que el cliente tiene en marcha) */
async function cuentasYPaises(): Promise<Array<{ connectionId: string; marketplaceId: string }>> {
  const { data, error } = await createServiceClient().from('amazon_connections').select('id, marketplace_ids, marketplaces_activos').eq('is_active', true).eq('status', 'activa')
  if (error) throw error
  return ((data ?? []) as Array<{ id: string; marketplace_ids: string[] | null; marketplaces_activos: string[] | null }>).flatMap((c) => (c.marketplaces_activos?.length ? c.marketplaces_activos : (c.marketplace_ids ?? [])).map((m) => ({ connectionId: c.id, marketplaceId: m })))
}

/** Una pasada para todas las cuentas (proceso horario `cumplimiento`). Sin la migración 339, no hace nada */
export async function avanzarSaludDeTodas(presupuestoMs: number): Promise<{ pedidos: number; listos: number; errores: number; sinMigracion?: true }> {
  const arranque = Date.now()
  const { error } = await createServiceClient().from('cuenta_salud').select('connection_id').limit(1)
  if (error) {
    if (isMissingSchema(error)) return { pedidos: 0, listos: 0, errores: 0, sinMigracion: true }
    throw error
  }
  const total = { pedidos: 0, listos: 0, errores: 0 }
  for (const c of await cuentasYPaises()) {
    if (Date.now() - arranque > presupuestoMs) break
    const r = await avanzarSalud(c.connectionId, c.marketplaceId).catch(() => 'error' as const)
    if (r === 'pedido') total.pedidos++
    else if (r === 'listo') total.listos++
    else if (r === 'error') total.errores++
  }
  return total
}

export interface SaludParaPantalla {
  marketplaceId: string
  estado: FilaDeSalud['estado'] | 'nunca'
  leidoAt: string | null
  datos: SaludDeCuenta | null
  error: string | null
}

/** La salud de las cuentas de un cliente (de un país o de todos). null sin la migración 339 */
export async function saludDeCliente(amazonClientId: string, mercado: string | null): Promise<SaludParaPantalla[] | null> {
  const conexiones = await conexionesDeCliente(amazonClientId)
  if (conexiones.length === 0) return []
  let q = createServiceClient().from('cuenta_salud').select('*').in('connection_id', conexiones.map((c) => c.id))
  if (mercado) q = q.eq('marketplace_id', mercado)
  const { data, error } = await q
  if (error) {
    if (isMissingSchema(error)) return null
    throw error
  }
  const filas = (data ?? []) as FilaDeSalud[]
  const paises = mercado ? [mercado] : [...new Set(conexiones.flatMap((c) => (c.marketplaces_activos?.length ? c.marketplaces_activos : c.marketplace_ids)))]
  return paises.map((m) => {
    const f = filas.find((x) => x.marketplace_id === m)
    return { marketplaceId: m, estado: f?.estado ?? 'nunca', leidoAt: f?.leido_at ?? null, datos: f?.datos ?? null, error: f?.error ?? null }
  })
}

/** «Actualizar ahora» desde la pantalla: pide el informe de las cuentas del cliente (en ese país o en todos) y, si ya estaba pedido, pregunta */
export async function pedirSaludDeCliente(amazonClientId: string, mercado: string | null): Promise<number> {
  const conexiones = await conexionesDeCliente(amazonClientId)
  let n = 0
  for (const c of conexiones) {
    const paises = mercado ? [mercado] : c.marketplaces_activos?.length ? c.marketplaces_activos : c.marketplace_ids
    for (const m of paises) {
      const r = await avanzarSalud(c.id, m, { forzar: true }).catch(() => 'error')
      if (r !== 'error') n++
    }
  }
  return n
}
