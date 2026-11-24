import { createServiceClient } from '@/lib/supabase/service'
import { comprablesDe } from './alertas-datos'
import { leerComprometido } from './comprometido-datos'
import { cifrasDeLineas, COLUMNAS_ENVIO, filaAGuardado, reaplicarAjustes, type FilaEnvioPropuesto } from './envios-propuestos-servidor'
import { MINUTOS_HUERFANO, reconciliarEnvios } from './envios-propuestos'
import { hashDelPlan } from './ia-plan'
import { elegirLectura, MERCADO_ESPANA } from './lectura-elegida'
import { leerLibroDiario } from './libro-diario'
import { leerTodo } from './paginar'
import { invalidarResumen } from './resumen-servidor'
import { faltaLaTabla, fraccionMasDe180 } from './planificacion'
import { sumarDias } from './planificador'
import { clasificarTemporadas } from './temporada-servidor'
import type { Temporada } from './temporada'
import type { VentaFbm } from './fbm-plan'
import {
  COLUMNAS_LISTING,
  catalogoDesdeFila,
  configAlertasDesdeFila,
  estadoDePasada,
  lineasRelevantes,
  listingDesdeFila,
  planificarCliente,
  remesaDesdeFila,
  type EntradaPlanCliente,
  type FilaListing,
  type FilaRemesaPlan,
  type ReposicionSkuPlan,
} from './plan-cliente'
import type { FilaReposicionConfig } from './ajustes-reposicion'
import type {
  AjusteIa,
  AjustesReposicion,
  EnCamino,
  EnvioGuardadoMinimo,
  EnvioPropuestoCalculado,
  EnvioPropuestoGuardado,
  EstadoEnvioPropuesto,
  LineaPlan,
  MedidasCliente,
  PlanCliente,
  PlazoEtapas,
  Prioridad,
} from './plan-tipos'

/**
 * EL PLAN EN EL SERVIDOR: LEER, CALCULAR, GUARDAR Y RECONCILIAR (spec remesas-pro §2.2, §9 y §11: D3, D10, D11, D22, D28, D31, D35).
 * ==================================================================================================================================
 * `calcularYGuardarCliente` lee todo lo que necesita `planificarCliente` (puro, plan-cliente.ts), guarda la pasada del día
 * (UNA por cliente y día: un recálculo sustituye la del día) y reconcilia los envíos propuestos guardados con insert y update
 * explícitos (el índice de la clave es parcial y PostgREST no admite onConflict sobre él). Un 23505 es «otra pasada llegó antes»:
 * se vuelve a leer y se reconcilia otra vez.
 *
 * `leerUltimoPlan` reconstruye el `PlanCliente` de la última pasada guardada sin calcular nada.
 *
 * QUÉ SE GUARDA DÓNDE en `fba_plan_pasadas` (sin columnas nuevas):
 *   plazo    `PlazoEtapas` tal cual (lo leen S3 y S4) + `_pasada` con lo que no tiene columna: ajustes, medidas, envíos de camino,
 *            acierto, moneda, los ritmos previstos (para el acierto de dentro de 30 días: las líneas solo duran 7) y los envíos
 *            calculados SIN sus líneas (solo los SKU: las líneas están en `lineas`).
 *   calidad  `CalidadDatos`.   resumen  `ResumenPlan`.   lineas  todas las `LineaPlan` (7 días).
 *
 * Sin la migración 316 el plan se calcula y se enseña, pero no se guarda: ni pasadas, ni envíos propuestos, ni avisos.
 *
 * SOLO SERVIDOR. Nunca llama a Amazon.
 */

type Servicio = ReturnType<typeof createServiceClient>

export const AVISO_FALTA_316 = 'Falta lanzar la migración 316: el plan se ve pero no se puede gestionar'

/** Días de libro que se leen (ritmo de 365 + margen) */
const DIAS_LIBRO = 400
/** Envíos cuyos Receipts se leen para medir transporte y recepción (se miden los 6 últimos) */
const ENVIOS_MEDIDOS = 10
/** Días de cuarentena de un descarte */
const DIAS_CUARENTENA = 14
/** Una pasada de hace ~30 días para el acierto: entre 30 y 45 días atrás */
const ACIERTO_DESDE = 30
const ACIERTO_HASTA = 45
/** Líneas por página en `?todas=1&pagina=` */
export const LINEAS_POR_PAGINA = 200

const ACTIVOS: EstadoEnvioPropuesto[] = ['nuevo', 'hablado', 'esperando_cliente', 'en_preparacion']
const CERRADOS_RECIENTES: EstadoEnvioPropuesto[] = ['descartado', 'caducado']

/* ------------------------------------------------------------------ */
/* Caché en memoria (D32): nunca `unstable_cache`                      */
/* ------------------------------------------------------------------ */

const CADUCA_CACHE_MS = 3 * 60_000
const cache = new Map<string, { hasta: number; valor: unknown }>()

/** Lo guardado en la caché del plan si no ha caducado */
export function deCachePlan<T>(clave: string): T | undefined {
  const x = cache.get(clave)
  if (!x) return undefined
  if (x.hasta < Date.now()) {
    cache.delete(clave)
    return undefined
  }
  return x.valor as T
}

export function aCachePlan(clave: string, valor: unknown, ms: number = CADUCA_CACHE_MS): void {
  if (cache.size > 500) cache.clear()
  cache.set(clave, { hasta: Date.now() + ms, valor })
}

/** Vacía la caché del plan (de un cliente o entera). La llaman el POST del plan, el cron y quien escriba envíos propuestos */
export function invalidarCachePlan(clienteId?: string): void {
  try {
    // El resumen global (S5) sale de las pasadas: se vacía con ellas
    invalidarResumen()
  } catch {
    // Vaciar una caché nunca tumba lo que ya se ha guardado
  }
  if (!clienteId) {
    cache.clear()
    return
  }
  for (const k of [...cache.keys()]) if (k.includes(clienteId) || k.startsWith('todos:')) cache.delete(k)
}

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

const enTrozos = <T>(lista: readonly T[], n = 150): T[][] => {
  const t: T[][] = []
  for (let i = 0; i < lista.length; i += n) t.push(lista.slice(i, i + n))
  return t
}
const lista = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
const objeto = <T>(v: unknown): T | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as T) : null)
const esConflicto = (e: unknown): boolean => (e as { code?: string } | null)?.code === '23505'

/** Días entre un instante ISO y `hoy` (para descartes y cuarentena) */
const haceDias = (hoy: string, dias: number): string => `${sumarDias(hoy, -dias)}T00:00:00Z`

/* ------------------------------------------------------------------ */
/* Lectura de la entrada                                               */
/* ------------------------------------------------------------------ */

export interface EntradaLeida {
  entrada: EntradaPlanCliente
  /** false = falta la 316 (no se guarda nada) */
  migracion316: boolean
  /** `fba_alertas_config.avisar` (false = sin campana) */
  avisar: boolean
}

interface FilaConexion { id: string; region: string | null; default_marketplace_id: string | null }

async function leidoDesde(service: Servicio, conexion: string, mercado: string): Promise<string | null> {
  const { data, error } = await service
    .from('fba_movimientos')
    .select('fecha')
    .eq('connection_id', conexion)
    .eq('marketplace_id', mercado)
    .order('fecha', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) return null
  return (data as { fecha: string } | null)?.fecha?.slice(0, 10) ?? null
}

/** Listings con las columnas del plan; sin `activo_manual` (migración vieja) se vuelve a pedir sin ella */
async function pedirListings(construir: (columnas: string) => PromiseLike<{ data: unknown; error: { code?: string } | null }>): Promise<FilaListing[]> {
  const r = await construir(COLUMNAS_LISTING)
  if (!r.error) return (r.data ?? []) as FilaListing[]
  if (r.error.code === '42703' || r.error.code === 'PGRST204') {
    const r2 = await construir(COLUMNAS_LISTING.replace(', activo_manual', ''))
    if (r2.error) throw r2.error
    return (r2.data ?? []) as FilaListing[]
  }
  throw r.error
}

