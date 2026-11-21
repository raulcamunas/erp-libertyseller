import { createServiceClient } from '@/lib/supabase/service'
import { marketplaceById } from '@/lib/types/amazon'
import { elegirLectura, stockEntreMercados, MERCADO_ESPANA, type LecturaCandidata } from './lectura-elegida'
import { leerLibroDiario } from './libro-diario'
import { leerTodo } from './paginar'
import { faltaLaTabla } from './planificacion'
import type { FilaStock, Moneda, VentasFba } from './plan-tipos'
import { sumarDias, ventasFba, type DiasVentas, type MovimientoVenta } from './ventas-fba'
import { ultimoDiaCompleto } from './ventas-fba'

/**
 * LAS VENTAS FBA DE UN CLIENTE — SOLO SERVIDOR, SOLO LECTURA.
 * ==========================================================
 * Spec remesas-pro §6.3, §9 y §11 D29, D35 y D36. Lo pinta la sección «Ventas» del cliente.
 *
 *   1. La copia del libro: `elegirLectura` (la más al día ENTRE LAS QUE CUBREN la historia; ver lectura-elegida.ts).
 *      Para eso hace falta `leidoDesde` de cada copia: una consulta `order fecha asc limit 1` por mercado.
 *   2. El libro agregado por día con `leerLibroDiario` (la función de la 316; sin ella, `leerTodo` como siempre), del
 *      primer día del periodo anterior al último leído.
 *   3. «Salidas por almacén»: el agregado diario no trae el país, así que las ventas del periodo se piden aparte con
 *      la columna `pais` (es el país del ALMACÉN de Amazon, no el del comprador). Si falla, el resto sale igual.
 *   4. € = unidades × precio actual del listing del mercado elegido; si a una referencia le falta ahí, el de otro
 *      mercado de la misma conexión y la MISMA moneda (regla de `stockEntreMercados`, nunca sumando).
 *   5. La cuenta la hace `ventasFba` (pura, ventas-fba.ts).
 *
 * Lleva una memoria de 3 minutos por (cliente, días) en el proceso: el año entero son miles de filas y la pantalla
 * se abre y se cierra. `?refrescar=1` la salta. Nada de `unstable_cache` (Next 14.2 guarda sin caducar).
 */

type Servicio = ReturnType<typeof createServiceClient>

export const DIAS_VALIDOS: readonly DiasVentas[] = [7, 30, 90, 365]

/** Días de la chispa de las referencias del top (`serie30` de `VentasFba`) */
const DIAS_CHISPA_TOP = 30

/** Cuánta historia hace falta como mucho para elegir la copia del libro (D35) */
export const HISTORIA_NECESARIA_DIAS = 400

/* ------------------------------------------------------------------ */
/* La lectura elegida de una conexión (lo usa también el resumen)      */
/* ------------------------------------------------------------------ */

export interface LecturaDeConexion extends LecturaCandidata {
  /** Frase para la banda de calidad (de `elegirLectura`); null si no hay nada que decir */
  aviso: string | null
}

/**
 * Elige la copia del libro de una conexión. `desdeNecesario` = el primer envío real del cliente o hoy − 400, lo que
 * sea más reciente. `null` si la conexión no tiene ninguna fila en `fba_lecturas`.
 */
export async function lecturaDeConexion(service: Servicio, conexionId: string, desdeNecesario: string): Promise<LecturaDeConexion | null> {
  const { data, error } = await service
    .from('fba_lecturas')
    .select('marketplace_id, leido_hasta, ultimo_error')
    .eq('connection_id', conexionId)
  if (error) throw error
  const filas = (data ?? []) as Array<{ marketplace_id: string; leido_hasta: string | null; ultimo_error: string | null }>
  if (filas.length === 0) return null

  // Primer día de cada copia del libro: una consulta corta por mercado (usa el índice de conexión, mercado y fecha)
  const candidatas: LecturaCandidata[] = await Promise.all(
    filas.map(async (f) => {
      let leidoDesde: string | null = null
      if (f.leido_hasta) {
        const { data: primera, error: e } = await service
          .from('fba_movimientos')
          .select('fecha')
          .eq('connection_id', conexionId)
          .eq('marketplace_id', f.marketplace_id)
          .order('fecha', { ascending: true })
          .limit(1)
        if (e) throw e
        const fila = ((primera ?? []) as Array<{ fecha: string }>)[0]
        leidoDesde = fila ? String(fila.fecha).slice(0, 10) : null
      }
      return {
        marketplaceId: f.marketplace_id,
        leidoHasta: f.leido_hasta ? String(f.leido_hasta).slice(0, 10) : null,
        leidoDesde,
        ultimoError: f.ultimo_error,
      }
    })
  )
  const r = elegirLectura(candidatas, desdeNecesario)
  return r ? { ...r.elegida, aviso: r.aviso } : null
}

