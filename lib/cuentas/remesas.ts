/**
 * CUENTAS DE CLIENTES · LA PARTE DE REMESAS A FBA. SOLO SERVIDOR Y SOLO LECTURA.
 *
 * Lo que la agencia ya guarda en las tablas de Remesas (no se llama a Amazon ni se escribe nada):
 *   · fba_remesas          los envíos abiertos por fase (borrador → aprobada → encajando → lista → enviada) y el último envío real;
 *   · fba_remesa_lineas    las unidades de cada envío abierto (solo en el detalle);
 *   · fba_alertas          las alertas abiertas de la pasada diaria (rotura de stock, envíos atascados, descuadres…), migración 267;
 *   · amazon_listings      el stock en Amazon según la última lectura del catálogo (con el desglose de la 271 si está lanzada).
 *
 * QUIÉN LO VE: Remesas tiene su propio permiso (lib/fba/acceso.ts): un administrador ve todos los clientes y cualquier otra persona solo los
 * que tiene en fba_accesos. Aquí se respeta igual: quien lleva la cuenta pero no tiene Remesas de ese cliente ve «sin acceso», no las cifras.
 *
 * En la LISTA va lo ligero (dos consultas para TODOS los clientes, sin N+1); en el detalle de UN cliente, además, envíos, alertas y stock.
 * Cada parte falla por su lado y sin la migración 267 la pestaña lo dice en vez de romperse.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { conexionesDeCliente } from '@/lib/cumplimiento/conexiones'

export const FASES_ABIERTAS = ['borrador', 'aprobada', 'encajando', 'lista', 'enviada'] as const
export type FaseAbierta = (typeof FASES_ABIERTAS)[number]
export type SeveridadFba = 'critica' | 'alta' | 'media' | 'info'

export interface RemesaAbierta {
  id: string
  nombre: string | null
  estado: FaseAbierta
  /** Estado del envío según Amazon (WORKING, SHIPPED, IN_TRANSIT, RECEIVING…), tal cual. null = sin seguimiento */
  estadoAmazon: string | null
  fechaEnvio: string
  referencia: string | null
  marketplaceId: string
  unidades: number
  actualizada: string | null
}

export interface AlertaFbaResumida {
  id: string
  tipo: string
  severidad: SeveridadFba
  titulo: string
  detalle: string | null
  sku: string | null
  impacto: number
  desde: string
}

export interface StockFba {
  marketplaceId: string
  /** Cuántos países tienen stock leído (en Europa el mismo almacén sale en varios: se enseña el que más tiene, no la suma) */
  mercados: number
  referencias: number
  disponible: number
  total: number
  /** Desglose de la 271. null = sin la migración o sin leer todavía */
  deCamino: number | null
  reservado: number | null
  noApto: number | null
}

export interface ResumenRemesas {
  /** false = quien mira no tiene Remesas de este cliente */
  acceso: boolean
  porFase: Record<FaseAbierta, number>
  abiertas: number
  /** La fecha del último envío real (enviada o cerrada) */
  ultimoEnvio: string | null
  totalRemesas: number
  alertas: Record<SeveridadFba, number>
  /** Falta la migración 267 (alertas) */
  faltaAlertas: boolean
  error: string | null
  /** Solo en el detalle */
  remesas?: RemesaAbierta[]
  listaAlertas?: AlertaFbaResumida[]
  stock?: StockFba | null
}

const n = (v: unknown) => Number(v ?? 0) || 0
const sinTabla = (e: { code?: string } | null | undefined) => e?.code === '42P01' || e?.code === '42703' || e?.code === 'PGRST204' || e?.code === 'PGRST205'
const vacio = (): Record<FaseAbierta, number> => ({ borrador: 0, aprobada: 0, encajando: 0, lista: 0, enviada: 0 })
const sinAlertas = (): Record<SeveridadFba, number> => ({ critica: 0, alta: 0, media: 0, info: 0 })

export const SIN_ACCESO: ResumenRemesas = { acceso: false, porFase: vacio(), abiertas: 0, ultimoEnvio: null, totalRemesas: 0, alertas: sinAlertas(), faltaAlertas: false, error: null }

