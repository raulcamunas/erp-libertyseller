/**
 * AMAZON ADS · EL AGENTE PPC: EL CONTEXTO DE UNA CUENTA (SOLO SERVIDOR; solo lee la base de datos salvo `datosParaEncender`, que mira la suma de presupuestos en Amazon).
 *
 * Reúne lo que el cerebro, el resumen y el panel necesitan saber de una cuenta: el día LOCAL del marketplace, las ventas TOTALES y el TACoS (la cifra principal), el ACoS de 7 días CERRADOS, la
 * cobertura de stock, la fase y la marca de cada producto, el objetivo BASE (humano o automático congelado), el techo del mes y el evento de temporada.
 *
 * También tiene las lecturas que comparten los demás ficheros del paquete «agente-datos» (vigilar, objetivos, ajustes): el perfil, la fila propia de `ads_agente`, los productos con su objetivo y el
 * rendimiento diario. Ninguna importa de otro paquete de la oleada 2 (regla de §1 de la spec): lo que haría falta de `agente-estado` se lee aquí directamente.
 *
 * Sin la migración 315 todo lanza `Error(FALTA_MIGRACION_315)`.
 *
 * LÍMITE CONOCIDO DE LOS DATOS: las ventas TOTALES (`ads_ventas_asin`) solo se guardan como ventanas móviles de 7, 14 y 30 días que acaban AYER, no día a día. Por eso:
 *   · «ventas totales del mes» y «del mes anterior a la misma fecha» no se pueden calcular sin inventar: van a null (el resumen dice «sin datos todavía») y el dato fiable es `ventasTotales30`/`tacos30Pct`;
 *   · la tendencia de las ventas totales es SEMANAL (últimos 7 días frente a los 7 anteriores, de la ventana de 14), no 30 frente a 30.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { campanasDe } from '../campanas'
import { leerFicha, marketplaceDePais, productosDeCuenta, type FichaDeCuenta } from '../cuenta'
import { margenDeProducto, precioParaMotor } from '../margen'
import { todasLasFilas } from '../paginar'
import { nombreDePais } from '../paises'
import { asinDeCampana } from '../productos-agrupar'
import { partesDeNombre } from '../reglas'
import type { CuentaParaSincronizar } from '../sincronizar'
import { ventasTotales, type VentaDeAsin } from '../ventas-totales'
import { topesValidos } from './guardarrailes-calculo'
import { acosObjetivoMedio, esCampanaDeMarca, faseDeProducto, objetivoBase, techoAutomatico, techoDelMes } from './objetivos-calculo'
import { coberturaDias, stockDeAsin, stockEfectivo, stockEsViejo } from './stock-calculo'
import { eventoEn, eventosManualesValidos, hayEventoEnElMes, ventanaTocaEvento } from './temporada-calculo'
import {
  AGENTE,
  FALTA_MIGRACION_315,
  type ConfigDelAgente,
  type ContextoDelAgente,
  type DiaDeUso,
  type EstadoDelMes,
  type EstadoDelAgente,
  type FaseDeEvento,
  type FaseDeProducto,
  type FuenteDeObjetivo,
  type FuenteDePostura,
  type MotivoDeFreno,
  type Postura,
  type Presion,
  type ProductoDelContexto,
  type RitmoDelMes,
} from './tipos'
import { horaLocal, zonaDePais } from './uso-calculo'

const DIA_MS = 86_400_000

/* =============================================================================================================================================================
 * Auxiliares compartidos del paquete
 * ============================================================================================================================================================= */

/** ¿El error dice que falta la 315 (tabla o columna que no existe, o un CHECK que aún no admite un valor nuevo)? */
export function esFaltaDe315(error: unknown): boolean {
  return isMissingSchema(error) || (error as { code?: string } | null)?.code === '23514'
}

/** Lanza el error que toca: el de la 315 si es por la migración, el original si no */
export function lanzar(error: unknown): never {
  if (esFaltaDe315(error)) throw new Error(FALTA_MIGRACION_315)
  if (error instanceof Error) throw error
  const e = error as { message?: string; code?: string } | null
  throw new Error(e?.message ? `${e.message}${e.code ? ` (${e.code})` : ''}` : String(error))
}

/** 'YYYY-MM-DD' + n días (aritmética UTC sobre una fecha ya local) */
export const desplazar = (dia: string, dias: number): string => new Date(Date.parse(`${dia}T00:00:00Z`) + dias * DIA_MS).toISOString().slice(0, 10)

/** Días enteros entre dos fechas 'YYYY-MM-DD' (b − a) */
export const diasEntre = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DIA_MS)

export const redondear2 = (n: number): number => Math.round(n * 100) / 100
export const redondear1 = (n: number): number => Math.round(n * 10) / 10

/** Un número de la base (NUMERIC llega como texto) o null */
export const numero = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** ACoS en % (null sin ventas) */
export const acosDe = (gasto: number, ventas: number): number | null => (ventas > 0 ? redondear2((gasto / ventas) * 100) : null)

/* =============================================================================================================================================================
 * El perfil y la fila propia del agente
 * ============================================================================================================================================================= */

export interface PerfilDelAgente {
  /** «<cliente> · <país>» */
  nombre: string
  pais: string
  moneda: string | null
  zona: string
}

/** El nombre con el que se habla de la cuenta en los avisos («Ham Master · España»), su país, su moneda y su zona horaria (la del perfil o, si falta, la del país) */
export async function nombreDeCuenta(perfilId: string): Promise<{ nombre: string; pais: string; moneda: string | null; zona: string }> {
  const service = createServiceClient()
  const { data, error } = await service.from('ads_profiles').select('pais, moneda, zona_horaria, nombre, profile_id, clientes(nombre)').eq('id', perfilId).maybeSingle()
  if (error) throw error
  const f = (data ?? {}) as Record<string, unknown>
  const cli = Array.isArray(f.clientes) ? (f.clientes[0] as { nombre?: string } | undefined) : (f.clientes as { nombre?: string } | null)
  const pais = String(f.pais ?? '').toUpperCase()
  const cliente = cli?.nombre || (f.nombre as string | null) || String(f.profile_id ?? perfilId)
  return { nombre: `${cliente} · ${nombreDePais(pais || null)}`, pais, moneda: (f.moneda as string | null) ?? null, zona: zonaDePais(pais, f.zona_horaria as string | null) }
}

