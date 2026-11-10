/**
 * SEO · LA LECTURA DE UNA CUENTA Y PAÍS (proceso `seo-lecturas` y la propia pantalla al abrirse). SOLO SERVIDOR. Solo LEE de Amazon.
 *
 * Por cada cuenta de vendedor y país con productos seguidos:
 *   1. el texto de las fichas, una vez al día;
 *   2. el informe «Search Query Performance» de Brand Analytics del último MES cerrado y de la última SEMANA cerrada, en tandas de 18 ASIN (el máximo que cabe en una petición).
 *
 * Nunca espera a Amazon: pide un informe, apunta su id y lo recoge en la pasada siguiente (como lib/ads/sincronizar.ts). Amazon solo deja pedir un informe por minuto por cuenta, y el proceso pasa cada
 * 3 minutos: va de sobra.
 *
 * EL ACCESO: si Amazon contesta 403 al pedir el informe, la app del ERP no tiene el rol de Brand Analytics (o el cliente no tiene Brand Registry). Se apunta `acceso = 'no'` con el motivo y no se
 * vuelve a intentar en 6 horas. El texto de las fichas se sigue leyendo igual: no depende de Brand Analytics.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { connectionCredentials } from '@/lib/amazon/data'
import { AmazonApiError } from '@/lib/amazon/errors'
import { spApiRequest } from '@/lib/amazon/sp-api'
import { consultarInforme, descargarInforme } from '@/lib/plataforma/amazon/informes'
import { leerFichas } from './ficha-servidor'
import { tandasDeAsins, ultimaSemana, ultimoMes, type PeriodoSqp, type RangoSqp } from './periodos'
import { leerInformeSqp } from './sqp'

export const TIPO_DE_INFORME = 'GET_BRAND_ANALYTICS_SEARCH_QUERY_PERFORMANCE_REPORT'
const DIA_MS = 86_400_000
const FICHA_CADA_MS = 24 * 3_600_000
const REINTENTO_SIN_ACCESO_MS = 6 * 3_600_000
const REINTENTO_TRAS_ERROR_MS = 30 * 60_000
const ESPERA_MAXIMA_MS = 60 * 60_000

export interface CuentaSeo {
  connectionId: string
  marketplaceId: string
}

export interface EstadoSeo {
  estado: 'reposo' | 'esperando'
  report_id: string | null
  periodo: PeriodoSqp | null
  desde: string | null
  hasta: string | null
  asins: string[]
  pendientes: string[][]
  mes_ok: string | null
  semana_ok: string | null
  ficha_leida_at: string | null
  acceso: 'desconocido' | 'si' | 'no'
  pedido_at: string | null
  error: string | null
  intentos: number
}

const hoyUTC = () => new Date().toISOString().slice(0, 10)

export async function leerEstadoSeo(c: CuentaSeo): Promise<EstadoSeo | null> {
  const { data, error } = await createServiceClient().from('seo_lecturas').select('estado, report_id, periodo, desde, hasta, asins, pendientes, mes_ok, semana_ok, ficha_leida_at, acceso, pedido_at, error, intentos').eq('connection_id', c.connectionId).eq('marketplace_id', c.marketplaceId).maybeSingle()
  if (error) throw error
  return (data as unknown as EstadoSeo | null) ?? null
}

async function guardar(c: CuentaSeo, cambios: Record<string, unknown>): Promise<void> {
  const { error } = await createServiceClient().from('seo_lecturas').upsert({ connection_id: c.connectionId, marketplace_id: c.marketplaceId, ...cambios, updated_at: new Date().toISOString() }, { onConflict: 'connection_id,marketplace_id' })
  if (error) throw error
}

async function productosDe(c: CuentaSeo): Promise<Array<{ asin: string; sku: string | null }>> {
  const { data, error } = await createServiceClient().from('seo_productos').select('asin, sku').eq('connection_id', c.connectionId).eq('marketplace_id', c.marketplaceId)
  if (error) throw error
  return (data ?? []) as Array<{ asin: string; sku: string | null }>
}

/** ¿Qué periodo toca leer ahora? PURO. Primero el mes, luego la semana; si ya están los dos, nada */
export function periodoQueToca(e: Pick<EstadoSeo, 'mes_ok' | 'semana_ok'> | null, hoy: string): RangoSqp | null {
  const mes = ultimoMes(hoy)
  if (e?.mes_ok !== mes.desde) return mes
  const semana = ultimaSemana(hoy)
  if (e?.semana_ok !== semana.desde) return semana
  return null
}

