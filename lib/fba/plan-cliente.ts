/**
 * EL PLAN DE UN CLIENTE, ENTERO — PURO (spec remesas-pro §2.2, §9 y §11: D1-D17, D22, D24, D34, D43).
 * ===================================================================================================
 * Junta las piezas puras de la oleada 1 y devuelve un `PlanCliente`:
 *
 *   ritmo.ts            serie diaria, ritmo robusto, perfil semanal y reparto por tallas
 *   modelo-sku.ts       modelo y talla desde el SKU cuando el catálogo no lo dice
 *   llegadas.ts         lo que va a llegar (camino, entrante sin remesa, comprometido, hablado) y lo dudoso
 *   medidas-cliente.ts  transporte, recepción, cadencia, caja deducida y mercado de la remesa
 *   planificador.ts     plazo por etapas, una referencia → `LineaPlan`, y `ajustarPorModelo`
 *   envios-propuestos   líneas → envíos propuestos
 *
 * y además calcula lo que solo se ve con el cliente entero: la calidad de los datos, el resumen, los envíos de camino y el
 * acierto del ritmo de hace 30 días.
 *
 * La entrada son filas casi crudas de la base (las lee `plan-datos.ts`; las pruebas las sacan de la foto real
 * `__fixtures__/plan-real.json`): así el mapeo de filas a `EntradaSku` es UNO y está probado. Nada de `Date.now()`:
 * `hoy` y `ahora` llegan de fuera.
 */

import { cuentaParaRotura, roturaDeLinea, rompeEn } from './rotura-linea'
import { ajustesDesdeFila, type FilaReposicionConfig } from './ajustes-reposicion'
import { agruparEnvios } from './envios-propuestos'
import { MERCADO_ESPANA, stockEntreMercados } from './lectura-elegida'
import { caminoEsDudoso, ESTADOS_AMAZON_RECIBIENDO, llegadaPrevistaDeCamino, llegadasDeSku, type ComprometidoRemesa, type EnvioHablado } from './llegadas'
import { cajaDeducida, medirCadencia, medirRecepcion, medirTransporte, mercadoDeRemesa } from './medidas-cliente'
import { modeloDesdeSku, patronesDeCliente } from './modelo-sku'
import {
  ajustarPorModelo,
  dinero,
  diasEntre,
  esNoComprable,
  fechaCorta,
  numero,
  planificarSku,
  plazoDelCliente,
  recalcularConLlegada,
  sumarDias,
} from './planificador'
import type {
  AjustesReposicion,
  CalidadDatos,
  EnCamino,
  EntradaSku,
  EnvioPropuestoCalculado,
  FilaStock,
  Libro,
  LineaPlan,
  MedidasCliente,
  MotivoFuera,
  PlanCliente,
  PlazoEtapas,
  Prioridad,
  ResumenPlan,
  RitmoSku,
  SerieSku,
  StockElegido,
} from './plan-tipos'
import {
  devolucionesYMermas,
  perfilDelCliente,
  perfilSemanal,
  primeraActividadDe,
  primeraEntradaDe,
  ritmoPorModelo,
  ritmoRobusto,
  serieDiaria,
  type MovimientoDiario,
} from './ritmo'

/* ------------------------------------------------------------------ */
/* Entrada                                                             */
/* ------------------------------------------------------------------ */

/** Una fila de `amazon_listings` (cualquier mercado de la conexión) */
export interface ListingPlan {
  marketplaceId: string
  sku: string
  asin: string | null
  fnsku: string | null
  titulo: string | null
  listingStatus: string[] | null
  precio: number | null
  moneda: string | null
  fbaQuantity: number | null
  vendibles: number | null
  entrante: number | null
  reservadas: number | null
  noApto: number | null
  activoManual: boolean | null
  updatedAt: string | null
}

/** Una remesa del cliente con TODAS sus líneas (o, en la foto, las de sus SKU y los totales) */
export interface RemesaPlan {
  id: string
  nombre: string | null
  estado: string
  estadoAmazon: string | null
  marketplaceId: string | null
  referenciaEnvio: string | null
  fechaEnvio: string | null
  llegadaAt: string | null
  /** Totales del envío entero (no solo de las líneas que vengan) */
  unidades: number
  recibidas: number
  lineas: Array<{ sku: string; unidades: number; recibidas: number | null }>
}

export interface CatalogoPlan {
  fbasku: string | null
  ref: string | null
  nombre: string | null
  talla: string | null
  continuidad: boolean | null
  precio: number | null
}

export interface ReposicionSkuPlan {
  sku: string
  unidadesCaja: number | null
  coberturaDias: number | null
  excluir: boolean
  motivo: string | null
}

export interface ConfigAlertasPlan {
  diasPreparacion: number | null
  diasTransporte: number | null
  diasRecepcion: number | null
  diasMargen: number | null
  total: number | null
}

export interface EntradaPlanCliente {
  clienteId: string
  clienteNombre: string
  connectionId: string | null
  region: 'eu' | 'na' | 'fe' | null
  conexionesActivas: number
  /** 'YYYY-MM-DD' en España */
  hoy: string
  /** Instante del cálculo (ISO), para `calidad.calculadoAt` */
  ahora: string
  /** La lectura elegida (`elegirLectura`); null = sin conexión o sin ninguna lectura */
  lectura: { marketplaceId: string; leidoHasta: string | null; leidoDesde: string | null; ultimoError: string | null } | null
  /** Aviso de `elegirLectura` («ventas hasta el 6 nov: …») */
  avisoLectura: string | null
  /** Libro agregado por SKU y día de la lectura elegida (hoy − 400 → hoy) */
  libro: MovimientoDiario[]
  /** Listings: los del mercado de la lectura y, de los SKU que faltan, los de otros mercados (con stock, y para la ficha todos) */
  listings: ListingPlan[]
  /**
   * El mercado donde de verdad están los listings de la conexión (el de la lectura si tiene; si no, el predeterminado o el que más
   * tiene). De ahí salen nombre, ASIN, FNSKU y precio de las referencias sin fila en el mercado de la lectura. Opcional (fixtures).
   */
  mercadoListings?: string | null
  /** Algún listing del cliente en el mercado de la lectura trae BUYABLE (salvaguarda de D1). null = calcularlo con `listings` */
  hayBuyableEnCliente: boolean | null
  remesas: RemesaPlan[]
  /** Receipts del libro por número de envío (para medir transporte y recepción) */
  receipts: Array<{ referencia: string; fecha: string; cantidad: number }>
  /** `leerComprometido`: por SKU, remesas sin salir */
  comprometido: Map<string, ComprometidoRemesa[]>
  /** Envíos propuestos en hablado | esperando_cliente (cuentan como llegada, D3/D24) */
  hablados: Array<{ envioPropuestoId: string; salirAntesDe: string; lineas: Array<{ sku: string; cantidad: number }> }>
  configAlertas: ConfigAlertasPlan | null
  plazosSku: Record<string, number>
  configReposicion: FilaReposicionConfig | null
  reposicionSku: ReposicionSkuPlan[]
  catalogo: CatalogoPlan[]
  /** % (0..1) del stock con más de 180 días según el informe de Amazon, si es reciente */
  edadAmazon: Record<string, number> | null
  /** Envíos propuestos descartados hace < 14 días (cuarentena por SKU) */
  descartes: Array<{ prioridad: Prioridad; estadoCambiadoAt: string; skus: string[]; prioridadPorSku?: Record<string, Prioridad> }>
  /** Ritmos previstos de la pasada de hace ~30 días, para el acierto (D43.2) */
  pasadaAnterior: { hoy: string; previstos: Record<string, number> } | null
}

