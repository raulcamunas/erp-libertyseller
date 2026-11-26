/**
 * VENTAS (EL «SELLERBOARD» PROPIO) · LO QUE LEE EL PANEL. SOLO SERVIDOR. Las cuentas de beneficio se hacen en el navegador (lib/ventas/panel.ts).
 *
 * El panel pide un rango de días y recibe las filas del resumen diario en forma compacta (una lista por fila, no un objeto), el título de cada SKU, los costes
 * y, para la pestaña «Pedidos», las líneas de pedido de los días que pida (solo existen las de los últimos ~62 días). Nada del comprador.
 */

import { createServiceClient } from '@/lib/supabase/service'
import type { FilaPanel } from './panel'
import { emojisDeClientes } from './emoji-servidor'
import { totalizar, type Totales } from './panel'

/**
 * CACHÉ EN MEMORIA (rendimiento, 26 nov 2026): las cuentas (30 s) y el catálogo de cada cuenta (títulos, costes, stock y BSR: 5 min) no cambian a cada
 * segundo y eran lo más lento de abrir el panel. Guardar un coste, el IVA o añadir una cuenta los tira al momento.
 */
const cache = new Map<string, { hasta: number; valor: Promise<unknown> }>()
function enCache<T>(clave: string, ms: number, leer: () => Promise<T>): Promise<T> {
  const ahora = Date.now()
  const c = cache.get(clave)
  if (c && c.hasta > ahora) return c.valor as Promise<T>
  const valor = leer()
  cache.set(clave, { hasta: ahora + ms, valor })
  valor.catch(() => cache.delete(clave))
  return valor
}
const olvidar = (prefijo: string) => {
  for (const k of cache.keys()) if (k.startsWith(prefijo)) cache.delete(k)
}

export const cuentasDelPanel = () => enCache('cuentas', 30_000, leerCuentasDelPanel)
export const productosDelPanel = (connectionId: string) => enCache(`productos:${connectionId}`, 5 * 60_000, () => leerProductosDelPanel(connectionId))

/** Lo de cada cuenta en un periodo y en el de comparación, para el panel de TODAS las cuentas */
export interface ResumenDeCuenta {
  id: string
  t: Totales
  c: Totales | null
  /** Ventas por día del periodo */
  serie: number[]
}

export async function resumenDeCuentas(desde: string, hasta: string, compDesde: string | null, compHasta: string | null, serieDesde?: string | null): Promise<ResumenDeCuenta[]> {
  const cuentas = await cuentasDelPanel()
  // La curva de ventas: el periodo, y como poco las 2 últimas semanas (con «Hoy» una curva de un punto no dice nada)
  const inicio = serieDesde && serieDesde < desde ? serieDesde : desde
  return Promise.all(
    cuentas.map(async (cu) => {
      const iva = { pct: cu.iva, porPais: cu.ivaPorPais }
      const [todas, comp, productos] = await Promise.all([filasDelPanel(cu.id, inicio, hasta), compDesde && compHasta ? filasDelPanel(cu.id, compDesde, compHasta) : Promise.resolve(null), productosDelPanel(cu.id)])
      const filas = todas.filter((f) => f.dia >= desde && f.dia <= hasta)
      const dias = new Map<string, number>()
      for (let d = Date.parse(`${inicio}T00:00:00Z`); d <= Date.parse(`${hasta}T00:00:00Z`); d += 86_400_000) dias.set(new Date(d).toISOString().slice(0, 10), 0)
      for (const f of todas) dias.set(f.dia, (dias.get(f.dia) ?? 0) + f.ventas)
      return { id: cu.id, t: totalizar(filas, iva, productos.costes), c: comp ? totalizar(comp, iva, productos.costes) : null, serie: [...dias.values()].map((v) => Math.round(v * 100) / 100) }
    }),
  )
}

export interface CuentaDelPanel {
  id: string
  nombre: string
  cliente: string | null
  /** El emoticono del cliente (el de Tareas o, si no está, uno elegido por la IA). null = iniciales */
  emoji: string | null
  iva: number
  /** «IVA de cada país» (OSS, migración 346): a cada venta, el IVA de su mercado */
  ivaPorPais: boolean
  mercados: string[]
  estado: {
    pedidosHasta: string | null
    dineroHasta: string | null
    publicidadHasta: string | null
    resumenAt: string | null
    error: string | null
    primeraLectura: boolean
    /** El historial: hasta qué día hacia atrás está cargado y hasta dónde llegará (2 años) */
    historicoHasta: string | null
    historicoObjetivo: string | null
  }
}

