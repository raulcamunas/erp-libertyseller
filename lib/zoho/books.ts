/**
 * HABLAR CON ZOHO BOOKS.
 *
 * Las claves viven solo en el servidor (ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET,
 * ZOHO_REFRESH_TOKEN, ZOHO_ORGANIZATION_ID) y la cuenta está en el centro de
 * datos de EE. UU.: de ahí `.com` en las dos direcciones.
 *
 *
 * ============ EL TOKEN SE GUARDA EN globalThis ============
 *
 * Zoho limita cuántos tokens se pueden pedir con la misma clave en pocos
 * minutos, y Next compila cada ruta por separado: una variable de módulo normal
 * serían varias copias y varios tokens. Dura una hora; se renueva un minuto antes.
 */

const API = 'https://www.zohoapis.com/books/v3'
const CUENTAS = 'https://accounts.zoho.com/oauth/v2/token'
const ESPERA_MS = 30_000

export class ErrorZoho extends Error {
  constructor(
    mensaje: string,
    public estado: number,
    public codigo?: number
  ) {
    super(mensaje)
    this.name = 'ErrorZoho'
  }
}

export function zohoConfigurado(): boolean {
  return Boolean(
    process.env.ZOHO_CLIENT_ID &&
      process.env.ZOHO_CLIENT_SECRET &&
      process.env.ZOHO_REFRESH_TOKEN &&
      process.env.ZOHO_ORGANIZATION_ID
  )
}

type CacheToken = { valor: string; caduca: number; enCurso: Promise<string> | null }
const almacen = globalThis as unknown as { __zohoToken?: CacheToken }
const cache: CacheToken = (almacen.__zohoToken ??= { valor: '', caduca: 0, enCurso: null })

async function pedirToken(): Promise<string> {
  const res = await fetch(CUENTAS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: process.env.ZOHO_REFRESH_TOKEN ?? '',
      client_id: process.env.ZOHO_CLIENT_ID ?? '',
      client_secret: process.env.ZOHO_CLIENT_SECRET ?? '',
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(ESPERA_MS),
    cache: 'no-store',
  })
  const datos = (await res.json().catch(() => null)) as {
    access_token?: string
    expires_in?: number
    error?: string
  } | null
  if (!datos?.access_token) {
    throw new ErrorZoho(`Zoho no ha dado acceso (${datos?.error ?? res.status}). Revisa las claves del servidor.`, 502)
  }
  cache.valor = datos.access_token
  cache.caduca = Date.now() + ((datos.expires_in ?? 3600) - 60) * 1000
  return cache.valor
}

async function token(forzar = false): Promise<string> {
  if (!forzar && cache.valor && Date.now() < cache.caduca) return cache.valor
  // Dos peticiones a la vez comparten la misma renovación
  cache.enCurso ??= pedirToken().finally(() => {
    cache.enCurso = null
  })
  return cache.enCurso
}

type Valor = string | number | boolean | null | undefined

function direccion(ruta: string, query?: Record<string, Valor>): string {
  const url = new URL(`${API}/${ruta}`)
  url.searchParams.set('organization_id', process.env.ZOHO_ORGANIZATION_ID ?? '')
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
  }
  return url.toString()
}

function mensajeDe(estado: number, codigo: number | undefined, mensaje: string | undefined): string {
  if (estado === 429) return 'Zoho ha limitado las peticiones por ahora. Espera un minuto e inténtalo otra vez.'
  if (codigo === 57) return 'A la clave de Zoho le falta permiso para esto. Hay que volver a generarla con ese permiso.'
  return mensaje || `Zoho ha respondido con un error (${estado}).`
}

async function llamar(url: string, init: RequestInit): Promise<Response> {
  const hacer = async (t: string) =>
    fetch(url, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Zoho-oauthtoken ${t}` },
      signal: AbortSignal.timeout(ESPERA_MS),
      cache: 'no-store',
    })
  const res = await hacer(await token())
  return res.status === 401 ? hacer(await token(true)) : res
}

/** Una llamada a Zoho. Devuelve el JSON entero; cualquier `code` distinto de 0 es un error */
export async function zoho<T = Record<string, unknown>>(
  ruta: string,
  opciones: { metodo?: 'GET' | 'POST' | 'PUT' | 'DELETE'; query?: Record<string, Valor>; cuerpo?: unknown } = {}
): Promise<T> {
  if (!zohoConfigurado()) throw new ErrorZoho('Faltan las claves de Zoho en el servidor.', 503)
  const res = await llamar(direccion(ruta, opciones.query), {
    method: opciones.metodo ?? 'GET',
    ...(opciones.cuerpo !== undefined
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opciones.cuerpo) }
      : {}),
  })
  const datos = (await res.json().catch(() => null)) as ({ code?: number; message?: string } & T) | null
  if (!res.ok || !datos || (datos.code !== undefined && datos.code !== 0)) {
    throw new ErrorZoho(mensajeDe(res.status, datos?.code, datos?.message), res.ok ? 502 : res.status, datos?.code)
  }
  return datos
}

/** Todas las páginas de un listado. El tope evita un bucle si Zoho dijera siempre que hay más */
export async function zohoTodo<T>(ruta: string, clave: string, query: Record<string, Valor> = {}): Promise<T[]> {
  const filas: T[] = []
  for (let pagina = 1; pagina <= 10; pagina++) {
    const r = await zoho<Record<string, unknown>>(ruta, { query: { ...query, per_page: 200, page: pagina } })
    filas.push(...((r[clave] as T[] | undefined) ?? []))
    if (!(r.page_context as { has_more_page?: boolean } | undefined)?.has_more_page) break
  }
  return filas
}

/** El PDF de una factura, tal como lo genera Zoho con su plantilla */
export async function zohoPdfDeFactura(id: string): Promise<ArrayBuffer> {
  if (!zohoConfigurado()) throw new ErrorZoho('Faltan las claves de Zoho en el servidor.', 503)
  const res = await llamar(direccion(`invoices/${encodeURIComponent(id)}`, { accept: 'pdf' }), { method: 'GET' })
  if (!res.ok) throw new ErrorZoho(mensajeDe(res.status, undefined, undefined), res.status)
  return res.arrayBuffer()
}

/**
 * EL TIPO DE CAMBIO DE UN DÍA.
 *
 * Si no se manda, en un cobro Zoho pone 1 y el asiento en dírhams sale cuatro
 * veces más pequeño, sin dar ningún error. Por eso, si no hay tipo, se falla.
 */
export async function tipoDeCambio(monedaId: string, fecha: string): Promise<number> {
  const r = await zoho<{ exchange_rates?: { rate?: number; effective_date?: string }[] }>(
    `settings/currencies/${encodeURIComponent(monedaId)}/exchangerates`,
    { query: { from_date: fecha } }
  )
  const tipo = r.exchange_rates?.[0]?.rate
  if (!tipo || tipo <= 0) throw new ErrorZoho(`Zoho no tiene tipo de cambio para el ${fecha}.`, 422)
  return tipo
}

/** Respuesta de error uniforme para las rutas */
export function errorComoRespuesta(error: unknown): { mensaje: string; estado: number } {
  if (error instanceof ErrorZoho) return { mensaje: error.message, estado: error.estado >= 400 ? error.estado : 502 }
  if (error instanceof Error && error.name === 'TimeoutError') {
    return { mensaje: 'Zoho está tardando demasiado. Inténtalo otra vez.', estado: 504 }
  }
  return { mensaje: error instanceof Error ? error.message : 'Error desconocido', estado: 500 }
}
