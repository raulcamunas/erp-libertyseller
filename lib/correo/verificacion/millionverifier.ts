/**
 * MILLIONVERIFIER: LA LLAMADA AL SERVICIO QUE DICE SI UNA DIRECCIÓN EXISTE — SOLO SERVIDOR (la clave nunca sale de aquí).
 * =======================================================================================================================
 * Se comprueba con millionverifier.prueba.ts, con las respuestas REALES del servicio (las capturó la documentación y las claves de demostración públicas de la
 * propia empresa) y con un `fetch` de mentira.
 *
 * El servicio (https://developer.millionverifier.com):
 *   · Una dirección:   GET https://api.millionverifier.com/api/v3/?api=CLAVE&email=DIRECCIÓN&timeout=SEGUNDOS      (160 llamadas por segundo; 2 a 60 s de espera; 20 por defecto)
 *   · Los créditos:    GET https://api.millionverifier.com/api/v3/credits?api=CLAVE   →  { credits, bulk_credits, renewing_credits, plan }
 *   · SIEMPRE contesta HTTP 200, también cuando algo va mal: un fallo viene con `resultcode: 4` y el texto en `error` («Apikey not found», «Insufficient credits»,
 *     «IP address blocked», «Internal error»…). Una clave que no existe en la consulta de créditos contesta `{ result: 'error', error: 'apikey_not_found' }`.
 *   · Cobra un crédito por cada dirección buena o mala; las «arriesgadas» (catch_all, unknown) no las cobra. Repetir la misma dirección se cobra OTRA VEZ: por eso lo
 *     comprobado se guarda (pago-servidor.ts) y cada dirección se pregunta una sola vez.
 *
 *   quality  result       resultcode  subresult            qué es
 *   good     ok           1           ok                   existe y recibe correo
 *   risky    catch_all    2           ok                   el servidor acepta CUALQUIER dirección: no se puede confirmar
 *   risky    unknown      3           unknown              el servidor no ha dejado comprobarlo
 *   (error)  (error)      4           —                    algo ha fallado; `error` dice qué
 *   bad      disposable   5           disposable           desechable, de usar y tirar
 *   bad      invalid      6           no_mailbox / bad_domain…   no existe el buzón o el dominio
 *   —        unverified   0           unverified           no se ha podido verificar
 *
 * LA REGLA PARA BLOQUEAR ES ESTRICTA A PROPÓSITO. Un correo que no sale por un falso «inválida» es un lead que no se escribe; uno que sale a una dirección mala
 * es un rebote que el ERP ya sabe absorber. Así que solo es «mala» cuando TODAS las señales del servicio lo dicen (result invalid o disposable, resultcode 6 o 5 y
 * quality bad); cualquier contradicción (la clave de pruebas aleatoria del servicio las mezcla, y un ejemplo de su documentación también) es «dudosa» y no bloquea.
 */

export const URL_DE_LA_VERIFICACION = 'https://api.millionverifier.com/api/v3/'
export const URL_DE_LOS_CREDITOS = 'https://api.millionverifier.com/api/v3/credits'

export type NivelDePago = 'buena' | 'dudosa' | 'mala'

export type CausaDeError = 'clave' | 'sin_creditos' | 'ip' | 'interno' | 'otro'

export type RespuestaDelServicio =
  | {
      tipo: 'veredicto'
      nivel: NivelDePago
      /** ok · catch_all · unknown · disposable · invalid (tal como lo dijo el servicio) */
      resultado: string
      calidad: string | null
      /** El `subresult`: ok · no_mailbox · bad_domain · mailbox_disabled · disposable… */
      detalle: string | null
      /** Lo que el servicio propone si hay una errata («bademail@gmail.com» para «bademail@gmal.com») */
      sugerencia: string | null
      /** Los créditos que le quedan a la cuenta DESPUÉS de esta comprobación */
      creditos: number | null
    }
  | { tipo: 'error'; causa: CausaDeError; mensaje: string; creditos: number | null }
  /** El servicio no ha podido verificarla (`unverified`): ni buena ni mala */
  | { tipo: 'sin_veredicto'; creditos: number | null }

