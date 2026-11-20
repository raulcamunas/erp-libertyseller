/**
 * AMAZON ADS · EL AGENTE PPC: USO DEL PRESUPUESTO DE HOY, AJUSTES DE UBICACIÓN Y PORTFOLIOS (SOLO SERVIDOR; solo LEE de Amazon).
 *
 * - `leerUsoDePresupuesto`: `POST /sp/campaigns/budget/usage` (lotes de 100, SECUENCIALES, FUERA de conRastro: es una lectura) → una fila por campaña y día LOCAL en `ads_presupuesto_dia`
 *   (fusionada con la anterior: uso último y máximo, gasto estimado, primer minuto agotada) y una fila por hora en `ads_gasto_hora` (la curva del día). Un 429 para la pasada (no se reintenta);
 *   un 207 sin ningún acierto es un ERROR. El error dice si es PASAJERO (429, 5xx, red, tiempo agotado: vigilar solo lo da por error tras varios seguidos) o no.
 *   Si la API falla (o, tras un error, solo se prueba un lote), «agotada» sale de `servingStatus = CAMPAIGN_OUT_OF_BUDGET` (fuente 'estado', sin minuto).
 *   La fila guarda el presupuesto BASE de la campaña (el de /sp/campaigns/list, el que lee y escribe el motor); el `budget` de la API de uso lleva las reglas de
 *   presupuesto aplicadas y solo sirve para el gasto estimado (si se guardara, R1 calcularía sobre él y el motor marcaría obsoleta la subida).
 * - `leerAjustesDeUbicacion`: el mayor % de ajuste por ubicación de cada campaña (una subida de puja con > 100 % es «rara»).
 * - `leerPortfolios`: qué portfolios tienen tope de presupuesto (una campaña en uno así no sube por R1: se avisa).
 *
 * Sin la 315 las lecturas y escrituras de tablas lanzan `Error(FALTA_MIGRACION_315)`.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { llamarAds } from '../datos'
import { AdsError } from '../oauth'
import { todasLasFilas } from '../paginar'
import type { CuentaParaSincronizar } from '../sincronizar'
import { desplazar, filasDeUso, lanzar, numero } from './contexto-servidor'
import type { DiaDeUso, HoraDeCuenta } from './tipos'
import { fusionarDiaDeUso, horaDeCuenta, horaLocal, leerRespuestaDeUso, lotesDeCampanas, RUTA_USO, TIPO_USO } from './uso-calculo'

const TIPO_CAMPANA = 'application/vnd.spCampaign.v3+json'
const TIPO_PORTFOLIO = 'application/vnd.spPortfolio.v3+json'
const AGOTADA_POR_ESTADO = 'CAMPAIGN_OUT_OF_BUDGET'
const LOTE_UPSERT = 500

/**
 * PURO. Una campaña de `campanasDe` + la lectura de uso (si la hay) → la lectura que se fusiona con la fila del día. Sin lectura de la API, «agotada» por el estado de servicio.
 * `presupuesto` es el BASE de la campaña (`c.presupuesto`, el que el motor relee al aplicar); `presupuestoEfectivo`, el de la API de uso (con las reglas de presupuesto de
 * Amazon aplicadas: Black Friday, temporada…), solo para el gasto estimado. Sin el base, el de la API.
 */
export function lecturaDeCampana(
  c: { campaignId: string; presupuesto: number | null; servicio: string | null; estado: string | null },
  uso: { usoPct: number | null; presupuesto: number | null; actualizadoAt: string | null } | undefined,
): { campaignId: string; usoPct: number | null; presupuesto: number | null; presupuestoEfectivo: number | null; actualizadoAt: string | null; porEstado: boolean; estadoCampana: string | null } {
  if (uso) {
    return {
      campaignId: c.campaignId,
      usoPct: uso.usoPct,
      presupuesto: c.presupuesto ?? uso.presupuesto,
      presupuestoEfectivo: uso.presupuesto ?? c.presupuesto,
      actualizadoAt: uso.actualizadoAt,
      porEstado: false,
      estadoCampana: c.estado,
    }
  }
  return {
    campaignId: c.campaignId,
    usoPct: null,
    presupuesto: c.presupuesto,
    presupuestoEfectivo: null,
    actualizadoAt: null,
    porEstado: (c.servicio ?? '').toUpperCase() === AGOTADA_POR_ESTADO,
    estadoCampana: c.estado,
  }
}