/** La cuenta (para llamar a Amazon) a partir del id del perfil */
export async function cuentaDePerfil(perfilId: string): Promise<CuentaParaSincronizar> {
  const { data, error } = await createServiceClient().from('ads_profiles').select('id, profile_id, connection_id').eq('id', perfilId).maybeSingle()
  if (error) throw error
  if (!data) throw new Error('No encuentro esa cuenta de anunciante.')
  const f = data as { id: string; profile_id: number; connection_id: string }
  return { id: f.id, profileId: Number(f.profile_id), conexionId: f.connection_id }
}

const ESTADOS: readonly EstadoDelAgente[] = ['apagado', 'ensayo', 'activo', 'frenado']
const MOTIVOS: readonly MotivoDeFreno[] = ['gasto_disparado', 'acos_cuenta', 'errores_amazon', 'datos_viejos', 'ventas_caidas', 'manual']
const RITMOS: readonly RitmoDelMes[] = ['recorte', 'normal', 'crecer']

/**
 * La fila de `ads_agente` como ConfigDelAgente (null sin fila). Es una copia de la lectura de `agente-estado` (leerConfigDelAgente): la regla de dependencias de la oleada 2 no deja importarla.
 * Sin la tabla lanza FALTA_MIGRACION_315.
 */
export async function leerConfigPropia(perfilId: string): Promise<ConfigDelAgente | null> {
  const { data, error } = await createServiceClient().from('ads_agente').select('*').eq('perfil_id', perfilId).maybeSingle()
  if (error) lanzar(error)
  if (!data) return null
  return configDeFila(data as Record<string, unknown>)
}

/** Los presupuestos del día en que entró en recorte (jsonb {campaignId: número}), solo con números > 0 */
function presupuestosDeRecorte(crudo: unknown): Record<string, number> {
  const r: Record<string, number> = {}
  if (!crudo || typeof crudo !== 'object' || Array.isArray(crudo)) return r
  for (const [k, v] of Object.entries(crudo as Record<string, unknown>)) {
    const n = numero(v)
    if (n !== null && n > 0) r[k] = n
  }
  return r
}

export function configDeFila(f: Record<string, unknown>): ConfigDelAgente {
  const texto = (v: unknown) => (typeof v === 'string' && v ? v : null)
  const presionCruda = (f.presion && typeof f.presion === 'object' ? f.presion : {}) as Record<string, unknown>
  const presion: Record<string, Presion> = {}
  for (const [k, v] of Object.entries(presionCruda)) if (v === 'subir' || v === 'bajar') presion[k] = v
  const motivoIgnorar = texto(f.ignorar_freno_motivo) as MotivoDeFreno | null
  const hastaIgnorar = texto(f.ignorar_freno_hasta)
  return {
    perfilId: String(f.perfil_id),
    estado: ESTADOS.includes(f.estado as EstadoDelAgente) ? (f.estado as EstadoDelAgente) : 'apagado',
    encendidoAt: texto(f.encendido_at),
    encendidoPor: texto(f.encendido_por),
    ensayoHasta: texto(f.ensayo_hasta),
    activoDesde: texto(f.activo_desde),
    rampaDesde: texto(f.rampa_desde),
    frenadoAt: texto(f.frenado_at),
    frenoMotivo: MOTIVOS.includes(f.freno_motivo as MotivoDeFreno) ? (f.freno_motivo as MotivoDeFreno) : null,
    frenoDetalle: texto(f.freno_detalle),
    ignorarFreno: motivoIgnorar && MOTIVOS.includes(motivoIgnorar) && hastaIgnorar ? { motivo: motivoIgnorar, hasta: hastaIgnorar } : null,
    acos7Inicio: numero(f.acos7_inicio),
    topes: topesValidos(f.topes),
    topeIaUsdMes: numero(f.tope_ia_usd_mes) ?? AGENTE.IA_TOPE_USD_MES,
    pujaMax: numero(f.puja_max),
    picoEventos: f.pico_eventos === true,
    eventosManuales: eventosManualesValidos(f.eventos_manuales),
    presion,
    presionFecha: texto(f.presion_fecha),
    ritmo: RITMOS.includes(f.ritmo as RitmoDelMes) ? (f.ritmo as RitmoDelMes) : 'normal',
    ritmoFecha: texto(f.ritmo_fecha),
    ritmoCambiadoAt: texto(f.ritmo_cambiado_at),
    ritmoMesAnterior: RITMOS.includes(f.ritmo_mes_anterior as RitmoDelMes) ? (f.ritmo_mes_anterior as RitmoDelMes) : null,
    recorteDesde: texto(f.recorte_desde),
    recortePresupuestos: presupuestosDeRecorte(f.recorte_presupuestos),
    techoMensual: numero(f.techo_mensual),
    techoAutomatico: f.techo_automatico === true,
    techoCongeladoAt: texto(f.techo_congelado_at),
    sumaPresupuestosInicio: numero(f.suma_presupuestos_inicio),
    usoError: texto(f.uso_error),
    usoErrorAt: texto(f.uso_error_at),
    primeraEscrituraAt: texto(f.primera_escritura_at),
    rarasSinIa: numero(f.raras_sin_ia) ?? 0,
    pensarYa: f.pensar_ya === true,
    marcas: {
      vigilarAt: texto(f.vigilar_at),
      aplicarAt: texto(f.aplicar_at),
      cerebroAt: texto(f.cerebro_at),
      cerebroTardeDia: texto(f.cerebro_tarde_dia),
      resumenDia: texto(f.resumen_dia),
      efectosDia: texto(f.efectos_dia),
      efectosResto: f.efectos_resto === true,
      objetivosDia: texto(f.objetivos_dia),
      terminosSemana: texto(f.terminos_semana),
      limpiezaDia: texto(f.limpieza_dia),
      calibradoAt: texto(f.calibrado_at),
    },
    vigilarOkAt: texto(f.vigilar_ok_at),
    vigilarFallos: Math.max(0, Math.round(numero(f.vigilar_fallos) ?? 0)),
  }
}

/** Escribe columnas de `ads_agente` (solo si la fila existe). Sin la 315, lanza */
export async function actualizarFilaPropia(perfilId: string, campos: Record<string, unknown>): Promise<void> {
  const { error } = await createServiceClient()
    .from('ads_agente')
    .update({ ...campos, updated_at: new Date().toISOString() })
    .eq('perfil_id', perfilId)
  if (error) lanzar(error)
}

/* =============================================================================================================================================================
 * Rendimiento diario por campaña
 * ============================================================================================================================================================= */

