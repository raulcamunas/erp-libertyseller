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
 * EL HISTÓRICO (migración 299): con el mes y la semana al día, se van pidiendo hacia atrás las 8 semanas y los 3 meses anteriores, uno por pasada, apuntando cuáles ya están (`periodos_leidos`) para
 * no repetirlos. Lo guardado se conserva 26 semanas y 13 meses: es lo que dibuja la evolución.
 *
 * LA COMPETENCIA (migración 299): una vez por semana, el informe «Top Search Terms» del país (top-servidor.ts). Va en su propio carril (`top_*`): no bloquea ni lo bloquea el Search Query
 * Performance, y si falla se apunta en `top_error` y se reintenta la semana siguiente.
 *
 * Sin la migración 299 todo esto se salta y la lectura funciona como antes (solo el último mes y la última semana).
 *
 * EL ACCESO: si Amazon contesta 403 al pedir el informe, la app del ERP no tiene el rol de Brand Analytics (o el cliente no tiene Brand Registry). Se apunta `acceso = 'no'` con el motivo y no se
 * vuelve a intentar en 6 horas. El texto de las fichas se sigue leyendo igual: no depende de Brand Analytics.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { connectionCredentials } from '@/lib/amazon/data'
import { AmazonApiError } from '@/lib/amazon/errors'
import { spApiRequest } from '@/lib/amazon/sp-api'
import { consultarInforme, descargarInforme } from '@/lib/plataforma/amazon/informes'
import { skusDelCatalogo, vigiaLanzado } from './datos'
import { leerFichas } from './ficha-servidor'
import { claveDePeriodo, mesesAnteriores, semanasAnteriores, tandasDeAsins, ultimaSemana, ultimoMes, type PeriodoSqp, type RangoSqp } from './periodos'
import { leerTopFiltrado, pedirTop } from './top-servidor'
import { normalizarConsulta } from './top-terminos'
import { leerInformeSqp } from './sqp'

export const TIPO_DE_INFORME = 'GET_BRAND_ANALYTICS_SEARCH_QUERY_PERFORMANCE_REPORT'
const DIA_MS = 86_400_000
const FICHA_CADA_MS = 24 * 3_600_000
const REINTENTO_SIN_ACCESO_MS = 6 * 3_600_000
const REINTENTO_TRAS_ERROR_MS = 30 * 60_000
const ESPERA_MAXIMA_MS = 60 * 60_000
/** Cuánto se rellena hacia atrás la primera vez */
export const HISTORICO_SEMANAS = 8
export const HISTORICO_MESES = 3
/** Cuánto se conserva lo leído */
const CONSERVAR_SEMANAS = 26
const CONSERVAR_MESES = 13
/** El informe de búsquedas de todo el país puede tardar: se le da más margen */
const ESPERA_MAXIMA_TOP_MS = 3 * 3_600_000
const CONSERVAR_TOP_SEMANAS = 8

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
  /** Migración 299. Si no está, `mejoras` es false y no se usan */
  periodos_leidos?: string[]
  top_report_id?: string | null
  top_desde?: string | null
  top_hasta?: string | null
  top_pedido_at?: string | null
  top_ok?: string | null
  top_error?: string | null
  /** ¿Está lanzada la migración 299? */
  mejoras?: boolean
}

const COLUMNAS_BASE = 'estado, report_id, periodo, desde, hasta, asins, pendientes, mes_ok, semana_ok, ficha_leida_at, acceso, pedido_at, error, intentos'
const COLUMNAS_299 = 'periodos_leidos, top_report_id, top_desde, top_hasta, top_pedido_at, top_ok, top_error'

const hoyUTC = () => new Date().toISOString().slice(0, 10)

/** ¿Está la migración 299? Se pregunta una vez por proceso */
let hayMejoras: boolean | null = null
export async function mejorasLanzadas(): Promise<boolean> {
  if (hayMejoras === true) return true
  const { error } = await createServiceClient().from('seo_lecturas').select('top_ok').limit(1)
  if (error && !isMissingSchema(error)) throw error
  hayMejoras = !error
  return hayMejoras
}