/**
 * De los SKU con movimiento, los que no tienen ficha completa en `mercado` (`sinFila`: sin fila, o con fila sin precio o sin
 * FNSKU, como Yo By Yolanda en IT) y los que no tienen stock en él (`sinStock`). Puro (lo prueba plan-cliente.prueba.ts).
 */
export function skusSinStockEn(
  listings: ReadonlyArray<Pick<FilaListing, 'sku' | 'marketplace_id' | 'fba_fulfillable_quantity' | 'fba_quantity' | 'price' | 'fnsku'>>,
  skus: readonly string[],
  mercado: string,
): { sinStock: string[]; sinFila: string[] } {
  const aqui = new Map<string, Pick<FilaListing, 'fba_fulfillable_quantity' | 'fba_quantity' | 'price' | 'fnsku'>>()
  for (const l of listings) if (l.marketplace_id === mercado) aqui.set(l.sku, l)
  const sinStock: string[] = []
  const sinFila: string[] = []
  for (const s of skus) {
    const f = aqui.get(s)
    const precio = f ? Number(f.price) : NaN
    if (!f || !(Number.isFinite(precio) && precio > 0) || !(f.fnsku && String(f.fnsku).trim())) sinFila.push(s)
    if (!f || !((f.fba_fulfillable_quantity ?? 0) > 0 || (f.fba_quantity ?? 0) > 0)) sinStock.push(s)
  }
  return { sinStock, sinFila }
}

/**
 * Dónde están los listings de la conexión, dado cuántos hay en cada mercado: el de la lectura si tiene alguno y no menos que el
 * predeterminado de la conexión; si no, el predeterminado si tiene; si no, el que más tiene; si ninguno tiene, el de la lectura.
 * (Yo By Yolanda: 1 listing en IT, el de la lectura, y 18 en ES). Puro.
 */