export interface DiaDeCampana {
  campaignId: string
  nombre: string
  fecha: string
  clics: number
  gasto: number
  ventas: number
  pedidos: number
  unidades: number
}

/** `ads_rendimiento_diario` de la cuenta entre dos fechas (ambas incluidas). Sin la tabla (293), vacío */
export async function rendimientoDiario(perfilId: string, desde: string, hasta: string): Promise<DiaDeCampana[]> {
  const service = createServiceClient()
  const r = await todasLasFilas<Record<string, unknown>>((a, b) =>
    service
      .from('ads_rendimiento_diario')
      .select('campaign_id, nombre, fecha, clics, gasto, ventas, pedidos, unidades')
      .eq('perfil_id', perfilId)
      .gte('fecha', desde)
      .lte('fecha', hasta)
      .order('fecha')
      .order('campaign_id')
      .range(a, b) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: { code?: string; message?: string } | null }>,
  100_000)
  if (r.error) {
    if (isMissingSchema(r.error)) return []
    throw r.error
  }
  return r.data.map((x) => ({
    campaignId: String(x.campaign_id),
    nombre: String(x.nombre ?? ''),
    fecha: String(x.fecha).slice(0, 10),
    clics: numero(x.clics) ?? 0,
    gasto: numero(x.gasto) ?? 0,
    ventas: numero(x.ventas) ?? 0,
    pedidos: numero(x.pedidos) ?? 0,
    unidades: numero(x.unidades) ?? 0,
  }))
}

export interface SumaDeVentana {
  clics: number
  gasto: number
  ventas: number
  pedidos: number
  unidades: number
  /** Días con alguna fila */
  dias: number
  /** El mayor gasto de un día */
  maxGastoDia: number
}

/** PURO. Suma las filas de [desde, hasta] que pasen el filtro; `dias` = fechas distintas con fila; `maxGastoDia` = el día de más gasto (sumando las filas de ese día) */
export function sumarDias(filas: readonly DiaDeCampana[], desde: string, hasta: string, filtro?: (f: DiaDeCampana) => boolean): SumaDeVentana {
  const porDia = new Map<string, number>()
  const s = { clics: 0, gasto: 0, ventas: 0, pedidos: 0, unidades: 0 }
  for (const f of filas) {
    if (f.fecha < desde || f.fecha > hasta) continue
    if (filtro && !filtro(f)) continue
    s.clics += f.clics
    s.gasto += f.gasto
    s.ventas += f.ventas
    s.pedidos += f.pedidos
    s.unidades += f.unidades
    porDia.set(f.fecha, (porDia.get(f.fecha) ?? 0) + f.gasto)
  }
  return {
    clics: s.clics,
    gasto: redondear2(s.gasto),
    ventas: redondear2(s.ventas),
    pedidos: s.pedidos,
    unidades: s.unidades,
    dias: porDia.size,
    maxGastoDia: redondear2(Math.max(0, ...Array.from(porDia.values()))),
  }
}

/** PURO. El último día CERRADO con datos: ayer local, o el último que haya en el rendimiento si es anterior (la sincronización acaba en «ayer» UTC) */
export function ultimoDiaCerrado(filas: readonly DiaDeCampana[], fechaLocal: string): string {
  const ayer = desplazar(fechaLocal, -1)
  let max = ''
  for (const f of filas) if (f.fecha > max && f.fecha <= ayer) max = f.fecha
  return max || ayer
}

/**
 * PURO. El gasto de cada día de [desde, hasta]: el del rendimiento si ese día tiene filas; si no (p. ej. ayer local aún sin sincronizar), el `gasto_estimado` de `ads_presupuesto_dia` de ese día;
 * si tampoco, 0. Devuelve un Map fecha → { gasto, fuente }.
 */
export function gastoPorDia(rendimiento: readonly DiaDeCampana[], uso: readonly DiaDeUso[], desde: string, hasta: string): Map<string, { gasto: number; fuente: 'rendimiento' | 'uso' | 'nada' }> {
  const rend = new Map<string, number>()
  for (const f of rendimiento) if (f.fecha >= desde && f.fecha <= hasta) rend.set(f.fecha, (rend.get(f.fecha) ?? 0) + f.gasto)
  const est = new Map<string, number>()
  for (const d of uso) if (d.fechaLocal >= desde && d.fechaLocal <= hasta) est.set(d.fechaLocal, (est.get(d.fechaLocal) ?? 0) + (d.gastoEstimado ?? 0))
  const salida = new Map<string, { gasto: number; fuente: 'rendimiento' | 'uso' | 'nada' }>()
  if (desde > hasta) return salida
  for (let dia = desde, i = 0; dia <= hasta && i < 400; dia = desplazar(dia, 1), i++) {
    if (rend.has(dia)) salida.set(dia, { gasto: redondear2(rend.get(dia) as number), fuente: 'rendimiento' })
    else if (est.has(dia)) salida.set(dia, { gasto: redondear2(est.get(dia) as number), fuente: 'uso' })
    else salida.set(dia, { gasto: 0, fuente: 'nada' })
  }
  return salida
}

/**
 * PURO. El gasto del mes hasta AYER (días locales del mes `< hoy`, rellenados con el uso donde falte el rendimiento) y la media diaria de los 7 días cerrados. Fuera de un evento, la media no cuenta los
 * días «durante» de un evento (si los quita todos, se queda con los 7).
 */
export function gastoDelMes(
  rendimiento: readonly DiaDeCampana[],
  uso: readonly DiaDeUso[],
  fechaLocal: string,
  esDiaDeEvento: (fecha: string) => boolean,
  hoyEnEvento: boolean,
): { gastoMesHastaAyer: number; media7: number } {
  const ayer = desplazar(fechaLocal, -1)
  const inicioMes = `${fechaLocal.slice(0, 7)}-01`
  let gastoMes = 0
  if (inicioMes <= ayer) for (const [, v] of gastoPorDia(rendimiento, uso, inicioMes, ayer)) gastoMes += v.gasto
  const ultimos7 = Array.from(gastoPorDia(rendimiento, uso, desplazar(fechaLocal, -7), ayer).entries())
  let validos = hoyEnEvento ? ultimos7 : ultimos7.filter(([d]) => !esDiaDeEvento(d))
  if (validos.length === 0) validos = ultimos7
  const media7 = validos.length ? validos.reduce((s, [, v]) => s + v.gasto, 0) / validos.length : 0
  return { gastoMesHastaAyer: redondear2(gastoMes), media7: redondear2(media7) }
}