const filaDeDia = (perfilId: string, d: DiaDeUso) => ({
  perfil_id: perfilId,
  campaign_id: d.campaignId,
  fecha_local: d.fechaLocal,
  presupuesto: d.presupuesto,
  presupuesto_primera: d.presupuestoPrimera,
  uso_pct: d.usoPct,
  uso_max_pct: d.usoMaxPct,
  gasto_estimado: d.gastoEstimado,
  agotada_min: d.agotadaMin == null ? null : Math.max(0, Math.min(1439, Math.round(d.agotadaMin))),
  agotada_por_estado: d.agotadaPorEstado,
  estado_campana: d.estadoCampana,
  fuente: d.fuente,
  leido_at: d.leidoAt,
})

const RE_RED = /tiempo|timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|network|socket|abort/i

/**
 * PURO. ¿Es PASAJERO un fallo de la API de uso? Sí: 429, 5xx, red caída o tiempo agotado (AbortError/TimeoutError). No: 401/403 y los demás 4xx (lo que Amazon
 * no admite se repetiría igual), y un error sin código que no es de red (credenciales, conexión revocada). El 207 en que todo falla se clasifica fuera (persistente).
 */
export function falloDeUsoEsPasajero(err: unknown): boolean {
  if (err instanceof AdsError) {
    if (err.estado != null) return err.estado === 429 || err.estado >= 500
    return !err.esDeAutorizacion && RE_RED.test(err.message)
  }
  if (err instanceof Error) return err.name === 'AbortError' || err.name === 'TimeoutError' || RE_RED.test(err.message)
  return false
}

/**
 * Lee el uso de presupuesto de hoy de las campañas ACTIVAS que se le pasan y lo guarda (upsert) en `ads_presupuesto_dia` y `ads_gasto_hora`. Devuelve TODAS las filas de hoy de la cuenta (también las
 * de campañas leídas antes y pausadas después: su gasto de hoy cuenta), el error de la API si lo hubo, si ese error es PASAJERO (`transitorio`: todos los fallos
 * fueron 429/5xx/red) y las campañas con una regla de presupuesto activa (`conRegla`: id → presupuesto efectivo, distinto del base). `opciones.soloPrueba`: tras
 * un error, solo se lee el PRIMER lote (una llamada de prueba: si va bien, el error se borra) y lo demás se deduce del estado. NO va dentro de conRastro: es una lectura.
 * Las campañas que ya no están activas y ayer acabaron ACTIVAS también tienen fila hoy (con su estado, sin uso): así la lectura de hoy no parece «a medias»
 * (lecturaDeHoyCompleta) el día después de pausar una campaña.
 */
