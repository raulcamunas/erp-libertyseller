/**
 * LOS ERRORES DE AMAZON, TRADUCIDOS A ALGO QUE SIRVA
 * ==================================================
 * Un JSON crudo en pantalla no le sirve a nadie. Cuando algo falla, quien está
 * delante necesita saber DOS cosas: si el problema es suyo (un precio que
 * Amazon no acepta), del cliente (nos ha quitado el acceso) o nuestro (un bug),
 * y qué tiene que hacer a continuación. Este fichero es el único sitio donde se
 * decide eso.
 *
 * LO QUE MÁS SE LE ESCAPA A LA GENTE, Y ESTÁ AQUÍ DENTRO
 * -----------------------------------------------------
 * Amazon usa TRES canales distintos para decir que algo ha ido mal:
 *
 *   403                 -> permisos. El rol que falta, el token revocado, la
 *                          región equivocada, la cuenta suspendida. NO se
 *                          reintenta: da igual cuántas veces se pida.
 *   400                 -> la petición está mal montada. Es un bug NUESTRO.
 *                          Tampoco se reintenta, solo gasta cupo.
 *   200 + status INVALID -> EL DATO no vale. Un precio fuera de los límites que
 *                          Amazon permite para ese ASIN devuelve DOSCIENTOS,
 *                          no un 4xx. Un código que solo mire `response.ok`
 *                          dará por bueno un cambio que Amazon ha rechazado, y
 *                          la pantalla enseñará el precio nuevo mientras la
 *                          tienda sigue con el viejo.
 *
 * Y dos más que sí se reintentan: 429 (cupo agotado) y 5xx.
 *
 * Este fichero es PURO: no importa nada. Se puede probar con un objeto a mano.
 */

import type { AmazonRegion } from '@/lib/types/amazon'

/**
 * De qué tipo es el fallo. Es lo que decide qué hace el resto del código, así
 * que va antes que el mensaje:
 *
 *   'auth'          el token ya no vale -> hay que pedir al cliente que vuelva
 *                   a autorizar. La conexión se marca como revocada/caducada.
 *   'permisos'      falta un rol o la cuenta está suspendida -> parar y avisar.
 *   'limite'        se agotó el cupo -> esperar y reintentar.
 *   'servidor'      fallo de Amazon -> esperar y reintentar.
 *   'red'           no llegamos a Amazon -> reintentar si la operación lo
 *                   admite.
 *   'peticion'      bug nuestro -> registrar y no reintentar.
 *   'no_encontrado' ese SKU ya no existe en esa tienda.
 *   'datos'         el valor enviado no vale (el 200 con INVALID).
 *   'config'        falta una variable de entorno nuestra. Ni siquiera se ha
 *                   llegado a llamar a Amazon.
 */
export type AmazonErrorKind =
  | 'auth'
  | 'permisos'
  | 'limite'
  | 'servidor'
  | 'red'
  | 'peticion'
  | 'no_encontrado'
  | 'datos'
  | 'config'

/** Un issue de Amazon, tal cual viene en la respuesta */
export interface AmazonIssue {
  code?: string
  message?: string
  severity?: 'ERROR' | 'WARNING' | 'INFO' | string
  attributeNames?: string[]
  categories?: string[]
  marketplaceIds?: string[]
}

/**
 * El error que lanza todo lo de lib/amazon.
 *
 * `message` es el técnico, para el log. `humanMessage` es el que se enseña en
 * pantalla y el que se guarda en amazon_submissions.error_message: en español,
 * sin siglas y diciendo qué hacer.
 *
 * NUNCA lleva dentro el token, ni el client_secret, ni ninguna cabecera de
 * autorización. Los mensajes de error se copian, se pegan en un chat y acaban
 * en sitios que nadie controla.
 */
export class AmazonApiError extends Error {
  readonly kind: AmazonErrorKind
  readonly humanMessage: string
  readonly httpStatus: number | null
  /** x-amzn-RequestId: lo único que sirve para abrir un caso con soporte */
  readonly requestId: string | null
  /** El código de Amazon (MD1000, InvalidInput, QuotaExceeded...) */
  readonly code: string | null
  /** ¿Tiene sentido volver a intentarlo? */
  readonly retryable: boolean
  readonly issues: AmazonIssue[]
  /**
   * CUÁNTAS PETICIONES SALIERON DE VERDAD antes de rendirse (contando la
   * primera). Lo rellena spApiRequest al lanzar.
   *
   * No es un adorno del log: acaba en amazon_submissions.attempts, y ese
   * registro existe para reconstruir qué pasó el día que un cliente reclame.
   * Con un 1 fijo, un cambio que salió tres veces hacia la tienda de alguien
   * quedaba indistinguible de uno que salió una sola vez.
   */
  readonly attempts: number