/* =============================================================================================================================================================
 * Ventas totales (TACoS)
 * ============================================================================================================================================================= */

export interface VentasTotalesDeCuenta {
  v7: Record<string, VentaDeAsin>
  v14: Record<string, VentaDeAsin>
  v30: Record<string, VentaDeAsin>
  leidoAt: string | null
  /** Hay alguna venta total guardada */
  hay: boolean
}

/** Las tres ventanas de ventas totales por ASIN (7, 14 y 30 días hasta ayer). Sin datos, vacías */
export async function ventasTotalesDeCuenta(perfilId: string): Promise<VentasTotalesDeCuenta> {
  const leer = async (dias: number) => {
    try {
      return await ventasTotales(perfilId, dias)
    } catch (err) {
      console.error(`[agente] ventas totales de ${dias} días de ${perfilId}:`, err)
      return { porAsin: {} as Record<string, VentaDeAsin>, leidoAt: null, error: null }
    }
  }
  const [a, b, c] = await Promise.all([leer(7), leer(14), leer(30)])
  const mayus = (r: Record<string, VentaDeAsin>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.toUpperCase(), v]))
  const v30 = mayus(c.porAsin)
  return { v7: mayus(a.porAsin), v14: mayus(b.porAsin), v30, leidoAt: c.leidoAt ?? b.leidoAt ?? a.leidoAt, hay: Object.keys(v30).length > 0 || Object.keys(a.porAsin).length > 0 }
}

/** PURO. Σ de las ventas (o unidades) de una ventana; null si la ventana está vacía */
export function sumaDeVentas(v: Record<string, VentaDeAsin>, campo: 'ventas' | 'unidades' = 'ventas', asins?: ReadonlySet<string>): number | null {
  const filas = Object.values(v).filter((x) => !asins || asins.has(x.asin.toUpperCase()))
  if (filas.length === 0) return null
  return redondear2(filas.reduce((s, x) => s + (Number(x[campo]) || 0), 0))
}

/** PURO. Tendencia SEMANAL de las ventas totales en %: últimos 7 días frente a los 7 anteriores (ventana de 14 − ventana de 7). null si no se puede saber */
export function tendenciaSemanal(v7: number | null, v14: number | null): number | null {
  if (v7 == null || v14 == null) return null
  const anteriores = v14 - v7
  if (!(anteriores > 0)) return null
  return redondear1((v7 / anteriores - 1) * 100)
}

/* =============================================================================================================================================================
 * Stock por ASIN
 * ============================================================================================================================================================= */

/**
 * El stock de cada ASIN en el marketplace de la cuenta: Σ de todos sus SKU de `amazon_listings` (FBA → «Disponible», que ya incluye lo que está en transferencia entre centros; no FBA → quantity),
 * de las conexiones de vendedor ACTIVAS del mismo cliente. En los países EFN (FR, DE, IT, NL, BE, SE, PL) un 0 o un hueco se cubre con el de España. Sin cuenta de vendedor, vacío.
 */
export async function stockPorAsin(perfilId: string): Promise<Map<string, StockDeAsin>> {
  return (await leerStockPorAsin(perfilId)).porAsin
}

export type StockDeAsin = { stock: number | null; actualizadoAt: string | null; fuente: string }

/**
 * Lo mismo que `stockPorAsin`, diciendo si se ha podido LEER: `ok: false` si falla cualquiera de las tres consultas (perfil, conexiones de vendedor o listados), con el
 * Map vacío. Una lectura fallida NO es «stock desconocido»: quien decide con el stock (posturas del cerebro, subidas al aplicar) tiene que saberlo para no rebajar un
 * «recortar» por stock a «mantener» ni dejar pasar subidas en productos sin cobertura por un fallo de la base. Sin cuenta de vendedor sí es `ok: true` (vacío de verdad).
 */
export async function leerStockPorAsin(perfilId: string): Promise<{ ok: boolean; error: string | null; porAsin: Map<string, StockDeAsin> }> {
  const service = createServiceClient()
  const salida = new Map<string, StockDeAsin>()
  const fallo = (que: string, e: { message?: string } | null | undefined) => {
    console.error(`[agente] stock: ${que}:`, e?.message ?? e)
    return { ok: false, error: `${que}: ${e?.message ?? 'error desconocido'}`, porAsin: new Map<string, StockDeAsin>() }
  }
  const { data: perfil, error: ePerfil } = await service.from('ads_profiles').select('pais, ads_connections(client_id)').eq('id', perfilId).maybeSingle()
  if (ePerfil) return fallo('perfil de Ads', ePerfil)
  const p = perfil as { pais: string | null; ads_connections: { client_id: string | null } | Array<{ client_id: string | null }> | null } | null
  const con = Array.isArray(p?.ads_connections) ? p?.ads_connections[0] : p?.ads_connections
  const pais = String(p?.pais ?? '').toUpperCase()
  const mkLocal = pais ? marketplaceDePais(pais) : null
  if (!con?.client_id || !mkLocal) return { ok: true, error: null, porAsin: salida }
  const mkEspana = marketplaceDePais('ES')
  const { data: conexiones, error: eConexiones } = await service.from('amazon_connections').select('id').eq('client_id', con.client_id).eq('is_active', true)
  if (eConexiones) return fallo('conexiones de vendedor', eConexiones)
  const ids = ((conexiones ?? []) as Array<{ id: string }>).map((c) => c.id)
  if (ids.length === 0) return { ok: true, error: null, porAsin: salida }
  const mks = Array.from(new Set([mkLocal, ...(mkEspana && mkEspana !== mkLocal ? [mkEspana] : [])]))
  const r = await todasLasFilas<Record<string, unknown>>((a, b) =>
    service
      .from('amazon_listings')
      .select('asin, sku, marketplace_id, is_fba, quantity, fba_fulfillable_quantity, updated_at')
      .in('connection_id', ids)
      .in('marketplace_id', mks)
      .order('sku')
      .range(a, b) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: { code?: string; message?: string } | null }>,
  50_000)
  if (r.error) return fallo('amazon_listings', r.error)
  const fila = (x: Record<string, unknown>) => ({
    asin: (x.asin as string | null) ?? null,
    isFba: typeof x.is_fba === 'boolean' ? x.is_fba : null,
    quantity: numero(x.quantity),
    fbaDisponible: numero(x.fba_fulfillable_quantity),
    updatedAt: (x.updated_at as string | null) ?? null,
  })
  const locales = stockDeAsin(r.data.filter((x) => x.marketplace_id === mkLocal).map(fila))
  const espana = mkEspana && mkEspana !== mkLocal ? stockDeAsin(r.data.filter((x) => x.marketplace_id === mkEspana).map(fila)) : new Map()
  const asins = new Set<string>([...Array.from(locales.keys()), ...Array.from(espana.keys())])
  for (const asin of Array.from(asins)) {
    const e = stockEfectivo(locales.get(asin), espana.get(asin), pais)
    // Un ASIN que solo está en España y la cuenta no es EFN no cuenta: no se vende en este país
    if (!locales.has(asin) && e.fuente.startsWith('sin dato')) continue
    salida.set(asin, e)
  }
  return { ok: true, error: null, porAsin: salida }
}

