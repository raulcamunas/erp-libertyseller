import { leerTodo } from './paginar'
import { createServiceClient } from '@/lib/supabase/service'
import {
  calcularInventario,
  sumarDiasInv,
  type EnvioInventario,
  type InventarioDeCliente,
  type ListingInventario,
  type MovimientoInventario,
} from './inventario'
import { edadVacia, faltaLaTabla, resumirEdadAmazon, TRAMOS_AMAZON, type EdadAmazon, type FilaPlanificacion } from './planificacion'
import { elegirLectura, stockEntreMercados } from './lectura-elegida'
import type { FilaStock } from './plan-tipos'
import { marketplaceLabel } from '@/lib/types/amazon'

/**
 * LEER DE LA BASE LO QUE EL INVENTARIO NECESITA, Y NADA MÁS.
 * ==========================================================
 * SOLO SERVIDOR. Aquí no se decide nada: lee, junta y llama a calcularInventario
 * (lib/fba/inventario.ts), que es la función pura que se prueba sola.
 *
 *
 * ============ NO PASA POR panelDeCliente, Y ES A PROPÓSITO ============
 *
 * El panel de remesas calcula el reparto FIFO SOBRE LOS ENVÍOS REGISTRADOS en el ERP. Para
 * saber cuánto lleva parado el stock de un cliente hace falta además el de antes, el de
 * los envíos que nadie registró, y eso solo lo trae el libro mayor: cada llegada a Amazon
 * es una entrada (`Receipts`) con su día. Así que el inventario se calcula desde el libro y
 * el espejo del catálogo, y los envíos del ERP solo aportan lo que todavía viene de camino
 * y el nombre con el que el equipo los conoce.
 *
 * Se pide aparte, desde la pestaña Inventario y no al abrir la pantalla: son los
 * movimientos de varios meses de un cliente, y quien solo mira un envío no tiene por qué
 * esperarlos.
 *
 *
 * ============ LO QUE SE LEE ============
 *
 *   · Los listings con stock en Amazon, y los que han vendido aunque ahora estén a cero:
 *     un producto agotado es justo el que hay que reponer.
 *   · El libro mayor entero de esa conexión y ese mercado, paginado: una sola petición de
 *     PostgREST devuelve como mucho mil filas y callarse el resto sería un inventario al
 *     que le faltan las ventas, sin ningún error.
 *   · Los envíos del cliente con sus líneas.
 *
 *
 * ============ CAMBIOS DE COMPORTAMIENTO (remesas-pro, 15 nov 2026) ============
 *
 *   · LA COPIA DEL LIBRO SE ELIGE POR COBERTURA (spec §0.2, D35). Antes: España si existía (Creative Toys leía la copia de
 *     España al 6 nov teniendo la de Italia al 15) y la conexión era la primera activa con un `limit(1)` sin orden. Ahora
 *     `lecturaDeCliente` mira todas las conexiones activas y todas sus lecturas y aplica `elegirLectura`: la más reciente
 *     entre las que cubren la historia necesaria. La conexión es la de esa lectura; con dos activas, aviso.
 *   · STOCK ENTRE MERCADOS (D11). Una referencia con movimientos y sin fila en el mercado elegido toma el stock de otro
 *     mercado de la conexión con `stockEntreMercados` (el mayor reciente, nunca la suma; si solo hay viejo, se usa y se dice).
 *     Antes se quedaba sin listing (stock 0 y sin nombre).
 *   · El aviso de «stock en otros mercados» ya no dice «Amazon.es» fijo: dice el mercado de la lectura.
 */

const PAGINA = 1000
const MARKETPLACE_ESPANA = 'A1RKKUPIHCS9HS'
/** Lo más atrás que lee la sincronización del libro (lib/fba/ledger.ts: MAXIMO_HISTORICO_DIAS) */
const HISTORICO_DIAS = 540
/** Tope de seguridad: un cliente con más movimientos que esto no cabe en memoria de una petición */
const MAX_MOVIMIENTOS = 400_000

