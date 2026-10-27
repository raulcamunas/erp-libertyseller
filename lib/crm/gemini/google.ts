import { auth as googleAuth } from '@googleapis/calendar'
import { ESPERA_JSON_MS } from '@/lib/tiempos-espera'
import type { CorreoDeGemini } from './correo'
import { REMITENTE_DE_GEMINI } from './correo'
import type { DocumentoDeDocs } from './documento'
import { clasificarFalloDeToken, clasificarRespuestaDeGoogle, ErrorDeGoogle, falloDeRed, type ApiDeGoogle } from './errores-google'
import { correoDeGmail, encabezadoDeGmail, type EncabezadoDeCorreo, type MensajeDeGmail } from './gmail'

/**
 * LA CONEXIÓN CON GMAIL Y GOOGLE DOCS, CON LA CUENTA DE SERVICIO QUE YA USA LA AGENDA.
 * ====================================================================================
 * La Agenda ya habla con Google Calendar como `GOOGLE_SA_CLIENT_EMAIL`, suplantando a `GOOGLE_IMPERSONATE_SUBJECT` (business@) por delegación en todo el dominio. Las notas de
 * Gemini llegan a ESE buzón (business@ es el organizador de las reuniones), así que se lee con la misma cuenta: solo cambia la lista de permisos que se pide.
 *
 * PERMISOS: `gmail.readonly` (leer el correo, nada más) y `documents.readonly` (leer documentos de Google Docs, nada más: lo justo para abrir el documento «Notas de Gemini»; NO se
 * pide `drive.readonly`, que daría lectura sobre todo el Drive del buzón). Hay que
 * autorizarlos UNA VEZ en la consola de administración de Workspace (delegación en todo el dominio, añadiéndolos al ID de cliente de la cuenta de servicio), y activar las APIs
 * de Gmail y de Google Docs en el proyecto de Google Cloud. Mientras no estén, cada fallo dice exactamente cuál falta (errores-google.ts) y la sincronización no hace nada más.
 *
 * SOLO LEE. No hay una sola llamada que escriba, marque, borre ni envíe: los permisos pedidos no lo permitirían aunque la hubiera.
 *
 * Va con `fetch` y no con la librería oficial: para tres peticiones (listar, leer un mensaje, leer un documento) la librería de Gmail y la de Docs son decenas de megas de
 * dependencias, y el JWT de la autenticación ya está en el paquete que la Agenda tiene instalado.
 */

export const PERMISOS_DE_GEMINI = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/documents.readonly'] as const

/** Lo que la sincronización necesita de Google. Es una interfaz para poder probarla con un Google de mentira */
export interface FuenteDeGoogle {
  /** Ids de correos de Gemini desde esa fecha, de MÁS ANTIGUO a más nuevo, hasta `maximo` */
  listarCorreos(desdeMs: number, maximo: number): Promise<string[]>
  /** Solo el asunto, el remitente y la hora (formato `metadata`, sin el cuerpo). null si no se puede leer */
  leerEncabezado(id: string): Promise<EncabezadoDeCorreo | null>
  /** El correo entero, con su cuerpo. null si el mensaje no se puede leer como correo */
  leerCorreo(id: string): Promise<CorreoDeGemini | null>
  leerDocumento(id: string): Promise<DocumentoDeDocs>
}

export function googleEstaConfigurado(): boolean {
  return Boolean(process.env.GOOGLE_SA_CLIENT_EMAIL && process.env.GOOGLE_SA_PRIVATE_KEY && process.env.GOOGLE_IMPERSONATE_SUBJECT)
}

let clienteJwt: InstanceType<typeof googleAuth.JWT> | null = null