async function pedirSqp(c: CuentaSeo, rango: RangoSqp, asins: string[]): Promise<string> {
  const resuelta = await connectionCredentials(c.connectionId)
  if (!resuelta) throw new Error('Esa conexión de Amazon ya no existe.')
  const { data } = await spApiRequest<{ reportId?: string }>(resuelta.credentials, 'createReport', {
    method: 'POST',
    path: '/reports/2021-06-30/reports',
    body: { reportType: TIPO_DE_INFORME, marketplaceIds: [c.marketplaceId], dataStartTime: rango.desde, dataEndTime: rango.hasta, reportOptions: { reportPeriod: rango.periodo, asin: asins.join(' ') } },
    repeatable: false,
    maxAttempts: 1,
  })
  if (!data.reportId) throw new Error('Amazon ha aceptado el informe pero no ha dado su identificador.')
  return data.reportId
}

export type PasoSeo = { accion: 'nada' | 'fichas' | 'pedido' | 'esperando' | 'guardado' | 'sin-acceso' | 'error'; detalle?: string }

/** Da UN paso en la lectura de una cuenta y país. Nunca espera a Amazon. Lanza solo si falta la migración o la base falla */
export async function avanzarSeo(c: CuentaSeo, opciones: { forzar?: boolean } = {}): Promise<PasoSeo> {
  const ahora = Date.now()
  const productos = await productosDe(c)
  if (productos.length === 0) return { accion: 'nada', detalle: 'sin productos seguidos' }
  const estado = await leerEstadoSeo(c)
  const resuelta = await connectionCredentials(c.connectionId)
  if (!resuelta) return { accion: 'error', detalle: 'la conexión ya no existe' }
  const service = createServiceClient()

  // ---------- 1) las fichas, una vez al día (no dependen de Brand Analytics) ----------
  const fichaVieja = !estado?.ficha_leida_at || ahora - Date.parse(estado.ficha_leida_at) > FICHA_CADA_MS
  if ((fichaVieja || opciones.forzar) && estado?.estado !== 'esperando') {
    const skus = productos.map((p) => p.sku).filter((s): s is string => !!s)
    if (skus.length > 0) {
      try {
        const fichas = await leerFichas(resuelta.credentials, c.marketplaceId, skus)
        const porSku = new Map(productos.map((p) => [p.sku, p.asin]))
        const filas = fichas.map((f) => ({ connection_id: c.connectionId, marketplace_id: c.marketplaceId, asin: (f.asin ?? porSku.get(f.sku) ?? '').toUpperCase(), sku: f.sku, titulo: f.titulo, bullets: f.bullets, descripcion: f.descripcion, backend: f.backend, leida_at: new Date().toISOString() })).filter((f) => f.asin)
        if (filas.length > 0) {
          const { error } = await service.from('seo_fichas').upsert(filas, { onConflict: 'connection_id,marketplace_id,asin' })
          if (error) throw error
        }
        await guardar(c, { ficha_leida_at: new Date().toISOString() })
        return { accion: 'fichas', detalle: `${filas.length} fichas` }
      } catch (e) {
        if (!(e instanceof AmazonApiError)) throw e
        await guardar(c, { ficha_leida_at: new Date().toISOString(), error: `No se han podido leer las fichas: ${e.humanMessage ?? e.message}`.slice(0, 500) })
        return { accion: 'error', detalle: 'fichas' }
      }
    }
  }

  try {
    // ---------- 2a) hay un informe pedido: ¿está? ----------
    if (estado?.estado === 'esperando' && estado.report_id && estado.periodo && estado.desde) {
      const pedidoAt = estado.pedido_at ? Date.parse(estado.pedido_at) : ahora
      const inf = await consultarInforme(resuelta.credentials, estado.report_id)
      if (inf.estado === 'IN_QUEUE' || inf.estado === 'IN_PROGRESS') {
        if (ahora - pedidoAt > ESPERA_MAXIMA_MS) {
          await guardar(c, { estado: 'reposo', report_id: null, error: 'Amazon ha tardado más de una hora en preparar el informe de Brand Analytics.', intentos: (estado.intentos ?? 0) + 1 })
          return { accion: 'error', detalle: 'caducado' }
        }
        return { accion: 'esperando' }
      }
      if (inf.estado === 'FATAL') {
        await guardar(c, { estado: 'reposo', report_id: null, pendientes: [], error: 'Amazon no ha podido generar el informe de Brand Analytics. Suele ser porque esos ASIN no son de una marca registrada del cliente (Brand Registry).', intentos: (estado.intentos ?? 0) + 1, pedido_at: new Date(ahora).toISOString() })
        return { accion: 'error', detalle: 'FATAL' }
      }
      // DONE (con datos) o CANCELLED (Amazon no tiene datos para ese periodo: no es un error)
      let filas: ReturnType<typeof leerInformeSqp> = []
      if (inf.estado === 'DONE' && inf.documentId) filas = leerInformeSqp(JSON.parse((await descargarInforme(resuelta.credentials, inf.documentId)).texto))
      // Se reemplaza lo de esos ASIN en ese periodo
      const { error: errorBorrar } = await service.from('seo_consultas').delete().eq('connection_id', c.connectionId).eq('marketplace_id', c.marketplaceId).eq('periodo', estado.periodo).eq('desde', estado.desde).in('asin', estado.asins)
      if (errorBorrar) throw errorBorrar
      const registros = filas.map((f) => ({
        connection_id: c.connectionId,
        marketplace_id: c.marketplaceId,
        asin: f.asin,
        periodo: estado.periodo,
        desde: estado.desde,
        hasta: estado.hasta,
        consulta: f.consulta.slice(0, 300),
        puntuacion: f.puntuacion,
        volumen: f.volumen,
        impresiones_total: f.impresionesTotal,
        impresiones_asin: f.impresionesAsin,
        cuota_impresiones: f.cuotaImpresiones,
        clics_total: f.clicsTotal,
        clics_asin: f.clicsAsin,
        cuota_clics: f.cuotaClics,
        carritos_total: f.carritosTotal,
        carritos_asin: f.carritosAsin,
        cuota_carritos: f.cuotaCarritos,
        compras_total: f.comprasTotal,
        compras_asin: f.comprasAsin,
        cuota_compras: f.cuotaCompras,
        precio_mediano_total: f.precioMedianoTotal,
        precio_mediano_asin: f.precioMedianoAsin,
        actualizado_at: new Date().toISOString(),
      }))
      // Amazon puede repetir una búsqueda para el mismo ASIN en filas distintas: se queda una
      const unicos = [...new Map(registros.map((r) => [`${r.asin}|${r.consulta.toLowerCase()}`, r])).values()]
      for (let i = 0; i < unicos.length; i += 500) {
        const { error } = await service.from('seo_consultas').upsert(unicos.slice(i, i + 500), { onConflict: 'connection_id,marketplace_id,asin,periodo,desde,consulta' })
        if (error) throw error
      }
      const quedan = estado.pendientes ?? []
      await guardar(c, {
        estado: 'reposo',
        report_id: null,
        acceso: 'si',
        error: null,
        intentos: 0,
        ...(quedan.length === 0 ? (estado.periodo === 'MONTH' ? { mes_ok: estado.desde } : { semana_ok: estado.desde }) : {}),
      })
      return { accion: 'guardado', detalle: `${unicos.length} búsquedas (${estado.periodo})` }
    }

    // ---------- 2b) en reposo: ¿toca pedir? ----------
    if (!opciones.forzar && estado?.acceso === 'no' && estado.pedido_at && ahora - Date.parse(estado.pedido_at) < REINTENTO_SIN_ACCESO_MS) return { accion: 'sin-acceso' }
    if (!opciones.forzar && estado?.error && estado.pedido_at && ahora - Date.parse(estado.pedido_at) < REINTENTO_TRAS_ERROR_MS) return { accion: 'nada', detalle: 'reintento tras error' }

    let rango: RangoSqp | null
    let tanda: string[]
    let resto: string[][]
    if (estado?.pendientes && estado.pendientes.length > 0 && estado.periodo && estado.desde && estado.hasta) {
      // Sigue con las tandas que quedan del mismo periodo
      rango = { periodo: estado.periodo, desde: estado.desde, hasta: estado.hasta }
      ;[tanda, ...resto] = estado.pendientes
    } else {
      rango = periodoQueToca(estado, hoyUTC())
      if (!rango) return { accion: 'nada' }
      ;[tanda, ...resto] = tandasDeAsins(productos.map((p) => p.asin))
    }
    const id = await pedirSqp(c, rango, tanda)
    await guardar(c, { estado: 'esperando', report_id: id, periodo: rango.periodo, desde: rango.desde, hasta: rango.hasta, asins: tanda, pendientes: resto, pedido_at: new Date(ahora).toISOString(), error: null })
    return { accion: 'pedido', detalle: `${rango.periodo} ${rango.desde}` }
  } catch (e) {
    if (!(e instanceof AmazonApiError)) throw e
    if (e.kind === 'permisos') {
      await guardar(c, { estado: 'reposo', report_id: null, acceso: 'no', error: 'Amazon no deja leer Brand Analytics de esta cuenta: a la app del ERP le falta el rol «Brand Analytics» o el cliente no tiene Brand Registry en este país.', pedido_at: new Date(ahora).toISOString(), intentos: (estado?.intentos ?? 0) + 1 })
      return { accion: 'sin-acceso' }
    }
    await guardar(c, { estado: 'reposo', report_id: null, error: (e.humanMessage ?? e.message).slice(0, 500), pedido_at: new Date(ahora).toISOString(), intentos: (estado?.intentos ?? 0) + 1 })
    return { accion: 'error', detalle: e.message }
  }
}