interface FilaListing {
  sku: string
  asin: string | null
  fnsku: string | null
  title: string | null
  price: number | string | null
  currency: string | null
  fba_quantity: number | null
  fba_fulfillable_quantity: number | null
  // Migración 271: si todavía no está lanzada no vienen y la cuenta sigue como antes
  fba_inbound_quantity?: number | null
  fba_reserved_quantity?: number | null
  fba_unfulfillable_quantity?: number | null
}

const aListing = (l: FilaListing): ListingInventario => ({
  sku: l.sku,
  asin: l.asin,
  fnsku: l.fnsku,
  titulo: l.title,
  // NUMERIC llega como cadena según cómo lo lea PostgREST: «14.99»
  precio: l.price === null || l.price === undefined ? null : Number.isFinite(Number(l.price)) ? Number(l.price) : null,
  moneda: l.currency,
  enAmazon: typeof l.fba_quantity === 'number' ? l.fba_quantity : null,
  vendibles: typeof l.fba_fulfillable_quantity === 'number' ? l.fba_fulfillable_quantity : null,
  entranteAmazon: typeof l.fba_inbound_quantity === 'number' ? l.fba_inbound_quantity : null,
  reservadas: typeof l.fba_reserved_quantity === 'number' ? l.fba_reserved_quantity : null,
  noAptas: typeof l.fba_unfulfillable_quantity === 'number' ? l.fba_unfulfillable_quantity : null,
})

const COLUMNAS_LISTING = 'sku, asin, fnsku, title, price, currency, fba_quantity, fba_fulfillable_quantity'
const COLUMNAS_LISTING_CON_DESGLOSE = `${COLUMNAS_LISTING}, fba_inbound_quantity, fba_reserved_quantity, fba_unfulfillable_quantity`

/**
 * Lee listings pidiendo el desglose del stock (migración 271) y, si esa migración todavía no se ha
 * lanzado (42703, columna inexistente), repite SIN él: el inventario sigue funcionando como antes en
 * vez de quedarse en blanco por una columna que solo mejora un dato.
 */
async function leerListings(
  consulta: (columnas: string) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>
): Promise<FilaListing[]> {
  let r = await consulta(COLUMNAS_LISTING_CON_DESGLOSE)
  if (r.error && r.error.code === '42703') r = await consulta(COLUMNAS_LISTING)
  if (r.error) throw r.error
  return (r.data ?? []) as FilaListing[]
}

type Servicio = ReturnType<typeof createServiceClient>

/**
 * LOS ENVÍOS DEL ERP DE UN CLIENTE, CON SUS LÍNEAS.
 *
 * Los usa el inventario (para lo que viene de camino) y el motor de propuestas (para medir
 * cuánto tardan de verdad los envíos de este cliente en estar a la venta).
 */
export async function enviosDelCliente(service: Servicio, clienteId: string): Promise<EnvioInventario[]> {
  const { data: remesas } = await service
    .from('fba_remesas')
    .select('id, nombre, fecha_envio, llegada_at, estado_amazon, estado, referencia_envio')
    .eq('client_id', clienteId)
  const filasRemesa = (remesas ?? []) as Array<{
    id: string
    nombre: string | null
    fecha_envio: string
    llegada_at: string | null
    estado_amazon: string | null
    estado: string | null
    referencia_envio: string | null
  }>
  const envios: EnvioInventario[] = []
  if (filasRemesa.length === 0) return envios

  // Paginadas: las líneas de TODOS los envíos de un cliente con muchas referencias pasan de 1.000 y Supabase las cortaría sin avisar
  const lineas = await leerTodo<{ remesa_id: string; sku: string; unidades: number; unidades_recibidas: number | null }>((a, b) =>
    service
      .from('fba_remesa_lineas')
      .select('remesa_id, sku, unidades, unidades_recibidas')
      .in('remesa_id', filasRemesa.map((r) => r.id))
      .order('id', { ascending: true })
      .range(a, b)
  )
  const porRemesa = new Map<string, EnvioInventario['lineas']>()
  for (const l of lineas) {
    const lista = porRemesa.get(l.remesa_id) ?? []
    lista.push({ sku: l.sku, unidades: l.unidades, recibidas: l.unidades_recibidas })
    porRemesa.set(l.remesa_id, lista)
  }
  for (const r of filasRemesa) {
    envios.push({
      id: r.id,
      nombre: r.nombre,
      fechaEnvio: r.fecha_envio,
      llegadaAt: r.llegada_at,
      estadoAmazon: r.estado_amazon,
      // Sin estado = remesa de antes de la migración 195: historia, o sea cerrada
      estado: r.estado ?? 'cerrada',
      referenciaEnvio: r.referencia_envio,
      lineas: porRemesa.get(r.id) ?? [],
    })
  }
  return envios
}

