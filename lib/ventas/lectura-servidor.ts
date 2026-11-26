/**
 * VENTAS (EL «SELLERBOARD» PROPIO) · LA PASADA QUE LEE DE AMAZON. SOLO SERVIDOR. Lo puro está en lectura.ts.
 * ==========================================================================================================
 * Cada 5 minutos (cron «ventas»), para cada cuenta de `ventas_cuentas`, UN poco de cada cosa y sin esperar nunca a Amazon:
 *
 *   1. Pedidos: pide el informe de pedidos o recoge el que pidió en una pasada anterior. La primera vez trae 62 días (en dos tramos de 31); después,
 *      cada 10 minutos, los 2 últimos días (un pendiente puede cancelarse o enviarse más tarde).
 *   2. Dinero: lee los movimientos de Amazon por tramos de 10 días (la primera vez, 62 días hacia delante). Al día, cada hora, los 3 últimos días.
 *      Las comisiones reales se apuntan en su línea de pedido; reembolsos, tarifas de la cuenta y ajustes van a `ventas_movimientos` (con clave: releer
 *      no duplica).
 *   3. Publicidad: pide (o recoge) el informe diario de producto anunciado de cada país con Amazon Ads. Cada 3 horas, los 3 últimos días.
 *   4. Si algo ha cambiado, rehace el resumen (`ventas_dia`) de los últimos 62 días y poda lo que ya no hace falta.
 *
 * Ocupa poco: lo único que se queda es una fila por país × SKU × día. Solo LEE de Amazon; nunca guarda nada del comprador.
 */

import { gunzipSync } from 'node:zlib'
import { connectionCredentials } from '@/lib/amazon/data'
import { AmazonApiError } from '@/lib/amazon/errors'
import { spApiRequest } from '@/lib/amazon/sp-api'
import { llamarAds } from '@/lib/ads/datos'
import { AdsError } from '@/lib/ads/oauth'
import { tiposDeCambio } from '@/lib/divisas/servidor'
import { diaEnZona } from '@/lib/fba/pedidos'
import { consultarInforme, descargarInforme } from '@/lib/plataforma/amazon/informes'
import { createServiceClient } from '@/lib/supabase/service'
import {
  INFORME_PEDIDOS_VENTAS,
  leerDinero,
  MERCADO_DE_PAIS,
  movimientosDePublicidad,
  parsearPedidosVentas,
  resumirDias,
  type LineaGuardada,
  type Movimiento,
} from './lectura'

type Servicio = ReturnType<typeof createServiceClient>

export const DIAS_VENTANA = 62
const DIA_MS = 86_400_000
const MIN = 60_000
const TROZO = 500
const ZONA = 'Europe/Madrid'

interface Cuenta {
  connection_id: string
  pedidos_informe_id: string | null
  pedidos_informe_desde: string | null
  pedidos_informe_hasta: string | null
  pedidos_pedido_at: string | null
  pedidos_leido_hasta: string | null
  pedidos_leido_at: string | null
  finanzas_leido_hasta: string | null
  finanzas_leido_at: string | null
  ads_informes: InformeAds[]
  ads_leido_hasta: string | null
  ads_leido_at: string | null
  resumen_at: string | null
  ultimo_error: string | null
  updated_at: string | null
  historico_objetivo?: string | null
  historico_hasta?: string | null
  historico_informe_id?: string | null
  historico_informe_desde?: string | null
  historico_informe_hasta?: string | null
  historico_pedido_at?: string | null
}

interface InformeAds {
  perfil: string
  profileId: number
  conexionAds: string
  mercado: string
  moneda: string | null
  reportId: string
  desde: string
  hasta: string
  pedidoAt: string
}

export interface ResultadoPasadaVentas {
  cuentas: number
  hechos: string[]
  avisos: string[]
  sinTabla?: boolean
}

const hoyEn = (zona = ZONA) => diaEnZona(new Date(), zona) as string
const desplazar = (dia: string, dias: number) => new Date(Date.parse(`${dia}T00:00:00Z`) + dias * DIA_MS).toISOString().slice(0, 10)
const iso = (d: Date) => `${d.toISOString().slice(0, 19)}Z`

function mensajeDe(e: unknown): string {
  if (e instanceof AmazonApiError) return e.humanMessage.slice(0, 280)
  if (e instanceof AdsError) return e.message.slice(0, 280)
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message).slice(0, 280)
  return String(e).slice(0, 280)
}

async function guardar(service: Servicio, id: string, cambios: Record<string, unknown>) {
  const { error } = await service.from('ventas_cuentas').update({ ...cambios, updated_at: new Date().toISOString() }).eq('connection_id', id)
  if (error) throw error
}

