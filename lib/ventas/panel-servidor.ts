/**
 * VENTAS (EL «SELLERBOARD» PROPIO) · LO QUE LEE EL PANEL. SOLO SERVIDOR. Las cuentas de beneficio se hacen en el navegador (lib/ventas/panel.ts).
 *
 * El panel pide un rango de días y recibe las filas del resumen diario en forma compacta (una lista por fila, no un objeto), el título de cada SKU, los costes
 * y, para la pestaña «Pedidos», las líneas de pedido de los días que pida (solo existen las de los últimos ~62 días). Nada del comprador.
 */

import { createServiceClient } from '@/lib/supabase/service'
import type { FilaPanel } from './panel'

export interface CuentaDelPanel {
  id: string
  nombre: string
  cliente: string | null
  iva: number
  mercados: string[]
  estado: {
    pedidosHasta: string | null
    dineroHasta: string | null
    publicidadHasta: string | null
    resumenAt: string | null
    error: string | null
    primeraLectura: boolean
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

export async function cuentasDelPanel(): Promise<CuentaDelPanel[]> {
  const s = createServiceClient()
  const { data, error } = await s.from('ventas_cuentas').select('*').eq('activa', true)
  if (error) throw error
  const filas = (data ?? []) as Array<Record<string, unknown>>
  if (filas.length === 0) return []
  const { data: cons } = await s.from('amazon_connections').select('id, name, client_id, marketplace_ids, marketplaces_activos').in('id', filas.map((f) => f.connection_id as string))
  const conexiones = new Map(((cons ?? []) as Array<{ id: string; name: string; client_id: string; marketplace_ids: string[] | null; marketplaces_activos: string[] | null }>).map((c) => [c.id, c]))
  const { data: clis } = await s.from('amazon_clients').select('id, name').in('id', [...conexiones.values()].map((c) => c.client_id))
  const nombreCliente = new Map(((clis ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]))
  return filas
    .map((f) => {
      const c = conexiones.get(f.connection_id as string)
      return {
        id: f.connection_id as string,
        nombre: c?.name ?? 'Cuenta',
        cliente: c ? (nombreCliente.get(c.client_id) ?? null) : null,
        iva: n(f.iva_pct),
        mercados: c?.marketplace_ids ?? [],
        estado: {
          pedidosHasta: (f.pedidos_leido_hasta as string) ?? null,
          dineroHasta: (f.finanzas_leido_hasta as string) ?? null,
          publicidadHasta: (f.ads_leido_hasta as string) ?? null,
          resumenAt: (f.resumen_at as string) ?? null,
          error: (f.ultimo_error as string) ?? null,
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
export async function productosDelPanel(connectionId: string): Promise<{ titulos: Record<string, { titulo: string | null; asin: string | null }>; costes: Record<string, number>; catalogo: ProductoDelCatalogo[] }> {
  const s = createServiceClient()
  const titulos: Record<string, { titulo: string | null; asin: string | null }> = {}
  const catalogo: ProductoDelCatalogo[] = []
  for (let d = 0; ; d += 1000) {
    const { data, error } = await s.from('amazon_listings').select('sku, asin, title, marketplace_id, price, currency, is_fba, listing_status').eq('connection_id', connectionId).order('sku').range(d, d + 999)
    if (error) break
    for (const l of (data ?? []) as Array<{ sku: string; asin: string | null; title: string | null; marketplace_id: string; price: number | null; currency: string | null; is_fba: boolean | null; listing_status: string | null }>) {
      if (!titulos[l.sku] || (!titulos[l.sku].titulo && l.title)) titulos[l.sku] = { titulo: l.title, asin: l.asin }
      catalogo.push({ sku: l.sku, mkt: l.marketplace_id, asin: l.asin, titulo: l.title, precio: l.price == null ? null : Number(l.price), moneda: l.currency, fba: Boolean(l.is_fba), activo: !l.listing_status || /active|buyable|discoverable/i.test(l.listing_status) })
    }
    if ((data ?? []).length < 1000) break
  }
  const { data: cs } = await s.from('ventas_costes').select('sku, coste').eq('connection_id', connectionId)
  const costes = Object.fromEntries(((cs ?? []) as Array<{ sku: string; coste: number }>).map((c) => [c.sku, Number(c.coste)]))
  return { titulos, costes, catalogo }
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
  const filas = costes.map((c) => ({ connection_id: connectionId, sku: c.sku, coste: c.coste, updated_by: userId, updated_at: new Date().toISOString() }))
  for (let i = 0; i < filas.length; i += 500) {
    const { error } = await createServiceClient().from('ventas_costes').upsert(filas.slice(i, i + 500), { onConflict: 'connection_id,sku' })
    if (error) throw error
  }
  return filas.length
}

export async function guardarCoste(connectionId: string, sku: string, coste: number | null, userId: string): Promise<void> {
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
  const { error } = await createServiceClient().from('ventas_cuentas').upsert({ connection_id: connectionId, activa: true }, { onConflict: 'connection_id' })
  if (error) throw error
}

export async function cambiarIva(connectionId: string, iva: number): Promise<void> {
  const { error } = await createServiceClient().from('ventas_cuentas').update({ iva_pct: iva }).eq('connection_id', connectionId)
  if (error) throw error
}