export type FalloDeRed = { tipo: 'red'; mensaje: string }

const entero = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : null)
const cadena = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** Qué falla, según el texto que manda el servicio en `error` */
export function causaDelError(texto: string): CausaDeError {
  const t = texto.toLowerCase()
  if (/apikey|api key|api_key|apikey_not_found/.test(t)) return 'clave'
  if (/insufficient|credit/.test(t)) return 'sin_creditos'
  if (/ip address|blocked/.test(t)) return 'ip'
  if (/internal/.test(t)) return 'interno'
  return 'otro'
}

/** La frase para una persona, por causa. Nunca lleva el texto crudo del servicio ni la clave */
export const MENSAJE_DE_ERROR: Record<CausaDeError, string> = {
  clave: 'MillionVerifier no reconoce la clave de la API. Cópiala otra vez de app.millionverifier.com/api.',
  sin_creditos: 'Se han acabado los créditos de MillionVerifier. Compra más en app.millionverifier.com.',
  ip: 'MillionVerifier está bloqueando la dirección IP del servidor del ERP. Quita la restricción de IP de la clave, o añade esa IP, en app.millionverifier.com/api.',
  interno: 'MillionVerifier ha tenido un fallo interno. Se reintentará más tarde.',
  otro: 'MillionVerifier ha devuelto un error que no se esperaba.',
}

/**
 * Lo que dice el servicio de UNA dirección, ya interpretado. NUNCA lanza: lo que no se entiende es un error `otro` (el envío sigue, sin comprobar).
 */
export function interpretarRespuesta(json: unknown): RespuestaDelServicio {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return { tipo: 'error', causa: 'otro', mensaje: MENSAJE_DE_ERROR.otro, creditos: null }
  const j = json as Record<string, unknown>
  const creditos = entero(j.credits)
  const codigo = entero(j.resultcode)
  const resultado = cadena(j.result).toLowerCase()
  const calidad = cadena(j.quality).toLowerCase() || null
  const texto = cadena(j.error)

  // Un fallo: viene con resultcode 4 y/o un texto en `error`. Un resultcode 4 sin texto es igualmente un fallo
  if (texto !== '' || codigo === 4 || resultado === 'error') {
    const causa = texto === '' ? 'otro' : causaDelError(texto)
    return { tipo: 'error', causa, mensaje: MENSAJE_DE_ERROR[causa], creditos }
  }
  if (resultado === 'unverified' || (codigo === 0 && resultado === '')) return { tipo: 'sin_veredicto', creditos }
  if (resultado === '') return { tipo: 'error', causa: 'otro', mensaje: MENSAJE_DE_ERROR.otro, creditos }

  const dice = (r: string, c: number) => resultado === r && (codigo === null || codigo === c)
  const todasDicenMala = (dice('invalid', 6) || dice('disposable', 5)) && (calidad === null || calidad === 'bad')
  const todasDicenBuena = dice('ok', 1) && (calidad === null || calidad === 'good')
  const sugerencia = cadena(j.didyoumean)
  return {
    tipo: 'veredicto',
    nivel: todasDicenMala ? 'mala' : todasDicenBuena ? 'buena' : 'dudosa',
    resultado,
    calidad,
    detalle: cadena(j.subresult).toLowerCase() || null,
    sugerencia: sugerencia !== '' && sugerencia.toLowerCase() !== cadena(j.email).toLowerCase() ? sugerencia.toLowerCase() : null,
    creditos,
  }
}

/** La frase para quien envía: por qué esa dirección es buena, dudosa o mala */
export function motivoDelVeredicto(v: { nivel: NivelDePago; resultado: string; detalle: string | null }): string {
  if (v.nivel === 'buena') return 'La dirección existe y recibe correo.'
  if (v.resultado === 'disposable') return 'Es una dirección desechable (de usar y tirar): nadie la lee.'
  if (v.nivel === 'mala') {
    if (v.detalle === 'bad_domain') return 'El dominio no existe o no recibe correo.'
    if (v.detalle === 'no_mailbox') return 'El buzón no existe.'
    if (v.detalle === 'mailbox_disabled') return 'El buzón está desactivado.'
    return 'La dirección no existe.'
  }
  if (v.resultado === 'catch_all') return 'El servidor de esa empresa acepta cualquier dirección, así que no se puede confirmar que el buzón exista.'
  if (v.resultado === 'unknown') return 'El servidor de esa dirección no ha dejado comprobar si el buzón existe.'
  return 'No se ha podido confirmar que la dirección exista.'
}