async function enTrozos<T>(filas: T[], f: (trozo: T[]) => PromiseLike<{ error: unknown }>) {
  for (let i = 0; i < filas.length; i += TROZO) {
    const { error } = await f(filas.slice(i, i + TROZO))
    if (error) throw error
  }
}

export async function pasadaVentas(presupuestoMs: number): Promise<ResultadoPasadaVentas> {
  const service = createServiceClient()
  const arranque = Date.now()
  const salida: ResultadoPasadaVentas = { cuentas: 0, hechos: [], avisos: [] }
  const { data, error } = await service.from('ventas_cuentas').select('*').eq('activa', true)
  if (error) {
    if (/ventas_cuentas/.test(error.message ?? '') || error.code === '42P01' || error.code === 'PGRST205') return { ...salida, sinTabla: true }
    throw error
  }
  const cuentas = (data ?? []) as Cuenta[]
  salida.cuentas = cuentas.length
  const { porEuro } = await tiposDeCambio()

  for (const c of cuentas) {
    if (Date.now() - arranque > presupuestoMs) {
      salida.avisos.push('sin tiempo: quedan cuentas para la próxima pasada')
      break
    }
    const quedan = () => presupuestoMs - (Date.now() - arranque)
    try {
      const resuelta = await connectionCredentials(c.connection_id)
      if (!resuelta) continue
      const { credentials: creds, connection } = resuelta
      const mercado = connection.default_marketplace_id ?? connection.marketplace_ids?.[0] ?? 'A1RKKUPIHCS9HS'
      let cambio = false
      const errores: string[] = []

      // 1 · Pedidos
      try {
        const r = await pasoPedidos(service, c, creds, mercado, porEuro)
        if (r) {
          salida.hechos.push(`${connection.name}: ${r}`)
          cambio ||= r.startsWith('recogido')
        }
      } catch (e) {
        errores.push(`pedidos: ${mensajeDe(e)}`)
        await guardar(service, c.connection_id, { pedidos_informe_id: null }).catch(() => undefined)
      }

      // 2 · Dinero
      if (quedan() > 25_000) {
        try {
          const r = await pasoDinero(service, c, creds, mercado, porEuro, quedan() - 15_000)
          if (r) {
            salida.hechos.push(`${connection.name}: ${r}`)
            cambio = true
          }
        } catch (e) {
          errores.push(`dinero: ${mensajeDe(e)}`)
        }
      }

      // 3 · Publicidad
      if (quedan() > 15_000) {
        try {
          const r = await pasoPublicidad(service, c, porEuro)
          if (r) {
            salida.hechos.push(`${connection.name}: ${r}`)
            cambio ||= r.includes('recogid')
          }
        } catch (e) {
          errores.push(`publicidad: ${mensajeDe(e)}`)
        }
      }

      // 5 · El historial (2 años hacia atrás), solo cuando lo del día ya está al día: no le quita cupo a lo de hoy
      const alDia = c.pedidos_leido_hasta && Date.parse(c.pedidos_leido_hasta) > Date.now() - 2 * 3_600_000 && c.finanzas_leido_hasta && Date.parse(c.finanzas_leido_hasta) > Date.now() - 3 * 3_600_000
      if (alDia && quedan() > 40_000) {
        try {
          const r = await pasoHistorial(service, c, creds, mercado, porEuro, quedan() - 15_000)
          if (r) salida.hechos.push(`${connection.name}: ${r}`)
        } catch (e) {
          errores.push(`historial: ${mensajeDe(e)}`)
          await guardar(service, c.connection_id, { historico_informe_id: null }).catch(() => undefined)
        }
      }

      // 4 · El resumen (y la poda)
      if (cambio || !c.resumen_at) {
        const n = await rehacerResumen(service, c.connection_id)
        salida.hechos.push(`${connection.name}: resumen de ${n} filas`)
        await guardar(service, c.connection_id, { resumen_at: new Date().toISOString() })
      }
      await guardar(service, c.connection_id, { ultimo_error: errores.length ? errores.join(' · ').slice(0, 500) : null })
      if (errores.length) salida.avisos.push(`${connection.name}: ${errores.join(' · ')}`)
    } catch (e) {
      salida.avisos.push(`${c.connection_id}: ${mensajeDe(e)}`)
      await guardar(service, c.connection_id, { ultimo_error: mensajeDe(e) }).catch(() => undefined)
    }
  }
  return salida
}

/* ------------------------------------------------------------------ */
/* 1 · Pedidos                                                         */
/* ------------------------------------------------------------------ */