/** Qué clientes de Remesas puede ver esta persona: null = todos (administrador) */
export async function clientesDeRemesasPermitidos(userId: string, rol: string): Promise<Set<string> | null> {
  if (rol === 'admin') return null
  const { data, error } = await createServiceClient().from('fba_accesos').select('client_id').eq('user_id', userId)
  if (error) return new Set()
  return new Set(((data ?? []) as Array<{ client_id: string }>).map((a) => a.client_id))
}

/** LIGERO, para la lista: fases y alertas de todos los clientes de golpe (dos consultas en total) */
export async function remesasDeLista(ids: readonly string[], permitidos: Set<string> | null): Promise<Map<string, ResumenRemesas>> {
  const salida = new Map<string, ResumenRemesas>()
  const visibles = ids.filter((id) => !permitidos || permitidos.has(id))
  for (const id of ids) if (permitidos && !permitidos.has(id)) salida.set(id, SIN_ACCESO)
  if (visibles.length === 0) return salida
  const s = createServiceClient()
  const [remesas, alertas] = await Promise.all([
    s.from('fba_remesas').select('client_id, estado, fecha_envio').in('client_id', visibles).limit(20000),
    s.from('fba_alertas').select('client_id, severidad').in('client_id', visibles).eq('estado', 'abierta').limit(20000),
  ])
  const faltaAlertas = sinTabla(alertas.error)
  for (const id of visibles) salida.set(id, { acceso: true, porFase: vacio(), abiertas: 0, ultimoEnvio: null, totalRemesas: 0, alertas: sinAlertas(), faltaAlertas, error: remesas.error ? 'No se han podido leer los envíos.' : null })
  for (const r of (remesas.data ?? []) as Array<{ client_id: string; estado: string | null; fecha_envio: string }>) {
    const x = salida.get(r.client_id)
    if (!x) continue
    x.totalRemesas++
    // Sin estado = remesa de antes de la migración 195: historia, o sea envío cerrado (como hace Remesas)
    const estado = r.estado ?? 'cerrada'
    if ((FASES_ABIERTAS as readonly string[]).includes(estado)) {
      x.porFase[estado as FaseAbierta]++
      x.abiertas++
    }
    if ((estado === 'enviada' || estado === 'cerrada') && (!x.ultimoEnvio || r.fecha_envio > x.ultimoEnvio)) x.ultimoEnvio = r.fecha_envio
  }
  if (!alertas.error) {
    for (const a of (alertas.data ?? []) as Array<{ client_id: string; severidad: SeveridadFba }>) {
      const x = salida.get(a.client_id)
      if (x && a.severidad in x.alertas) x.alertas[a.severidad]++
    }
  }
  return salida
}

const ORDEN: Record<SeveridadFba, number> = { critica: 0, alta: 1, media: 2, info: 3 }

