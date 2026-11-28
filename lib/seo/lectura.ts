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
 * Performance: mientras Amazon lo prepara, la misma pasada sigue con el Search Query Performance. Si falla se apunta en `top_error` y se reintenta la semana siguiente.
 *
 * Sin la migración 299 todo esto se salta y la lectura funciona como antes (solo el último mes y la última semana).
 *
 * EL ACCESO: si Amazon contesta 403 al pedir el informe, la app del ERP no tiene el rol de Brand Analytics (o el cliente no tiene Brand Registry). Se apunta `acceso = 'no'` con el motivo y no se
 * vuelve a intentar en 6 horas. El texto de las fichas se sigue leyendo igual: no depende de Brand Analytics.
 *
 * LOS FALLOS (lectura-estado.ts decide qué se guarda en cada caso): una tanda nunca se pierde. Si el informe caduca, falla al recogerlo o llega roto, la tanda vuelve al frente de la cola; con 3
 * intentos se abandona diciendo qué ASIN. Un FATAL de varios ASIN se parte en mitades, y el ASIN que da FATAL solo tres veces se apunta en `asins_sin_ba` (migración 332) y deja de pedirse.
 */

import { leerTodo } from './paginar'
import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { connectionCredentials } from '@/lib/amazon/data'
import { AmazonApiError, isRetryable } from '@/lib/amazon/errors'
import { spApiRequest } from '@/lib/amazon/sp-api'
import { consultarInforme, descargarInforme } from '@/lib/plataforma/amazon/informes'
import { migracion312Lanzada, skusDelCatalogo, vigiaLanzado } from './datos'
import { cuentasConEdicionesPorVerificar, hayEdicionesPorVerificar, verificarEdiciones } from './edicion-servidor'
import { leerFichas } from './ficha-servidor'
import { ultimaSemana, type RangoSqp } from './periodos'
import {
  contarFallo,
  devolverTanda,
  errorReintentableAlRecoger,
  esperaTrasError,
  esperaVencida,
  filasConVigia,
  motivoDeFatal,
  siguientePedido,
  trasFatal,
  trasGuardar,
  type EstadoSeo,
  type TituloPrevio,
  type Transicion,
} from './lectura-estado'
import { leerTopFiltrado, pedirTop } from './top-servidor'
import { normalizarConsulta } from './top-terminos'
import { leerInformeSqp } from './sqp'

export const TIPO_DE_INFORME = 'GET_BRAND_ANALYTICS_SEARCH_QUERY_PERFORMANCE_REPORT'
const DIA_MS = 86_400_000
const FICHA_CADA_MS = 24 * 3_600_000
const REINTENTO_SIN_ACCESO_MS = 6 * 3_600_000
const REINTENTO_TRAS_ERROR_MS = 30 * 60_000
const ESPERA_MAXIMA_MS = 60 * 60_000
export { HISTORICO_MESES, HISTORICO_SEMANAS, periodoQueToca } from './lectura-estado'
export type { EstadoSeo } from './lectura-estado'
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

const COLUMNAS_BASE = 'estado, report_id, periodo, desde, hasta, asins, pendientes, mes_ok, semana_ok, ficha_leida_at, acceso, pedido_at, error, intentos'
const COLUMNAS_299 = 'periodos_leidos, top_report_id, top_desde, top_hasta, top_pedido_at, top_ok, top_error'
const COLUMNAS_332 = 'asins_sin_ba'

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

/** ¿Está la migración 332 (asins_sin_ba)? Se pregunta una vez por proceso. Sin ella, el ASIN sin Brand Analytics se salta solo en el periodo en curso */
let haySinBa: boolean | null = null
export async function sinBaLanzado(): Promise<boolean> {
  if (haySinBa === true) return true
  const { error } = await createServiceClient().from('seo_lecturas').select('asins_sin_ba').limit(1)
  if (error && !isMissingSchema(error)) throw error
  haySinBa = !error
  return haySinBa
}