async function pasoPedidos(service: Servicio, c: Cuenta, creds: Parameters<typeof consultarInforme>[0], mercado: string, porEuro: Record<string, number>): Promise<string | null> {
  const ahora = new Date()
  if (c.pedidos_informe_id && c.pedidos_informe_desde && c.pedidos_informe_hasta) {
    const est = await consultarInforme(creds, c.pedidos_informe_id)
    if (est.estado === 'IN_QUEUE' || est.estado === 'IN_PROGRESS') {
      if (c.pedidos_pedido_at && ahora.getTime() - Date.parse(c.pedidos_pedido_at) > 45 * MIN) await guardar(service, c.connection_id, { pedidos_informe_id: null })
      return null
    }
    if (est.estado === 'FATAL') {
      await guardar(service, c.connection_id, { pedidos_informe_id: null })
      throw new Error('Amazon no ha podido generar el informe de pedidos')
    }
    const leidas = est.estado === 'DONE' && est.documentId ? parsearPedidosVentas((await descargarInforme(creds, est.documentId)).texto, mercado, porEuro) : { lineas: [], canceladas: 0, descartadas: 0, otrosCanales: 0 }
    const desde = c.pedidos_informe_desde
    const hasta = c.pedidos_informe_hasta
    // Lo que ya había en ese tramo: se conserva lo que vino de los movimientos de dinero (precio real y comisiones reales)
    const { data: previas, error } = await service
      .from('ventas_lineas')
      .select('pedido, sku, ventas, promo, tarifa_referral, tarifa_fba, otras_tarifas, tarifas_reales')
      .eq('connection_id', c.connection_id)
      .gte('fecha', desde)
      .lt('fecha', hasta)
    if (error) throw error
    const previa = new Map(((previas ?? []) as Array<Record<string, unknown>>).map((p) => [`${p.pedido}|${p.sku}`, p]))
    const filas = leidas.lineas.map((l) => {
      const p = previa.get(`${l.pedido}|${l.sku}`)
      const reales = Boolean(p?.tarifas_reales)
      return {
        connection_id: c.connection_id,
        ...l,
        ventas: reales && p?.ventas != null ? Number(p.ventas) : l.ventas,
        promo: reales && p?.promo != null ? Number(p.promo) : l.promo,
        tarifa_referral: reales ? (p?.tarifa_referral as number | null) : null,
        tarifa_fba: reales ? (p?.tarifa_fba as number | null) : null,
        otras_tarifas: reales ? (p?.otras_tarifas as number | null) : null,
        tarifas_reales: reales,
      }
    })
    await enTrozos(filas, (t) => service.from('ventas_lineas').upsert(t, { onConflict: 'connection_id,pedido,sku' }))
    // Lo que ya no está en el informe (cancelado) se va
    const nuevas = new Set(filas.map((f) => `${f.pedido}|${f.sku}`))
    const sobran = [...previa.keys()].filter((k) => !nuevas.has(k))
    for (const k of sobran) {
      const [pedido, ...resto] = k.split('|')
      await service.from('ventas_lineas').delete().eq('connection_id', c.connection_id).eq('pedido', pedido).eq('sku', resto.join('|'))
    }
    const leidoHasta = !c.pedidos_leido_hasta || hasta > c.pedidos_leido_hasta ? hasta : c.pedidos_leido_hasta
    await guardar(service, c.connection_id, { pedidos_informe_id: null, pedidos_leido_hasta: leidoHasta, pedidos_leido_at: ahora.toISOString(), pedidos_leido_desde: c.pedidos_leido_hasta ? undefined : desde })
    const mercados = new Set(leidas.lineas.map((l) => l.marketplace_id)).size
    return `recogido el informe de pedidos: ${filas.length} líneas en ${mercados} países (${leidas.canceladas} canceladas fuera)`
  }

  // ¿Toca pedir otro? Al día, cada 10 minutos; mientras se trae lo de los primeros 62 días, en cuanto se recoge el anterior
  const alDia = c.pedidos_leido_hasta && Date.parse(c.pedidos_leido_hasta) > ahora.getTime() - 60 * MIN
  if (alDia && c.pedidos_leido_at && ahora.getTime() - Date.parse(c.pedidos_leido_at) < 10 * MIN) return null
  const desde = c.pedidos_leido_hasta ? new Date(Date.parse(c.pedidos_leido_hasta) - (alDia ? 2 * DIA_MS : 0)) : new Date(ahora.getTime() - DIAS_VENTANA * DIA_MS)
  const hasta = new Date(Math.min(ahora.getTime() - 3 * MIN, desde.getTime() + 31 * DIA_MS))
  const { data } = await spApiRequest<{ reportId?: string }>(creds, 'createReport', {
    method: 'POST',
    path: '/reports/2021-06-30/reports',
    body: { reportType: INFORME_PEDIDOS_VENTAS, marketplaceIds: [mercado], dataStartTime: desde.toISOString(), dataEndTime: hasta.toISOString() },
    repeatable: false,
    maxAttempts: 1,
  })
  if (!data.reportId) throw new Error('Amazon ha aceptado el informe de pedidos sin devolver su identificador')
  await guardar(service, c.connection_id, { pedidos_informe_id: data.reportId, pedidos_informe_desde: desde.toISOString(), pedidos_informe_hasta: hasta.toISOString(), pedidos_pedido_at: ahora.toISOString() })
  return `pedido el informe de pedidos (${desde.toISOString().slice(0, 10)} → ${hasta.toISOString().slice(0, 10)})`
}