/* ------------------------------------------------------------------ */
/* De las filas de la base a la entrada (lo usan plan-datos y la prueba) */
/* ------------------------------------------------------------------ */

const numeroONulo = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}
const textoONulo = (v: unknown): string | null => (v === null || v === undefined ? null : String(v).trim() || null)

/** Fila de `amazon_listings` (columnas de la tabla) */
export interface FilaListing {
  marketplace_id: string; sku: string; asin?: string | null; fnsku?: string | null; title?: string | null
  listing_status?: string[] | null; price?: number | string | null; currency?: string | null
  fba_quantity?: number | null; fba_fulfillable_quantity?: number | null; fba_inbound_quantity?: number | null
  fba_reserved_quantity?: number | null; fba_unfulfillable_quantity?: number | null
  activo_manual?: boolean | null; updated_at?: string | null
}

/** Las columnas de `amazon_listings` que lee el plan */
export const COLUMNAS_LISTING =
  'marketplace_id, sku, asin, fnsku, title, listing_status, price, currency, fba_quantity, fba_fulfillable_quantity, ' +
  'fba_inbound_quantity, fba_reserved_quantity, fba_unfulfillable_quantity, activo_manual, updated_at'

export function listingDesdeFila(f: FilaListing): ListingPlan {
  return {
    marketplaceId: f.marketplace_id,
    sku: f.sku,
    asin: textoONulo(f.asin),
    fnsku: textoONulo(f.fnsku),
    titulo: textoONulo(f.title),
    listingStatus: Array.isArray(f.listing_status) ? f.listing_status : null,
    precio: numeroONulo(f.price),
    moneda: f.currency ? String(f.currency).toUpperCase() : null,
    fbaQuantity: numeroONulo(f.fba_quantity),
    vendibles: numeroONulo(f.fba_fulfillable_quantity),
    entrante: numeroONulo(f.fba_inbound_quantity),
    reservadas: numeroONulo(f.fba_reserved_quantity),
    noApto: numeroONulo(f.fba_unfulfillable_quantity),
    activoManual: typeof f.activo_manual === 'boolean' ? f.activo_manual : null,
    updatedAt: f.updated_at ?? null,
  }
}

/** Fila de `fba_remesas` + totales (si faltan, se suman las líneas) */
export interface FilaRemesaPlan {
  id: string; nombre: string | null; estado: string; estado_amazon: string | null; marketplace_id: string | null
  referencia_envio: string | null; fecha_envio: string | null; llegada_at: string | null
  unidades_totales?: number | null; recibidas_totales?: number | null
}

export function remesaDesdeFila(r: FilaRemesaPlan, lineas: Array<{ sku: string | null; unidades: number | null; unidades_recibidas: number | null }>): RemesaPlan {
  const porSkuDeRemesa = new Map<string, { unidades: number; recibidas: number | null }>()
  for (const l of lineas) {
    const sku = (l.sku ?? '').trim()
    if (!sku) continue
    const x = porSkuDeRemesa.get(sku) ?? { unidades: 0, recibidas: null }
    x.unidades += Math.max(0, entero(l.unidades))
    if (l.unidades_recibidas !== null && l.unidades_recibidas !== undefined) x.recibidas = (x.recibidas ?? 0) + Math.max(0, entero(l.unidades_recibidas))
    porSkuDeRemesa.set(sku, x)
  }
  const ls = [...porSkuDeRemesa.entries()].map(([sku, x]) => ({ sku, unidades: x.unidades, recibidas: x.recibidas }))
  return {
    id: r.id,
    nombre: r.nombre,
    estado: r.estado,
    estadoAmazon: r.estado_amazon,
    marketplaceId: r.marketplace_id,
    referenciaEnvio: r.referencia_envio,
    fechaEnvio: r.fecha_envio ? r.fecha_envio.slice(0, 10) : null,
    llegadaAt: r.llegada_at,
    unidades: r.unidades_totales ?? ls.reduce((t, l) => t + l.unidades, 0),
    recibidas: r.recibidas_totales ?? ls.reduce((t, l) => t + (l.recibidas ?? 0), 0),
    lineas: ls,
  }
}

/** Fila de `fba_catalogo` (solo lo que usa el plan) */
export function catalogoDesdeFila(f: Record<string, unknown>): CatalogoPlan {
  return {
    fbasku: textoONulo(f.fbasku),
    ref: textoONulo(f.ref),
    nombre: textoONulo(f.nombre),
    talla: textoONulo(f.talla),
    continuidad: typeof f.continuidad === 'boolean' ? f.continuidad : null,
    precio: numeroONulo(f.precio),
  }
}

/** Fila de `fba_alertas_config` (267 + 291). Sin fila = null (todo medido o de partida) */
export function configAlertasDesdeFila(f: Record<string, unknown> | null | undefined): ConfigAlertasPlan | null {
  if (!f) return null
  const etapa = (v: unknown) => { const n = numeroONulo(v); return n === null ? null : Math.max(0, Math.round(n)) }
  return {
    diasPreparacion: etapa(f.dias_preparacion),
    diasTransporte: etapa(f.dias_transporte),
    diasRecepcion: etapa(f.dias_recepcion),
    diasMargen: etapa(f.margen_dias),
    total: etapa(f.plazo_reposicion_dias),
  }
}

/* ------------------------------------------------------------------ */
/* Constantes                                                          */
/* ------------------------------------------------------------------ */

/** Libro más atrasado que esto: el plan sale provisional (§1.1) */
export const DIAS_ATRASO_PROVISIONAL = 7
/** Estados de Amazon en los que un envío ya no viene de camino */
export const ESTADOS_AMAZON_MUERTOS = ['CLOSED', 'CANCELLED', 'DELETED', 'ERROR']
export { ESTADOS_AMAZON_RECIBIENDO }
/** Motivos que no son «rotura» (no cuentan en roturas ni en la primera rotura) */
/** Merma por encima de esto (sobre lo vendido) sale en la calidad (D12) */
const MERMA_AVISO = 0.05
/** Ventas en 90 días por debajo de las que el % de merma no se calcula */
const MIN_VENTAS_MERMA = 30
/** Días reales mínimos para medir el acierto */
const DIAS_MINIMOS_ACIERTO = 14

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

const entero = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : Number.isFinite(Number(n)) && n !== null && n !== '' ? Math.round(Number(n)) : 0)
const minFecha = (a: string | null, b: string | null): string | null => (a === null ? b : b === null ? a : a <= b ? a : b)
const maxFecha = (a: string, b: string): string => (a >= b ? a : b)

function mediana(v: number[]): number | null {
  if (v.length === 0) return null
  const o = [...v].sort((a, b) => a - b)
  const m = Math.floor(o.length / 2)
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2
}

function porSku<T extends { sku: string }>(filas: readonly T[]): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const f of filas) {
    const lista = m.get(f.sku)
    if (lista) lista.push(f)
    else m.set(f.sku, [f])
  }
  return m
}