/** Más allá de esto la foto de antigüedad de Amazon ya no se cree: se vuelve a la estimada */
const DIAS_QUE_VALE_LA_FOTO = 5

/** Un reparto por tramos guardado en JSON, saneado: lo que no sea un número no cuenta */
function edadDeJson(crudo: unknown): EdadAmazon {
  const e = edadVacia()
  if (typeof crudo !== 'object' || crudo === null) return e
  const o = crudo as Record<string, unknown>
  for (const t of TRAMOS_AMAZON) {
    const v = o[t.id]
    e[t.id] = typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0
  }
  return e
}

/**
 * LA ANTIGÜEDAD QUE GUARDÓ LA ÚLTIMA LECTURA DEL INFORME DE AMAZON.
 *
 * `tabla: false` es «falta lanzar la migración 231»: no es un error del cliente ni se cuenta como
 * tal. Cualquier otro fallo de lectura sí se lanza.
 */
async function planificacionGuardada(
  service: Servicio,
  conexion: string,
  mercado: string
): Promise<{ tabla: boolean; filas: FilaPlanificacion[]; fechaFoto: string | null; leidoAt: string | null }> {
  const filas: FilaPlanificacion[] = []
  let fechaFoto: string | null = null
  let leidoAt: string | null = null
  for (let inicio = 0; ; inicio += PAGINA) {
    const { data, error } = await service
      .from('fba_planificacion')
      .select('sku, fecha_foto, disponible, no_vendible, edad, recargo, coste_mes, moneda, dias_suministro, accion, updated_at')
      .eq('connection_id', conexion)
      .eq('marketplace_id', mercado)
      .order('sku', { ascending: true })
      .range(inicio, inicio + PAGINA - 1)
    if (error) {
      if (faltaLaTabla(error)) return { tabla: false, filas: [], fechaFoto: null, leidoAt: null }
      throw error
    }
    const pagina = (data ?? []) as Array<{
      sku: string
      fecha_foto: string | null
      disponible: number | null
      no_vendible: number | null
      edad: unknown
      recargo: unknown
      coste_mes: number | string | null
      moneda: string | null
      dias_suministro: number | string | null
      accion: string | null
      updated_at: string
    }>
    for (const f of pagina) {
      const coste = f.coste_mes === null || f.coste_mes === undefined ? null : Number(f.coste_mes)
      const dias = f.dias_suministro === null || f.dias_suministro === undefined ? null : Number(f.dias_suministro)
      filas.push({
        sku: f.sku,
        fnsku: null,
        asin: null,
        disponible: f.disponible ?? 0,
        noVendible: f.no_vendible ?? 0,
        edad: edadDeJson(f.edad),
        costeMes: coste !== null && Number.isFinite(coste) ? coste : null,
        recargo: edadDeJson(f.recargo),
        moneda: f.moneda,
        diasSuministro: dias !== null && Number.isFinite(dias) ? dias : null,
        accion: f.accion,
      })
      if (f.fecha_foto && (!fechaFoto || f.fecha_foto > fechaFoto)) fechaFoto = f.fecha_foto
      if (!leidoAt || f.updated_at > leidoAt) leidoAt = f.updated_at
    }
    if (pagina.length < PAGINA) break
  }
  return { tabla: true, filas, fechaFoto, leidoAt }
}

