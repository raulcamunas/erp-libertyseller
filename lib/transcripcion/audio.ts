import { BYTES_MAXIMOS } from './reglas'

/**
 * BAJAR EL AUDIO DE UNA GRABACIÓN DE RINKEL.
 * ==========================================
 * SOLO SERVIDOR. Recibe la dirección temporal que ya pidió `pedirUrlDeGrabacion` (lib/rendimiento/rinkel.ts, que comprueba que apunta
 * a https y al propio host de Rinkel) y descarga el audio a memoria, con un tope de tamaño. Se comprueba con audio.prueba.ts con un
 * `fetch` falso.
 *
 * NO SE GUARDA EN NINGÚN SITIO: el audio vive unos segundos en memoria, se manda a transcribir y se tira. Rinkel ya lo guarda 90 días.
 *
 * NO SE SABE DE ANTEMANO EN QUÉ FORMATO SIRVE Rinkel (mp3, wav…): se mira por los primeros bytes del archivo, que no mienten, y solo si
 * eso no basta por la cabecera `content-type`. OpenAI acepta mp3, mp4, mpeg, mpga, m4a, wav y webm.
 */

export type ExtensionDeAudio = 'mp3' | 'wav' | 'm4a' | 'webm' | 'ogg' | 'flac'

export interface AudioDescargado {
  bytes: Uint8Array
  extension: ExtensionDeAudio
  /** El tipo MIME que se le dice a OpenAI al subirlo */
  mime: string
}

export type CodigoDeErrorDeAudio = 'demasiado_grande' | 'formato' | 'vacio' | 'red' | 'host'

export class ErrorDeAudio extends Error {
  readonly codigo: CodigoDeErrorDeAudio
  constructor(codigo: CodigoDeErrorDeAudio, mensaje: string) {
    super(mensaje)
    this.name = 'ErrorDeAudio'
    this.codigo = codigo
  }
}

export const MENSAJE_DE_AUDIO: Record<CodigoDeErrorDeAudio, string> = {
  demasiado_grande: 'La llamada es demasiado larga para transcribirla (el audio pasa de 24 MB).',
  formato: 'El audio de la grabación está en un formato que no se reconoce.',
  vacio: 'Rinkel ha devuelto la grabación vacía (puede que aún se esté procesando).',
  red: 'No se ha podido bajar la grabación de Rinkel.',
  host: 'La dirección de la grabación no es de Rinkel.',
}

const MIME: Record<ExtensionDeAudio, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
}

const ascii = (b: Uint8Array, desde: number, largo: number) => String.fromCharCode(...b.slice(desde, desde + largo))

/** El formato por los primeros bytes del archivo, o null si no se reconoce */
export function formatoPorBytes(b: Uint8Array): ExtensionDeAudio | null {
  if (b.length < 12) return null
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WAVE') return 'wav'
  if (ascii(b, 0, 3) === 'ID3') return 'mp3'
  // Un fotograma de mp3 sin etiqueta ID3: 11 bits a 1 al principio, y ni la versión ni la capa en su valor reservado (00 en la
  // capa es AAC ADTS, que no es mp3)
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && ((b[1] >> 1) & 0x03) !== 0 && ((b[1] >> 3) & 0x03) !== 1) return 'mp3'
  if (ascii(b, 4, 4) === 'ftyp') return 'm4a'
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'webm'
  if (ascii(b, 0, 4) === 'OggS') return 'ogg'
  if (ascii(b, 0, 4) === 'fLaC') return 'flac'
  return null
}

/** El formato por la cabecera `content-type`, para cuando los bytes no lo dicen */
export function formatoPorTipo(tipo: string | null): ExtensionDeAudio | null {
  const t = (tipo ?? '').toLowerCase().split(';')[0].trim()
  if (t === 'audio/mpeg' || t === 'audio/mp3') return 'mp3'
  if (t === 'audio/wav' || t === 'audio/x-wav' || t === 'audio/wave' || t === 'audio/vnd.wave') return 'wav'
  if (t === 'audio/mp4' || t === 'audio/x-m4a' || t === 'audio/m4a' || t === 'audio/aac') return 'm4a'
  if (t === 'audio/webm') return 'webm'
  if (t === 'audio/ogg' || t === 'application/ogg') return 'ogg'
  if (t === 'audio/flac' || t === 'audio/x-flac') return 'flac'
  return null
}

export interface OpcionesDeAudio {
  fetch?: typeof fetch
  /** Lo que se espera a que termine la descarga */
  esperaMs?: number
  maxBytes?: number
}

export async function descargarAudio(url: string, opciones: OpcionesDeAudio = {}): Promise<AudioDescargado> {
  const pedir = opciones.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
  const maxBytes = opciones.maxBytes ?? BYTES_MAXIMOS

  // La dirección ya la comprobó quien la pidió; se vuelve a mirar aquí porque es lo que decide a dónde sale una petición con el audio
  let destino: URL
  try {
    destino = new URL(url)
  } catch {
    throw new ErrorDeAudio('host', MENSAJE_DE_AUDIO.host)
  }
  if (destino.protocol !== 'https:' || destino.hostname !== 'api.rinkel.com') throw new ErrorDeAudio('host', MENSAJE_DE_AUDIO.host)

  let respuesta: Response
  try {
    respuesta = await pedir(destino.toString(), { method: 'GET', signal: AbortSignal.timeout(opciones.esperaMs ?? 60_000), cache: 'no-store', headers: { 'User-Agent': 'LibertySellerERP/1.0' } })
  } catch {
    throw new ErrorDeAudio('red', MENSAJE_DE_AUDIO.red)
  }
  if (!respuesta.ok) throw new ErrorDeAudio('red', MENSAJE_DE_AUDIO.red)

  const declarado = Number(respuesta.headers.get('content-length'))
  if (Number.isFinite(declarado) && declarado > maxBytes) throw new ErrorDeAudio('demasiado_grande', MENSAJE_DE_AUDIO.demasiado_grande)

  // Se lee a trozos con tope: un servidor que miente en la cabecera no puede llenar la memoria
  const trozos: Uint8Array[] = []
  let total = 0
  try {
    const lector = respuesta.body?.getReader()
    if (!lector) {
      const todo = new Uint8Array(await respuesta.arrayBuffer())
      if (todo.length > maxBytes) throw new ErrorDeAudio('demasiado_grande', MENSAJE_DE_AUDIO.demasiado_grande)
      trozos.push(todo)
      total = todo.length
    } else {
      for (;;) {
        const { done, value } = await lector.read()
        if (done) break
        total += value.length
        if (total > maxBytes) {
          await lector.cancel().catch(() => undefined)
          throw new ErrorDeAudio('demasiado_grande', MENSAJE_DE_AUDIO.demasiado_grande)
        }
        trozos.push(value)
      }
    }
  } catch (e) {
    if (e instanceof ErrorDeAudio) throw e
    throw new ErrorDeAudio('red', MENSAJE_DE_AUDIO.red)
  }

  if (total === 0) throw new ErrorDeAudio('vacio', MENSAJE_DE_AUDIO.vacio)
  const bytes = new Uint8Array(total)
  let posicion = 0
  for (const t of trozos) {
    bytes.set(t, posicion)
    posicion += t.length
  }

  const extension = formatoPorBytes(bytes) ?? formatoPorTipo(respuesta.headers.get('content-type'))
  if (!extension) throw new ErrorDeAudio('formato', MENSAJE_DE_AUDIO.formato)
  return { bytes, extension, mime: MIME[extension] }
}