export async function leerUsoDePresupuesto(
  cuenta: CuentaParaSincronizar,
  campanas: ReadonlyArray<{ campaignId: string; presupuesto: number | null; servicio: string | null; estado: string | null }>,
  zona: string,
  ahora: number,
  opciones: { soloPrueba?: boolean } = {},
): Promise<{ dias: DiaDeUso[]; error: string | null; transitorio: boolean; conRegla: Map<string, number> }> {
  const fecha = horaLocal(ahora, zona).fecha
  const ayer = desplazar(fecha, -1)
  const deDosDias = await filasDeUso(cuenta.id, ayer, fecha)
  const previas = deDosDias.filter((d) => d.fechaLocal === fecha)
  const previaDe = new Map(previas.map((d) => [d.campaignId, d]))
  const activaAyer = new Set(deDosDias.filter((d) => d.fechaLocal === ayer && (d.estadoCampana ?? 'ENABLED').toUpperCase() === 'ENABLED').map((d) => d.campaignId))

  const activas = campanas.filter((c) => (c.estado ?? '').toUpperCase() === 'ENABLED')
  const usos = new Map<string, { usoPct: number | null; presupuesto: number | null; actualizadoAt: string | null }>()
  let error: string | null = null
  let transitorio = false

  if (activas.length > 0) {
    const errores: string[] = []
    let todosPasajeros = true
    let aciertos = 0
    const lotes = lotesDeCampanas(activas.map((c) => c.campaignId))
    for (const lote of opciones.soloPrueba ? lotes.slice(0, 1) : lotes) {
      try {
        const crudo = await llamarAds<unknown>(cuenta.conexionId, RUTA_USO, {
          perfilId: cuenta.profileId,
          metodo: 'POST',
          cabeceras: { Accept: TIPO_USO, 'Content-Type': TIPO_USO },
          cuerpo: { campaignIds: lote },
        })
        const r = leerRespuestaDeUso(crudo)
        for (const u of r.usos) usos.set(u.campaignId, u)
        aciertos += r.usos.length
        if (r.todoError) {
          const e = r.errores[0]
          // Un 207 en que todo falla no es de red: se repetiría igual (persistente)
          todosPasajeros = false
          errores.push(`la API de uso no ha dado ninguna lectura (${e?.codigo ?? 'error'}${e?.detalle ? `: ${e.detalle.slice(0, 160)}` : ''})`)
        }
      } catch (err) {
        if (!falloDeUsoEsPasajero(err)) todosPasajeros = false
        if (err instanceof AdsError && err.estado === 429) {
          errores.push('Amazon ha pedido esperar (429): no se reintenta en esta pasada')
          break
        }
        errores.push(err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300))
        // Un fallo que no es de un lote concreto (autorización, red) se repetiría en todos: se para aquí
        break
      }
    }
    // Un lote que falla con otros que leen bien es un hueco, no un error de la API
    if (errores.length && aciertos === 0) {
      error = `Uso de presupuesto: ${errores.join(' · ')}`
      transitorio = todosPasajeros
    } else if (errores.length) console.error(`[agente] uso de presupuesto de ${cuenta.id} incompleto:`, errores.join(' · '))
  }

  // Fusión: las activas (con o sin lectura de la API), las que ya tenían fila hoy (su gasto cuenta aunque se hayan pausado) y las que ayer acabaron activas
  const nuevas: DiaDeUso[] = []
  const tocadas = new Set<string>()
  const conRegla = new Map<string, number>()
  for (const c of campanas) {
    const esActiva = (c.estado ?? '').toUpperCase() === 'ENABLED'
    if (!esActiva && !previaDe.has(c.campaignId) && !activaAyer.has(c.campaignId)) continue
    const lectura = lecturaDeCampana(c, usos.get(c.campaignId))
    // Regla de presupuesto de Amazon activa: el efectivo de hoy no es el base (se apunta en las métricas de las propuestas de presupuesto)
    if (lectura.presupuestoEfectivo != null && lectura.presupuesto != null && Math.abs(lectura.presupuestoEfectivo - lectura.presupuesto) > 0.004) conRegla.set(c.campaignId, lectura.presupuestoEfectivo)
    nuevas.push(fusionarDiaDeUso(previaDe.get(c.campaignId) ?? null, lectura, ahora, zona))
    tocadas.add(c.campaignId)
  }
  const dias = [...nuevas, ...previas.filter((d) => !tocadas.has(d.campaignId))]

  const service = createServiceClient()
  for (let i = 0; i < nuevas.length; i += LOTE_UPSERT) {
    const { error: e } = await service.from('ads_presupuesto_dia').upsert(nuevas.slice(i, i + LOTE_UPSERT).map((d) => filaDeDia(cuenta.id, d)), { onConflict: 'perfil_id,campaign_id,fecha_local' })
    if (e) lanzar(e)
  }
  if (dias.length > 0) {
    const local = horaLocal(ahora, zona)
    const h = horaDeCuenta(dias, fecha, local.hora)
    const { error: e } = await service.from('ads_gasto_hora').upsert(
      { perfil_id: cuenta.id, fecha_local: h.fechaLocal, hora: h.hora, gasto_acum: h.gastoAcum, suma_presupuestos: h.sumaPresupuestos, leido_at: new Date(ahora).toISOString() },
      { onConflict: 'perfil_id,fecha_local,hora' },
    )
    if (e) lanzar(e)
  }

  return { dias, error, transitorio, conRegla }
}

/** Las filas de `ads_presupuesto_dia` entre dos fechas locales (ambas incluidas) */
export async function diasDeUso(perfilId: string, desde: string, hasta: string): Promise<DiaDeUso[]> {
  return filasDeUso(perfilId, desde, hasta)
}

/** Las filas de `ads_gasto_hora` entre dos fechas locales (ambas incluidas) */
export async function horasDeCuenta(perfilId: string, desde: string, hasta: string): Promise<HoraDeCuenta[]> {
  const service = createServiceClient()
  const r = await todasLasFilas<Record<string, unknown>>((a, b) =>
    service
      .from('ads_gasto_hora')
      .select('fecha_local, hora, gasto_acum, suma_presupuestos')
      .eq('perfil_id', perfilId)
      .gte('fecha_local', desde)
      .lte('fecha_local', hasta)
      .order('fecha_local')
      .order('hora')
      .range(a, b) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: { code?: string; message?: string } | null }>,
  20_000)
  if (r.error) lanzar(r.error)
  return r.data.map((x) => ({ fechaLocal: String(x.fecha_local).slice(0, 10), hora: Number(x.hora), gastoAcum: numero(x.gasto_acum) ?? 0, sumaPresupuestos: numero(x.suma_presupuestos) }))
}