/** Las cuentas y países con productos seguidos que tienen algo que hacer ahora mismo. Barato: dos consultas pequeñas, sin Amazon */
export async function cuentasSeoConTrabajo(): Promise<CuentaSeo[]> {
  const service = createServiceClient()
  const { data: prods, error } = await service.from('seo_productos').select('connection_id, marketplace_id')
  if (error) throw error
  const cuentas = [...new Map(((prods ?? []) as Array<{ connection_id: string; marketplace_id: string }>).map((p) => [`${p.connection_id}|${p.marketplace_id}`, { connectionId: p.connection_id, marketplaceId: p.marketplace_id }])).values()]
  if (cuentas.length === 0) return []
  const { data: estados } = await service.from('seo_lecturas').select('connection_id, marketplace_id, estado, mes_ok, semana_ok, ficha_leida_at, acceso, pedido_at, error, pendientes')
  const por = new Map(((estados ?? []) as Array<EstadoSeo & { connection_id: string; marketplace_id: string }>).map((e) => [`${e.connection_id}|${e.marketplace_id}`, e]))
  const ahora = Date.now()
  const hoy = hoyUTC()
  return cuentas.filter((c) => {
    const e = por.get(`${c.connectionId}|${c.marketplaceId}`)
    if (!e) return true
    if (e.estado === 'esperando') return true
    if (!e.ficha_leida_at || ahora - Date.parse(e.ficha_leida_at) > FICHA_CADA_MS) return true
    if (e.acceso === 'no' && e.pedido_at && ahora - Date.parse(e.pedido_at) < REINTENTO_SIN_ACCESO_MS) return false
    if (e.error && e.pedido_at && ahora - Date.parse(e.pedido_at) < REINTENTO_TRAS_ERROR_MS) return false
    return (e.pendientes?.length ?? 0) > 0 || periodoQueToca(e, hoy) !== null
  })
}

/** Al añadir o quitar productos se vuelve a leer el mes y la semana (con la lista nueva de ASIN) */
export async function reiniciarLectura(c: CuentaSeo): Promise<void> {
  await guardar(c, { mes_ok: null, semana_ok: null, pendientes: [], ficha_leida_at: null })
}

export { DIA_MS }