/* =============================================================================================================================================================
 * Los productos del agente: objetivo BASE, fase, marca, postura
 * ============================================================================================================================================================= */

export interface ProductoDelAgente {
  asin: string
  sku: string
  nombre: string
  activo: boolean
  /** Precio con el que decide el motor (ficha o ticket medio de Ads) */
  precio: number | null
  precioEstimado: boolean
  /** ACoS de equilibrio (null sin coste o sin precio) */
  equilibrioPct: number | null
  /** El ACoS que ha fijado una persona */
  humano: number | null
  /** El automático congelado (ads_agente_objetivos) */
  automatico: { acosObjetivoPct: number; fuente: Exclude<FuenteDeObjetivo, 'humano'>; soloDefensivo: boolean; congeladoAt: string | null; revisadoMes: string | null; detalle: string | null } | null
  /** Objetivo BASE (humano, o automático × acosLanzamientoX en lanzamiento) */
  acosObjetivoPct: number | null
  fuenteObjetivo: FuenteDeObjetivo | null
  soloDefensivo: boolean
  cpaObjetivo: number | null
  fase: FaseDeProducto
  faseManual: FaseDeProducto | null
  marca: string | null
  postura: Postura
  fuentePostura: FuenteDePostura | null
  motivoPostura: string | null
  /** Datos de coste (para recalcular el objetivo automático) */
  costes: { precioFicha: number | null; ivaPct: number; costeProducto: number | null; comisionPct: number; tarifaFba: number; otrosCostes: number }
}

/** PURO. Ticket medio de Ads por ASIN (ventas ÷ unidades de 30 días) */
export function ticketsMedios(filas: readonly DiaDeCampana[], desde: string, hasta: string): Map<string, number> {
  const por = new Map<string, { ventas: number; unidades: number }>()
  for (const f of filas) {
    if (f.fecha < desde || f.fecha > hasta) continue
    const asin = asinDeCampana(f.nombre)
    if (!asin) continue
    const x = por.get(asin) ?? { ventas: 0, unidades: 0 }
    x.ventas += f.ventas
    x.unidades += f.unidades
    por.set(asin, x)
  }
  const salida = new Map<string, number>()
  for (const [asin, x] of Array.from(por.entries())) if (x.unidades > 0 && x.ventas > 0) salida.set(asin, redondear2(x.ventas / x.unidades))
  return salida
}

/**
 * Los productos de la cuenta (ads_productos) con lo que el agente necesita: objetivo base (el humano manda; si no, el automático CONGELADO de ads_agente_objetivos), fase (manual o < 60 días desde su
 * primera estructura), marca, equilibrio, CPA objetivo y la postura guardada. Sin la 315, lanza.
 */
export async function productosDelAgente(perfilId: string, ficha: FichaDeCuenta, ahora: number, tickets: Map<string, number>): Promise<ProductoDelAgente[]> {
  const service = createServiceClient()
  const [productos, extra, estructuras, objetivos, posturas] = await Promise.all([
    productosDeCuenta(perfilId),
    service.from('ads_productos').select('id, asin, marca, fase_agente').eq('perfil_id', perfilId),
    service.from('ads_estructuras').select('producto_id, created_at').eq('perfil_id', perfilId).order('created_at', { ascending: true }),
    service.from('ads_agente_objetivos').select('asin, acos_objetivo_pct, fuente, solo_defensivo, detalle, congelado_at, revisado_mes').eq('perfil_id', perfilId),
    service.from('ads_agente_posturas').select('asin, postura, fuente, motivo').eq('perfil_id', perfilId),
  ])
  if (extra.error) lanzar(extra.error)
  if (objetivos.error) lanzar(objetivos.error)
  if (posturas.error) lanzar(posturas.error)
  if (estructuras.error && !isMissingSchema(estructuras.error)) throw estructuras.error

  const extraPorId = new Map(((extra.data ?? []) as Array<{ id: string; marca: string | null; fase_agente: string | null }>).map((x) => [x.id, x]))
  const primera = new Map<string, string>()
  for (const e of (estructuras.data ?? []) as Array<{ producto_id: string; created_at: string }>) if (!primera.has(e.producto_id)) primera.set(e.producto_id, e.created_at)
  const autoPorAsin = new Map<string, ProductoDelAgente['automatico']>()
  for (const o of (objetivos.data ?? []) as Array<Record<string, unknown>>) {
    const pct = numero(o.acos_objetivo_pct)
    const fuente = o.fuente as Exclude<FuenteDeObjetivo, 'humano'>
    if (pct == null || !['equilibrio', 'acos_real', 'tacos'].includes(fuente)) continue
    autoPorAsin.set(String(o.asin).toUpperCase(), {
      acosObjetivoPct: pct,
      fuente,
      soloDefensivo: o.solo_defensivo !== false,
      congeladoAt: (o.congelado_at as string | null) ?? null,
      revisadoMes: (o.revisado_mes as string | null) ?? null,
      detalle: (o.detalle as string | null) ?? null,
    })
  }
  const posturaPorAsin = new Map<string, { postura: Postura; fuente: FuenteDePostura; motivo: string | null }>()
  for (const p of (posturas.data ?? []) as Array<{ asin: string; postura: Postura; fuente: FuenteDePostura; motivo: string | null }>) {
    posturaPorAsin.set(p.asin.toUpperCase(), { postura: p.postura, fuente: p.fuente, motivo: p.motivo })
  }

  return productos.map((p) => {
    const asin = p.asin.toUpperCase()
    const ex = extraPorId.get(p.id)
    const faseManual = ex?.fase_agente === 'lanzamiento' || ex?.fase_agente === 'normal' ? (ex.fase_agente as FaseDeProducto) : null
    const fase = faseDeProducto({ faseManual, primeraEstructuraAt: primera.get(p.id) ?? null, ahora })
    const automatico = autoPorAsin.get(asin) ?? null
    const base = objetivoBase({ humano: p.acosObjetivoPct, automatico, fase, acosLanzamientoX: ficha.acosLanzamientoX })
    const precio = precioParaMotor(p.precio, tickets.get(asin))
    const m = margenDeProducto({ precio: p.precio, ivaPct: p.ivaPct, costeProducto: p.costeProducto, comisionPct: p.comisionPct, tarifaFba: p.tarifaFba, otrosCostes: p.otrosCostes })
    const postura = posturaPorAsin.get(asin)
    return {
      asin,
      sku: p.sku,
      nombre: p.resumen || asin,
      activo: p.activo,
      precio: precio?.precio ?? null,
      precioEstimado: precio?.estimado ?? false,
      equilibrioPct: m && m.acosEquilibrioPct > 0 ? m.acosEquilibrioPct : null,
      humano: p.acosObjetivoPct,
      automatico,
      acosObjetivoPct: base.acosObjetivoPct,
      fuenteObjetivo: base.fuente,
      soloDefensivo: base.soloDefensivo,
      cpaObjetivo: precio && base.acosObjetivoPct != null ? redondear2((precio.precio * base.acosObjetivoPct) / 100) : null,
      fase,
      faseManual,
      marca: ex?.marca?.trim() ? ex.marca.trim() : null,
      postura: postura?.postura ?? 'mantener',
      fuentePostura: postura?.fuente ?? null,
      motivoPostura: postura?.motivo ?? null,
      costes: { precioFicha: p.precio, ivaPct: p.ivaPct, costeProducto: p.costeProducto, comisionPct: p.comisionPct, tarifaFba: p.tarifaFba, otrosCostes: p.otrosCostes },
    }
  })
}

