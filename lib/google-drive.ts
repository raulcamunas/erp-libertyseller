/**
 * LECTURA DE GOOGLE DRIVE CON LA CUENTA DE SERVICIO QUE YA EXISTE.
 *
 * Solo lectura, y solo para traerse el fichero que el cliente deja en una
 * carpeta compartida. No escribe, no borra y no lista nada fuera de la carpeta
 * que se le diga.
 *
 * POR QUÉ NO HAY NINGÚN PAQUETE NUEVO
 * -----------------------------------
 * `@googleapis/calendar` re-exporta `google-auth-library` entera, y su JWT
 * mintea un token para CUALQUIER scope, no solo el de calendario. Como todo lo
 * demás de Drive son cuatro llamadas REST con `fetch`, añadir `@googleapis/drive`
 * (que arrastra su propio googleapis-common) solo serviría para tener dos
 * copias de la misma librería de autenticación en el contenedor. El import de
 * abajo se lee raro y por eso está explicado aquí: se importa el AUTENTICADOR,
 * no el calendario.
 *
 * LA DIFERENCIA QUE IMPORTA CON lib/google-calendar.ts: AQUÍ NO HAY `subject`
 * ---------------------------------------------------------------------------
 * El calendario usa delegación de dominio y actúa COMO UN USUARIO del Workspace
 * (`subject: GOOGLE_IMPERSONATE_SUBJECT`). Aquí no: la carpeta la comparte el
 * CLIENTE —que no es de nuestro Workspace— directamente con el correo de la
 * cuenta de servicio, así que la cuenta tiene que actuar COMO ELLA MISMA. Con
 * `subject` puesto, la petición iría en nombre de un usuario nuestro que no
 * tiene esa carpeta y saldría un 404 imposible de entender.
 *
 * Y por eso `isDriveConfigured()` es propia y no reutiliza `isGoogleConfigured()`:
 * aquella exige GOOGLE_CALENDAR_ID y GOOGLE_IMPERSONATE_SUBJECT, que aquí no
 * pintan nada. Un ERP sin agenda tiene que poder leer Drive igual.
 */

import { auth as googleAuth } from '@googleapis/calendar'
import { ESPERA_DESCARGA_MS, ESPERA_JSON_MS } from '@/lib/tiempos-espera'

/** Solo lectura. Es el scope más estrecho que permite listar y descargar */
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'

const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files'

/** Campos que se piden de cada fichero. `md5Checksum` es lo que evita reprocesar */
const CAMPOS = 'id,name,mimeType,modifiedTime,size,md5Checksum'

/** Una hoja de cálculo nativa de Google: no se descarga, se exporta */
export const MIME_GOOGLE_SHEET = 'application/vnd.google-apps.spreadsheet'
const MIME_CARPETA = 'application/vnd.google-apps.folder'
const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/**
 * Tope de la exportación de una hoja nativa. Lo pone Google, no nosotros: por
 * encima de 10 MB `/export` contesta un error y no hay forma de partirlo.
 */
const MAX_EXPORT_BYTES = 10 * 1024 * 1024

/** Un fichero de la carpeta, tal y como lo describe Drive */
export interface DriveFile {
  id: string
  name: string
  mimeType: string
  /** ISO. Es la huella de respaldo cuando el fichero no tiene md5 */
  modifiedTime: string | null
  /** Drive lo devuelve como texto; aquí ya va como número. null en las nativas */
  size: number | null
  /** Solo en ficheros binarios. Las hojas nativas de Google no lo tienen */
  md5Checksum: string | null
}

/** Un fichero ya descargado */
export interface DriveDownload {
  file: DriveFile
  bytes: ArrayBuffer
  /** true si hubo que exportar una hoja nativa en vez de descargar un binario */
  exportado: boolean
}

/**
 * Error de Drive con una frase que se pueda leer.
 *
 * `esDeCompartir` separa el fallo que pasa SIEMPRE la primera vez —la carpeta
 * no está compartida— de todo lo demás, para que la pantalla lo pueda destacar
 * en vez de enterrarlo entre errores de red.
 */
export class DriveError extends Error {
  readonly esDeCompartir: boolean
  readonly httpStatus: number | null

