import { AMAZON_REGIONS, type AmazonRegion } from '@/lib/types/amazon'
import { ESPERA_JSON_MS } from '@/lib/tiempos-espera'
import { AmazonApiError, missingConfig } from './errors'
import { tokenFingerprint } from './crypto'

/**
 * LOGIN WITH AMAZON: LAS LLAVES
 * =============================
 * SOLO SERVIDOR. Aquí se leen el client_id y el client_secret de la aplicación
 * y se manejan los tokens de los clientes. Nada de esto puede acabar en el
 * navegador.
 *
 * HAY DOS TOKENS Y CONFUNDIRLOS ES EL ERROR CLÁSICO:
 *
 *   refresh_token  Lo devuelve Amazon UNA vez, cuando el cliente autoriza. Dura
 *                  un año. Es la llave de su tienda. Se guarda cifrado en la
 *                  base (amazon_connections.refresh_token_enc) y no sale de
 *                  ahí más que para pedir lo siguiente.
 *
 *   access_token   Dura UNA HORA. Es lo que viaja en cada llamada a la API. Se
 *                  pide cuando hace falta y se guarda EN MEMORIA, nunca en la
 *                  base: escribir en Postgres algo que caduca en una hora solo
 *                  añade una fila que hay que limpiar y un sitio más del que
 *                  puede filtrarse.
 *
 * Y OTRA COSA QUE YA NO HACE FALTA: FIRMAR CON AWS.
 * Desde el 2 de octubre de 2023 la SP-API dejó de exigir credenciales de IAM y
 * firma SigV4. Basta el access token, en la cabecera `x-amz-access-token`. Por
 * eso este proyecto NO tiene el SDK de AWS ni ninguna variable de AWS: no hacen
 * falta, y meterlos sería código muerto que alguien intentaría mantener.
 */

const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token'

/**
 * ¿ESTÁ LA APLICACIÓN EN BORRADOR EN EL PORTAL DE AMAZON?
 *
 * ESTO EXISTE POR UNA RAZÓN Y HAY QUE QUITARLO EL DÍA QUE SE PUBLIQUE.
 *
 * Mientras la aplicación figure en estado BORRADOR, la URL de consentimiento
 * TIENE que llevar `version=beta`. Sin ese parámetro Amazon rechaza el flujo
 * con el error MD1000 («autorizar una aplicación en borrador por el flujo de
 * producción»), y el cliente ve un error sin explicación en mitad del proceso.
 *
 * En cuanto la aplicación esté listada en el Appstore, este parámetro SOBRA y
 * hay que dejar de mandarlo. Se controla con la variable de entorno
 * AMAZON_APP_DRAFT para poder cambiarlo sin desplegar:
 *
 *   AMAZON_APP_DRAFT=false   -> aplicación publicada, no se manda version=beta
 *   cualquier otra cosa      -> se manda
 *
 * Por defecto TRUE. Es la opción segura: si nadie configura nada, el flujo
 * sigue funcionando con la aplicación en borrador, que es la situación de hoy.
 * Al revés —por defecto false— el módulo dejaría de funcionar en cuanto alguien
 * despliegue en un servidor nuevo sin esa variable, y el síntoma (un MD1000
 * delante de un cliente) no lleva a nadie hasta aquí.
 */
export function appIsDraft(): boolean {
  const raw = (process.env.AMAZON_APP_DRAFT ?? '').trim().toLowerCase()
  return !(raw === 'false' || raw === '0' || raw === 'no')
}

export interface LwaConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  /**
   * El identificador de la APLICACIÓN en el portal (amzn1.sellerapps.app.…).
   * NO es el client_id de LWA (amzn1.application-oa2-client.…), que es otra
   * cosa distinta y es el error que se comete la primera vez: la URL de
   * consentimiento quiere el de la aplicación, y con el de LWA Amazon contesta
   * que la aplicación no existe.
   */
  applicationId: string
}

/**
 * Lee la configuración del entorno.
 *
 * En cada llamada, no al importar el módulo: capturarla arriba haría que
 * `next build` exigiera estas variables en tiempo de compilación —donde no
 * existen— y tumbaría el despliegue entero.
 *
 * Los valores NO se registran ni se devuelven en ningún mensaje de error, solo
 * los nombres de las variables que falten.
 */