/** ¿Es de marca la campaña? (rol DEFENSA/MARCA de la nomenclatura, o el nombre contiene la marca de su producto) */
export function campanaEsDeMarca(nombre: string, marcaDelProducto: string | null): boolean {
  return esCampanaDeMarca(nombre, partesDeNombre(nombre)?.rol ?? null, marcaDelProducto)
}

/* =============================================================================================================================================================
 * El estado del mes con el ritmo GUARDADO (el que calculó el vigilar del día)
 * ============================================================================================================================================================= */

/** PURO. El EstadoDelMes con el ritmo guardado (sin recalcularlo): gasto hasta ayer, media 7, proyección y techo del mes */
export function estadoDelMesGuardado(e: { gastoMesHastaAyer: number; media7: number; techoMes: number | null; dia: number; diasDelMes: number; ritmo: RitmoDelMes; ritmoEsDeEsteMes: boolean }): EstadoDelMes {
  const diasRestantes = Math.max(1, e.diasDelMes - e.dia + 1)
  const ritmo = e.ritmoEsDeEsteMes ? e.ritmo : 'normal'
  const proyeccion = redondear2(e.gastoMesHastaAyer + e.media7 * diasRestantes)
  return {
    gastoMes: redondear2(e.gastoMesHastaAyer),
    techo: e.techoMes,
    proyeccion,
    media7: redondear2(e.media7),
    diasRestantes,
    ritmo,
    cambiado: false,
    motivo: e.techoMes == null ? 'Sin techo mensual de gasto: ritmo normal.' : `Ritmo ${ritmo} (calculado una vez al día con días cerrados).`,
  }
}

/* =============================================================================================================================================================
 * Lo común a contexto, vigilar y encender: una sola lectura de la cuenta
 * ============================================================================================================================================================= */

export interface LecturaDeCuenta {
  perfil: PerfilDelAgente
  ficha: FichaDeCuenta
  local: ReturnType<typeof horaLocal>
  rendimiento: DiaDeCampana[]
  /** Último día cerrado con datos (≤ ayer local) */
  hasta: string
  productos: ProductoDelAgente[]
  ventas: VentasTotalesDeCuenta
  /** Gasto, ventas… de la cuenta en 30 días cerrados */
  cuenta30: SumaDeVentana
  techo: { techo: number | null; automatico: boolean; congelar: boolean; cambia: boolean; detalle: string }
  techoMes: number | null
  evento: { nombre: string; fase: FaseDeEvento } | null
  cuentaPequena: boolean
  acosObjetivoMedio: number | null
  /** CPA objetivo medio (ponderado por gasto 30 d) */
  cpaObjetivoMedio: number | null
}