export async function leerEstadoSeo(c: CuentaSeo): Promise<EstadoSeo | null> {
  const mejoras = await mejorasLanzadas()
  const { data, error } = await createServiceClient().from('seo_lecturas').select(mejoras ? `${COLUMNAS_BASE}, ${COLUMNAS_299}` : COLUMNAS_BASE).eq('connection_id', c.connectionId).eq('marketplace_id', c.marketplaceId).maybeSingle()
  if (error) throw error
  if (!data) return null
  return { ...(data as unknown as EstadoSeo), mejoras }
}

async function guardar(c: CuentaSeo, cambios: Record<string, unknown>): Promise<void> {
  const { error } = await createServiceClient().from('seo_lecturas').upsert({ connection_id: c.connectionId, marketplace_id: c.marketplaceId, ...cambios, updated_at: new Date().toISOString() }, { onConflict: 'connection_id,marketplace_id' })
  if (error) throw error
}

/**
 * Los productos seguidos. A los que no tienen SKU (los traídos de Marketing Test pueden venir sin él) se les busca en el catálogo de la cuenta y se apunta: sin SKU la ficha no se lee nunca y la
 * pantalla se quedaba diciendo «ficha sin leer» para siempre.
 */
async function productosDe(c: CuentaSeo): Promise<Array<{ asin: string; sku: string | null }>> {
  const service = createServiceClient()
  const { data, error } = await service.from('seo_productos').select('id, asin, sku').eq('connection_id', c.connectionId).eq('marketplace_id', c.marketplaceId)
  if (error) throw error
  const filas = (data ?? []) as Array<{ id: string; asin: string; sku: string | null }>
  const sinSku = filas.filter((f) => !f.sku)
  if (sinSku.length > 0) {
    const skus = await skusDelCatalogo(c.connectionId, c.marketplaceId, sinSku.map((f) => f.asin)).catch(() => new Map<string, string>())
    for (const f of sinSku) {
      const sku = skus.get(f.asin.toUpperCase())
      if (!sku) continue
      f.sku = sku
      await service.from('seo_productos').update({ sku }).eq('id', f.id)
    }
  }
  return filas.map((f) => ({ asin: f.asin, sku: f.sku }))
}

/**
 * ¿Qué periodo toca leer ahora? PURO. Primero el último mes y la última semana; después, si hay histórico (migración 299: `periodos_leidos` no es undefined), las semanas y los meses anteriores que
 * falten, del más reciente al más viejo; si ya está todo, nada.
 */
export function periodoQueToca(e: Pick<EstadoSeo, 'mes_ok' | 'semana_ok' | 'periodos_leidos'> | null, hoy: string): RangoSqp | null {
  const mes = ultimoMes(hoy)
  if (e?.mes_ok !== mes.desde) return mes
  const semana = ultimaSemana(hoy)
  if (e?.semana_ok !== semana.desde) return semana
  if (!e?.periodos_leidos) return null
  const leidos = new Set(e.periodos_leidos)
  for (const r of [...semanasAnteriores(hoy, HISTORICO_SEMANAS), ...mesesAnteriores(hoy, HISTORICO_MESES)]) if (!leidos.has(claveDePeriodo(r))) return r
  return null
}

