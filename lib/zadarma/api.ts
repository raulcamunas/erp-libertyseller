import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

/**
 * LA API DE ZADARMA. SOLO SERVIDOR: la clave y el secreto no salen nunca de aquí.
 *
 * Firma (comprobada contra la API real el 19 nov 2026): los parámetros ordenados por nombre, como `http_build_query` de PHP (los espacios como «+»), y
 *   Authorization: KEY:base64( hex( HMAC-SHA1( método + parámetros + md5(parámetros), SECRETO ) ) )
 * donde «método» es la ruta, p. ej. «/v1/webrtc/get_key/». Límite: 100 peticiones por minuto (3 las estadísticas).
 */

const BASE = 'https://api.zadarma.com'

export class ErrorDeZadarma extends Error {
  constructor(
    mensaje: string,
    readonly estado: number | null = null
  ) {
    super(mensaje)
  }
}

const claves = () => {
  const key = process.env.ZADARMA_KEY?.trim()
  const secret = process.env.ZADARMA_SECRET?.trim()
  if (!key || !secret) throw new ErrorDeZadarma('Faltan ZADARMA_KEY y ZADARMA_SECRET en el servidor.')
  return { key, secret }
}

export const hayZadarma = (): boolean => Boolean(process.env.ZADARMA_KEY?.trim() && process.env.ZADARMA_SECRET?.trim())

/** Los parámetros como los firma Zadarma (PHP http_build_query, RFC1738) */
export function parametros(p: Record<string, string>): string {
  return Object.keys(p)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(p[k]).replace(/%20/g, '+')}`)
    .join('&')
}

export function firmaDePeticion(metodo: string, consulta: string, secreto: string): string {
  const md5 = createHash('md5').update(consulta).digest('hex')
  return Buffer.from(createHmac('sha1', secreto).update(metodo + consulta + md5).digest('hex')).toString('base64')
}

export async function pedirZadarma<T = Record<string, unknown>>(metodo: string, p: Record<string, string> = {}, verbo: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET'): Promise<T> {
  const { key, secret } = claves()
  const consulta = parametros(p)
  const firma = firmaDePeticion(metodo, consulta, secret)
  const conCuerpo = verbo === 'POST' || verbo === 'PUT'
  const url = `${BASE}${metodo}${!conCuerpo && consulta ? `?${consulta}` : ''}`
  let r: Response
  try {
    r = await fetch(url, {
      method: verbo,
      headers: { Authorization: `${key}:${firma}`, ...(conCuerpo ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
      body: conCuerpo ? consulta : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    })
  } catch {
    throw new ErrorDeZadarma('No se ha podido conectar con Zadarma.')
  }
  const j = (await r.json().catch(() => null)) as (T & { status?: string; message?: string }) | null
  if (!r.ok || !j || j.status !== 'success') throw new ErrorDeZadarma(`Zadarma: ${j?.message ?? `respuesta ${r.status}`}`, r.status)
  return j
}

/**
 * La firma de un AVISO de la centralita (webhook): HMAC-SHA1 con el secreto de la API sobre unos campos concatenados que dependen del evento. Las fuentes oficiales
 * no se ponen de acuerdo en si es base64 de los bytes o del hexadecimal (la librería PHP hace lo segundo; la de TypeScript, lo primero): se aceptan las dos.
 */
export function firmaDeAvisoValida(evento: string, campos: Record<string, string>, firma: string | null): boolean {
  if (!firma) return false
  const c = (k: string) => campos[k] ?? ''
  const base =
    evento === 'NOTIFY_OUT_START' || evento === 'NOTIFY_OUT_END'
      ? c('internal') + c('destination') + c('call_start')
      : evento === 'NOTIFY_RECORD'
        ? c('pbx_call_id') + c('call_id_with_rec')
        : evento === 'NOTIFY_ANSWER'
          ? c('caller_id') + c('destination') + c('call_start')
          : c('caller_id') + c('called_did') + c('call_start')
  const { secret } = claves()
  const hmac = createHmac('sha1', secret).update(base)
  const bytes = hmac.digest()
  const candidatas = [bytes.toString('base64'), Buffer.from(bytes.toString('hex')).toString('base64')]
  return candidatas.some((x) => x.length === firma.length && timingSafeEqual(Buffer.from(x), Buffer.from(firma)))
}
