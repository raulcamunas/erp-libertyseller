import { createServiceClient } from '@/lib/supabase/service'
import { connectionCredentials } from '@/lib/amazon/data'
import { spApiRequest } from '@/lib/amazon/sp-api'
import { AmazonApiError } from '@/lib/amazon/errors'
import { campanaDelPedido, cuandoPedir, DIAS_MAXIMO, instanteEnMadrid, pedidoDeReembolso, siNoLaOfrece, type Campana, type EstadoEnvio, type PedidoParaCola } from './resenas'

/**
 * RESEÑAS · EL SERVIDOR.
 *
 *   pasadaResenas()  el cron (cada 10 min): mete en la cola los pedidos nuevos de las cuentas con alguna campaña activa (de `ventas_lineas`, que trae el
 *                    cron de ventas) y pide la reseña de los que ya toca, con la API oficial de Amazon. Una llamada por segundo como mucho.
 *   resumenResenas() el panel de todas las cuentas: enviadas hoy, 7 y 30 días, y en cola
 *   detalleResenas() una cuenta: sus campañas, la cola por días y por estado, y los últimos pedidos
 */

type Servicio = ReturnType<typeof createServiceClient>
const DIA_MS = 86_400_000
const ACCION = 'productReviewAndSellerFeedback'
const COLUMNAS_CAMPANA = 'id, connection_id, nombre, prioridad, activa, desde, hasta, dias_tras_entrega, hora, excluir_fbm, excluir_promo, mercados, productos_modo, skus'

const hoyEnMadrid = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))
const faltaTabla = (e: { message?: string; code?: string } | null) => !!e && (e.code === '42P01' || e.code === 'PGRST205' || /resenas_/.test(e.message ?? ''))

export interface ResultadoPasadaResenas {
  sinTabla?: boolean
  encolados: number
  enviadas: number
  hechos: string[]
  avisos: string[]
}

