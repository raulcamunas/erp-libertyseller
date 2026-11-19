import { createHmac, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto'
import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { CERO, diasEntre, esAsin, esDia, sumarDias, type DatoDeAsin, type FilaAgregada } from './calculo'

/**
 * TRÁFICO Y CONVERSIÓN PARA EL CLIENTE — SERVIDOR (migración 322). SOLO SERVIDOR.
 *
 * La página pública se abre con un ENLACE SECRETO Y UNA CLAVE. El enlace solo no enseña nada: hay que poner la clave, y entonces se deja una cookie firmada que
 * dura 30 días. La firma lleva el hash de la clave: cambiar la clave en el ERP cierra todas las sesiones abiertas. Tras 10 claves mal seguidas, 15 minutos sin poder entrar.
 *
 * Lo que ve el cliente: sesiones, visitas, Buy Box, unidades, pedidos y ventas de su tienda por ASIN y día (informe de Ventas y tráfico de Seller Central). Nada de
 * publicidad ni de márgenes.
 */

export interface Enlace {
  id: string
  token: string
  clave_hash: string
  client_id: string
  marketplace_id: string
  titulo: string
  desde: string
  activo: boolean
  creado_en: string
  accesos: number
  ultimo_acceso: string | null
  fallos: number
  bloqueado_hasta: string | null
}

const COLUMNAS = 'id, token, clave_hash, client_id, marketplace_id, titulo, desde, activo, creado_en, accesos, ultimo_acceso, fallos, bloqueado_hasta'
const MAX_FALLOS = 10
const BLOQUEO_MS = 15 * 60_000
export const DURACION_SESION_S = 30 * 86_400
export const nombreDeCookie = (enlaceId: string) => `trafico_${enlaceId.replace(/-/g, '').slice(0, 12)}`

/* ------------------------------------------------------------------ */
/* Claves                                                              */
/* ------------------------------------------------------------------ */

/** Una clave fácil de dictar: 12 letras y números sin los que se confunden (0/O, 1/l/I), en tres grupos */
export function claveNueva(): string {
  const letras = 'abcdefghjkmnpqrstuvwxyz23456789'
  const g = () => Array.from({ length: 4 }, () => letras[randomInt(letras.length)]).join('')
  return `${g()}-${g()}-${g()}`
}

export function hashDeClave(clave: string): string {
  const sal = randomBytes(16)
  return `${sal.toString('hex')}:${scryptSync(clave.trim().toLowerCase(), sal, 32).toString('hex')}`
}

export function claveCorrecta(clave: string, hash: string): boolean {
  const [salHex, hashHex] = hash.split(':')
  if (!salHex || !hashHex) return false
  const esperado = Buffer.from(hashHex, 'hex')
  const dado = scryptSync(clave.trim().toLowerCase(), Buffer.from(salHex, 'hex'), esperado.length)
  return dado.length === esperado.length && timingSafeEqual(dado, esperado)
}

const secreto = (): string => {
  const s = process.env.TRAFICO_SECRETO || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (!s) throw new Error('Falta la clave del servidor para firmar las sesiones.')
  return s
}

/** El valor de la cookie de una sesión abierta: depende del enlace y del hash de su clave (cambiar la clave la anula) */
export const firmaDeSesion = (e: Pick<Enlace, 'id' | 'clave_hash'>): string => createHmac('sha256', secreto()).update(`trafico:${e.id}:${e.clave_hash}`).digest('base64url')

export function sesionValida(e: Pick<Enlace, 'id' | 'clave_hash'>, cookie: string | undefined | null): boolean {
  if (!cookie) return false
  const a = Buffer.from(cookie)
  const b = Buffer.from(firmaDeSesion(e))
  return a.length === b.length && timingSafeEqual(a, b)
}

/* ------------------------------------------------------------------ */
/* El enlace                                                           */
/* ------------------------------------------------------------------ */

const TOKEN = /^[A-Za-z0-9_-]{20,80}$/

export async function enlaceDelToken(token: string): Promise<Enlace | null> {
  if (!TOKEN.test(token)) return null
  const { data, error } = await createServiceClient().from('trafico_enlaces').select(COLUMNAS).eq('token', token).maybeSingle()
  if (error) {
    if (isMissingSchema(error)) return null
    throw error
  }
  const e = data as Enlace | null
  return e && e.activo ? e : null
}

/** Probar una clave: devuelve si vale, o por qué no */
export async function entrar(token: string, clave: unknown): Promise<{ ok: true; enlace: Enlace } | { ok: false; motivo: string; status: number }> {
  const e = await enlaceDelToken(token)
  if (!e) return { ok: false, motivo: 'Este enlace no existe o ya no está activo. Pide uno nuevo a Liberty Seller.', status: 404 }
  if (e.bloqueado_hasta && Date.parse(e.bloqueado_hasta) > Date.now()) return { ok: false, motivo: 'Demasiados intentos. Espera unos minutos y vuelve a probar.', status: 429 }
  const service = createServiceClient()
  if (typeof clave !== 'string' || clave.length > 100 || !claveCorrecta(clave, e.clave_hash)) {
    const fallos = e.fallos + 1
    await service.from('trafico_enlaces').update({ fallos: fallos >= MAX_FALLOS ? 0 : fallos, bloqueado_hasta: fallos >= MAX_FALLOS ? new Date(Date.now() + BLOQUEO_MS).toISOString() : e.bloqueado_hasta }).eq('id', e.id)
    return { ok: false, motivo: 'La clave no es correcta.', status: 401 }
  }
  await service.from('trafico_enlaces').update({ fallos: 0, bloqueado_hasta: null, accesos: e.accesos + 1, ultimo_acceso: new Date().toISOString() }).eq('id', e.id)
  return { ok: true, enlace: e }
}

/* ------------------------------------------------------------------ */
/* Los datos                                                           */
/* ------------------------------------------------------------------ */

type FilaRpc = { clave: string; asin: string; sesiones: number; sesiones_navegador: number; sesiones_app: number; visitas: number; visitas_buybox: number; unidades: number; pedidos: number; ventas: number }

async function agregado(e: Pick<Enlace, 'client_id' | 'marketplace_id'>, desde: string, hasta: string, por: 'dia' | 'mes' | 'total'): Promise<FilaAgregada[]> {
  const { data, error } = await createServiceClient().rpc('trafico_agregado', { p_client: e.client_id, p_mkt: e.marketplace_id, p_desde: desde, p_hasta: hasta, p_por: por })
  if (error) throw error
  return ((data ?? []) as FilaRpc[]).map((f) => ({
    clave: f.clave,
    asin: f.asin,
    sesiones: Number(f.sesiones),
    navegador: Number(f.sesiones_navegador),
    app: Number(f.sesiones_app),
    visitas: Number(f.visitas),
    visitasBB: Number(f.visitas_buybox),
    unidades: Number(f.unidades),
    pedidos: Number(f.pedidos),
    ventas: Number(f.ventas),
  }))
}

/** El nombre corto de un producto para usarlo de juego cuando nadie le ha puesto uno: lo de antes del primer « - », «|» o «,» */
export function nombreCorto(titulo: string | null | undefined): string | null {
  if (!titulo) return null
  const corto = titulo.split(/\s[-–|]\s|\s\|\s|,|\|/)[0].replace(/^creative toys\s+/i, '').trim()
  return corto ? (corto.length > 48 ? `${corto.slice(0, 47)}…` : corto) : null
}

/** A qué juego pertenece cada ASIN (lo puesto a mano; si no, el nombre corto del listing; si no, el ASIN) y el nombre del producto */
async function juegosDe(e: Pick<Enlace, 'client_id' | 'marketplace_id'>, asins: readonly string[]): Promise<Record<string, DatoDeAsin>> {
  const service = createServiceClient()
  const { data } = await service.from('trafico_juegos').select('asin, juego, producto').eq('client_id', e.client_id).eq('marketplace_id', e.marketplace_id)
  const salida: Record<string, DatoDeAsin> = {}
  for (const j of (data ?? []) as Array<{ asin: string; juego: string; producto: string | null }>) salida[j.asin] = { juego: j.juego, producto: j.producto }
  const faltan = asins.filter((a) => !salida[a])
  if (faltan.length > 0) {
    const { data: cons } = await service.from('amazon_connections').select('id').eq('client_id', e.client_id)
    const ids = ((cons ?? []) as Array<{ id: string }>).map((c) => c.id)
    if (ids.length > 0) {
      const { data: lis } = await service.from('amazon_listings').select('asin, title').in('connection_id', ids).eq('marketplace_id', e.marketplace_id).in('asin', faltan.slice(0, 500)).limit(2000)
      for (const l of (lis ?? []) as Array<{ asin: string; title: string | null }>) {
        if (!salida[l.asin] && l.title) salida[l.asin] = { juego: nombreCorto(l.title) ?? l.asin, producto: l.title }
      }
    }
  }
  for (const a of asins) if (!salida[a]) salida[a] = { juego: a, producto: null }
  return salida
}

export interface DatosDelPanel {
  titulo: string
  moneda: string
  /** Primer y último día con datos guardados */
  primerDia: string | null
  ultimoDia: string | null
  /** Desde este día las sesiones aún pueden cambiar (Amazon tarda unos tres días en consolidarlas) */
  provisionalDesde: string
  /** Los días que aún faltan por leer de Amazon (el histórico se rellena poco a poco al crear el enlace) */
  diasPorLeer: number
  juegos: Record<string, DatoDeAsin>
  periodo: { desde: string; hasta: string; dias: FilaAgregada[]; total: FilaAgregada[] }
  comparacion: { desde: string; hasta: string; total: FilaAgregada[] } | null
  meses: FilaAgregada[]
}

const hoyEnEspana = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())