/* ------------------------------------------------------------------ */
/* Qué copia del libro se lee (spec remesas-pro §0.2, D34 y D35)       */
/* ------------------------------------------------------------------ */

/** Lo más atrás que hace falta mirar para el ritmo y la estacionalidad si el cliente envía desde antes */
const DIAS_HISTORIA_NECESARIA = 400

export interface LecturaDeCliente {
  /** La conexión de la lectura elegida (con dos activas, la de la copia que gana) */
  connectionId: string
  /** Cuántas conexiones activas tiene el cliente (hoy una; con dos se avisa) */
  conexionesActivas: number
  region: 'eu' | 'na' | 'fe' | null
  /** El mercado de la copia del libro elegida: de aquí salen el libro y el stock */
  marketplaceId: string
  /** La fila de `fba_lecturas` elegida; null si la conexión nunca se ha leído */
  lectura: { leidoHasta: string | null; leidoDesde: string | null; intentoAt: string | null; error: string | null } | null
  /** `aviso` de `elegirLectura` («Ventas hasta el 6 nov: …») */
  aviso: string | null
  /** Avisos para la pantalla, ya redactados: el de la lectura y el de dos conexiones activas */
  avisos: string[]
}

const regionDe = (r: unknown): LecturaDeCliente['region'] => (r === 'eu' || r === 'na' || r === 'fe' ? r : null)

/**
 * LA CONEXIÓN Y LA COPIA DEL LIBRO DE UN CLIENTE, con la regla única `elegirLectura` (lectura-elegida.ts).
 *
 * Antes cada pantalla elegía a su manera: el inventario cogía España si existía (aunque fuera 9 días atrasada) y la primera
 * conexión activa con `limit(1)` sin orden; el panel cogía el mercado de la primera remesa. Ahora:
 *   · se miran TODAS las conexiones activas del cliente y todas sus lecturas;
 *   · `leidoDesde` de cada lectura es su primer movimiento (una consulta `order fecha asc limit 1` por lectura con fecha);
 *   · `desdeNecesario` = el primer envío real del cliente o hoy − 400, lo que sea más reciente;
 *   · gana la más reciente entre las que cubren esa historia (si ninguna cubre, la de más historia, con aviso);
 *   · la conexión es la de la lectura que gana; con dos conexiones activas se dice.
 * Sin ninguna lectura: la conexión más antigua y su mercado por defecto (o España).
 * null = el cliente no tiene ninguna conexión activa.
 */