/* ------------------------------------------------------------------ */
/* 2 · Dinero                                                          */
/* ------------------------------------------------------------------ */

async function pasoDinero(service: Servicio, c: Cuenta, creds: Parameters<typeof consultarInforme>[0], mercado: string, porEuro: Record<string, number>, presupuestoMs: number): Promise<string | null> {
  const ahora = Date.now()
  const alDia = c.finanzas_leido_hasta && Date.parse(c.finanzas_leido_hasta) > ahora - 2 * 60 * MIN
  if (alDia && c.finanzas_leido_at && ahora - Date.parse(c.finanzas_leido_at) < 60 * MIN) return null
  const desde = c.finanzas_leido_hasta ? new Date(Date.parse(c.finanzas_leido_hasta) - (alDia ? 3 * DIA_MS : 0)) : new Date(ahora - DIAS_VENTANA * DIA_MS)
  // El dinero va DETRÁS de los pedidos: las comisiones reales se apuntan en su línea de pedido, y si la línea aún no está se contarían dos veces
  // (como tarifa suelta y como estimada al llegar el pedido)
  const pedidosHasta = c.pedidos_leido_hasta ? Date.parse(c.pedidos_leido_hasta) : 0
  const hasta = new Date(Math.min(ahora - 3 * MIN, desde.getTime() + 10 * DIA_MS, pedidosHasta))
  if (hasta.getTime() <= desde.getTime()) return null
  const arranque = Date.now()
  const tarifas: ReturnType<typeof leerDinero>['tarifas'] = []
  const movimientos: Movimiento[] = []
  let siguiente: string | undefined
  let paginas = 0
  do {
    if (Date.now() - arranque > presupuestoMs) return null // Sin tiempo: el tramo entero se lee en la próxima pasada (releer no duplica)
    const { data } = await spApiRequest<{ payload?: { FinancialEvents?: Record<string, unknown>; NextToken?: string } }>(creds, 'listFinancialEvents', {
      method: 'GET',
      path: '/finances/v0/financialEvents',
      query: siguiente ? { NextToken: siguiente } : { MaxResultsPerPage: '100', PostedAfter: iso(desde), PostedBefore: iso(hasta) },
      maxAttempts: 4,
    })
    paginas++
    const leido = leerDinero(data?.payload?.FinancialEvents ?? {}, mercado, porEuro)
    tarifas.push(...leido.tarifas)
    movimientos.push(...leido.movimientos)
    siguiente = data?.payload?.NextToken
  } while (siguiente)

  // Las comisiones reales, en su línea de pedido. Las de pedidos que ya no están guardados cuentan el día en que se cobran
  const pedidos = [...new Set(tarifas.map((t) => t.pedido))]
  const lineas = new Map<string, Record<string, unknown>>()
  for (let i = 0; i < pedidos.length; i += 150) {
    const { data, error } = await service.from('ventas_lineas').select('*').eq('connection_id', c.connection_id).in('pedido', pedidos.slice(i, i + 150))
    if (error) throw error
    for (const l of (data ?? []) as Array<Record<string, unknown>>) lineas.set(`${l.pedido}|${l.sku}`, l)
  }
  const actualizar: Array<Record<string, unknown>> = []
  for (const t of tarifas) {
    const l = lineas.get(`${t.pedido}|${t.sku}`)
    if (l) {
      actualizar.push({ ...l, ventas: t.cobrado > 0 ? t.cobrado : l.ventas, promo: t.promo || l.promo, tarifa_referral: t.referral, tarifa_fba: t.fba, otras_tarifas: t.otras, tarifas_reales: true })
    } else if (t.referral + t.fba + t.otras !== 0) {
      movimientos.push({ clave: `t|${t.pedido}|${t.sku}`, dia: t.dia, marketplace_id: t.marketplace_id, sku: t.sku, tipo: 'tarifa_pedido', unidades: 0, importe: Math.round((t.referral + t.fba + t.otras) * 100) / 100, extra: 0, extra_unidades: 0 })
    }
  }
  await enTrozos(actualizar, (t) => service.from('ventas_lineas').upsert(t, { onConflict: 'connection_id,pedido,sku' }))
  const unicos = [...new Map(movimientos.map((m) => [m.clave, { connection_id: c.connection_id, ...m }])).values()]
  await enTrozos(unicos, (t) => service.from('ventas_movimientos').upsert(t, { onConflict: 'connection_id,clave' }))
  await guardar(service, c.connection_id, { finanzas_leido_hasta: hasta.toISOString(), finanzas_leido_at: new Date().toISOString(), finanzas_leido_desde: c.finanzas_leido_hasta ? undefined : desde.toISOString() })
  return `dinero ${desde.toISOString().slice(0, 10)} → ${hasta.toISOString().slice(0, 10)}: ${paginas} páginas, ${actualizar.length} pedidos con comisión real, ${unicos.length} movimientos`
}