/** El primer `fecha_envio` de una remesa enviada o cerrada del cliente; null si no ha enviado nunca */
export async function primerEnvioReal(service: Servicio, clienteId: string): Promise<string | null> {
  const { data, error } = await service
    .from('fba_remesas')
    .select('fecha_envio')
    .eq('client_id', clienteId)
    .in('estado', ['enviada', 'cerrada'])
    .not('fecha_envio', 'is', null)
    .order('fecha_envio', { ascending: true })
    .limit(1)
  if (error) throw error
  const f = ((data ?? []) as Array<{ fecha_envio: string | null }>)[0]?.fecha_envio
  return f ? String(f).slice(0, 10) : null
}

/** max(primer envío real, hoy − 400) */
export function desdeNecesarioDe(primerEnvio: string | null, hoy: string): string {
  const tope = sumarDias(hoy, -HISTORIA_NECESARIA_DIAS)
  return primerEnvio && primerEnvio > tope ? primerEnvio : tope
}

/** La conexión activa de un cliente (hoy hay una por cliente; si hay más, la primera, como inventarioDeCliente) */
export async function conexionActiva(service: Servicio, clienteId: string): Promise<{ id: string; region: string | null } | null> {
  const { data, error } = await service
    .from('amazon_connections')
    .select('id, region')
    .eq('client_id', clienteId)
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)
  if (error) throw error
  const c = ((data ?? []) as Array<{ id: string; region: string | null }>)[0]
  return c ?? null
}

/** Moneda de un mercado (EUR si no se conoce) */
export function monedaDeMercado(mercado: string | null): Moneda {
  return marketplaceById(mercado)?.currency ?? 'EUR'
}

/* ------------------------------------------------------------------ */
/* Precios y nombres desde los listings                                */
/* ------------------------------------------------------------------ */

interface FilaListingVentas {
  sku: string
  marketplace_id: string
  title: string | null
  price: number | string | null
  currency: string | null
  updated_at: string | null
  fba_fulfillable_quantity: number | null
}

/**
 * Precio y nombre por SKU para las referencias pedidas. Precio: el del mercado elegido; si falta ahí, el de otro mercado
 * de la conexión con la MISMA moneda (filas de 2 días como mucho; si no, la más reciente). Nombre: el del listing elegido
 * o cualquiera que tenga.
 */
export async function preciosYNombres(
  service: Servicio,
  conexionId: string,
  mercado: string,
  moneda: Moneda,
  skus: string[],
  hoy: string
): Promise<{ precios: Map<string, number | null>; nombres: Map<string, string | null> }> {
  const precios = new Map<string, number | null>()
  const nombres = new Map<string, string | null>()
  if (skus.length === 0) return { precios, nombres }

  const filas: FilaListingVentas[] = []
  for (let i = 0; i < skus.length; i += 150) {
    const { data, error } = await service
      .from('amazon_listings')
      .select('sku, marketplace_id, title, price, currency, updated_at, fba_fulfillable_quantity')
      .eq('connection_id', conexionId)
      .in('sku', skus.slice(i, i + 150))
    if (error) throw error
    filas.push(...((data ?? []) as FilaListingVentas[]))
  }

  const aStock = (f: FilaListingVentas): FilaStock => {
    const p = f.price === null || f.price === undefined ? null : Number(f.price)
    return {
      marketplaceId: f.marketplace_id,
      sku: f.sku,
      vendibles: Number(f.fba_fulfillable_quantity) || 0,
      entrante: 0,
      reservadas: null,
      noApto: null,
      precio: p !== null && Number.isFinite(p) && p > 0 ? p : null,
      moneda: f.currency ?? null,
      listingStatus: null,
      updatedAt: f.updated_at,
    }
  }
  // Solo filas con precio y de la misma moneda que el mercado elegido: un precio en dólares no es un precio en euros
  const conPrecio = filas
    .map(aStock)
    .filter((f) => f.precio !== null && (f.marketplaceId === mercado || (f.moneda ?? monedaDeMercado(f.marketplaceId)) === moneda))
  const elegidas = stockEntreMercados(conPrecio, mercado, hoy)
  for (const [sku, f] of Array.from(elegidas.entries())) precios.set(sku, f.precio)

  for (const f of filas) {
    const t = f.title?.trim() || null
    if (!t) continue
    if (f.marketplace_id === mercado || !nombres.has(f.sku)) nombres.set(f.sku, t)
  }
  return { precios, nombres }
}