export async function leerEstadoSeo(c: CuentaSeo): Promise<EstadoSeo | null> {
  const [mejoras, sinBa] = await Promise.all([mejorasLanzadas(), sinBaLanzado().catch(() => false)])
  const columnas = [COLUMNAS_BASE, ...(mejoras ? [COLUMNAS_299] : []), ...(sinBa ? [COLUMNAS_332] : [])].join(', ')
  const { data, error } = await createServiceClient().from('seo_lecturas').select(columnas).eq('connection_id', c.connectionId).eq('marketplace_id', c.marketplaceId).maybeSingle()
  if (error) throw error
  if (!data) return null
  const fila = data as unknown as EstadoSeo
  return { ...fila, mejoras, ...(sinBa ? { asins_sin_ba: fila.asins_sin_ba ?? [] } : { asins_sin_ba: undefined }) }
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

/** Las cuentas cuyo informe de competencia se está descargando ahora en este proceso: no se descarga dos veces a la vez */
const leyendoTop = new Set<string>()
/** Fallos de la base al guardar un informe ya recogido, por report_id: con 3 se abandona el informe (la tanda vuelve a la cola) */
const fallosDeBase = new Map<string, number>()

/** El texto del documento de un informe FATAL (explica por qué murió). Si no se puede descargar, null */
async function textoDelDocumento(creds: Parameters<typeof descargarInforme>[0], documentId: string | null): Promise<string | null> {
  if (!documentId) return null
  try {
    return (await descargarInforme(creds, documentId)).texto.slice(0, 500)
  } catch (e) {
    console.error('SEO: documento del informe FATAL:', e instanceof AmazonApiError ? (e.humanMessage ?? e.message) : e)
    return null
  }
}

/**
 * Da UN paso en la lectura de una cuenta y país. Nunca espera a Amazon. Lanza solo si falta la migración o la base falla.
 *
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
  const m312 = await migracion312Lanzada().catch(() => false)

  // Aplica una transición de lectura-estado.ts (y, si cierra el periodo, borra lo viejo como al guardar)
  const aplicar = async (t: Transicion): Promise<void> => {
    await guardar(c, t.parche)
    if (t.cerrado) await borrarLoViejo(c, hoyUTC())
  }

  // ---------- 0) las ediciones mandadas a Amazon: ¿han quedado de verdad en la ficha? (migración 312) ----------
  // No depende del informe en marcha: no toca report_id ni el periodo
  if (m312 && (await hayEdicionesPorVerificar(c))) {
    try {
      const cerradas = await verificarEdiciones(c, resuelta.credentials)
      return { accion: 'fichas', detalle: `verificación de ediciones: ${cerradas} cerradas` }
    } catch (e) {
      if (!(e instanceof AmazonApiError)) throw e
      console.error('SEO: verificar ediciones:', e.humanMessage ?? e.message)
    }
  }

  // ---------- 1) las fichas, una vez al día (no dependen de Brand Analytics ni del informe en marcha: el upsert es parcial) ----------
  const fichaVieja = !estado?.ficha_leida_at || ahora - Date.parse(estado.ficha_leida_at) > FICHA_CADA_MS
  if (fichaVieja || opciones.forzar) {
    const skus = productos.map((p) => p.sku).filter((s): s is string => !!s)
    if (skus.length > 0) {
      try {
        const fichas = await leerFichas(resuelta.credentials, c.marketplaceId, skus)
        const porSku = new Map(productos.map((p) => [p.sku, p.asin]))
        let filas: Array<Record<string, unknown> & { asin: string }> = fichas.map((f) => ({ connection_id: c.connectionId, marketplace_id: c.marketplaceId, asin: (f.asin ?? porSku.get(f.sku) ?? '').toUpperCase(), sku: f.sku, titulo: f.titulo, bullets: f.bullets, descripcion: f.descripcion, backend: f.backend, leida_at: new Date().toISOString(), ...(m312 ? { highlights: f.highlights, product_type: f.productType, issues: f.issues } : {}) })).filter((f) => f.asin)
        // EL VIGÍA DE TÍTULOS (migración 304): si el título que llega no es el que había, se guarda el de antes y cuándo cambió. Amazon reescribe con IA los títulos fuera de norma y da 14 días
        // para revisarlo; «Qué hacer hoy» lo avisa si el cambio no es nuestro.
        // Todas las filas del lote deben llevar las mismas claves (el upsert pone a NULL las que falten): filasConVigia se encarga, también si no se ha podido leer lo de antes
        if (filas.length > 0 && (await vigiaLanzado().catch(() => false))) {
          const { data: antes, error: eAntes } = await service.from('seo_fichas').select('asin, titulo, titulo_anterior, titulo_cambiado_at').eq('connection_id', c.connectionId).eq('marketplace_id', c.marketplaceId).in('asin', filas.map((f) => f.asin))
          if (eAntes) console.error('SEO: vigía de títulos, lectura previa:', eAntes.message)
          filas = filasConVigia(filas, eAntes ? null : ((antes ?? []) as TituloPrevio[]), new Date().toISOString())
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
  // Si el informe aún se está preparando (o otra pasada lo está descargando), se sigue con el Search Query Performance en esta misma pasada
  if (estado?.mejoras && estado.top_report_id && opciones.pesado) {
    const clave = `${c.connectionId}|${c.marketplaceId}`
    if (!leyendoTop.has(clave)) {
      leyendoTop.add(clave)
      let r: PasoSeo
      try {
        r = await recogerTop(c, estado, resuelta.credentials, ahora)
      } finally {
        leyendoTop.delete(clave)
      }
      if (r.accion !== 'esperando') return r
    }
  }

  // ¿Se ha entrado a recoger un informe ya pedido? Decide qué se hace con un fallo de Amazon en el catch
  let enRecogida = false
  try {
    // ---------- 3a) hay un informe pedido: ¿está? ----------
    if (estado?.estado === 'esperando' && estado.report_id && estado.periodo && estado.desde) {
      enRecogida = true
      const inf = await consultarInforme(resuelta.credentials, estado.report_id)
      if (inf.estado === 'IN_QUEUE' || inf.estado === 'IN_PROGRESS') {
        if (esperaVencida(estado, ahora, ESPERA_MAXIMA_MS)) {
          await aplicar(devolverTanda(estado, 'Amazon ha tardado más de una hora en preparar el informe de Brand Analytics. Se vuelve a pedir la misma tanda.', ahora, hoyUTC()))
          return { accion: 'error', detalle: 'caducado' }
        }
        return { accion: 'esperando' }
      }
      if (inf.estado === 'FATAL') {
        const t = trasFatal(estado, motivoDeFatal(await textoDelDocumento(resuelta.credentials, inf.documentId)), ahora, hoyUTC())
        await aplicar(t)
        return { accion: 'error', detalle: t.detalle }
      }
      // DONE (con datos) o CANCELLED (Amazon no tiene datos para ese periodo: no es un error)
      let filas: ReturnType<typeof leerInformeSqp> = []
      if (inf.estado === 'DONE' && inf.documentId) {
        // Un documento roto (JSON a medias, gzip mal) no se arregla reintentando la descarga: se abandona el informe y la tanda vuelve a la cola. Los fallos de Amazon (429, 5xx…) siguen
        // al catch de fuera, que decide si se reintenta con el mismo informe
        try {
          filas = leerInformeSqp(JSON.parse((await descargarInforme(resuelta.credentials, inf.documentId)).texto))
        } catch (e) {
          if (e instanceof AmazonApiError) throw e
          const texto = e instanceof Error ? e.message : String(e)
          console.error('SEO: documento del informe ilegible:', texto)
          await aplicar(devolverTanda(estado, `El informe de Brand Analytics ha llegado roto (${texto}). Se vuelve a pedir.`, ahora, hoyUTC()))
          return { accion: 'error', detalle: 'documento ilegible' }
        }
      }
      try {
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
        fallosDeBase.delete(estado.report_id)
        await aplicar(trasGuardar(estado, hoyUTC()))
        return { accion: 'guardado', detalle: `${unicos.length} búsquedas (${estado.periodo})` }
      } catch (e) {
        // La base ha fallado: se relanza (el proceso lo apunta), pero con 3 fallos sobre el mismo informe se abandona y la tanda vuelve a la cola
        if (contarFallo(fallosDeBase, estado.report_id) >= 3) {
          fallosDeBase.delete(estado.report_id)
          const texto = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e)
          await aplicar(devolverTanda(estado, `No se ha podido guardar el informe de Brand Analytics (${texto}). Se vuelve a pedir.`, ahora, hoyUTC())).catch(() => undefined)
        }
        throw e
      }
    }

    // ---------- 3b) en reposo: ¿toca pedir? ----------
    if (!opciones.forzar && estado?.acceso === 'no' && estado.pedido_at && ahora - Date.parse(estado.pedido_at) < REINTENTO_SIN_ACCESO_MS) return { accion: 'sin-acceso' }
    // La espera tras un error solo si es un error de verdad (intentos > 0): los avisos dejan intentos en 0 y no frenan
    if (!opciones.forzar && esperaTrasError(estado, ahora, REINTENTO_TRAS_ERROR_MS)) return { accion: 'nada', detalle: 'reintento tras error' }

    const siguiente = siguientePedido(estado, productos.map((p) => p.asin), hoyUTC())
    if (siguiente.tipo === 'cerrar') {
      await aplicar(siguiente.transicion)
      return { accion: 'nada', detalle: siguiente.transicion.detalle }
    }
    if (siguiente.tipo === 'nada') {
      const top = topQueToca(estado, hoyUTC(), ahora)
      if (top && estado) return pedirLaCompetencia(c, estado, resuelta.credentials, top, ahora)
      return { accion: 'nada' }
    }
    const { rango, tanda, resto } = siguiente
    const id = await pedirSqp(c, rango, tanda)
    await guardar(c, { estado: 'esperando', report_id: id, periodo: rango.periodo, desde: rango.desde, hasta: rango.hasta, asins: tanda, pendientes: resto, pedido_at: new Date(ahora).toISOString(), error: null })
    return { accion: 'pedido', detalle: `${rango.periodo} ${rango.desde}` }
  } catch (e) {
    if (!(e instanceof AmazonApiError)) throw e
    const texto = (e.humanMessage ?? e.message).slice(0, 500)
    if (enRecogida && estado) {
      // Al recoger: un fallo pasajero (429, 5xx, red) deja el informe esperando con el mismo report_id, salvo que ya lleve más de una hora; cualquier otro devuelve la tanda a la cola
      if (isRetryable(e) && !esperaVencida(estado, ahora, ESPERA_MAXIMA_MS)) {
        await aplicar(errorReintentableAlRecoger(texto))
        return { accion: 'esperando', detalle: texto }
      }
      await aplicar(devolverTanda(estado, `No se ha podido recoger el informe de Brand Analytics: ${texto}`, ahora, hoyUTC()))
      return { accion: 'error', detalle: e.message }
    }
    // Al pedir (3b): la tanda sigue en los pendientes de la base, porque no se ha guardado nada
    if (e.kind === 'permisos') {
      await guardar(c, { estado: 'reposo', report_id: null, acceso: 'no', error: 'Amazon no deja leer Brand Analytics de esta cuenta: a la app del ERP le falta el rol «Brand Analytics» o el cliente no tiene Brand Registry en este país.', pedido_at: new Date(ahora).toISOString(), intentos: (estado?.intentos ?? 0) + 1 })
      return { accion: 'sin-acceso' }
    }
    await guardar(c, { estado: 'reposo', report_id: null, error: texto, pedido_at: new Date(ahora).toISOString(), intentos: (estado?.intentos ?? 0) + 1 })
    return { accion: 'error', detalle: e.message }
  }
}

/** Las cuentas y países con productos seguidos que tienen algo que hacer ahora mismo. Barato: dos consultas pequeñas, sin Amazon */
export async function cuentasSeoConTrabajo(): Promise<CuentaSeo[]> {
  const service = createServiceClient()
  // Paginado: sin él, con más de 1000 productos seguidos en total, las cuentas que quedaban fuera de la primera página no se leían nunca
  const filasProd = await leerTodo<{ connection_id: string; marketplace_id: string; asin: string }>((a, b) => service.from('seo_productos').select('connection_id, marketplace_id, asin').order('id').range(a, b), { etiqueta: 'productos seguidos' })
  const cuentas = [...new Map(filasProd.map((p) => [`${p.connection_id}|${p.marketplace_id}`, { connectionId: p.connection_id, marketplaceId: p.marketplace_id }])).values()]
  const asinsDe = new Map<string, string[]>()
  for (const p of filasProd) {
    const k = `${p.connection_id}|${p.marketplace_id}`
    asinsDe.set(k, [...(asinsDe.get(k) ?? []), p.asin])
  }
  // Las que tienen ediciones mandadas esperando a verificarse pasan aunque no tengan otra cosa que hacer (migración 312; sin ella, ninguna)
  const porVerificar = new Set((await cuentasConEdicionesPorVerificar().catch(() => [])).map((c) => `${c.connectionId}|${c.marketplaceId}`))
  if (cuentas.length === 0) return []
  const [mejoras, sinBa] = await Promise.all([mejorasLanzadas(), sinBaLanzado().catch(() => false)])
  const { data: estados } = await service.from('seo_lecturas').select(`connection_id, marketplace_id, estado, periodo, desde, hasta, mes_ok, semana_ok, ficha_leida_at, acceso, pedido_at, error, intentos, pendientes${mejoras ? ', periodos_leidos, top_report_id, top_ok, top_pedido_at' : ''}${sinBa ? ', asins_sin_ba' : ''}`)
  const por = new Map(((estados ?? []) as unknown as Array<EstadoSeo & { connection_id: string; marketplace_id: string }>).map((e) => [`${e.connection_id}|${e.marketplace_id}`, { ...e, mejoras, asins_sin_ba: sinBa ? (e.asins_sin_ba ?? []) : undefined }]))
  const ahora = Date.now()
  const hoy = hoyUTC()
  return cuentas.filter((c) => {
    const e = por.get(`${c.connectionId}|${c.marketplaceId}`)
    if (!e) return true
    if (porVerificar.has(`${c.connectionId}|${c.marketplaceId}`)) return true
    if (e.estado === 'esperando' || e.top_report_id) return true
    if (!e.ficha_leida_at || ahora - Date.parse(e.ficha_leida_at) > FICHA_CADA_MS) return true
    if (e.acceso === 'no' && e.pedido_at && ahora - Date.parse(e.pedido_at) < REINTENTO_SIN_ACCESO_MS) return false
    if (esperaTrasError(e, ahora, REINTENTO_TRAS_ERROR_MS)) return false
    // Los ASIN sin Brand Analytics (migración 332) no cuentan: una cuenta que solo tiene esos no tiene nada que pedir
    return siguientePedido(e, asinsDe.get(`${c.connectionId}|${c.marketplaceId}`) ?? [], hoy).tipo !== 'nada' || topQueToca(e, hoy, ahora) !== null
  })
}

/**
 * Al añadir o quitar productos se vuelve a leer el mes y la semana (con la lista nueva de ASIN).
 *
 * Si había un informe en marcha se abandona (estado a reposo, sin report_id). Antes no se hacía y era un fallo: el informe pedido con la lista VIEJA llegaba después, no quedaban tandas pendientes
 * y se daba el mes por leído; el producto recién añadido se quedaba sin búsquedas hasta el mes siguiente. Se pierde un informe; se gana que el nuevo salga en unos minutos.
 */
export async function reiniciarLectura(c: CuentaSeo): Promise<void> {
  // Con el histórico, también se vuelven a pedir las semanas y meses pasados (para los productos nuevos). La lista de ASIN sin Brand Analytics (332) también se vacía: se les da otra oportunidad
  const [mejoras, sinBa] = await Promise.all([mejorasLanzadas(), sinBaLanzado().catch(() => false)])
  await guardar(c, { estado: 'reposo', report_id: null, mes_ok: null, semana_ok: null, pendientes: [], ficha_leida_at: null, error: null, intentos: 0, ...(mejoras ? { periodos_leidos: [] } : {}), ...(sinBa ? { asins_sin_ba: [] } : {}) })
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
      // El documento de un FATAL explica por qué murió: se guarda como motivo
      const motivo = motivoDeFatal(await textoDelDocumento(creds, inf.documentId))
      await guardar(c, { top_report_id: null, top_ok: desde, top_error: `Amazon no ha podido generar el informe de los términos más buscados esta semana. ${motivo}`.slice(0, 500) })
      return { accion: 'error', detalle: 'competencia FATAL' }
    }
    if (inf.estado !== 'DONE' || !inf.documentId) {
      // CANCELLED: Amazon no tiene datos de esa semana
      await guardar(c, { top_report_id: null, top_ok: desde, top_error: null })
      return { accion: 'nada', detalle: 'competencia sin datos' }
    }

    // Las búsquedas que importan: las de los productos seguidos en las últimas semanas y meses. Paginar con offset necesita un orden ÚNICO (la clave entera), o se repiten o se pierden filas
    const quiere = new Set<string>()
    for (let i = 0; i < 40_000 && quiere.size < 20_000; i += 1000) {
      const { data, error } = await service.from('seo_consultas').select('asin, periodo, desde, consulta').eq('connection_id', c.connectionId).eq('marketplace_id', c.marketplaceId).gte('desde', restarDias(hoyUTC(), 70)).order('asin').order('periodo').order('desde').order('consulta').range(i, i + 999)
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
