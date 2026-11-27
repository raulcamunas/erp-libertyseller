import 'server-only'
import { connectionCredentials } from '@/lib/amazon/data'
import { spApiRequest } from '@/lib/amazon/sp-api'
import { tiposDeCambio } from '@/lib/divisas/servidor'
import { createServiceClient } from '@/lib/supabase/service'
import { aEuros } from './lectura'
import { TIPOS_FLUJO, type ApunteFlujo, type PagoAmazon, type TipoFlujo } from './flujo'

/**
 * VENTAS · FLUJO DE CAJA — SOLO SERVIDOR. Los pagos de Amazon salen de las liquidaciones (Finances API v0, financialEventGroups): cada una con
 * su inicio, su fin, lo que se transfirió al banco y cuándo. Se leen en el cron de ventas cada 6 horas (y al pulsar «Leer ahora»). Los apuntes a
 * mano van en `ventas_flujo`. Tablas de la migración 352: sin ella la página avisa y no guarda nada.
 */

type Importe = { CurrencyCode?: string; CurrencyAmount?: number } | undefined
interface GrupoAmazon {
  FinancialEventGroupId?: string
  ProcessingStatus?: string
  FundTransferStatus?: string
  OriginalTotal?: Importe
  ConvertedTotal?: Importe
  FundTransferDate?: string
  AccountTail?: string
  FinancialEventGroupStart?: string
  FinancialEventGroupEnd?: string
}

const faltaTabla = (e: { code?: string; message?: string } | null) => Boolean(e && (e.code === '42P01' || e.code === 'PGRST205' || e.code === '42703' || /does not exist|schema cache/i.test(e.message ?? '')))
const dia = (x: string | null | undefined) => (x ? x.slice(0, 10) : null)
const DIA_MS = 86_400_000

/** Lee de Amazon las liquidaciones de una cuenta (los últimos ~2 años) y las guarda. Devuelve cuántas */
export async function leerPagosDeAmazon(connectionId: string, creds?: Parameters<typeof spApiRequest>[0]): Promise<number> {
  const service = createServiceClient()
  let credenciales = creds
  if (!credenciales) {
    const r = await connectionCredentials(connectionId)
    if (!r) throw new Error('La cuenta no tiene conexión con Amazon.')
    credenciales = r.credentials
  }
  const { porEuro } = await tiposDeCambio()
  // EN TRAMOS DE 90 DÍAS (con inicio y fin): pedido de una vez, Amazon devolvía solo las primeras ~100 y la cuenta se quedaba en enero
  const porId = new Map<string, GrupoAmazon>()
  const fin = Date.now() - 3 * 60_000
  for (let desde = fin - 700 * DIA_MS; desde < fin; desde += 90 * DIA_MS) {
    const hasta = Math.min(fin, desde + 90 * DIA_MS)
    let siguiente: string | undefined
    let paginas = 0
    do {
      const { data } = await spApiRequest<{ payload?: { FinancialEventGroupList?: GrupoAmazon[]; NextToken?: string } }>(credenciales, 'listFinancialEventGroups', {
        method: 'GET',
        path: '/finances/v0/financialEventGroups',
        query: siguiente
          ? { NextToken: siguiente, MaxResultsPerPage: '100', FinancialEventGroupStartedAfter: new Date(desde).toISOString(), FinancialEventGroupStartedBefore: new Date(hasta).toISOString() }
          : { MaxResultsPerPage: '100', FinancialEventGroupStartedAfter: new Date(desde).toISOString(), FinancialEventGroupStartedBefore: new Date(hasta).toISOString() },
        maxAttempts: 4,
      })
      for (const g of data?.payload?.FinancialEventGroupList ?? []) if (g.FinancialEventGroupId) porId.set(g.FinancialEventGroupId, g)
      siguiente = data?.payload?.NextToken
      paginas++
    } while (siguiente && paginas < 20)
  }
  const grupos = [...porId.values()]
  const ahora = new Date().toISOString()
  const filas = grupos
    .filter((g) => g.FinancialEventGroupId)
    .map((g) => {
      const total = g.OriginalTotal ?? g.ConvertedTotal
      const importe = Number(total?.CurrencyAmount ?? 0) || 0
      const moneda = total?.CurrencyCode ?? null
      return {
        connection_id: connectionId,
        grupo: g.FinancialEventGroupId as string,
        inicio: g.FinancialEventGroupStart ?? null,
        fin: g.FinancialEventGroupEnd ?? null,
        fecha_pago: g.FundTransferDate ?? null,
        estado: g.ProcessingStatus ?? null,
        estado_pago: g.FundTransferStatus ?? null,
        importe: Math.round(importe * 100) / 100,
        moneda,
        importe_eur: Math.round(aEuros(importe, moneda, porEuro) * 100) / 100,
        cuenta_banco: g.AccountTail ?? null,
        actualizado_at: ahora,
      }
    })
  // `oculto` no se toca: lo que se borró en la página sigue borrado
  for (let i = 0; i < filas.length; i += 500) {
    const { error } = await service.from('ventas_pagos').upsert(filas.slice(i, i + 500), { onConflict: 'connection_id,grupo' })
    if (error) throw error
  }
  const { error } = await service.from('ventas_cuentas').update({ pagos_leido_at: ahora }).eq('connection_id', connectionId)
  if (error && !faltaTabla(error)) throw error
  return filas.length
}