/* ------------------------------------------------------------------ */
/* 3 · Publicidad por producto                                         */
/* ------------------------------------------------------------------ */

const TIPO_PETICION = 'application/vnd.createasyncreportrequest.v3+json'

async function perfilesDeAds(service: Servicio, connectionId: string): Promise<Array<{ id: string; profileId: number; conexionAds: string; mercado: string; moneda: string | null }>> {
  const { data: con } = await service.from('amazon_connections').select('client_id').eq('id', connectionId).maybeSingle()
  const clientId = (con as { client_id?: string } | null)?.client_id
  if (!clientId) return []
  const { data: cli } = await service.from('amazon_clients').select('cliente_id').eq('id', clientId).maybeSingle()
  const clienteId = (cli as { cliente_id?: string } | null)?.cliente_id
  if (!clienteId) return []
  const { data, error } = await service.from('ads_profiles').select('id, profile_id, connection_id, pais, moneda, tipo').eq('cliente_id', clienteId)
  if (error) return []
  return ((data ?? []) as Array<{ id: string; profile_id: number; connection_id: string; pais: string | null; moneda: string | null; tipo: string | null }>)
    .filter((p) => p.pais && MERCADO_DE_PAIS[p.pais.toUpperCase()] && (p.tipo ?? 'seller') !== 'agency')
    .map((p) => ({ id: p.id, profileId: Number(p.profile_id), conexionAds: p.connection_id, mercado: MERCADO_DE_PAIS[(p.pais as string).toUpperCase()], moneda: p.moneda }))
}

async function pedirInformeAds(conexionAds: string, profileId: number, desde: string, hasta: string): Promise<string> {
  try {
    const r = await llamarAds<{ reportId?: string }>(conexionAds, '/reporting/reports', {
      perfilId: profileId,
      metodo: 'POST',
      cabeceras: { Accept: TIPO_PETICION, 'Content-Type': TIPO_PETICION },
      cuerpo: {
        name: `ventas producto ${desde} ${hasta}`,
        startDate: desde,
        endDate: hasta,
        configuration: {
          adProduct: 'SPONSORED_PRODUCTS',
          groupBy: ['advertiser'],
          columns: ['date', 'advertisedSku', 'advertisedAsin', 'cost', 'sales1d', 'unitsSoldClicks1d'],
          reportTypeId: 'spAdvertisedProduct',
          timeUnit: 'DAILY',
          format: 'GZIP_JSON',
        },
      },
    })
    if (!r.reportId) throw new AdsError('Amazon Ads ha aceptado el informe sin devolver su identificador.')
    return r.reportId
  } catch (e) {
    // 425 = «ese informe ya me lo has pedido»: trae el identificador del que existe
    if (e instanceof AdsError && (e.estado === 425 || /"425"/.test(e.cuerpo ?? ''))) {
      const ya = e.cuerpo?.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
      if (ya) return ya[0]
    }
    throw e
  }
}