export async function datosDelPanel(e: Enlace, q: { desde: unknown; hasta: unknown; compDesde: unknown; compHasta: unknown }): Promise<DatosDelPanel> {
  const service = createServiceClient()
  const ayer = sumarDias(hoyEnEspana(), -1)
  const [primero, ultimo, pendientes, monedaFila] = await Promise.all([
    service.from('trafico_diario').select('fecha').eq('client_id', e.client_id).eq('marketplace_id', e.marketplace_id).order('fecha', { ascending: true }).limit(1).maybeSingle(),
    service.from('trafico_diario').select('fecha').eq('client_id', e.client_id).eq('marketplace_id', e.marketplace_id).order('fecha', { ascending: false }).limit(1).maybeSingle(),
    service.from('trafico_lecturas').select('fecha', { count: 'exact', head: true }).eq('client_id', e.client_id).eq('marketplace_id', e.marketplace_id).gte('fecha', e.desde).not('leido_at', 'is', null),
    service.from('trafico_diario').select('moneda').eq('client_id', e.client_id).eq('marketplace_id', e.marketplace_id).not('moneda', 'is', null).limit(1).maybeSingle(),
  ])
  const primerDia = (primero.data as { fecha?: string } | null)?.fecha ?? null
  const ultimoDia = (ultimo.data as { fecha?: string } | null)?.fecha ?? null
  const diasPorLeer = Math.max(0, diasEntre(e.desde, ayer) - (pendientes.count ?? 0))

  // El periodo pedido (como mucho un año); si no viene, la última semana completa con datos
  let desde = esDia(q.desde) ? q.desde : null
  let hasta = esDia(q.hasta) ? q.hasta : null
  if (!desde || !hasta || desde > hasta) {
    hasta = ultimoDia ?? ayer
    desde = sumarDias(hasta, -6)
  }
  if (diasEntre(desde, hasta) > 370) desde = sumarDias(hasta, -369)
  let comp: { desde: string; hasta: string } | null = esDia(q.compDesde) && esDia(q.compHasta) && q.compDesde <= q.compHasta ? { desde: q.compDesde, hasta: q.compHasta } : null
  if (comp && diasEntre(comp.desde, comp.hasta) > 370) comp = null

  const [dias, total, compTotal, meses] = await Promise.all([
    agregado(e, desde, hasta, 'dia'),
    agregado(e, desde, hasta, 'total'),
    comp ? agregado(e, comp.desde, comp.hasta, 'total') : Promise.resolve([]),
    agregado(e, e.desde, ayer, 'mes'),
  ])
  const asins = [...new Set([...total, ...compTotal, ...meses].map((f) => f.asin))].filter(esAsin)
  return {
    titulo: e.titulo,
    moneda: (monedaFila.data as { moneda?: string } | null)?.moneda ?? 'EUR',
    primerDia,
    ultimoDia,
    provisionalDesde: sumarDias(ayer, -2),
    diasPorLeer,
    juegos: await juegosDe(e, asins),
    periodo: { desde, hasta, dias, total },
    comparacion: comp ? { ...comp, total: compTotal } : null,
    meses,
  }
}

