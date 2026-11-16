/**
 * AMAZON ADS · EL AGENTE PPC: EFECTOS DE LOS CAMBIOS Y DESHACER AUTOMÁTICO (SOLO SERVIDOR). Solo lee y escribe tablas del ERP: nunca llama a Amazon.
 *
 * Cada cambio que el agente aplica DE VERDAD abre una fila en `ads_efectos` (`abrirEfecto`, nunca lanza). El paso `efectos` del cron
 * (`medirEfectos`) la va midiendo con los datos que ya hay en la base:
 *   · rápida      [d+1, d+3]  desde d+6,  solo para las RARAS que la IA mandó aplicar → deshacer si las ventas caen un 30 % frente al control;
 *   · provisional [d+1, d+7]  desde d+10 → libera la cuarentena (`revisado_7d_at`) y deshace las subidas que salen mal;
 *   · final       [d+1, d+14] desde d+17 → veredicto (tabla de Ads + capa de NEGOCIO con las ventas totales del ASIN).
 * `d` es el día LOCAL del marketplace en que se aplicó. Las métricas salen de `ads_objetivos_diario` (segmentación) y `ads_rendimiento_diario`
 * (campaña); las ventas totales, de la instantánea de `ads_ventas_asin` (que es un periodo entero, no día a día: se guarda la de antes al abrir
 * y se toma la de después al medir, comparando por día); las negativas, además, con las copias SEMANALES de `ads_terminos_semana` (la semana
 * anterior al cambio frente a la de 5 semanas después, que no se solapan).
 *
 * Reglas de dependencias (§1 de la spec): este módulo importa solo de la oleada 1 y del código que ya existe. El deshacer le llega INYECTADO
 * (`deps.deshacer`) y no anota eventos ni avisa: devuelve qué deshizo y qué solo hay que contar (`deshechos`, `soloAviso`) al orquestador.
 * Sin la migración 315: `abrirEfecto` no hace nada, las lecturas devuelven vacío y `medirEfectos` lanza `FALTA_MIGRACION_315`.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { todasLasFilas } from '../paginar'
import { FICHA_DE_ARRANQUE, leerFicha } from '../cuenta'
import { asinDeCampana } from '../productos-agrupar'
import type { Propuesta } from '../motor'
import type { CuentaParaSincronizar } from '../sincronizar'
import {
  AGENTE,
  ERROR_INTERRUPTOR_GENERAL,
  FALTA_MIGRACION_315,
  type ClaseDeCambio,
  type EventoDeTemporada,
  type FaseDeProducto,
  type MedicionDeEfecto,
  type MetricasDeVentana,
  type Veredicto,
} from './tipos'
import { debeDeshacer, debeDeshacerRara, elegirControl, estaMezclado, sumarVentana, valorDeDeshacerPresupuesto, ventanasDeEfecto, veredicto } from './efectos-calculo'
import { claseDeCambio } from './guardarrailes-calculo'
import { eventosManualesValidos, ventanaTocaEvento } from './temporada-calculo'
import { horaLocal, zonaDePais } from './uso-calculo'

// ─── utilidades puras (exportadas para las pruebas) ─────────────────────────

const DIA_MS = 86_400_000

/** Suma días a una fecha 'YYYY-MM-DD' con aritmética UTC */
export function sumarDias(fecha: string, dias: number): string {
  return new Date(Date.parse(`${fecha.slice(0, 10)}T00:00:00Z`) + dias * DIA_MS).toISOString().slice(0, 10)
}

