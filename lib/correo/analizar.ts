import { simpleParser, type AddressObject, type Attachment, type ParsedMail } from 'mailparser'
import { esAutomatico } from './automatico'
import { limpiarNombre, normalizarDireccion, sinRepetidas, type Persona } from './direcciones'
import { htmlATextoBasico, vistaPrevia } from './html'
import { normalizarMessageId, referenciasDe } from './hilos'
import { MAX_IMAGEN_INCRUSTADA, MAX_IMAGENES_INCRUSTADAS_TOTAL, limpiarHtml } from './limpiar'

/**
 * DE UN CORREO TAL Y COMO LO DA EL SERVIDOR A LO QUE SE GUARDA — SOLO SERVIDOR.
 * =============================================================================
 * Recibe los bytes del mensaje (RFC 822) y devuelve lo que necesita la tabla `correo_mensajes`: las cabeceras de
 * hilo, las personas, el texto, el HTML ya limpio y la FICHA de los adjuntos (el fichero no se guarda: se vuelve a
 * pedir al servidor de correo cuando alguien lo descarga, y por eso la ficha lleva su número de orden).
 *
 * Se comprueba con analizar.prueba.ts contra correos de verdad (multipart, adjuntos, imágenes incrustadas, HTML
 * hostil, cabeceras raras).
 */

/** Tope de caracteres de texto que se guardan de un correo. Más allá es un volcado, no un mensaje */
export const MAX_TEXTO = 60_000
/** Un correo con fecha de más de 36 horas en el futuro está mal puesto (el spam lo hace): se usa la del servidor */
const FUTURO_PERMITIDO_MS = 36 * 60 * 60 * 1000

export interface AdjuntoFicha {
  nombre: string
  tipo: string
  tamano: number
  /** Posición del adjunto en la lista que da el analizador. Es lo que se usa para volver a pedirlo */
  n: number
}

export interface MensajeAnalizado {
  messageId: string | null
  enRespuestaA: string | null
  referencias: string[]
  deNombre: string
  deDireccion: string
  para: Persona[]
  cc: Persona[]
  responderA: Persona[]
  asunto: string
  fecha: Date
  texto: string
  html: string | null
  vistaPrevia: string
  adjuntos: AdjuntoFicha[]
  automatico: boolean
}

export interface ContextoDeAnalisis {
  /** La fecha en que el servidor recibió el mensaje: de reserva si la cabecera Date no sirve */
  fechaDelServidor?: Date | null
  /** Solo se han traído las cabeceras: el mensaje es demasiado grande para traerlo entero */
  soloCabeceras?: { tamano: number } | null
  ahora?: Date
}

const IMAGENES_INCRUSTABLES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/bmp'])

/**
 * El valor de una cabecera tal y como vino, o null si no está. Se lee de la línea cruda y no del objeto que arma el
 * analizador: este agrupa las cabeceras List-* bajo una sola clave y convierte Return-Path en una lista de personas
 * (el «<>» de un rebote sale como una dirección vacía), y para saber si una cabecera ESTÁ no hace falta más.
 */
function cabeceraCruda(p: ParsedMail, clave: string): string | null {
  const linea = p.headerLines.find((h) => h.key === clave)
  if (!linea) return null
  const dosPuntos = linea.line.indexOf(':')
  return linea.line.slice(dosPuntos + 1).replace(/\s+/g, ' ').trim()
}

function personasDe(o: AddressObject | AddressObject[] | undefined): Persona[] {
  if (!o) return []
  const lista = Array.isArray(o) ? o : [o]
  const salida: Persona[] = []
  const recorrer = (items: Array<{ address?: string; name?: string; group?: Array<{ address?: string; name?: string }> }>) => {
    for (const e of items) {
      if (e.group) recorrer(e.group)
      const direccion = normalizarDireccion(e.address)
      if (direccion) salida.push({ nombre: limpiarNombre(e.name), direccion })
    }
  }
  for (const a of lista) recorrer(a.value)
  return sinRepetidas(salida)
}

