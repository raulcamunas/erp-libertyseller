import { ImapFlow } from 'imapflow'
import nodemailer, { type Transporter } from 'nodemailer'
import { resolverPublico } from './red'

/**
 * ABRIR CONEXIONES DE CORREO — SOLO SERVIDOR.
 * ===========================================
 * Lo único que abre sockets hacia un servidor de correo. Reglas que no se saltan:
 *
 *   1. El nombre del servidor pasa por resolverPublico() (red.ts) y la conexión se abre contra la dirección ya
 *      resuelta, con el nombre original solo para el certificado. Ningún servidor interno es alcanzable.
 *   2. Siempre cifrado y con certificado verificado: TLS directo, o STARTTLS OBLIGATORIO (si el servidor no lo
 *      ofrece, la conexión falla; nunca se baja a texto plano).
 *   3. NINGÚN error de aquí lleva texto del servidor ni de la librería: pueden incluir el usuario, trozos del
 *      protocolo o la propia contraseña. Todo error se convierte en un ErrorDeCorreo con un código y una frase
 *      FIJA. Lo único que se mira del error original es su código, para saber qué frase toca.
 *   4. Un tiempo máximo en cada fase. Un servidor que no contesta no cuelga la petición.
 */

export type CodigoDeErrorDeCorreo =
  | 'credenciales'
  | 'red'
  | 'tls'
  | 'servidor_no_permitido'
  | 'servidor_no_resuelve'
  | 'limite'
  | 'rechazado'
  | 'sin_enviados'
  | 'ocupado'
  | 'otro'

export const MENSAJE_DE_ERROR_DE_CORREO: Record<CodigoDeErrorDeCorreo, string> = {
  credenciales: 'El servidor de correo ha rechazado el usuario o la contraseña. Escribe la contraseña del buzón otra vez (en Hostinger es la del correo, no la de tu cuenta de Hostinger).',
  red: 'No se ha podido conectar con el servidor de correo. Se volverá a intentar solo.',
  tls: 'El servidor de correo no ha presentado un certificado válido, así que no nos conectamos a él.',
  servidor_no_permitido: 'Ese servidor de correo no está permitido.',
  servidor_no_resuelve: 'No se encuentra ese servidor de correo. Revisa el nombre.',
  limite: 'El proveedor del correo ha puesto un límite de envíos o de conexiones. Espera un rato y vuelve a probar.',
  rechazado: 'El servidor de correo ha rechazado el mensaje. Revisa los destinatarios.',
  sin_enviados: 'No se encuentra la carpeta de Enviados del buzón.',
  ocupado: 'Este buzón se está leyendo ahora mismo. Espera unos segundos.',
  otro: 'No se ha podido completar la operación con el servidor de correo.',
}

export class ErrorDeCorreo extends Error {
  readonly codigo: CodigoDeErrorDeCorreo
  constructor(codigo: CodigoDeErrorDeCorreo) {
    super(MENSAJE_DE_ERROR_DE_CORREO[codigo])
    this.name = 'ErrorDeCorreo'
    this.codigo = codigo
  }
}

const CODIGOS_DE_RED = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ECONNABORTED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ETIMEOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE',
  'ECONNECTION', 'ESOCKET', 'EDNS', 'CONNECT_TIMEOUT', 'GREETING_TIMEOUT', 'NOCONNECTION', 'ETLS_TIMEOUT', 'SOCKET_TIMEOUT',
])

/** Lee el error de una librería SOLO por sus códigos (nunca su texto) y devuelve el nuestro */
export function convertirError(error: unknown): ErrorDeCorreo {
  if (error instanceof ErrorDeCorreo) return error
  const e = (error ?? {}) as {
    code?: unknown
    authenticationFailed?: unknown
    serverResponseCode?: unknown
    responseCode?: unknown
    response?: unknown
    responseStatus?: unknown
  }
  const codigo = typeof e.code === 'string' ? e.code.toUpperCase() : ''
  const respuestaDelServidor = typeof e.serverResponseCode === 'string' ? e.serverResponseCode.toUpperCase() : ''
  const smtp = typeof e.responseCode === 'number' ? e.responseCode : 0
  // Solo se MIRA el texto de la respuesta del servidor para clasificar (p. ej. «quota exceeded»); no sale de aquí
  const textoSmtp = typeof e.response === 'string' ? e.response.toLowerCase() : ''

  if (e.authenticationFailed === true || codigo === 'EAUTH' || respuestaDelServidor === 'AUTHENTICATIONFAILED' || smtp === 535 || smtp === 534) {
    return new ErrorDeCorreo('credenciales')
  }
  if (codigo.startsWith('ERR_TLS') || codigo.startsWith('ERR_SSL') || codigo === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || codigo === 'DEPTH_ZERO_SELF_SIGNED_CERT' || codigo === 'SELF_SIGNED_CERT_IN_CHAIN' || codigo === 'CERT_HAS_EXPIRED' || codigo === 'EPROTO' || codigo === 'ETLS') {
    return new ErrorDeCorreo('tls')
  }
  if (smtp === 452 || smtp === 421 || smtp === 450 || smtp === 451 || /quota|rate limit|too many|limit exceeded|exceeded|throttl/.test(textoSmtp)) {
    return new ErrorDeCorreo('limite')
  }
  if (smtp >= 500 && smtp < 600) return new ErrorDeCorreo('rechazado')
  if (CODIGOS_DE_RED.has(codigo)) return new ErrorDeCorreo('red')
  return new ErrorDeCorreo('otro')
}