  constructor(message: string, options: { esDeCompartir?: boolean; httpStatus?: number } = {}) {
    super(message)
    this.name = 'DriveError'
    this.esDeCompartir = options.esDeCompartir ?? false
    this.httpStatus = options.httpStatus ?? null
  }
}

/* ------------------------------------------------------------------ */
/* Configuración y token                                               */
/* ------------------------------------------------------------------ */

/**
 * ¿Están las dos variables que hacen falta? Solo esas dos: ni el calendario ni
 * el usuario suplantado pintan nada aquí.
 */
export function isDriveConfigured(): boolean {
  return Boolean(process.env.GOOGLE_SA_CLIENT_EMAIL && process.env.GOOGLE_SA_PRIVATE_KEY)
}

/**
 * El correo de la cuenta de servicio, que es EL DATO que hay que darle a quien
 * comparte la carpeta. Se enseña en la pantalla y en los mensajes de error.
 *
 * No es un secreto: es una dirección de correo, y sin ella nadie puede compartir
 * nada. La clave privada, que sí lo es, no sale nunca de este fichero.
 */
export function driveServiceAccountEmail(): string | null {
  return process.env.GOOGLE_SA_CLIENT_EMAIL ?? null
}

/**
 * El cliente JWT, uno por proceso.
 *
 * Se memoriza porque `google-auth-library` cachea el access token DENTRO de la
 * instancia y lo renueva solo cuando caduca. Creando uno nuevo en cada llamada
 * se firmaría un JWT y se pediría un token a Google en cada fichero, que son
 * dos viajes de red por nada.
 */
let clienteJwt: InstanceType<typeof googleAuth.JWT> | null = null

function jwt(): InstanceType<typeof googleAuth.JWT> {
  if (clienteJwt) return clienteJwt

  const clientEmail = process.env.GOOGLE_SA_CLIENT_EMAIL
  // El replace de los \n es imprescindible y no es cosmético: la clave viaja en
  // una variable de entorno con los saltos de línea escapados, y sin deshacerlos
  // la firma del JWT falla con un error de OpenSSL que no menciona la causa.
  const privateKey = process.env.GOOGLE_SA_PRIVATE_KEY?.replace(/\\n/g, '\n')

  if (!clientEmail || !privateKey) {
    throw new DriveError(
      'Falta configurar la cuenta de servicio de Google en el servidor ' +
        '(GOOGLE_SA_CLIENT_EMAIL y GOOGLE_SA_PRIVATE_KEY). Sin ella no se puede leer ninguna carpeta de Drive.'
    )
  }

  clienteJwt = new googleAuth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: [DRIVE_SCOPE],
    // SIN `subject`: ver la cabecera del fichero. La cuenta actúa como ella
    // misma porque es a ELLA a quien el cliente comparte la carpeta.
  })
  return clienteJwt
}

async function token(): Promise<string> {
  try {
    const { token: valor } = await jwt().getAccessToken()
    if (!valor) {
      throw new DriveError(
        'Google no ha devuelto ningún token para la cuenta de servicio. Comprueba que GOOGLE_SA_PRIVATE_KEY es la clave completa y no está recortada.'
      )
    }
    return valor
  } catch (error) {
    if (error instanceof DriveError) throw error
    const detalle = error instanceof Error ? error.message : 'error desconocido'
    throw new DriveError(
      `No se ha podido autenticar la cuenta de servicio de Google (${detalle}). ` +
        'Suele ser la clave privada mal copiada en el entorno: tiene que incluir las líneas BEGIN y END.'
    )
  }
}

/* ------------------------------------------------------------------ */
/* Llamadas                                                            */
/* ------------------------------------------------------------------ */

/**
 * La frase que se enseña cuando Drive dice que no hay nada ahí.
 *
 * ES EL MENSAJE MÁS IMPORTANTE DE ESTE FICHERO. Drive contesta 404 tanto si la
 * carpeta no existe como si existe y no está compartida con nosotros —no
 * distingue, a propósito, para no filtrar qué carpetas hay—, y el 100% de las
 * veces que esto falla en el alta de un cliente es lo segundo. Un «404 Not
 * Found» deja a quien lo lee mirando el identificador; esta frase le dice
 * exactamente qué hacer y con qué dirección.
 */