export interface LineaDelPanel {
  pedido: string
  sku: string
  mkt: string
  fecha: string
  estado: string | null
  unidades: number
  ventas: number | null
  promo: number
  tarifas: number | null
  reales: boolean
  asin: string | null
}

const n = (v: unknown) => (v == null ? 0 : Number(v))

async function leerCuentasDelPanel(): Promise<CuentaDelPanel[]> {
  const s = createServiceClient()
  const { data, error } = await s.from('ventas_cuentas').select('*').eq('activa', true)
  if (error) throw error
  const filas = (data ?? []) as Array<Record<string, unknown>>
  if (filas.length === 0) return []
  const { data: cons } = await s.from('amazon_connections').select('id, name, client_id, marketplace_ids, marketplaces_activos').in('id', filas.map((f) => f.connection_id as string))
  const conexiones = new Map(((cons ?? []) as Array<{ id: string; name: string; client_id: string; marketplace_ids: string[] | null; marketplaces_activos: string[] | null }>).map((c) => [c.id, c]))
  const { data: clis } = await s.from('amazon_clients').select('id, name').in('id', [...conexiones.values()].map((c) => c.client_id))
  const nombreCliente = new Map(((clis ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]))
  const nombres = [...new Set(filas.map((f) => { const c = conexiones.get(f.connection_id as string); return (c ? nombreCliente.get(c.client_id) : null) ?? c?.name ?? '' }).filter(Boolean))]
  const emojis = await emojisDeClientes(nombres).catch(() => new Map<string, string | null>())
  return filas
    .map((f) => {
      const c = conexiones.get(f.connection_id as string)
      return {
        id: f.connection_id as string,
        nombre: c?.name ?? 'Cuenta',
        cliente: c ? (nombreCliente.get(c.client_id) ?? null) : null,
        emoji: emojis.get((c ? nombreCliente.get(c.client_id) : null) ?? c?.name ?? '') ?? null,
        iva: n(f.iva_pct),
        ivaPorPais: f.iva_por_pais === true,
        mercados: c?.marketplace_ids ?? [],
        estado: {
          pedidosHasta: (f.pedidos_leido_hasta as string) ?? null,
          dineroHasta: (f.finanzas_leido_hasta as string) ?? null,
          publicidadHasta: (f.ads_leido_hasta as string) ?? null,
          resumenAt: (f.resumen_at as string) ?? null,
          error: (f.ultimo_error as string) ?? null,
          historicoHasta: (f.historico_hasta as string) ?? null,
          historicoObjetivo: (f.historico_objetivo as string) ?? null,
          primeraLectura: !f.pedidos_leido_hasta || !f.finanzas_leido_hasta || Date.parse(String(f.finanzas_leido_hasta)) < Date.now() - 2 * 86_400_000,
        },
      }
    })
    .sort((a, b) => (a.cliente ?? a.nombre).localeCompare(b.cliente ?? b.nombre, 'es'))
}

export async function filasDelPanel(connectionId: string, desde: string, hasta: string): Promise<FilaPanel[]> {
  const s = createServiceClient()
  const filas: FilaPanel[] = []
  for (let d = 0; ; d += 1000) {
    const { data, error } = await s
      .from('ventas_dia')
      .select('dia, marketplace_id, sku, asin, unidades, pedidos, ventas, promo, tarifa_referral, tarifa_fba, otras_tarifas, tarifas_estimadas, reembolsos, reembolsado, comision_reembolso, ajustes, publicidad, ventas_ppc, unidades_ppc')
      .eq('connection_id', connectionId)
      .gte('dia', desde)
      .lte('dia', hasta)
      .order('dia')
      .order('marketplace_id')
      .order('sku')
      .range(d, d + 999)
    if (error) throw error
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      filas.push({
        dia: String(r.dia),
        mkt: String(r.marketplace_id),
        sku: String(r.sku),
        asin: (r.asin as string) ?? null,
        unidades: n(r.unidades),
        pedidos: n(r.pedidos),
        ventas: n(r.ventas),
        promo: n(r.promo),
        referral: n(r.tarifa_referral),
        fba: n(r.tarifa_fba),
        otras: n(r.otras_tarifas),
        estimadas: n(r.tarifas_estimadas),
        reembolsos: n(r.reembolsos),
        reembolsado: n(r.reembolsado),
        comisionReembolso: n(r.comision_reembolso),
        ajustes: n(r.ajustes),
        publicidad: n(r.publicidad),
        ventasPpc: n(r.ventas_ppc),
        unidadesPpc: n(r.unidades_ppc),
      })
    }
    if ((data ?? []).length < 1000) return filas
  }
}

