/**
 * NAVEGAR POR GOOGLE DRIVE — SOLO LECTURA.
 *
 * lib/google-drive.ts sabe hacer una cosa muy concreta y la hace bien: listar y
 * descargar de UNA carpeta que un cliente ha compartido con la cuenta de
 * servicio. Este fichero es lo otro: entrar, ver qué carpetas hay, bajar un
 * nivel y elegir. Y sobre todo, saber mirar en DOS SITIOS DISTINTOS.
 *
 *
 * ============ LAS DOS IDENTIDADES, QUE ES TODO EL ASUNTO ============
 *
 * La misma cuenta de servicio puede pedirle cosas a Drive de dos maneras, y NO
 * ven lo mismo. Confundirlas da un 404 imposible de entender, así que están
 * separadas en el tipo:
 *
 *   'servicio' — la cuenta actúa COMO ELLA MISMA. Ve lo que le hayan compartido
 *                a su dirección (GOOGLE_SA_CLIENT_EMAIL). Es lo que usa el
 *                conector de Drive desde el primer día y lo que hace funcionar
 *                el caso normal: el cliente, que no es de nuestro Workspace,
 *                comparte su carpeta con ese correo.
 *
 *   'propia'   — la cuenta actúa EN NOMBRE de un usuario nuestro
 *                (GOOGLE_IMPERSONATE_SUBJECT, delegación de dominio). Ve NUESTRO
 *                Drive: «Mi unidad», nuestras unidades compartidas. Es lo que
 *                permite el explorador que pidió el encargo: «que en una interfaz
 *                podamos ver nuestro drive y seleccionar la carpeta».
 *
 * EL ERROR QUE ESTO EVITA, Y QUE PASARÍA EL PRIMER DÍA: navegar por NUESTRO
 * Drive con la identidad delegada, elegir una carpeta, y que luego el ciclo
 * automático intente leerla con la identidad de servicio — que no la ve, porque
 * nadie se la ha compartido a ella. Sale un 404 y el mensaje dice «compártela con
 * la cuenta de servicio», que para una carpeta NUESTRA no tiene ningún sentido.
 * Por eso el perfil guarda con qué identidad se eligió la carpeta (el campo
 * `identidad` de origen_config) y lee siempre con la misma.
 *
 *
 * ============ LO QUE HAY QUE HACER FUERA DEL CÓDIGO ============
 *
 * La identidad 'propia' NO FUNCIONA hasta que alguien entre al panel de Google
 * Workspace y añada el scope de Drive a la delegación de dominio:
 *
 *     Admin › Seguridad › Control de acceso y datos › Controles de API
 *       › Delegación en todo el dominio › (el Client ID de la cuenta de servicio)
 *       › añadir  https://www.googleapis.com/auth/drive.readonly
 *
 * Hoy esa lista solo tiene el scope de calendario, que es para lo que se montó
 * la delegación. Sin ese paso, Google contesta `unauthorized_client` y el
 * mensaje NO menciona el scope, así que es imposible de adivinar: por eso el
 * error de aquí abajo lo dice con todas las letras.
 *
 *
 * ============ POR QUÉ NO HAY NINGÚN PAQUETE NUEVO ============
 *
 * El mismo razonamiento que lib/google-drive.ts, y por eso se importa lo mismo:
 * `@googleapis/calendar` re-exporta `google-auth-library` entera y su JWT mintea
 * un token para cualquier scope. Todo lo demás son llamadas REST con `fetch`.
 * El import se lee raro y está explicado aquí: se importa el AUTENTICADOR, no el
 * calendario.
 */

import { auth as googleAuth } from '@googleapis/calendar'
import { DriveError, type DriveFile } from '@/lib/google-drive'

/** Solo lectura. Es el scope más estrecho que permite listar y descargar */
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'
const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files'
const DRIVE_DRIVES = 'https://www.googleapis.com/drive/v3/drives'

const CAMPOS = 'id,name,mimeType,modifiedTime,size,md5Checksum'
const MIME_CARPETA = 'application/vnd.google-apps.folder'
const MIME_GOOGLE_SHEET = 'application/vnd.google-apps.spreadsheet'
const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** Cuál de las dos formas de mirar. Ver la cabecera */
export type IdentidadDrive = 'servicio' | 'propia'

/** Una carpeta de Drive */
export interface CarpetaDrive {
  id: string
  nombre: string
  /** true si es una unidad compartida y no una carpeta normal */
  esUnidad?: boolean
}

