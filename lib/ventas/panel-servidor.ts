/**
 * VENTAS (EL «SELLERBOARD» PROPIO) · LO QUE LEE EL PANEL. SOLO SERVIDOR. Las cuentas de beneficio se hacen en el navegador (lib/ventas/panel.ts).
 *
 * El panel pide un rango de días y recibe las filas del resumen diario en forma compacta (una lista por fila, no un objeto), el título de cada SKU, los costes
 * y, para la pestaña «Pedidos», las líneas de pedido de los días que pida (solo existen las de los últimos ~62 días). Nada del comprador.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { marketplaceById } from '@/lib/types/amazon'
import { costePickPack, normalizarAjustes, type AjustesCuenta } from './ajustes'
import { todasLasPaginas as paginar } from './paginas'
import { aKg, costeDeFila, REGLAS_CON_TABLA, type ReglaEnvio, type TablaEnvio } from './envio'
import { tiposDeCambio } from '@/lib/divisas/servidor'
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
/** Tira todo lo guardado de una cuenta (y el resumen de todas): al cambiar costes, IVA, ajustes, envío o al añadirla */
const olvidarCuenta = (connectionId: string) => {
  for (const p of ['productos:', 'costes:', 'envio:', 'pesos:', 'filas:']) olvidar(`${p}${connectionId}`)
  olvidar('resumen:')
  olvidar('cuentas')
}

/** Todas las filas (páginas de 4 en 4 en paralelo; ver lib/ventas/paginas.ts). Aquí, si falla, lanza */
async function todasLasPaginas<T>(pagina: (desde: number) => PromiseLike<{ data: unknown; error: unknown }>, tope = 200): Promise<T[]> {
  const r = await paginar<T>(pagina, tope)
  if (r.error) throw r.error
  return r.data
}

export const cuentasDelPanel = () => enCache('cuentas', 30_000, leerCuentasDelPanel)
export const productosDelPanel = (connectionId: string) => enCache(`productos:${connectionId}`, 5 * 60_000, () => leerProductosDelPanel(connectionId))
/** Solo los COGS de una cuenta (el resumen de todas no necesita el catálogo entero: leerlo por cada cuenta era lo que lo hacía lento) */
export const costesDelPanel = (connectionId: string) =>
  enCache(`costes:${connectionId}`, 5 * 60_000, async () => {
    return leerCostes(connectionId)
  })

/** Todos los COGS de una cuenta, de 1.000 en 1.000: Supabase devuelve como mucho 1.000 filas y ShoesF tiene más de 3.000 */
async function leerCostes(connectionId: string): Promise<Record<string, number>> {
  const costes: Record<string, number> = {}
  const filas = await todasLasPaginas<{ sku: string; coste: number }>((d) => createServiceClient().from('ventas_costes').select('sku, coste').eq('connection_id', connectionId).order('sku').range(d, d + 999))
  for (const c of filas) costes[c.sku] = Number(c.coste)
  return costes
}

/** Lo de cada cuenta en un periodo y en el de comparación, para el panel de TODAS las cuentas */
export interface ResumenDeCuenta {
  id: string
  t: Totales
  c: Totales | null
  /** Ventas por día del periodo */
  serie: number[]
}

/** El resumen se guarda 1 minuto por periodo: volver al panel o cambiar de periodo y volver es al momento (los datos se leen de Amazon cada 5 min) */
export const resumenDeCuentas = (desde: string, hasta: string, compDesde: string | null, compHasta: string | null, serieDesde?: string | null): Promise<ResumenDeCuenta[]> =>
  enCache(`resumen:${desde}|${hasta}|${compDesde}|${compHasta}|${serieDesde ?? ''}`, 60_000, () => leerResumenDeCuentas(desde, hasta, compDesde, compHasta, serieDesde))