  constructor(params: {
    kind: AmazonErrorKind
    message: string
    humanMessage: string
    httpStatus?: number | null
    requestId?: string | null
    code?: string | null
    retryable?: boolean
    issues?: AmazonIssue[]
    attempts?: number
  }) {
    super(params.message)
    this.name = 'AmazonApiError'
    this.kind = params.kind
    this.humanMessage = params.humanMessage
    this.httpStatus = params.httpStatus ?? null
    this.requestId = params.requestId ?? null
    this.code = params.code ?? null
    this.retryable = params.retryable ?? false
    this.issues = params.issues ?? []
    this.attempts = params.attempts ?? 1
  }

  /**
   * El mismo error con el número de intentos puesto.
   *
   * Devuelve una copia en vez de mutar `attempts` porque los campos son
   * readonly a propósito: un error que cambia por debajo mientras sube por la
   * pila es imposible de seguir.
   */
  withAttempts(attempts: number): AmazonApiError {
    if (attempts === this.attempts) return this
    return new AmazonApiError({
      kind: this.kind,
      message: this.message,
      humanMessage: this.humanMessage,
      httpStatus: this.httpStatus,
      requestId: this.requestId,
      code: this.code,
      retryable: this.retryable,
      issues: this.issues,
      attempts,
    })
  }
}

/** Mensaje para pantalla de cualquier cosa que se haya lanzado */
export function humanMessageOf(error: unknown): string {
  if (error instanceof AmazonApiError) return error.humanMessage
  if (error instanceof Error && error.message) return error.message
  return 'Ha fallado la llamada a Amazon y no ha dicho por qué. Vuelve a intentarlo dentro de un rato.'
}

/** ¿Merece la pena reintentar esto? */
export function isRetryable(error: unknown): boolean {
  return error instanceof AmazonApiError && error.retryable
}

/* ------------------------------------------------------------------ */
/* Errores del flujo de autorización                                   */
/* ------------------------------------------------------------------ */

/**
 * Los códigos que devuelve Amazon cuando falla el consentimiento. Salen en la
 * URL de vuelta, no en una respuesta de la API, así que hay que traducirlos
 * aparte: quien los va a leer es la persona que estaba conectando al cliente,
 * a veces con el cliente al teléfono.
 */
export const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  MD1000:
    'Amazon ha rechazado la autorización porque la aplicación está en borrador y el enlace no llevaba la marca de borrador. Es un fallo nuestro de configuración: revisa AMAZON_APP_DRAFT.',
  MD5101:
    'La dirección de vuelta no coincide con ninguna de las registradas en el portal de Amazon. Tienen que ser idénticas, carácter a carácter.',
  MD5110:
    'La dirección de vuelta lleva un fragmento (#) y Amazon no lo admite. Hay que quitarlo del portal.',
  MD9100:
    'La aplicación no tiene configuradas las dos direcciones (la de inicio y la de vuelta) en el portal de Amazon.',
  CONSENT_LIMIT_REACHED:
    'Se ha agotado el número de clientes que puede conectar esta aplicación. Mientras no esté publicada en el Appstore de Amazon el tope son 25; para pasar de ahí hay que publicarla.',
  SPDC8143:
    'El cliente ha entrado con un usuario secundario de su cuenta. Tiene que autorizar desde el usuario principal de Seller Central.',
}

export function oauthErrorMessage(code: string | null | undefined): string {
  if (!code) {
    return 'Amazon ha cancelado la autorización sin decir por qué. Pídele al cliente que vuelva a intentarlo desde el enlace.'
  }
  return (
    OAUTH_ERROR_MESSAGES[code] ??
    `Amazon ha rechazado la autorización con el código ${code}. Búscalo en la documentación de errores de autorización para saber qué falta.`
  )
}

/* ------------------------------------------------------------------ */
/* Traducción de una respuesta HTTP                                    */
/* ------------------------------------------------------------------ */

/** El cuerpo de error de la SP-API: { errors: [{ code, message, details }] } */
interface SpApiErrorBody {
  errors?: Array<{ code?: string; message?: string; details?: string }>
}

/**
 * Convierte una respuesta que no ha ido bien en un AmazonApiError con su tipo,
 * su mensaje en español y su decisión de reintento.
 *
 * `region` y `operation` entran para poder decir cosas útiles: un 403 en una
 * conexión europea llamando a un endpoint de Norteamérica tiene una explicación
 * muy concreta y muy fácil de no ver.
 */