export async function lecturaDeCliente(service: Servicio, clienteId: string, hoy: string): Promise<LecturaDeCliente | null> {
  const { data: conexiones, error: errConexiones } = await service
    .from('amazon_connections')
    .select('id, region, default_marketplace_id, created_at')
    .eq('client_id', clienteId)
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
  if (errConexiones) throw errConexiones
  const activas = (conexiones ?? []) as Array<{ id: string; region: string | null; default_marketplace_id: string | null }>
  if (activas.length === 0) return null

  const { data: filasLectura, error: errLecturas } = await service
    .from('fba_lecturas')
    .select('connection_id, marketplace_id, leido_hasta, ultimo_intento_at, ultimo_error')
    .in(
      'connection_id',
      activas.map((c) => c.id)
    )
  if (errLecturas) throw errLecturas
  const lecturas = (filasLectura ?? []) as Array<{
    connection_id: string
    marketplace_id: string
    leido_hasta: string | null
    ultimo_intento_at: string | null
    ultimo_error: string | null
  }>

  // El primer día de cada copia del libro (solo de las que tienen fecha: las demás no compiten si hay alguna con fecha)
  const candidatas = await Promise.all(
    lecturas.map(async (l) => {
      let leidoDesde: string | null = null
      if (l.leido_hasta) {
        const { data: primero } = await service
          .from('fba_movimientos')
          .select('fecha')
          .eq('connection_id', l.connection_id)
          .eq('marketplace_id', l.marketplace_id)
          .order('fecha', { ascending: true })
          .limit(1)
          .maybeSingle()
        leidoDesde = (primero as { fecha: string } | null)?.fecha ?? null
      }
      return {
        marketplaceId: l.marketplace_id,
        leidoHasta: l.leido_hasta,
        leidoDesde,
        ultimoError: l.ultimo_error,
        connectionId: l.connection_id,
        intentoAt: l.ultimo_intento_at,
      }
    })
  )

  // Desde cuándo hace falta historia: el primer envío real o hoy − 400, lo más reciente de los dos
  const { data: primerEnvio } = await service
    .from('fba_remesas')
    .select('fecha_envio')
    .eq('client_id', clienteId)
    .or('estado.is.null,estado.in.(enviada,cerrada)')
    .order('fecha_envio', { ascending: true })
    .limit(1)
    .maybeSingle()
  const haceCuatrocientos = sumarDiasInv(hoy, -DIAS_HISTORIA_NECESARIA)
  const primero = (primerEnvio as { fecha_envio: string | null } | null)?.fecha_envio?.slice(0, 10) ?? null
  const desdeNecesario = primero && primero > haceCuatrocientos ? primero : haceCuatrocientos

  const avisos: string[] = []
  const eleccion = elegirLectura(candidatas, desdeNecesario)
  const conexion = eleccion ? activas.find((c) => c.id === eleccion.elegida.connectionId) ?? activas[0] : activas[0]
  if (eleccion?.aviso) avisos.push(eleccion.aviso)
  if (activas.length > 1) {
    avisos.push(
      `Este cliente tiene ${activas.length} conexiones de Amazon activas: se usa la de la copia del libro elegida${eleccion ? ` (${marketplaceLabel(eleccion.elegida.marketplaceId)})` : ''}. Desactiva la que sobre en Integraciones.`
    )
  }

  return {
    connectionId: conexion.id,
    conexionesActivas: activas.length,
    region: regionDe(conexion.region),
    marketplaceId: eleccion?.elegida.marketplaceId ?? conexion.default_marketplace_id ?? MARKETPLACE_ESPANA,
    lectura: eleccion
      ? { leidoHasta: eleccion.elegida.leidoHasta, leidoDesde: eleccion.elegida.leidoDesde, intentoAt: eleccion.elegida.intentoAt, error: eleccion.elegida.ultimoError }
      : null,
    aviso: eleccion?.aviso ?? null,
    avisos,
  }
}

/* ------------------------------------------------------------------ */
/* Stock de las referencias que no tienen fila en el mercado elegido   */
/* ------------------------------------------------------------------ */

interface FilaListingOtroMercado extends FilaListing {
  marketplace_id: string
  updated_at: string | null
  listing_status: string[] | null
}

/**
 * Las filas de OTROS mercados de la misma conexión para los SKU que no tienen fila en el elegido (D11), en trozos de 150.
 * `stockEntreMercados` elige después la mayor reciente.
 *
 * `soloConStock` (por defecto, como pide D11): solo filas con `fba_quantity > 0 or fba_fulfillable_quantity > 0`. El inventario y
 * el panel lo apagan: una referencia AGOTADA en todos los mercados también necesita su fila (nombre, precio y un stock 0 que
 * cuadra) — es justo la que hay que reponer. Con Creative Toys la copia elegida es la de Italia, que no tiene ningún listing: con
 * el filtro, 28 de sus 70 referencias se quedaban sin stock real.
 */
export async function filasDeOtrosMercados(
  service: Servicio,
  conexion: string,
  mercado: string,
  skus: readonly string[],
  opciones: { soloConStock?: boolean } = {}
): Promise<FilaListingOtroMercado[]> {
  const soloConStock = opciones.soloConStock ?? true
  const salida: FilaListingOtroMercado[] = []
  for (let i = 0; i < skus.length; i += 150) {
    const filas = (await leerListings((columnas) => {
      const q = service
        .from('amazon_listings')
        .select(`${columnas}, marketplace_id, updated_at, listing_status`)
        .eq('connection_id', conexion)
        .neq('marketplace_id', mercado)
        .in('sku', skus.slice(i, i + 150))
      return soloConStock ? q.or('fba_quantity.gt.0,fba_fulfillable_quantity.gt.0') : q
    })) as FilaListingOtroMercado[]
    salida.push(...filas)
  }
  return salida
}