export interface ProductoDelCatalogo {
  sku: string
  mkt: string
  asin: string | null
  titulo: string | null
  precio: number | null
  moneda: string | null
  fba: boolean
  activo: boolean
}

/** El título y el ASIN de cada SKU (del catálogo que ya lee el ERP), el catálogo entero (para «Productos») y los costes puestos */
export interface BsrDelProducto {
  rank: number
  /** El de hace unos días (para la flecha), si lo hay */
  antes: number | null
}

async function leerProductosDelPanel(connectionId: string): Promise<{ titulos: Record<string, { titulo: string | null; asin: string | null }>; costes: Record<string, number>; catalogo: ProductoDelCatalogo[]; stock: Record<string, number>; bsr: Record<string, BsrDelProducto> }> {
  const s = createServiceClient()
  const titulos: Record<string, { titulo: string | null; asin: string | null }> = {}
  const catalogo: ProductoDelCatalogo[] = []
  // Inventario FBA vendible por SKU: el almacén es uno (pan-europeo / EFN), así que se toma el mayor de los países
  const stock: Record<string, number> = {}
  for (let d = 0; ; d += 1000) {
    const { data, error } = await s.from('amazon_listings').select('sku, asin, title, marketplace_id, price, currency, is_fba, listing_status, fba_fulfillable_quantity, fba_quantity').eq('connection_id', connectionId).order('sku').range(d, d + 999)
    if (error) break
    for (const l of (data ?? []) as Array<{ sku: string; asin: string | null; title: string | null; marketplace_id: string; price: number | null; currency: string | null; is_fba: boolean | null; listing_status: string | null; fba_fulfillable_quantity: number | null; fba_quantity: number | null }>) {
      if (!titulos[l.sku] || (!titulos[l.sku].titulo && l.title)) titulos[l.sku] = { titulo: l.title, asin: l.asin }
      const uds = l.fba_fulfillable_quantity ?? l.fba_quantity
      if (l.is_fba && uds != null) stock[l.sku] = Math.max(stock[l.sku] ?? 0, Number(uds))
      catalogo.push({ sku: l.sku, mkt: l.marketplace_id, asin: l.asin, titulo: l.title, precio: l.price == null ? null : Number(l.price), moneda: l.currency, fba: Boolean(l.is_fba), activo: !l.listing_status || /active|buyable|discoverable/i.test(l.listing_status) })
    }
    if ((data ?? []).length < 1000) break
  }
  const { data: cs } = await s.from('ventas_costes').select('sku, coste').eq('connection_id', connectionId)
  const costes = Object.fromEntries(((cs ?? []) as Array<{ sku: string; coste: number }>).map((c) => [c.sku, Number(c.coste)]))
  return { titulos, costes, catalogo, stock, bsr: await bsrDelPanel(connectionId) }
}

/** El BSR de categoría más reciente de cada SKU (últimos 10 días) y el de unos días antes, para la tendencia. Si falla, sin BSR */
async function bsrDelPanel(connectionId: string): Promise<Record<string, BsrDelProducto>> {
  const desde = new Date(Date.now() - 10 * 86_400_000).toISOString()
  const { data, error } = await createServiceClient()
    .from('amazon_snapshots_bsr')
    .select('sku, fecha, rank')
    .eq('connection_id', connectionId)
    .eq('tipo', 'categoria')
    .gte('fecha', desde)
    .order('fecha', { ascending: false })
    .limit(5000)
  if (error) return {}
  const salida: Record<string, BsrDelProducto> = {}
  const primera: Record<string, string> = {}
  for (const f of (data ?? []) as Array<{ sku: string; fecha: string; rank: number }>) {
    const b = salida[f.sku]
    if (!b) {
      salida[f.sku] = { rank: f.rank, antes: null }
      primera[f.sku] = f.fecha
    } else if (Date.parse(primera[f.sku]) - Date.parse(f.fecha) > 2 * 86_400_000) b.antes = f.rank // la más antigua que quede (va de nueva a vieja)
    else if (b.rank > f.rank && f.fecha.slice(0, 10) === primera[f.sku].slice(0, 10)) b.rank = f.rank // el mismo día, la mejor categoría
  }
  return salida
}