export function describeHttpError(params: {
  httpStatus: number
  body: unknown
  requestId: string | null
  operation: string
  region: AmazonRegion
}): AmazonApiError {
  const { httpStatus, body, requestId, operation, region } = params

  const errors = (body as SpApiErrorBody | null)?.errors ?? []
  const first = errors[0]
  const code = first?.code ?? null
  const detail = [first?.message, first?.details].filter(Boolean).join(' — ') || null

  const tecnico = `${operation} ha devuelto ${httpStatus}${code ? ` (${code})` : ''}${
    detail ? `: ${detail}` : ''
  }`

  // ---- 401 y 403: permisos y tokens ----
  // Van juntos porque Amazon usa 403 para casi todo lo de autorización, pero
  // hay que separarlos en el mensaje: «vuelve a autorizar» y «falta un rol» se
  // arreglan de formas muy distintas, y confundirlos hace que se le pida al
  // cliente que repita un consentimiento que no va a servir de nada.
  if (httpStatus === 401 || httpStatus === 403) {
    const texto = `${code ?? ''} ${detail ?? ''}`.toLowerCase()

    if (texto.includes('expired') || texto.includes('revoke') || texto.includes('invalid_grant')) {
      return new AmazonApiError({
        kind: 'auth',
        message: tecnico,
        humanMessage:
          'La autorización de este cliente ya no vale: o la ha retirado desde su Seller Central, o ha pasado el año que dura. Hay que pedirle que vuelva a autorizar.',
        httpStatus,
        requestId,
        code,
      })
    }

    if (texto.includes('role') || texto.includes('permission') || texto.includes('unauthorized')) {
      return new AmazonApiError({
        kind: 'permisos',
        message: tecnico,
        humanMessage:
          'Amazon dice que a la aplicación le falta el permiso necesario para esta operación. Revisa los roles concedidos en el portal de desarrollador. Ojo: añadir un rol invalida todas las autorizaciones y obliga a que TODOS los clientes vuelvan a autorizar.',
        httpStatus,
        requestId,
        code,
      })
    }

    return new AmazonApiError({
      kind: 'permisos',
      message: tecnico,
      humanMessage:
        `Amazon ha denegado el acceso a la tienda de este cliente (${AMAZON_REGION_HINT[region]}). ` +
        'Las causas habituales son: la cuenta del cliente está suspendida, la autorización se ha retirado, o se está llamando al endpoint de otra región.',
      httpStatus,
      requestId,
      code,
    })
  }

  // ---- 404: el SKU ya no está ----
  if (httpStatus === 404) {
    return new AmazonApiError({
      kind: 'no_encontrado',
      message: tecnico,
      humanMessage:
        'Ese SKU ya no existe en la tienda del cliente. Puede que lo haya borrado él, o que el catálogo que tenemos en pantalla esté viejo: refresca antes de volver a intentarlo.',
      httpStatus,
      requestId,
      code,
    })
  }

  // ---- 429: cupo ----
  if (httpStatus === 429) {
    return new AmazonApiError({
      kind: 'limite',
      message: tecnico,
      humanMessage:
        'Amazon ha cortado por exceso de peticiones. Se reintenta solo, esperando cada vez un poco más. Si se repite mucho, hay demasiadas cosas pasando a la vez contra la misma cuenta.',
      httpStatus,
      requestId,
      code,
      retryable: true,
    })
  }

  // ---- 5xx: es de ellos ----
  if (httpStatus >= 500) {
    return new AmazonApiError({
      kind: 'servidor',
      message: tecnico,
      humanMessage:
        'Amazon está fallando por su lado. Se reintenta solo; si sigue, no hay nada que arreglar aquí, hay que esperar.',
      httpStatus,
      requestId,
      code,
      retryable: true,
    })
  }

  // ---- 400 y demás: bug nuestro ----
  // No se reintenta. Un 400 es determinista: volver a mandarlo solo gasta cupo
  // y retrasa el resto de la cola.
  return new AmazonApiError({
    kind: 'peticion',
    message: tecnico,
    humanMessage:
      'La petición que hemos montado no le vale a Amazon' +
      (detail ? `: ${detail}` : '') +
      '. Es un fallo del ERP, no del dato ni del cliente. Queda registrado con su identificador de petición.',
    httpStatus,
    requestId,
    code,
  })
}

/** Coletilla por región para el mensaje de 403, que es donde una región
    equivocada se disfraza de problema de permisos */
const AMAZON_REGION_HINT: Record<AmazonRegion, string> = {
  eu: 'Europa',
  na: 'Norteamérica',
  fe: 'Extremo Oriente',
}