export interface FlujoDeCuenta {
  hayTabla: boolean
  leidoAt: string | null
  pagos: PagoAmazon[]
  apuntes: ApunteFlujo[]
}

export async function flujoDeCuenta(connectionId: string): Promise<FlujoDeCuenta> {
  const s = createServiceClient()
  const [p, a, c] = await Promise.all([
    s.from('ventas_pagos').select('grupo, inicio, fin, fecha_pago, estado, estado_pago, importe, moneda, importe_eur, oculto').eq('connection_id', connectionId).order('inicio').limit(5000),
    s.from('ventas_flujo').select('id, fecha, descripcion, tipo, importe').eq('connection_id', connectionId).order('fecha').limit(10000),
    s.from('ventas_cuentas').select('pagos_leido_at').eq('connection_id', connectionId).maybeSingle(),
  ])
  if (faltaTabla(p.error) || faltaTabla(a.error)) return { hayTabla: false, leidoAt: null, pagos: [], apuntes: [] }
  if (p.error) throw p.error
  if (a.error) throw a.error
  const pagos = ((p.data ?? []) as Array<Record<string, unknown>>).map((x) => ({
    grupo: String(x.grupo),
    inicio: dia(x.inicio as string | null),
    fin: dia(x.fin as string | null),
    fechaPago: dia(x.fecha_pago as string | null),
    abierto: String(x.estado ?? '').toLowerCase() !== 'closed' || !x.fin,
    importe: Number(x.importe_eur ?? 0),
    importeOriginal: Number(x.importe ?? 0),
    moneda: (x.moneda as string | null) ?? null,
    estadoPago: (x.estado_pago as string | null) ?? null,
    oculto: Boolean(x.oculto),
  }))
  const apuntes = ((a.data ?? []) as Array<Record<string, unknown>>).map((x) => ({ id: String(x.id), fecha: String(x.fecha), descripcion: String(x.descripcion ?? ''), tipo: x.tipo as TipoFlujo, importe: Number(x.importe) }))
  return { hayTabla: true, leidoAt: ((c.data as { pagos_leido_at?: string | null } | null)?.pagos_leido_at as string | null) ?? null, pagos, apuntes }
}

export function apunteValido(x: unknown): Omit<ApunteFlujo, 'id'> | null {
  if (!x || typeof x !== 'object') return null
  const o = x as Record<string, unknown>
  const fecha = String(o.fecha ?? '')
  const tipo = String(o.tipo ?? '') as TipoFlujo
  const importe = Number(o.importe)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !TIPOS_FLUJO.includes(tipo) || !Number.isFinite(importe) || Math.abs(importe) > 1e10) return null
  return { fecha, tipo, importe: Math.round(importe * 100) / 100, descripcion: String(o.descripcion ?? '').slice(0, 300) }
}

export async function guardarApuntes(connectionId: string, apuntes: Array<Omit<ApunteFlujo, 'id'>>, userId: string): Promise<number> {
  const s = createServiceClient()
  const filas = apuntes.map((a) => ({ connection_id: connectionId, ...a, created_by: userId }))
  for (let i = 0; i < filas.length; i += 500) {
    const { error } = await s.from('ventas_flujo').insert(filas.slice(i, i + 500))
    if (error) throw error
  }
  return filas.length
}

export async function editarApunte(connectionId: string, id: string, apunte: Omit<ApunteFlujo, 'id'>): Promise<void> {
  const { error } = await createServiceClient().from('ventas_flujo').update(apunte).eq('connection_id', connectionId).eq('id', id)
  if (error) throw error
}

export async function borrarApunte(connectionId: string, id: string): Promise<void> {
  const { error } = await createServiceClient().from('ventas_flujo').delete().eq('connection_id', connectionId).eq('id', id)
  if (error) throw error
}

/** «Borrar» un pago de Amazon: deja de contar, pero no se vuelve a crear al releer. `oculto=false` lo recupera */
export async function ocultarPago(connectionId: string, grupo: string, oculto: boolean): Promise<void> {
  const { error } = await createServiceClient().from('ventas_pagos').update({ oculto }).eq('connection_id', connectionId).eq('grupo', grupo)
  if (error) throw error
}