/** El nombre de un fichero adjunto, sin rutas ni caracteres de control, listo para guardarse y para ofrecerse a descargar */
export function nombreDeFichero(nombre: unknown): string {
  if (typeof nombre !== 'string') return 'adjunto'
  // eslint-disable-next-line no-control-regex
  const limpio = nombre.replace(/[\u0000-\u001f\u007f"\\/:*?<>|]/g, '_').replace(/^\.+/, '').trim().slice(0, 200)
  return limpio || 'adjunto'
}

function fechaDelMensaje(cabecera: Date | undefined, servidor: Date | null | undefined, ahora: Date): Date {
  const valida = (d: Date | null | undefined): d is Date => d instanceof Date && Number.isFinite(d.getTime())
  const razonable = (d: Date) => d.getTime() <= ahora.getTime() + FUTURO_PERMITIDO_MS && d.getUTCFullYear() >= 1995
  if (valida(cabecera) && razonable(cabecera)) return cabecera
  if (valida(servidor) && razonable(servidor)) return servidor
  return ahora
}

/** Los CID que cita el HTML (`src="cid:abc"`), en minúsculas */
function cidsCitados(html: string): Set<string> {
  const usados = new Set<string>()
  for (const m of html.matchAll(/cid:([^"'\s>)]+)/gi)) {
    let cid = m[1]
    try {
      cid = decodeURIComponent(cid)
    } catch {
      // un % mal puesto: se queda tal cual
    }
    usados.add(cid.replace(/^<|>$/g, '').toLowerCase())
  }
  return usados
}

function recortarTexto(texto: string): string {
  const t = texto.replace(/\r\n?/g, '\n').trim()
  return t.length <= MAX_TEXTO ? t : `${t.slice(0, MAX_TEXTO)}\n\n[… el resto del mensaje no se ha guardado]`
}

const mb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1).replace('.', ',')

export async function analizarMensaje(fuente: Buffer, contexto: ContextoDeAnalisis = {}): Promise<MensajeAnalizado> {
  const ahora = contexto.ahora ?? new Date()
  const p: ParsedMail = await simpleParser(fuente, { skipImageLinks: true, skipTextToHtml: true, skipTextLinks: true })

  const de = personasDe(p.from)[0]
  const deDireccion = de?.direccion ?? ''
  const cab = (nombre: string) => cabeceraCruda(p, nombre)

  const automatico = esAutomatico({
    autoSubmitted: cab('auto-submitted'),
    precedence: cab('precedence'),
    // Una cabecera vacía («List-Id:») cuenta como puesta: por eso se pasa un texto aunque no tenga contenido
    listId: cab('list-id') === null ? null : cab('list-id') || '-',
    listUnsubscribe: cab('list-unsubscribe') === null ? null : cab('list-unsubscribe') || '-',
    autoResponseSuppress: cab('x-auto-response-suppress'),
    xAutoreply: cab('x-autoreply') ?? cab('x-autorespond'),
    returnPath: cab('return-path'),
    deDireccion,
  })

  const base = {
    messageId: normalizarMessageId(p.messageId),
    enRespuestaA: normalizarMessageId(p.inReplyTo),
    referencias: referenciasDe(p.references),
    deNombre: de?.nombre ?? '',
    deDireccion,
    para: personasDe(p.to),
    cc: personasDe(p.cc),
    responderA: personasDe(p.replyTo),
    asunto: (p.subject ?? '').replace(/\s+/g, ' ').trim().slice(0, 500),
    fecha: fechaDelMensaje(p.date, contexto.fechaDelServidor, ahora),
    automatico,
  }

  // Demasiado grande para traerlo: se guardan las cabeceras y un aviso, y se abre en el webmail
  if (contexto.soloCabeceras) {
    const texto = `Este correo pesa ${mb(contexto.soloCabeceras.tamano)} MB y no se ha traído al ERP. Ábrelo en el webmail del proveedor.`
    return { ...base, texto, html: null, vistaPrevia: texto, adjuntos: [] }
  }

  const htmlOriginal = typeof p.html === 'string' ? p.html : ''
  const usados = htmlOriginal ? cidsCitados(htmlOriginal) : new Set<string>()

  // Las imágenes del propio correo se incrustan en su HTML (si caben) y no se ofrecen como adjuntos
  const imagenesPorCid = new Map<string, string>()
  let incrustadas = 0
  const adjuntos: AdjuntoFicha[] = []
  p.attachments.forEach((a: Attachment, n: number) => {
    const cid = (a.cid ?? a.contentId ?? '').replace(/^<|>$/g, '').trim().toLowerCase()
    const citadoPorElHtml = cid !== '' && usados.has(cid)
    if (citadoPorElHtml) {
      const tipo = (a.contentType ?? '').toLowerCase()
      if (IMAGENES_INCRUSTABLES.has(tipo) && a.content.length <= MAX_IMAGEN_INCRUSTADA && incrustadas + a.content.length <= MAX_IMAGENES_INCRUSTADAS_TOTAL) {
        imagenesPorCid.set(cid, `data:${tipo};base64,${a.content.toString('base64')}`)
        incrustadas += a.content.length
      }
      return
    }
    adjuntos.push({ nombre: nombreDeFichero(a.filename), tipo: (a.contentType || 'application/octet-stream').toLowerCase().slice(0, 100), tamano: a.size ?? a.content.length, n })
  })

  const html = htmlOriginal ? limpiarHtml(htmlOriginal, { imagenesPorCid }) : null
  const delHtml = !p.text && htmlOriginal ? htmlATextoBasico(htmlOriginal) : ''
  const texto = recortarTexto(p.text || delHtml)

  return { ...base, texto, html, vistaPrevia: vistaPrevia(texto), adjuntos }
}