/** Lee lo que comparten el contexto, vigilar y encender (solo base de datos). `dias` = días de rendimiento hacia atrás (90 para objetivos; 45 bastan para vigilar) */
export async function leerCuenta(perfilId: string, config: ConfigDelAgente | null, ahora: number, dias = 90): Promise<LecturaDeCuenta> {
  const [perfil, ficha] = await Promise.all([nombreDeCuenta(perfilId), leerFicha(perfilId)])
  const local = horaLocal(ahora, perfil.zona)
  const ayer = desplazar(local.fecha, -1)
  const [rendimiento, ventas] = await Promise.all([rendimientoDiario(perfilId, desplazar(local.fecha, -dias), ayer), ventasTotalesDeCuenta(perfilId)])
  const hasta = ultimoDiaCerrado(rendimiento, local.fecha)
  const tickets = ticketsMedios(rendimiento, desplazar(hasta, -29), hasta)
  const productos = await productosDelAgente(perfilId, ficha, ahora, tickets)
  const cuenta30 = sumarDias(rendimiento, desplazar(hasta, -29), hasta)

  const ventasTotales30 = sumaDeVentas(ventas.v30)
  const manuales = config?.eventosManuales ?? []
  // El techo automático congelado se revisa una vez al mes (día local del marketplace), nunca con 30 días que toquen un evento de temporada
  const congeladoMs = config?.techoCongeladoAt ? Date.parse(config.techoCongeladoAt) : NaN
  const techo = techoAutomatico({
    presupuestoMensual: ficha.presupuestoMensual,
    congelado:
      config && config.techoMensual != null
        ? { techo: config.techoMensual, automatico: config.techoAutomatico, mes: Number.isFinite(congeladoMs) ? horaLocal(congeladoMs, perfil.zona).mes : null }
        : null,
    gasto30: cuenta30.gasto,
    ventasTotales30,
    tacosObjetivoPct: ficha.tacosObjetivoPct,
    mesActual: local.mes,
    ventanaConEvento: ventanaTocaEvento(desplazar(hasta, -29), hasta, perfil.pais, manuales) != null,
  })
  const techoMes = techoDelMes(techo.techo, hayEventoEnElMes(local.mes, perfil.pais, manuales), config?.picoEventos === true)
  const evento = eventoEn(local.fecha, perfil.pais, manuales)

  // Objetivo medio y CPA medio con los objetivos BASE, ponderados por el gasto de 30 días de cada producto
  const gastoPorAsin = new Map<string, number>()
  for (const f of rendimiento) {
    if (f.fecha < desplazar(hasta, -29) || f.fecha > hasta) continue
    const a = asinDeCampana(f.nombre)
    if (a) gastoPorAsin.set(a, (gastoPorAsin.get(a) ?? 0) + f.gasto)
  }
  const medio = acosObjetivoMedio(productos.map((p) => ({ acosObjetivoPct: p.acosObjetivoPct, gasto30: gastoPorAsin.get(p.asin) ?? 0 })))
  const conCpa = productos.filter((p) => p.cpaObjetivo != null)
  const gastoCpa = conCpa.reduce((s, p) => s + (gastoPorAsin.get(p.asin) ?? 0), 0)
  const cpaObjetivoMedio = conCpa.length
    ? redondear2(gastoCpa > 0 ? conCpa.reduce((s, p) => s + (gastoPorAsin.get(p.asin) ?? 0) * (p.cpaObjetivo as number), 0) / gastoCpa : conCpa.reduce((s, p) => s + (p.cpaObjetivo as number), 0) / conCpa.length)
    : null

  return {
    perfil,
    ficha,
    local,
    rendimiento,
    hasta,
    productos,
    ventas,
    cuenta30,
    techo,
    techoMes,
    evento,
    cuentaPequena: cuenta30.gasto < AGENTE.CUENTA_PEQUENA_GASTO30,
    acosObjetivoMedio: medio,
    cpaObjetivoMedio,
  }
}

/** Las filas de `ads_presupuesto_dia` de la cuenta entre dos fechas locales (lectura propia: no se importa uso-servidor para no hacer un ciclo). Sin la 315, lanza */
export async function filasDeUso(perfilId: string, desde: string, hasta: string): Promise<DiaDeUso[]> {
  const service = createServiceClient()
  const r = await todasLasFilas<Record<string, unknown>>((a, b) =>
    service
      .from('ads_presupuesto_dia')
      .select('campaign_id, fecha_local, presupuesto, presupuesto_primera, uso_pct, uso_max_pct, gasto_estimado, agotada_min, agotada_por_estado, estado_campana, fuente, leido_at')
      .eq('perfil_id', perfilId)
      .gte('fecha_local', desde)
      .lte('fecha_local', hasta)
      .order('fecha_local')
      .order('campaign_id')
      .range(a, b) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: { code?: string; message?: string } | null }>,
  100_000)
  if (r.error) lanzar(r.error)
  return r.data.map(diaDeFila)
}

export function diaDeFila(x: Record<string, unknown>): DiaDeUso {
  return {
    campaignId: String(x.campaign_id),
    fechaLocal: String(x.fecha_local).slice(0, 10),
    presupuesto: numero(x.presupuesto),
    presupuestoPrimera: numero(x.presupuesto_primera),
    usoPct: numero(x.uso_pct),
    usoMaxPct: numero(x.uso_max_pct),
    gastoEstimado: numero(x.gasto_estimado),
    agotadaMin: numero(x.agotada_min),
    agotadaPorEstado: x.agotada_por_estado === true,
    estadoCampana: (x.estado_campana as string | null) ?? null,
    fuente: x.fuente === 'api' ? 'api' : 'estado',
    leidoAt: String(x.leido_at ?? ''),
  }
}

/* =============================================================================================================================================================
 * El contexto
 * ============================================================================================================================================================= */