async function leerResumenDeCuentas(desde: string, hasta: string, compDesde: string | null, compHasta: string | null, serieDesde?: string | null): Promise<ResumenDeCuenta[]> {
  const cuentas = await cuentasDelPanel()
  // La curva de ventas: el periodo, y como poco las 2 últimas semanas (con «Hoy» una curva de un punto no dice nada)
  const inicio = serieDesde && serieDesde < desde ? serieDesde : desde
  return Promise.all(
    cuentas.map(async (cu) => {
      const iva = { ...cu.ajustes, pct: cu.iva, porPais: cu.ivaPorPais }
      const [todas, comp, costes] = await Promise.all([filasDelPanel(cu.id, inicio, hasta), compDesde && compHasta ? filasDelPanel(cu.id, compDesde, compHasta) : Promise.resolve(null), costesDelPanel(cu.id)])
      const filas = todas.filter((f) => f.dia >= desde && f.dia <= hasta)
      const dias = new Map<string, number>()
      for (let d = Date.parse(`${inicio}T00:00:00Z`); d <= Date.parse(`${hasta}T00:00:00Z`); d += 86_400_000) dias.set(new Date(d).toISOString().slice(0, 10), 0)
      for (const f of todas) dias.set(f.dia, (dias.get(f.dia) ?? 0) + f.ventas)
      return { id: cu.id, t: totalizar(filas, iva, costes), c: comp ? totalizar(comp, iva, costes) : null, serie: [...dias.values()].map((v) => Math.round(v * 100) / 100) }
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
  /** Los ajustes de la página «Configuración» (migración 353; sin ella, los de siempre) */
  ajustes: AjustesCuenta
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
        ajustes: normalizarAjustes(f.ajustes),
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

const COLUMNAS_DIA = 'dia, marketplace_id, sku, asin, unidades, pedidos, ventas, promo, tarifa_referral, tarifa_fba, otras_tarifas, tarifas_estimadas, reembolsos, reembolsado, comision_reembolso, ajustes, publicidad, ventas_ppc, unidades_ppc'
/** ¿Está lanzada la migración 349 (envío FBM)? Se mira una vez (y otra a los 10 minutos si dio que no) */
let hayEnvio: { valor: boolean; at: number } | null = null
async function conEnvio(): Promise<boolean> {
  if (hayEnvio && (hayEnvio.valor || Date.now() - hayEnvio.at < 10 * 60_000)) return hayEnvio.valor
  const { error } = await createServiceClient().from('ventas_dia').select('envio_cobrado').limit(1)
  hayEnvio = { valor: !error, at: Date.now() }
  return hayEnvio.valor
}

export async function filasDelPanel(connectionId: string, desde: string, hasta: string): Promise<FilaPanel[]> {
  const s = createServiceClient()
  const envio = await conEnvio()
  const filas: FilaPanel[] = []
  const fbm: Array<{ unidades: number; pedidos: number; cobrado: number }> = []
  const crudas = await todasLasPaginas<Record<string, unknown>>((d) =>
    s
      .from('ventas_dia')
      .select(envio ? `${COLUMNAS_DIA}, unidades_fbm, pedidos_fbm, envio_cobrado` : COLUMNAS_DIA)
      .eq('connection_id', connectionId)
      .gte('dia', desde)
      .lte('dia', hasta)
      .order('dia')
      .order('marketplace_id')
      .order('sku')
      .range(d, d + 999),
  )
  {
    for (const r of crudas) {
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
      fbm.push({ unidades: n(r.unidades_fbm), pedidos: n(r.pedidos_fbm), cobrado: n(r.envio_cobrado) })
    }
  }
  if (!envio || !fbm.some((x) => x.pedidos > 0)) return filas
  // FBM Pick & Pack (Configuración): lo que cuesta preparar los pedidos FBM de cada fila
  const ajustes = normalizarAjustes(((await s.from('ventas_cuentas').select('*').eq('connection_id', connectionId).maybeSingle()).data as { ajustes?: unknown } | null)?.ajustes)
  if (ajustes.pickPaquete > 0 || ajustes.pickArticulo > 0 || (ajustes.pickPrimeros && ajustes.pickPrecioPrimeros)) {
    filas.forEach((f, i) => {
      if (fbm[i].pedidos) f.pickpack = costePickPack(ajustes, fbm[i].pedidos, fbm[i].unidades)
    })
  }
  // El coste de envío de los pedidos FBM de cada fila: lo importado por pedido manda; el resto, según el perfil que le toque
  const [perfiles, importados] = await Promise.all([perfilesDeEnvio(connectionId), envioImportado(connectionId, desde, hasta)])
  // El peso de cada producto (solo si algún perfil va por peso) y el cambio del dólar (solo si alguno está en dólares)
  const pesos = perfiles.some((p) => p.regla === 'peso') ? await pesosDelCatalogo(connectionId) : new Map<string, number>()
  const porEuroUsd = perfiles.some((p) => p.moneda === 'USD') ? ((await tiposDeCambio()).porEuro.USD ?? 1) : 1
  filas.forEach((f, i) => {
    const x = fbm[i]
    if (!x.pedidos) return
    const imp = importados.get(`${f.dia}|${f.mkt}|${f.sku}`)
    const resto = imp ? Math.max(0, x.pedidos - imp.pedidos) / x.pedidos : 1
    const p = perfilDeLaFila(perfiles, f.dia, f.sku)
    const porRegla = !p
      ? x.cobrado
      : costeDeFila(
          { regla: p.regla, importe: p.importe, tabla: p.tabla ?? null, porEuro: p.moneda === 'USD' ? porEuroUsd : 1 },
          { pedidos: x.pedidos, unidades: x.unidades, cobrado: x.cobrado, precioUnidad: f.unidades > 0 ? f.ventas / f.unidades : 0, pais: marketplaceById(f.mkt)?.countryCode ?? '', pesoUnidadKg: pesos.get(f.sku) ?? null }
        )
    f.envio = Math.round(((imp?.coste ?? 0) + porRegla * resto) * 100) / 100
  })
  return filas
}

/* ------------------------------------------------------------------ */
/* Costo de envío (migración 349)                                      */
/* ------------------------------------------------------------------ */

export interface PerfilEnvio {
  id: string
  nombre: string
  prioridad: number
  desde: string | null
  hasta: string | null
  productos_modo: 'todos' | 'solo' | 'excepto'
  skus: string[]
  regla: ReglaEnvio
  importe: number
  /** Las reglas por tabla (precio, unidades, peso): país × tope. Migración 351 */
  tabla?: TablaEnvio | null
  moneda?: 'EUR' | 'USD'
}

const COLUMNAS_PERFIL_349 = 'id, nombre, prioridad, desde, hasta, productos_modo, skus, regla, importe'
const COLUMNAS_PERFIL = `${COLUMNAS_PERFIL_349}, tabla, moneda`

const perfilesDeEnvio = (connectionId: string) =>
  enCache(`envio:${connectionId}`, 60_000, async (): Promise<PerfilEnvio[]> => {
    const s0 = createServiceClient()
    const leer = (cols: string) => s0.from('ventas_envio_perfiles').select(cols).eq('connection_id', connectionId).order('prioridad').order('created_at')
    let r = await leer(COLUMNAS_PERFIL)
    // Sin la migración 351 (tabla y moneda) se leen las de antes
    if (r.error) r = await leer(COLUMNAS_PERFIL_349)
    const { data, error } = r
    if (error) return []
    return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((p) => ({ ...(p as unknown as PerfilEnvio), importe: n(p.importe), skus: (p.skus as string[]) ?? [] }))
  })

/** El perfil que se lleva una fila (día y SKU): el primero por prioridad que la acepta. Ninguno = lo cobrado al comprador */
export function perfilDeLaFila(perfiles: readonly PerfilEnvio[], dia: string, sku: string): PerfilEnvio | null {
  for (const p of perfiles) {
    if (p.desde && dia < p.desde) continue
    if (p.hasta && dia > p.hasta) continue
    if (p.productos_modo === 'solo' && !p.skus.includes(sku)) continue
    if (p.productos_modo === 'excepto' && p.skus.includes(sku)) continue
    return p
  }
  return null
}

/** El peso de una unidad de cada SKU (kg), del catálogo de Amazon. 5 min */
const pesosDelCatalogo = (connectionId: string) =>
  enCache(`pesos:${connectionId}`, 5 * 60_000, async () => {
    const salida = new Map<string, number>()
    const filas = await todasLasPaginas<{ sku: string; peso: number | null; peso_unidad: string | null }>((d) =>
      createServiceClient().from('amazon_listings').select('sku, peso, peso_unidad').eq('connection_id', connectionId).not('peso', 'is', null).order('id').range(d, d + 999),
    ).catch(() => [])
    for (const l of filas) {
      const kg = aKg(l.peso, l.peso_unidad)
      if (kg != null && !salida.has(l.sku)) salida.set(l.sku, kg)
    }
    return salida
  })

async function envioImportado(connectionId: string, desde: string, hasta: string): Promise<Map<string, { coste: number; pedidos: number }>> {
  const salida = new Map<string, { coste: number; pedidos: number }>()
  const filas = await todasLasPaginas<{ dia: string; marketplace_id: string | null; sku: string | null; coste: number }>((d) =>
    createServiceClient().from('ventas_envio_pedidos').select('dia, marketplace_id, sku, coste').eq('connection_id', connectionId).gte('dia', desde).lte('dia', hasta).order('pedido').range(d, d + 999),
  ).catch(() => null)
  if (!filas) return salida
  for (const r of filas) {
    const k = `${r.dia}|${r.marketplace_id ?? ''}|${r.sku ?? ''}`
    const x = salida.get(k) ?? { coste: 0, pedidos: 0 }
    x.coste += n(r.coste)
    x.pedidos++
    salida.set(k, x)
  }
  return salida
}

export async function costoDeEnvio(connectionId: string): Promise<{ hayTabla: boolean; perfiles: PerfilEnvio[]; importados: number; ultimoImportado: string | null }> {
  const s = createServiceClient()
  const [p, i] = await Promise.all([
    (async () => {
      const leer = (cols: string) => s.from('ventas_envio_perfiles').select(cols).eq('connection_id', connectionId).order('prioridad').order('created_at')
      const r = await leer(COLUMNAS_PERFIL)
      return r.error ? leer(COLUMNAS_PERFIL_349) : r
    })(),
    s.from('ventas_envio_pedidos').select('updated_at', { count: 'exact' }).eq('connection_id', connectionId).order('updated_at', { ascending: false }).limit(1),
  ])
  if (p.error) return { hayTabla: false, perfiles: [], importados: 0, ultimoImportado: null }
  return {
    hayTabla: true,
    perfiles: ((p.data ?? []) as unknown as Array<Record<string, unknown>>).map((x) => ({ ...(x as unknown as PerfilEnvio), importe: n(x.importe), skus: (x.skus as string[]) ?? [] })),
    importados: i.count ?? 0,
    ultimoImportado: ((i.data ?? [])[0] as { updated_at?: string } | undefined)?.updated_at ?? null,
  }
}

/** Una tabla tal como llega de la pantalla, saneada: topes crecientes (el último puede ser sin límite), importes ≥ 0, países en mayúsculas */
function limpiarTabla(t: unknown): TablaEnvio | null {
  const x = t as TablaEnvio | null
  if (!x || !Array.isArray(x.topes) || !Array.isArray(x.filas)) return null
  const num = (v: unknown) => (v === null || v === '' || v === undefined ? null : Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v) * 100) / 100 : null)
  const topes = x.topes.slice(0, 12).map(num)
  const filas = x.filas.slice(0, 60).map((f) => ({ zona: String(f.zona ?? '').trim().slice(0, 12) === 'resto' ? 'resto' : String(f.zona ?? '').trim().toUpperCase().slice(0, 2), importes: topes.map((_, i) => num(f.importes?.[i])) })).filter((f) => f.zona)
  return { topes, filas }
}

export async function guardarPerfilEnvio(connectionId: string, p: Partial<PerfilEnvio>): Promise<string> {
  olvidarCuenta(connectionId)
  const fecha = (x: unknown) => (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null)
  const fila = {
    connection_id: connectionId,
    nombre: (p.nombre ?? 'Por defecto').toString().trim().slice(0, 80) || 'Por defecto',
    prioridad: Math.max(1, Math.min(99, Math.round(Number(p.prioridad ?? 1)))),
    desde: fecha(p.desde),
    hasta: fecha(p.hasta),
    productos_modo: p.productos_modo === 'solo' || p.productos_modo === 'excepto' ? p.productos_modo : 'todos',
    skus: Array.isArray(p.skus) ? p.skus.filter((x) => typeof x === 'string').slice(0, 2000) : [],
    regla: (['ninguno', 'cobrado', 'pedido', 'unidad', 'precio', 'unidades', 'peso'] as const).includes(p.regla as ReglaEnvio) ? (p.regla as ReglaEnvio) : 'cobrado',
    importe: Math.max(0, Math.min(10_000, Math.round(Number(p.importe ?? 0) * 100) / 100)) || 0,
    ...(REGLAS_CON_TABLA.includes(p.regla as ReglaEnvio) ? { tabla: limpiarTabla(p.tabla) } : {}),
    ...(p.moneda ? { moneda: p.moneda === 'USD' ? 'USD' : 'EUR' } : {}),
    updated_at: new Date().toISOString(),
  }
  const s = createServiceClient()
  // Sin la migración 351, las reglas nuevas, la tabla y la moneda no caben: se dice claro
  const claro = (e: { message: string }) => (/tabla|moneda|regla_check/i.test(e.message) ? new Error('Falta lanzar la migración 351 (costo de envío por tablas).') : e)
  if (p.id) {
    const { error } = await s.from('ventas_envio_perfiles').update(fila).eq('id', p.id).eq('connection_id', connectionId)
    if (error) throw claro(error)
    return p.id
  }
  const { data, error } = await s.from('ventas_envio_perfiles').insert(fila).select('id').single()
  if (error) throw claro(error)
  return (data as { id: string }).id
}

export async function borrarPerfilEnvio(connectionId: string, id: string): Promise<void> {
  olvidarCuenta(connectionId)
  const { error } = await createServiceClient().from('ventas_envio_perfiles').delete().eq('id', id).eq('connection_id', connectionId)
  if (error) throw error
}

/** El coste real de envío de pedidos concretos (CSV «pedido;coste»). Se casa con su día, país y SKU (de los pedidos de los últimos 62 días) */
export async function importarEnvioPedidos(connectionId: string, filas: Array<{ pedido: string; coste: number }>): Promise<{ guardados: number; sinCasar: number }> {
  olvidarCuenta(connectionId)
  const s = createServiceClient()
  const pedidos = [...new Set(filas.map((f) => f.pedido))]
  const donde = new Map<string, { dia: string; marketplace_id: string; sku: string }>()
  for (let i = 0; i < pedidos.length; i += 300) {
    const { data } = await s.from('ventas_lineas').select('pedido, dia, marketplace_id, sku, unidades').eq('connection_id', connectionId).in('pedido', pedidos.slice(i, i + 300))
    // Un pedido de varios SKU se apunta al que más unidades lleva
    const mejor = new Map<string, { dia: string; marketplace_id: string; sku: string; unidades: number }>()
    for (const l of (data ?? []) as Array<{ pedido: string; dia: string; marketplace_id: string; sku: string; unidades: number }>) {
      const m = mejor.get(l.pedido)
      if (!m || l.unidades > m.unidades) mejor.set(l.pedido, l)
    }
    for (const [k, v] of mejor) donde.set(k, v)
  }
  const ahora = new Date().toISOString()
  const filasDb = filas.map((f) => ({ connection_id: connectionId, pedido: f.pedido, coste: f.coste, dia: donde.get(f.pedido)?.dia ?? null, marketplace_id: donde.get(f.pedido)?.marketplace_id ?? null, sku: donde.get(f.pedido)?.sku ?? null, updated_at: ahora }))
  for (let i = 0; i < filasDb.length; i += 500) {
    const { error } = await s.from('ventas_envio_pedidos').upsert(filasDb.slice(i, i + 500), { onConflict: 'connection_id,pedido' })
    if (error) throw error
  }
  return { guardados: filasDb.length, sinCasar: filasDb.filter((f) => !f.dia).length }
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

/** El desglose del inventario FBA de un SKU (como el desplegable de Sellerboard) y su ritmo de venta de los últimos 30 días */
export interface InventarioDelProducto {
  reservado: number | null
  enviado: number | null
  noApto: number | null
  /** Unidades al día vendidas en los últimos 30 días (todos los países) */
  ritmo: number
}

async function leerProductosDelPanel(connectionId: string): Promise<{ titulos: Record<string, { titulo: string | null; asin: string | null }>; costes: Record<string, number>; catalogo: ProductoDelCatalogo[]; stock: Record<string, number>; bsr: Record<string, BsrDelProducto>; inventario: Record<string, InventarioDelProducto> }> {
  const s = createServiceClient()
  const titulos: Record<string, { titulo: string | null; asin: string | null }> = {}
  const catalogo: ProductoDelCatalogo[] = []
  // Inventario FBA vendible por SKU: el almacén es uno (pan-europeo / EFN), así que se toma el mayor de los países
  const stock: Record<string, number> = {}
  const inventario: Record<string, InventarioDelProducto> = {}
  const mayor = (a: number | null, b: unknown) => (b == null ? a : Math.max(a ?? 0, Number(b)))
  // TODO A LA VEZ (antes eran 5 lecturas en serie de 1.000 en 1.000: ShoesF tardaba 7 s en frío y ahora ~1,5 s)
  const hace30 = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)
  type Desglose = { sku: string; fba_reserved_quantity: number | null; fba_inbound_quantity: number | null; fba_unfulfillable_quantity: number | null }
  type Listing = { sku: string; asin: string | null; title: string | null; marketplace_id: string; price: number | null; currency: string | null; is_fba: boolean | null; listing_status: string | null; fba_fulfillable_quantity: number | null; fba_quantity: number | null }
  const [desglose, recientes, listings, costes, bsr] = await Promise.all([
    // El desglose (migración 271): reservado, enviado y no apto. Sin las columnas, sin desglose
    todasLasPaginas<Desglose>((d) => s.from('amazon_listings').select('sku, fba_reserved_quantity, fba_inbound_quantity, fba_unfulfillable_quantity').eq('connection_id', connectionId).eq('is_fba', true).order('id').range(d, d + 999)).catch(() => [] as Desglose[]),
    // El ritmo: unidades de los últimos 30 días (sin cancelados) entre 30
    todasLasPaginas<{ sku: string; unidades: number | null; estado: string | null }>((d) => s.from('ventas_lineas').select('sku, unidades, estado').eq('connection_id', connectionId).gte('dia', hace30).order('pedido').order('sku').range(d, d + 999)).catch(() => []),
    todasLasPaginas<Listing>((d) => s.from('amazon_listings').select('sku, asin, title, marketplace_id, price, currency, is_fba, listing_status, fba_fulfillable_quantity, fba_quantity').eq('connection_id', connectionId).order('id').range(d, d + 999)).catch(() => [] as Listing[]),
    leerCostes(connectionId),
    bsrDelPanel(connectionId),
  ])
  for (const l of desglose) {
    const x = inventario[l.sku] ?? { reservado: null, enviado: null, noApto: null, ritmo: 0 }
    inventario[l.sku] = { ...x, reservado: mayor(x.reservado, l.fba_reserved_quantity), enviado: mayor(x.enviado, l.fba_inbound_quantity), noApto: mayor(x.noApto, l.fba_unfulfillable_quantity) }
  }
  const vendidas: Record<string, number> = {}
  for (const l of recientes) {
    if (String(l.estado ?? '').toLowerCase() === 'cancelled') continue
    vendidas[l.sku] = (vendidas[l.sku] ?? 0) + Number(l.unidades ?? 0)
  }
  for (const [sku, n] of Object.entries(vendidas)) inventario[sku] = { ...(inventario[sku] ?? { reservado: null, enviado: null, noApto: null, ritmo: 0 }), ritmo: Math.round((n / 30) * 100) / 100 }
  for (const l of listings) {
    if (!titulos[l.sku] || (!titulos[l.sku].titulo && l.title)) titulos[l.sku] = { titulo: l.title, asin: l.asin }
    const uds = l.fba_fulfillable_quantity ?? l.fba_quantity
    if (l.is_fba && uds != null) stock[l.sku] = Math.max(stock[l.sku] ?? 0, Number(uds))
    catalogo.push({ sku: l.sku, mkt: l.marketplace_id, asin: l.asin, titulo: l.title, precio: l.price == null ? null : Number(l.price), moneda: l.currency, fba: Boolean(l.is_fba), activo: !l.listing_status || /active|buyable|discoverable/i.test(l.listing_status) })
  }
  return { titulos, costes, catalogo, stock, bsr, inventario }
}

/** El BSR de categoría más reciente de cada SKU (últimos 10 días) y el de unos días antes, para la tendencia. Si falla, sin BSR */
async function bsrDelPanel(connectionId: string): Promise<Record<string, BsrDelProducto>> {
  // 4 días bastan para el último y el de «antes» (más de 2 días de diferencia). TODAS las filas: con `.limit(5000)` Supabase daba 1.000, solo
  // ~1.000 SKU tenían BSR y ninguno tendencia en las cuentas grandes
  const desde = new Date(Date.now() - 4 * 86_400_000).toISOString()
  const data = await todasLasPaginas<{ sku: string; fecha: string; rank: number }>((d) =>
    createServiceClient().from('amazon_snapshots_bsr').select('sku, fecha, rank').eq('connection_id', connectionId).eq('tipo', 'categoria').gte('fecha', desde).order('fecha', { ascending: false }).order('sku').order('rank').range(d, d + 999),
  ).catch(() => null)
  if (!data) return {}
  const salida: Record<string, BsrDelProducto> = {}
  const primera: Record<string, string> = {}
  for (const f of data) {
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
  const filas = await todasLasPaginas<{ asin: string; marketplace_id: string; sesiones: number }>((d) =>
    s.from('trafico_diario').select('asin, marketplace_id, sesiones').eq('client_id', clientId).gte('fecha', desde).lte('fecha', hasta).order('fecha').order('marketplace_id').order('asin').range(d, d + 999),
  20).catch(() => null)
  if (!filas) return null
  for (const f of filas) {
    const k = `${f.marketplace_id}|${f.asin}`
    salida[k] = (salida[k] ?? 0) + Number(f.sesiones || 0)
  }
  return filas.length ? salida : null
}

export async function lineasDelPanel(connectionId: string, desde: string, hasta: string): Promise<LineaDelPanel[]> {
  // Todas (hasta 10.000): con `.limit(1500)` Supabase daba 1.000 y Creative Toys enseñaba 1.000 de sus 1.876 líneas de 30 días
  const data = await todasLasPaginas<Record<string, unknown>>(
    (d) =>
      createServiceClient()
        .from('ventas_lineas')
        .select('pedido, sku, marketplace_id, fecha, estado, unidades, ventas, promo, tarifa_referral, tarifa_fba, otras_tarifas, tarifas_reales, asin')
        .eq('connection_id', connectionId)
        .gte('dia', desde)
        .lte('dia', hasta)
        .order('fecha', { ascending: false })
        .order('pedido')
        .order('sku')
        .range(d, d + 999),
    10,
  )
  return data.map((l) => ({
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
  olvidar(`costes:${connectionId}`)
  olvidar('resumen:')
  const filas = costes.map((c) => ({ connection_id: connectionId, sku: c.sku, coste: c.coste, updated_by: userId, updated_at: new Date().toISOString() }))
  for (let i = 0; i < filas.length; i += 500) {
    const { error } = await createServiceClient().from('ventas_costes').upsert(filas.slice(i, i + 500), { onConflict: 'connection_id,sku' })
    if (error) throw error
  }
  return filas.length
}

export async function guardarCoste(connectionId: string, sku: string, coste: number | null, userId: string): Promise<void> {
  olvidar(`productos:${connectionId}`)
  olvidar(`costes:${connectionId}`)
  olvidar('resumen:')
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
  olvidarCuenta(connectionId)
  // Una cuenta de EE. UU., Canadá o México no tiene IVA europeo: ni en las ventas ni en las tarifas
  const { data: con } = await createServiceClient().from('amazon_connections').select('region').eq('id', connectionId).maybeSingle()
  const sinIva = (con as { region?: string } | null)?.region === 'na'
  const { error } = await createServiceClient().from('ventas_cuentas').upsert({ connection_id: connectionId, activa: true, ...(sinIva ? { iva_pct: 0 } : {}) }, { onConflict: 'connection_id' })
  if (error) throw error
}

/** Los ajustes de la página «Configuración» (migración 353) */
export async function guardarAjustes(connectionId: string, ajustes: unknown): Promise<AjustesCuenta> {
  olvidarCuenta(connectionId)
  const limpio = normalizarAjustes(ajustes)
  const { error } = await createServiceClient().from('ventas_cuentas').update({ ajustes: limpio }).eq('connection_id', connectionId)
  if (error) {
    if (error.code === '42703' || /ajustes/.test(error.message ?? '')) throw new Error('Falta lanzar la migración 353 (ajustes de la cuenta).')
    throw error
  }
  return limpio
}

export async function cambiarIvaPorPais(connectionId: string, porPais: boolean): Promise<void> {
  olvidarCuenta(connectionId)
  const { error } = await createServiceClient().from('ventas_cuentas').update({ iva_por_pais: porPais }).eq('connection_id', connectionId)
  if (error) throw error
}

export async function cambiarIva(connectionId: string, iva: number): Promise<void> {
  olvidarCuenta(connectionId)
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

/** Las ventas de un periodo separadas por canal (FBA / FBM), de las líneas de pedido (62 días). Sin cancelados */
export interface CanalesDeVentas {
  fba: { ventas: number; unidades: number; pedidos: number }
  fbm: { ventas: number; unidades: number; pedidos: number }
}

export async function canalesDeVentas(connectionId: string, desde: string, hasta: string, filtros: { skus?: string[]; mercados?: string[] } = {}): Promise<CanalesDeVentas> {
  const s = createServiceClient()
  const out: CanalesDeVentas = { fba: { ventas: 0, unidades: 0, pedidos: 0 }, fbm: { ventas: 0, unidades: 0, pedidos: 0 } }
  const pedidos = { fba: new Set<string>(), fbm: new Set<string>() }
  for (let d = 0; ; d += 1000) {
    let q = s.from('ventas_lineas').select('pedido, sku, marketplace_id, canal, estado, unidades, ventas').eq('connection_id', connectionId).gte('dia', desde).lte('dia', hasta)
    if (filtros.skus?.length) q = q.in('sku', filtros.skus)
    if (filtros.mercados?.length) q = q.in('marketplace_id', filtros.mercados)
    const { data, error } = await q.order('pedido').range(d, d + 999)
    if (error) throw error
    for (const l of (data ?? []) as Array<{ pedido: string; canal: string | null; estado: string | null; unidades: number | null; ventas: number | null }>) {
      if (String(l.estado ?? '').toLowerCase() === 'cancelled') continue
      const c = String(l.canal ?? '').toLowerCase() === 'fbm' ? 'fbm' : 'fba'
      out[c].ventas += Number(l.ventas ?? 0)
      out[c].unidades += Number(l.unidades ?? 0)
      pedidos[c].add(l.pedido)
    }
    if ((data ?? []).length < 1000) break
  }
  out.fba.pedidos = pedidos.fba.size
  out.fbm.pedidos = pedidos.fbm.size
  out.fba.ventas = Math.round(out.fba.ventas * 100) / 100
  out.fbm.ventas = Math.round(out.fbm.ventas * 100) / 100
  return out
}