async function pasoPublicidad(service: Servicio, c: Cuenta, porEuro: Record<string, number>): Promise<string | null> {
  const ahora = Date.now()
  const pendientes = Array.isArray(c.ads_informes) ? c.ads_informes : []
  if (pendientes.length > 0) {
    const siguen: InformeAds[] = []
    let recogidos = 0
    let filas = 0
    for (const inf of pendientes) {
      const est = await llamarAds<{ status?: string; url?: string; failureReason?: string }>(inf.conexionAds, `/reporting/reports/${encodeURIComponent(inf.reportId)}`, { perfilId: inf.profileId })
      const estado = (est.status ?? 'PENDING').toUpperCase()
      if (estado === 'COMPLETED' && est.url) {
        const res = await fetch(est.url, { signal: AbortSignal.timeout(60_000) })
        if (!res.ok) throw new AdsError(`No se ha podido descargar el informe de publicidad (${res.status})`)
        const bruto = Buffer.from(await res.arrayBuffer())
        let texto: string
        try {
          texto = gunzipSync(bruto).toString('utf8')
        } catch {
          texto = bruto.toString('utf8')
        }
        const crudo = JSON.parse(texto) as Array<Record<string, unknown>>
        const movs = movimientosDePublicidad(Array.isArray(crudo) ? crudo : [], inf.mercado, inf.moneda, porEuro)
        // Se sustituye la publicidad de ese país en esos días (un SKU que dejó de anunciarse no se queda con el gasto de antes)
        const { error } = await service.from('ventas_movimientos').delete().eq('connection_id', c.connection_id).eq('tipo', 'publicidad').eq('marketplace_id', inf.mercado).gte('dia', inf.desde).lte('dia', inf.hasta)
        if (error) throw error
        await enTrozos(movs.map((m) => ({ connection_id: c.connection_id, ...m })), (t) => service.from('ventas_movimientos').upsert(t, { onConflict: 'connection_id,clave' }))
        recogidos++
        filas += movs.length
      } else if (estado === 'FAILED' || ahora - Date.parse(inf.pedidoAt) > 3 * 3_600_000) {
        // Perdido: se vuelve a pedir en la siguiente ronda
      } else siguen.push(inf)
    }
    const terminado = siguen.length === 0
    const hasta = pendientes.reduce((m, p) => (p.hasta > m ? p.hasta : m), c.ads_leido_hasta ?? '0000-00-00')
    await guardar(service, c.connection_id, { ads_informes: siguen, ...(terminado ? { ads_leido_hasta: hasta, ads_leido_at: new Date().toISOString() } : {}) })
    return recogidos ? `publicidad: ${recogidos} informes recogidos (${filas} filas)` : null
  }

  // ¿Toca pedir? Al día, cada 3 horas los 3 últimos días; la primera vez, 62 días en tramos de 31
  const hoy = hoyEn()
  const alDia = c.ads_leido_hasta && c.ads_leido_hasta >= desplazar(hoy, -1)
  if (alDia && c.ads_leido_at && ahora - Date.parse(c.ads_leido_at) < 3 * 3_600_000) return null
  const perfiles = await perfilesDeAds(service, c.connection_id)
  if (perfiles.length === 0) {
    await guardar(service, c.connection_id, { ads_leido_hasta: hoy, ads_leido_at: new Date().toISOString() })
    return null
  }
  const desde = c.ads_leido_hasta ? desplazar(c.ads_leido_hasta, alDia ? -3 : 0) : desplazar(hoy, -DIAS_VENTANA)
  const hasta = [desplazar(desde, 30), hoy].sort()[0]
  const nuevos: InformeAds[] = []
  for (const p of perfiles) {
    try {
      const reportId = await pedirInformeAds(p.conexionAds, p.profileId, desde, hasta)
      nuevos.push({ perfil: p.id, profileId: p.profileId, conexionAds: p.conexionAds, mercado: p.mercado, moneda: p.moneda, reportId, desde, hasta, pedidoAt: new Date().toISOString() })
    } catch {
      // Un país sin permiso o sin campañas no para a los demás
    }
  }
  if (nuevos.length === 0) {
    await guardar(service, c.connection_id, { ads_leido_hasta: hasta, ads_leido_at: new Date().toISOString() })
    return null
  }
  await guardar(service, c.connection_id, { ads_informes: nuevos })
  return `publicidad: pedidos ${nuevos.length} informes (${desde} → ${hasta})`
}

/* ------------------------------------------------------------------ */
/* 4 · El resumen                                                      */
/* ------------------------------------------------------------------ */

async function leerTodo<T>(consulta: (desde: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const filas: T[] = []
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await consulta(desde)
    if (error) throw error
    const trozo = (data ?? []) as T[]
    filas.push(...trozo)
    if (trozo.length < 1000) return filas
  }
}