export interface OpcionesDeLlamada {
  fetch?: typeof fetch
  /** Lo que el servicio espera al servidor de la dirección (2 a 60 s). Por defecto 10 */
  esperaDelServicioS?: number
  /** Lo que se espera a que el servicio conteste antes de rendirse, en ms. Tiene que ser mayor que la espera del servicio. Por defecto 15 s */
  esperaMaximaMs?: number
}

async function pedirJson(url: string, o: OpcionesDeLlamada): Promise<{ ok: true; json: unknown } | FalloDeRed> {
  const f = o.fetch ?? fetch
  const control = new AbortController()
  const reloj = setTimeout(() => control.abort(), o.esperaMaximaMs ?? 15_000)
  try {
    const r = await f(url, { method: 'GET', signal: control.signal, cache: 'no-store', headers: { Accept: 'application/json' } })
    if (!r.ok) return { tipo: 'red', mensaje: `MillionVerifier ha contestado con el código ${r.status}.` }
    try {
      return { ok: true, json: await r.json() }
    } catch {
      return { tipo: 'red', mensaje: 'MillionVerifier ha contestado algo que no se entiende.' }
    }
  } catch (e) {
    // Sin el texto del error: puede llevar la dirección completa de la consulta, y esa lleva la clave
    return { tipo: 'red', mensaje: (e as { name?: string } | null)?.name === 'AbortError' ? 'MillionVerifier ha tardado demasiado en contestar.' : 'No se ha podido hablar con MillionVerifier.' }
  } finally {
    clearTimeout(reloj)
  }
}

/** Pregunta al servicio por UNA dirección. Gasta un crédito si la da por buena o por mala */
export async function verificarEnElServicio(clave: string, direccion: string, o: OpcionesDeLlamada = {}): Promise<RespuestaDelServicio | FalloDeRed> {
  const espera = Math.min(60, Math.max(2, Math.round(o.esperaDelServicioS ?? 10)))
  const url = `${URL_DE_LA_VERIFICACION}?${new URLSearchParams({ api: clave, email: direccion, timeout: String(espera) }).toString()}`
  const r = await pedirJson(url, { ...o, esperaMaximaMs: o.esperaMaximaMs ?? (espera + 5) * 1000 })
  return 'ok' in r ? interpretarRespuesta(r.json) : r
}

export type RespuestaDeCreditos = { tipo: 'creditos'; creditos: number; plan: number | null } | { tipo: 'error'; causa: CausaDeError; mensaje: string } | FalloDeRed

/** Cuántos créditos tiene la cuenta (no gasta ninguno). Sirve también para saber si una clave vale */
export async function consultarCreditos(clave: string, o: OpcionesDeLlamada = {}): Promise<RespuestaDeCreditos> {
  const r = await pedirJson(`${URL_DE_LOS_CREDITOS}?${new URLSearchParams({ api: clave }).toString()}`, { ...o, esperaMaximaMs: o.esperaMaximaMs ?? 10_000 })
  if (!('ok' in r)) return r
  const j = r.json
  if (typeof j !== 'object' || j === null || Array.isArray(j)) return { tipo: 'error', causa: 'otro', mensaje: MENSAJE_DE_ERROR.otro }
  const c = j as Record<string, unknown>
  const texto = cadena(c.error)
  if (texto !== '' || cadena(c.result).toLowerCase() === 'error') {
    const causa = texto === '' ? 'otro' : causaDelError(texto)
    return { tipo: 'error', causa, mensaje: MENSAJE_DE_ERROR[causa] }
  }
  const creditos = entero(c.credits)
  if (creditos === null) return { tipo: 'error', causa: 'otro', mensaje: MENSAJE_DE_ERROR.otro }
  return { tipo: 'creditos', creditos, plan: entero(c.plan) }
}
