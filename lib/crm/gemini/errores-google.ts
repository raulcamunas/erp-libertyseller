/**
 * QUÉ HA FALLADO AL HABLAR CON GOOGLE, EN UNA FRASE QUE DIGA QUÉ HAY QUE HACER.
 * =============================================================================
 * Leer el correo y los documentos con la cuenta de servicio puede fallar de seis maneras muy distintas, y casi todas se arreglan en una pantalla de Google, no en el código:
 *
 *   permisos      la cuenta de servicio no tiene autorizados los permisos de Gmail y Docs en la delegación de todo el dominio (Workspace Admin) -> el token ni se concede
 *   api_apagada   la API (Gmail, Drive o Docs) no está activada en el proyecto de Google Cloud
 *   sin_acceso    el usuario suplantado no puede abrir ese documento concreto
 *   no_existe     el correo o el documento ya no está (borrado)
 *   limite        Google pide esperar (cuota)
 *   red           no contestó a tiempo o no hubo conexión
 *
 * Por eso cada fallo lleva un `tipo`: la sincronización decide qué hacer con él (parar toda la pasada si es de permisos; seguir con las demás notas si es de un documento) y la
 * pantalla enseña la frase tal cual a quien administra, sin que tenga que ir a los registros del servidor.
 *
 * Es puro. Del cuerpo de la respuesta solo se usa el estado, la razón y, en un fallo de API apagada, el mensaje (que trae el enlace para activarla): nunca contenido de correos.
 */

export type ApiDeGoogle = 'gmail' | 'docs' | 'drive' | 'token'

export type TipoDeFalloDeGoogle = 'sin_configurar' | 'permisos' | 'api_apagada' | 'sin_acceso' | 'no_existe' | 'limite' | 'red' | 'otro'

export class ErrorDeGoogle extends Error {
  constructor(
    mensaje: string,
    readonly tipo: TipoDeFalloDeGoogle,
    readonly api: ApiDeGoogle,
    readonly estado: number | null = null
  ) {
    super(mensaje)
    this.name = 'ErrorDeGoogle'
  }

  /** ¿Es un fallo que afecta a TODA la sincronización (y no solo a esta nota)? Seguir intentando con las demás sería tirar el tiempo */
  get esGeneral(): boolean {
    return this.tipo === 'sin_configurar' || this.tipo === 'permisos' || this.tipo === 'api_apagada'
  }
}

export const NOMBRE_DE_LA_API: Record<ApiDeGoogle, string> = { gmail: 'Gmail', docs: 'Google Docs', drive: 'Google Drive', token: 'la cuenta de Google' }

export const FRASE_DE_PERMISOS =
  'Google no deja a la cuenta de servicio leer el correo y los documentos. Hay que autorizar en la consola de administración de Google Workspace (Seguridad → Control de acceso y de datos → Controles de API → Delegación en todo el dominio) los permisos https://www.googleapis.com/auth/gmail.readonly y https://www.googleapis.com/auth/documents.readonly para el ID de cliente de la cuenta de servicio, AÑADIÉNDOLOS a los que ya tiene (el de Calendar tiene que seguir en la lista).'

interface CuerpoDeError {
  error?: string | { code?: number; message?: string; status?: string; errors?: Array<{ reason?: string; message?: string }> }
  error_description?: string
}

const recortar = (s: string, tope: number) => (s.length > tope ? `${s.slice(0, tope - 1)}…` : s)