/** Días de calendario entre dos fechas, ambas incluidas (0 si no tiene sentido) */
function diasEntre(desde: string, hasta: string): number {
  const a = Date.parse(`${desde.slice(0, 10)}T00:00:00Z`)
  const b = Date.parse(`${hasta.slice(0, 10)}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0
  return Math.round((b - a) / DIA_MS) + 1
}

const num = (v: unknown): number => {
  const x = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(x) ? x : 0
}
const numONulo = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const x = Number(v)
  return Number.isFinite(x) ? x : null
}
const redondear2 = (n: number) => Math.round(n * 100) / 100
const es = (n: number) => redondear2(n).toLocaleString('es-ES')

const VACIA = (dias: number): MetricasDeVentana => ({ clics: 0, gasto: 0, ventas: 0, pedidos: 0, dias })

/**
 * El CVR como FRACCIÓN (0,008 = 0,8 %). Solo acepta fracciones: no adivina si llega en % (0,8 % y 0,8 = 80 % no se distinguen; adivinarlo daba
 * muestras mínimas de 12 clics donde hacían falta 250). > 1, ≤ 0 o sin dato → null. Quien tenga el CVR en % lo divide entre 100 antes (`cvrDeMetricas`).
 */
export function cvrComoFraccion(cvr: number | null | undefined): number | null {
  if (cvr === null || cvr === undefined || !Number.isFinite(cvr) || cvr <= 0 || cvr > 1) return null
  return cvr
}

/** PURO. El CVR de las métricas de una propuesta (`cvrPct`, en %: 0,8 = 0,8 %) como fracción (0,008); null sin dato */
export function cvrDeMetricas(metricas: Record<string, unknown> | null | undefined): number | null {
  const pct = metricas?.cvrPct
  return typeof pct === 'number' && Number.isFinite(pct) && pct > 0 ? cvrComoFraccion(pct / 100) : null
}

/** Qué datos mira cada clase: la segmentación (pujas), la campaña (presupuestos, pausas de campaña, negativas, pausas) o la segmentación NUEVA (promover) */
export type NivelDeEfecto = 'segmentacion' | 'campana' | 'nueva'

/** Nivel de las métricas de la unidad */
export function nivelDeUnidad(clase: ClaseDeCambio, tieneObjetivo: boolean): NivelDeEfecto {
  if (clase === 'promover') return 'nueva'
  if ((clase === 'puja_subir' || clase === 'puja_bajar' || clase === 'puja_bajar_sin_pedidos' || clase === 'pausar') && tieneObjetivo) return 'segmentacion'
  return 'campana'
}

/** Nivel del grupo de control: segmentaciones para las pujas; campañas para lo demás (pausar y negativizar se juzgan por su campaña); sin control para promover */
export function nivelDeControl(clase: ClaseDeCambio, tieneObjetivo: boolean): NivelDeEfecto | null {
  if (clase === 'promover' || clase === 'pausar_campana') return null
  if ((clase === 'puja_subir' || clase === 'puja_bajar' || clase === 'puja_bajar_sin_pedidos') && tieneObjetivo) return 'segmentacion'
  return 'campana'
}

/**
 * Las métricas que mira la medición RÁPIDA y la PROVISIONAL (las que deciden un deshacer): la segmentación en las pujas; la campaña en lo demás
 * (en promover, la campaña de ORIGEN: la segmentación nueva no tiene «antes»).
 */
export function nivelDeDeshacer(clase: ClaseDeCambio, tieneObjetivo: boolean): 'segmentacion' | 'campana' {
  return nivelDeUnidad(clase, tieneObjetivo) === 'segmentacion' ? 'segmentacion' : 'campana'
}

/** Instantánea de `ads_venta_asin` (un periodo entero de 7, 14 o 30 días) */
export interface InstantaneaDeVentas {
  dias: number
  desde: string
  hasta: string
  ventas: number
}

/**
 * LA INSTANTÁNEA DE VENTAS TOTALES que vale para una ventana del cambio aplicado el día `d`:
 *   · `antes`: termina ANTES de d y no más de 5 días antes (la de ayer al aplicar); prefiere 14, luego 30, luego 7 días;
 *   · `despues`: empieza el día d+1 o más tarde; prefiere `preferencia` (14 para la final, 7 para la provisional).
 * null si ninguna vale. Se compara por día, así que la ventana no tiene que medir lo mismo que la de Ads.
 */
export function elegirInstantanea(filas: readonly InstantaneaDeVentas[], d: string, cual: 'antes' | 'despues', preferencia: readonly number[] = [14, 30, 7]): InstantaneaDeVentas | null {
  const validas = filas.filter((f) => {
    if (diasEntre(f.desde, f.hasta) <= 0) return false
    if (cual === 'antes') return f.hasta < d && f.hasta >= sumarDias(d, -5)
    return f.desde >= sumarDias(d, 1)
  })
  for (const dias of preferencia) {
    const f = validas.find((x) => x.dias === dias)
    if (f) return f
  }
  return validas[0] ?? null
}

/** Una copia semanal de un término (`ads_terminos_semana`): la suma de su ventana móvil de 30 días tomada ese lunes */
export interface CopiaSemanal {
  semana: string
  desde: string | null
  hasta: string | null
  clics: number
  gasto: number
  ventas: number
  pedidos: number
}

/**
 * LAS DOS COPIAS SEMANALES DE UNA NEGATIVA que no se solapan: la última tomada ANTES del día del cambio y la primera tomada al menos
 * 5 semanas después de ella. `lista` = ya se puede medir (hay copia de después, o no había de antes, o han pasado 7 semanas sin ella).
 */
export function copiasDeNegativa(filas: readonly CopiaSemanal[], d: string, hoy: string): { antes: CopiaSemanal | null; despues: CopiaSemanal | null; lista: boolean } {
  const orden = filas.filter((f) => f.semana <= hoy).sort((a, b) => a.semana.localeCompare(b.semana))
  const antes = [...orden].reverse().find((f) => f.semana < d) ?? null
  if (!antes) return { antes: null, despues: null, lista: true }
  const desde = sumarDias(antes.semana, AGENTE.NEGATIVAS_SEMANAS_DESPUES * 7)
  const despues = orden.find((f) => f.semana >= desde) ?? null
  const limite = sumarDias(d, (AGENTE.NEGATIVAS_SEMANAS_DESPUES + 2) * 7)
  return { antes, despues, lista: !!despues || hoy >= limite }
}

/** De una copia semanal a métricas de ventana (los días, los de su ventana; 30 si no los trae) */
export function metricasDeCopia(c: CopiaSemanal | null): MetricasDeVentana | null {
  if (!c) return null
  const dias = c.desde && c.hasta ? diasEntre(c.desde, c.hasta) : 30
  return { clics: num(c.clics), gasto: redondear2(num(c.gasto)), ventas: redondear2(num(c.ventas)), pedidos: num(c.pedidos), dias: dias || 30 }
}

/** Qué mediciones tocan hoy a una fila abierta */
export function medicionesQueTocan(
  f: { aplicada_dia: string; rara_aplicada: boolean; rapida_at: string | null; revisado_7d_at: string | null; medido_at: string | null },
  hoy: string,
  negativaLista = true,
): { rapida: boolean; provisional: boolean; final: boolean } {
  if (f.medido_at) return { rapida: false, provisional: false, final: false }
  const v = ventanasDeEfecto(f.aplicada_dia)
  return {
    rapida: f.rara_aplicada && !f.rapida_at && hoy >= v.medirRapidaDesde,
    provisional: !f.revisado_7d_at && hoy >= v.medirProvisionalDesde,
    final: hoy >= v.medirFinalDesde && negativaLista,
  }
}

/** Un cambio aplicado en la cuenta (propuesta o entrada del log), con su día LOCAL */
export interface CambioEnCuenta {
  fecha: string
  objetivoId: string | null
  campaignId: string | null
  /** Cambio de la campaña entera (presupuesto, estado de la campaña) */
  deCampana: boolean
  /** Término (negativas y promociones), en minúsculas */
  termino: string | null
  propuestaId: string | null
}

/**
 * Los días de OTROS cambios en la misma unidad (o en su campaña, si fue un cambio de la campaña entera), sin contar los de la propia propuesta.
 * Unidad: la segmentación en pujas y pausas; la campaña en presupuestos y pausas de campaña; el término (y su campaña) en negativas y promociones.
 */
export function otrosCambiosDeLaUnidad(
  cambios: readonly CambioEnCuenta[],
  u: { propuestaId: string; clase: ClaseDeCambio; objetivoId: string | null; campaignId: string | null; termino: string | null },
): string[] {
  const termino = u.termino ? u.termino.toLowerCase() : null
  return cambios
    .filter((c) => {
      if (c.propuestaId && c.propuestaId === u.propuestaId) return false
      if (u.campaignId && c.deCampana && c.campaignId === u.campaignId) return true
      if (u.objetivoId && c.objetivoId === u.objetivoId) return true
      if ((u.clase === 'negativizar' || u.clase === 'promover') && termino && c.termino === termino && (!u.campaignId || c.campaignId === u.campaignId)) return true
      return false
    })
    .map((c) => c.fecha)
}

/** Las unidades tocadas en [d−14, d+14]: ids de segmentación y de campaña (solo cambios de la campaña entera) */
export function unidadesTocadas(cambios: readonly CambioEnCuenta[], d: string): { objetivos: Set<string>; campanas: Set<string> } {
  const desde = sumarDias(d, -AGENTE.EFECTOS_VENTANA)
  const hasta = sumarDias(d, AGENTE.EFECTOS_VENTANA)
  const objetivos = new Set<string>()
  const campanas = new Set<string>()
  for (const c of cambios) {
    if (c.fecha < desde || c.fecha > hasta) continue
    if (c.objetivoId) objetivos.add(c.objetivoId)
    if (c.deCampana && c.campaignId) campanas.add(c.campaignId)
  }
  return { objetivos, campanas }
}

/** CPA objetivo = valor medio del pedido (antes) × ACoS objetivo; null sin pedidos o sin objetivo */
export function cpaObjetivoDe(acosObjetivoPct: number | null, ...ventanas: Array<MetricasDeVentana | null | undefined>): number | null {
  if (acosObjetivoPct === null || !(acosObjetivoPct > 0)) return null
  for (const v of ventanas) {
    if (v && v.pedidos > 0 && v.ventas > 0) return redondear2((v.ventas / v.pedidos) * (acosObjetivoPct / 100))
  }
  return null
}

// ─── errores y 315 ─────────────────────────────────────────────────────────

type ErrorDb = { code?: string; message?: string } | null
const falta315 = (e: ErrorDb) => !!e && (isMissingSchema(e) || e.code === '23514')

// ─── abrir ─────────────────────────────────────────────────────────────────

/**
 * ABRE la medición de un cambio aplicado de verdad. NUNCA LANZA (lo que no se pueda medir no deshace lo hecho en Amazon).
 * `aplicada_dia` = día LOCAL del marketplace (de `resueltaAt` o de ahora). Guarda la clase, el objetivo, el CVR, la fase, si fue una rara
 * aplicada por la IA y la instantánea de ventas totales del ASIN de ANTES (la de `ads_ventas_asin` se sobrescribe cada día: luego no estaría).
 */
export async function abrirEfecto(
  perfilId: string,
  p: Propuesta,
  ctx: { acosObjetivoPct: number | null; cvr: number | null; fase: FaseDeProducto; raraAplicada: boolean; zona: string },
): Promise<void> {
  try {
    const instante = p.resueltaAt && Number.isFinite(Date.parse(p.resueltaAt)) ? Date.parse(p.resueltaAt) : Date.now()
    const aplicadaDia = horaLocal(instante, ctx.zona || 'Europe/Madrid').fecha
    const clase = claseDeCambio({ tipo: p.tipo, valorActual: p.valorActual, valorNuevo: p.valorNuevo, metricas: { pedidos: num(p.metricas?.pedidos) } })
    const conObjetivo = (p.tipo === 'puja' || p.tipo === 'pausar') && !!p.objetivoId
    const asin = p.asin ? p.asin.toUpperCase() : null

    let ventasAntes: InstantaneaDeVentas | null = null
    if (asin) {
      try {
        const { data } = await createServiceClient().from('ads_ventas_asin').select('dias, desde, hasta, ventas').eq('perfil_id', perfilId).eq('asin', asin)
        ventasAntes = elegirInstantanea(((data ?? []) as Array<Record<string, unknown>>).map(deInstantanea), aplicadaDia, 'antes')
      } catch {
        ventasAntes = null
      }
    }

    const acos = ctx.acosObjetivoPct !== null && Number.isFinite(ctx.acosObjetivoPct) && ctx.acosObjetivoPct > 0 ? Math.min(100, redondear2(ctx.acosObjetivoPct)) : null
    const cvr = cvrComoFraccion(ctx.cvr)
    const fila = {
      propuesta_id: p.id,
      perfil_id: perfilId,
      clase,
      asin,
      campaign_id: p.campaignId || null,
      objetivo_id: conObjetivo ? p.objetivoId : null,
      aplicada_dia: aplicadaDia,
      acos_objetivo_pct: acos,
      cvr: cvr === null ? null : Math.round(cvr * 10_000) / 10_000,
      fase: ctx.fase,
      rara_aplicada: ctx.raraAplicada,
      ventas_totales: { antes: ventasAntes },
    }
    const { error } = await createServiceClient().from('ads_efectos').upsert(fila, { onConflict: 'propuesta_id', ignoreDuplicates: true })
    if (error && !falta315(error)) console.error('[agente·efectos] no se pudo abrir el efecto', p.id, error.message)
  } catch (e) {
    console.error('[agente·efectos] abrirEfecto', p.id, e instanceof Error ? e.message : e)
  }
}

function deInstantanea(r: Record<string, unknown>): InstantaneaDeVentas {
  return { dias: num(r.dias), desde: String(r.desde ?? '').slice(0, 10), hasta: String(r.hasta ?? '').slice(0, 10), ventas: num(r.ventas) }
}

// ─── lecturas pequeñas ─────────────────────────────────────────────────────

/** Cambios hechos A MANO (origen «manual» en el log) sobre esa segmentación o campaña desde ese instante. Sin el log o sin la 311: lo que se pueda (por campaña) */
export async function cambiosAManoDesde(perfilId: string, entidadId: string, desdeIso: string): Promise<number> {
  if (!entidadId) return 0
  const db = createServiceClient()
  const ENTIDADES = ['campaña', 'grupo', 'anuncio', 'keyword', 'target', 'negativa']
  const { count, error } = await db
    .from('ads_cambios_log')
    .select('id', { count: 'exact', head: true })
    .eq('perfil_id', perfilId)
    .eq('origen', 'manual')
    .eq('ok', true)
    .in('entidad', ENTIDADES)
    .gte('creado_at', desdeIso)
    .or(`entidad_id.eq.${entidadId},and(campaign_id.eq.${entidadId},entidad.eq.campaña)`)
  if (!error) return count ?? 0
  if (!isMissingSchema(error)) throw error
  // Sin la 311 (sin entidad_id): solo se puede saber de los cambios de la campaña entera
  const r = await db
    .from('ads_cambios_log')
    .select('id', { count: 'exact', head: true })
    .eq('perfil_id', perfilId)
    .eq('origen', 'manual')
    .eq('ok', true)
    .eq('entidad', 'campaña')
    .eq('campaign_id', entidadId)
    .gte('creado_at', desdeIso)
  if (r.error) {
    if (isMissingSchema(r.error)) return 0
    throw r.error
  }
  return r.count ?? 0
}

/** Veredictos de los últimos `dias` días (por `medido_at`), los más recientes primero. Sin la 315: vacío */
export async function veredictosRecientes(perfilId: string, dias: number): Promise<Array<{ clase: ClaseDeCambio; veredicto: Veredicto; medidoAt: string; detalle: string | null; propuestaId: string }>> {
  const desde = new Date(Date.now() - Math.max(1, dias) * DIA_MS).toISOString()
  const { data, error } = await todasLasFilas<Record<string, unknown>>(
    (a, b) =>
      createServiceClient()
        .from('ads_efectos')
        .select('propuesta_id, clase, veredicto, medido_at, detalle')
        .eq('perfil_id', perfilId)
        .not('veredicto', 'is', null)
        .gte('medido_at', desde)
        .order('medido_at', { ascending: false })
        .order('propuesta_id')
        .range(a, b),
    10_000,
  )
  if (error) {
    if (falta315(error)) return []
    throw error
  }
  return data.map((r) => ({
    clase: r.clase as ClaseDeCambio,
    veredicto: r.veredicto as Veredicto,
    medidoAt: String(r.medido_at),
    detalle: (r.detalle as string | null) ?? null,
    propuestaId: String(r.propuesta_id),
  }))
}

const CLASES_DE_PRESUPUESTO: ReadonlySet<string> = new Set(['presupuesto_subir', 'presupuesto_bajar', 'pausar_campana'])

/**
 * Las segmentaciones y campañas con un efecto ABIERTO (sin la medición provisional): en modo agente no se les propone nada hasta entonces.
 * `campanas` = campañas con un cambio de presupuesto o de estado de la campaña sin medir. Sin la 315: vacío.
 */
export async function efectosAbiertos(perfilId: string): Promise<{ objetivos: string[]; campanas: string[] }> {
  const { data, error } = await todasLasFilas<Record<string, unknown>>(
    (a, b) => createServiceClient().from('ads_efectos').select('propuesta_id, clase, objetivo_id, campaign_id').eq('perfil_id', perfilId).is('revisado_7d_at', null).order('propuesta_id').range(a, b),
    20_000,
  )
  if (error) {
    if (falta315(error)) return { objetivos: [], campanas: [] }
    throw error
  }
  const objetivos = new Set<string>()
  const campanas = new Set<string>()
  for (const r of data) {
    if (r.objetivo_id) objetivos.add(String(r.objetivo_id))
    if (r.campaign_id && CLASES_DE_PRESUPUESTO.has(String(r.clase))) campanas.add(String(r.campaign_id))
  }
  return { objetivos: [...objetivos], campanas: [...campanas] }
}

// ─── medir ─────────────────────────────────────────────────────────────────

interface FilaDeEfecto {
  propuesta_id: string
  clase: ClaseDeCambio
  asin: string | null
  campaign_id: string | null
  objetivo_id: string | null
  aplicada_dia: string
  acos_objetivo_pct: number | null
  cvr: number | null
  fase: string | null
  rara_aplicada: boolean
  antes: Record<string, unknown> | null
  rapida: Record<string, unknown> | null
  provisional: Record<string, unknown> | null
  ventas_totales: { antes?: InstantaneaDeVentas | null; despues?: InstantaneaDeVentas | null; provisional?: InstantaneaDeVentas | null } | null
  rapida_at: string | null
  revisado_7d_at: string | null
  medido_at: string | null
  deshecho_auto: boolean
  creado_at: string
}

interface PropuestaDelEfecto {
  id: string
  tipo: string
  estado: string
  termino: string
  campaignId: string | null
  campaignNombre: string | null
  objetivoId: string | null
  haciaCampaignId: string | null
  valorActual: number | null
  valorNuevo: number | null
  resueltaAt: string | null
}

interface FilaDiaria {
  fecha: string
  clics: number
  gasto: number
  ventas: number
  pedidos: number
}

type Deps = {
  deshacer: (propuestaId: string, motivo: string, valorMaximo?: number) => Promise<{ ok: boolean; error: string | null }>
  permitidoHoyPresupuesto: (campaignId: string, anterior: number) => Promise<number | null>
  /** Deshacer una BAJADA de presupuesto es subirlo: hasta dónde deja volver hoy el guardarraíl de la suma ({ valor }) o por qué no ({ no }) */
  permitidoVolverBajada: (campaignId: string, actual: number, anterior: number) => Promise<{ valor: number } | { no: string }>
  puedeDeshacer: boolean
}

const FILAS_A_MIRAR = 1000

/**
 * MIDE los efectos que tocan hoy (fecha LOCAL del marketplace). Como mucho `AGENTE.EFECTOS_MAX_POR_PASADA` (10) filas con trabajo y
 * `AGENTE.DESHACER_MAX_POR_PASADA` (2) deshacer por pasada; `quedan = true` si se queda algo para la siguiente. Con `deps.puedeDeshacer = false`
 * (agente frenado) solo mide: lo que habría deshecho va a `soloAviso`. Antes de deshacer, si una persona tocó esa segmentación o campaña desde
 * el cambio (log), no se deshace: solo se avisa. Una negativa nunca se deshace sola.
 */
export async function medirEfectos(
  cuenta: CuentaParaSincronizar,
  ahora: number,
  deps: Deps,
): Promise<{ medidos: number; provisionales: number; rapidas: number; quedan: boolean; deshechos: Array<{ propuestaId: string; texto: string }>; soloAviso: Array<{ propuestaId: string; texto: string }> }> {
  const perfilId = cuenta.id
  const db = createServiceClient()
  const salida = { medidos: 0, provisionales: 0, rapidas: 0, quedan: false, deshechos: [] as Array<{ propuestaId: string; texto: string }>, soloAviso: [] as Array<{ propuestaId: string; texto: string }> }

  // 1) Las filas abiertas, más viejas primero
  const abiertas = await db
    .from('ads_efectos')
    .select('propuesta_id, clase, asin, campaign_id, objetivo_id, aplicada_dia, acos_objetivo_pct, cvr, fase, rara_aplicada, antes, rapida, provisional, ventas_totales, rapida_at, revisado_7d_at, medido_at, deshecho_auto, creado_at')
    .eq('perfil_id', perfilId)
    .is('medido_at', null)
    .order('aplicada_dia', { ascending: true })
    .order('propuesta_id')
    .limit(FILAS_A_MIRAR)
  if (abiertas.error) {
    if (falta315(abiertas.error)) throw new Error(FALTA_MIGRACION_315)
    throw abiertas.error
  }
  const filas = ((abiertas.data ?? []) as Array<Record<string, unknown>>).map(deFilaDeEfecto)
  if (filas.length === 0) return salida

  // 2) Zona, país y eventos de la cuenta
  const perfil = await db.from('ads_profiles').select('pais, zona_horaria').eq('id', perfilId).maybeSingle()
  const pais = String((perfil.data as { pais?: string | null } | null)?.pais ?? '').toUpperCase()
  const zona = zonaDePais(pais, (perfil.data as { zona_horaria?: string | null } | null)?.zona_horaria ?? null)
  const hoy = horaLocal(ahora, zona).fecha
  let manuales: EventoDeTemporada[] = []
  {
    const { data } = await db.from('ads_agente').select('eventos_manuales').eq('perfil_id', perfilId).maybeSingle()
    manuales = eventosManualesValidos((data as { eventos_manuales?: unknown } | null)?.eventos_manuales)
  }

  // 3) Elegir las que tienen trabajo hoy (las negativas, cuando su copia semanal de después ya está o se ha esperado bastante)
  const candidatas = filas.filter((f) => {
    const t = medicionesQueTocan(f, hoy)
    return t.rapida || t.provisional || t.final
  })
  if (candidatas.length === 0) return salida

  const propuestas = await leerPropuestas(perfilId, candidatas.map((f) => f.propuesta_id))
  const copias = await leerCopiasDeNegativas(perfilId, candidatas.filter((f) => f.clase === 'negativizar'), propuestas)

  const conTrabajo: Array<{ f: FilaDeEfecto; toca: { rapida: boolean; provisional: boolean; final: boolean }; copias: ReturnType<typeof copiasDeNegativa> | null }> = []
  for (const f of candidatas) {
    const c = f.clase === 'negativizar' ? copiasDeNegativa(copias.get(f.propuesta_id) ?? [], f.aplicada_dia, hoy) : null
    const toca = medicionesQueTocan(f, hoy, c ? c.lista : true)
    if (toca.rapida || toca.provisional || toca.final) conTrabajo.push({ f, toca, copias: c })
  }
  if (conTrabajo.length > AGENTE.EFECTOS_MAX_POR_PASADA) salida.quedan = true
  const lote = conTrabajo.slice(0, AGENTE.EFECTOS_MAX_POR_PASADA)
  if (lote.length === 0) return salida

  // 4) Datos del lote: rango de fechas común
  const desdeDatos = lote.reduce((m, x) => (sumarDias(x.f.aplicada_dia, -AGENTE.EFECTOS_VENTANA) < m ? sumarDias(x.f.aplicada_dia, -AGENTE.EFECTOS_VENTANA) : m), '9999-12-31')
  const hastaVentanas = lote.reduce((m, x) => (sumarDias(x.f.aplicada_dia, AGENTE.EFECTOS_VENTANA) > m ? sumarDias(x.f.aplicada_dia, AGENTE.EFECTOS_VENTANA) : m), '0000-01-01')
  const hastaDatos = hastaVentanas < sumarDias(hoy, -1) ? hastaVentanas : sumarDias(hoy, -1)

  let muestraMinimaClics = FICHA_DE_ARRANQUE.muestraMinimaClics
  try {
    muestraMinimaClics = (await leerFicha(perfilId)).muestraMinimaClics
  } catch {
    /* ficha de arranque */
  }

  const campanas = await leerCampanas(perfilId, desdeDatos, hastaDatos)
  const asinDe = new Map<string, string | null>()
  for (const [id, c] of campanas) asinDe.set(id, c.nombre ? asinDeCampana(c.nombre) : null)

  // Segmentaciones: las de las campañas de las pujas/pausas/promociones del lote y las de las campañas de su mismo ASIN (para el control)
  const campanasDeSegmentaciones = new Set<string>()
  for (const { f } of lote) {
    const nivel = nivelDeUnidad(f.clase, !!f.objetivo_id)
    if (nivel === 'campana') continue
    const p = propuestas.get(f.propuesta_id)
    if (f.campaign_id) campanasDeSegmentaciones.add(f.campaign_id)
    if (p?.haciaCampaignId) campanasDeSegmentaciones.add(p.haciaCampaignId)
    if (nivelDeControl(f.clase, !!f.objetivo_id) === 'segmentacion' && f.asin) {
      for (const [id, a] of asinDe) if (a === f.asin) campanasDeSegmentaciones.add(id)
    }
  }
  const segmentaciones = await leerSegmentaciones(perfilId, [...campanasDeSegmentaciones], desdeDatos, hastaDatos)

  const cambios = await leerCambios(perfilId, sumarDias(desdeDatos, -1), sumarDias(hastaVentanas, 1), zona)
  const ventasAsin = await leerVentasAsin(perfilId, [...new Set(lote.map((x) => x.f.asin).filter((a): a is string => !!a))])
  const nuevas = await segmentacionesNuevas(perfilId, lote.filter((x) => x.f.clase === 'promover').map((x) => x.f.propuesta_id))

  // 5) Medir cada fila
  let deshacerQuedan: number = AGENTE.DESHACER_MAX_POR_PASADA
  for (const { f, toca, copias: copiasNeg } of lote) {
    const p = propuestas.get(f.propuesta_id) ?? null
    const ahoraIso = new Date(ahora).toISOString()
    const v = ventanasDeEfecto(f.aplicada_dia)
    const conObjetivo = !!f.objetivo_id
    const nivelU = nivelDeUnidad(f.clase, conObjetivo)
    const nivelC = nivelDeControl(f.clase, conObjetivo)
    const obj = f.acos_objetivo_pct !== null && f.acos_objetivo_pct > 0 ? f.acos_objetivo_pct : null
    const fase: FaseDeProducto = f.fase === 'lanzamiento' ? 'lanzamiento' : 'normal'
    const campanaFilas = f.campaign_id ? campanas.get(f.campaign_id)?.filas ?? [] : []
    const nombreCampana = (f.campaign_id ? campanas.get(f.campaign_id)?.nombre : null) ?? p?.campaignNombre ?? f.campaign_id ?? 'la campaña'

    // Filas diarias de la unidad
    let unidadFilas: FilaDiaria[] = campanaFilas
    let nuevaId: string | null = null
    if (nivelU === 'segmentacion' && f.objetivo_id) unidadFilas = segmentaciones.porObjetivo.get(f.objetivo_id) ?? []
    if (nivelU === 'nueva') {
      nuevaId = nuevas.get(f.propuesta_id) ?? null
      if (!nuevaId && p?.haciaCampaignId && p.termino) {
        const t = p.termino.toLowerCase()
        nuevaId = segmentaciones.porTexto.get(`${p.haciaCampaignId}|${t}`) ?? null
      }
      unidadFilas = nuevaId ? segmentaciones.porObjetivo.get(nuevaId) ?? [] : []
    }

    // Mezclado y tocados
    const otros = otrosCambiosDeLaUnidad(cambios, { propuestaId: f.propuesta_id, clase: f.clase, objetivoId: f.objetivo_id, campaignId: f.campaign_id, termino: p?.termino ?? null })
    const mezclado = estaMezclado(f.aplicada_dia, otros)
    const tocados = unidadesTocadas(cambios, f.aplicada_dia)

    // Control: candidatos de la ventana «antes»
    const control = (desde: string, hasta: string): { antes: MetricasDeVentana | null; despues: MetricasDeVentana | null; n: number } => {
      if (!nivelC) return { antes: null, despues: null, n: 0 }
      if (nivelC === 'segmentacion' && f.objetivo_id && f.campaign_id) {
        const cands = [...segmentaciones.porObjetivo.entries()].map(([id, fs]) => ({
          id,
          campaignId: segmentaciones.campanaDe.get(id) ?? '',
          asin: asinDe.get(segmentaciones.campanaDe.get(id) ?? '') ?? null,
          tipo: segmentaciones.tipoDe.get(id) ?? null,
          clicsAntes: sumarVentana(fs, v.antes[0], v.antes[1]).clics,
        }))
        const elegidos = elegirControl(cands, { id: f.objetivo_id, campaignId: f.campaign_id, asin: f.asin, tipo: segmentaciones.tipoDe.get(f.objetivo_id) ?? null }, tocados.objetivos)
        if (elegidos.length === 0) return { antes: null, despues: null, n: 0 }
        const todas = elegidos.flatMap((c) => segmentaciones.porObjetivo.get(c.id) ?? [])
        return { antes: sumarVentana(todas, v.antes[0], v.antes[1]), despues: sumarVentana(todas, desde, hasta), n: elegidos.length }
      }
      if (!f.campaign_id) return { antes: null, despues: null, n: 0 }
      const cands = [...campanas.entries()].map(([id, c]) => ({ id, campaignId: id, asin: asinDe.get(id) ?? null, tipo: null, clicsAntes: sumarVentana(c.filas, v.antes[0], v.antes[1]).clics }))
      const elegidos = elegirControl(cands, { id: f.campaign_id, campaignId: f.campaign_id, asin: f.asin, tipo: null }, tocados.campanas)
      if (elegidos.length === 0) return { antes: null, despues: null, n: 0 }
      const todas = elegidos.flatMap((c) => campanas.get(c.id)?.filas ?? [])
      return { antes: sumarVentana(todas, v.antes[0], v.antes[1]), despues: sumarVentana(todas, desde, hasta), n: elegidos.length }
    }

    const unidadAntes = nivelU === 'nueva' ? VACIA(diasEntre(v.antes[0], v.antes[1])) : sumarVentana(unidadFilas, v.antes[0], v.antes[1])
    const campanaAntes = sumarVentana(campanaFilas, v.antes[0], v.antes[1])
    const cvr = cvrComoFraccion(f.cvr) ?? (unidadAntes.clics > 0 ? unidadAntes.pedidos / unidadAntes.clics : 0)
    const cpa = cpaObjetivoDe(obj, unidadAntes, campanaAntes)
    const eventoAntes = ventanaTocaEvento(v.antes[0], v.antes[1], pais, manuales)

    const medicion = (a: MetricasDeVentana, d: MetricasDeVentana, extra: Partial<MedicionDeEfecto>, evento: string | null): MedicionDeEfecto => ({
      antes: a,
      despues: d,
      controlAntes: null,
      controlDespues: null,
      ventasTotalesAntes: null,
      ventasTotalesDespues: null,
      acosObjetivoPct: obj ?? 0,
      cvr,
      muestraMinimaClics,
      cpaObjetivo: cpa,
      mezclado,
      evento,
      fase,
      ...extra,
    })

    const actualizar: Record<string, unknown> = {}
    if (!f.antes) actualizar.antes = { unidad: unidadAntes, campana: campanaAntes, desde: v.antes[0], hasta: v.antes[1], nuevaId }
    let cerrar: { veredicto: Veredicto; detalle: string } | null = null
    let aplazar = false

    // Propuesta borrada o deshecha por una persona: la medición ya no dice nada del cambio
    if (!p) cerrar = { veredicto: 'sin_muestra', detalle: 'la propuesta ya no existe' }
    else if (p.estado === 'deshecha' && !f.deshecho_auto) cerrar = { veredicto: 'mezclado', detalle: 'deshecha después de aplicarla (a mano o al frenar el agente): ya no mide el cambio' }

    // Intento de deshacer (compartido por la rápida y la provisional)
    const intentarDeshacer = async (motivo: string, cuando: 'rapida' | 'provisional'): Promise<'hecho' | 'aviso' | 'aplazado' | 'fallo'> => {
      const que = textoDelCambio(f.clase, p, nombreCampana)
      if (f.clase === 'negativizar') {
        salida.soloAviso.push({ propuestaId: f.propuesta_id, texto: `${que}: ${motivo}. Una negativa no la deshago sola: revísala.` })
        return 'aviso'
      }
      if (!p || p.estado !== 'aplicada') return 'aviso'
      if (!deps.puedeDeshacer) {
        salida.soloAviso.push({ propuestaId: f.propuesta_id, texto: `${que}: ${motivo}. No la deshago: el agente no está activo.` })
        return 'aviso'
      }
      const entidad = conObjetivo ? f.objetivo_id! : f.campaign_id ?? ''
      const desde = p.resueltaAt ?? f.creado_at
      let aMano = 0
      try {
        aMano = entidad ? await cambiosAManoDesde(perfilId, entidad, desde) : 0
      } catch {
        aMano = 1 // sin poder comprobarlo, no se deshace
      }
      if (aMano > 0) {
        salida.soloAviso.push({ propuestaId: f.propuesta_id, texto: `${que}: ${motivo}. No la deshago: una persona la cambió a mano después.` })
        return 'aviso'
      }
      if (deshacerQuedan <= 0) {
        salida.quedan = true
        return 'aplazado'
      }
      let valorMaximo: number | undefined
      if (f.clase === 'presupuesto_subir' && p.valorActual !== null && f.campaign_id) {
        // Deshacer una SUBIDA: nunca por encima del presupuesto de hoy
        let permitido: number | null = null
        try {
          permitido = await deps.permitidoHoyPresupuesto(f.campaign_id, p.valorActual)
        } catch {
          permitido = null
        }
        valorMaximo = valorDeDeshacerPresupuesto(p.valorActual, permitido)
      } else if (f.clase === 'presupuesto_bajar' && p.valorActual !== null && p.valorNuevo !== null && f.campaign_id) {
        // Deshacer una BAJADA es volver a subir: al valor anterior, acotado por el guardarraíl de la suma; si no cabe, solo aviso (no se marca como deshecha)
        let g: { valor: number } | { no: string }
        try {
          g = await deps.permitidoVolverBajada(f.campaign_id, p.valorNuevo, p.valorActual)
        } catch (e) {
          g = { no: e instanceof Error ? e.message : String(e) }
        }
        if ('no' in g || !(g.valor > p.valorNuevo + 0.004)) {
          salida.soloAviso.push({ propuestaId: f.propuesta_id, texto: `${que}: ${motivo}. No la deshago: volver a subir el presupuesto no cabe hoy en la suma de la cuenta (${('no' in g ? g.no : 'no queda hueco').slice(0, 200)}).` })
          return 'aviso'
        }
        valorMaximo = Math.max(1, Math.round(g.valor * 100) / 100)
      }
      deshacerQuedan--
      const textoMotivo = `Deshecho solo por el agente (medición ${cuando === 'rapida' ? 'rápida de 3 días' : 'de 7 días'}): ${motivo}`
      const r = await deps.deshacer(f.propuesta_id, textoMotivo, valorMaximo).catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }))
      if (!r.ok && r.error === ERROR_INTERRUPTOR_GENERAL) {
        // No se ha intentado (interruptor general): no es un fallo; se aplaza y no se deshace nada más en esta pasada
        deshacerQuedan = 0
        salida.quedan = true
        return 'aplazado'
      }
      if (r.ok) {
        salida.deshechos.push({ propuestaId: f.propuesta_id, texto: `${que}: ${motivo}.${valorMaximo !== undefined ? ` Presupuesto de vuelta a ${es(valorMaximo)}.` : ''}` })
        return 'hecho'
      }
      // Si falla (p. ej. el valor cambió en Amazon) se apunta y no se reintenta
      salida.soloAviso.push({ propuestaId: f.propuesta_id, texto: `${que}: ${motivo}. Intenté deshacerla y falló: «${(r.error ?? 'sin detalle').slice(0, 200)}».` })
      return 'fallo'
    }

    // ─ rápida (raras aplicadas por la IA) ─
    if (!cerrar && toca.rapida) {
      const nivel = nivelDeDeshacer(f.clase, conObjetivo)
      const fs = nivel === 'segmentacion' ? unidadFilas : campanaFilas
      const a = sumarVentana(fs, v.antes[0], v.antes[1])
      const d = sumarVentana(fs, v.rapida[0], v.rapida[1])
      const c = control(v.rapida[0], v.rapida[1])
      const evento = eventoAntes ?? ventanaTocaEvento(v.rapida[0], v.rapida[1], pais, manuales)
      const m = medicion(a, d, { controlAntes: c.antes, controlDespues: c.despues }, evento)
      const dec = debeDeshacerRara(m)
      let resultado: string | null = null
      if (dec.deshacer && dec.motivo) {
        const r = await intentarDeshacer(dec.motivo, 'rapida')
        if (r === 'aplazado') aplazar = true
        else resultado = r
        if (r === 'hecho') cerrar = { veredicto: 'empeoro', detalle: `deshecho solo en la medición rápida: ${dec.motivo}` }
      }
      if (!aplazar) {
        actualizar.rapida = { nivel, metricas: d, antes: a, control: c.antes ? { antes: c.antes, despues: c.despues, unidades: c.n } : null, desde: v.rapida[0], hasta: v.rapida[1], deshacer: dec.deshacer, motivo: dec.motivo, resultado }
        actualizar.rapida_at = ahoraIso
        salida.rapidas++
      }
    }

    // ─ provisional (libera la cuarentena; deshace subidas que salen mal) ─
    if (!cerrar && !aplazar && toca.provisional) {
      const nivel = nivelDeDeshacer(f.clase, conObjetivo)
      const fs = nivel === 'segmentacion' ? unidadFilas : campanaFilas
      const a = sumarVentana(fs, v.antes[0], v.antes[1])
      const d = sumarVentana(fs, v.provisional[0], v.provisional[1])
      const c = control(v.provisional[0], v.provisional[1])
      const evento = eventoAntes ?? ventanaTocaEvento(v.provisional[0], v.provisional[1], pais, manuales)
      const m = medicion(a, d, { controlAntes: c.antes, controlDespues: c.despues }, evento)
      const dec = obj === null ? { deshacer: false, motivo: null } : debeDeshacer(f.clase, m)
      let resultado: string | null = null
      if (dec.deshacer && dec.motivo) {
        const r = await intentarDeshacer(dec.motivo, 'provisional')
        if (r === 'aplazado') aplazar = true
        else resultado = r
        if (r === 'hecho') cerrar = { veredicto: 'empeoro', detalle: `deshecho solo en la medición de 7 días: ${dec.motivo}` }
      }
      if (!aplazar) {
        const vt = elegirInstantanea(ventasAsin.get(f.asin ?? '') ?? [], f.aplicada_dia, 'despues', [7, 14, 30])
        actualizar.provisional = { nivel, metricas: d, antes: a, control: c.antes ? { antes: c.antes, despues: c.despues, unidades: c.n } : null, desde: v.provisional[0], hasta: v.provisional[1], deshacer: dec.deshacer, motivo: dec.motivo, resultado, evento }
        actualizar.ventas_totales = { ...(f.ventas_totales ?? {}), provisional: vt }
        actualizar.revisado_7d_at = ahoraIso
        salida.provisionales++
      }
    }

    // ─ final (veredicto) ─
    if (!aplazar && (cerrar || toca.final)) {
      if (!cerrar) {
        const unidadDespues = sumarVentana(unidadFilas, v.despues[0], v.despues[1])
        const campanaDespues = sumarVentana(campanaFilas, v.despues[0], v.despues[1])
        const c = control(v.despues[0], v.despues[1])
        const evento = eventoAntes ?? ventanaTocaEvento(v.despues[0], v.despues[1], pais, manuales)
        const vtAntes = f.ventas_totales?.antes ?? null
        const vtDespues = elegirInstantanea(ventasAsin.get(f.asin ?? '') ?? [], f.aplicada_dia, 'despues', [14, 7, 30])

        // En las negativas la «unidad» es el término (copias semanales que no se solapan); la tabla y el negocio miran su campaña
        let a = unidadAntes
        let d = unidadDespues
        let terminoInfo: { antes: MetricasDeVentana | null; despues: MetricasDeVentana | null; semanaAntes: string | null; semanaDespues: string | null } | null = null
        if (f.clase === 'negativizar') {
          const ta = metricasDeCopia(copiasNeg?.antes ?? null)
          const td = metricasDeCopia(copiasNeg?.despues ?? null)
          terminoInfo = { antes: ta, despues: td, semanaAntes: copiasNeg?.antes?.semana ?? null, semanaDespues: copiasNeg?.despues?.semana ?? null }
          if (ta && td) {
            a = ta
            d = td
          }
        }

        const m = medicion(
          a,
          d,
          {
            campanaAntes,
            campanaDespues,
            controlAntes: c.antes,
            controlDespues: c.despues,
            ventasTotalesAntes: vtAntes ? { ventas: vtAntes.ventas, dias: diasEntre(vtAntes.desde, vtAntes.hasta) } : null,
            ventasTotalesDespues: vtDespues ? { ventas: vtDespues.ventas, dias: diasEntre(vtDespues.desde, vtDespues.hasta) } : null,
          },
          evento,
        )
        const necesitaObjetivo = f.clase === 'puja_subir' || f.clase === 'presupuesto_subir' || f.clase === 'promover'
        cerrar = necesitaObjetivo && obj === null && !evento && !mezclado ? { veredicto: 'sin_muestra', detalle: 'sin ACoS objetivo del producto: no se puede juzgar' } : veredicto(f.clase, m)
        actualizar.despues = { unidad: unidadDespues, campana: campanaDespues, desde: v.despues[0], hasta: v.despues[1], nuevaId, termino: terminoInfo }
        actualizar.control_antes = c.antes ? { ...c.antes, unidades: c.n } : null
        actualizar.control_despues = c.despues ? { ...c.despues, unidades: c.n } : null
        actualizar.ventas_totales = { ...(f.ventas_totales ?? {}), ...(actualizar.ventas_totales as object | undefined), despues: vtDespues }
      }
      actualizar.veredicto = cerrar.veredicto
      actualizar.detalle = cerrar.detalle.slice(0, 1000)
      actualizar.medido_at = new Date(ahora).toISOString()
      if (cerrar.detalle.startsWith('deshecho solo')) {
        actualizar.deshecho_auto = true
        if (!f.revisado_7d_at && !actualizar.revisado_7d_at) actualizar.revisado_7d_at = ahoraIso
      }
      salida.medidos++
    }

    if (Object.keys(actualizar).length > 0) {
      const { error } = await db.from('ads_efectos').update(actualizar).eq('perfil_id', perfilId).eq('propuesta_id', f.propuesta_id)
      if (error) {
        if (falta315(error)) throw new Error(FALTA_MIGRACION_315)
        throw error
      }
    }
  }

  return salida
}

/** Una frase corta del cambio para los avisos: «Subida de puja de «jamon» (B0… | AMPLIA)» */
function textoDelCambio(clase: ClaseDeCambio, p: PropuestaDelEfecto | null, campana: string): string {
  const termino = p?.termino ? `«${p.termino.slice(0, 60)}»` : ''
  const valores = p && p.valorActual !== null && p.valorNuevo !== null ? ` (${es(p.valorActual)} → ${es(p.valorNuevo)})` : ''
  const que: Record<ClaseDeCambio, string> = {
    puja_subir: `Subida de puja de ${termino}${valores}`,
    puja_bajar: `Bajada de puja de ${termino}${valores}`,
    puja_bajar_sin_pedidos: `Bajada de puja de ${termino}${valores}`,
    pausar: `Pausa de ${termino}`,
    negativizar: `Negativa ${termino}`,
    promover: `Promoción de ${termino}`,
    presupuesto_subir: `Subida de presupuesto${valores}`,
    presupuesto_bajar: `Bajada de presupuesto${valores}`,
    pausar_campana: 'Pausa de la campaña',
  }
  return `${que[clase]} en ${campana.slice(0, 80)}`
}

function deFilaDeEfecto(r: Record<string, unknown>): FilaDeEfecto {
  return {
    propuesta_id: String(r.propuesta_id),
    clase: r.clase as ClaseDeCambio,
    asin: (r.asin as string | null) ?? null,
    campaign_id: (r.campaign_id as string | null) ?? null,
    objetivo_id: (r.objetivo_id as string | null) ?? null,
    aplicada_dia: String(r.aplicada_dia).slice(0, 10),
    acos_objetivo_pct: numONulo(r.acos_objetivo_pct),
    cvr: numONulo(r.cvr),
    fase: (r.fase as string | null) ?? null,
    rara_aplicada: r.rara_aplicada === true,
    antes: (r.antes as Record<string, unknown> | null) ?? null,
    rapida: (r.rapida as Record<string, unknown> | null) ?? null,
    provisional: (r.provisional as Record<string, unknown> | null) ?? null,
    ventas_totales: (r.ventas_totales as FilaDeEfecto['ventas_totales']) ?? null,
    rapida_at: (r.rapida_at as string | null) ?? null,
    revisado_7d_at: (r.revisado_7d_at as string | null) ?? null,
    medido_at: (r.medido_at as string | null) ?? null,
    deshecho_auto: r.deshecho_auto === true,
    creado_at: String(r.creado_at ?? ''),
  }
}

// ─── lecturas del lote ─────────────────────────────────────────────────────

async function leerPropuestas(perfilId: string, ids: readonly string[]): Promise<Map<string, PropuestaDelEfecto>> {
  const salida = new Map<string, PropuestaDelEfecto>()
  for (let i = 0; i < ids.length; i += 100) {
    const trozo = ids.slice(i, i + 100)
    let r = await createServiceClient()
      .from('ads_propuestas')
      .select('id, tipo, estado, termino, campaign_id, campaign_nombre, objetivo_id, hacia_campaign_id, valor_actual, valor_nuevo, resuelta_at')
      .eq('perfil_id', perfilId)
      .in('id', trozo)
    if (r.error && isMissingSchema(r.error)) {
      // Sin la 298 no hay columnas de puja y presupuesto
      r = (await createServiceClient().from('ads_propuestas').select('id, tipo, estado, termino, campaign_id, campaign_nombre, hacia_campaign_id, resuelta_at').eq('perfil_id', perfilId).in('id', trozo)) as unknown as typeof r
    }
    if (r.error) throw r.error
    for (const f of (r.data ?? []) as Array<Record<string, unknown>>) {
      salida.set(String(f.id), {
        id: String(f.id),
        tipo: String(f.tipo ?? ''),
        estado: String(f.estado ?? ''),
        termino: String(f.termino ?? ''),
        campaignId: (f.campaign_id as string | null) ?? null,
        campaignNombre: (f.campaign_nombre as string | null) ?? null,
        objetivoId: (f.objetivo_id as string | null) ?? null,
        haciaCampaignId: (f.hacia_campaign_id as string | null) ?? null,
        valorActual: numONulo(f.valor_actual),
        valorNuevo: numONulo(f.valor_nuevo),
        resueltaAt: (f.resuelta_at as string | null) ?? null,
      })
    }
  }
  return salida
}

/** Copias semanales del término de cada negativa (por campaña y término en minúsculas, como las guarda `guardarTerminosDeLaSemana`) */
async function leerCopiasDeNegativas(perfilId: string, filas: readonly FilaDeEfecto[], propuestas: Map<string, PropuestaDelEfecto>): Promise<Map<string, CopiaSemanal[]>> {
  const salida = new Map<string, CopiaSemanal[]>()
  for (const f of filas) {
    const p = propuestas.get(f.propuesta_id)
    if (!p || !f.campaign_id || !p.termino) continue
    const { data, error } = await createServiceClient()
      .from('ads_terminos_semana')
      .select('semana, desde, hasta, clics, gasto, ventas, pedidos')
      .eq('perfil_id', perfilId)
      .eq('campaign_id', f.campaign_id)
      .eq('termino', p.termino.toLowerCase())
      .order('semana')
      .limit(60)
    if (error) {
      if (falta315(error)) return salida
      throw error
    }
    salida.set(
      f.propuesta_id,
      ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
        semana: String(r.semana).slice(0, 10),
        desde: r.desde ? String(r.desde).slice(0, 10) : null,
        hasta: r.hasta ? String(r.hasta).slice(0, 10) : null,
        clics: num(r.clics),
        gasto: num(r.gasto),
        ventas: num(r.ventas),
        pedidos: num(r.pedidos),
      })),
    )
  }
  return salida
}

/** Rendimiento diario de todas las campañas de la cuenta en el rango (para la unidad, la campaña y el control de campañas) */
async function leerCampanas(perfilId: string, desde: string, hasta: string): Promise<Map<string, { nombre: string | null; filas: FilaDiaria[] }>> {
  const salida = new Map<string, { nombre: string | null; filas: FilaDiaria[] }>()
  if (hasta < desde) return salida
  const { data, error } = await todasLasFilas<Record<string, unknown>>(
    (a, b) =>
      createServiceClient()
        .from('ads_rendimiento_diario')
        .select('fecha, campaign_id, nombre, clics, gasto, ventas, pedidos')
        .eq('perfil_id', perfilId)
        .gte('fecha', desde)
        .lte('fecha', hasta)
        .order('fecha')
        .order('campaign_id')
        .range(a, b),
    60_000,
  )
  if (error) {
    if (isMissingSchema(error)) return salida
    throw error
  }
  for (const r of data) {
    const id = String(r.campaign_id)
    const c = salida.get(id) ?? { nombre: null, filas: [] }
    c.nombre = (r.nombre as string | null) ?? c.nombre
    c.filas.push({ fecha: String(r.fecha).slice(0, 10), clics: num(r.clics), gasto: num(r.gasto), ventas: num(r.ventas), pedidos: num(r.pedidos) })
    salida.set(id, c)
  }
  return salida
}

/** Rendimiento diario de las segmentaciones de esas campañas en el rango */
async function leerSegmentaciones(
  perfilId: string,
  campaignIds: readonly string[],
  desde: string,
  hasta: string,
): Promise<{ porObjetivo: Map<string, FilaDiaria[]>; campanaDe: Map<string, string>; tipoDe: Map<string, string | null>; porTexto: Map<string, string> }> {
  const porObjetivo = new Map<string, FilaDiaria[]>()
  const campanaDe = new Map<string, string>()
  const tipoDe = new Map<string, string | null>()
  const porTexto = new Map<string, string>()
  if (campaignIds.length === 0 || hasta < desde) return { porObjetivo, campanaDe, tipoDe, porTexto }
  for (let i = 0; i < campaignIds.length; i += 100) {
    const trozo = campaignIds.slice(i, i + 100)
    const { data, error } = await todasLasFilas<Record<string, unknown>>(
      (a, b) =>
        createServiceClient()
          .from('ads_objetivos_diario')
          .select('fecha, objetivo_id, campaign_id, texto, tipo, clics, gasto, ventas, pedidos')
          .eq('perfil_id', perfilId)
          .in('campaign_id', trozo)
          .gte('fecha', desde)
          .lte('fecha', hasta)
          .or('clics.gt.0,ventas.gt.0,gasto.gt.0')
          .order('fecha')
          .order('objetivo_id')
          .range(a, b),
      60_000,
    )
    if (error) {
      if (isMissingSchema(error)) break
      throw error
    }
    for (const r of data) {
      const id = String(r.objetivo_id)
      const lista = porObjetivo.get(id) ?? []
      lista.push({ fecha: String(r.fecha).slice(0, 10), clics: num(r.clics), gasto: num(r.gasto), ventas: num(r.ventas), pedidos: num(r.pedidos) })
      porObjetivo.set(id, lista)
      campanaDe.set(id, String(r.campaign_id))
      tipoDe.set(id, (r.tipo as string | null) ?? null)
      const texto = String(r.texto ?? '').toLowerCase()
      if (texto) porTexto.set(`${r.campaign_id}|${texto}`, id)
    }
  }
  return { porObjetivo, campanaDe, tipoDe, porTexto }
}

/** Instantáneas de ventas totales de esos ASIN */
async function leerVentasAsin(perfilId: string, asins: readonly string[]): Promise<Map<string, InstantaneaDeVentas[]>> {
  const salida = new Map<string, InstantaneaDeVentas[]>()
  if (asins.length === 0) return salida
  const { data, error } = await createServiceClient().from('ads_ventas_asin').select('asin, dias, desde, hasta, ventas').eq('perfil_id', perfilId).in('asin', [...asins])
  if (error) {
    if (isMissingSchema(error)) return salida
    throw error
  }
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    const asin = String(r.asin)
    const lista = salida.get(asin) ?? []
    lista.push(deInstantanea(r))
    salida.set(asin, lista)
  }
  return salida
}

/** El id de la segmentación que creó cada promoción (del log: `accion = 'promover'`, entidad keyword/target) */
async function segmentacionesNuevas(perfilId: string, propuestaIds: readonly string[]): Promise<Map<string, string>> {
  const salida = new Map<string, string>()
  if (propuestaIds.length === 0) return salida
  const { data, error } = await createServiceClient()
    .from('ads_cambios_log')
    .select('propuesta_id, entidad_id, entidad')
    .eq('perfil_id', perfilId)
    .eq('accion', 'promover')
    .eq('ok', true)
    .in('propuesta_id', [...propuestaIds])
  if (error) {
    if (isMissingSchema(error)) return salida
    throw error
  }
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    if ((r.entidad === 'keyword' || r.entidad === 'target') && r.entidad_id && r.propuesta_id) salida.set(String(r.propuesta_id), String(r.entidad_id))
  }
  return salida
}

const ENTIDADES_DE_CAMBIO = ['campaña', 'grupo', 'anuncio', 'keyword', 'target', 'negativa']
const ACCIONES_DE_CAMBIO = ['crear', 'cambiar', 'pausar', 'activar', 'archivar', 'negativizar', 'promover', 'deshacer']

/**
 * Todos los cambios APLICADOS de la cuenta en el rango (fechas LOCALES), de dos fuentes: propuestas aplicadas o deshechas (del agente, del motor
 * o de una persona) y el log (cambios a mano, estructura, etc.). Lo ensayado no cuenta (no tocó Amazon).
 */
async function leerCambios(perfilId: string, desde: string, hasta: string, zona: string): Promise<CambioEnCuenta[]> {
  const salida: CambioEnCuenta[] = []
  const desdeIso = `${sumarDias(desde, -1)}T00:00:00Z`
  const hastaIso = `${sumarDias(hasta, 1)}T23:59:59Z`
  const fechaLocal = (iso: unknown): string | null => {
    const t = Date.parse(String(iso ?? ''))
    return Number.isFinite(t) ? horaLocal(t, zona).fecha : null
  }

  let props = await todasLasFilas<Record<string, unknown>>(
    (a, b) =>
      createServiceClient()
        .from('ads_propuestas')
        .select('id, tipo, termino, campaign_id, objetivo_id, resuelta_at')
        .eq('perfil_id', perfilId)
        .in('estado', ['aplicada', 'deshecha'])
        .gte('resuelta_at', desdeIso)
        .lte('resuelta_at', hastaIso)
        .order('resuelta_at')
        .order('id')
        .range(a, b),
    20_000,
  )
  if (props.error && isMissingSchema(props.error)) {
    props = await todasLasFilas<Record<string, unknown>>(
      (a, b) =>
        createServiceClient()
          .from('ads_propuestas')
          .select('id, tipo, termino, campaign_id, resuelta_at')
          .eq('perfil_id', perfilId)
          .in('estado', ['aplicada', 'deshecha'])
          .gte('resuelta_at', desdeIso)
          .lte('resuelta_at', hastaIso)
          .order('resuelta_at')
          .order('id')
          .range(a, b),
      20_000,
    )
  }
  if (props.error && !isMissingSchema(props.error)) throw props.error
  for (const r of props.data) {
    const fecha = fechaLocal(r.resuelta_at)
    if (!fecha) continue
    const tipo = String(r.tipo ?? '')
    salida.push({
      fecha,
      objetivoId: tipo === 'puja' || tipo === 'pausar' ? ((r.objetivo_id as string | null) ?? null) : null,
      campaignId: (r.campaign_id as string | null) ?? null,
      deCampana: tipo === 'presupuesto' || tipo === 'pausar-campana',
      termino: tipo === 'negativizar' || tipo === 'promover' ? String(r.termino ?? '').toLowerCase() || null : null,
      propuestaId: String(r.id),
    })
  }

  let log = await todasLasFilas<Record<string, unknown>>(
    (a, b) =>
      createServiceClient()
        .from('ads_cambios_log')
        .select('id, entidad, accion, campaign_id, valor_nuevo, creado_at, entidad_id, propuesta_id')
        .eq('perfil_id', perfilId)
        .eq('ok', true)
        .neq('origen', 'ensayo')
        .in('entidad', ENTIDADES_DE_CAMBIO)
        .in('accion', ACCIONES_DE_CAMBIO)
        .gte('creado_at', desdeIso)
        .lte('creado_at', hastaIso)
        .order('creado_at')
        .order('id')
        .range(a, b),
    20_000,
  )
  if (log.error && isMissingSchema(log.error)) {
    // Sin la 311: sin entidad_id ni propuesta_id (solo se reconocen los cambios de campaña)
    log = await todasLasFilas<Record<string, unknown>>(
      (a, b) =>
        createServiceClient()
          .from('ads_cambios_log')
          .select('id, entidad, accion, campaign_id, valor_nuevo, creado_at')
          .eq('perfil_id', perfilId)
          .eq('ok', true)
          .in('entidad', ENTIDADES_DE_CAMBIO)
          .in('accion', ACCIONES_DE_CAMBIO)
          .gte('creado_at', desdeIso)
          .lte('creado_at', hastaIso)
          .order('creado_at')
          .order('id')
          .range(a, b),
      20_000,
    )
  }
  if (log.error && !isMissingSchema(log.error)) throw log.error
  for (const r of log.data) {
    const fecha = fechaLocal(r.creado_at)
    if (!fecha) continue
    const entidad = String(r.entidad ?? '')
    const accion = String(r.accion ?? '')
    const esNegativa = entidad === 'negativa' || accion === 'negativizar' || accion === 'promover'
    salida.push({
      fecha,
      objetivoId: entidad === 'keyword' || entidad === 'target' || entidad === 'anuncio' ? ((r.entidad_id as string | null) ?? null) : null,
      campaignId: (r.campaign_id as string | null) ?? null,
      deCampana: entidad === 'campaña',
      termino: esNegativa && typeof r.valor_nuevo === 'string' ? r.valor_nuevo.split(' → ')[0].toLowerCase() : null,
      propuestaId: (r.propuesta_id as string | null) ?? null,
    })
  }
  return salida
}