function errorDeCompartir(folderId: string, status: number): DriveError {
  const correo = driveServiceAccountEmail() ?? '(la cuenta de servicio del ERP)'
  return new DriveError(
    'La carpeta de Google Drive no existe o no está compartida con la cuenta de servicio del ERP.\n' +
      `Ábrela en Drive, pulsa «Compartir» y añade este correo con permiso de Lector:\n\n    ${correo}\n\n` +
      `Identificador de carpeta configurado en el perfil: ${folderId}\n` +
      'Si la carpeta está en una unidad compartida, marca además esa casilla en el perfil.',
    { esDeCompartir: true, httpStatus: status }
  )
}

/** Convierte la respuesta de error de Drive en algo legible */
async function fallo(res: Response, folderId: string, queSeHacia: string): Promise<DriveError> {
  // 404 y 403 son el mismo problema visto desde dos sitios: no tenemos acceso.
  // Drive devuelve 404 cuando el recurso no es visible para quien pregunta, y
  // 403 cuando lo es pero el permiso no llega.
  if (res.status === 404 || res.status === 403) return errorDeCompartir(folderId, res.status)

  let detalle = ''
  try {
    const cuerpo = (await res.json()) as { error?: { message?: string } }
    detalle = cuerpo?.error?.message ?? ''
  } catch {
    // Un cuerpo que no es JSON (una página de error de un proxy) no aporta nada
  }

  if (res.status === 401) {
    return new DriveError(
      'Google ha rechazado las credenciales de la cuenta de servicio' +
        (detalle ? ` (${detalle})` : '') +
        '. Comprueba GOOGLE_SA_CLIENT_EMAIL y GOOGLE_SA_PRIVATE_KEY en el servidor.',
      { httpStatus: 401 }
    )
  }
  if (res.status === 429 || res.status >= 500) {
    return new DriveError(
      `Google Drive no está respondiendo bien ahora mismo (${res.status})${detalle ? `: ${detalle}` : ''}. ` +
        'Se volverá a intentar en el siguiente ciclo.',
      { httpStatus: res.status }
    )
  }

  return new DriveError(
    `No se ha podido ${queSeHacia} (${res.status})${detalle ? `: ${detalle}` : ''}.`,
    { httpStatus: res.status }
  )
}

/**
 * Los ficheros de una carpeta, del más reciente al más antiguo.
 *
 * Las subcarpetas se dejan fuera: aquí se busca UN fichero de datos, y una
 * subcarpeta que se colara acabaría intentando descargarse como si fuera un
 * Excel.
 */
export async function listarCarpeta(
  folderId: string,
  options: { unidadCompartida?: boolean; maxResultados?: number } = {}
): Promise<DriveFile[]> {
  const id = folderId.trim()
  if (!id) throw new DriveError('El perfil no tiene puesta la carpeta de Google Drive')

  const params = new URLSearchParams({
    q: `'${id.replace(/'/g, "\\'")}' in parents and trashed = false`,
    orderBy: 'modifiedTime desc',
    fields: `files(${CAMPOS})`,
    pageSize: String(Math.min(Math.max(options.maxResultados ?? 50, 1), 200)),
  })

  // Sin estos dos, una carpeta que vive en una unidad compartida devuelve CERO
  // ficheros y ningún error, que es el fallo más difícil de diagnosticar de
  // todos: la carpeta se ve bien en el navegador y la API dice que está vacía.
  if (options.unidadCompartida) {
    params.set('supportsAllDrives', 'true')
    params.set('includeItemsFromAllDrives', 'true')
    params.set('corpora', 'allDrives')
  }

  const res = await fetch(`${DRIVE_FILES}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${await token()}` },
    cache: 'no-store',
    // Tope de tiempo: listar una carpeta es una llamada de control con
    // respuesta pequeña. Ver lib/tiempos-espera.ts.
    signal: AbortSignal.timeout(ESPERA_JSON_MS),
  })

  if (!res.ok) throw await fallo(res, id, 'leer la carpeta de Google Drive')

  const cuerpo = (await res.json()) as { files?: unknown[] }
  const files = Array.isArray(cuerpo.files) ? cuerpo.files : []

  return files
    .map((f) => normalizar(f))
    .filter((f): f is DriveFile => f !== null && f.mimeType !== MIME_CARPETA)
}

