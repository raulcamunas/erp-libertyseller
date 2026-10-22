import { randomUUID } from 'node:crypto'
import MailComposer from 'nodemailer/lib/mail-composer'
import { analizarMensaje, nombreDeFichero } from './analizar'
import type { Almacen, FilaDeBuzon } from './almacen'
import { ErrorDeCorreo, convertirError, type Transporte } from './conexion'
import { dominioDe, limpiarNombre, type Persona } from './direcciones'
import { htmlDeRespuesta, textoDeRespuesta } from './html'
import { colocarMensaje } from './sincronizar'

/**
 * ENVIAR UN CORREO DESDE EL ERP — SOLO SERVIDOR.
 * ==============================================
 * Se comprueba con enviar.prueba.ts con un transporte falso.
 *
 * El recorrido, y por qué en este orden:
 *
 *   1. Se COMPONE el mensaje entero (cabeceras de hilo, texto y HTML, adjuntos) en bytes. El Message-ID lo ponemos
 *      nosotros: así lo conocemos antes de enviar y lo podemos emparejar con la copia de Enviados.
 *   2. Se ENVÍA por SMTP esos mismos bytes. Si falla, no se ha hecho nada más: el correo no existe.
 *   3. Se COPIA a la carpeta Enviados del buzón por IMAP (SMTP no lo hace por sí solo), de modo que el webmail del
 *      proveedor lo vea igual. Si esto falla, el correo YA SALIÓ: se guarda aquí igualmente y se avisa, no se reintenta
 *      el envío (se mandaría dos veces).
 *   4. Se GUARDA en la base, en el hilo que le toca (por In-Reply-To y References, o por el asunto).
 *
 * Los destinatarios, el asunto y los nombres de fichero pasan por las mismas limpiezas que lo que llega de fuera:
 * nada con saltos de línea (inyección de cabeceras) y nada con rutas.
 */

export const MAX_DESTINATARIOS = 25
export const MAX_ASUNTO = 500
export const MAX_TEXTO_ENVIADO = 100_000
export const MAX_ADJUNTOS = 10
export const MAX_BYTES_ADJUNTOS = 15 * 1024 * 1024
/** Más envíos que esto por minuto desde un mismo buzón es un bucle o un abuso, no una persona escribiendo */
export const MAX_ENVIOS_POR_MINUTO = 20

export interface AdjuntoParaEnviar {
  nombre: string
  tipo: string
  contenido: Buffer
}

export interface ContextoDeRespuesta {
  /** Message-ID del correo al que se contesta, sin < > */
  messageId: string | null
  /** Su cadena de References, sin < > */
  referencias: string[]
  /** Lo que se cita debajo, y su encabezado («El … Ana escribió:») */
  cita: { encabezado: string; texto: string } | null
}

export interface EntradaDeEnvio {
  para: Persona[]
  cc: Persona[]
  asunto: string
  texto: string
  respuesta?: ContextoDeRespuesta | null
  adjuntos?: AdjuntoParaEnviar[]
}

export type ProblemaDeEntrada =
  | 'sin_destinatarios'
  | 'demasiados_destinatarios'
  | 'asunto_largo'
  | 'texto_vacio'
  | 'texto_largo'
  | 'demasiados_adjuntos'
  | 'adjuntos_grandes'

export const MENSAJE_DE_PROBLEMA: Record<ProblemaDeEntrada, string> = {
  sin_destinatarios: 'Falta al menos un destinatario válido.',
  demasiados_destinatarios: `Se pueden poner como mucho ${MAX_DESTINATARIOS} destinatarios (Para y Cc juntos).`,
  asunto_largo: `El asunto no puede pasar de ${MAX_ASUNTO} caracteres.`,
  texto_vacio: 'El mensaje está vacío.',
  texto_largo: 'El mensaje es demasiado largo.',
  demasiados_adjuntos: `Se pueden adjuntar como mucho ${MAX_ADJUNTOS} ficheros.`,
  adjuntos_grandes: `Los adjuntos no pueden pasar de ${MAX_BYTES_ADJUNTOS / (1024 * 1024)} MB en total.`,
}

/** null si la entrada se puede enviar; si no, qué falla */
export function comprobarEntrada(e: EntradaDeEnvio): ProblemaDeEntrada | null {
  if (e.para.length === 0) return 'sin_destinatarios'
  if (e.para.length + e.cc.length > MAX_DESTINATARIOS) return 'demasiados_destinatarios'
  if (e.asunto.length > MAX_ASUNTO) return 'asunto_largo'
  if (e.texto.trim() === '' && (e.adjuntos ?? []).length === 0) return 'texto_vacio'
  if (e.texto.length > MAX_TEXTO_ENVIADO) return 'texto_largo'
  const adjuntos = e.adjuntos ?? []
  if (adjuntos.length > MAX_ADJUNTOS) return 'demasiados_adjuntos'
  if (adjuntos.reduce((s, a) => s + a.contenido.length, 0) > MAX_BYTES_ADJUNTOS) return 'adjuntos_grandes'
  return null
}

export interface CorreoCompuesto {
  /** Los bytes del mensaje, tal y como se envían y se copian a Enviados */
  crudo: Buffer
  /** Su Message-ID sin < > */
  messageId: string
  fecha: Date
}