/* ------------------------------------------------------------------ */
/* Ventas del cliente                                                  */
/* ------------------------------------------------------------------ */

/** Lo que devuelve la ruta: `VentasFba` tal cual y, aparte, de qué copia del libro sale y su aviso */
export type RespuestaVentas = VentasFba & {
  mercado: string | null
  leidoHasta: string | null
  leidoDesde: string | null
  /** «Sin API de Amazon…», «Ventas hasta el 6 nov…» o null */
  aviso: string | null
}

/** Las salidas del periodo con su país (columna `pais` de fba_movimientos), agregadas por SKU, día y país */
async function salidasConPais(service: Servicio, conexion: string, mercado: string, desde: string, hasta: string): Promise<MovimientoVenta[] | null> {
  try {
    const filas = await leerTodo<{ sku: string; fecha: string; cantidad: number | string; pais: string | null }>((a, b) =>
      service
        .from('fba_movimientos')
        .select('sku, fecha, cantidad, pais')
        .eq('connection_id', conexion)
        .eq('marketplace_id', mercado)
        .eq('tipo', 'Shipments')
        .gte('fecha', desde)
        .lte('fecha', hasta)
        .order('fecha', { ascending: true })
        .order('id', { ascending: true })
        .range(a, b)
    )
    const sumas = new Map<string, MovimientoVenta>()
    for (const f of filas) {
      const fecha = String(f.fecha).slice(0, 10)
      const pais = f.pais?.trim() || null
      const clave = `${f.sku}\u0000${fecha}\u0000${pais ?? ''}`
      const x = sumas.get(clave)
      const c = Number(f.cantidad) || 0
      if (x) x.cantidad += c
      else sumas.set(clave, { sku: f.sku, fecha, tipo: 'Shipments', disposicion: null, cantidad: c, pais })
    }
    return Array.from(sumas.values())
  } catch {
    // Sin país la pantalla no enseña el reparto por almacén; lo demás no depende de esto
    return null
  }
}

/** Ventas sin nada (cliente sin conexión o sin libro): todo a cero, con el aviso */
function ventasVacias(hoy: string, dias: DiasVentas, moneda: Moneda, aviso: string, lectura: LecturaDeConexion | null): RespuestaVentas {
  return {
    ...ventasFba([], new Map(), hoy, dias, null, { moneda, leidoHasta: lectura?.leidoHasta ?? null }),
    mercado: lectura?.marketplaceId ?? null,
    leidoHasta: lectura?.leidoHasta ?? null,
    leidoDesde: lectura?.leidoDesde ?? null,
    aviso,
  }
}

export async function calcularVentasDeCliente(service: Servicio, clienteId: string, dias: DiasVentas, hoy: string): Promise<RespuestaVentas> {
  const conexion = await conexionActiva(service, clienteId)
  if (!conexion) return ventasVacias(hoy, dias, 'EUR', 'Sin API de Amazon: no hay ventas leídas de este cliente', null)

  const desdeNecesario = desdeNecesarioDe(await primerEnvioReal(service, clienteId), hoy)
  const lectura = await lecturaDeConexion(service, conexion.id, desdeNecesario)
  const mercado = lectura?.marketplaceId ?? MERCADO_ESPANA
  const moneda = monedaDeMercado(mercado)
  if (!lectura || !lectura.leidoHasta) {
    return ventasVacias(hoy, dias, moneda, 'Las ventas no están leídas todavía: pide a un administrador que lea las ventas de Amazon', lectura)
  }

  // Los mismos límites que calcula ventasFba: el periodo acaba en el último día leído si el libro va atrasado
  // A6.3: el último día COMPLETO (hoy va a medias aunque esté leído)
  const hasta = ultimoDiaCompleto(lectura.leidoHasta, hoy)
  const desde = sumarDias(hasta, -(dias - 1))
  const antDesde = sumarDias(desde, -dias)
  // La chispa de cada referencia del top son 30 días: con 7 días el periodo anterior no llega tan atrás
  const desdeChispa = sumarDias(hasta, -(DIAS_CHISPA_TOP - 1))
  const leerDesde = desdeChispa < antDesde ? desdeChispa : antDesde

  const [libro, conPais] = await Promise.all([
    leerLibroDiario(service, conexion.id, mercado, leerDesde, hasta),
    salidasConPais(service, conexion.id, mercado, desde, hasta),
  ])

  // Si hay país, las ventas del periodo salen de esa lectura (mismas unidades, con país); el resto, del agregado
  const movs: MovimientoVenta[] = conPais
    ? [...libro.filter((m) => !(m.tipo === 'Shipments' && m.fecha >= desde && m.fecha <= hasta)), ...conPais]
    : libro

  const vendidos = Array.from(new Set(movs.filter((m) => m.tipo === 'Shipments').map((m) => m.sku)))
  const { precios, nombres } = await preciosYNombres(service, conexion.id, mercado, moneda, vendidos, hoy)

  const ventas = ventasFba(movs, precios, hoy, dias, lectura.leidoDesde, { moneda, nombres, leidoHasta: lectura.leidoHasta })
  return { ...ventas, mercado, leidoHasta: lectura.leidoHasta, leidoDesde: lectura.leidoDesde, aviso: lectura.aviso }
}