/** La respuesta de error de una API de Google (Gmail, Docs, Drive) -> un fallo con tipo y frase */
export function clasificarRespuestaDeGoogle(api: Exclude<ApiDeGoogle, 'token'>, estado: number, cuerpo: unknown): ErrorDeGoogle {
  const c = (cuerpo && typeof cuerpo === 'object' ? cuerpo : {}) as CuerpoDeError
  const e = typeof c.error === 'object' && c.error ? c.error : {}
  const razones = (e.errors ?? []).map((x) => x.reason ?? '').filter(Boolean)
  const mensaje = e.message ?? ''
  const nombre = NOMBRE_DE_LA_API[api]

  if (estado === 403 && (razones.some((r) => /accessNotConfigured|SERVICE_DISABLED/i.test(r)) || /has not been used in project|is disabled|API has not been enabled/i.test(mensaje))) {
    return new ErrorDeGoogle(`La API de ${nombre} está apagada en el proyecto de Google Cloud: hay que activarla en «APIs y servicios → Biblioteca». ${recortar(mensaje, 300)}`.trim(), 'api_apagada', api, estado)
  }
  if (estado === 429 || (estado === 403 && razones.some((r) => /rateLimitExceeded|userRateLimitExceeded|quotaExceeded/i.test(r)))) {
    return new ErrorDeGoogle(`${nombre} pide esperar un poco (límite de peticiones). Se vuelve a intentar en la siguiente pasada.`, 'limite', api, estado)
  }
  if (estado === 401) return new ErrorDeGoogle(FRASE_DE_PERMISOS, 'permisos', api, estado)
  if (estado === 403) return new ErrorDeGoogle(`${nombre} no deja abrir esto con esta cuenta (sin permiso sobre ese elemento).`, 'sin_acceso', api, estado)
  if (estado === 404) return new ErrorDeGoogle(`${nombre}: ya no existe (se borró o no es visible para esta cuenta).`, 'no_existe', api, estado)
  if (estado >= 500) return new ErrorDeGoogle(`${nombre} tiene un problema ahora mismo (HTTP ${estado}).`, 'red', api, estado)
  return new ErrorDeGoogle(`${nombre} ha contestado HTTP ${estado}.`, 'otro', api, estado)
}

/** El error al pedir el TOKEN (la delegación en todo el dominio) -> un fallo con tipo y frase. Llega de google-auth-library con la respuesta dentro */
export function clasificarFalloDeToken(error: unknown): ErrorDeGoogle {
  const e = error as { code?: string | number; message?: string; response?: { status?: number; data?: CuerpoDeError } }
  const dato = typeof e?.response?.data?.error === 'string' ? e.response.data.error : ''
  const texto = `${dato} ${e?.response?.data?.error_description ?? ''} ${e?.message ?? ''}`
  if (/unauthorized_client|invalid_scope|access_denied/i.test(texto)) return new ErrorDeGoogle(FRASE_DE_PERMISOS, 'permisos', 'token', e?.response?.status ?? null)
  if (/invalid_grant/i.test(texto)) {
    return new ErrorDeGoogle(
      'Google rechaza la suplantación del usuario (invalid_grant): o el correo de GOOGLE_IMPERSONATE_SUBJECT no existe en Workspace, o la delegación en todo el dominio no está activa para esta cuenta de servicio, o la hora del servidor está desajustada.',
      'permisos',
      'token',
      e?.response?.status ?? null
    )
  }
  if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|timeout|timed out|aborted|fetch failed/i.test(texto)) return new ErrorDeGoogle('No se ha podido conectar con Google para pedir el permiso de acceso.', 'red', 'token', null)
  return new ErrorDeGoogle('No se ha podido obtener el permiso de acceso a Google.', 'otro', 'token', e?.response?.status ?? null)
}

/** Un fallo de red o de tiempo al hacer la petición (fetch lanzó) */
export function falloDeRed(api: Exclude<ApiDeGoogle, 'token'>, error: unknown): ErrorDeGoogle {
  const e = error as { name?: string }
  const lenta = e?.name === 'TimeoutError' || e?.name === 'AbortError'
  return new ErrorDeGoogle(lenta ? `${NOMBRE_DE_LA_API[api]} ha tardado demasiado en contestar.` : `No se ha podido conectar con ${NOMBRE_DE_LA_API[api]}.`, 'red', api, null)
}