function normalizar(raw: unknown): DriveFile | null {
  const f = raw as Record<string, unknown> | null
  if (!f || typeof f.id !== 'string' || typeof f.name !== 'string') return null

  // El tamaño llega como TEXTO («2097152»). Usarlo sin convertir hace que
  // cualquier comparación con un número sea una comparación de cadenas, y
  // '9000000' < '20000000' es falso.
  const size = typeof f.size === 'string' ? Number(f.size) : null

  return {
    id: f.id,
    name: f.name,
    mimeType: typeof f.mimeType === 'string' ? f.mimeType : '',
    modifiedTime: typeof f.modifiedTime === 'string' ? f.modifiedTime : null,
    size: size !== null && Number.isFinite(size) ? size : null,
    md5Checksum: typeof f.md5Checksum === 'string' ? f.md5Checksum : null,
  }
}

/**
 * Descarga un fichero de Drive.
 *
 * Una hoja NATIVA de Google no se puede descargar con `alt=media` —Drive
 * contesta «Only files with binary content can be downloaded»— y hay que
 * exportarla. Se exporta a .xlsx, que es lo que el motor ya sabe leer.
 */
export async function descargar(
  file: DriveFile,
  options: { unidadCompartida?: boolean; maxBytes?: number } = {}
): Promise<DriveDownload> {
  const esNativa = file.mimeType === MIME_GOOGLE_SHEET
  const maxBytes = options.maxBytes ?? MAX_EXPORT_BYTES

  // El tamaño se comprueba ANTES de pedir nada: descargar 300 MB para
  // descartarlos después se come la memoria del contenedor, que es la misma
  // que usa el resto del ERP.
  if (!esNativa && file.size !== null && file.size > maxBytes) {
    throw new DriveError(
      `El fichero «${file.name}» ocupa ${mb(file.size)} MB y el máximo son ${mb(maxBytes)} MB.`
    )
  }

  const params = new URLSearchParams()
  if (options.unidadCompartida) params.set('supportsAllDrives', 'true')

  let url: string
  if (esNativa) {
    params.set('mimeType', MIME_XLSX)
    url = `${DRIVE_FILES}/${encodeURIComponent(file.id)}/export?${params.toString()}`
  } else {
    params.set('alt', 'media')
    url = `${DRIVE_FILES}/${encodeURIComponent(file.id)}?${params.toString()}`
  }

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${await token()}` },
    cache: 'no-store',
    // Tope holgado: esto baja el contenido del fichero, no un JSON de
    // control. Ver lib/tiempos-espera.ts.
    signal: AbortSignal.timeout(ESPERA_DESCARGA_MS),
  })

  if (!res.ok) {
    if (esNativa && res.status === 403) {
      // La exportación de una hoja nativa tiene tope de 10 MB y por encima
      // contesta 403, que si no se explica se confunde con un problema de
      // permisos justo después de haber compartido la carpeta.
      throw new DriveError(
        `No se ha podido exportar la hoja «${file.name}». Las hojas de cálculo nativas de Google ` +
          `solo se pueden exportar hasta ${mb(MAX_EXPORT_BYTES)} MB; por encima de ahí el cliente ` +
          'tiene que dejar el fichero como .xlsx en vez de como hoja de Google.',
        { httpStatus: 403 }
      )
    }
    throw await fallo(res, file.id, `descargar «${file.name}»`)
  }

  const bytes = await res.arrayBuffer()

  if (bytes.byteLength === 0) {
    throw new DriveError(`El fichero «${file.name}» está vacío en Drive (0 bytes).`)
  }
  // Una hoja nativa no declara tamaño, así que su único control posible es este.
  if (bytes.byteLength > maxBytes) {
    throw new DriveError(
      `El fichero «${file.name}» ocupa ${mb(bytes.byteLength)} MB y el máximo son ${mb(maxBytes)} MB.`
    )
  }

  return { file, bytes, exportado: esNativa }
}

function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1)
}