/* ------------------------------------------------------------------ */
/* Tokens                                                              */
/* ------------------------------------------------------------------ */

/**
 * Un cliente JWT por identidad, memorizado.
 *
 * `google-auth-library` cachea el access token DENTRO de la instancia y lo
 * renueva solo cuando caduca. Creando uno nuevo en cada llamada se firmaría un
 * JWT y se pediría un token a Google por cada carpeta que se abre, que en un
 * explorador son dos viajes de red por clic.
 */
const clientes: Partial<Record<IdentidadDrive, InstanceType<typeof googleAuth.JWT>>> = {}

export function delegacionConfigurada(): boolean {
  return Boolean(
    process.env.GOOGLE_SA_CLIENT_EMAIL &&
      process.env.GOOGLE_SA_PRIVATE_KEY &&
      process.env.GOOGLE_IMPERSONATE_SUBJECT
  )
}

export function usuarioDelegado(): string | null {
  return process.env.GOOGLE_IMPERSONATE_SUBJECT ?? null
}

export function correoCuentaServicio(): string | null {
  return process.env.GOOGLE_SA_CLIENT_EMAIL ?? null
}

function jwt(identidad: IdentidadDrive): InstanceType<typeof googleAuth.JWT> {
  const guardado = clientes[identidad]
  if (guardado) return guardado

  const clientEmail = process.env.GOOGLE_SA_CLIENT_EMAIL
  // El replace de los \n no es cosmético: la clave viaja en una variable de
  // entorno con los saltos escapados, y sin deshacerlos la firma del JWT falla
  // con un error de OpenSSL que no menciona la causa.
  const privateKey = process.env.GOOGLE_SA_PRIVATE_KEY?.replace(/\\n/g, '\n')
  const subject = process.env.GOOGLE_IMPERSONATE_SUBJECT

  if (!clientEmail || !privateKey) {
    throw new DriveError(
      'Falta configurar la cuenta de servicio de Google en el servidor ' +
        '(GOOGLE_SA_CLIENT_EMAIL y GOOGLE_SA_PRIVATE_KEY). Sin ella no se puede abrir ninguna carpeta de Drive.'
    )
  }
  if (identidad === 'propia' && !subject) {
    throw new DriveError(
      'Falta GOOGLE_IMPERSONATE_SUBJECT en el servidor. Es la cuenta de nuestro Workspace en cuyo nombre ' +
        'se navega nuestro Drive; sin ella solo se pueden usar las carpetas que los clientes comparten con ' +
        'la cuenta de servicio.'
    )
  }

  const cliente = new googleAuth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: [DRIVE_SCOPE],
    // La única diferencia entre las dos identidades, y la que lo cambia todo.
    ...(identidad === 'propia' ? { subject } : {}),
  })

  clientes[identidad] = cliente
  return cliente
}

async function token(identidad: IdentidadDrive): Promise<string> {
  try {
    const { token: valor } = await jwt(identidad).getAccessToken()
    if (!valor) {
      throw new DriveError(
        'Google no ha devuelto ningún token para la cuenta de servicio. Comprueba que ' +
          'GOOGLE_SA_PRIVATE_KEY es la clave completa y no está recortada.'
      )
    }
    return valor
  } catch (error) {
    if (error instanceof DriveError) throw error
    const detalle = error instanceof Error ? error.message : 'error desconocido'

    /**
     * EL FALLO QUE VA A PASAR LA PRIMERA VEZ, Y SU FRASE.
     *
     * `unauthorized_client` con `subject` puesto significa una sola cosa: la
     * delegación de dominio no tiene autorizado ESTE scope para el Client ID de
     * la cuenta de servicio. El mensaje de Google no menciona el scope ni el
     * panel, así que sin esta traducción es media tarde de buscar a ciegas.
     */
    if (identidad === 'propia' && /unauthorized_client|access_denied/i.test(detalle)) {
      return Promise.reject(
        new DriveError(
          'Google no deja a la cuenta de servicio actuar en nombre de ' +
            `${usuarioDelegado() ?? 'nuestro usuario'} para leer Drive.\n\n` +
            'Falta autorizar el permiso de Drive en la delegación de dominio. Se hace una vez, en:\n' +
            '    Admin de Google Workspace › Seguridad › Control de acceso y datos › Controles de API\n' +
            '    › Delegación en todo el dominio › (el Client ID de la cuenta de servicio) › Editar\n\n' +
            'y hay que añadir a la lista de permisos, tal cual:\n' +
            `    ${DRIVE_SCOPE}\n\n` +
            'Hoy esa lista solo tiene el de calendario. Mientras tanto, se pueden usar las carpetas que ' +
            'el cliente comparta con la cuenta de servicio: ' +
            `${correoCuentaServicio() ?? '(su correo)'}`,
          { esDeCompartir: true }
        )
      )
    }

    throw new DriveError(
      `No se ha podido autenticar la cuenta de servicio de Google (${detalle}). ` +
        'Suele ser la clave privada mal copiada en el entorno: tiene que incluir las líneas BEGIN y END.'
    )
  }
}