/** PURO. El mayor % de ajuste por ubicación de una campaña v3 (0 si no tiene) */
export function maximoDeUbicacion(c: Record<string, unknown>): number {
  const puja = c.dynamicBidding as { placementBidding?: Array<{ percentage?: unknown }> } | undefined
  let max = 0
  for (const p of puja?.placementBidding ?? []) {
    const n = numero(p?.percentage)
    if (n != null && n > max) max = n
  }
  return max
}

/**
 * El mayor % de ajuste por ubicación de cada campaña (`dynamicBidding.placementBidding`), con `POST /sp/campaigns/list` filtrado por ids (lotes de 100). Una lectura: fuera de conRastro.
 * Las campañas que Amazon no devuelve no salen en el Map.
 */
export async function leerAjustesDeUbicacion(cuenta: CuentaParaSincronizar, campaignIds: readonly string[]): Promise<Map<string, number>> {
  const salida = new Map<string, number>()
  for (const lote of lotesDeCampanas(campaignIds)) {
    let token: string | undefined
    for (let pagina = 0; pagina < 10; pagina++) {
      const res = await llamarAds<{ campaigns?: Array<Record<string, unknown>>; nextToken?: string }>(cuenta.conexionId, '/sp/campaigns/list', {
        perfilId: cuenta.profileId,
        metodo: 'POST',
        cabeceras: { Accept: TIPO_CAMPANA, 'Content-Type': TIPO_CAMPANA },
        cuerpo: { campaignIdFilter: { include: lote }, maxResults: 500, ...(token ? { nextToken: token } : {}) },
      })
      for (const c of res.campaigns ?? []) {
        const id = c.campaignId != null ? String(c.campaignId) : ''
        if (id) salida.set(id, maximoDeUbicacion(c))
      }
      token = res.nextToken
      if (!token) break
    }
  }
  return salida
}

/** PURO. ¿Tiene tope de presupuesto este portfolio? Política distinta de «sin tope» con importe, o un importe puesto sin política */
export function portfolioTopado(p: Record<string, unknown>): { topado: boolean; porque: string | null } {
  const budget = (p.budget ?? null) as { amount?: unknown; policy?: unknown; currencyCode?: unknown } | null
  if (!budget) return { topado: false, porque: null }
  const politica = String(budget.policy ?? '').toUpperCase().replace(/[^A-Z]/g, '')
  const importe = numero(budget.amount)
  if (politica === 'NOCAP' || politica === '') {
    if (politica === '' && importe != null && importe > 0) return { topado: true, porque: `el portfolio tiene un presupuesto de ${importe.toLocaleString('es-ES')}` }
    return { topado: false, porque: null }
  }
  const texto = politica === 'MONTHLYRECURRING' ? 'mensual' : politica === 'DATERANGE' ? 'por fechas' : politica.toLowerCase()
  return { topado: true, porque: `el portfolio tiene un presupuesto ${texto}${importe != null ? ` de ${importe.toLocaleString('es-ES')}` : ''}` }
}

/**
 * Los portfolios de la cuenta y si tienen tope de presupuesto (`POST /portfolios/list`, v3). Clave: portfolioId. Las reglas de presupuesto de cada campaña no se miran aquí (serían una llamada por
 * campaña): Amazon ya las aplica al `budget` que devuelve la API de uso (el efectivo, `conRegla` de leerUsoDePresupuesto).
 */
export async function leerPortfolios(cuenta: CuentaParaSincronizar): Promise<Map<string, { topado: boolean; porque: string | null }>> {
  const salida = new Map<string, { topado: boolean; porque: string | null }>()
  let token: string | undefined
  for (let pagina = 0; pagina < 10; pagina++) {
    const res = await llamarAds<{ portfolios?: Array<Record<string, unknown>>; nextToken?: string }>(cuenta.conexionId, '/portfolios/list', {
      perfilId: cuenta.profileId,
      metodo: 'POST',
      cabeceras: { Accept: TIPO_PORTFOLIO, 'Content-Type': TIPO_PORTFOLIO },
      cuerpo: { maxResults: 100, ...(token ? { nextToken: token } : {}) },
    })
    for (const p of res.portfolios ?? []) {
      const id = p.portfolioId != null ? String(p.portfolioId) : ''
      if (id) salida.set(id, portfolioTopado(p))
    }
    token = res.nextToken
    if (!token) break
  }
  return salida
}