/* ------------------------------------------------------------------ */
/* Administración (desde el ERP, solo administradores)                 */
/* ------------------------------------------------------------------ */

export interface EnlaceParaAdmin {
  id: string
  token: string
  titulo: string
  client_id: string
  cliente: string
  marketplace_id: string
  desde: string
  activo: boolean
  creado_en: string
  accesos: number
  ultimo_acceso: string | null
  lectura: { hechos: number; pedidos: number; errores: number; faltan: number; ultimoError: string | null; ultimoDia: string | null }
  juegos: number
}

export async function listarEnlaces(): Promise<EnlaceParaAdmin[]> {
  const service = createServiceClient()
  const { data, error } = await service.from('trafico_enlaces').select(`${COLUMNAS}, amazon_clients(name)`).order('creado_en', { ascending: false })
  if (error) throw error
  const ayer = sumarDias(hoyEnEspana(), -1)
  const salida: EnlaceParaAdmin[] = []
  for (const e of (data ?? []) as Array<Enlace & { amazon_clients: { name: string } | { name: string }[] | null }>) {
    const cli = Array.isArray(e.amazon_clients) ? e.amazon_clients[0] : e.amazon_clients
    const [lect, ult, err, jue] = await Promise.all([
      service.from('trafico_lecturas').select('estado').eq('client_id', e.client_id).eq('marketplace_id', e.marketplace_id).gte('fecha', e.desde).limit(5000),
      service.from('trafico_diario').select('fecha').eq('client_id', e.client_id).eq('marketplace_id', e.marketplace_id).order('fecha', { ascending: false }).limit(1).maybeSingle(),
      service.from('trafico_lecturas').select('error').eq('client_id', e.client_id).eq('marketplace_id', e.marketplace_id).eq('estado', 'error').order('pedido_at', { ascending: false }).limit(1).maybeSingle(),
      service.from('trafico_juegos').select('asin', { count: 'exact', head: true }).eq('client_id', e.client_id).eq('marketplace_id', e.marketplace_id),
    ])
    const estados = ((lect.data ?? []) as Array<{ estado: string }>).map((x) => x.estado)
    const hechos = estados.filter((x) => x === 'hecho').length
    salida.push({
      id: e.id,
      token: e.token,
      titulo: e.titulo,
      client_id: e.client_id,
      cliente: cli?.name ?? '—',
      marketplace_id: e.marketplace_id,
      desde: e.desde,
      activo: e.activo,
      creado_en: e.creado_en,
      accesos: e.accesos,
      ultimo_acceso: e.ultimo_acceso,
      lectura: { hechos, pedidos: estados.filter((x) => x === 'pedido').length, errores: estados.filter((x) => x === 'error').length, faltan: Math.max(0, diasEntre(e.desde, ayer) - hechos), ultimoError: (err.data as { error?: string } | null)?.error ?? null, ultimoDia: (ult.data as { fecha?: string } | null)?.fecha ?? null },
      juegos: jue.count ?? 0,
    })
  }
  return salida
}