export async function rehacerResumen(service: Servicio, connectionId: string): Promise<number> {
  const hoy = hoyEn()
  const desde = desplazar(hoy, -DIAS_VENTANA)
  const lineas = await leerTodo<LineaGuardada>((d) =>
    service.from('ventas_lineas').select('pedido, sku, marketplace_id, dia, asin, unidades, ventas, promo, tarifa_referral, tarifa_fba, otras_tarifas, tarifas_reales').eq('connection_id', connectionId).gte('dia', desde).order('pedido').range(d, d + 999),
  )
  const movimientos = await leerTodo<Movimiento>((d) =>
    service.from('ventas_movimientos').select('clave, dia, marketplace_id, sku, tipo, unidades, importe, extra, extra_unidades').eq('connection_id', connectionId).gte('dia', desde).order('clave').range(d, d + 999),
  )
  // Una tarifa suelta de un pedido que SÍ está entre las líneas no cuenta (ya está en su línea)
  const hayLinea = new Set(lineas.map((l) => `t|${l.pedido}|${l.sku}`))
  const filas = resumirDias(
    lineas.map((l) => ({ ...l, unidades: Number(l.unidades), ventas: l.ventas == null ? null : Number(l.ventas), promo: Number(l.promo), tarifa_referral: l.tarifa_referral == null ? null : Number(l.tarifa_referral), tarifa_fba: l.tarifa_fba == null ? null : Number(l.tarifa_fba), otras_tarifas: l.otras_tarifas == null ? null : Number(l.otras_tarifas) })),
    // Las comisiones de pedidos que no están entre las líneas (anteriores a la ventana) no cuentan aquí: las cuenta el historial con su pedido
    movimientos.filter((m) => m.tipo !== 'tarifa_pedido' && !hayLinea.has(m.clave)).map((m) => ({ ...m, importe: Number(m.importe), extra: Number(m.extra), unidades: Number(m.unidades), extra_unidades: Number(m.extra_unidades) })),
  ).filter((f) => f.dia >= desde)
  const { error } = await service.from('ventas_dia').delete().eq('connection_id', connectionId).gte('dia', desde)
  if (error) throw error
  await enTrozos(filas.map((f) => ({ connection_id: connectionId, ...f })), (t) => service.from('ventas_dia').insert(t))
  // La poda: lo de detalle que ya no entra en la ventana (el resumen de esos días se queda)
  const corte = desplazar(hoy, -(DIAS_VENTANA + 5))
  await service.from('ventas_lineas').delete().eq('connection_id', connectionId).lt('dia', corte)
  await service.from('ventas_movimientos').delete().eq('connection_id', connectionId).lt('dia', corte)
  return filas.length
}

/* ------------------------------------------------------------------ */
/* 5 · El historial: 2 años hacia atrás, de 30 en 30 días              */
/* ------------------------------------------------------------------ */

export const DIAS_HISTORIAL = 730
const TRAMO_HISTORIAL = 30

/**
 * Un tramo [desde, hasta) más antiguo que la ventana de 62 días: el informe de pedidos de esas fechas (se pide en una pasada y se recoge en otra) y el
 * dinero de esas fechas (y 15 días más, que es cuando Amazon cobra los pedidos de los últimos días del tramo). Se resume en memoria y se escriben SOLO
 * las filas de `ventas_dia` de esos días: nada de detalle. La publicidad sale de las facturas de Amazon (Amazon Ads no guarda tanto).
 */