/**
 * Error de red: ni siquiera hubo respuesta.
 *
 * Se marca como reintentable, pero OJO: quien reintenta tiene que saber que la
 * petición PUDO HABER LLEGADO. Para los cambios de precio y stock eso da igual
 * —son valores absolutos, aplicarlos dos veces deja el mismo resultado—, pero
 * esa decisión no se toma aquí, se toma en sp-api.ts comprobando que todas las
 * operaciones del PATCH son de reemplazo.
 */
export function describeNetworkError(error: unknown, operation: string): AmazonApiError {
  const detalle = error instanceof Error ? error.message : String(error)
  return new AmazonApiError({
    kind: 'red',
    message: `${operation}: no se ha podido llegar a Amazon (${detalle})`,
    humanMessage:
      'No se ha podido conectar con Amazon. Puede ser un corte de red momentáneo; se reintenta solo.',
    retryable: true,
  })
}

/* ------------------------------------------------------------------ */
/* Traducción de los issues (el 200 con INVALID)                       */
/* ------------------------------------------------------------------ */

/**
 * Las categorías de issue que documenta Amazon, en español. Las dos que van a
 * salir de verdad aquí son las de precio: Amazon tiene límites por ASIN y
 * rechaza lo que se salga, que es exactamente el caso del 1499 en vez de 14,99.
 */
const ISSUE_CATEGORY_MESSAGES: Record<string, string> = {
  INVALID_PRICE:
    'Amazon no acepta ese precio para este producto. Suele ser porque se sale de los límites que tiene puestos para ese ASIN (demasiado alto o demasiado bajo). Comprueba que no se ha colado un decimal.',
  MISSING_PRICE: 'El listing se ha quedado sin precio. Hay que ponerle uno.',
  INVALID_ATTRIBUTE: 'Uno de los datos enviados no vale para este tipo de producto.',
  MISSING_ATTRIBUTE: 'Falta un dato que Amazon exige para este tipo de producto.',
  INVALID_IMAGE: 'Hay un problema con una imagen del listing.',
  MISSING_IMAGE: 'Al listing le falta una imagen.',
  DUPLICATE: 'Amazon cree que este producto está duplicado con otro ASIN.',
  QUALIFICATION_REQUIRED:
    'Este producto necesita una aprobación de Amazon que el cliente todavía no tiene.',
}

/**
 * Convierte los issues de Amazon en una frase que se pueda leer.
 *
 * Solo mira los de severidad ERROR para el mensaje principal: los WARNING no
 * impiden que el cambio se aplique y meterlos en el mismo saco haría que todo
 * pareciera roto.
 */
export function describeIssues(issues: AmazonIssue[]): string {
  const errores = issues.filter((i) => (i.severity ?? 'ERROR') === 'ERROR')
  const lista = errores.length > 0 ? errores : issues
  if (lista.length === 0) {
    return 'Amazon ha rechazado el cambio sin decir por qué.'
  }

  const partes = lista.map((issue) => {
    const categoria = (issue.categories ?? []).find((c) => ISSUE_CATEGORY_MESSAGES[c])
    if (categoria) return ISSUE_CATEGORY_MESSAGES[categoria]
    // Sin categoría conocida se usa el mensaje de Amazon tal cual. Viene en el
    // idioma que se pida con issueLocale, y nosotros pedimos es_ES.
    return issue.message ?? `Amazon ha devuelto el problema ${issue.code ?? 'sin código'}.`
  })

  // Sin duplicados: cuarenta SKU rechazados por lo mismo no son cuarenta frases.
  return Array.from(new Set(partes)).join(' ')
}

/** ¿Hay algún issue que impida que el cambio se aplique? */
export function hasBlockingIssues(issues: AmazonIssue[]): boolean {
  return issues.some((i) => (i.severity ?? 'ERROR') === 'ERROR')
}

/* ------------------------------------------------------------------ */
/* Errores de configuración nuestra                                    */
/* ------------------------------------------------------------------ */

/**
 * Falta una variable de entorno. Se separa del resto porque no es un fallo de
 * Amazon ni del cliente: ni siquiera se ha llegado a llamar. El mensaje dice
 * qué variable y qué contiene, nunca su valor.
 */
export function missingConfig(variable: string, paraQue: string): AmazonApiError {
  return new AmazonApiError({
    kind: 'config',
    message: `Falta la variable de entorno ${variable}`,
    humanMessage: `Falta configurar ${variable} en el servidor (${paraQue}). Hasta que esté, el módulo de Amazon no puede funcionar.`,
  })
}