/* ------------------------------------------------------------------ */
/* El ritmo para los lotes (FIFO)                                      */
/* ------------------------------------------------------------------ */

/** Las líneas de una pasada solo se guardan 7 días (§11 D31): más viejas vienen vacías */
const LINEAS_VIGENTES_DIAS = 7

/**
 * Ud/día por SKU para estimar cuánto le queda a un lote vivo. Un único número por pregunta (§1.1): el ritmo previsto
 * de la ÚLTIMA pasada del planificador (`LineaPlan.ritmo.previsto`, o `base` si no hay previsto). Si no hay pasada con
 * líneas (falta la 316, el planificador no ha corrido o sus líneas ya se vaciaron), el `ritmoPlan` del inventario de
 * siempre. `origen` dice de cuál salió, para la línea gris de la pantalla.
 */
export async function ritmoParaLotes(
  service: Servicio,
  clienteId: string,
  hoy: string,
  inventario: () => Promise<Array<{ sku: string; ritmoPlan: number }>>
): Promise<{ ritmo: Map<string, number>; origen: 'plan' | 'inventario'; calculadoAt: string | null }> {
  const ritmo = new Map<string, number>()
  const { data, error } = await service
    .from('fba_plan_pasadas')
    .select('calculado_at, lineas')
    .eq('client_id', clienteId)
    .gte('hoy', sumarDias(hoy, -LINEAS_VIGENTES_DIAS))
    .order('calculado_at', { ascending: false })
    .limit(1)
  if (error && !faltaLaTabla(error)) throw error
  const pasada = ((data ?? []) as Array<{ calculado_at: string; lineas: Array<{ sku?: string; ritmo?: { previsto?: number | null; base?: number | null } }> | null }>)[0]
  if (pasada && Array.isArray(pasada.lineas) && pasada.lineas.length > 0) {
    for (const l of pasada.lineas) {
      const r = Number(l?.ritmo?.previsto ?? l?.ritmo?.base)
      if (l?.sku && Number.isFinite(r) && r > 0) ritmo.set(l.sku, r)
    }
    return { ritmo, origen: 'plan', calculadoAt: pasada.calculado_at }
  }

  for (const s of await inventario()) if (Number.isFinite(s.ritmoPlan) && s.ritmoPlan > 0) ritmo.set(s.sku, s.ritmoPlan)
  return { ritmo, origen: 'inventario', calculadoAt: null }
}

/* ------------------------------------------------------------------ */
/* Memoria de 3 minutos                                                */
/* ------------------------------------------------------------------ */

export const VIDA_CACHE_VENTAS_MS = 3 * 60_000
const cacheVentas = new Map<string, { at: number; valor: RespuestaVentas }>()
const enCurso = new Map<string, Promise<RespuestaVentas>>()

/** Vacía la memoria de ventas (de un cliente o de todos) */
export function invalidarVentas(clienteId?: string): void {
  if (!clienteId) {
    cacheVentas.clear()
    return
  }
  for (const k of Array.from(cacheVentas.keys())) if (k.startsWith(`${clienteId}:`)) cacheVentas.delete(k)
}

export async function ventasDeCliente(clienteId: string, dias: DiasVentas, hoy: string, opciones: { refrescar?: boolean } = {}): Promise<RespuestaVentas> {
  const clave = `${clienteId}:${dias}:${hoy}`
  const ahora = Date.now()
  const guardada = cacheVentas.get(clave)
  if (!opciones.refrescar && guardada && ahora - guardada.at < VIDA_CACHE_VENTAS_MS) return guardada.valor
  const pendiente = enCurso.get(clave)
  if (pendiente) return pendiente

  const promesa = calcularVentasDeCliente(createServiceClient(), clienteId, dias, hoy)
    .then((valor) => {
      cacheVentas.set(clave, { at: Date.now(), valor })
      // No dejar crecer la memoria con días viejos
      for (const [k, v] of Array.from(cacheVentas.entries())) if (Date.now() - v.at > VIDA_CACHE_VENTAS_MS) cacheVentas.delete(k)
      return valor
    })
    .finally(() => enCurso.delete(clave))
  enCurso.set(clave, promesa)
  return promesa
}