/** El contexto de la cuenta para el cerebro, el resumen y el panel. Solo base de datos */
export async function leerContextoDelAgente(cuenta: CuentaParaSincronizar, config: ConfigDelAgente | null, ahora: number): Promise<ContextoDelAgente> {
  const l = await leerCuenta(cuenta.id, config, ahora, 90)
  const { perfil, local, rendimiento, hasta, productos, ventas, ficha } = l
  const manuales = config?.eventosManuales ?? []
  const [uso, lecturaDeStock] = await Promise.all([
    filasDeUso(cuenta.id, desplazar(local.fecha, -40), local.fecha),
    // Un fallo (también si lanza) es «no se ha podido leer», no «stock desconocido»: posturasDeLosProductos no toca entonces las posturas por stock
    leerStockPorAsin(cuenta.id).catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e), porAsin: new Map<string, StockDeAsin>() })),
  ])
  const stock = lecturaDeStock.porAsin

  const desde7 = desplazar(hasta, -6)
  const desde14 = desplazar(hasta, -13)
  const desde30 = desplazar(hasta, -29)
  const ayer = desplazar(local.fecha, -1)

  // Marca de cada campaña (por su producto)
  const marcaDe = new Map(productos.map((p) => [p.asin, p.marca]))
  const esMarca = (f: DiaDeCampana) => {
    const a = asinDeCampana(f.nombre)
    return campanaEsDeMarca(f.nombre, a ? (marcaDe.get(a) ?? null) : null)
  }

  const c7 = sumarDias(rendimiento, desde7, hasta)
  const c30 = l.cuenta30
  const cAyer = sumarDias(rendimiento, ayer, ayer)
  const m7 = sumarDias(rendimiento, desde7, hasta, esMarca)
  const ventasTotales30 = sumaDeVentas(ventas.v30)

  const prods: ProductoDelContexto[] = productos
    .filter((p) => p.activo)
    .map((p) => {
      const deAsin = (f: DiaDeCampana) => asinDeCampana(f.nombre) === p.asin
      const s14 = sumarDias(rendimiento, desde14, hasta, deAsin)
      const s30 = sumarDias(rendimiento, desde30, hasta, deAsin)
      const vt30 = ventas.v30[p.asin]?.ventas ?? null
      const vt7 = ventas.v7[p.asin]?.ventas ?? null
      const vt14 = ventas.v14[p.asin]?.ventas ?? null
      const st = stock.get(p.asin)
      const stockN = st?.stock ?? null
      return {
        asin: p.asin,
        nombre: p.nombre,
        acosObjetivoPct: p.acosObjetivoPct,
        fuenteObjetivo: p.fuenteObjetivo,
        objetivoCongeladoAt: p.fuenteObjetivo && p.fuenteObjetivo !== 'humano' ? (p.automatico?.congeladoAt ?? null) : null,
        soloDefensivo: p.soloDefensivo,
        equilibrioPct: p.equilibrioPct,
        cpaObjetivo: p.cpaObjetivo,
        fase: p.fase,
        marca: p.marca,
        acos14Pct: acosDe(s14.gasto, s14.ventas),
        acos30Pct: acosDe(s30.gasto, s30.ventas),
        tacos30Pct: vt30 != null && vt30 > 0 ? redondear2((s30.gasto / vt30) * 100) : null,
        clics14: s14.clics,
        gasto30: s30.gasto,
        ventas30: s30.ventas,
        pedidos30: s30.pedidos,
        ventasTotales30: vt30,
        // Sin ventas totales día a día no hay «mes» ni «mes anterior» (ver la cabecera)
        ventasTotalesMes: null,
        ventasTotalesMesAnterior: null,
        tacosMesPct: null,
        tacosMesAnteriorPct: null,
        tendenciaVentasTotalesPct: tendenciaSemanal(vt7, vt14),
        stock: stockN,
        stockActualizadoAt: st?.actualizadoAt ?? null,
        stockViejo: stockN != null && stockEsViejo(st?.actualizadoAt ?? null, ahora),
        coberturaDias: coberturaDias(stockN, ventas.v14[p.asin]?.unidades ?? null),
        postura: p.postura,
        fuentePostura: p.fuentePostura,
        motivoPostura: p.motivoPostura,
      }
    })

  const esDiaDeEvento = (d: string) => eventoEn(d, perfil.pais, manuales)?.fase === 'durante'
  const hoyEnEvento = l.evento?.fase === 'durante' || l.evento?.fase === 'previo'
  const gm = gastoDelMes(rendimiento, uso, local.fecha, esDiaDeEvento, hoyEnEvento)
  const mes = estadoDelMesGuardado({
    gastoMesHastaAyer: gm.gastoMesHastaAyer,
    media7: gm.media7,
    techoMes: l.techoMes,
    dia: local.dia,
    diasDelMes: local.diasDelMes,
    ritmo: config?.ritmo ?? 'normal',
    ritmoEsDeEsteMes: Boolean(config?.ritmoFecha && config.ritmoFecha.slice(0, 7) === local.mes),
  })

  return {
    perfilId: cuenta.id,
    nombreCuenta: perfil.nombre,
    pais: perfil.pais,
    moneda: perfil.moneda,
    zonaHoraria: perfil.zona,
    fechaLocal: local.fecha,
    tacosObjetivoPct: ficha.tacosObjetivoPct,
    acosObjetivoMedioPct: l.acosObjetivoMedio,
    muestraMinimaClics: ficha.muestraMinimaClics,
    techo: { techo: l.techo.techo, automatico: l.techo.automatico, congeladoAt: l.techo.automatico ? (config?.techoCongeladoAt ?? null) : null },
    mes,
    evento: l.evento,
    cuentaPequena: l.cuentaPequena,
    stockLeido: lecturaDeStock.ok,
    cuenta: {
      gasto7: c7.gasto,
      ventas7: c7.ventas,
      acos7Pct: acosDe(c7.gasto, c7.ventas),
      hasta7: hasta,
      acos30Pct: acosDe(c30.gasto, c30.ventas),
      tacos30Pct: ventasTotales30 != null && ventasTotales30 > 0 ? redondear2((c30.gasto / ventasTotales30) * 100) : null,
      ventasAds30: c30.ventas,
      ventasTotales30,
      ventasTotalesMes: null,
      ventasTotalesMesAnterior: null,
      tacosMesPct: null,
      tacosMesAnteriorPct: null,
      gastoAyer: cAyer.gasto,
      ventasAyer: cAyer.ventas,
      gasto30: c30.gasto,
      marca: m7.dias > 0 ? { gasto7: m7.gasto, ventas7: m7.ventas, acos7Pct: acosDe(m7.gasto, m7.ventas) } : null,
    },
    productos: prods,
  }
}

/**
 * Lo que hace falta al ENCENDER el agente: la suma de presupuestos de las campañas activas (de Amazon; si falla, la de hoy en `ads_presupuesto_dia`), el ACoS de 7 días cerrados (para el freno
 * «acos_cuenta», que compara contra el de al encender) y el techo (el de la ficha, el congelado o el automático que se congelará).
 */
export async function datosParaEncender(
  cuenta: CuentaParaSincronizar,
  ahora: number,
): Promise<{ sumaPresupuestos: number | null; acos7: number | null; techo: { techo: number | null; automatico: boolean; detalle: string } }> {
  let config: ConfigDelAgente | null = null
  try {
    config = await leerConfigPropia(cuenta.id)
  } catch (err) {
    // Sin la 315 no se puede encender (lo dice encenderAgente); aquí se calcula igual
    if (!(err instanceof Error && err.message === FALTA_MIGRACION_315)) throw err
  }
  const l = await leerCuenta(cuenta.id, config, ahora, 35)
  const c7 = sumarDias(l.rendimiento, desplazar(l.hasta, -6), l.hasta)

  let sumaPresupuestos: number | null = null
  try {
    const { campanas } = await campanasDe(cuenta.conexionId, cuenta.profileId)
    const activas = campanas.filter((c) => c.estado === 'ENABLED' && c.presupuesto != null)
    sumaPresupuestos = activas.length ? redondear2(activas.reduce((s, c) => s + (c.presupuesto as number), 0)) : null
  } catch (err) {
    console.error('[agente] suma de presupuestos al encender (Amazon):', err)
    try {
      const hoy = await filasDeUso(cuenta.id, l.local.fecha, l.local.fecha)
      const activas = hoy.filter((d) => (d.estadoCampana ?? 'ENABLED').toUpperCase() === 'ENABLED' && d.presupuesto != null)
      sumaPresupuestos = activas.length ? redondear2(activas.reduce((s, d) => s + (d.presupuesto as number), 0)) : null
    } catch {
      sumaPresupuestos = null
    }
  }

  return { sumaPresupuestos, acos7: acosDe(c7.gasto, c7.ventas), techo: { techo: l.techo.techo, automatico: l.techo.automatico, detalle: l.techo.detalle } }
}