/** Compone el mensaje. No toca la red */
export async function componerCorreo(
  buzon: Pick<FilaDeBuzon, 'direccion' | 'nombre'>,
  entrada: EntradaDeEnvio,
  opciones: { ahora?: Date; id?: string } = {}
): Promise<CorreoCompuesto> {
  const fecha = opciones.ahora ?? new Date()
  const messageId = `${opciones.id ?? randomUUID()}@${dominioDe(buzon.direccion)}`
  const cita = entrada.respuesta?.cita ?? undefined

  const compositor = new MailComposer({
    from: { name: limpiarNombre(buzon.nombre), address: buzon.direccion },
    to: entrada.para.map((p) => ({ name: limpiarNombre(p.nombre), address: p.direccion })),
    cc: entrada.cc.map((p) => ({ name: limpiarNombre(p.nombre), address: p.direccion })),
    subject: entrada.asunto.replace(/[\r\n]+/g, ' ').trim(),
    text: textoDeRespuesta(entrada.texto, cita),
    html: htmlDeRespuesta(entrada.texto, cita),
    messageId: `<${messageId}>`,
    date: fecha,
    inReplyTo: entrada.respuesta?.messageId ? `<${entrada.respuesta.messageId}>` : undefined,
    references: entrada.respuesta?.messageId ? [...entrada.respuesta.referencias, entrada.respuesta.messageId].filter((v, i, a) => a.indexOf(v) === i).slice(-30).map((r) => `<${r}>`) : undefined,
    headers: { 'X-Mailer': 'Liberty Seller Hub' },
    attachments: (entrada.adjuntos ?? []).map((a) => ({ filename: nombreDeFichero(a.nombre), content: a.contenido, contentType: a.tipo || 'application/octet-stream' })),
    disableFileAccess: true,
    disableUrlAccess: true,
  })

  const crudo = await new Promise<Buffer>((resolver, rechazar) => {
    compositor.compile().build((error, mensaje) => (error ? rechazar(error) : resolver(mensaje)))
  })
  return { crudo, messageId, fecha }
}

/** Dónde ha quedado la copia en Enviados (si ha quedado) */
export interface CopiaEnEnviados {
  ruta: string
  uid: number | null
  uidValidity: number | null
}

export interface DepsDeEnvio {
  almacen: Almacen
  transporte: Pick<Transporte, 'sendMail'>
  /** Copia el mensaje a Enviados por IMAP. null = no se ha podido; no impide que el correo se dé por enviado */
  copiarAEnviados: (crudo: Buffer, fecha: Date) => Promise<CopiaEnEnviados | null>
}

export interface ResultadoDeEnvio {
  messageId: string
  hiloId: string
  fecha: Date
  /** false = salió, pero no hay copia en la carpeta Enviados del proveedor */
  copiadoAEnviados: boolean
  /** Direcciones a las que el servidor se ha negado a entregar (el resto sí salió) */
  rechazados: string[]
}

export async function enviarCorreo(deps: DepsDeEnvio, buzon: FilaDeBuzon, entrada: EntradaDeEnvio, opciones: { ahora?: Date; id?: string } = {}): Promise<ResultadoDeEnvio> {
  const problema = comprobarEntrada(entrada)
  if (problema) throw new Error(MENSAJE_DE_PROBLEMA[problema])

  const compuesto = await componerCorreo(buzon, entrada, opciones)

  let rechazados: string[] = []
  try {
    const sobre = { from: buzon.direccion, to: [...entrada.para, ...entrada.cc].map((p) => p.direccion) }
    const info = await deps.transporte.sendMail({ envelope: sobre, raw: compuesto.crudo })
    const aceptados = (info.accepted ?? []).length
    rechazados = (info.rejected ?? []).map((r: unknown) => (typeof r === 'string' ? r : (r as { address?: string }).address ?? '')).filter(Boolean)
    if (aceptados === 0) throw new ErrorDeCorreo('rechazado')
  } catch (error) {
    throw convertirError(error)
  }

  // A partir de aquí el correo YA HA SALIDO: nada de lo que falle debe hacer creer que no se envió
  let copia: CopiaEnEnviados | null = null
  try {
    copia = await deps.copiarAEnviados(compuesto.crudo, compuesto.fecha)
  } catch {
    copia = null
  }

  const analizado = await analizarMensaje(compuesto.crudo, { fechaDelServidor: compuesto.fecha, ahora: compuesto.fecha })
  const carpeta = await deps.almacen.asegurarCarpeta(buzon.id, 'enviados', copia?.ruta ?? 'Sent')

  // Un UID solo vale si el UIDVALIDITY de la carpeta es el que conocemos: si no, se deja sin UID y la próxima lectura lo empareja
  let uid = copia?.uid ?? null
  if (uid !== null && copia?.uidValidity != null) {
    if (carpeta.uidvalidity === null) await deps.almacen.anotarCarpeta(carpeta.id, { uidvalidity: copia.uidValidity })
    else if (carpeta.uidvalidity !== copia.uidValidity) uid = null
  } else {
    uid = null
  }

  const colocado = await colocarMensaje(
    deps.almacen,
    { buzon, carpetaId: carpeta.id, direccion: 'saliente', uid, leido: true, tamano: compuesto.crudo.length },
    analizado
  )

  return { messageId: compuesto.messageId, hiloId: colocado.hiloId, fecha: compuesto.fecha, copiadoAEnviados: copia !== null, rechazados }
}