/** La moneda del cliente: la más repetida en los listings del mercado de la lectura; si no, la de la región */
function monedaDelCliente(listings: readonly ListingPlan[], mercado: string | null, region: EntradaPlanCliente['region']): string {
  const cuenta = new Map<string, number>()
  for (const l of listings) {
    if (l.marketplaceId !== mercado || !l.moneda) continue
    cuenta.set(l.moneda, (cuenta.get(l.moneda) ?? 0) + 1)
  }
  const top = [...cuenta.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
  if (top) return top[0].toUpperCase()
  if (mercado === 'ATVPDKIKX0DER' || region === 'na') return 'USD'
  return 'EUR'
}

function estadoDelLibro(lectura: EntradaPlanCliente['lectura'], libro: readonly MovimientoDiario[], leidoDesde: string | null): Libro {
  if (!lectura || !lectura.leidoHasta || libro.length === 0) return 'sin_leer'
  if (!leidoDesde || diasEntre(leidoDesde, lectura.leidoHasta) < 90) return 'corto'
  return 'ok'
}

/* ------------------------------------------------------------------ */
/* Medidas del cliente                                                 */
/* ------------------------------------------------------------------ */

const ENVIADA_O_CERRADA = ['enviada', 'cerrada']

export function medidasDelCliente(remesas: readonly RemesaPlan[], receipts: EntradaPlanCliente['receipts'], hoy: string): MedidasCliente {
  const porReferencia = new Map<string, Array<{ fecha: string; cantidad: number }>>()
  for (const r of receipts) {
    if (!r.referencia) continue
    const lista = porReferencia.get(r.referencia) ?? []
    lista.push({ fecha: r.fecha.slice(0, 10), cantidad: Number(r.cantidad) || 0 })
    porReferencia.set(r.referencia, lista)
  }
  const enviadas = remesas.filter((r) => ENVIADA_O_CERRADA.includes(r.estado) && r.fechaEnvio)
  const conRecibos = enviadas
    .map((r) => {
      const recibos = r.referenciaEnvio ? (porReferencia.get(r.referenciaEnvio) ?? []).filter((x) => x.cantidad > 0) : []
      const primer = recibos.reduce<string | null>((m, x) => minFecha(m, x.fecha), null)
      return { r, recibos, primer }
    })
  const transporte = medirTransporte(conRecibos.map((x) => ({ fechaEnvio: x.r.fechaEnvio!.slice(0, 10), primerReceipt: x.primer })))
  const recepcion = medirRecepcion(conRecibos.filter((x) => x.recibos.length > 0).map((x) => ({ enviadas: x.r.unidades, receipts: x.recibos })), hoy)
  const enviosMedidos = Math.min(6, conRecibos.filter((x) => x.primer && x.primer >= x.r.fechaEnvio!.slice(0, 10)).length)
  const cad = medirCadencia(enviadas.map((r) => ({ fechaEnvio: r.fechaEnvio!.slice(0, 10), unidades: r.unidades })))
  return { transporteMediano: transporte, recepcionP75: recepcion, enviosMedidos, cadenciaDias: cad.cadenciaDias, tamanoTipico: cad.tamanoTipico }
}

/* ------------------------------------------------------------------ */
/* Stock por referencia                                                */
/* ------------------------------------------------------------------ */

function filasDeStock(listings: readonly ListingPlan[], mercado: string): FilaStock[] {
  const filas: FilaStock[] = []
  for (const l of listings) {
    const propia = l.marketplaceId === mercado
    const conStock = (l.fbaQuantity ?? 0) > 0 || (l.vendibles ?? 0) > 0
    // De otros mercados solo cuentan las filas con stock (D11); del propio, todas las que sean FBA
    if (!propia && !conStock) continue
    if (propia && l.vendibles === null && l.fbaQuantity === null && (l.entrante ?? 0) <= 0) continue
    filas.push({
      marketplaceId: l.marketplaceId, sku: l.sku,
      vendibles: Math.max(0, entero(l.vendibles)), entrante: Math.max(0, entero(l.entrante)),
      reservadas: l.reservadas === null ? null : Math.max(0, entero(l.reservadas)),
      noApto: l.noApto === null ? null : Math.max(0, entero(l.noApto)),
      precio: l.precio, moneda: l.moneda, listingStatus: l.listingStatus, updatedAt: l.updatedAt,
    })
  }
  return filas
}

/**
 * El estado del listing de una referencia, unido entre todas sus filas de la conexión con dato reciente (D11: el stock puede
 * venir de otro mercado y el estado de ese mercado no ser el bueno). Comprable si alguna trae BUYABLE; `[]` y null son «sin dato».
 * null = ninguna fila reciente informa (no se afirma nada).
 */
export function estadoListingDeSku(filas: readonly Pick<ListingPlan, 'listingStatus' | 'updatedAt'>[], hoy: string): string[] | null {
  const desde = sumarDias(hoy, -DIAS_ESTADO_RECIENTE)
  // Las filas recientes mandan; solo si no hay ninguna se mira lo que haya (fixtures y conexiones sin refrescar)
  const recientes = filas.filter((f) => !f.updatedAt || f.updatedAt.slice(0, 10) >= desde)
  const validas = (recientes.length > 0 ? recientes : filas).filter((f) => Array.isArray(f.listingStatus) && f.listingStatus.length > 0)
  if (validas.length === 0) return null
  if (validas.some((f) => f.listingStatus!.includes('BUYABLE'))) return ['BUYABLE']
  return [...new Set(validas.flatMap((f) => f.listingStatus!))]
}
const DIAS_ESTADO_RECIENTE = 7

/**
 * La fila de listing de la que salen nombre, ASIN, FNSKU y activo_manual de una referencia: la del mercado del que sale su stock,
 * la del mercado de la lectura, la del mercado de los listings (predeterminado de la conexión) y, si no, la más reciente.
 * Antes se cogía la primera que hubiera: un agotado sin fila en el mercado de la lectura salía sin nombre ni FNSKU.
 */
export function listingDeFicha(
  filas: readonly ListingPlan[],
  mercadoStock: string | null | undefined,
  mercado: string,
  mercadoListings: string | null | undefined,
): ListingPlan | null {
  if (filas.length === 0) return null
  const orden: ListingPlan[] = []
  for (const m of [mercadoStock, mercado, mercadoListings]) {
    if (!m) continue
    const f = filas.find((l) => l.marketplaceId === m)
    if (f && !orden.includes(f)) orden.push(f)
  }
  for (const f of [...filas].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))) if (!orden.includes(f)) orden.push(f)
  // Lo que falte en la elegida (la de IT de Yo By Yolanda no trae título) se completa con la siguiente que lo tenga
  const primero = <K extends 'asin' | 'fnsku' | 'titulo'>(k: K): ListingPlan[K] => orden.find((f) => f[k])?.[k] ?? orden[0][k]
  return { ...orden[0], asin: primero('asin'), fnsku: primero('fnsku'), titulo: primero('titulo') }
}