/** COMPLETO, para el detalle de un cliente: además de lo ligero, sus envíos abiertos con unidades, las alertas abiertas y el stock */
export async function remesasDeCliente(amazonClientId: string, permitidos: Set<string> | null): Promise<ResumenRemesas> {
  if (permitidos && !permitidos.has(amazonClientId)) return SIN_ACCESO
  try {
    const base = (await remesasDeLista([amazonClientId], permitidos)).get(amazonClientId) ?? SIN_ACCESO
    const s = createServiceClient()
    const [abiertas, alertas, stock] = await Promise.all([
      s
        .from('fba_remesas')
        .select('id, nombre, estado, estado_amazon, fecha_envio, referencia_envio, marketplace_id, updated_at')
        .eq('client_id', amazonClientId)
        .in('estado', FASES_ABIERTAS as unknown as string[])
        .order('fecha_envio', { ascending: false })
        .limit(40),
      base.faltaAlertas
        ? Promise.resolve({ data: [], error: null })
        : s.from('fba_alertas').select('id, tipo, severidad, titulo, detalle, sku, impacto, primera_vez_at').eq('client_id', amazonClientId).eq('estado', 'abierta').limit(200),
      stockDeCliente(amazonClientId).catch(() => null),
    ])

    let remesas: RemesaAbierta[] = []
    if (!abiertas.error) {
      const filas = (abiertas.data ?? []) as Array<Record<string, unknown>>
      const unidades = new Map<string, number>()
      if (filas.length) {
        const { data: lineas } = await s.from('fba_remesa_lineas').select('remesa_id, unidades').in('remesa_id', filas.map((f) => String(f.id))).limit(20000)
        for (const l of (lineas ?? []) as Array<{ remesa_id: string; unidades: number }>) unidades.set(l.remesa_id, (unidades.get(l.remesa_id) ?? 0) + n(l.unidades))
      }
      remesas = filas.map((f) => ({
        id: String(f.id),
        nombre: (f.nombre as string | null) ?? null,
        estado: f.estado as FaseAbierta,
        estadoAmazon: (f.estado_amazon as string | null) ?? null,
        fechaEnvio: String(f.fecha_envio),
        referencia: (f.referencia_envio as string | null) ?? null,
        marketplaceId: String(f.marketplace_id ?? ''),
        unidades: unidades.get(String(f.id)) ?? 0,
        actualizada: (f.updated_at as string | null) ?? null,
      }))
    }

    const listaAlertas: AlertaFbaResumida[] = ((alertas.data ?? []) as Array<Record<string, unknown>>)
      .map((a) => ({
        id: String(a.id),
        tipo: String(a.tipo),
        severidad: a.severidad as SeveridadFba,
        titulo: String(a.titulo),
        detalle: (a.detalle as string | null) ?? null,
        sku: (a.sku as string | null) ?? null,
        impacto: n(a.impacto),
        desde: String(a.primera_vez_at),
      }))
      .sort((a, b) => ORDEN[a.severidad] - ORDEN[b.severidad] || b.impacto - a.impacto)
      .slice(0, 12)

    return { ...base, error: base.error ?? (abiertas.error ? 'No se han podido leer los envíos abiertos.' : null), remesas, listaAlertas, stock }
  } catch (e) {
    console.error('[cuentas] remesas:', e instanceof Error ? e.message : e)
    return { ...SIN_ACCESO, acceso: true, error: 'No se han podido leer los datos de Remesas.' }
  }
}

/**
 * El stock en Amazon de las conexiones del cliente, del espejo del catálogo. En Europa el mismo stock aparece en varios países (un solo almacén
 * que envía fuera), así que NO se suma entre países: se enseña el país que más tiene y cuántos países tienen stock.
 */
async function stockDeCliente(amazonClientId: string): Promise<StockFba | null> {
  const conexiones = await conexionesDeCliente(amazonClientId)
  if (conexiones.length === 0) return null
  const s = createServiceClient()
  const ids = conexiones.map((c) => c.id)
  const leer = (columnas: string) =>
    s.from('amazon_listings').select(columnas).in('connection_id', ids).or('fba_quantity.gt.0,fba_fulfillable_quantity.gt.0').limit(10000)
  let r = await leer('marketplace_id, fba_quantity, fba_fulfillable_quantity, fba_inbound_quantity, fba_reserved_quantity, fba_unfulfillable_quantity')
  let conDesglose = true
  if (r.error && sinTabla(r.error)) {
    // Sin la 271: solo el total y lo disponible
    r = await leer('marketplace_id, fba_quantity, fba_fulfillable_quantity')
    conDesglose = false
  }
  if (r.error) throw r.error
  const porPais = new Map<string, StockFba>()
  for (const f of (r.data ?? []) as unknown as Array<Record<string, unknown>>) {
    const m = String(f.marketplace_id ?? '')
    const x = porPais.get(m) ?? { marketplaceId: m, mercados: 0, referencias: 0, disponible: 0, total: 0, deCamino: conDesglose ? 0 : null, reservado: conDesglose ? 0 : null, noApto: conDesglose ? 0 : null }
    x.referencias++
    x.disponible += n(f.fba_fulfillable_quantity)
    x.total += n(f.fba_quantity)
    if (conDesglose) {
      x.deCamino = (x.deCamino ?? 0) + n(f.fba_inbound_quantity)
      x.reservado = (x.reservado ?? 0) + n(f.fba_reserved_quantity)
      x.noApto = (x.noApto ?? 0) + n(f.fba_unfulfillable_quantity)
    }
    porPais.set(m, x)
  }
  const paises = [...porPais.values()].sort((a, b) => b.disponible - a.disponible || b.total - a.total)
  if (paises.length === 0) return { marketplaceId: '', mercados: 0, referencias: 0, disponible: 0, total: 0, deCamino: null, reservado: null, noApto: null }
  return { ...paises[0], mercados: paises.length }
}