export function elegirMercadoListings(cuentas: ReadonlyMap<string, number>, mercado: string, predeterminado: string | null): string {
  const enMercado = cuentas.get(mercado) ?? 0
  const enPre = predeterminado ? cuentas.get(predeterminado) ?? 0 : 0
  if (enMercado > 0 && enMercado >= enPre) return mercado
  if (predeterminado && enPre > 0) return predeterminado
  const top = [...cuentas.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
  return top ? top[0] : mercado
}

/** Mercados de Amazon que puede tener una conexión (para contar sus listings sin traerlos) */
const MERCADOS_CONOCIDOS = [
  'A1RKKUPIHCS9HS', 'APJ6JRA9NG5V4', 'A13V1IB3VIYZZH', 'A1PA6795UKMFR9', 'A1F83G8C2ARO7P', 'A1805IZSGTT6HS', 'A2NODRKZP88ZB9',
  'A1C3SOZRARQ6R3', 'AMEN7PMS3EDWL', 'A28R8C7NBKEWEA', 'A33AVAJ2PDY3EV', 'ATVPDKIKX0DER', 'A2EUQ1WTGCTBG2', 'A1AM78C64UM0Y8',
  'A2Q3Y263D00KWC', 'A1VC38T7YXB528', 'A39IBJ37TRP1C6', 'A21TJRUUN4KGV',
]

async function mercadoConListings(service: Servicio, conexion: FilaConexion, mercado: string, otros: readonly string[]): Promise<string> {
  const contar = async (m: string): Promise<number> => {
    const { count, error } = await service.from('amazon_listings').select('sku', { count: 'exact', head: true })
      .eq('connection_id', conexion.id).eq('marketplace_id', m)
    return error ? 0 : count ?? 0
  }
  const cuentas = new Map<string, number>()
  const pre = conexion.default_marketplace_id
  const [nMercado, nPre] = await Promise.all([contar(mercado), pre && pre !== mercado ? contar(pre) : Promise.resolve(0)])
  cuentas.set(mercado, nMercado)
  if (pre && pre !== mercado) cuentas.set(pre, nPre)
  if (nMercado > 0 || nPre > 0) return elegirMercadoListings(cuentas, mercado, pre)
  const resto = [...new Set([...otros, ...MERCADOS_CONOCIDOS])].filter((m) => !cuentas.has(m))
  const ns = await Promise.all(resto.map(contar))
  resto.forEach((m, i) => cuentas.set(m, ns[i]))
  return elegirMercadoListings(cuentas, mercado, pre)
}

/**
 * Todo lo que necesita `planificarCliente` de un cliente. Solo lee. La usan la pasada y las pruebas contra producción.
 */
export async function leerEntradaPlan(service: Servicio, clienteId: string, hoy: string, ahora: string = new Date().toISOString()): Promise<EntradaLeida> {
  /* ---------- cliente y conexiones ---------- */
  const [{ data: cli, error: errCli }, { data: cons, error: errCons }] = await Promise.all([
    service.from('amazon_clients').select('id, name').eq('id', clienteId).maybeSingle(),
    service.from('amazon_connections').select('id, region, default_marketplace_id').eq('client_id', clienteId).eq('is_active', true),
  ])
  if (errCli) throw errCli
  if (errCons) throw errCons
  const clienteNombre = (cli as { name: string | null } | null)?.name ?? 'Cliente'
  const conexiones = (cons ?? []) as FilaConexion[]

  /* ---------- remesas (las que salieron en 400 días y las que siguen de camino) ---------- */
  const desdeRemesas = sumarDias(hoy, -DIAS_LIBRO)
  const { data: rem, error: errRem } = await service
    .from('fba_remesas')
    .select('id, nombre, estado, estado_amazon, marketplace_id, referencia_envio, fecha_envio, llegada_at')
    .eq('client_id', clienteId)
    .in('estado', ['enviada', 'cerrada'])
    .or(`fecha_envio.gte.${desdeRemesas},estado.eq.enviada`)
    .limit(1000)
  if (errRem) throw errRem
  const filasRemesa = (rem ?? []) as FilaRemesaPlan[]
  const lineasRemesa = new Map<string, Array<{ sku: string | null; unidades: number | null; unidades_recibidas: number | null }>>()
  for (const ids of enTrozos(filasRemesa.map((r) => r.id))) {
    const filas = await leerTodo<{ remesa_id: string; sku: string | null; unidades: number | null; unidades_recibidas: number | null }>((a, b) =>
      service.from('fba_remesa_lineas').select('remesa_id, sku, unidades, unidades_recibidas').in('remesa_id', ids).order('id', { ascending: true }).range(a, b))
    for (const f of filas) {
      const l = lineasRemesa.get(f.remesa_id) ?? []
      l.push(f)
      lineasRemesa.set(f.remesa_id, l)
    }
  }
  const remesas = filasRemesa.map((r) => remesaDesdeFila(r, lineasRemesa.get(r.id) ?? []))

  /* ---------- la lectura elegida (D35), entre todas las conexiones activas (D34) ---------- */
  let conexion: FilaConexion | null = conexiones[0] ?? null
  let lectura: EntradaPlanCliente['lectura'] = null
  let avisoLectura: string | null = null
  let filasLecturas: Array<{ connection_id: string; marketplace_id: string }> = []
  if (conexiones.length > 0) {
    const { data: lecs, error: errLec } = await service
      .from('fba_lecturas')
      .select('connection_id, marketplace_id, leido_hasta, ultimo_error, updated_at')
      .in('connection_id', conexiones.map((c) => c.id))
    if (errLec) throw errLec
    const filas = (lecs ?? []) as Array<{ connection_id: string; marketplace_id: string; leido_hasta: string | null; ultimo_error: string | null; updated_at: string | null }>
    filasLecturas = filas
    const candidatas = await Promise.all(filas.map(async (l) => ({
      marketplaceId: l.marketplace_id,
      leidoHasta: l.leido_hasta ? l.leido_hasta.slice(0, 10) : null,
      leidoDesde: l.leido_hasta ? await leidoDesde(service, l.connection_id, l.marketplace_id) : null,
      ultimoError: l.ultimo_error,
      connectionId: l.connection_id,
    })))
    const primerEnvio = filasRemesa.map((r) => r.fecha_envio?.slice(0, 10) ?? null).filter((f): f is string => !!f).sort()[0] ?? null
    const tope = sumarDias(hoy, -DIAS_LIBRO)
    const desdeNecesario = primerEnvio && primerEnvio > tope ? primerEnvio : tope
    const eleccion = elegirLectura(candidatas, desdeNecesario)
    if (eleccion) {
      conexion = conexiones.find((c) => c.id === eleccion.elegida.connectionId) ?? conexion
      lectura = { marketplaceId: eleccion.elegida.marketplaceId, leidoHasta: eleccion.elegida.leidoHasta, leidoDesde: eleccion.elegida.leidoDesde, ultimoError: eleccion.elegida.ultimoError }
      avisoLectura = eleccion.aviso
    }
  }
  const mercado = lectura?.marketplaceId ?? conexion?.default_marketplace_id ?? MERCADO_ESPANA
  const lecturasConexion = filasLecturas.filter((l) => l.connection_id === conexion?.id).map((l) => l.marketplace_id)
  const region = conexion?.region === 'eu' || conexion?.region === 'na' || conexion?.region === 'fe' ? conexion.region : null

  /* ---------- libro agregado (D29) ---------- */
  const libro = conexion && lectura?.leidoHasta
    ? await leerLibroDiario(service, conexion.id, mercado, sumarDias(hoy, -DIAS_LIBRO), hoy)
    : []

  /* ---------- listings: los del mercado y, de los que faltan, los de otros mercados (D11) ---------- */
  const listings: FilaListing[] = []
  let hayBuyable: boolean | null = null
  let mercadoListings: string = mercado
  if (conexion) {
    const conStock = await leerTodo<FilaListing>((a, b) =>
      pedirListings((columnas) =>
        service.from('amazon_listings').select(columnas)
          .eq('connection_id', conexion!.id).eq('marketplace_id', mercado)
          .or('fba_quantity.gt.0,fba_fulfillable_quantity.gt.0,fba_inbound_quantity.gt.0')
          .order('sku', { ascending: true }).range(a, b),
      ).then((data) => ({ data, error: null })))
    listings.push(...conStock)
    const tiene = new Set(conStock.map((l) => l.sku))
    const conMovimiento = new Set<string>()
    for (const m of libro) conMovimiento.add(m.sku)
    for (const r of remesas) if (r.estado === 'enviada') for (const l of r.lineas) conMovimiento.add(l.sku)
    const faltan = [...conMovimiento].filter((s) => !tiene.has(s))
    for (const t of enTrozos(faltan)) {
      const filas = await pedirListings((columnas) =>
        service.from('amazon_listings').select(columnas).eq('connection_id', conexion!.id).eq('marketplace_id', mercado).in('sku', t))
      listings.push(...filas)
      for (const f of filas) tiene.add(f.sku)
    }
    // Los que no tienen fila en el mercado de la lectura, o la tienen sin stock: los de otros mercados con stock (D11).
    // Los que NO tienen fila aquí traen además todas sus filas de otros mercados, con o sin stock, para la ficha (nombre, ASIN,
    // FNSKU, precio, estado): Creative Toys lee el libro en IT y sus 102 listings están en ES; sin esto un agotado salía sin
    // nombre ni precio. El stock sigue saliendo solo de filas con stock (`filasDeStock` descarta las demás de otros mercados).
    const { sinStock: sinStockAqui, sinFila: sinFilaAqui } = skusSinStockEn(listings, [...conMovimiento], mercado)
    const vistos = new Set(listings.map((l) => `${l.marketplace_id}|${l.sku}`))
    const anadir = (filas: FilaListing[]) => {
      for (const f of filas) {
        const k = `${f.marketplace_id}|${f.sku}`
        if (vistos.has(k)) continue
        vistos.add(k)
        listings.push(f)
      }
    }
    const sinFilaSet = new Set(sinFilaAqui)
    for (const t of enTrozos(sinFilaAqui)) {
      anadir(await pedirListings((columnas) =>
        service.from('amazon_listings').select(columnas)
          .eq('connection_id', conexion!.id).neq('marketplace_id', mercado).in('sku', t)))
    }
    for (const t of enTrozos(sinStockAqui.filter((s) => !sinFilaSet.has(s)))) {
      anadir(await pedirListings((columnas) =>
        service.from('amazon_listings').select(columnas)
          .eq('connection_id', conexion!.id).neq('marketplace_id', mercado).in('sku', t)
          .or('fba_quantity.gt.0,fba_fulfillable_quantity.gt.0')))
    }
    // El mercado donde de verdad están los listings: el de la lectura si tiene alguno; si no, el predeterminado o el que más tiene
    mercadoListings = await mercadoConListings(service, conexion, mercado, lecturasConexion)
    // Salvaguarda de D1: «no comprable» solo si algún listing del cliente en ese mercado trae BUYABLE (la misma lectura que la
    // alerta `sin_comprar`, `comprablesDe` de S4a; la regla por SKU la aplica `planificarCliente` con `esNoComprable`). En el
    // mercado de los listings: en el de la lectura sin listings salía siempre false y anulaba la regla (Creative Toys, Yo By Yolanda)
    hayBuyable = (await comprablesDe(service, conexion.id, mercadoListings, [])).hayBuyableEnCliente
  }

  /* ---------- Receipts por envío para medir transporte y recepción (D10) ---------- */
  const receipts: EntradaPlanCliente['receipts'] = []
  if (conexion) {
    const medibles = filasRemesa
      .filter((r) => r.referencia_envio && r.fecha_envio)
      .sort((a, b) => (b.fecha_envio ?? '').localeCompare(a.fecha_envio ?? ''))
      .slice(0, ENVIOS_MEDIDOS)
    await Promise.all(medibles.map(async (r) => {
      const { data, error } = await service
        .from('fba_movimientos')
        .select('fecha, cantidad')
        .eq('connection_id', conexion!.id)
        .eq('marketplace_id', mercado)
        .eq('referencia', r.referencia_envio!)
        .eq('tipo', 'Receipts')
        .limit(2000)
      if (error) return
      const porDia = new Map<string, number>()
      for (const f of (data ?? []) as Array<{ fecha: string; cantidad: number }>) {
        const d = String(f.fecha).slice(0, 10)
        porDia.set(d, (porDia.get(d) ?? 0) + (Number(f.cantidad) || 0))
      }
      for (const [fecha, cantidad] of porDia) receipts.push({ referencia: r.referencia_envio!, fecha, cantidad })
    }))
  }

  /* ---------- comprometido, ajustes, plazos, catálogo ---------- */
  const [comprometido, cfgAlertas, plazosSkuR, cfgRepo, repoSku, catalogo] = await Promise.all([
    leerComprometido(service, clienteId, hoy),
    service.from('fba_alertas_config').select('*').eq('client_id', clienteId).maybeSingle(),
    service.from('fba_alertas_plazo_sku').select('sku, plazo_reposicion_dias').eq('client_id', clienteId),
    service.from('fba_reposicion_config').select('*').eq('client_id', clienteId).maybeSingle(),
    service.from('fba_reposicion_sku').select('sku, unidades_caja, cobertura_dias, excluir, motivo').eq('client_id', clienteId),
    leerTodo<Record<string, unknown>>((a, b) =>
      service.from('fba_catalogo').select('id, ref, nombre, talla, fbasku, continuidad, precio').eq('client_id', clienteId).order('id', { ascending: true }).range(a, b))
      .catch((e) => {
        if (faltaLaTabla(e as { code?: string })) return []
        throw e
      }),
  ])
  if (cfgAlertas.error && !faltaLaTabla(cfgAlertas.error)) throw cfgAlertas.error
  if (plazosSkuR.error && !faltaLaTabla(plazosSkuR.error)) throw plazosSkuR.error
  if (cfgRepo.error && !faltaLaTabla(cfgRepo.error)) throw cfgRepo.error
  if (repoSku.error && !faltaLaTabla(repoSku.error)) throw repoSku.error
  const migracion316 = !(cfgRepo.error && faltaLaTabla(cfgRepo.error))
  const plazosSku: Record<string, number> = {}
  for (const f of (plazosSkuR.data ?? []) as Array<{ sku: string; plazo_reposicion_dias: number }>) {
    const n = Number(f.plazo_reposicion_dias)
    if (Number.isFinite(n) && n > 0) plazosSku[f.sku] = Math.round(n)
  }
  const reposicionSku: ReposicionSkuPlan[] = ((repoSku.data ?? []) as Array<{ sku: string; unidades_caja: number | null; cobertura_dias: number | null; excluir: boolean; motivo: string | null }>)
    .map((f) => ({ sku: f.sku, unidadesCaja: f.unidades_caja, coberturaDias: f.cobertura_dias, excluir: f.excluir === true, motivo: f.motivo }))

  /* ---------- envíos propuestos que cuentan (hablados) y descartes (cuarentena) — 316 ---------- */
  const PRIORIDADES_VALIDAS = new Set<string>(['tarde', 'urgente', 'esta_semana', 'proximas_2', 'este_mes', 'mas_adelante'])
  const hablados: EntradaPlanCliente['hablados'] = []
  const descartes: EntradaPlanCliente['descartes'] = []
  let pasadaAnterior: EntradaPlanCliente['pasadaAnterior'] = null
  if (migracion316) {
    const [act, desc, ant] = await Promise.all([
      service.from('fba_envios_propuestos')
        .select('id, estado, salir_antes_de, remesa_id, lineas, lineas_aceptadas')
        .eq('client_id', clienteId)
        .in('estado', ['hablado', 'esperando_cliente', 'en_preparacion']),
      service.from('fba_envios_propuestos')
        .select('prioridad, estado_cambiado_at, lineas, lineas_aceptadas')
        .eq('client_id', clienteId)
        .eq('estado', 'descartado')
        .gte('estado_cambiado_at', haceDias(hoy, DIAS_CUARENTENA)),
      service.from('fba_plan_pasadas')
        .select('hoy, plazo')
        .eq('client_id', clienteId)
        .lte('hoy', sumarDias(hoy, -ACIERTO_DESDE))
        .gte('hoy', sumarDias(hoy, -ACIERTO_HASTA))
        .order('hoy', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    for (const f of (act.data ?? []) as Array<{ id: string; estado: string; salir_antes_de: string; remesa_id: string | null; lineas: unknown; lineas_aceptadas: unknown }>) {
      // Con remesa, sus unidades ya cuentan como comprometidas (o de camino) a través de la remesa
      if (f.estado === 'en_preparacion' && f.remesa_id) continue
      const ls = (f.lineas_aceptadas != null ? lista<LineaPlan>(f.lineas_aceptadas) : lista<LineaPlan>(f.lineas))
        .filter((l) => l && typeof l.sku === 'string' && Number(l.cantidad) > 0)
        .map((l) => ({ sku: l.sku, cantidad: Number(l.cantidad) }))
      if (ls.length) hablados.push({ envioPropuestoId: f.id, salirAntesDe: String(f.salir_antes_de).slice(0, 10), lineas: ls })
    }
    for (const f of (desc.data ?? []) as Array<{ prioridad: Prioridad; estado_cambiado_at: string; lineas: unknown; lineas_aceptadas: unknown }>) {
      // Cada referencia con SU prioridad (la de la línea aceptada si la hay): con la del envío, un envío «tarde» descartado dejaba
      // fuera 14 días todas sus referencias aunque subieran
      const aceptadas = new Map(lista<LineaPlan>(f.lineas_aceptadas).filter((l) => l && typeof l.sku === 'string').map((l) => [l.sku, l] as const))
      const prioridadPorSku: Record<string, Prioridad> = {}
      const skus: string[] = []
      for (const l of lista<LineaPlan>(f.lineas)) {
        if (!l || typeof l.sku !== 'string') continue
        skus.push(l.sku)
        const p = aceptadas.get(l.sku)?.prioridad ?? l.prioridad
        if (typeof p === 'string' && PRIORIDADES_VALIDAS.has(p)) prioridadPorSku[l.sku] = p
      }
      descartes.push({ prioridad: f.prioridad, estadoCambiadoAt: f.estado_cambiado_at, skus, prioridadPorSku })
    }
    const a = ant.data as { hoy: string; plazo: unknown } | null
    const extra = objeto<ExtraPasada>(objeto<{ _pasada?: unknown }>(a?.plazo)?._pasada)
    if (a && extra?.previstos) pasadaAnterior = { hoy: String(a.hoy).slice(0, 10), previstos: extra.previstos }
  }

  /* ---------- antigüedad que cuenta Amazon (la que cobra el recargo), si la foto es reciente ---------- */
  const edadAmazon = conexion ? await leerEdadAmazon(service, conexion.id, mercado, hoy) : null

  /* ---------- ventas FBM y temporadas (migración 335; sin ella, el plan es como antes) ---------- */
  const ventasFbm = conexion && lectura ? await leerVentasFbm(service, conexion.id, mercado, hoy, new Set(listings.map((l) => l.sku))) : null
  let temporadas: Record<string, Temporada> | undefined
  {
    const t = await service.from('fba_temporadas').select('clave, temporada').eq('client_id', clienteId)
    if (!t.error) temporadas = Object.fromEntries(((t.data ?? []) as Array<{ clave: string; temporada: Temporada }>).map((x) => [x.clave, x.temporada]))
    else if (!faltaLaTabla(t.error)) console.error('[fba/plan] temporadas', t.error.message)
  }

  const cfgFila = (cfgAlertas.data ?? null) as Record<string, unknown> | null
  const entrada: EntradaPlanCliente = {
    clienteId,
    clienteNombre,
    connectionId: conexion?.id ?? null,
    region,
    conexionesActivas: conexiones.length,
    hoy,
    ahora,
    lectura,
    avisoLectura,
    libro,
    listings: listings.map(listingDesdeFila),
    hayBuyableEnCliente: hayBuyable,
    mercadoListings,
    remesas,
    receipts,
    comprometido,
    hablados,
    configAlertas: configAlertasDesdeFila(cfgFila),
    plazosSku,
    configReposicion: (cfgRepo.data ?? null) as FilaReposicionConfig | null,
    reposicionSku,
    catalogo: catalogo.map(catalogoDesdeFila),
    edadAmazon,
    descartes,
    pasadaAnterior,
    ventasFbm,
    ...(temporadas ? { temporadas } : {}),
  }
  return { entrada, migracion316, avisar: cfgFila ? cfgFila.avisar !== false : true }
}

/**
 * Las ventas FBM de la cuenta (fba_ventas_canal, canal 'fbm') de los últimos 400 días, y el nombre de los SKU FBM que más venden (para la lista de
 * «vende por FBM y no está en FBA»). null si no hay pedidos leídos (o falta la 335): el plan es solo FBA.
 */
async function leerVentasFbm(service: Servicio, connectionId: string, mercado: string, hoy: string, skusConListing: ReadonlySet<string>): Promise<EntradaPlanCliente['ventasFbm']> {
  try {
    const { data: est, error } = await service.from('fba_ventas_canal_lecturas').select('leido_desde, leido_hasta').eq('connection_id', connectionId).eq('marketplace_id', mercado).maybeSingle()
    if (error) {
      if (!faltaLaTabla(error)) console.error('[fba/plan] lectura de pedidos', error.message)
      return null
    }
    const e = est as { leido_desde: string | null; leido_hasta: string | null } | null
    if (!e?.leido_hasta) return null
    const ventas = await leerTodo<VentaFbm>((a, b) =>
      service.from('fba_ventas_canal').select('fecha, sku, asin, unidades')
        .eq('connection_id', connectionId).eq('marketplace_id', mercado).eq('canal', 'fbm')
        .gte('fecha', sumarDias(hoy, -400))
        .order('fecha', { ascending: true }).order('sku', { ascending: true }).range(a, b))
    // Los nombres: de los SKU FBM más vendidos en 90 días que no son ya del plan
    const d90 = sumarDias(hoy, -90)
    const porSku = new Map<string, number>()
    for (const v of ventas) if (v.fecha >= d90 && !skusConListing.has(v.sku)) porSku.set(v.sku, (porSku.get(v.sku) ?? 0) + v.unidades)
    const top = [...porSku.entries()].sort((a, b) => b[1] - a[1]).slice(0, 150).map(([sku]) => sku)
    const nombres: Record<string, string> = {}
    for (let i = 0; i < top.length; i += 100) {
      const { data } = await service.from('amazon_listings').select('sku, title').eq('connection_id', connectionId).in('sku', top.slice(i, i + 100))
      for (const f of (data ?? []) as Array<{ sku: string; title: string | null }>) if (f.title && !nombres[f.sku]) nombres[f.sku] = f.title
    }
    return { desde: e.leido_desde, hasta: e.leido_hasta, ventas: ventas.map((v) => ({ ...v, unidades: Number(v.unidades) || 0 })), nombres }
  } catch (err) {
    if (faltaLaTabla(err as { code?: string })) return null
    console.error('[fba/plan] ventas FBM', (err as Error)?.message ?? err)
    return null
  }
}

/**
 * Planifica y, si hay modelos o SKU sin temporada, los clasifica (regla y, en calzado, la IA; temporada-servidor.ts), los guarda y vuelve a
 * planificar con ellos. La segunda vez ya están guardados: la IA se paga una vez por modelo.
 */
export async function planificarConTemporadas(service: Servicio, clienteId: string, entrada: EntradaPlanCliente): Promise<ReturnType<typeof planificarCliente>> {
  const r = planificarCliente(entrada)
  if (!entrada.temporadas || r.temporadasPendientes.length === 0) return r
  const nuevas = await clasificarTemporadas(service, clienteId, r.temporadasPendientes)
  if (Object.keys(nuevas).length === 0) return r
  entrada.temporadas = { ...entrada.temporadas, ...nuevas }
  return planificarCliente(entrada)
}

/** Días que vale la foto de antigüedad de Amazon (la misma regla que la tarjeta de inventario) */
const DIAS_QUE_VALE_LA_EDAD = 5

/**
 * % de unidades con más de 180 días por SKU, de la última foto del informe de planificación de Amazon (fba_planificacion).
 * Solo si la foto tiene ≤ 5 días; si no (o falta la tabla), null y el plan estima por FIFO.
 */
async function leerEdadAmazon(service: Servicio, connectionId: string, mercado: string, hoy: string): Promise<Record<string, number> | null> {
  try {
    const filas = await leerTodo<{ sku: string; edad: unknown; updated_at: string | null }>((a, b) =>
      service.from('fba_planificacion').select('sku, edad, updated_at')
        .eq('connection_id', connectionId).eq('marketplace_id', mercado)
        .order('sku', { ascending: true }).range(a, b))
    if (filas.length === 0) return null
    const ultima = filas.reduce((m, f) => (f.updated_at && f.updated_at > m ? f.updated_at : m), '')
    if (!ultima || diasEntreFechas(ultima.slice(0, 10), hoy) > DIAS_QUE_VALE_LA_EDAD) return null
    const salida: Record<string, number> = {}
    for (const f of filas) {
      const pct = fraccionMasDe180(f.edad)
      if (pct !== null) salida[f.sku] = pct
    }
    return Object.keys(salida).length ? salida : null
  } catch (e) {
    if (faltaLaTabla(e as { code?: string })) return null
    console.error('[fba/plan] antigüedad de Amazon', (e as Error)?.message ?? e)
    return null
  }
}

const diasEntreFechas = (desde: string, hasta: string): number =>
  Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000)

/* ------------------------------------------------------------------ */
/* Lo que se guarda en `plazo._pasada`                                 */
/* ------------------------------------------------------------------ */

interface ExtraPasada {
  v: 1
  moneda: string
  ajustes: AjustesReposicion
  medidas: MedidasCliente
  enCamino: EnCamino[]
  acierto: PlanCliente['acierto']
  /** Ritmo previsto por SKU (para el acierto de dentro de 30 días) */
  previstos: Record<string, number>
  movimientos90: number
  /** Envíos calculados sin sus líneas: los SKU (las líneas están en `lineas`) */
  envios: Array<Omit<EnvioPropuestoCalculado, 'lineas'> & { skus: string[] }>
}

export function plazoParaGuardar(plan: PlanCliente, previstos: Record<string, number>, movimientos90: number): Record<string, unknown> {
  const extra: ExtraPasada = {
    v: 1,
    moneda: plan.moneda,
    ajustes: plan.ajustes,
    medidas: plan.medidas,
    enCamino: plan.enCamino,
    acierto: plan.acierto,
    previstos,
    movimientos90,
    envios: plan.envios.map(({ lineas, ...resto }) => ({ ...resto, skus: lineas.map((l) => l.sku) })),
  }
  return { ...plan.plazo, _pasada: extra }
}

/* ------------------------------------------------------------------ */
/* Reconciliación con lo guardado                                      */
/* ------------------------------------------------------------------ */

interface FilaEnvioConAvisos extends FilaEnvioPropuesto {
  prioridad_avisada?: string | null
  vencido_avisado_at?: string | null
}

/**
 * Las referencias que ya no siguen al plan (`EnvioGuardadoMinimo.skusFijos`): en preparación, las que fueron a la remesa (lo
 * hablado o, si no, las líneas, que la pasada ya no reescribe); hablado o esperando, las aceptadas si las hay. Puro.
 */
export function skusFijosDe(f: Pick<FilaEnvioPropuesto, 'estado' | 'lineas' | 'lineas_aceptadas'>): string[] | null {
  const skus = (v: unknown) => lista<LineaPlan>(v).filter((l) => l && typeof l.sku === 'string' && Number(l.cantidad) > 0).map((l) => l.sku)
  if (f.estado === 'en_preparacion') return skus(f.lineas_aceptadas != null ? f.lineas_aceptadas : f.lineas)
  if ((f.estado === 'hablado' || f.estado === 'esperando_cliente') && f.lineas_aceptadas != null) return skus(f.lineas_aceptadas)
  return null
}

function minimo(f: FilaEnvioPropuesto): EnvioGuardadoMinimo {
  const ls = lista<LineaPlan>(f.lineas).filter((l) => l && typeof l.sku === 'string')
  return {
    skusFijos: skusFijosDe(f),
    id: f.id,
    clave: f.clave,
    estado: f.estado as EstadoEnvioPropuesto,
    prioridad: f.prioridad as Prioridad,
    salirAntesDe: String(f.salir_antes_de).slice(0, 10),
    unidades: f.unidades ?? 0,
    skus: ls.map((l) => l.sku),
    remesaId: f.remesa_id,
    estadoCambiadoAt: f.estado_cambiado_at,
    lineas: ls.map((l) => ({ sku: l.sku, cantidad: Number(l.cantidad) || 0 })),
  }
}

/**
 * Las líneas del plan de hoy para un envío hablado, sin perder las suyas: sus SKU cuentan como llegada, así que el plan ya no los
 * pide y, sin esto, la pantalla enseñaría «el plan de hoy dice X, hablasteis Y» con una diferencia falsa. Las suyas se quedan
 * como estaban guardadas (o como se hablaron).
 */
export function lineasConLasPropias(
  calculadas: LineaPlan[],
  guardado: Pick<FilaEnvioPropuesto, 'lineas' | 'lineas_aceptadas'>,
  propios: ReadonlySet<string> | undefined,
): LineaPlan[] {
  if (!propios || propios.size === 0) return calculadas
  const hay = new Set(calculadas.map((l) => l.sku))
  const previas = new Map<string, LineaPlan>()
  for (const l of lista<LineaPlan>(guardado.lineas_aceptadas)) if (l && typeof l.sku === 'string') previas.set(l.sku, l)
  for (const l of lista<LineaPlan>(guardado.lineas)) if (l && typeof l.sku === 'string') previas.set(l.sku, l)
  const extra: LineaPlan[] = []
  for (const sku of propios) {
    if (hay.has(sku)) continue
    const l = previas.get(sku)
    if (l) extra.push(l)
  }
  return extra.length ? [...calculadas, ...extra] : calculadas
}

function filaDeCalculado(c: EnvioPropuestoCalculado, pasadaId: string | null) {
  return {
    connection_id: c.connectionId,
    prioridad: c.prioridad,
    confianza: c.confianza,
    provisional: c.provisional,
    moneda: c.moneda,
    salir_antes_de: c.salirAntesDe,
    decidir_antes_de: c.decidirAntesDe,
    a_la_venta: c.aLaVenta,
    unidades: c.unidades,
    cajas_estimadas: c.cajasEstimadas,
    euros_en_riesgo: c.eurosEnRiesgo === null ? null : Math.round(c.eurosEnRiesgo),
    porque: c.porque,
    lineas: c.lineas,
    pasada_id: pasadaId,
  }
}

export interface ResultadoReconciliar {
  insertados: number
  actualizados: number
  caducados: number
  aEnviado: number
  huerfanos: number
  conflictos: number
}

async function historial(service: Servicio, filas: Array<{ envio_propuesto_id: string; accion: string; de?: string | null; a?: string | null; nota?: string | null; datos?: Record<string, unknown> }>): Promise<void> {
  if (!filas.length) return
  for (const t of enTrozos(filas, 200)) {
    const { error } = await service.from('fba_envios_propuestos_historial').insert(t.map((f) => ({ quien: null, datos: {}, ...f })))
    if (error) console.error('[fba/plan] historial', error.message)
  }
}

/**
 * Reconcilia los envíos propuestos guardados del cliente con los de la pasada (D22). Antes, los envíos en preparación cuya remesa ya
 * salió pasan a `enviado`. Un 23505 (otra pasada insertó la misma clave) se resuelve volviendo a leer y reconciliando otra vez.
 */
export async function reconciliarCliente(
  service: Servicio,
  clienteId: string,
  plan: PlanCliente,
  pasadaId: string | null,
  completo: boolean,
): Promise<ResultadoReconciliar> {
  const salida: ResultadoReconciliar = { insertados: 0, actualizados: 0, caducados: 0, aEnviado: 0, huerfanos: 0, conflictos: 0 }
  const ahora = new Date().toISOString()

  for (let intento = 0; intento < 2; intento++) {
    const [act, cer] = await Promise.all([
      service.from('fba_envios_propuestos').select(COLUMNAS_ENVIO).eq('client_id', clienteId).in('estado', ACTIVOS),
      service.from('fba_envios_propuestos').select(COLUMNAS_ENVIO).eq('client_id', clienteId).in('estado', CERRADOS_RECIENTES)
        .gte('estado_cambiado_at', haceDias(plan.hoy, DIAS_CUARENTENA)),
    ])
    if (act.error) throw act.error
    if (cer.error) throw cer.error
    let activos = (act.data ?? []) as unknown as FilaEnvioPropuesto[]

    /* ---------- en preparación cuya remesa ya salió → enviado ---------- */
    const conRemesa = activos.filter((f) => f.estado === 'en_preparacion' && f.remesa_id)
    if (conRemesa.length) {
      const { data: rems } = await service.from('fba_remesas').select('id, estado').in('id', conRemesa.map((f) => f.remesa_id!))
      const salio = new Set(((rems ?? []) as Array<{ id: string; estado: string }>).filter((r) => r.estado === 'enviada' || r.estado === 'cerrada').map((r) => r.id))
      const pasan = conRemesa.filter((f) => salio.has(f.remesa_id!))
      for (const f of pasan) {
        const { error } = await service.from('fba_envios_propuestos')
          .update({ estado: 'enviado', estado_cambiado_at: ahora, actualizado_at: ahora })
          .eq('id', f.id).eq('estado', 'en_preparacion')
        if (error) throw error
      }
      await historial(service, pasan.map((f) => ({ envio_propuesto_id: f.id, accion: 'estado', de: 'en_preparacion', a: 'enviado', nota: 'La remesa ya ha salido' })))
      salida.aEnviado += pasan.length
      const fuera = new Set(pasan.map((f) => f.id))
      activos = activos.filter((f) => !fuera.has(f.id))
    }

    // Los hablados cuentan como llegada en el plan (mismo criterio que leerEntradaPlan): sus propios SKU no los pide el plan
    const cubiertosPorHablado = new Map<string, Set<string>>()
    for (const f of activos) {
      if (!(f.estado === 'hablado' || f.estado === 'esperando_cliente' || (f.estado === 'en_preparacion' && !f.remesa_id))) continue
      const ls = (f.lineas_aceptadas != null ? lista<LineaPlan>(f.lineas_aceptadas) : lista<LineaPlan>(f.lineas))
        .filter((l) => l && typeof l.sku === 'string' && Number(l.cantidad) > 0)
      if (ls.length) cubiertosPorHablado.set(f.id, new Set(ls.map((l) => l.sku)))
    }
    const r = reconciliarEnvios(
      activos.map(minimo),
      ((cer.data ?? []) as unknown as FilaEnvioPropuesto[]).map(minimo),
      plan.envios,
      plan.hoy,
      { completo, habladosQueCuentan: new Set(cubiertosPorHablado.keys()), ahora },
    )
    const porId = new Map(activos.map((f) => [f.id, f] as const))
    let conflicto = false

    /* ---------- huérfanos: en preparación sin remesa → hablado (D19) ---------- */
    // Solo los que llevan un rato sin remesa (mientras se convierte, la fila está así unos segundos): lo decide también la base
    const haceUnRato = new Date(Date.parse(ahora) - MINUTOS_HUERFANO * 60_000).toISOString()
    const huerfanos: string[] = []
    for (const id of r.huerfanosAHablado) {
      const { data: pasados, error } = await service.from('fba_envios_propuestos')
        .update({ estado: 'hablado', estado_cambiado_at: ahora, actualizado_at: ahora })
        .eq('id', id).eq('estado', 'en_preparacion').is('remesa_id', null).lt('estado_cambiado_at', haceUnRato)
        .select('id')
      if (error) throw error
      if (((pasados as unknown[] | null) ?? []).length > 0) huerfanos.push(id)
    }
    await historial(service, huerfanos.map((id) => ({ envio_propuesto_id: id, accion: 'remesa_borrada', de: 'en_preparacion', a: 'hablado', nota: 'La remesa ya no existe: vuelve a «hablado»' })))
    salida.huerfanos += huerfanos.length

    /* ---------- actualizar ---------- */
    const notas: Parameters<typeof historial>[1] = []
    for (const u of r.actualizar) {
      const g = porId.get(u.id)
      if (!g) continue
      const c = u.calculado
      let cambios: Record<string, unknown>
      if (!completo) {
        // Pasada sin datos: solo se refleja la prioridad (D22)
        cambios = { prioridad: c.prioridad, actualizado_at: ahora }
      } else if (u.soloLineas) {
        // hablado / esperando_cliente: lineas_aceptadas congeladas; se actualizan el plan de hoy y la prioridad
        cambios = { lineas: lineasConLasPropias(c.lineas, g, cubiertosPorHablado.get(g.id)), prioridad: c.prioridad, pasada_id: pasadaId, plan_ya_no_lo_pide: false, actualizado_at: ahora }
      } else {
        // nuevo: es del plan. La fecha límite solo sigue al plan si nadie la ha cambiado (era la de decidir)
        const limiteDelPlan = String(g.fecha_limite ?? '').slice(0, 10) === String(g.decidir_antes_de).slice(0, 10)
        // Lo que una persona ya ajustó a mano (excluir, factor, mover) se vuelve a aplicar sobre el plan de hoy: si no, se pierde solo
        const ajustesHechos = lista<AjusteIa>(g.ajustes_aplicados)
        let calculado = c
        if (ajustesHechos.length) {
          const r = reaplicarAjustes(c.lineas, ajustesHechos, plan.hoy, { plazo: plan.plazo, ajustes: plan.ajustes })
          if (r.aplicados > 0) {
            const cifras = cifrasDeLineas(r.lineas)
            calculado = { ...c, lineas: r.lineas, unidades: cifras.unidades, cajasEstimadas: cifras.cajasEstimadas }
          }
        }
        cambios = { ...filaDeCalculado(calculado, pasadaId), plan_ya_no_lo_pide: false, actualizado_at: ahora }
        if (limiteDelPlan) cambios.fecha_limite = c.decidirAntesDe
        if (c.clave !== g.clave) cambios.clave = c.clave
      }
      if (completo && u.cambios) cambios.cambios_desde_ayer = u.cambios
      // Solo si la fila sigue como se leyó: si entretanto una persona la ha convertido, pasado a «hablado» o cambiado la fecha
      // (eso sube `version`), la pasada no la pisa; la recoge la siguiente (D22/D23)
      const guardar = () => service.from('fba_envios_propuestos').update(cambios)
        .eq('id', u.id).eq('estado', g.estado).eq('version', g.version ?? 0)
        .select('id')
      let { data: tocadas, error } = await guardar()
      if (error && esConflicto(error) && 'clave' in cambios) {
        // La clave nueva ya la tiene otro activo: se actualiza sin cambiar la clave
        delete cambios.clave
        ;({ data: tocadas, error } = await guardar())
      }
      if (error) throw error
      if (((tocadas as unknown[] | null) ?? []).length === 0) continue
      salida.actualizados++
      if (u.anotarHistorial && completo) {
        notas.push({
          envio_propuesto_id: u.id, accion: 'actualizar_plan',
          de: `${g.unidades ?? 0} ud · ${g.prioridad}`, a: `${c.unidades} ud · ${c.prioridad}`,
          nota: u.cambios?.frases.slice(0, 3).join('. ') ?? null,
        })
      }
    }

    /* ---------- caducar y «el plan ya no lo pide» ---------- */
    for (const c of r.caducar) {
      const { error } = await service.from('fba_envios_propuestos')
        .update({ estado: 'caducado', estado_cambiado_at: ahora, actualizado_at: ahora, nota: c.motivo })
        .eq('id', c.id).eq('estado', 'nuevo')
      if (error) throw error
      notas.push({ envio_propuesto_id: c.id, accion: 'caducar', de: 'nuevo', a: 'caducado', nota: c.motivo })
    }
    salida.caducados += r.caducar.length
    if (r.marcarPlanYaNoLoPide.length) {
      const { error } = await service.from('fba_envios_propuestos').update({ plan_ya_no_lo_pide: true, actualizado_at: ahora }).in('id', r.marcarPlanYaNoLoPide)
      if (error) throw error
    }

    /* ---------- insertar ---------- */
    for (const c of r.insertar) {
      const { data, error } = await service.from('fba_envios_propuestos')
        .insert({ client_id: clienteId, clave: c.clave, estado: 'nuevo', fecha_limite: c.decidirAntesDe, ...filaDeCalculado(c, pasadaId) })
        .select('id')
        .single()
      if (error) {
        if (esConflicto(error)) {
          conflicto = true
          salida.conflictos++
          continue
        }
        throw error
      }
      salida.insertados++
      notas.push({ envio_propuesto_id: (data as { id: string }).id, accion: 'crear', a: 'nuevo', nota: `${c.unidades} ud · sale antes del ${c.salirAntesDe}` })
    }
    await historial(service, notas)
    if (!conflicto) break
  }
  return salida
}

/* ------------------------------------------------------------------ */
/* calcularYGuardarCliente                                             */
/* ------------------------------------------------------------------ */

export interface ResultadoCalculo {
  plan: PlanCliente
  pasadaId: string | null
  estado: 'ok' | 'provisional' | 'sin_datos' | 'error'
}

/**
 * Lee, calcula, guarda la pasada del día y reconcilia los envíos propuestos. Los avisos los manda quien llama (plan-avisos.ts),
 * así el POST manual y el cron deciden lo suyo. Nunca lanza por la 316: sin ella el plan sale igual y `pasadaId = null`.
 */
export async function calcularYGuardarCliente(
  service: Servicio,
  clienteId: string,
  hoy: string,
  origen: 'cron' | 'manual',
): Promise<ResultadoCalculo & { reconciliacion: ResultadoReconciliar | null; migracion316: boolean; avisar: boolean; clienteNombre: string }> {
  const t0 = Date.now()
  const ahora = new Date().toISOString()
  const leida = await leerEntradaPlan(service, clienteId, hoy, ahora)
  const r = await planificarConTemporadas(service, clienteId, leida.entrada)
  const plan = r.plan
  const estado = estadoDePasada(plan)
  const base = { plan, migracion316: leida.migracion316, avisar: leida.avisar, clienteNombre: leida.entrada.clienteNombre }

  if (!leida.migracion316) {
    if (!plan.calidad.avisos.includes(AVISO_FALTA_316)) plan.calidad.avisos.push(AVISO_FALTA_316)
    return { ...base, pasadaId: null, estado, reconciliacion: null }
  }

  /* ---------- la pasada del día (UNA por cliente y día) ---------- */
  const hash = hashDelPlan(plan)
  const { data: previa } = await service.from('fba_plan_ultima').select('hash, ia_pendiente').eq('client_id', clienteId).maybeSingle()
  const p = previa as { hash: string | null; ia_pendiente: boolean } | null
  const iaPendiente = plan.envios.length > 0 && (p?.hash !== hash || p?.ia_pendiente === true)
  const fila = {
    client_id: clienteId,
    connection_id: plan.connectionId,
    hoy,
    calculado_at: ahora,
    origen,
    estado,
    error: null,
    hash,
    ia_pendiente: iaPendiente,
    plazo: plazoParaGuardar(plan, r.previstos, r.movimientos90),
    calidad: plan.calidad,
    resumen: plan.resumen,
    lineas: plan.lineas,
    duracion_ms: Date.now() - t0,
  }
  const { data: guardada, error } = await service.from('fba_plan_pasadas').upsert(fila, { onConflict: 'client_id,hoy' }).select('id').single()
  if (error) {
    if (faltaLaTabla(error)) {
      plan.calidad.avisos.push(AVISO_FALTA_316)
      return { ...base, migracion316: false, pasadaId: null, estado, reconciliacion: null }
    }
    throw error
  }
  const pasadaId = (guardada as { id: string }).id

  /* ---------- reconciliar (D22): solo completa con libro leído ---------- */
  const completo = (estado === 'ok' || estado === 'provisional') && plan.calidad.libro !== 'sin_leer'
  const reconciliacion = await reconciliarCliente(service, clienteId, plan, pasadaId, completo)
  // La pasada se da por hecha al terminar: reconciliar toca `actualizado_at` de sus envíos y eso no es «algo nuevo» para el cron
  const { error: errFin } = await service.from('fba_plan_pasadas').update({ calculado_at: new Date().toISOString(), duracion_ms: Date.now() - t0 }).eq('id', pasadaId)
  if (errFin) console.error('[fba/plan] cerrar la pasada', errFin.message)
  invalidarCachePlan(clienteId)
  return { ...base, pasadaId, estado, reconciliacion }
}

/** Apunta una pasada fallida (sin líneas) para que la calidad lo enseñe. Nunca lanza */
export async function guardarPasadaConError(service: Servicio, clienteId: string, hoy: string, origen: 'cron' | 'manual', mensaje: string): Promise<void> {
  try {
    // No pisa una pasada buena del mismo día: solo escribe si no hay ninguna hoy
    const { data } = await service.from('fba_plan_pasadas').select('id, estado').eq('client_id', clienteId).eq('hoy', hoy).maybeSingle()
    if (data && (data as { estado: string }).estado !== 'error') return
    await service.from('fba_plan_pasadas').upsert(
      { client_id: clienteId, hoy, calculado_at: new Date().toISOString(), origen, estado: 'error', error: mensaje.slice(0, 500), ia_pendiente: false },
      { onConflict: 'client_id,hoy' },
    )
  } catch (e) {
    console.error('[fba/plan] guardar el error de la pasada', e)
  }
}

/* ------------------------------------------------------------------ */
/* leerUltimoPlan                                                      */
/* ------------------------------------------------------------------ */

export interface PasadaLeida {
  plan: PlanCliente
  calculadoAt: string
  pasada: { id: string; calculadoAt: string; origen: 'cron' | 'manual'; estado: string; error: string | null }
  /** Todas las líneas de la pasada (antes de filtrar), para quien necesite el total */
  totalLineas: number
}

const horasEntre = (desde: string, hasta: number): number => Math.max(0, Math.round(((hasta - Date.parse(desde)) / 3_600_000) * 10) / 10)

/** Una fila de `fba_plan_pasadas` → `PlanCliente` (puro salvo la hora de ahora, que se inyecta) */
export function planDesdePasada(
  f: { client_id: string; connection_id: string | null; hoy: string; calculado_at: string; plazo: unknown; calidad: unknown; resumen: unknown; lineas: unknown },
  ahoraMs: number,
): PlanCliente | null {
  const plazoGuardado = objeto<PlazoEtapas & { _pasada?: unknown }>(f.plazo)
  const extra = objeto<ExtraPasada>(plazoGuardado?._pasada)
  const calidad = objeto<PlanCliente['calidad']>(f.calidad)
  const resumen = objeto<PlanCliente['resumen']>(f.resumen)
  if (!plazoGuardado || typeof plazoGuardado.transporte !== 'number' || !extra || !calidad || !resumen) return null
  const { _pasada: _ignorado, ...plazo } = plazoGuardado
  void _ignorado
  const lineas = lista<LineaPlan>(f.lineas)
  const porSku = new Map(lineas.map((l) => [l.sku, l] as const))
  const envios: EnvioPropuestoCalculado[] = lista<ExtraPasada['envios'][number]>(extra.envios).map(({ skus, ...e }) => ({
    ...e,
    lineas: (skus ?? []).map((s) => porSku.get(s)).filter((l): l is LineaPlan => !!l),
  }))
  return {
    clienteId: f.client_id,
    connectionId: f.connection_id,
    hoy: String(f.hoy).slice(0, 10),
    moneda: extra.moneda || resumen.moneda || 'EUR',
    plazo: plazo as PlazoEtapas,
    ajustes: extra.ajustes,
    medidas: extra.medidas,
    calidad: { ...calidad, calculadoAt: f.calculado_at, horasDesdeCalculo: horasEntre(f.calculado_at, ahoraMs) },
    lineas,
    envios,
    enCamino: lista<EnCamino>(extra.enCamino),
    resumen,
    acierto: extra.acierto ?? null,
  }
}

/** Filtra las líneas de un plan leído según lo pedido (D28) */
export function filtrarLineas(lineas: LineaPlan[], hoy: string, opciones: { lineas: 'propuestas' | 'todas'; sku?: string; pagina?: number }): LineaPlan[] {
  if (opciones.sku) {
    const q = opciones.sku.trim().toLowerCase()
    return lineas.filter((l) => l.sku.toLowerCase() === q || l.sku.toLowerCase().includes(q) || (l.nombre ?? '').toLowerCase().includes(q))
  }
  if (opciones.lineas === 'propuestas') return lineasRelevantes(lineas, hoy)
  if (opciones.pagina !== undefined && opciones.pagina >= 1) {
    const i = (Math.floor(opciones.pagina) - 1) * LINEAS_POR_PAGINA
    return lineas.slice(i, i + LINEAS_POR_PAGINA)
  }
  return lineas
}

/** La última pasada guardada con su metadato. null si no hay ninguna (o falta la 316, que la ruta comprueba aparte) */
export async function leerUltimaPasada(
  service: Servicio,
  clienteId: string,
  opciones: { lineas: 'propuestas' | 'todas'; sku?: string; pagina?: number },
): Promise<PasadaLeida | null> {
  const { data, error } = await service
    .from('fba_plan_pasadas')
    .select('id, client_id, connection_id, hoy, calculado_at, origen, estado, error, plazo, calidad, resumen, lineas')
    .eq('client_id', clienteId)
    .neq('estado', 'error')
    .order('calculado_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    if (faltaLaTabla(error)) return null
    throw error
  }
  if (!data) return null
  const f = data as { id: string; client_id: string; connection_id: string | null; hoy: string; calculado_at: string; origen: 'cron' | 'manual'; estado: string; error: string | null; plazo: unknown; calidad: unknown; resumen: unknown; lineas: unknown }
  const plan = planDesdePasada(f, Date.now())
  if (!plan) return null
  const totalLineas = plan.lineas.length
  plan.lineas = filtrarLineas(plan.lineas, plan.hoy, opciones)
  return { plan, calculadoAt: f.calculado_at, pasada: { id: f.id, calculadoAt: f.calculado_at, origen: f.origen, estado: f.estado, error: f.error }, totalLineas }
}

/** Firma de §11.7 */
export async function leerUltimoPlan(
  service: Servicio,
  clienteId: string,
  opciones: { lineas: 'propuestas' | 'todas'; sku?: string; pagina?: number },
): Promise<{ plan: PlanCliente; calculadoAt: string } | null> {
  const p = await leerUltimaPasada(service, clienteId, opciones)
  return p ? { plan: p.plan, calculadoAt: p.calculadoAt } : null
}

/* ------------------------------------------------------------------ */
/* Lectura de envíos guardados con lo ya avisado (para plan-avisos)    */
/* ------------------------------------------------------------------ */

export async function enviosActivosConAvisos(
  service: Servicio,
  clienteIds: string[] | null,
  nombres: Map<string, string>,
  hoy: string,
): Promise<Array<EnvioPropuestoGuardado & { prioridadAvisada: Prioridad | null; vencidoAvisadoAt: string | null }>> {
  const filas = await leerTodo<FilaEnvioConAvisos>((a, b) => {
    let q = service.from('fba_envios_propuestos').select(`${COLUMNAS_ENVIO}, prioridad_avisada, vencido_avisado_at`).in('estado', ['nuevo', 'hablado', 'esperando_cliente'])
    if (clienteIds) q = q.in('client_id', clienteIds)
    return q.order('id', { ascending: true }).range(a, b)
  }).catch((e) => {
    if (faltaLaTabla(e as { code?: string })) return [] as FilaEnvioConAvisos[]
    throw e
  })
  const personas = new Map<string, string>()
  return filas.map((f) => ({
    ...filaAGuardado(f, { clientes: nombres, personas }, hoy),
    prioridadAvisada: (f.prioridad_avisada ?? null) as Prioridad | null,
    vencidoAvisadoAt: f.vencido_avisado_at ?? null,
  }))
}