/** Lo que hace falta saber de un buzón para conectarse a él (sin la contraseña) */
export interface ServidoresDeBuzon {
  usuario: string
  imap_host: string
  imap_puerto: number
  imap_seguro: boolean
  smtp_host: string
  smtp_puerto: number
  smtp_seguro: boolean
}

const CONECTAR_MS = 20_000
const SALUDO_MS = 15_000
/** Una orden IMAP que no avanza en este tiempo se da por muerta. Una lectura de lotes pequeños nunca está tanto sin hablar */
const SIN_ACTIVIDAD_MS = 60_000
/** Un mensaje que pase de esto no se descarga entero. Tiene que ir por encima del tope que aplica el sincronizador */
const MAX_LITERAL = 40 * 1024 * 1024

export async function abrirImap(b: ServidoresDeBuzon, password: string): Promise<ImapFlow> {
  const destino = await resolverPublico(b.imap_host)
  if (!destino.ok) throw new ErrorDeCorreo(destino.motivo === 'interna' ? 'servidor_no_permitido' : 'servidor_no_resuelve')

  const cliente = new ImapFlow({
    host: destino.ip,
    port: b.imap_puerto,
    secure: b.imap_seguro,
    servername: b.imap_host,
    // STARTTLS obligatorio: sin esto, un servidor que no lo ofrezca dejaría la contraseña viajar en claro
    ...(b.imap_seguro ? {} : { doSTARTTLS: true }),
    auth: { user: b.usuario, pass: password },
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: CONECTAR_MS,
    greetingTimeout: SALUDO_MS,
    socketTimeout: SIN_ACTIVIDAD_MS,
    maxLiteralSize: MAX_LITERAL,
    maxResponseSize: MAX_LITERAL + 8 * 1024 * 1024,
    clientInfo: { name: 'Liberty Seller Hub' },
  })
  // Sin un manejador, un error de socket a mitad de una orden (el servidor corta la conexión) se lanza como excepción
  // sin dueño y tira el proceso entero. Cada orden ya recibe su propio error por su promesa
  cliente.on('error', () => undefined)

  try {
    await cliente.connect()
  } catch (error) {
    try {
      cliente.close()
    } catch {
      // ya estaba cerrada
    }
    throw convertirError(error)
  }
  return cliente
}

/** Cierra la sesión con educación y, si no se puede, a la fuerza. Nunca lanza */
export async function cerrarImap(cliente: ImapFlow | null | undefined): Promise<void> {
  if (!cliente) return
  try {
    await cliente.logout()
  } catch {
    try {
      cliente.close()
    } catch {
      // nada más que hacer
    }
  }
}

export async function crearTransporte(b: ServidoresDeBuzon, password: string): Promise<Transporte> {
  const destino = await resolverPublico(b.smtp_host)
  if (!destino.ok) throw new ErrorDeCorreo(destino.motivo === 'interna' ? 'servidor_no_permitido' : 'servidor_no_resuelve')

  return nodemailer.createTransport({
    host: destino.ip,
    port: b.smtp_puerto,
    secure: b.smtp_seguro,
    requireTLS: !b.smtp_seguro,
    // Nombre del servidor para el certificado y el SNI (la conexión va a la dirección ya resuelta)
    tls: { servername: b.smtp_host, minVersion: 'TLSv1.2', rejectUnauthorized: true },
    auth: { user: b.usuario, pass: password },
    connectionTimeout: CONECTAR_MS,
    greetingTimeout: SALUDO_MS,
    socketTimeout: 60_000,
    // El mensaje se arma con contenido en memoria; que una opción mal puesta no pueda leer ficheros ni URL del servidor
    disableFileAccess: true,
    disableUrlAccess: true,
    logger: false,
  })
}

export type Transporte = Transporter

/**
 * Comprueba que el usuario y la contraseña entran por IMAP y por SMTP. Lanza ErrorDeCorreo si no.
 * Devuelve la lista de carpetas que ve el servidor (para elegir Entrada y Enviados sin una segunda conexión).
 */
export async function probarBuzon(b: ServidoresDeBuzon, password: string): Promise<Array<{ path: string; specialUse?: string; flags?: string[] }>> {
  let cliente: ImapFlow | null = null
  try {
    cliente = await abrirImap(b, password)
    const lista = await cliente.list()
    const carpetas = lista.map((c) => ({ path: c.path, specialUse: c.specialUse, flags: [...(c.flags ?? [])] }))
    await cerrarImap(cliente)
    cliente = null

    const transporte = await crearTransporte(b, password)
    try {
      await transporte.verify()
    } catch (error) {
      throw convertirError(error)
    } finally {
      transporte.close()
    }
    return carpetas
  } catch (error) {
    throw convertirError(error)
  } finally {
    await cerrarImap(cliente)
  }
}
