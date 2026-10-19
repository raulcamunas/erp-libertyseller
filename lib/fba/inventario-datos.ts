import { createServiceClient } from '@/lib/supabase/service'
import {
  calcularInventario,
  sumarDiasInv,
  type EnvioInventario,
  type InventarioDeCliente,
  type ListingInventario,
  type MovimientoInventario,
} from './inventario'

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
})

const COLUMNAS_LISTING = 'sku, asin, fnsku, title, price, currency, fba_quantity, fba_fulfillable_quantity'

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

  const { data: lineas } = await service
    .from('fba_remesa_lineas')
    .select('remesa_id, sku, unidades, unidades_recibidas')
    .in('remesa_id', filasRemesa.map((r) => r.id))
  const porRemesa = new Map<string, EnvioInventario['lineas']>()
  for (const l of (lineas ?? []) as Array<{ remesa_id: string; sku: string; unidades: number; unidades_recibidas: number | null }>) {
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

export async function inventarioDeCliente(clienteId: string, opciones: { hoy: string }): Promise<InventarioDeCliente> {
  const service = createServiceClient()

  const vacio = (conectado: boolean, marketplaceId: string | null): InventarioDeCliente => ({
    ...calcularInventario({ hoy: opciones.hoy, leidoHasta: null, listings: [], movimientos: [], envios: [] }),
    conectado,
    marketplaceId,
  })

  /* ---------- la conexión y el mercado ---------- */
  const { data: conexion } = await service
    .from('amazon_connections')
    .select('id')
    .eq('client_id', clienteId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()
  const connectionId = (conexion as { id: string } | null)?.id ?? null
  if (!connectionId) return vacio(false, null)

  const { data: lecturas } = await service
    .from('fba_lecturas')
    .select('marketplace_id, leido_hasta')
    .eq('connection_id', connectionId)
  const filasLectura = (lecturas ?? []) as Array<{ marketplace_id: string; leido_hasta: string | null }>
  // España si se lee; si no, el que más al día esté
  const lectura =
    filasLectura.find((l) => l.marketplace_id === MARKETPLACE_ESPANA) ??
    [...filasLectura].sort((a, b) => (b.leido_hasta ?? '').localeCompare(a.leido_hasta ?? ''))[0] ??
    null
  const marketplaceId = lectura?.marketplace_id ?? MARKETPLACE_ESPANA

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
    const { data, error } = await service
      .from('amazon_listings')
      .select(COLUMNAS_LISTING)
      .eq('connection_id', connectionId)
      .eq('marketplace_id', marketplaceId)
      .or('fba_quantity.gt.0,fba_fulfillable_quantity.gt.0')
      .order('sku', { ascending: true })
      .range(inicio, inicio + PAGINA - 1)
    if (error) throw error
    const filas = (data ?? []) as FilaListing[]
    for (const f of filas) listings.set(f.sku, aListing(f))
    if (filas.length < PAGINA) break
  }
  // Los que han vendido o recibido y ahora están a cero: sin ellos no se vería lo agotado
  const faltan = [...new Set(movimientos.map((m) => m.sku))].filter((s) => !listings.has(s))
  for (let i = 0; i < faltan.length; i += 150) {
    const { data, error } = await service
      .from('amazon_listings')
      .select(COLUMNAS_LISTING)
      .eq('connection_id', connectionId)
      .eq('marketplace_id', marketplaceId)
      .in('sku', faltan.slice(i, i + 150))
    if (error) throw error
    for (const f of (data ?? []) as FilaListing[]) listings.set(f.sku, aListing(f))
  }

  /* ---------- los envíos del ERP ---------- */
  const envios = await enviosDelCliente(service, clienteId)

  const inventario = calcularInventario({
    hoy: opciones.hoy,
    leidoHasta: lectura?.leido_hasta ?? null,
    listings: [...listings.values()],
    movimientos,
    envios,
  })

  /**
   * ¿HAY STOCK EN OTROS MERCADOS?
   *
   * Un cliente que vende en toda Europa (Pan-EU, EFN) ve en cada mercado una foto distinta
   * —y parecida— del mismo inventario. Aquí se cuenta UN mercado, el que lee el libro, y
   * sumar los demás duplicaría unidades. Pero callarse que existen sería enseñar 25
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
  if (mercados.size > 0) {
    inventario.avisos.push(
      `Este cliente tiene stock visible en ${mercados.size} mercado${mercados.size === 1 ? '' : 's'} más (venta paneuropea). Aquí solo se cuenta Amazon.es, que es el que lee el libro mayor: sumarlos duplicaría unidades.`
    )
  }

  return { ...inventario, conectado: true, marketplaceId }
}
