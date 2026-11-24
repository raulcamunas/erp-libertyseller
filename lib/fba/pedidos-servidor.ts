import { connectionCredentials } from '@/lib/amazon/data'
import { AmazonApiError } from '@/lib/amazon/errors'
import { spApiRequest } from '@/lib/amazon/sp-api'
import { consultarInforme, descargarInforme } from '@/lib/plataforma/amazon/informes'
import { createServiceClient } from '@/lib/supabase/service'
import { diasQueSeReemplazan, INFORME_PEDIDOS, parsearPedidos, siguienteTramo, zonaDeMercado } from './pedidos'
import { faltaLaTabla } from './planificacion'

/**
 * LA PASADA QUE LEE LAS VENTAS POR CANAL (FBA Y FBM) — SOLO SERVIDOR. Lo puro está en pedidos.ts.
 * =================================================================================================
 * Las cuentas que se leen son las del libro mayor (`fba_lecturas`): las que tienen remesas o stock en FBA. Cada una es una máquina de dos pasos,
 * como los informes de Amazon Ads: en una pasada se PIDE el informe (apuntando su id en `fba_ventas_canal_lecturas`) y en las siguientes se
 * RECOGE cuando está. Así la pasada nunca se queda esperando a que Amazon lo genere (tarda de uno a quince minutos).
 *
 * Al recogerlo, se borran los días que el tramo cubre enteros y se vuelven a escribir (un pedido pendiente puede cancelarse días después).
 * La primera vez se traen 6 meses, de 30 en 30 días (lo que deja pedir Amazon por informe); al día, se relee cada 6 horas.
 *
 * Solo LEE de Amazon. Nunca guarda nada del comprador.
 */

type Servicio = ReturnType<typeof createServiceClient>

interface FilaLectura {
  connection_id: string
  marketplace_id: string
  leido_desde: string | null
  leido_hasta: string | null
  leido_at: string | null
  informe_id: string | null
  informe_desde: string | null
  informe_hasta: string | null
  informe_pedido_at: string | null
  ultimo_error: string | null
  updated_at: string | null
}

/** Un informe que lleva más de esto sin estar listo se da por perdido y se vuelve a pedir */
const INFORME_PERDIDO_MS = 45 * 60_000
const TROZO = 500
const ESPERA_TRAS_FALLO_MS = 60 * 60_000

function mensajeDe(e: unknown): string {
  if (e instanceof AmazonApiError) {
    if (e.httpStatus === 403) return 'Amazon no deja leer los pedidos de esta cuenta: a la aplicación le falta el permiso de pedidos (rol «Inventario y seguimiento de pedidos»)'
    return e.humanMessage.slice(0, 280)
  }
  return (e instanceof Error ? e.message : String(e)).slice(0, 280)
}

async function guardarEstado(service: Servicio, conexion: string, mercado: string, cambios: Record<string, unknown>): Promise<void> {
  const { error } = await service
    .from('fba_ventas_canal_lecturas')
    .upsert({ connection_id: conexion, marketplace_id: mercado, ...cambios, updated_at: new Date().toISOString() }, { onConflict: 'connection_id,marketplace_id' })
  if (error) throw error
}

export interface ResultadoPasadaPedidos {
  cuentas: number
  pedidos: number
  recogidos: number
  filas: number
  avisos: string[]
  sinTabla?: boolean
}