export async function pasadaResenas(presupuestoMs: number): Promise<ResultadoPasadaResenas> {
  const service = createServiceClient()
  const arranque = Date.now()
  const salida: ResultadoPasadaResenas = { encolados: 0, enviadas: 0, hechos: [], avisos: [] }
  const { data: cs, error } = await service.from('resenas_campanas').select(COLUMNAS_CAMPANA).eq('activa', true)
  if (error) {
    if (faltaTabla(error)) return { ...salida, sinTabla: true }
    throw error
  }
  const porCuenta = new Map<string, Campana[]>()
  for (const c of (cs ?? []) as Campana[]) porCuenta.set(c.connection_id, [...(porCuenta.get(c.connection_id) ?? []), c])

  for (const [cuenta, campanas] of porCuenta) {
    if (Date.now() - arranque > presupuestoMs) break
    try {
      const n = await encolar(service, cuenta, campanas)
      salida.encolados += n
      const r = await enviar(service, cuenta, presupuestoMs - (Date.now() - arranque))
      salida.enviadas += r.enviadas
      if (n || r.enviadas || r.otras) salida.hechos.push(`${cuenta.slice(0, 8)}: ${n} a la cola, ${r.enviadas} pedidas${r.otras ? `, ${r.otras} sin ofrecer o fuera de plazo` : ''}`)
      if (r.aviso) salida.avisos.push(`${cuenta.slice(0, 8)}: ${r.aviso}`)
    } catch (e) {
      salida.avisos.push(`${cuenta.slice(0, 8)}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return salida
}

/** Los pedidos con algún reembolso desde esa fecha: a esos NUNCA se les pide la reseña (sería invitar a una de una estrella) */
async function pedidosReembolsados(service: Servicio, cuenta: string, desdeDia: string): Promise<Set<string>> {
  const salida = new Set<string>()
  for (let d = 0; d < 50_000; d += 1000) {
    const { data, error } = await service.from('ventas_movimientos').select('clave').eq('connection_id', cuenta).eq('tipo', 'reembolso').gte('dia', desdeDia).range(d, d + 999)
    if (error) throw error
    for (const f of (data ?? []) as Array<{ clave: string }>) {
      const p = pedidoDeReembolso(f.clave)
      if (p) salida.add(p)
    }
    if ((data ?? []).length < 1000) break
  }
  return salida
}
const diaHace = (dias: number) => new Date(Date.now() - dias * DIA_MS).toISOString().slice(0, 10)

/** Los pedidos de los últimos 30 días que aún no están en la cola, con la campaña que les toca (los reembolsados, nunca) */
async function encolar(service: Servicio, cuenta: string, campanas: Campana[]): Promise<number> {
  const desde = new Date(Date.now() - DIAS_MAXIMO * DIA_MS).toISOString()
  const lineas: Array<{ pedido: string; sku: string; marketplace_id: string; fecha: string; dia: string; canal: string | null; promo: number; ventas: number | null; estado: string | null }> = []
  for (let d = 0; d < 50_000; d += 1000) {
    const { data, error } = await service.from('ventas_lineas').select('pedido, sku, marketplace_id, fecha, dia, canal, promo, ventas, estado').eq('connection_id', cuenta).gte('fecha', desde).range(d, d + 999)
    if (error) throw error
    lineas.push(...((data ?? []) as typeof lineas))
    if ((data ?? []).length < 1000) break
  }
  if (!lineas.length) return 0
  const ya = new Set<string>()
  for (let d = 0; d < 50_000; d += 1000) {
    const { data, error } = await service.from('resenas_envios').select('pedido').eq('connection_id', cuenta).gte('compra_at', new Date(Date.now() - (DIAS_MAXIMO + 5) * DIA_MS).toISOString()).range(d, d + 999)
    if (error) throw error
    for (const f of (data ?? []) as Array<{ pedido: string }>) ya.add(f.pedido)
    if ((data ?? []).length < 1000) break
  }
  const reembolsados = await pedidosReembolsados(service, cuenta, diaHace(DIAS_MAXIMO + 5))
  const pedidos = new Map<string, PedidoParaCola>()
  for (const l of lineas) {
    if (ya.has(l.pedido) || reembolsados.has(l.pedido) || /cancel/i.test(l.estado ?? '')) continue
    const p = pedidos.get(l.pedido) ?? { pedido: l.pedido, marketplace_id: l.marketplace_id, fecha: l.fecha, dia: l.dia, fbm: false, promo: 0, skus: [], importe: 0 }
    p.fbm ||= l.canal === 'fbm'
    p.promo += Number(l.promo || 0)
    p.importe += Number(l.ventas || 0)
    if (!p.skus.includes(l.sku)) p.skus.push(l.sku)
    pedidos.set(l.pedido, p)
  }
  const filas = []
  for (const p of pedidos.values()) {
    const c = campanaDelPedido(p, campanas)
    if (!c) continue
    filas.push({ connection_id: cuenta, pedido: p.pedido, marketplace_id: p.marketplace_id, campana_id: c.id, compra_at: p.fecha, programado_at: cuandoPedir(p.dia, c).toISOString(), estado: 'en_cola', skus: p.skus, importe: Math.round(p.importe * 100) / 100 })
  }
  for (let i = 0; i < filas.length; i += 500) {
    const { error } = await service.from('resenas_envios').upsert(filas.slice(i, i + 500), { onConflict: 'connection_id,pedido', ignoreDuplicates: true })
    if (error) throw error
  }
  return filas.length
}

/** Pide la reseña de los pedidos a los que ya les toca (como mucho 1 por segundo) */
async function enviar(service: Servicio, cuenta: string, presupuestoMs: number): Promise<{ enviadas: number; otras: number; aviso?: string }> {
  const arranque = Date.now()
  const { data, error } = await service
    .from('resenas_envios')
    .select('pedido, marketplace_id, compra_at, intentos, campana_id')
    .eq('connection_id', cuenta)
    .eq('estado', 'en_cola')
    .lte('programado_at', new Date().toISOString())
    .order('programado_at')
    .limit(60)
  if (error) throw error
  const cola = (data ?? []) as Array<{ pedido: string; marketplace_id: string; compra_at: string; intentos: number; campana_id: string | null }>
  if (!cola.length) return { enviadas: 0, otras: 0 }
  const resuelta = await connectionCredentials(cuenta)
  if (!resuelta) return { enviadas: 0, otras: 0, aviso: 'sin credenciales de Amazon' }
  const creds = resuelta.credentials
  const { data: cs } = await service.from('resenas_campanas').select('id, hora').eq('connection_id', cuenta)
  const horaDe = new Map(((cs ?? []) as Array<{ id: string; hora: number }>).map((c) => [c.id, c.hora]))
  const hoy = hoyEnMadrid()
  const reembolsados = await pedidosReembolsados(service, cuenta, diaHace(DIAS_MAXIMO + 10))
  let enviadas = 0
  let otras = 0
  for (const e of cola) {
    if (Date.now() - arranque > presupuestoMs - 5_000) break
    const ahora = new Date().toISOString()
    const marcar = (cambios: Record<string, unknown>) => service.from('resenas_envios').update({ intentos: e.intentos + 1, ultimo_intento_at: ahora, ...cambios }).eq('connection_id', cuenta).eq('pedido', e.pedido)
    // Reembolsado mientras esperaba en la cola: no se pide
    if (reembolsados.has(e.pedido)) {
      await service.from('resenas_envios').update({ estado: 'reembolsado', detalle: 'Pedido reembolsado: no se pide la reseña' }).eq('connection_id', cuenta).eq('pedido', e.pedido)
      otras++
      continue
    }
    try {
      const { data: acc } = await spApiRequest<{ _links?: { actions?: Array<{ name?: string }> } }>(creds, 'getSolicitationActionsForOrder', {
        method: 'GET',
        path: `/solicitations/v1/orders/${encodeURIComponent(e.pedido)}`,
        query: { marketplaceIds: [e.marketplace_id] },
        maxAttempts: 2,
      })
      const ofrece = (acc?._links?.actions ?? []).some((a) => a.name === ACCION)
      if (ofrece) {
        await spApiRequest(creds, 'createProductReviewAndSellerFeedbackSolicitation', {
          method: 'POST',
          path: `/solicitations/v1/orders/${encodeURIComponent(e.pedido)}/solicitations/${ACCION}`,
          query: { marketplaceIds: [e.marketplace_id] },
          repeatable: false,
          maxAttempts: 1,
        })
        await marcar({ estado: 'enviada', enviada_at: ahora, detalle: null })
        enviadas++
      } else {
        const diaCompra = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(e.compra_at))
        const r = siNoLaOfrece(diaCompra, hoy)
        if (r.reintentarEl) await marcar({ programado_at: instanteEnMadrid(r.reintentarEl, horaDe.get(e.campana_id ?? '') ?? 20).toISOString(), detalle: 'Amazon aún no la ofrece: se prueba mañana' })
        else {
          await marcar({ estado: r.estado, detalle: r.estado === 'caducada' ? 'Fuera del plazo de 30 días' : 'Amazon no la ofrece (ya pedida, por ejemplo desde Sellerboard o Seller Central, o pedido no apto)' })
          otras++
        }
      }
    } catch (err) {
      if (err instanceof AmazonApiError && err.httpStatus === 429) return { enviadas, otras, aviso: 'Amazon pide ir más despacio: se sigue en la próxima pasada' }
      const texto = err instanceof AmazonApiError ? err.humanMessage : err instanceof Error ? err.message : String(err)
      // Un fallo suelto se reintenta mañana; tres seguidos lo dejan en «error» para que se vea
      if (e.intentos + 1 >= 3) await marcar({ estado: 'error', detalle: texto.slice(0, 300) })
      else await marcar({ programado_at: new Date(Date.now() + DIA_MS).toISOString(), detalle: texto.slice(0, 300) })
    }
    await espera(1100)
  }
  return { enviadas, otras }
}

/* ------------------------------------------------------------------ */
/* Lo que lee el panel                                                 */
/* ------------------------------------------------------------------ */

export interface ResumenResenasCuenta {
  cuenta: string
  hoy: number
  dias7: number
  dias30: number
  enCola: number
  activas: number
  campanas: number
}

/** Por cuenta: enviadas hoy (Madrid), en 7 y 30 días, en cola y campañas */
export async function resumenResenas(): Promise<{ sinTabla?: boolean; cuentas: ResumenResenasCuenta[] }> {
  const s = createServiceClient()
  const hoy = hoyEnMadrid()
  const inicioHoy = instanteEnMadrid(hoy, 0).getTime()
  const hace30 = new Date(inicioHoy - 29 * DIA_MS).toISOString()
  const [cam, env, cola] = await Promise.all([
    s.from('resenas_campanas').select('connection_id, activa'),
    s.from('resenas_envios').select('connection_id, enviada_at').eq('estado', 'enviada').gte('enviada_at', hace30).limit(50_000),
    s.from('resenas_envios').select('connection_id').eq('estado', 'en_cola').limit(50_000),
  ])
  if (faltaTabla(cam.error)) return { sinTabla: true, cuentas: [] }
  if (cam.error) throw cam.error
  const por = new Map<string, ResumenResenasCuenta>()
  const de = (id: string) => {
    let r = por.get(id)
    if (!r) por.set(id, (r = { cuenta: id, hoy: 0, dias7: 0, dias30: 0, enCola: 0, activas: 0, campanas: 0 }))
    return r
  }
  for (const c of (cam.data ?? []) as Array<{ connection_id: string; activa: boolean }>) {
    const r = de(c.connection_id)
    r.campanas++
    if (c.activa) r.activas++
  }
  for (const e of (env.data ?? []) as Array<{ connection_id: string; enviada_at: string }>) {
    const r = de(e.connection_id)
    const t = Date.parse(e.enviada_at)
    r.dias30++
    if (t >= inicioHoy - 6 * DIA_MS) r.dias7++
    if (t >= inicioHoy) r.hoy++
  }
  for (const e of (cola.data ?? []) as Array<{ connection_id: string }>) de(e.connection_id).enCola++
  return { cuentas: [...por.values()] }
}

export interface EnvioDeResena {
  pedido: string
  mkt: string
  compraAt: string
  programadoAt: string
  estado: EstadoEnvio
  enviadaAt: string | null
  intentos: number
  detalle: string | null
  skus: string[]
  importe: number | null
  campana: string | null
}

/** Un pedido de la cuenta (de los últimos 40 días) y cómo va su reseña */
export interface PedidoConResena {
  pedido: string
  mkt: string
  compraAt: string
  skus: string[]
  unidades: number
  importe: number
  fbm: boolean
  promo: boolean
  reembolsado: boolean
  cancelado: boolean
  /** null = nunca ha entrado en la cola */
  envio: EnvioDeResena | null
}

export interface DetalleResenas {
  campanas: Array<Campana & { enviadas30: number; enCola: number }>
  pedidos: PedidoConResena[]
  /** Por día (Madrid): lo enviado (pasado) y lo programado (futuro), por estado */
  porDia: Array<{ dia: string; enviadas: number; programadas: number; otras: number }>
  porEstado: Record<EstadoEnvio, number>
  envios: EnvioDeResena[]
}

export async function detalleResenas(cuenta: string): Promise<DetalleResenas> {
  const s = createServiceClient()
  const hoy = hoyEnMadrid()
  const desde = new Date(Date.parse(`${hoy}T00:00:00Z`) - 40 * DIA_MS).toISOString()
  const [cam, env] = await Promise.all([
    s.from('resenas_campanas').select(COLUMNAS_CAMPANA).eq('connection_id', cuenta).order('prioridad'),
    s
      .from('resenas_envios')
      .select('pedido, marketplace_id, compra_at, programado_at, estado, enviada_at, intentos, detalle, skus, importe, campana_id')
      .eq('connection_id', cuenta)
      .gte('compra_at', desde)
      .order('programado_at', { ascending: false })
      .limit(5000),
  ])
  if (cam.error) throw cam.error
  if (env.error) throw env.error
  const campanas = (cam.data ?? []) as Campana[]
  const nombre = new Map(campanas.map((c) => [c.id, c.nombre]))
  const envios: EnvioDeResena[] = ((env.data ?? []) as Array<Record<string, unknown>>).map((e) => ({
    pedido: String(e.pedido),
    mkt: String(e.marketplace_id),
    compraAt: String(e.compra_at),
    programadoAt: String(e.programado_at),
    estado: e.estado as EstadoEnvio,
    enviadaAt: (e.enviada_at as string) ?? null,
    intentos: Number(e.intentos ?? 0),
    detalle: (e.detalle as string) ?? null,
    skus: (e.skus as string[]) ?? [],
    importe: e.importe == null ? null : Number(e.importe),
    campana: e.campana_id ? (nombre.get(e.campana_id as string) ?? null) : null,
  }))
  const diaDe = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
  const dias = new Map<string, { dia: string; enviadas: number; programadas: number; otras: number }>()
  for (let k = -20; k <= 14; k++) {
    const d = new Date(Date.parse(`${hoy}T00:00:00Z`) + k * DIA_MS).toISOString().slice(0, 10)
    dias.set(d, { dia: d, enviadas: 0, programadas: 0, otras: 0 })
  }
  const porEstado = { en_cola: 0, enviada: 0, no_disponible: 0, caducada: 0, error: 0, descartada: 0, reembolsado: 0 } as Record<EstadoEnvio, number>
  const enviadas30 = new Map<string, number>()
  const enCola = new Map<string, number>()
  const hace30 = Date.now() - 30 * DIA_MS
  const campanaDe = new Map(((env.data ?? []) as Array<Record<string, unknown>>).map((e) => [String(e.pedido), (e.campana_id as string) ?? '']))
  for (const e of envios) {
    porEstado[e.estado] = (porEstado[e.estado] ?? 0) + 1
    const cid = campanaDe.get(e.pedido) ?? ''
    if (e.estado === 'enviada' && e.enviadaAt) {
      const d = dias.get(diaDe(e.enviadaAt))
      if (d) d.enviadas++
      if (Date.parse(e.enviadaAt) >= hace30) enviadas30.set(cid, (enviadas30.get(cid) ?? 0) + 1)
    } else if (e.estado === 'en_cola') {
      const d = dias.get(diaDe(e.programadoAt))
      if (d) d.programadas++
      enCola.set(cid, (enCola.get(cid) ?? 0) + 1)
    } else if (e.estado !== 'descartada') {
      const d = dias.get(diaDe(e.programadoAt))
      if (d) d.otras++
    }
  }
  // TODOS los pedidos de la cuenta (de ventas_lineas, que se guarda 62 días), con su reseña si la tiene
  const lineas: Array<{ pedido: string; sku: string; marketplace_id: string; fecha: string; canal: string | null; promo: number; ventas: number | null; unidades: number; estado: string | null }> = []
  for (let k = 0; k < 30_000; k += 1000) {
    const { data, error } = await s.from('ventas_lineas').select('pedido, sku, marketplace_id, fecha, canal, promo, ventas, unidades, estado').eq('connection_id', cuenta).gte('fecha', desde).order('fecha', { ascending: false }).range(k, k + 999)
    if (error) throw error
    lineas.push(...((data ?? []) as typeof lineas))
    if ((data ?? []).length < 1000) break
  }
  const reembolsados = await pedidosReembolsados(s, cuenta, desde.slice(0, 10))
  const envioDe = new Map(envios.map((e) => [e.pedido, e]))
  const pedidos = new Map<string, PedidoConResena>()
  for (const l of lineas) {
    let p = pedidos.get(l.pedido)
    if (!p) {
      p = { pedido: l.pedido, mkt: l.marketplace_id, compraAt: l.fecha, skus: [], unidades: 0, importe: 0, fbm: false, promo: false, reembolsado: reembolsados.has(l.pedido), cancelado: /cancel/i.test(l.estado ?? ''), envio: envioDe.get(l.pedido) ?? null }
      pedidos.set(l.pedido, p)
    }
    if (!p.skus.includes(l.sku)) p.skus.push(l.sku)
    p.unidades += Number(l.unidades || 0)
    p.importe = Math.round((p.importe + Number(l.ventas || 0)) * 100) / 100
    p.fbm ||= l.canal === 'fbm'
    p.promo ||= Number(l.promo || 0) > 0
  }

  return {
    campanas: campanas.map((c) => ({ ...c, enviadas30: enviadas30.get(c.id) ?? 0, enCola: enCola.get(c.id) ?? 0 })),
    pedidos: [...pedidos.values()].slice(0, 3000),
    porDia: [...dias.values()],
    porEstado,
    envios: envios.slice(0, 400),
  }
}

/** Crea o cambia una campaña. Devuelve su id */
export async function guardarCampana(cuenta: string, c: Partial<Campana> & { id?: string }, userId: string): Promise<string> {
  const s = createServiceClient()
  const fila = {
    connection_id: cuenta,
    nombre: (c.nombre ?? 'Reseñas').trim().slice(0, 80) || 'Reseñas',
    prioridad: Math.max(1, Math.min(99, Math.round(Number(c.prioridad ?? 1)))),
    activa: Boolean(c.activa),
    desde: /^\d{4}-\d{2}-\d{2}$/.test(c.desde ?? '') ? c.desde : hoyEnMadrid(),
    hasta: c.hasta && /^\d{4}-\d{2}-\d{2}$/.test(c.hasta) ? c.hasta : null,
    dias_tras_entrega: Math.max(0, Math.min(25, Math.round(Number(c.dias_tras_entrega ?? 5)))),
    hora: Math.max(0, Math.min(23, Math.round(Number(c.hora ?? 20)))),
    excluir_fbm: c.excluir_fbm ?? true,
    excluir_promo: Boolean(c.excluir_promo),
    mercados: Array.isArray(c.mercados) && c.mercados.length ? c.mercados.filter((m) => typeof m === 'string').slice(0, 30) : null,
    productos_modo: c.productos_modo === 'solo' || c.productos_modo === 'excepto' ? c.productos_modo : 'todos',
    skus: Array.isArray(c.skus) ? c.skus.filter((x) => typeof x === 'string').slice(0, 2000) : [],
    updated_at: new Date().toISOString(),
  }
  if (c.id) {
    const { error } = await s.from('resenas_campanas').update(fila).eq('id', c.id).eq('connection_id', cuenta)
    if (error) throw error
    return c.id
  }
  const { data, error } = await s.from('resenas_campanas').insert({ ...fila, created_by: userId }).select('id').single()
  if (error) throw error
  return (data as { id: string }).id
}

export async function borrarCampana(cuenta: string, id: string): Promise<void> {
  const s = createServiceClient()
  // Lo que estaba en cola de esa campaña se descarta (lo enviado se queda como está)
  await s.from('resenas_envios').update({ estado: 'descartada', detalle: 'Campaña borrada' }).eq('connection_id', cuenta).eq('campana_id', id).eq('estado', 'en_cola')
  const { error } = await s.from('resenas_campanas').delete().eq('id', id).eq('connection_id', cuenta)
  if (error) throw error
}

/** Saca un pedido de la cola (o lo vuelve a meter) */
export async function cambiarEnvio(cuenta: string, pedido: string, accion: 'descartar' | 'recuperar'): Promise<void> {
  const s = createServiceClient()
  const q = s.from('resenas_envios').update(accion === 'descartar' ? { estado: 'descartada', detalle: 'Descartada a mano' } : { estado: 'en_cola', detalle: null, intentos: 0 }).eq('connection_id', cuenta).eq('pedido', pedido)
  const { error } = await (accion === 'descartar' ? q.eq('estado', 'en_cola') : q.in('estado', ['descartada', 'error']))
  if (error) throw error
}