/* ------------------------------------------------------------------ */
/* Llamadas                                                            */
/* ------------------------------------------------------------------ */

async function pedir(
  identidad: IdentidadDrive,
  url: string,
  queSeHacia: string
): Promise<Response> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${await token(identidad)}` },
    cache: 'no-store',
  })
  if (res.ok) return res

  // 404 y 403 son el mismo problema visto desde dos sitios: no tenemos acceso.
  // Drive devuelve 404 cuando el recurso no es visible para quien pregunta —a
  // propósito, para no filtrar qué carpetas existen— y 403 cuando lo es pero el
  // permiso no llega.
  if (res.status === 404 || res.status === 403) {
    throw new DriveError(sinAcceso(identidad), { esDeCompartir: true, httpStatus: res.status })
  }

  let detalle = ''
  try {
    const cuerpo = (await res.json()) as { error?: { message?: string } }
    detalle = cuerpo?.error?.message ?? ''
  } catch {
    /* un cuerpo que no es JSON (la página de error de un proxy) no aporta nada */
  }

  if (res.status === 401) {
    throw new DriveError(
      'Google ha rechazado las credenciales de la cuenta de servicio' +
        (detalle ? ` (${detalle})` : '') +
        '. Comprueba GOOGLE_SA_CLIENT_EMAIL y GOOGLE_SA_PRIVATE_KEY en el servidor.',
      { httpStatus: 401 }
    )
  }
  if (res.status === 429 || res.status >= 500) {
    throw new DriveError(
      `Google Drive no está respondiendo bien ahora mismo (${res.status})${detalle ? `: ${detalle}` : ''}.`,
      { httpStatus: res.status }
    )
  }

  throw new DriveError(
    `No se ha podido ${queSeHacia} (${res.status})${detalle ? `: ${detalle}` : ''}.`,
    { httpStatus: res.status }
  )
}

/** La frase de «no llego», distinta según con qué ojos estemos mirando */
function sinAcceso(identidad: IdentidadDrive): string {
  if (identidad === 'propia') {
    return (
      `No se llega a esa carpeta de nuestro Drive con la cuenta ${usuarioDelegado() ?? '(la delegada)'}.\n` +
      'O la carpeta no existe, o es de otra persona del equipo y no está compartida con esa cuenta.\n' +
      'Si acabas de activar el permiso de Drive en la delegación de dominio, espera un par de minutos: ' +
      'Google tarda en propagarlo.'
    )
  }
  return (
    'La carpeta no existe o no está compartida con la cuenta de servicio del ERP.\n' +
    'Ábrela en Drive, pulsa «Compartir» y añade este correo con permiso de Lector:\n\n' +
    `    ${correoCuentaServicio() ?? '(la cuenta de servicio del ERP)'}\n\n` +
    'Si la carpeta está en una unidad compartida, marca además esa casilla en el perfil.'
  )
}

function parametrosComunes(unidadCompartida: boolean): URLSearchParams {
  const params = new URLSearchParams()
  // Sin estos tres, una carpeta que vive en una unidad compartida devuelve CERO
  // resultados y ningún error, que es el fallo más difícil de diagnosticar de
  // todos: la carpeta se ve bien en el navegador y la API dice que está vacía.
  if (unidadCompartida) {
    params.set('supportsAllDrives', 'true')
    params.set('includeItemsFromAllDrives', 'true')
    params.set('corpora', 'allDrives')
  }
  return params
}

/* ------------------------------------------------------------------ */
/* Lo que usa el explorador                                            */
/* ------------------------------------------------------------------ */

/**
 * Las subcarpetas de una carpeta, por nombre.
 *
 * `listarCarpeta()` de lib/google-drive.ts hace justo lo contrario —se quita las
 * carpetas de en medio, porque allí se busca UN fichero de datos— y por eso hace
 * falta esta.
 */
export async function listarSubcarpetas(
  identidad: IdentidadDrive,
  padre: string,
  options: { unidadCompartida?: boolean } = {}
): Promise<CarpetaDrive[]> {
  const params = parametrosComunes(options.unidadCompartida ?? false)
  params.set(
    'q',
    `'${escapar(padre)}' in parents and mimeType = '${MIME_CARPETA}' and trashed = false`
  )
  params.set('orderBy', 'name')
  params.set('fields', 'files(id,name)')
  params.set('pageSize', '200')

  const res = await pedir(identidad, `${DRIVE_FILES}?${params}`, 'abrir la carpeta de Drive')
  const cuerpo = (await res.json()) as { files?: { id?: string; name?: string }[] }

  return (cuerpo.files ?? [])
    .filter((f): f is { id: string; name: string } => typeof f.id === 'string' && typeof f.name === 'string')
    .map((f) => ({ id: f.id, nombre: f.name }))
}

/** Los ficheros (no carpetas) de una carpeta, del más reciente al más antiguo */
export async function listarFicheros(
  identidad: IdentidadDrive,
  padre: string,
  options: { unidadCompartida?: boolean } = {}
): Promise<DriveFile[]> {
  const params = parametrosComunes(options.unidadCompartida ?? false)
  params.set(
    'q',
    `'${escapar(padre)}' in parents and mimeType != '${MIME_CARPETA}' and trashed = false`
  )
  params.set('orderBy', 'modifiedTime desc')
  params.set('fields', `files(${CAMPOS})`)
  params.set('pageSize', '100')

  const res = await pedir(identidad, `${DRIVE_FILES}?${params}`, 'leer la carpeta de Drive')
  const cuerpo = (await res.json()) as { files?: unknown[] }

  return (Array.isArray(cuerpo.files) ? cuerpo.files : [])
    .map(normalizar)
    .filter((f): f is DriveFile => f !== null)
}

/**
 * Por dónde se empieza a navegar en cada identidad.
 *
 * En la nuestra: «Mi unidad» y las unidades compartidas del Workspace.
 * En la de servicio no hay «Mi unidad» que valga —la cuenta de servicio no tiene
 * Drive propio— así que lo que se enseña es lo que los CLIENTES le han
 * compartido, que es exactamente lo que interesa ver ahí.
 */
export async function raices(identidad: IdentidadDrive): Promise<CarpetaDrive[]> {
  if (identidad === 'servicio') {
    return compartidasConmigo(identidad)
  }

  const salida: CarpetaDrive[] = [{ id: 'root', nombre: 'Mi unidad' }]

  try {
    const res = await pedir(identidad, `${DRIVE_DRIVES}?pageSize=100&fields=drives(id,name)`, 'listar las unidades compartidas')
    const cuerpo = (await res.json()) as { drives?: { id?: string; name?: string }[] }
    for (const d of cuerpo.drives ?? []) {
      if (typeof d.id === 'string' && typeof d.name === 'string') {
        salida.push({ id: d.id, nombre: d.name, esUnidad: true })
      }
    }
  } catch {
    // Un Workspace sin unidades compartidas, o un plan que no las tiene,
    // contesta con error a drives.list. No es un fallo del explorador: «Mi
    // unidad» sigue estando y es donde va a estar la carpeta el 90% de las veces.
  }

  const compartidas = await compartidasConmigo(identidad).catch(() => [])
  return [...salida, ...compartidas]
}

/** Las carpetas que otros han compartido con esta identidad */
async function compartidasConmigo(identidad: IdentidadDrive): Promise<CarpetaDrive[]> {
  const params = new URLSearchParams({
    q: `sharedWithMe = true and mimeType = '${MIME_CARPETA}' and trashed = false`,
    orderBy: 'name',
    fields: 'files(id,name)',
    pageSize: '100',
  })

  const res = await pedir(identidad, `${DRIVE_FILES}?${params}`, 'listar las carpetas compartidas')
  const cuerpo = (await res.json()) as { files?: { id?: string; name?: string }[] }

  return (cuerpo.files ?? [])
    .filter((f): f is { id: string; name: string } => typeof f.id === 'string' && typeof f.name === 'string')
    .map((f) => ({ id: f.id, nombre: f.name }))
}

/**
 * La miga de pan: de la carpeta actual hasta arriba del todo.
 *
 * Se sube por `parents`, una llamada por nivel. Se podría guardar la ruta al
 * navegar y ahorrárselas, pero entonces reabrir un perfil ya configurado
 * enseñaría un identificador pelado en vez de «Mi unidad › Clientes › ShoesF»,
 * que es justo cuando hace falta saber dónde está apuntando esto.
 *
 * Con tope de niveles: un `parents` en bucle —que no debería pasar, pero es un
 * dato que viene de fuera— colgaría la petición para siempre.
 */
export async function migaDePan(
  identidad: IdentidadDrive,
  carpetaId: string,
  options: { unidadCompartida?: boolean } = {}
): Promise<{ id: string; nombre: string }[]> {
  const migas: { id: string; nombre: string }[] = []
  let actual: string | null = carpetaId

  for (let nivel = 0; nivel < 12 && actual; nivel += 1) {
    const params = parametrosComunes(options.unidadCompartida ?? false)
    params.set('fields', 'id,name,parents')

    let datos: { id?: string; name?: string; parents?: string[] }
    try {
      const res = await pedir(identidad, `${DRIVE_FILES}/${encodeURIComponent(actual)}?${params}`, 'leer la carpeta')
      datos = (await res.json()) as typeof datos
    } catch {
      // Se para y se devuelve lo que haya. Una miga de pan incompleta es un
      // detalle; que el explorador no abra la carpeta por no poder dibujarla
      // sería el problema de verdad.
      break
    }

    migas.unshift({ id: datos.id ?? actual, nombre: datos.name ?? 'Carpeta' })
    const padre = datos.parents?.[0]
    // El padre del raíz no se puede leer y devolvería un 404: se para aquí.
    actual = padre && padre !== actual ? padre : null
  }

  return migas
}

/**
 * Descarga un fichero con la identidad que toque.
 *
 * Una hoja NATIVA de Google no se puede descargar con `alt=media` —Drive
 * contesta «Only files with binary content can be downloaded»— y hay que
 * exportarla. Se exporta a .xlsx, que es lo que el motor ya sabe leer.
 */
export async function descargarConIdentidad(
  identidad: IdentidadDrive,
  file: DriveFile,
  options: { unidadCompartida?: boolean; maxBytes: number }
): Promise<{ bytes: ArrayBuffer; exportado: boolean }> {
  const esNativa = file.mimeType === MIME_GOOGLE_SHEET

  // El tamaño se comprueba ANTES de pedir nada: descargar 300 MB para
  // descartarlos después se come la memoria del contenedor.
  if (!esNativa && file.size !== null && file.size > options.maxBytes) {
    throw new DriveError(
      `El fichero «${file.name}» ocupa ${mb(file.size)} MB y el máximo son ${mb(options.maxBytes)} MB.`
    )
  }

  const params = new URLSearchParams()
  if (options.unidadCompartida) params.set('supportsAllDrives', 'true')

  let url: string
  if (esNativa) {
    params.set('mimeType', MIME_XLSX)
    url = `${DRIVE_FILES}/${encodeURIComponent(file.id)}/export?${params}`
  } else {
    params.set('alt', 'media')
    url = `${DRIVE_FILES}/${encodeURIComponent(file.id)}?${params}`
  }

  const res = await pedir(identidad, url, `descargar «${file.name}»`)
  const bytes = await res.arrayBuffer()

  if (bytes.byteLength === 0) {
    throw new DriveError(`El fichero «${file.name}» está vacío en Drive (0 bytes).`)
  }
  // Una hoja nativa no declara tamaño, así que su único control posible es este.
  if (bytes.byteLength > options.maxBytes) {
    throw new DriveError(
      `El fichero «${file.name}» ocupa ${mb(bytes.byteLength)} MB y el máximo son ${mb(options.maxBytes)} MB.`
    )
  }

  return { bytes, exportado: esNativa }
}

/* ------------------------------------------------------------------ */

function normalizar(raw: unknown): DriveFile | null {
  const f = raw as Record<string, unknown> | null
  if (!f || typeof f.id !== 'string' || typeof f.name !== 'string') return null

  // El tamaño llega como TEXTO («2097152»). Sin convertir, cualquier comparación
  // con un número es una comparación de cadenas, y '9000000' < '20000000' es
  // falso.
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

/** Una comilla en un identificador rompería la consulta `q` de Drive */
function escapar(id: string): string {
  return id.trim().replace(/'/g, "\\'")
}

function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1)
}