export function lwaConfig(): LwaConfig {
  const clientId = process.env.AMAZON_LWA_CLIENT_ID
  const clientSecret = process.env.AMAZON_LWA_CLIENT_SECRET
  const redirectUri = process.env.AMAZON_OAUTH_REDIRECT_URI
  const applicationId = process.env.AMAZON_APP_ID

  if (!clientId) throw missingConfig('AMAZON_LWA_CLIENT_ID', 'credenciales de la aplicación')
  if (!clientSecret) throw missingConfig('AMAZON_LWA_CLIENT_SECRET', 'credenciales de la aplicación')
  if (!redirectUri) {
    throw missingConfig(
      'AMAZON_OAUTH_REDIRECT_URI',
      'la dirección a la que Amazon devuelve al cliente; tiene que ser idéntica a la registrada en el portal'
    )
  }
  if (!applicationId) {
    throw missingConfig(
      'AMAZON_APP_ID',
      'el identificador de la aplicación en el portal de Amazon, el que empieza por amzn1.sellerapps.app. No es el client_id de LWA'
    )
  }

  return { clientId, clientSecret, redirectUri, applicationId }
}

/** ¿Está todo lo necesario configurado? Para que la pantalla lo diga en vez de romperse */
export function isAmazonConfigured(): boolean {
  try {
    lwaConfig()
    return true
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ */
/* La URL a la que se manda al cliente                                 */
/* ------------------------------------------------------------------ */

/**
 * Construye la URL de consentimiento: el enlace que se le pasa al cliente para
 * que autorice.
 *
 * El `state` es OBLIGATORIO y no es burocracia: es lo único que conecta la
 * vuelta de Amazon con el cliente del ERP que inició el flujo —Amazon no nos
 * devuelve nada nuestro— y a la vez la defensa contra CSRF que exige la
 * documentación. Se genera uno por petición, se guarda en
 * amazon_oauth_states, y al volver se comprueba; si no cuadra, se rechaza.
 */
export function buildConsentUrl(params: {
  region: AmazonRegion
  state: string
  /** Se manda solo si hace falta. Si se manda, tiene que coincidir EXACTAMENTE
      con una de las registradas en el portal, o Amazon contesta MD5101 */
  redirectUri?: string | null
}): string {
  const { applicationId } = lwaConfig()
  const region = AMAZON_REGIONS[params.region]

  if (!region.sellerCentralUrl) {
    throw new AmazonApiError({
      kind: 'config',
      message: `No hay URL de Seller Central para la región ${params.region}`,
      humanMessage: `Todavía no está configurada la dirección de autorización de ${region.label}. Hoy solo se conectan clientes de Europa y de Estados Unidos.`,
    })
  }

  const url = new URL('/apps/authorize/consent', region.sellerCentralUrl)
  url.searchParams.set('application_id', applicationId)
  url.searchParams.set('state', params.state)
  if (params.redirectUri) url.searchParams.set('redirect_uri', params.redirectUri)
  // Ver appIsDraft(): sin esto, MD1000.
  if (appIsDraft()) url.searchParams.set('version', 'beta')

  return url.toString()
}

/* ------------------------------------------------------------------ */
/* Canje del código y refresco del access token                        */
/* ------------------------------------------------------------------ */

interface LwaTokenResponse {
  access_token?: string
  refresh_token?: string
  token_type?: string
  expires_in?: number
  error?: string
  error_description?: string
}

/**
 * Llamada al endpoint de tokens de LWA.
 *
 * Los parámetros van como formulario (application/x-www-form-urlencoded), que
 * es lo que espera, y el client_secret viaja en el cuerpo. Ni el cuerpo ni la
 * respuesta se registran en ningún sitio.
 */
async function lwaPost(body: Record<string, string>, contexto: string): Promise<LwaTokenResponse> {
  let response: Response
  try {
    response = await fetch(LWA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: new URLSearchParams(body).toString(),
      // Sin caché: es un intercambio de credenciales, y una respuesta cacheada
      // aquí sería un token de otro.
      cache: 'no-store',
      // Tope de tiempo: sin él este canje se quedaba colgado ~300 s por intento
      // si Login with Amazon acepta la conexión y no contesta, y sin token no
      // avanza NINGUNA llamada a la SP-API. Ver lib/tiempos-espera.ts.
      signal: AbortSignal.timeout(ESPERA_JSON_MS),
    })
  } catch (error) {
    throw new AmazonApiError({
      kind: 'red',
      message: `${contexto}: no se ha podido llegar a Login with Amazon (${
        error instanceof Error ? error.message : String(error)
      })`,
      humanMessage: 'No se ha podido conectar con Amazon para renovar el acceso. Vuelve a intentarlo.',
      retryable: true,
    })
  }

  const data = (await response.json().catch(() => ({}))) as LwaTokenResponse

  if (!response.ok || data.error) {
    throw describeLwaError(data, response.status, contexto)
  }
  return data
}

/**
 * Traduce los errores de LWA, que NO son los de la SP-API: aquí no hay
 * `errors[]`, hay `error` y `error_description`.
 *
 * El que importa es `invalid_grant`: significa que el refresh token ya no vale
 * —el cliente ha revocado el acceso o ha pasado el año— y es lo que tiene que
 * marcar la conexión como revocada en vez de reintentar para siempre.
 */
function describeLwaError(
  data: LwaTokenResponse,
  httpStatus: number,
  contexto: string
): AmazonApiError {
  const code = data.error ?? null
  const tecnico = `${contexto}: LWA ${httpStatus}${code ? ` (${code})` : ''}${
    data.error_description ? ` — ${data.error_description}` : ''
  }`

  if (code === 'invalid_grant') {
    return new AmazonApiError({
      kind: 'auth',
      message: tecnico,
      humanMessage:
        'La autorización de este cliente ya no vale: la ha retirado desde su Seller Central o ha pasado el año que dura. Hay que pedirle que vuelva a autorizar.',
      httpStatus,
      code,
    })
  }

  if (code === 'invalid_client' || code === 'unauthorized_client') {
    return new AmazonApiError({
      kind: 'config',
      message: tecnico,
      humanMessage:
        'Amazon no reconoce las credenciales de nuestra aplicación. Puede que el secreto haya caducado (dura 180 días) o que esté mal copiado. Hay que rotarlo en el portal de desarrollador.',
      httpStatus,
      code,
    })
  }

  if (httpStatus === 429 || httpStatus >= 500) {
    return new AmazonApiError({
      kind: httpStatus === 429 ? 'limite' : 'servidor',
      message: tecnico,
      humanMessage: 'Amazon no ha podido renovar el acceso ahora mismo. Se reintenta solo.',
      httpStatus,
      code,
      retryable: true,
    })
  }

  return new AmazonApiError({
    kind: 'auth',
    message: tecnico,
    humanMessage:
      'Amazon ha rechazado la renovación del acceso de este cliente. Si se repite, pídele que vuelva a autorizar.',
    httpStatus,
    code,
  })
}

/**
 * Canjea el código que llega a /callback por el refresh token de larga vida.
 *
 * TIENE QUE HACERSE EN EL PROPIO HANDLER DEL CALLBACK, sin colas ni trabajos
 * diferidos: el código de autorización caduca en unos cinco minutos, y un
 * proceso en segundo plano que se retrase deja al cliente sin conectar sin que
 * nadie sepa por qué.
 *
 * Devuelve el token EN CLARO. Quien llame lo cifra inmediatamente
 * (encryptToken) y no lo guarda en ninguna variable que sobreviva a la función.
 */
export async function exchangeAuthorizationCode(spapiOauthCode: string): Promise<string> {
  const cfg = lwaConfig()
  const data = await lwaPost(
    {
      grant_type: 'authorization_code',
      code: spapiOauthCode,
      redirect_uri: cfg.redirectUri,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    },
    'canje del código de autorización'
  )

  if (!data.refresh_token) {
    throw new AmazonApiError({
      kind: 'auth',
      message: 'canje del código: Amazon no ha devuelto refresh_token',
      humanMessage:
        'Amazon ha aceptado la autorización pero no ha devuelto la llave de acceso. Pídele al cliente que vuelva a autorizar; si se repite, el código de autorización estaba caducado (dura unos cinco minutos).',
    })
  }
  return data.refresh_token
}

/* ------------------------------------------------------------------ */
/* Caché de access tokens                                              */
/* ------------------------------------------------------------------ */

interface CachedToken {
  accessToken: string
  /** Momento (ms) a partir del cual hay que pedir uno nuevo */
  expiresAt: number
  /** Huella del refresh token con el que se obtuvo */
  fingerprint: string
}

/**
 * Un access token por conexión, en memoria del proceso.
 *
 * Se guarda con la HUELLA del refresh token que lo generó: si el cliente vuelve
 * a autorizar, el token cambia, la huella deja de coincidir y esta entrada se
 * descarta sola. Sin eso seguiríamos usando durante una hora un acceso sacado
 * de una autorización que ya no existe.
 */
const accessTokens = new Map<string, CachedToken>()

/**
 * Peticiones de token en vuelo.
 *
 * Cuando arranca un refresco de catálogo se lanzan varias llamadas casi a la
 * vez y todas necesitan token. Sin esto, todas verían la caché vacía y todas
 * pedirían uno: cuatro viajes a Amazon para lo mismo, y el último machacando en
 * la caché lo que puso el anterior. Se comparte la misma promesa.
 */
const inFlight = new Map<string, Promise<string>>()

/**
 * Margen de seguridad. El token dura 3600 segundos; se renueva cinco minutos
 * antes de que caduque para que ninguna petición salga con un token que expira
 * mientras viaja.
 */
const SAFETY_MARGIN_MS = 5 * 60 * 1000

/**
 * Devuelve un access token válido para esta conexión, pidiéndolo solo si hace
 * falta.
 *
 * `encryptedRefreshToken` entra CIFRADO a propósito: así el token en claro solo
 * existe dentro de esta función y durante el tiempo de la llamada, y la huella
 * de caché se calcula sin descifrar nada.
 */
export async function getAccessToken(params: {
  connectionId: string
  encryptedRefreshToken: string
  /** Cómo se descifra. Se inyecta para que este fichero no dependa del cifrado
      y se pueda probar sin clave */
  decrypt: (stored: string) => string
}): Promise<string> {
  const { connectionId, encryptedRefreshToken, decrypt } = params
  const fingerprint = tokenFingerprint(encryptedRefreshToken)

  const cached = accessTokens.get(connectionId)
  if (cached && cached.fingerprint === fingerprint && cached.expiresAt > Date.now()) {
    return cached.accessToken
  }

  const enCurso = inFlight.get(connectionId)
  if (enCurso) return enCurso

  const promesa = (async () => {
    const cfg = lwaConfig()
    const data = await lwaPost(
      {
        grant_type: 'refresh_token',
        refresh_token: decrypt(encryptedRefreshToken),
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
      },
      'renovación del acceso'
    )

    if (!data.access_token) {
      throw new AmazonApiError({
        kind: 'auth',
        message: 'renovación del acceso: Amazon no ha devuelto access_token',
        humanMessage:
          'Amazon no ha devuelto el acceso temporal para este cliente. Vuelve a intentarlo; si se repite, hay que renovar la autorización.',
      })
    }

    // expires_in viene en segundos (3600). Si no viniera, se asume una hora.
    const duracionMs = (data.expires_in ?? 3600) * 1000
    accessTokens.set(connectionId, {
      accessToken: data.access_token,
      expiresAt: Date.now() + Math.max(0, duracionMs - SAFETY_MARGIN_MS),
      fingerprint,
    })
    return data.access_token
  })()

  inFlight.set(connectionId, promesa)
  try {
    return await promesa
  } finally {
    inFlight.delete(connectionId)
  }
}

/**
 * Tira el token cacheado de una conexión.
 *
 * Se llama cuando Amazon contesta 401/403: puede que el token se haya
 * invalidado antes de tiempo (el cliente ha revocado el acceso ahora mismo), y
 * seguir usando el de la caché durante otros cincuenta minutos convertiría un
 * problema puntual en una hora de fallos.
 */
export function clearAccessToken(connectionId: string): void {
  accessTokens.delete(connectionId)
}

/** Vacía la caché entera. Para pruebas */
export function clearAllAccessTokens(): void {
  accessTokens.clear()
  inFlight.clear()
}