export async function pasadaPedidos(service: Servicio, presupuestoMs: number, ahora = new Date()): Promise<ResultadoPasadaPedidos> {
  const arranque = Date.now()
  const salida: ResultadoPasadaPedidos = { cuentas: 0, pedidos: 0, recogidos: 0, filas: 0, avisos: [] }

  const { data: estados, error: errEstados } = await service.from('fba_ventas_canal_lecturas').select('*')
  if (errEstados) {
    if (faltaLaTabla(errEstados)) return { ...salida, sinTabla: true }
    throw errEstados
  }
  const estadoDe = new Map(((estados ?? []) as FilaLectura[]).map((e) => [`${e.connection_id}|${e.marketplace_id}`, e] as const))

  // Las cuentas: las del libro mayor, de conexiones activas
  const [{ data: lecturas, error: errL }, { data: activas, error: errA }] = await Promise.all([
    service.from('fba_lecturas').select('connection_id, marketplace_id'),
    service.from('amazon_connections').select('id').eq('is_active', true).eq('status', 'activa'),
  ])
  if (errL) throw errL
  if (errA) throw errA
  const vivas = new Set(((activas ?? []) as Array<{ id: string }>).map((c) => c.id))
  const cuentas = ((lecturas ?? []) as Array<{ connection_id: string; marketplace_id: string }>).filter((l) => vivas.has(l.connection_id))
  // Primero las que tienen un informe pendiente de recoger; después, las más atrasadas
  cuentas.sort((a, b) => {
    const ea = estadoDe.get(`${a.connection_id}|${a.marketplace_id}`)
    const eb = estadoDe.get(`${b.connection_id}|${b.marketplace_id}`)
    return Number(Boolean(eb?.informe_id)) - Number(Boolean(ea?.informe_id)) || (ea?.leido_hasta ?? '').localeCompare(eb?.leido_hasta ?? '')
  })
  salida.cuentas = cuentas.length

  for (const c of cuentas) {
    if (Date.now() - arranque > presupuestoMs) {
      salida.avisos.push('sin tiempo: quedan cuentas para la próxima pasada')
      break
    }
    const e = estadoDe.get(`${c.connection_id}|${c.marketplace_id}`) ?? null
    const zona = zonaDeMercado(c.marketplace_id)
    try {
      const resuelta = await connectionCredentials(c.connection_id)
      if (!resuelta) continue
      const creds = resuelta.credentials

      /* ---------- 1) Recoger el que está pendiente ---------- */
      if (e?.informe_id && e.informe_desde && e.informe_hasta) {
        const est = await consultarInforme(creds, e.informe_id)
        if (est.estado === 'IN_QUEUE' || est.estado === 'IN_PROGRESS') {
          if (e.informe_pedido_at && ahora.getTime() - Date.parse(e.informe_pedido_at) > INFORME_PERDIDO_MS) {
            await guardarEstado(service, c.connection_id, c.marketplace_id, { informe_id: null, ultimo_error: 'Amazon no terminó el informe de pedidos en 45 minutos: se vuelve a pedir' })
          }
          continue
        }
        if (est.estado === 'FATAL') {
          await guardarEstado(service, c.connection_id, c.marketplace_id, { informe_id: null, ultimo_error: `Amazon no ha podido generar el informe de pedidos (${e.informe_id})` })
          continue
        }
        const desde = new Date(e.informe_desde)
        const hasta = new Date(e.informe_hasta)
        // CANCELLED = no hay ningún pedido en el tramo: es un resultado (días a cero), no un fallo
        const leidas = est.estado === 'DONE' && est.documentId ? parsearPedidos((await descargarInforme(creds, est.documentId)).texto, zona) : { ventas: [], descartadas: 0, canceladas: 0 }
        const dias = diasQueSeReemplazan(desde, hasta, zona, new Date(e.informe_pedido_at ?? ahora))
        if (dias) {
          const { error: errBorrar } = await service
            .from('fba_ventas_canal')
            .delete()
            .eq('connection_id', c.connection_id)
            .eq('marketplace_id', c.marketplace_id)
            .gte('fecha', dias.desde)
            .lte('fecha', dias.hasta)
          if (errBorrar) throw errBorrar
          const filas = leidas.ventas
            .filter((v) => v.fecha >= dias.desde && v.fecha <= dias.hasta)
            .map((v) => ({ connection_id: c.connection_id, marketplace_id: c.marketplace_id, ...v }))
          for (let i = 0; i < filas.length; i += TROZO) {
            const { error } = await service.from('fba_ventas_canal').upsert(filas.slice(i, i + TROZO), { onConflict: 'connection_id,marketplace_id,fecha,sku,canal' })
            if (error) throw error
          }
          salida.filas += filas.length
        }
        const leidoHasta = dias && (!e.leido_hasta || dias.hasta > e.leido_hasta) ? dias.hasta : e.leido_hasta
        const leidoDesde = dias && (!e.leido_desde || dias.desde < e.leido_desde) ? dias.desde : e.leido_desde
        await guardarEstado(service, c.connection_id, c.marketplace_id, {
          informe_id: null, leido_hasta: leidoHasta, leido_desde: leidoDesde, leido_at: ahora.toISOString(),
          ultimo_error: leidas.descartadas > 0 ? `${leidas.descartadas} líneas del informe de pedidos no se han podido leer` : null,
        })
        salida.recogidos++
        continue
      }

      /* ---------- 2) Pedir el siguiente tramo ---------- */
      // Tras un fallo se espera una hora antes de volver a pedir: un permiso que falta no se arregla en 5 minutos y cada intento gasta cupo
      if (e?.ultimo_error && e.updated_at && ahora.getTime() - Date.parse(e.updated_at) < ESPERA_TRAS_FALLO_MS) continue
      const tramo = siguienteTramo({ leidoDesde: e?.leido_desde ?? null, leidoHasta: e?.leido_hasta ?? null, leidoAt: e?.leido_at ?? null }, ahora)
      if (!tramo) continue
      const { data } = await spApiRequest<{ reportId?: string }>(creds, 'createReport', {
        method: 'POST',
        path: '/reports/2021-06-30/reports',
        body: { reportType: INFORME_PEDIDOS, marketplaceIds: [c.marketplace_id], dataStartTime: tramo.desde.toISOString(), dataEndTime: tramo.hasta.toISOString() },
        repeatable: false,
        maxAttempts: 1,
      })
      if (!data.reportId) throw new Error('Amazon ha aceptado el informe de pedidos sin devolver su identificador')
      await guardarEstado(service, c.connection_id, c.marketplace_id, {
        informe_id: data.reportId, informe_desde: tramo.desde.toISOString(), informe_hasta: tramo.hasta.toISOString(), informe_pedido_at: ahora.toISOString(),
      })
      salida.pedidos++
    } catch (err) {
      const msg = mensajeDe(err)
      salida.avisos.push(`${c.connection_id}/${c.marketplace_id}: ${msg}`)
      await guardarEstado(service, c.connection_id, c.marketplace_id, { informe_id: null, ultimo_error: msg }).catch(() => undefined)
    }
  }
  return salida
}