export async function crearEnlace(o: { clientId: unknown; marketplaceId: unknown; titulo: unknown; desde: unknown; userId: string }): Promise<{ id: string; token: string; clave: string }> {
  const UUID = /^[0-9a-f-]{36}$/i
  if (typeof o.clientId !== 'string' || !UUID.test(o.clientId)) throw new Error('Falta el cliente.')
  if (typeof o.marketplaceId !== 'string' || !/^[A-Z0-9]{8,20}$/.test(o.marketplaceId)) throw new Error('Falta el país.')
  const titulo = typeof o.titulo === 'string' && o.titulo.trim() ? o.titulo.trim().slice(0, 120) : 'Tráfico y conversión'
  const desde = esDia(o.desde) ? o.desde : '2025-08-01'
  const clave = claveNueva()
  const token = randomBytes(24).toString('base64url')
  const { data, error } = await createServiceClient().from('trafico_enlaces').insert({ token, clave_hash: hashDeClave(clave), client_id: o.clientId, marketplace_id: o.marketplaceId, titulo, desde, creado_por: o.userId }).select('id').single()
  if (error) throw error
  return { id: (data as { id: string }).id, token, clave }
}

export async function cambiarClave(id: string): Promise<string> {
  const clave = claveNueva()
  const { error } = await createServiceClient().from('trafico_enlaces').update({ clave_hash: hashDeClave(clave), fallos: 0, bloqueado_hasta: null }).eq('id', id)
  if (error) throw error
  return clave
}