/** Las sesiones por ASIN y país del periodo (del informe de tráfico, si el cliente lo tiene) */
export async function sesionesDelPanel(connectionId: string, desde: string, hasta: string): Promise<Record<string, number> | null> {
  const s = createServiceClient()
  const { data: con } = await s.from('amazon_connections').select('client_id').eq('id', connectionId).maybeSingle()
  const clientId = (con as { client_id?: string } | null)?.client_id
  if (!clientId) return null
  const salida: Record<string, number> = {}
  let hay = false
  for (let d = 0; d < 20_000; d += 1000) {
    const { data, error } = await s.from('trafico_diario').select('asin, marketplace_id, sesiones').eq('client_id', clientId).gte('fecha', desde).lte('fecha', hasta).range(d, d + 999)
    if (error) return null
    for (const f of (data ?? []) as Array<{ asin: string; marketplace_id: string; sesiones: number }>) {
      hay = true
      const k = `${f.marketplace_id}|${f.asin}`
      salida[k] = (salida[k] ?? 0) + Number(f.sesiones || 0)
    }
    if ((data ?? []).length < 1000) break
  }
  return hay ? salida : null
}

export async function lineasDelPanel(connectionId: string, desde: string, hasta: string): Promise<LineaDelPanel[]> {
  const { data, error } = await createServiceClient()
    .from('ventas_lineas')
    .select('pedido, sku, marketplace_id, fecha, estado, unidades, ventas, promo, tarifa_referral, tarifa_fba, otras_tarifas, tarifas_reales, asin')
    .eq('connection_id', connectionId)
    .gte('dia', desde)
    .lte('dia', hasta)
    .order('fecha', { ascending: false })
    .limit(1500)
  if (error) throw error
  return ((data ?? []) as Array<Record<string, unknown>>).map((l) => ({
    pedido: String(l.pedido),
    sku: String(l.sku),
    mkt: String(l.marketplace_id),
    fecha: String(l.fecha),
    estado: (l.estado as string) ?? null,
    unidades: n(l.unidades),
    ventas: l.ventas == null ? null : n(l.ventas),
    promo: n(l.promo),
    tarifas: l.tarifas_reales ? n(l.tarifa_referral) + n(l.tarifa_fba) + n(l.otras_tarifas) : null,
    reales: Boolean(l.tarifas_reales),
    asin: (l.asin as string) ?? null,
  }))
}

/** Muchos costes de golpe (importar un CSV) */
export async function guardarCostes(connectionId: string, costes: Array<{ sku: string; coste: number }>, userId: string): Promise<number> {
  olvidar(`productos:${connectionId}`)
  const filas = costes.map((c) => ({ connection_id: connectionId, sku: c.sku, coste: c.coste, updated_by: userId, updated_at: new Date().toISOString() }))
  for (let i = 0; i < filas.length; i += 500) {
    const { error } = await createServiceClient().from('ventas_costes').upsert(filas.slice(i, i + 500), { onConflict: 'connection_id,sku' })
    if (error) throw error
  }
  return filas.length
}

export async function guardarCoste(connectionId: string, sku: string, coste: number | null, userId: string): Promise<void> {
  olvidar(`productos:${connectionId}`)
  const s = createServiceClient()
  if (coste == null) {
    const { error } = await s.from('ventas_costes').delete().eq('connection_id', connectionId).eq('sku', sku)
    if (error) throw error
    return
  }
  const { error } = await s.from('ventas_costes').upsert({ connection_id: connectionId, sku, coste, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: 'connection_id,sku' })
  if (error) throw error
}

/** Las conexiones activas que todavía no están en el panel (para «Añadir cuenta») */
export async function cuentasParaAnadir(): Promise<Array<{ id: string; nombre: string; cliente: string | null }>> {
  const s = createServiceClient()
  const [{ data: cons }, { data: ya }] = await Promise.all([s.from('amazon_connections').select('id, name, client_id').eq('is_active', true).eq('status', 'activa'), s.from('ventas_cuentas').select('connection_id, activa')])
  const dentro = new Set(((ya ?? []) as Array<{ connection_id: string; activa: boolean }>).filter((x) => x.activa).map((x) => x.connection_id))
  const libres = ((cons ?? []) as Array<{ id: string; name: string; client_id: string }>).filter((c) => !dentro.has(c.id))
  const { data: clis } = await s.from('amazon_clients').select('id, name').in('id', libres.map((c) => c.client_id))
  const nombre = new Map(((clis ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]))
  return libres.map((c) => ({ id: c.id, nombre: c.name, cliente: nombre.get(c.client_id) ?? null })).sort((a, b) => (a.cliente ?? a.nombre).localeCompare(b.cliente ?? b.nombre, 'es'))
}

export async function anadirCuenta(connectionId: string): Promise<void> {
  olvidar('cuentas')
  // Una cuenta de EE. UU., Canadá o México no tiene IVA europeo: ni en las ventas ni en las tarifas
  const { data: con } = await createServiceClient().from('amazon_connections').select('region').eq('id', connectionId).maybeSingle()
  const sinIva = (con as { region?: string } | null)?.region === 'na'
  const { error } = await createServiceClient().from('ventas_cuentas').upsert({ connection_id: connectionId, activa: true, ...(sinIva ? { iva_pct: 0 } : {}) }, { onConflict: 'connection_id' })
  if (error) throw error
}

