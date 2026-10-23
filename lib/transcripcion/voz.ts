import type { AudioDescargado } from './audio'
import type { PistasDeVoz } from './reglas'

/**
 * PASAR UN AUDIO A TEXTO CON OPENAI.
 * ==================================
 * SOLO SERVIDOR. Una petición multipart a `POST /v1/audio/transcriptions` con la clave OPENAI_API_KEY del servidor (la misma que usa
 * «Redactar con IA»: nada nuevo que dar de alta). Se comprueba con voz.prueba.ts con un `fetch` falso.
 *
 * Se llama a la API por `fetch` y no con el SDK de `openai`: `gpt-transcribe` admite campos nuevos (`keywords`) que las versiones del SDK
 * van por detrás, y la petición son diez líneas.
 *
 * Lo que devuelve `gpt-transcribe` es `{ text, languages, usage: { type: 'duration', seconds } }`: el texto de corrido, SIN marcas de
 * tiempo ni quién habla (eso solo lo daban whisper-1 y la versión «diarize», que OpenAI apaga el 26 feb 2027). `usage.seconds` son los
 * segundos de audio que se cobran: sirven para la cuenta del gasto.
 *
 * Los errores se reducen a un código con una frase NUESTRA: el cuerpo de la respuesta de OpenAI puede repetir parte de lo enviado.
 */

export type CodigoDeErrorDeVoz = 'sin_clave' | 'audio' | 'clave' | 'saldo' | 'limite' | 'servidor' | 'red' | 'respuesta'

export class ErrorDeVoz extends Error {
  readonly codigo: CodigoDeErrorDeVoz
  readonly estado: number | null
  constructor(codigo: CodigoDeErrorDeVoz, mensaje: string, estado: number | null = null) {
    super(mensaje)
    this.name = 'ErrorDeVoz'
    this.codigo = codigo
    this.estado = estado
  }
}

export const MENSAJE_DE_VOZ: Record<CodigoDeErrorDeVoz, string> = {
  sin_clave: 'La IA no está configurada en el servidor (falta OPENAI_API_KEY).',
  audio: 'OpenAI no ha podido leer el audio de la grabación.',
  clave: 'La clave de OpenAI no es válida: hay que revisar OPENAI_API_KEY en el servidor.',
  saldo: 'La cuenta de OpenAI se ha quedado sin saldo.',
  limite: 'OpenAI está saturado o ha llegado a su límite.',
  servidor: 'OpenAI tiene un problema ahora mismo.',
  red: 'No se ha podido hablar con OpenAI.',
  respuesta: 'OpenAI ha contestado algo que no se entiende.',
}

/** ¿El fallo es de OpenAI en general (clave, saldo) y no de esta llamada? Entonces no tiene sentido seguir con las demás en esta pasada */
export const esFalloGeneralDeLaIa = (codigo: CodigoDeErrorDeVoz | 'sin_clave'): boolean => codigo === 'sin_clave' || codigo === 'clave' || codigo === 'saldo'

export interface ResultadoDeVoz {
  texto: string
  /** Códigos de idioma que detectó («es»). Vacío si no pudo (por ejemplo, con puro ruido) */
  idiomas: string[]
  /** Segundos de audio que cuenta OpenAI, o null si no lo dijo */
  segundos: number | null
}

export interface OpcionesDeVoz {
  audio: AudioDescargado
  modelo: string
  clave: string
  pistas: PistasDeVoz
  fetch?: typeof fetch
  esperaMs?: number
}

/** Los campos de contexto de `gpt-transcribe`. Los modelos viejos (whisper-1, gpt-4o-*) no los conocen y rechazan la petición */
const esGptTranscribe = (modelo: string) => /^gpt-transcribe/.test(modelo)

export async function transcribirAudio(op: OpcionesDeVoz): Promise<ResultadoDeVoz> {
  if (!op.clave) throw new ErrorDeVoz('sin_clave', MENSAJE_DE_VOZ.sin_clave)
  const pedir = op.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a))

  const formulario = new FormData()
  formulario.append('file', new Blob([op.audio.bytes as BlobPart], { type: op.audio.mime }), `llamada.${op.audio.extension}`)
  formulario.append('model', op.modelo)
  formulario.append('prompt', op.pistas.prompt)
  if (esGptTranscribe(op.modelo)) {
    // Sin `languages`: el modelo detecta el idioma solo (probado con español e inglés) y una pista de «es» no le sirve a una llamada en catalán
    if (op.pistas.palabras) formulario.append('keywords', op.pistas.palabras)
  } else {
    formulario.append('language', 'es')
  }

  let respuesta: Response
  try {
    respuesta = await pedir('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${op.clave}` },
      body: formulario,
      signal: AbortSignal.timeout(op.esperaMs ?? 150_000),
    })
  } catch {
    throw new ErrorDeVoz('red', MENSAJE_DE_VOZ.red)
  }

  if (!respuesta.ok) {
    const estado = respuesta.status
    // De la respuesta de error solo se mira el código de la cuenta sin saldo; el resto del cuerpo no se usa ni se registra
    let codigo: string | null = null
    try {
      const cuerpo = (await respuesta.json()) as { error?: { code?: unknown } }
      codigo = typeof cuerpo?.error?.code === 'string' ? cuerpo.error.code : null
    } catch {
      codigo = null
    }
    if (estado === 401 || estado === 403) throw new ErrorDeVoz('clave', MENSAJE_DE_VOZ.clave, estado)
    if (estado === 402 || codigo === 'insufficient_quota') throw new ErrorDeVoz('saldo', MENSAJE_DE_VOZ.saldo, estado)
    if (estado === 429) throw new ErrorDeVoz('limite', MENSAJE_DE_VOZ.limite, estado)
    if (estado >= 500) throw new ErrorDeVoz('servidor', MENSAJE_DE_VOZ.servidor, estado)
    // 400, 413, 415, 422…: el audio no vale (formato, demasiado corto, corrupto). Reintentar no lo arregla
    throw new ErrorDeVoz('audio', MENSAJE_DE_VOZ.audio, estado)
  }

  let cuerpo: unknown
  try {
    cuerpo = await respuesta.json()
  } catch {
    throw new ErrorDeVoz('respuesta', MENSAJE_DE_VOZ.respuesta, respuesta.status)
  }
  const o = (cuerpo ?? {}) as { text?: unknown; languages?: unknown; usage?: { seconds?: unknown } }
  if (typeof o.text !== 'string') throw new ErrorDeVoz('respuesta', MENSAJE_DE_VOZ.respuesta, respuesta.status)

  const idiomas = Array.isArray(o.languages)
    ? o.languages.map((l) => (l && typeof l === 'object' ? (l as { code?: unknown }).code : null)).filter((c): c is string => typeof c === 'string' && c !== '')
    : []
  const segundos = typeof o.usage?.seconds === 'number' && Number.isFinite(o.usage.seconds) ? Math.round(o.usage.seconds) : null
  return { texto: o.text.trim(), idiomas, segundos }
}