async function pasoHistorial(service: Servicio, c: Cuenta, creds: Parameters<typeof consultarInforme>[0], mercado: string, porEuro: Record<string, number>, presupuestoMs: number): Promise<string | null> {
  // Sin la migración 345 las columnas no existen (select * no las trae): no se hace nada
  if (!('historico_hasta' in c)) return null
  const hoy = hoyEn()
  const objetivo = c.historico_objetivo ?? desplazar(hoy, -DIAS_HISTORIAL)
  const tope = c.historico_hasta ?? desplazar(hoy, -DIAS_VENTANA)
  if (tope <= objetivo) return null
  const ahora = new Date()

  if (!c.historico_informe_id) {
    const desde = [desplazar(tope, -TRAMO_HISTORIAL), objetivo].sort().reverse()[0]
    // Un día de margen por delante y por detrás: el día de cada pedido es el de su país, no el de UTC
    const { data } = await spApiRequest<{ reportId?: string }>(creds, 'createReport', {
      method: 'POST',
      path: '/reports/2021-06-30/reports',
      body: { reportType: INFORME_PEDIDOS_VENTAS, marketplaceIds: [mercado], dataStartTime: `${desplazar(desde, -1)}T00:00:00Z`, dataEndTime: `${desplazar(tope, 1)}T00:00:00Z` },
      repeatable: false,
      maxAttempts: 1,
    })
    if (!data.reportId) throw new Error('Amazon ha aceptado el informe de pedidos del historial sin devolver su identificador')
    await guardar(service, c.connection_id, { historico_objetivo: objetivo, historico_informe_id: data.reportId, historico_informe_desde: desde, historico_informe_hasta: tope, historico_pedido_at: ahora.toISOString() })
    return `historial: pedido el informe de ${desde} → ${tope}`
  }

  const desde = c.historico_informe_desde as string
  const hasta = c.historico_informe_hasta as string
  const est = await consultarInforme(creds, c.historico_informe_id)
  if (est.estado === 'IN_QUEUE' || est.estado === 'IN_PROGRESS') {
    if (c.historico_pedido_at && ahora.getTime() - Date.parse(c.historico_pedido_at) > 60 * MIN) await guardar(service, c.connection_id, { historico_informe_id: null })
    return null
  }
  if (est.estado === 'FATAL') {
    await guardar(service, c.connection_id, { historico_informe_id: null })
    throw new Error(`Amazon no ha podido generar el informe de pedidos del historial (${desde} → ${hasta})`)
  }
  const pedidos = est.estado === 'DONE' && est.documentId ? parsearPedidosVentas((await descargarInforme(creds, est.documentId)).texto, mercado, porEuro).lineas : []
  const dentro = (dia: string) => dia >= desde && dia < hasta

  // El dinero de esas fechas (hasta 15 días después: lo que Amazon cobra de los pedidos del final del tramo)
  const arranque = Date.now()
  const tarifas: ReturnType<typeof leerDinero>['tarifas'] = []
  const movimientos: Movimiento[] = []
  const finDinero = [desplazar(hasta, 15), hoy].sort()[0]
  let siguiente: string | undefined
  do {
    if (Date.now() - arranque > presupuestoMs) return null // Sin tiempo: el tramo entero se repite en la próxima pasada (el informe sigue ahí)
    const { data } = await spApiRequest<{ payload?: { FinancialEvents?: Record<string, unknown>; NextToken?: string } }>(creds, 'listFinancialEvents', {
      method: 'GET',
      path: '/finances/v0/financialEvents',
      query: siguiente ? { NextToken: siguiente } : { MaxResultsPerPage: '100', PostedAfter: `${desplazar(desde, -1)}T00:00:00Z`, PostedBefore: `${finDinero}T00:00:00Z` },
      maxAttempts: 4,
    })
    const leido = leerDinero(data?.payload?.FinancialEvents ?? {}, mercado, porEuro, { publicidadFacturada: true })
    tarifas.push(...leido.tarifas)
    movimientos.push(...leido.movimientos)
    siguiente = data?.payload?.NextToken
  } while (siguiente)

  // Las líneas con su precio y sus comisiones reales
  const porPedido = new Map(tarifas.map((t) => [`${t.pedido}|${t.sku}`, t]))
  const lineas: LineaGuardada[] = pedidos.filter((l) => dentro(l.dia)).map((l) => {
    const t = porPedido.get(`${l.pedido}|${l.sku}`)
    if (t) porPedido.delete(`${l.pedido}|${l.sku}`)
    return { pedido: l.pedido, sku: l.sku, marketplace_id: l.marketplace_id, dia: l.dia, asin: l.asin, unidades: l.unidades, ventas: t && t.cobrado > 0 ? t.cobrado : l.ventas, promo: t ? t.promo || l.promo : l.promo, tarifa_referral: t ? t.referral : null, tarifa_fba: t ? t.fba : null, otras_tarifas: t ? t.otras : null, tarifas_reales: Boolean(t) }
  })
  // Las comisiones de pedidos que no son de este tramo NO cuentan aquí: son de un tramo vecino, que las casa con su pedido (lee el dinero hasta 15 días después)
  const unicos = [...new Map(movimientos.filter((m) => dentro(m.dia)).map((m) => [m.clave, m])).values()]
  const filas = resumirDias(lineas, unicos).filter((f) => dentro(f.dia))

  const { error } = await service.from('ventas_dia').delete().eq('connection_id', c.connection_id).gte('dia', desde).lt('dia', hasta)
  if (error) throw error
  await enTrozos(filas.map((f) => ({ connection_id: c.connection_id, ...f })), (t) => service.from('ventas_dia').insert(t))
  await guardar(service, c.connection_id, { historico_informe_id: null, historico_hasta: desde, historico_at: new Date().toISOString() })
  return `historial ${desde} → ${hasta}: ${lineas.length} líneas, ${filas.length} filas`
}