/** ¿Toca pedir el informe de la competencia (Top Search Terms)? PURO. Una vez por semana, solo con acceso a Brand Analytics confirmado y sin otro pedido en marcha */
export function topQueToca(e: Pick<EstadoSeo, 'acceso' | 'top_report_id' | 'top_ok' | 'top_pedido_at' | 'mejoras'> | null, hoy: string, ahora: number): RangoSqp | null {
  if (!e?.mejoras || e.acceso !== 'si' || e.top_report_id) return null
  const semana = ultimaSemana(hoy)
  if (e.top_ok === semana.desde) return null
  if (e.top_pedido_at && ahora - Date.parse(e.top_pedido_at) < REINTENTO_TRAS_ERROR_MS) return null
  return semana
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
/** Las cuentas cuyo informe de competencia se está descargando ahora en este proceso: no se descarga dos veces a la vez */
const leyendoTop = new Set<string>()

/**
 * `pesado`: solo el proceso de fondo descarga el informe de la competencia (puede tardar minutos). Desde la pantalla se salta ese paso para no dejar la página esperando.
 */
export async function avanzarSeo(c: CuentaSeo, opciones: { forzar?: boolean; pesado?: boolean } = {}): Promise<PasoSeo> {
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
        const filas: Array<Record<string, unknown> & { asin: string }> = fichas.map((f) => ({ connection_id: c.connectionId, marketplace_id: c.marketplaceId, asin: (f.asin ?? porSku.get(f.sku) ?? '').toUpperCase(), sku: f.sku, titulo: f.titulo, bullets: f.bullets, descripcion: f.descripcion, backend: f.backend, leida_at: new Date().toISOString() })).filter((f) => f.asin)
        // EL VIGÍA DE TÍTULOS (migración 304): si el título que llega no es el que había, se guarda el de antes y cuándo cambió. Amazon reescribe con IA los títulos fuera de norma y da 14 días
        // para revisarlo; «Qué hacer hoy» lo avisa si el cambio no es nuestro
        if (filas.length > 0 && (await vigiaLanzado().catch(() => false))) {
          const { data: antes } = await service.from('seo_fichas').select('asin, titulo, titulo_anterior, titulo_cambiado_at').eq('connection_id', c.connectionId).eq('marketplace_id', c.marketplaceId).in('asin', filas.map((f) => f.asin))
          const previo = new Map(((antes ?? []) as Array<{ asin: string; titulo: string | null; titulo_anterior: string | null; titulo_cambiado_at: string | null }>).map((a) => [a.asin, a]))
          for (const f of filas) {
            const viejo = previo.get(f.asin)
            // Un upsert por lotes pone a NULL las columnas que falten en una fila: a las que no cambian se les copia lo que ya tenían, o el aviso desaparecería al día siguiente
            if (viejo?.titulo && f.titulo && viejo.titulo.trim() !== String(f.titulo).trim()) Object.assign(f, { titulo_anterior: viejo.titulo, titulo_cambiado_at: new Date().toISOString() })
            else Object.assign(f, { titulo_anterior: viejo?.titulo_anterior ?? null, titulo_cambiado_at: viejo?.titulo_cambiado_at ?? null })
          }
        }
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

  // ---------- 2) la competencia (Top Search Terms), en su propio carril ----------
  if (estado?.mejoras && estado.top_report_id && opciones.pesado) {
    const clave = `${c.connectionId}|${c.marketplaceId}`
    if (leyendoTop.has(clave)) return { accion: 'esperando', detalle: 'competencia descargándose' }
    leyendoTop.add(clave)
    try {
      return await recogerTop(c, estado, resuelta.credentials, ahora)
    } finally {
      leyendoTop.delete(clave)
    }
  }

  try {
    // ---------- 3a) hay un informe pedido: ¿está? ----------
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
      const hoy = hoyUTC()
      const esElActual = estado.periodo === 'MONTH' ? ultimoMes(hoy).desde === estado.desde : ultimaSemana(hoy).desde === estado.desde
      const leidos = quedan.length === 0 && estado.mejoras ? { periodos_leidos: [...new Set([...(estado.periodos_leidos ?? []), claveDePeriodo({ periodo: estado.periodo, desde: estado.desde })])].slice(-80) } : {}
      await guardar(c, {
        estado: 'reposo',
        report_id: null,
        acceso: 'si',
        error: null,
        intentos: 0,
        ...(quedan.length === 0 && esElActual ? (estado.periodo === 'MONTH' ? { mes_ok: estado.desde } : { semana_ok: estado.desde }) : {}),
        ...leidos,
      })
      if (quedan.length === 0) await borrarLoViejo(c, hoy)
      return { accion: 'guardado', detalle: `${unicos.length} búsquedas (${estado.periodo})` }
    }

    // ---------- 3b) en reposo: ¿toca pedir? ----------
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
      if (!rango) {
        const top = topQueToca(estado, hoyUTC(), ahora)
        if (top && estado) return pedirLaCompetencia(c, estado, resuelta.credentials, top, ahora)
        return { accion: 'nada' }
      }
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
  const mejoras = await mejorasLanzadas()
  const { data: estados } = await service.from('seo_lecturas').select(`connection_id, marketplace_id, estado, mes_ok, semana_ok, ficha_leida_at, acceso, pedido_at, error, pendientes${mejoras ? ', periodos_leidos, top_report_id, top_ok, top_pedido_at' : ''}`)
  const por = new Map(((estados ?? []) as unknown as Array<EstadoSeo & { connection_id: string; marketplace_id: string }>).map((e) => [`${e.connection_id}|${e.marketplace_id}`, { ...e, mejoras }]))
  const ahora = Date.now()
  const hoy = hoyUTC()
  return cuentas.filter((c) => {
    const e = por.get(`${c.connectionId}|${c.marketplaceId}`)
    if (!e) return true
    if (e.estado === 'esperando' || e.top_report_id) return true
    if (!e.ficha_leida_at || ahora - Date.parse(e.ficha_leida_at) > FICHA_CADA_MS) return true
    if (e.acceso === 'no' && e.pedido_at && ahora - Date.parse(e.pedido_at) < REINTENTO_SIN_ACCESO_MS) return false
    if (e.error && e.pedido_at && ahora - Date.parse(e.pedido_at) < REINTENTO_TRAS_ERROR_MS) return false
    return (e.pendientes?.length ?? 0) > 0 || periodoQueToca(e, hoy) !== null || topQueToca(e, hoy, ahora) !== null
  })
}

/**
 * Al añadir o quitar productos se vuelve a leer el mes y la semana (con la lista nueva de ASIN).
 *
 * Si había un informe en marcha se abandona (estado a reposo, sin report_id). Antes no se hacía y era un fallo: el informe pedido con la lista VIEJA llegaba después, no quedaban tandas pendientes
 * y se daba el mes por leído; el producto recién añadido se quedaba sin búsquedas hasta el mes siguiente. Se pierde un informe; se gana que el nuevo salga en unos minutos.
 */
export async function reiniciarLectura(c: CuentaSeo): Promise<void> {
  // Con el histórico, también se vuelven a pedir las semanas y meses pasados (para los productos nuevos)
  await guardar(c, { estado: 'reposo', report_id: null, mes_ok: null, semana_ok: null, pendientes: [], ficha_leida_at: null, error: null, ...((await mejorasLanzadas()) ? { periodos_leidos: [] } : {}) })
}

const restarDias = (hoy: string, dias: number) => new Date(Date.parse(`${hoy}T00:00:00Z`) - dias * DIA_MS).toISOString().slice(0, 10)

/** Lo que ya no entra en la ventana de la evolución (26 semanas, 13 meses) */
async function borrarLoViejo(c: CuentaSeo, hoy: string): Promise<void> {
  const service = createServiceClient()
  await service.from('seo_consultas').delete().eq('connection_id', c.connectionId).eq('marketplace_id', c.marketplaceId).eq('periodo', 'WEEK').lt('desde', restarDias(hoy, CONSERVAR_SEMANAS * 7))
  await service.from('seo_consultas').delete().eq('connection_id', c.connectionId).eq('marketplace_id', c.marketplaceId).eq('periodo', 'MONTH').lt('desde', restarDias(hoy, CONSERVAR_MESES * 31))
}

/* ------------------------------------------------------------------ */
/* La competencia: el informe «Top Search Terms» del país              */
/* ------------------------------------------------------------------ */

async function pedirLaCompetencia(c: CuentaSeo, estado: EstadoSeo, creds: Parameters<typeof pedirTop>[0], rango: RangoSqp, ahora: number): Promise<PasoSeo> {
  try {
    const id = await pedirTop(creds, c.marketplaceId, rango)
    await guardar(c, { top_report_id: id, top_desde: rango.desde, top_hasta: rango.hasta, top_pedido_at: new Date(ahora).toISOString(), top_error: null })
    return { accion: 'pedido', detalle: `competencia ${rango.desde}` }
  } catch (e) {
    if (!(e instanceof AmazonApiError) && !(e instanceof Error)) throw e
    const sinPermiso = e instanceof AmazonApiError && e.kind === 'permisos'
    // Sin permiso para este informe no se insiste en toda la semana; otro fallo, a los 30 minutos
    await guardar(c, {
      top_error: sinPermiso ? 'Amazon no deja leer el informe de los términos de búsqueda más buscados en esta cuenta.' : `No se ha podido pedir el informe de la competencia: ${e instanceof AmazonApiError ? (e.humanMessage ?? e.message) : e.message}`.slice(0, 500),
      top_pedido_at: new Date(ahora).toISOString(),
      ...(sinPermiso ? { top_ok: rango.desde } : {}),
    })
    if (!(e instanceof AmazonApiError)) console.error('SEO: pedir la competencia:', e)
    return { accion: 'error', detalle: 'competencia' }
  }
}

async function recogerTop(c: CuentaSeo, estado: EstadoSeo, creds: Parameters<typeof pedirTop>[0], ahora: number): Promise<PasoSeo> {
  const service = createServiceClient()
  const desde = estado.top_desde as string
  try {
    const inf = await consultarInforme(creds, estado.top_report_id as string)
    if (inf.estado === 'IN_QUEUE' || inf.estado === 'IN_PROGRESS') {
      if (estado.top_pedido_at && ahora - Date.parse(estado.top_pedido_at) > ESPERA_MAXIMA_TOP_MS) {
        await guardar(c, { top_report_id: null, top_error: 'Amazon ha tardado más de 3 horas en preparar el informe de la competencia. Se vuelve a pedir más tarde.', top_pedido_at: new Date(ahora).toISOString() })
        return { accion: 'error', detalle: 'competencia caducada' }
      }
      return { accion: 'esperando', detalle: 'competencia' }
    }
    if (inf.estado === 'FATAL') {
      await guardar(c, { top_report_id: null, top_ok: desde, top_error: 'Amazon no ha podido generar el informe de los términos más buscados esta semana.' })
      return { accion: 'error', detalle: 'competencia FATAL' }
    }
    if (inf.estado !== 'DONE' || !inf.documentId) {
      // CANCELLED: Amazon no tiene datos de esa semana
      await guardar(c, { top_report_id: null, top_ok: desde, top_error: null })
      return { accion: 'nada', detalle: 'competencia sin datos' }
    }

    // Las búsquedas que importan: las de los productos seguidos en las últimas semanas y meses
    const quiere = new Set<string>()
    for (let i = 0; i < 40_000 && quiere.size < 20_000; i += 1000) {
      const { data, error } = await service.from('seo_consultas').select('consulta').eq('connection_id', c.connectionId).eq('marketplace_id', c.marketplaceId).gte('desde', restarDias(hoyUTC(), 70)).range(i, i + 999)
      if (error) throw error
      for (const r of (data ?? []) as Array<{ consulta: string }>) quiere.add(normalizarConsulta(r.consulta))
      if (!data || data.length < 1000) break
    }
    const { filas, vistas } = quiere.size > 0 ? await leerTopFiltrado(creds, inf.documentId, (q) => quiere.has(q)) : { filas: [], vistas: 0 }

    await service.from('seo_top_terminos').delete().eq('connection_id', c.connectionId).eq('marketplace_id', c.marketplaceId).eq('periodo', 'WEEK').eq('desde', desde)
    const registros = filas.map((f) => ({
      connection_id: c.connectionId,
      marketplace_id: c.marketplaceId,
      periodo: 'WEEK',
      desde,
      hasta: estado.top_hasta ?? desde,
      consulta: normalizarConsulta(f.consulta).slice(0, 300),
      posicion: f.posicion,
      asin: f.asin,
      departamento: f.departamento?.slice(0, 120) ?? null,
      rango_frecuencia: f.rangoFrecuencia,
      cuota_clics: f.cuotaClics,
      cuota_conversion: f.cuotaConversion,
    }))
    const unicos = [...new Map(registros.map((r) => [`${normalizarConsulta(r.consulta)}|${r.posicion}`, r])).values()]
    for (let i = 0; i < unicos.length; i += 500) {
      const { error } = await service.from('seo_top_terminos').upsert(unicos.slice(i, i + 500), { onConflict: 'connection_id,marketplace_id,periodo,desde,consulta,posicion' })
      if (error) throw error
    }
    await service.from('seo_top_terminos').delete().eq('connection_id', c.connectionId).eq('marketplace_id', c.marketplaceId).lt('desde', restarDias(hoyUTC(), CONSERVAR_TOP_SEMANAS * 7))
    await guardar(c, { top_report_id: null, top_ok: desde, top_error: null })
    return { accion: 'guardado', detalle: `competencia: ${unicos.length} filas de ${vistas} leídas` }
  } catch (e) {
    if (isMissingSchema(e)) throw e
    const texto = e instanceof AmazonApiError ? (e.humanMessage ?? e.message) : e instanceof Error ? e.message : 'error desconocido'
    console.error('SEO: recoger la competencia:', texto)
    await guardar(c, { top_report_id: null, top_error: `No se ha podido leer el informe de la competencia: ${texto}`.slice(0, 500), top_pedido_at: new Date(ahora).toISOString() })
    return { accion: 'error', detalle: 'competencia' }
  }
}

export { DIA_MS }