function jwt() {
  if (clienteJwt) return clienteJwt
  const email = process.env.GOOGLE_SA_CLIENT_EMAIL
  const key = process.env.GOOGLE_SA_PRIVATE_KEY?.replace(/\\n/g, '\n')
  const subject = process.env.GOOGLE_IMPERSONATE_SUBJECT
  if (!email || !key || !subject) {
    throw new ErrorDeGoogle('Faltan variables de Google en el servidor: GOOGLE_SA_CLIENT_EMAIL, GOOGLE_SA_PRIVATE_KEY o GOOGLE_IMPERSONATE_SUBJECT.', 'sin_configurar', 'token')
  }
  clienteJwt = new googleAuth.JWT({ email, key, scopes: [...PERMISOS_DE_GEMINI], subject })
  return clienteJwt
}

/** El token de acceso (la librería lo guarda hasta que caduca y lo renueva sola) */
async function token(): Promise<string> {
  try {
    const { token: t } = await jwt().getAccessToken()
    if (!t) throw new ErrorDeGoogle('Google no ha entregado el permiso de acceso.', 'otro', 'token')
    return t
  } catch (error) {
    if (error instanceof ErrorDeGoogle) throw error
    // Un permiso rechazado deja el cliente en un estado raro: se vuelve a crear en la siguiente
    clienteJwt = null
    throw clasificarFalloDeToken(error)
  }
}

async function pedirJson<T>(api: Exclude<ApiDeGoogle, 'token'>, url: string): Promise<T> {
  const t = await token()
  let respuesta: Response
  try {
    respuesta = await fetch(url, { headers: { Authorization: `Bearer ${t}`, Accept: 'application/json' }, signal: AbortSignal.timeout(ESPERA_JSON_MS), cache: 'no-store' })
  } catch (error) {
    throw falloDeRed(api, error)
  }
  if (!respuesta.ok) {
    let cuerpo: unknown = null
    try {
      cuerpo = await respuesta.json()
    } catch {
      /* sin cuerpo legible: vale el estado */
    }
    throw clasificarRespuestaDeGoogle(api, respuesta.status, cuerpo)
  }
  try {
    return (await respuesta.json()) as T
  } catch {
    throw new ErrorDeGoogle('Google ha devuelto una respuesta que no se entiende.', 'otro', api, respuesta.status)
  }
}

/** Gmail da 100 ids por página como mucho, de más nuevo a más antiguo */
const POR_PAGINA = 100
const PAGINAS_COMO_MUCHO = 5

export function fuenteDeGoogleReal(): FuenteDeGoogle {
  return {
    async listarCorreos(desdeMs, maximo) {
      const consulta = `from:${REMITENTE_DE_GEMINI} after:${Math.max(0, Math.floor(desdeMs / 1000))}`
      const ids: string[] = []
      let pagina: string | undefined
      for (let i = 0; i < PAGINAS_COMO_MUCHO && ids.length < maximo; i++) {
        const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages')
        url.searchParams.set('q', consulta)
        url.searchParams.set('maxResults', String(Math.min(POR_PAGINA, maximo)))
        if (pagina) url.searchParams.set('pageToken', pagina)
        const r = await pedirJson<{ messages?: Array<{ id?: string }>; nextPageToken?: string }>('gmail', url.toString())
        for (const m of r.messages ?? []) if (m.id) ids.push(m.id)
        pagina = r.nextPageToken
        if (!pagina) break
      }
      // Gmail las da de más nuevo a más antiguo; se quiere procesar en el orden en que ocurrieron
      return ids.slice(0, maximo).reverse()
    },

    async leerEncabezado(id) {
      const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`
      return encabezadoDeGmail(await pedirJson<MensajeDeGmail>('gmail', url))
    },

    async leerCorreo(id) {
      const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`
      return correoDeGmail(await pedirJson<MensajeDeGmail>('gmail', url))
    },

    async leerDocumento(id) {
      const url = `https://docs.googleapis.com/v1/documents/${encodeURIComponent(id)}?includeTabsContent=true`
      return pedirJson<DocumentoDeDocs>('docs', url)
    },
  }
}