export async function cambiarIvaPorPais(connectionId: string, porPais: boolean): Promise<void> {
  olvidar('cuentas')
  const { error } = await createServiceClient().from('ventas_cuentas').update({ iva_por_pais: porPais }).eq('connection_id', connectionId)
  if (error) throw error
}

export async function cambiarIva(connectionId: string, iva: number): Promise<void> {
  olvidar('cuentas')
  const { error } = await createServiceClient().from('ventas_cuentas').update({ iva_pct: iva }).eq('connection_id', connectionId)
  if (error) throw error
}

/* ------------------------------------------------------------------ */
/* Los motivos de los reembolsos                                       */
/* ------------------------------------------------------------------ */

export interface MotivosDeReembolso {
  /** Unidades reembolsadas en el periodo (lo mismo que la baldosa) */
  total: number
  /** Por motivo, de más a menos; «Pendiente» = Amazon aún no ha dado la devolución (o no la hay: reembolso sin devolver) */
  grupos: Array<{ motivo: string; unidades: number; comentarios: string[] }>
  /** false = falta la migración 348 o aún no se ha leído el informe de devoluciones */
  conDevoluciones: boolean
}

/** Cada reembolso del periodo con el motivo de su devolución (casada por pedido y SKU) y lo que escribió el comprador */
export async function motivosDeReembolso(connectionId: string, desde: string, hasta: string, filtro: { skus?: string[] | null; mercados?: string[] | null } = {}): Promise<MotivosDeReembolso> {
  const { motivoEnEspanol } = await import('./lectura')
  const s = createServiceClient()
  const reembolsos: Array<{ clave: string; sku: string; marketplace_id: string; unidades: number }> = []
  for (let d = 0; d < 20_000; d += 1000) {
    const { data, error } = await s.from('ventas_movimientos').select('clave, sku, marketplace_id, unidades').eq('connection_id', connectionId).eq('tipo', 'reembolso').gte('dia', desde).lte('dia', hasta).range(d, d + 999)
    if (error) throw error
    reembolsos.push(...((data ?? []) as typeof reembolsos))
    if ((data ?? []).length < 1000) break
  }
  const skus = filtro.skus?.length ? new Set(filtro.skus) : null
  const mercados = filtro.mercados?.length ? new Set(filtro.mercados) : null
  const lista = reembolsos
    .filter((r) => (!skus || skus.has(r.sku)) && (!mercados || mercados.has(r.marketplace_id)))
    .map((r) => ({ pedido: r.clave.startsWith('r|') ? r.clave.split('|')[1] : '', sku: r.sku, unidades: Math.max(1, Number(r.unidades) || 1) }))
  const pedidos = [...new Set(lista.map((r) => r.pedido).filter(Boolean))]
  const devs = new Map<string, Array<{ motivo: string | null; comentario: string | null; fecha: string }>>()
  let conDevoluciones = true
  for (let i = 0; i < pedidos.length; i += 300) {
    const { data, error } = await s.from('ventas_devoluciones').select('pedido, sku, motivo, comentario, fecha').eq('connection_id', connectionId).in('pedido', pedidos.slice(i, i + 300))
    if (error) {
      conDevoluciones = false
      break
    }
    for (const d of (data ?? []) as Array<{ pedido: string; sku: string; motivo: string | null; comentario: string | null; fecha: string }>) {
      const k = `${d.pedido}|${d.sku}`
      devs.set(k, [...(devs.get(k) ?? []), d])
    }
  }
  const grupos = new Map<string, { motivo: string; unidades: number; comentarios: string[] }>()
  for (const r of lista) {
    const ds = (devs.get(`${r.pedido}|${r.sku}`) ?? []).sort((a, b) => b.fecha.localeCompare(a.fecha))
    const motivo = ds.length ? motivoEnEspanol(ds[0].motivo) : 'Pendiente (motivo desconocido)'
    const g = grupos.get(motivo) ?? { motivo, unidades: 0, comentarios: [] }
    g.unidades += r.unidades
    for (const d of ds) if (d.comentario && !g.comentarios.includes(d.comentario)) g.comentarios.push(d.comentario)
    grupos.set(motivo, g)
  }
  return { total: lista.reduce((t, r) => t + r.unidades, 0), grupos: [...grupos.values()].sort((a, b) => b.unidades - a.unidades), conDevoluciones }
}