/** El precio en la moneda del cliente: el de la fila elegida, o el de cualquier mercado en esa moneda (el de la lectura primero) */
function precioDe(sku: string, elegida: StockElegido | undefined, listings: Map<string, ListingPlan[]>, mercado: string, moneda: string, catalogo: CatalogoPlan | null, mercadoListings: string | null = null): number | null {
  const valido = (p: number | null | undefined) => (typeof p === 'number' && Number.isFinite(p) && p > 0 ? p : null)
  if (elegida && (elegida.moneda ?? '').toUpperCase() === moneda && valido(elegida.precio)) return valido(elegida.precio)
  const candidatas = (listings.get(sku) ?? [])
    .filter((l) => (l.moneda ?? '').toUpperCase() === moneda && valido(l.precio))
    .sort((a, b) => Number(b.marketplaceId === mercado) - Number(a.marketplaceId === mercado)
      || Number(b.marketplaceId === mercadoListings) - Number(a.marketplaceId === mercadoListings)
      || (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
  if (candidatas[0]) return valido(candidatas[0].precio)
  return moneda === 'EUR' ? valido(catalogo?.precio ?? null) : null
}

/* ------------------------------------------------------------------ */
/* Estadísticas del libro por referencia                               */
/* ------------------------------------------------------------------ */

interface EstadisticasSku {
  ultimaVenta: string | null
  ventas90: number
  devueltas90: number
  ventas180: number
  /** Ventas de los 365 días hasta la lectura, por día (para el perfil semanal) */
  anoPorDia: Array<{ fecha: string; unidades: number }>
  receipts: Array<{ fecha: string; cantidad: number }>
}

function estadisticasDe(movs: readonly MovimientoDiario[], leidoHasta: string | null): EstadisticasSku {
  const e: EstadisticasSku = { ultimaVenta: null, ventas90: 0, devueltas90: 0, ventas180: 0, anoPorDia: [], receipts: [] }
  if (!leidoHasta) return e
  const d90 = sumarDias(leidoHasta, -89)
  const d180 = sumarDias(leidoHasta, -179)
  const d365 = sumarDias(leidoHasta, -364)
  const ano = new Map<string, number>()
  for (const m of movs) {
    if (m.fecha > leidoHasta) continue
    const c = Number(m.cantidad) || 0
    if (m.tipo === 'Shipments') {
      const u = Math.abs(c)
      if (!u) continue
      if (!e.ultimaVenta || m.fecha > e.ultimaVenta) e.ultimaVenta = m.fecha
      if (m.fecha >= d90) e.ventas90 += u
      if (m.fecha >= d180) e.ventas180 += u
      if (m.fecha >= d365) ano.set(m.fecha, (ano.get(m.fecha) ?? 0) + u)
    } else if (m.tipo === 'CustomerReturns') {
      if (m.fecha >= d90) e.devueltas90 += Math.abs(c)
    } else if (m.tipo === 'Receipts' && c > 0) {
      e.receipts.push({ fecha: m.fecha, cantidad: c })
    }
  }
  e.anoPorDia = [...ano.entries()].map(([fecha, unidades]) => ({ fecha, unidades }))
  return e
}

/**
 * % del stock vendible con más de 180 días, estimado por FIFO (lo que queda es lo último que llegó). Lo que no explican las
 * entradas del libro llegó antes de que empezara: cuenta como viejo. Solo con el libro completo; si no, null.
 */
function pctMasDe180Fifo(vendibles: number, receipts: EstadisticasSku['receipts'], leidoHasta: string | null, libro: Libro): number | null {
  if (vendibles <= 0 || !leidoHasta || libro !== 'ok') return null
  const limite = sumarDias(leidoHasta, -180)
  let queda = vendibles
  let viejo = 0
  for (const r of [...receipts].sort((a, b) => b.fecha.localeCompare(a.fecha))) {
    if (queda <= 0) break
    const toma = Math.min(queda, r.cantidad)
    if (r.fecha < limite) viejo += toma
    queda -= toma
  }
  viejo += Math.max(0, queda)
  return Math.round((viejo / vendibles) * 1000) / 1000
}

/* ------------------------------------------------------------------ */
/* planificarCliente                                                   */
/* ------------------------------------------------------------------ */

export interface ResultadoPlanCliente {
  plan: PlanCliente
  /** Las entradas por SKU (para recalcular un ajuste de la IA o la proyección de una línea) */
  entradas: Map<string, EntradaSku>
  /** Plazo por SKU cuando lo hay (si no, el del cliente) */
  plazoDeSku: (sku: string) => PlazoEtapas
  /** Para el resumen de la pasada: el ritmo previsto de cada SKU con ritmo (acierto dentro de 30 días) */
  previstos: Record<string, number>
  movimientos90: number
}

export function planificarCliente(entrada: EntradaPlanCliente): ResultadoPlanCliente {
  const { hoy, clienteId } = entrada
  const mercado = entrada.lectura?.marketplaceId ?? MERCADO_ESPANA
  const leidoHasta = entrada.lectura?.leidoHasta ?? null
  const libroDesde = entrada.libro.reduce<string | null>((m, x) => minFecha(m, x.fecha), null)
  const leidoDesde = minFecha(entrada.lectura?.leidoDesde ?? null, libroDesde) ?? null
  const libro = estadoDelLibro(entrada.lectura, entrada.libro, leidoDesde)
  const diasAtraso = leidoHasta ? Math.max(0, diasEntre(leidoHasta, hoy)) : null
  // Sin libro el plan no es «provisional»: no hay plan (la calidad ya dice que no se ha leído)
  const provisional = libro !== 'sin_leer' && diasAtraso !== null && diasAtraso > DIAS_ATRASO_PROVISIONAL
  // Sin listings en el mercado de la lectura, la moneda sale de donde están (Creative Toys: libro en IT, listings en ES)
  const moneda = monedaDelCliente(entrada.listings, entrada.listings.some((l) => l.marketplaceId === mercado) ? mercado : (entrada.mercadoListings ?? mercado), entrada.region)

  /* ---------- medidas, ajustes y plazo ---------- */
  const medidas = medidasDelCliente(entrada.remesas, entrada.receipts, hoy)
  const ajustes: AjustesReposicion = ajustesDesdeFila(entrada.configReposicion, medidas)
  const plazo = plazoDelCliente(entrada.configAlertas, medidas, hoy, ajustes)
  const plazosSku = new Map<string, PlazoEtapas>()
  const plazoDeSku = (sku: string): PlazoEtapas => {
    const p = entrada.plazosSku[sku]
    if (!(p > 0)) return plazo
    let x = plazosSku.get(sku)
    if (!x) {
      x = plazoDelCliente(entrada.configAlertas, medidas, hoy, ajustes, p)
      plazosSku.set(sku, x)
    }
    return x
  }

  /* ---------- stock ---------- */
  const listingsPorSku = porSku(entrada.listings)
  const stock = stockEntreMercados(filasDeStock(entrada.listings, mercado), mercado, hoy)
  const hayBuyable = entrada.hayBuyableEnCliente
    ?? entrada.listings.some((l) => (l.marketplaceId === mercado || l.marketplaceId === entrada.mercadoListings) && (l.listingStatus ?? []).includes('BUYABLE'))

  /* ---------- catálogo y modelos ---------- */
  const catalogoPorSku = new Map<string, CatalogoPlan>()
  for (const c of entrada.catalogo) if (c.fbasku && c.fbasku.trim()) catalogoPorSku.set(c.fbasku.trim(), c)
  const patrones = patronesDeCliente(entrada.clienteNombre)
  const reposicionPorSku = new Map(entrada.reposicionSku.map((r) => [r.sku, r] as const))

  /* ---------- remesas: camino, cajas y mercado ---------- */
  const caminoPorSku = new Map<string, Array<{ remesaId: string; nombre: string | null; fechaEnvio: string | null; estadoAmazon: string | null; pendiente: number; recibidas: number; enRecepcion: boolean }>>()
  const cantidadesPorSku = new Map<string, Array<{ fecha: string; unidades: number }>>()
  const enCaminoRemesas: RemesaPlan[] = []
  for (const r of entrada.remesas) {
    const estadoAmazon = (r.estadoAmazon ?? '').toUpperCase()
    if (ENVIADA_O_CERRADA.includes(r.estado) && r.fechaEnvio) {
      for (const l of r.lineas) {
        if (!(l.unidades > 0)) continue
        const lista = cantidadesPorSku.get(l.sku) ?? []
        lista.push({ fecha: r.fechaEnvio.slice(0, 10), unidades: l.unidades })
        cantidadesPorSku.set(l.sku, lista)
      }
    }
    if (r.estado !== 'enviada' || ESTADOS_AMAZON_MUERTOS.includes(estadoAmazon)) continue
    // Recibida entera: ya no está de camino (misma regla que el Resumen: unidades > recibidas, o sin unidades contadas)
    if (entero(r.unidades) > 0 && Math.max(0, entero(r.recibidas)) >= entero(r.unidades)) continue
    enCaminoRemesas.push(r)
    for (const l of r.lineas) {
      const pendiente = Math.max(0, entero(l.unidades) - Math.max(0, entero(l.recibidas)))
      if (pendiente <= 0) continue
      const lista = caminoPorSku.get(l.sku) ?? []
      lista.push({
        remesaId: r.id, nombre: r.nombre, fechaEnvio: r.fechaEnvio ? r.fechaEnvio.slice(0, 10) : null, estadoAmazon: r.estadoAmazon,
        pendiente, recibidas: Math.max(0, entero(r.recibidas)), enRecepcion: ESTADOS_AMAZON_RECIBIENDO.includes(estadoAmazon),
      })
      caminoPorSku.set(l.sku, lista)
    }
  }
  const ultimaEnviada = [...entrada.remesas]
    .filter((r) => ENVIADA_O_CERRADA.includes(r.estado) && r.fechaEnvio && r.marketplaceId)
    .sort((a, b) => (b.fechaEnvio ?? '').localeCompare(a.fechaEnvio ?? ''))[0]
  const mercadoRemesa = mercadoDeRemesa(ultimaEnviada?.marketplaceId ?? null, entrada.region)

  const habladosPorSku = new Map<string, EnvioHablado[]>()
  for (const h of entrada.hablados) {
    for (const l of h.lineas) {
      if (!(l.cantidad > 0)) continue
      const lista = habladosPorSku.get(l.sku) ?? []
      lista.push({ envioPropuestoId: h.envioPropuestoId, salirAntesDe: h.salirAntesDe, unidades: l.cantidad })
      habladosPorSku.set(l.sku, lista)
    }
  }
  const cuarentena = new Map<string, { prioridad: Prioridad; cuando: string }>()
  for (const d of entrada.descartes) {
    for (const sku of d.skus) {
      const previo = cuarentena.get(sku)
      // La prioridad de la línea de esa referencia, no la del envío (que es la de su línea más urgente)
      const prioridad = d.prioridadPorSku?.[sku] ?? d.prioridad
      if (!previo || d.estadoCambiadoAt > previo.cuando) cuarentena.set(sku, { prioridad, cuando: d.estadoCambiadoAt })
    }
  }

  /* ---------- universo de referencias ---------- */
  const movsPorSku = porSku(entrada.libro)
  const universo = new Set<string>()
  for (const [sku, s] of stock) if (s.vendibles > 0 || s.entrante > 0) universo.add(sku)
  for (const sku of movsPorSku.keys()) universo.add(sku)
  for (const sku of caminoPorSku.keys()) universo.add(sku)
  for (const sku of entrada.comprometido.keys()) universo.add(sku)
  for (const sku of habladosPorSku.keys()) universo.add(sku)
  const skus = [...universo].filter((s) => s && s.trim()).sort()

  /* ---------- series, estadísticas y perfiles ---------- */
  const centinela: MovimientoDiario[] = libroDesde ? [{ sku: '\u0000inicio', fecha: libroDesde, tipo: '_', disposicion: null, cantidad: 0 }] : []
  const libroAnual = !!leidoHasta && !!libroDesde && diasEntre(libroDesde, leidoHasta) >= 364
  const series = new Map<string, SerieSku>()
  const estad = new Map<string, EstadisticasSku>()
  const perfiles = new Map<string, { perfil: number[]; pico: number }>()
  // A6.3: el día de la lectura, si es HOY, va a medias (la pasada lee a primera hora): el ritmo se calcula hasta AYER. El stock no se descuadra:
  // serieDiaria estima lo vendido desde el último día leído (el «atraso»). Antes, 2 ventas de 9 horas contaban como un día entero y r14 bajaba hasta un 7 %
  const fechaSerie = leidoHasta && leidoHasta >= hoy ? sumarDias(hoy, -1) : (leidoHasta ?? hoy)
  // Días sin stock del año (para que el perfil no lea «no vendió» donde no había qué vender) y si el SKU tiene el año entero
  const sinStockAno = new Map<string, Set<string>>()
  const anoCompleto = new Set<string>()
  const inicioAno = leidoHasta ? sumarDias(leidoHasta, -364) : null
  for (const sku of skus) {
    const movs = movsPorSku.get(sku) ?? []
    const v = stock.get(sku)?.vendibles ?? 0
    const serie = serieDiaria([...centinela, ...movs], sku, v, fechaSerie, hoy, 365)
    series.set(sku, serie)
    const e = estadisticasDe(movs, leidoHasta)
    estad.set(sku, e)
    if (libroAnual && inicioAno && leidoHasta) {
      const sinStock = new Set<string>()
      let conLibro = 0
      let conStock = 0
      let stockAlEmpezar: boolean | null = null
      for (let i = 0; i < serie.fechas.length; i++) {
        const f = serie.fechas[i]
        if (f < inicioAno || f > leidoHasta) continue
        const c = serie.conStock[i]
        if (c === null) continue
        if (stockAlEmpezar === null) stockAlEmpezar = serie.fiable ? c : null
        conLibro++
        if (c) conStock++
        else sinStock.add(f)
      }
      // Lo que no cubre la serie (antes de su primer día) cuenta como sin dato, no como sin stock
      const primerMov = primeraActividadDe(movs, sku)
      const nacioAntes = (primerMov !== null && primerMov <= sumarDias(inicioAno, 14)) || stockAlEmpezar === true
      const mayorParte = conLibro > 0 && conStock / conLibro >= 0.5
      sinStockAno.set(sku, sinStock)
      if (nacioAntes && mayorParte) {
        anoCompleto.add(sku)
        const p = perfilSemanal(e.anoPorDia, { diasSinStock: sinStock })
        if (p) perfiles.set(sku, p)
      }
    }
  }
  // El del cliente, solo con los SKU que tienen el año entero (los nuevos le meterían su «no existía» como temporada baja)
  const perfilCliente = libroAnual
    ? perfilDelCliente([...perfiles.entries()].map(([sku, p]) => ({ perfil: p.perfil, peso: estad.get(sku)!.anoPorDia.reduce((s, d) => s + d.unidades, 0) })))
    : null
  const picoDe = (perfil: number[] | null): number | null => {
    if (!perfil) return null
    let max = 0
    for (let w = 1; w <= 52; w++) max = Math.max(max, perfil[w] ?? 0)
    return Math.round(max * 100) / 100
  }

  /* ---------- modelo y talla ---------- */
  const modeloDe = new Map<string, { modelo: string; talla: string; continuidad: boolean; enCatalogo: boolean }>()
  for (const sku of skus) {
    const c = catalogoPorSku.get(sku)
    if (c && c.ref) {
      const modelo = [c.ref, c.nombre].filter(Boolean).join(' ').trim()
      modeloDe.set(sku, { modelo, talla: (c.talla ?? '').trim() || sku, continuidad: c.continuidad !== false, enCatalogo: true })
      continue
    }
    const m = modeloDesdeSku(sku, patrones)
    if (m) modeloDe.set(sku, { modelo: m.modelo, talla: m.talla, continuidad: true, enCatalogo: false })
  }

  /* ---------- ritmos ---------- */
  const horizonte: [string, string] = [hoy, sumarDias(hoy, plazo.hastaLaVenta + ajustes.coberturaObjetivo)]
  const ritmos = new Map<string, RitmoSku>()
  const dym = new Map<string, { devolucionesVendibles90: number; mermas90: number; mermasRecurrentes90: number }>()
  const primeras = new Map<string, string | null>()
  for (const sku of skus) {
    const movs = movsPorSku.get(sku) ?? []
    dym.set(sku, leidoHasta ? devolucionesYMermas(movs, sku, leidoHasta) : { devolucionesVendibles90: 0, mermas90: 0, mermasRecurrentes90: 0 })
    primeras.set(sku, primeraEntradaDe(movs, sku))
  }
  const perfilDeSku = (sku: string): { perfil: number[] | null; origen: 'sku' | 'cliente' | 'modelo' | null; pico: number | null } => {
    const p = perfiles.get(sku)
    if (p) return { perfil: p.perfil, origen: 'sku', pico: p.pico }
    if (perfilCliente) return { perfil: perfilCliente, origen: 'cliente', pico: picoDe(perfilCliente) }
    return { perfil: null, origen: null, pico: null }
  }

  // Modelos (con al menos una talla)
  const grupos = new Map<string, string[]>()
  for (const [sku, m] of modeloDe) {
    const g = grupos.get(m.modelo) ?? []
    g.push(sku)
    grupos.set(m.modelo, g)
  }
  for (const [modelo, tallas] of grupos) {
    // Perfil del modelo: sus tallas juntas; si no llega, el del cliente
    let perfilModelo: { perfil: number[] | null; origen: 'sku' | 'cliente' | 'modelo' | null; pico: number | null } = { perfil: null, origen: null, pico: null }
    if (libroAnual) {
      // Solo las tallas con el año entero; un día cuenta sin stock si lo estaba en todas ellas
      const completas = tallas.filter((sku) => anoCompleto.has(sku))
      const suma = new Map<string, number>()
      for (const sku of completas) for (const d of estad.get(sku)!.anoPorDia) suma.set(d.fecha, (suma.get(d.fecha) ?? 0) + d.unidades)
      const conjuntos = completas.map((sku) => sinStockAno.get(sku) ?? new Set<string>())
      const sinStockModelo: string[] = conjuntos.length === 0 ? [] : [...conjuntos[0]].filter((f) => conjuntos.every((c) => c.has(f)))
      const p = completas.length > 0
        ? perfilSemanal([...suma.entries()].map(([fecha, unidades]) => ({ fecha, unidades })), { diasSinStock: sinStockModelo })
        : null
      if (p) perfilModelo = { perfil: p.perfil, origen: 'modelo', pico: p.pico }
      else if (perfilCliente) perfilModelo = { perfil: perfilCliente, origen: 'cliente', pico: picoDe(perfilCliente) }
    }
    const porSkuOpciones: Record<string, { primeraEntrada: string | null; devolucionesVendibles90: number; mermas90: number; mermasRecurrentes90: number }> = {}
    for (const sku of tallas) porSkuOpciones[sku] = { primeraEntrada: primeras.get(sku) ?? null, ...dym.get(sku)! }
    const r = ritmoPorModelo(
      tallas.map((sku) => ({ sku, serie: series.get(sku)!, continuidad: modeloDe.get(sku)!.continuidad, ventas180: estad.get(sku)!.ventas180 })),
      {
        modelo,
        comun: { perfil: perfilModelo.perfil, origenPerfil: perfilModelo.origen, picoAnoPasado: perfilModelo.pico, topeEstacional: ajustes.topeEstacional, horizonte, libro },
        porSku: porSkuOpciones,
      },
    )
    for (const [sku, ritmo] of r) ritmos.set(sku, ritmo)
  }
  for (const sku of skus) {
    if (ritmos.has(sku)) continue
    const p = perfilDeSku(sku)
    ritmos.set(sku, ritmoRobusto(series.get(sku)!, {
      primeraEntrada: primeras.get(sku) ?? null, perfil: p.perfil, origenPerfil: p.origen, picoAnoPasado: p.pico,
      topeEstacional: ajustes.topeEstacional, horizonte, libro, ...dym.get(sku)!,
    }))
  }

  /* ---------- entradas y líneas ---------- */
  const entradas = new Map<string, EntradaSku>()
  const lineasBrutas: LineaPlan[] = []
  for (const sku of skus) {
    const s = stock.get(sku)
    const listing = listingDeFicha(listingsPorSku.get(sku) ?? [], s?.marketplaceId, mercado, entrada.mercadoListings ?? null)
    const vendibles = s?.vendibles ?? 0
    const entranteAmazon = s?.entrante ?? 0
    const plazoSku = plazoDeSku(sku)
    const ll = llegadasDeSku({
      sku, hoy, plazo: plazoSku,
      caminoErp: caminoPorSku.get(sku) ?? [],
      entranteAmazon,
      comprometido: entrada.comprometido.get(sku) ?? [],
      hablados: habladosPorSku.get(sku) ?? [],
      transporteMediano: medidas.transporteMediano,
    })
    const e = estad.get(sku)!
    const m = modeloDe.get(sku) ?? null
    const cat = catalogoPorSku.get(sku) ?? null
    const rep = reposicionPorSku.get(sku) ?? null
    const ritmo = ritmos.get(sku)!
    const cantidades = (cantidadesPorSku.get(sku) ?? []).sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 6).map((x) => x.unidades)
    const cuarent = cuarentena.get(sku)
    const comprable = !esNoComprable({
      vendibles,
      listingStatus: estadoListingDeSku(listingsPorSku.get(sku) ?? [], hoy),
      hayBuyableEnCliente: hayBuyable,
      suprimido: false,
      activoManual: listing?.activoManual ?? null,
    })
    const pctAmazon = entrada.edadAmazon?.[sku]
    const ent: EntradaSku = {
      sku,
      asin: listing?.asin ?? null,
      fnsku: listing?.fnsku ?? null,
      nombre: listing?.titulo ?? (cat ? [cat.ref, cat.nombre, cat.talla].filter(Boolean).join(' ') : null),
      modelo: m?.modelo ?? null,
      talla: m?.talla ?? null,
      precio: precioDe(sku, s, listingsPorSku, mercado, moneda, cat, entrada.mercadoListings ?? null),
      moneda,
      vendibles,
      reservadas: s?.reservadas ?? null,
      entranteAmazon,
      llegadas: ll.llegadas,
      llegadasDescartadas: ll.descartadas,
      ritmo,
      comprable,
      descatalogada: m?.continuidad === false || cat?.continuidad === false,
      excluida: rep?.excluir ? { motivo: rep.motivo ?? 'excluida a mano' } : null,
      cajaSku: rep?.unidadesCaja ?? null,
      cajaDeducida: cajaDeducida(cantidades),
      coberturaSku: rep?.coberturaDias ?? null,
      diasSinVenta: vendibles > 0 && leidoHasta ? (e.ultimaVenta ? diasEntre(e.ultimaVenta, leidoHasta) : (libroDesde ? diasEntre(libroDesde, leidoHasta) : null)) : null,
      pctMasDe180: typeof pctAmazon === 'number' && Number.isFinite(pctAmazon) ? pctAmazon : pctMasDe180Fifo(vendibles, e.receipts, leidoHasta, libro),
      tasaDevolucion90: e.ventas90 > 0 ? Math.round((e.devueltas90 / e.ventas90) * 1000) / 1000 : null,
      ventas90: ritmo.ventas90,
      enCuarentena: cuarent ? { prioridad: cuarent.prioridad } : null,
      provisional,
      stockViejoDias: s?.deOtroMercado && s.viejoDias !== null ? s.viejoDias : null,
      almacenCliente: null,
    }
    entradas.set(sku, ent)
    lineasBrutas.push(planificarSku(ent, hoy, plazoSku, ajustes, medidas))
  }

  const lineasModelo = ajustarPorModelo(lineasBrutas, ajustes)

  /* ---------- envíos ---------- */
  const ocupado = lineasModelo.reduce((t, l) => t + l.vendibles + (l.reservadas ?? 0) + l.deCamino + l.comprometido, 0)
  const recalcular = (l: LineaPlan, nuevaSalida: string): LineaPlan => {
    const e = entradas.get(l.sku)
    if (!e) return l
    return recalcularConLlegada(l, e, nuevaSalida, { hoy, plazo: plazoDeSku(l.sku), ajustes, medidas })
  }
  const apartadas = new Map<string, string>()
  const envios: EnvioPropuestoCalculado[] = libro === 'sin_leer' || !ajustes.activo
    ? []
    : agruparEnvios(lineasModelo, clienteId, entrada.connectionId, hoy, ajustes, plazo, recalcular, ocupado, (ls) => ajustarPorModelo(ls, ajustes), apartadas)

  // Las líneas que salen en un envío se enseñan como van en él (recalculadas, adelantadas o recortadas)
  const enEnvio = new Map<string, LineaPlan>()
  for (const env of envios) for (const l of env.lineas) enEnvio.set(l.sku, l)
  const lineas = lineasModelo.map((l) => {
    const e = enEnvio.get(l.sku)
    if (e) return e
    // El agrupador la ha dejado fuera (envío pequeño sin prisa, o no hace falta con la salida anterior): sale en la previsión
    const apartada = apartadas.get(l.sku)
    if (apartada && l.fuera === null) {
      const sinMandar = l.porque.replace(/ ?Mandando [\d.,]+ ud antes del [^.]*\./, '')
      return { ...l, fuera: 'aun_no_toca' as const, cantidad: 0, cajas: null, porque: `${sinMandar} ${apartada}`.trim() }
    }
    // Propuesta que no ha entrado en ningún envío (capacidad): no lleva cantidad
    if (l.fuera === null && l.cantidad > 0 && envios.length > 0 && l.prioridad !== 'mas_adelante') {
      return { ...l, cantidad: 0, cajas: null, avisos: l.avisos.includes('recortada_capacidad') ? l.avisos : [...l.avisos, 'recortada_capacidad' as const] }
    }
    return l
  })

  /* ---------- envíos de camino ---------- */
  const enCamino: EnCamino[] = enCaminoRemesas.map((r) => {
    const fechaEnvio = r.fechaEnvio ? r.fechaEnvio.slice(0, 10) : null
    const recibidas = Math.max(0, entero(r.recibidas))
    // La misma regla que «Hoy» y el Resumen global (llegadas.ts): no puede haber una pantalla que diga otra cosa
    const llegadaPrevista = llegadaPrevistaDeCamino({ estadoAmazon: r.estadoAmazon, fechaEnvio }, hoy, plazo)
    return {
      remesaId: r.id, nombre: r.nombre ?? 'Envío', referenciaEnvio: r.referenciaEnvio, estadoAmazon: r.estadoAmazon,
      fechaEnvio, llegadaPrevista, unidades: Math.max(0, entero(r.unidades)), recibidas,
      dudoso: caminoEsDudoso({ fechaEnvio, recibidas }, hoy, medidas.transporteMediano, plazo.transporte),
    }
  }).sort((a, b) => (a.llegadaPrevista ?? '').localeCompare(b.llegadaPrevista ?? '') || a.remesaId.localeCompare(b.remesaId))

  /* ---------- resumen ---------- */
  // Una sola regla para la cifra y para el filtro de Reposición (D4 · D30): la rotura que decide, no el hueco inevitable
  const conRotura = lineas.filter(cuentaParaRotura)
  const fuera: Partial<Record<MotivoFuera, number>> = {}
  for (const l of lineas) if (l.fuera) fuera[l.fuera] = (fuera[l.fuera] ?? 0) + 1
  // A6.4: la mediana solo con las referencias que cuentan para el plan (no descatalogadas, agotadas de hace tiempo ni tallas sin ventas) y CON lo que viene,
  // como dice su ayuda. Antes ShoesF daba 0 días porque 169 de 211 valores eran 0
  const coberturas = lineas
    .filter((l) => cuentaParaRotura(l) && (l.ritmo.base ?? 0) > 0)
    .map((l) => l.coberturaConLoQueViene ?? l.coberturaDias)
    .filter((x): x is number => x !== null && Number.isFinite(x))
  const resumen: ResumenPlan = {
    referencias: lineas.length,
    conPropuesta: enEnvio.size,
    fuera,
    roturas14: conRotura.filter((l) => rompeEn(l, hoy, 14)).length,
    roturas30: conRotura.filter((l) => rompeEn(l, hoy, 30)).length,
    eurosEnRiesgo: Math.round(envios.reduce((t, e) => t + (e.eurosEnRiesgo ?? 0), 0)),
    moneda,
    unidadesPropuestas: envios.reduce((t, e) => t + e.unidades, 0),
    primeraRotura: conRotura.reduce<string | null>((m, l) => minFecha(m, roturaDeLinea(l)), null),
    coberturaMediana: (() => { const m = mediana(coberturas); return m === null ? null : Math.round(m * 10) / 10 })(),
    agotadosConVentas: lineas.filter((l) => l.vendibles <= 0 && (l.ritmo.ventas30 ?? 0) > 0 && l.fuera !== 'descatalogada' && l.fuera !== 'no_comprable').length,
    vendibles: lineas.reduce((t, l) => t + l.vendibles, 0),
    deCamino: lineas.reduce((t, l) => t + l.deCamino, 0),
  }

  /* ---------- calidad ---------- */
  const ventas90Total = skus.reduce((t, s) => t + (estad.get(s)?.ventas90 ?? 0), 0)
  const mermas90Total = skus.reduce((t, s) => t + (dym.get(s)?.mermas90 ?? 0), 0)
  // Con pocas ventas el % no dice nada (2 mermas sobre 2 ventas no es «pierde el 100 %»)
  const pctMerma90 = ventas90Total >= MIN_VENTAS_MERMA ? Math.round((mermas90Total / ventas90Total) * 1000) / 10 : null
  const sinPrecio = lineas.filter((l) => l.precio === null && (l.ritmo.ventas90 ?? 0) > 0).length
  const refsFueraDeCatalogo = catalogoPorSku.size > 0
    ? skus.filter((s) => !catalogoPorSku.has(s) && (estad.get(s)?.ventas90 ?? 0) > 0).length
    : 0
  const calidad: CalidadDatos = {
    libro, leidoHasta, leidoDesde, diasAtraso,
    ultimoError: entrada.lectura?.ultimoError ?? null,
    mercado: entrada.lectura?.marketplaceId ?? null,
    mercadoRemesa,
    sinConexion: !entrada.connectionId,
    conexionesActivas: entrada.conexionesActivas,
    plazoDePartida: plazo.sinConfirmar,
    sinPrecio, provisional,
    refsFueraDeCatalogo, pctMerma90,
    calculadoAt: entrada.ahora, horasDesdeCalculo: 0,
    avisos: [],
  }
  calidad.avisos = avisosDeCalidad(calidad, plazo, entrada.avisoLectura, entrada.clienteNombre)

  /* ---------- acierto (D43.2) ---------- */
  const acierto = calcularAcierto(entrada.pasadaAnterior, movsPorSku, leidoHasta)

  const previstos: Record<string, number> = {}
  for (const l of lineas) {
    const p = l.ritmo.previsto ?? l.ritmo.base
    if (p !== null && p > 0 && l.ritmo.confianza !== 'sin_datos') previstos[l.sku] = Math.round(p * 10000) / 10000
  }
  let movimientos90 = 0
  if (leidoHasta) {
    const d90 = sumarDias(leidoHasta, -89)
    for (const m of entrada.libro) if (m.fecha >= d90) movimientos90++
  }

  const plan: PlanCliente = {
    clienteId, connectionId: entrada.connectionId, hoy, moneda,
    plazo, ajustes, medidas, calidad,
    lineas: ordenarLineasPlan(lineas),
    envios, enCamino, resumen, acierto,
  }
  return { plan, entradas, plazoDeSku, previstos, movimientos90 }
}

/* ------------------------------------------------------------------ */
/* Calidad                                                             */
/* ------------------------------------------------------------------ */

const NOMBRE_ETAPA: Record<'preparacion' | 'transporte' | 'recepcion' | 'margen', string> = {
  preparacion: 'preparación', transporte: 'transporte', recepcion: 'recepción', margen: 'margen',
}

/** Los avisos ya redactados, de más a menos grave */
export function avisosDeCalidad(c: CalidadDatos, plazo: PlazoEtapas, avisoLectura: string | null, clienteNombre: string): string[] {
  const a: string[] = []
  if (c.sinConexion) a.push('Sin API de Amazon: las ventas no se descuentan solas y no se puede planificar')
  if (c.libro === 'sin_leer') a.push('Las ventas de Amazon no se han leído: sin libro no se puede calcular el ritmo')
  if (c.provisional && c.leidoHasta) a.push(`No te fíes de las fechas: las ventas están leídas hasta el ${fechaCorta(c.leidoHasta)} (${c.diasAtraso} días de atraso). El plan es provisional`)
  if (c.ultimoError) a.push(`La última lectura de Amazon falló: ${c.ultimoError.slice(0, 160)}`)
  if (avisoLectura) a.push(avisoLectura)
  if (!c.provisional && c.diasAtraso !== null && c.diasAtraso > 2 && c.leidoHasta) a.push(`Ventas leídas hasta el ${fechaCorta(c.leidoHasta)} (${c.diasAtraso} días de atraso)`)
  if (c.libro === 'corto' && c.leidoDesde && c.leidoHasta) a.push(`El libro solo cubre ${diasEntre(c.leidoDesde, c.leidoHasta) + 1} días: el ritmo de 90 días y la estacionalidad van a medias`)
  if (c.conexionesActivas > 1) a.push(`El cliente tiene ${c.conexionesActivas} conexiones de Amazon activas: el plan usa la de la lectura elegida`)
  if (c.plazoDePartida) {
    const etapas = (['preparacion', 'transporte', 'recepcion', 'margen'] as const).filter((k) => plazo.origen[k] === 'partida')
    a.push(`Plazo «de partida» sin confirmar (${etapas.map((k) => `${NOMBRE_ETAPA[k]} ${plazo[k]} d`).join(', ')}): confírmalo en los ajustes`)
  }
  if (c.sinPrecio > 0) a.push(`${c.sinPrecio} referencia${c.sinPrecio === 1 ? '' : 's'} que vende${c.sinPrecio === 1 ? '' : 'n'} sin precio: su € en juego no se puede calcular`)
  if (c.refsFueraDeCatalogo > 0) a.push(`${c.refsFueraDeCatalogo} referencia${c.refsFueraDeCatalogo === 1 ? '' : 's'} que vende${c.refsFueraDeCatalogo === 1 ? '' : 'n'} no está${c.refsFueraDeCatalogo === 1 ? '' : 'n'} en la base de datos de ${clienteNombre}`)
  if (c.pctMerma90 !== null && c.pctMerma90 > MERMA_AVISO * 100) a.push(`${clienteNombre} pierde el ${numero(c.pctMerma90, 1)} % de lo vendido por daños y retiradas: revisa el embalaje y reclama`)
  return a
}

/* ------------------------------------------------------------------ */
/* Acierto                                                             */
/* ------------------------------------------------------------------ */

/**
 * El ritmo que se previó hace ~30 días frente a lo vendido desde entonces (solo las referencias que tenían ritmo). Error absoluto
 * en % sobre lo vendido: «el ritmo previsto acertó ±18 %». null sin pasada de entonces, con menos de 14 días reales o sin ventas.
 */
export function calcularAcierto(
  anterior: EntradaPlanCliente['pasadaAnterior'],
  movsPorSku: Map<string, MovimientoDiario[]>,
  leidoHasta: string | null,
): PlanCliente['acierto'] {
  if (!anterior || !leidoHasta) return null
  const desde = anterior.hoy
  const hasta = minFecha(sumarDias(desde, 29), leidoHasta)!
  const dias = diasEntre(desde, hasta) + 1
  if (dias < DIAS_MINIMOS_ACIERTO) return null
  let previsto = 0
  let real = 0
  for (const [sku, d] of Object.entries(anterior.previstos)) {
    if (!(d > 0)) continue
    previsto += d * dias
    for (const m of movsPorSku.get(sku) ?? []) {
      if (m.tipo === 'Shipments' && m.fecha >= desde && m.fecha <= hasta) real += Math.abs(Number(m.cantidad) || 0)
    }
  }
  if (real <= 0) return null
  return { errorPct: Math.round((Math.abs(previsto - real) / real) * 100), desde }
}

/* ------------------------------------------------------------------ */
/* Orden y utilidades para quien lee el plan                           */
/* ------------------------------------------------------------------ */

const RANGO: Record<Prioridad, number> = { tarde: 0, urgente: 1, esta_semana: 2, proximas_2: 3, este_mes: 4, mas_adelante: 5 }

/** Primero lo que se propone (por prioridad y €), después lo que rompe antes, y al final lo demás por SKU */
export function ordenarLineasPlan(lineas: LineaPlan[]): LineaPlan[] {
  const propuesta = (l: LineaPlan) => (l.fuera === null && l.cantidad > 0 ? 0 : 1)
  return [...lineas].sort((a, b) =>
    propuesta(a) - propuesta(b)
    || (propuesta(a) === 0 ? RANGO[a.prioridad] - RANGO[b.prioridad] || (b.eurosEnRiesgo ?? -1) - (a.eurosEnRiesgo ?? -1) : 0)
    || (a.fechaRotura ?? '9999').localeCompare(b.fechaRotura ?? '9999')
    || a.sku.localeCompare(b.sku))
}

/** Las líneas que el GET devuelve por defecto (D28): las propuestas y las que rompen en 60 días */
export function lineasRelevantes(lineas: LineaPlan[], hoy: string): LineaPlan[] {
  const limite = sumarDias(hoy, 60)
  return lineas.filter((l) => (l.fuera === null && l.cantidad > 0) || ((l.fechaPrimerHueco ?? l.fechaRotura) !== null && (l.fechaPrimerHueco ?? l.fechaRotura)! <= limite))
}

/** Estado de la pasada: sin_datos si no hay libro; provisional si va atrasado; ok si no */
export function estadoDePasada(plan: PlanCliente): 'ok' | 'provisional' | 'sin_datos' {
  if (plan.calidad.libro === 'sin_leer' || plan.calidad.sinConexion) return 'sin_datos'
  if (plan.calidad.provisional) return 'provisional'
  return 'ok'
}

/** «8.420 €» para las frases del servidor */
export const dineroPlan = dinero