/** La fila de otro mercado en la forma de `stockEntreMercados` */
export function filaDeStock(f: FilaListingOtroMercado): FilaStock {
  const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  return {
    marketplaceId: f.marketplace_id,
    sku: f.sku,
    vendibles: n(f.fba_fulfillable_quantity) ?? 0,
    entrante: n(f.fba_inbound_quantity) ?? 0,
    reservadas: n(f.fba_reserved_quantity),
    noApto: n(f.fba_unfulfillable_quantity),
    precio: f.price === null || f.price === undefined || !Number.isFinite(Number(f.price)) ? null : Number(f.price),
    moneda: f.currency,
    listingStatus: f.listing_status,
    updatedAt: f.updated_at,
  }
}

export async function inventarioDeCliente(clienteId: string, opciones: { hoy: string }): Promise<InventarioDeCliente> {
  const service = createServiceClient()

  const vacio = (conectado: boolean, marketplaceId: string | null): InventarioDeCliente => ({
    ...calcularInventario({ hoy: opciones.hoy, leidoHasta: null, listings: [], movimientos: [], envios: [] }),
    conectado,
    marketplaceId,
    conexionId: null,
    lectura: null,
    edadAmazon: null,
    planificacion: { tabla: true, leidoAt: null, error: null },
  })

  /* ---------- la conexión y el mercado: la lectura elegida (§0.2, D35) ---------- */
  const elegida = await lecturaDeCliente(service, clienteId, opciones.hoy)
  if (!elegida) return vacio(false, null)
  const connectionId = elegida.connectionId
  const marketplaceId = elegida.marketplaceId
  const lectura = elegida.lectura

  /* ---------- el libro mayor, paginado ---------- */
  const desde = sumarDiasInv(opciones.hoy, -HISTORICO_DIAS)
  const movimientos: MovimientoInventario[] = []
  for (let inicio = 0; movimientos.length < MAX_MOVIMIENTOS; inicio += PAGINA) {
    const { data, error } = await service
      .from('fba_movimientos')
      .select('sku, fecha, tipo, cantidad, disposicion, referencia')
      .eq('connection_id', connectionId)
      .eq('marketplace_id', marketplaceId)
      .gte('fecha', desde)
      .order('fecha', { ascending: true })
      .order('id', { ascending: true })
      .range(inicio, inicio + PAGINA - 1)
    if (error) throw error
    const filas = (data ?? []) as Array<{
      sku: string
      fecha: string
      tipo: string
      cantidad: number
      disposicion: string | null
      referencia: string | null
    }>
    for (const f of filas) {
      movimientos.push({ sku: f.sku, fecha: f.fecha, tipo: f.tipo, cantidad: f.cantidad, disposicion: f.disposicion, referencia: f.referencia })
    }
    if (filas.length < PAGINA) break
  }

  /* ---------- el catálogo: lo que tiene stock y lo que ha vendido ---------- */
  const listings = new Map<string, ListingInventario>()
  for (let inicio = 0; ; inicio += PAGINA) {
    const filas = await leerListings((columnas) =>
      service
        .from('amazon_listings')
        .select(columnas)
        .eq('connection_id', connectionId)
        .eq('marketplace_id', marketplaceId)
        .or('fba_quantity.gt.0,fba_fulfillable_quantity.gt.0')
        .order('sku', { ascending: true })
        .range(inicio, inicio + PAGINA - 1)
    )
    for (const f of filas) listings.set(f.sku, aListing(f))
    if (filas.length < PAGINA) break
  }
  // Los que han vendido o recibido y ahora están a cero: sin ellos no se vería lo agotado
  const faltan = [...new Set(movimientos.map((m) => m.sku))].filter((s) => !listings.has(s))
  for (let i = 0; i < faltan.length; i += 150) {
    const filas = await leerListings((columnas) =>
      service
        .from('amazon_listings')
        .select(columnas)
        .eq('connection_id', connectionId)
        .eq('marketplace_id', marketplaceId)
        .in('sku', faltan.slice(i, i + 150))
    )
    for (const f of filas) listings.set(f.sku, aListing(f))
  }

  /**
   * LAS REFERENCIAS SIN FILA EN EL MERCADO ELEGIDO (§0.2 y D11). ShoesF tiene SKU con ventas en el libro y sin fila en España:
   * su stock sale de otro mercado de la misma conexión, el MAYOR y nunca la suma (el stock paneuropeo se repite en cada país),
   * y solo de filas de los últimos 2 días; si solo las hay viejas, la más reciente y se dice. Lo elige `stockEntreMercados`.
   */
  const sinFila = [...new Set(movimientos.map((m) => m.sku))].filter((s) => !listings.has(s))
  let deOtroMercado = 0
  let viejas = 0
  let masVieja = 0
  // Lo que tiene stock en otros mercados y no tiene fila aquí, aunque no se haya movido en el libro (stock parado de verdad:
  // antes salía por la fila con stock del mercado de la lectura, y con la copia de Italia elegida no habría fila ninguna)
  const otrasConStock: FilaListingOtroMercado[] = []
  for (let inicio = 0; otrasConStock.length < MAX_MOVIMIENTOS; inicio += PAGINA) {
    const filas = (await leerListings((columnas) =>
      service
        .from('amazon_listings')
        .select(`${columnas}, marketplace_id, updated_at, listing_status`)
        .eq('connection_id', connectionId)
        .neq('marketplace_id', marketplaceId)
        .or('fba_quantity.gt.0,fba_fulfillable_quantity.gt.0')
        .order('sku', { ascending: true })
        .order('marketplace_id', { ascending: true })
        .range(inicio, inicio + PAGINA - 1)
    )) as FilaListingOtroMercado[]
    otrasConStock.push(...filas.filter((f) => !listings.has(f.sku)))
    if (filas.length < PAGINA) break
  }
  const conStockFuera = new Set(otrasConStock.map((f) => f.sku))
  const sinFilaNiStock = sinFila.filter((s) => !conStockFuera.has(s))
  if (otrasConStock.length > 0 || sinFilaNiStock.length > 0) {
    const otras = [...otrasConStock, ...(sinFilaNiStock.length > 0 ? await filasDeOtrosMercados(service, connectionId, marketplaceId, sinFilaNiStock, { soloConStock: false }) : [])]
    const crudas = new Map(otras.map((f) => [`${f.marketplace_id}|${f.sku}`, f] as const))
    for (const [sku, e] of Array.from(stockEntreMercados(otras.map(filaDeStock), marketplaceId, opciones.hoy).entries())) {
      const f = crudas.get(`${e.marketplaceId}|${sku}`)
      if (!f) continue
      listings.set(sku, aListing(f))
      deOtroMercado++
      if (e.viejoDias !== null) {
        viejas++
        masVieja = Math.max(masVieja, e.viejoDias)
      }
    }
  }

  /* ---------- los envíos del ERP ---------- */
  const envios = await enviosDelCliente(service, clienteId)

  const inventario = calcularInventario({
    hoy: opciones.hoy,
    leidoHasta: lectura?.leidoHasta ?? null,
    listings: [...listings.values()],
    movimientos,
    envios,
  })
  // Sin fecha de lectura el inventario ya dice «Todavía no se ha leído el libro mayor»: no se repite
  // y si ya dice «El libro mayor solo cubre N días», no se repite que falta historia
  const yaDiceQueEsCorto = inventario.avisos.some((a) => a.startsWith('El libro mayor solo cubre'))
  if (lectura?.leidoHasta) {
    for (const a of elegida.avisos) {
      if (yaDiceQueEsCorto && a.startsWith('Las ventas solo están leídas desde')) continue
      inventario.avisos.push(a.endsWith('.') ? a : `${a}.`)
    }
  }
  // Solo se dice si el dato es viejo: que el stock venga de otro país de la cuenta es lo normal en Pan-UE y no cambia la cifra
  if (viejas > 0) {
    inventario.avisos.push(
      `${viejas} referencia${viejas === 1 ? '' : 's'} sin fila en ${marketplaceLabel(marketplaceId)} toma${viejas === 1 ? '' : 'n'} el stock de otro mercado de la cuenta con un dato de hace hasta ${masVieja} días: puede no ser el de hoy.`
    )
  }

  /**
   * ¿HAY STOCK EN OTROS MERCADOS?
   *
   * Un cliente que vende en toda Europa (Pan-EU, EFN) ve en cada mercado una foto distinta
   * —y parecida— del mismo inventario. Aquí se cuenta UN mercado, el de la copia del libro
   * elegida, y sumar los demás duplicaría unidades. Pero callarse que existen sería enseñar 25
   * unidades de un cliente que tiene cien repartidas.
   */
  const { data: otros } = await service
    .from('amazon_listings')
    .select('marketplace_id')
    .eq('connection_id', connectionId)
    .neq('marketplace_id', marketplaceId)
    .or('fba_quantity.gt.0,fba_fulfillable_quantity.gt.0')
    .limit(1000)
  const mercados = new Set(((otros ?? []) as Array<{ marketplace_id: string }>).map((o) => o.marketplace_id))
  // Si ya se ha tomado stock de otros mercados, este aviso confundiría («aquí se cuenta Italia» cuando lo de Italia no existe)
  if (mercados.size > 0 && deOtroMercado === 0) {
    inventario.avisos.push(
      `Este cliente tiene stock visible en ${mercados.size} mercado${mercados.size === 1 ? '' : 's'} más (venta paneuropea). Aquí se cuenta ${marketplaceLabel(marketplaceId)}, el de la copia del libro mayor que se lee: sumarlos duplicaría unidades.`
    )
  }

  /* ---------- la antigüedad que cuenta Amazon ---------- */
  const guardada = await planificacionGuardada(service, connectionId, marketplaceId)

  // Cómo fue la última lectura de ese informe: columnas de la misma migración, así que aparte y tolerante
  let leidoAt: string | null = guardada.leidoAt
  let errorPlanificacion: string | null = null
  const { data: estado, error: errorEstado } = await service
    .from('fba_lecturas')
    .select('planificacion_at, planificacion_error')
    .eq('connection_id', connectionId)
    .eq('marketplace_id', marketplaceId)
    .maybeSingle()
  if (!errorEstado && estado) {
    const e = estado as { planificacion_at: string | null; planificacion_error: string | null }
    leidoAt = e.planificacion_at ?? leidoAt
    errorPlanificacion = e.planificacion_error
  }

  let edadAmazon: InventarioDeCliente['edadAmazon'] = null
  if (guardada.filas.length > 0) {
    const leido = (guardada.leidoAt ?? '').slice(0, 10)
    const diasDesdeLaLectura = leido ? Math.round((Date.parse(`${opciones.hoy}T00:00:00Z`) - Date.parse(`${leido}T00:00:00Z`)) / 86_400_000) : 0
    if (diasDesdeLaLectura <= DIAS_QUE_VALE_LA_FOTO) {
      const precios = new Map(inventario.skus.map((k) => [k.sku, k.precio] as const))
      edadAmazon = resumirEdadAmazon({ filas: guardada.filas, fecha: guardada.fechaFoto ?? leido ?? opciones.hoy, precios })
      for (const k of inventario.skus) k.edadAmazon = edadAmazon.porSku[k.sku] ?? null
    } else {
      inventario.avisos.push(
        `La antigüedad que cuenta Amazon es de hace ${diasDesdeLaLectura} días y ya no se usa: la tarjeta enseña la que se estima del libro mayor. Se vuelve a leer cada noche.`
      )
    }
  }

  return {
    ...inventario,
    conectado: true,
    marketplaceId,
    conexionId: connectionId,
    lectura: lectura ? { intentoAt: lectura.intentoAt, error: lectura.error } : null,
    edadAmazon,
    planificacion: { tabla: guardada.tabla, leidoAt, error: errorPlanificacion },
  }
}