export async function activarEnlace(id: string, activo: boolean): Promise<void> {
  const { error } = await createServiceClient().from('trafico_enlaces').update({ activo }).eq('id', id)
  if (error) throw error
}

/** Los juegos de un enlace, para editarlos: todos los ASIN con datos y lo que tienen puesto */
export async function juegosParaEditar(id: string): Promise<Array<{ asin: string; juego: string; producto: string | null; aMano: boolean; sesiones: number }>> {
  const service = createServiceClient()
  const { data: e } = await service.from('trafico_enlaces').select(COLUMNAS).eq('id', id).maybeSingle()
  const enlace = e as Enlace | null
  if (!enlace) throw new Error('No existe ese enlace.')
  const ayer = sumarDias(hoyEnEspana(), -1)
  const total = await agregado(enlace, enlace.desde, ayer, 'total')
  const { data: aMano } = await service.from('trafico_juegos').select('asin').eq('client_id', enlace.client_id).eq('marketplace_id', enlace.marketplace_id)
  const puestos = new Set(((aMano ?? []) as Array<{ asin: string }>).map((x) => x.asin))
  const asins = [...new Set([...total.map((f) => f.asin), ...puestos])]
  const juegos = await juegosDe(enlace, asins)
  const sesiones = new Map(total.map((f) => [f.asin, f.sesiones]))
  return asins.map((asin) => ({ asin, juego: juegos[asin].juego, producto: juegos[asin].producto, aMano: puestos.has(asin), sesiones: sesiones.get(asin) ?? 0 })).sort((a, b) => a.juego.localeCompare(b.juego, 'es') || b.sesiones - a.sesiones)
}

export async function guardarJuegos(id: string, filas: unknown): Promise<number> {
  if (!Array.isArray(filas)) throw new Error('No es una lista.')
  const service = createServiceClient()
  const { data: e } = await service.from('trafico_enlaces').select('client_id, marketplace_id').eq('id', id).maybeSingle()
  const enlace = e as { client_id: string; marketplace_id: string } | null
  if (!enlace) throw new Error('No existe ese enlace.')
  const limpias = filas
    .map((f) => f as { asin?: unknown; juego?: unknown; producto?: unknown })
    .filter((f) => esAsin(f.asin) && typeof f.juego === 'string' && f.juego.trim())
    .slice(0, 3000)
    .map((f) => ({ client_id: enlace.client_id, marketplace_id: enlace.marketplace_id, asin: f.asin as string, juego: (f.juego as string).trim().slice(0, 120), producto: typeof f.producto === 'string' ? f.producto.slice(0, 300) : null }))
  if (limpias.length === 0) return 0
  const { error } = await service.from('trafico_juegos').upsert(limpias, { onConflict: 'client_id,marketplace_id,asin' })
  if (error) throw error
  return limpias.length
}

