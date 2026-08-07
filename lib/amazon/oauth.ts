import { AMAZON_REGIONS, marketplaceLabel, type AmazonRegion } from '@/lib/types/amazon'
import { AmazonApiError, humanMessageOf, oauthErrorMessage } from './errors'
import { buildConsentUrl } from './lwa'
import {
  CONSENT_LINK_TTL_MINUTES,
  completeAuthorization,
  consumeOAuthState,
  createOAuthState,
  resolveAppstoreClient,
} from './data'

/**
 * EL FLUJO DE AUTORIZACIÓN, DE PUNTA A PUNTA
 * ==========================================
 * SOLO SERVIDOR. Aquí se decide qué ve el CLIENTE de la agencia —una persona
 * que no tiene cuenta en el ERP, que probablemente no sepa lo que es y que
 * puede estar al teléfono con nosotros mientras lo hace— y aquí es donde se
 * comprueba el `state`.
 *
 * HAY DOS CAMINOS Y NO SON EL MISMO:
 *
 *   CAMINO A — lo empezamos nosotros. Un admin le da a «Conectar» en la
 *     pantalla, el ERP genera un enlace de consentimiento con un `state` dentro
 *     y se lo manda al cliente. El cliente lo abre, autoriza en su Seller
 *     Central, y Amazon lo devuelve a /callback. Es el camino que se usa hoy y
 *     el único que funciona con la aplicación en borrador.
 *
 *   CAMINO B — lo empieza el cliente desde el Appstore de Seller Central.
 *     Amazon llama a /connect, nosotros le devolvemos a Amazon con nuestro
 *     `state`, y de ahí sale también hacia /callback. Solo tiene sentido con la
 *     aplicación publicada, pero la dirección está registrada en el portal y
 *     tiene que contestar algo sensato desde el primer día.
 *
 * LO QUE SOSTIENE LA SEGURIDAD DE LOS DOS ES EL MISMO PÁRRAFO:
 * ------------------------------------------------------------
 * Amazon NO nos devuelve ni un dato nuestro en el callback. Solo `state`,
 * `selling_partner_id` y el código. Así que el `state` es a la vez:
 *
 *   - el ÚNICO hilo que dice a qué cliente del ERP pertenece esa autorización, y
 *   - la defensa contra CSRF que exige la documentación de Amazon.
 *
 * De ahí que la comprobación no sea opcional ni «por si acaso»: si se acepta un
 * callback sin validar el state, cualquiera que consiga que un navegador pase
 * por /callback con un código suyo puede hacer que el ERP guarde la llave de
 * SU tienda dentro de la ficha de un cliente nuestro. A partir de ahí, todo lo
 * que se «cambie» en ese cliente se estaría cambiando en la tienda del
 * atacante — o al revés, con el cliente equivocado enganchado, un cambio de
 * precio destinado a una tienda saldría hacia otra.
 *
 * Por eso, ante CUALQUIER duda sobre el state, esto CORTA. No hay reintento
 * silencioso, no hay «bueno, ya lo arreglamos luego»: se le enseña al cliente
 * una página que le dice que pida otro enlace, y no se canjea nada.
 */

/** El correo al que se le dice al cliente que escriba si algo falla */
export const CONTACTO = 'business@libertyseller.com'

/* ------------------------------------------------------------------ */
/* Lo que devuelven los dos manejadores                                */
/* ------------------------------------------------------------------ */

/** Página neutra: no ha fallado nada, es que aquí no había nada que hacer */
export interface OAuthInfo {
  kind: 'info'
  title: string
  message: string
}

/** Página de fallo. `detail` es la pista corta y sin secretos que ayuda a
    quien esté al teléfono; el motivo largo se queda en el log del servidor */
export interface OAuthError {
  kind: 'error'
  title: string
  message: string
  detail: string | null
}

export interface OAuthRedirect {
  kind: 'redirect'
  url: string
}

export interface OAuthConnected {
  kind: 'ok'
  /** Cómo se llama la tienda según Amazon */
  storeName: string
  /** Cómo llamamos nosotros a ese cliente */
  clientName: string
  regionLabel: string
  /** Nombres de los países que cubre la autorización */
  marketplaces: string[]
  /** Se conectó, pero hay algo que decir (no hemos podido leer sus países…) */
  warning: string | null
}

export type ConnectOutcome = OAuthRedirect | OAuthInfo | OAuthError
export type CallbackOutcome = OAuthConnected | OAuthInfo | OAuthError

/** Lo que llega en la query de una página de Next */
export type QueryParams = Record<string, string | string[] | undefined>

/**
 * Un parámetro de la URL, saneado.
 *
 * Si llega repetido (`?state=a&state=b`) Next lo entrega como array, y coger
 * «el que sea» es justo la clase de ambigüedad que se usa para colar cosas: se
 * descarta. Y se pone un tope de longitud porque estos valores acaban en una
 * consulta a la base.
 */
function param(query: QueryParams, name: string, max = 512): string | null {
  const raw = query[name]
  if (typeof raw !== 'string') return null
  const v = raw.trim()
  if (v === '' || v.length > max) return null
  return v
}

/* ------------------------------------------------------------------ */
/* Mensajes para el cliente                                            */
/* ------------------------------------------------------------------ */

/**
 * Los códigos de error de Amazon, contados para quien está al otro lado.
 *
 * NO son los mismos textos que OAUTH_ERROR_MESSAGES de errors.ts, y la
 * diferencia es a propósito: aquellos están escritos para nosotros y hablan de
 * variables de entorno y del portal de desarrollador. Esta página la abre un
 * vendedor de Amazon que no tiene por qué saber qué es una variable de entorno.
 *
 * MD1000 se dice con todas las letras —«la aplicación sigue en borrador»—
 * porque es EL error que va a salir mientras no se publique la aplicación, y
 * porque es nuestro, no suyo: quien lo lea tiene que entender enseguida que no
 * ha hecho nada mal y que no gana nada volviéndolo a intentar.
 */
const MENSAJE_PARA_EL_CLIENTE: Record<string, string> = {
  MD1000:
    'Nuestra aplicación de Amazon todavía figura como BORRADOR en el portal de desarrollador, ' +
    'y el enlace que has usado no llevaba la marca que hace falta para autorizar una aplicación en ese estado. ' +
    'Es un fallo de configuración nuestro, no tuyo: no hace falta que vuelvas a intentarlo con este enlace.',
  MD5101:
    'La dirección de vuelta de nuestra aplicación no coincide con la que tenemos registrada en Amazon. ' +
    'Es un fallo de configuración nuestro.',
  MD5110: 'La dirección de vuelta de nuestra aplicación no tiene el formato que exige Amazon. Es un fallo nuestro.',
  MD9100: 'Nuestra aplicación no tiene terminada su configuración en Amazon. Es un fallo nuestro.',
  CONSENT_LIMIT_REACHED:
    'Nuestra aplicación ha llegado al número máximo de cuentas que puede tener conectadas. ' +
    'Es un límite nuestro y lo tenemos que ampliar por nuestro lado.',
  SPDC8143:
    'Has entrado con un usuario secundario de tu cuenta de Seller Central. ' +
    'La autorización tiene que darla el usuario principal de la cuenta.',
}

function mensajeParaElCliente(code: string | null): string {
  if (!code) {
    return 'Amazon ha cancelado la autorización sin decir el motivo. Si quieres volver a intentarlo, pídenos un enlace nuevo.'
  }
  return (
    MENSAJE_PARA_EL_CLIENTE[code] ??
    'Amazon no ha podido completar la autorización. Vuelve a intentarlo con un enlace nuevo y, si sigue fallando, escríbenos.'
  )
}

/* ------------------------------------------------------------------ */
/* CAMINO A: el enlace que genera la pantalla                          */
/* ------------------------------------------------------------------ */

export interface ConsentLink {
  url: string
  /** Cuándo deja de valer, para poder decirlo en pantalla */
  expiresAt: string
}

/**
 * El enlace de consentimiento que un admin le manda a un cliente.
 *
 * El `state` se guarda ANTES de construir la URL: si el guardado falla, no
 * queremos que exista por ahí un enlace que luego rechazaríamos.
 */
export async function createConsentLink(params: {
  clientId: string
  region: AmazonRegion
  userId: string | null
}): Promise<ConsentLink> {
  const { state, expiresAt } = await createOAuthState({
    clientId: params.clientId,
    region: params.region,
    userId: params.userId,
    ttlMinutes: CONSENT_LINK_TTL_MINUTES,
  })

  // buildConsentUrl añade version=beta mientras la aplicación esté en borrador.
  // Sin eso, Amazon contesta MD1000 con el cliente delante.
  return { url: buildConsentUrl({ region: params.region, state }), expiresAt }
}

/* ------------------------------------------------------------------ */
/* CAMINO B: la entrada desde el Appstore (/connect)                   */
/* ------------------------------------------------------------------ */

/**
 * ¿Es esta dirección de vuelta de Amazon de verdad?
 *
 * ESTA COMPROBACIÓN ES LO QUE IMPIDE QUE /connect SEA UNA REDIRECCIÓN ABIERTA.
 * El parámetro `amazon_callback_uri` llega por la URL, o sea que lo pone quien
 * quiera, y nosotros redirigimos ahí con nuestro `state` dentro. Sin filtrar el
 * destino, cualquiera podría pedirle al ERP un `state` válido y hacer que se lo
 * mandáramos a su propio servidor — que es exactamente el material que hace
 * falta para intentar colar una autorización ajena.
 *
 * Se acepta https y solo dominios de Amazon (amazon.com, amazon.es,
 * amazon.co.uk, sellercentral-europe.amazon.com…).
 */
const HOST_DE_AMAZON = /(^|\.)amazon\.[a-z]{2,3}(\.[a-z]{2})?$/

export function isAmazonCallbackUri(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  return HOST_DE_AMAZON.test(url.hostname)
}

/**
 * De qué región es un vendedor que llega desde el Appstore.
 *
 * En este camino Amazon NO nos dice la región, y hace falta: es lo que decide
 * contra qué endpoint se habla luego. Lo único que hay para deducirlo es el
 * host de su Seller Central, que sí viene dentro de `amazon_callback_uri`:
 * sellercentral-europe.amazon.com es Europa y sellercentral.amazon.com es
 * Estados Unidos.
 *
 * Si se acierta mal no se pierde nada irreparable: las llamadas devuelven un
 * 403 de «región equivocada», la conexión queda marcada con ese motivo en la
 * pantalla y basta con volver a autorizar desde el enlace correcto. Preferimos
 * eso a rechazar la autorización de un cliente por no saber de qué país es.
 */
export function regionFromCallbackUri(value: string): AmazonRegion {
  let host = ''
  try {
    host = new URL(value).hostname.toLowerCase()
  } catch {
    return 'eu'
  }
  if (host.includes('europe')) return 'eu'
  if (host.includes('japan')) return 'fe'
  return 'na'
}

/**
 * /connect — el cliente ha pulsado «Autorizar» dentro de su Seller Central.
 *
 * Amazon nos manda aquí con `amazon_callback_uri`, `amazon_state` y
 * `selling_partner_id`, y espera que le devolvamos al vendedor a esa dirección
 * con SU `amazon_state` intacto y NUESTRO `state` añadido.
 */
export async function handleAppstoreEntry(query: QueryParams): Promise<ConnectOutcome> {
  const callbackUri = param(query, 'amazon_callback_uri', 2048)
  const amazonState = param(query, 'amazon_state')
  const sellingPartnerId = param(query, 'selling_partner_id', 64)
  const version = param(query, 'version', 32)

  // Sin los tres parámetros no viene de Amazon: es alguien que ha llegado a la
  // dirección por su cuenta. No es un error, así que no se le enseña uno.
  if (!callbackUri || !amazonState || !sellingPartnerId) {
    return {
      kind: 'info',
      title: 'Esta página la usa Amazon',
      message:
        'Aquí es donde Amazon nos trae tu cuenta cuando autorizas nuestra aplicación desde Seller Central. ' +
        `Si querías conectar tu cuenta con Liberty Seller, pídenos el enlace a ${CONTACTO} y ábrelo desde ahí.`,
    }
  }

  if (!isAmazonCallbackUri(callbackUri)) {
    console.error('Amazon OAuth: /connect con una dirección de vuelta que no es de Amazon')
    return {
      kind: 'error',
      title: 'No hemos podido continuar',
      message:
        'La dirección a la que habría que devolverte no es de Amazon, así que hemos parado el proceso. ' +
        `Si has llegado aquí desde tu Seller Central, escríbenos a ${CONTACTO}.`,
      detail: null,
    }
  }

  // El identificador de vendedor de Amazon es alfanumérico en mayúsculas. Se
  // comprueba la forma porque con él se abre una ficha de cliente más abajo.
  if (!/^[A-Z0-9]{6,24}$/.test(sellingPartnerId)) {
    console.error('Amazon OAuth: /connect con un selling_partner_id con una forma imposible')
    return {
      kind: 'error',
      title: 'No hemos podido continuar',
      message: `Amazon nos ha mandado un identificador de cuenta que no entendemos. Escríbenos a ${CONTACTO}.`,
      detail: null,
    }
  }

  const region = regionFromCallbackUri(callbackUri)

  let cliente
  try {
    cliente = await resolveAppstoreClient(sellingPartnerId)
  } catch (error) {
    console.error('Amazon OAuth: no se ha podido resolver el cliente del Appstore:', error)
    return {
      kind: 'error',
      title: 'No hemos podido continuar',
      message: `Ha fallado algo por nuestro lado antes de mandarte a Amazon. Inténtalo dentro de un rato o escríbenos a ${CONTACTO}.`,
      detail: null,
    }
  }

  // No conocemos a este vendedor: no tiene ninguna conexión con nosotros.
  //
  // NO SE LE ABRE UNA FICHA (ver resolveAppstoreClient): esta ruta es pública y
  // sin sesión, así que crear filas desde aquí es dejar que cualquiera nos
  // llene la tabla de clientes. Se le manda por el camino bueno, que es el que
  // se usa de verdad: un admin da de alta al cliente con su nombre y le genera
  // el enlace. Y es 'info' y no 'error' a propósito: no ha fallado nada, es que
  // todavía no hay nada suyo por aquí.
  if (!cliente) {
    return {
      kind: 'info',
      title: 'Todavía no tenemos tu cuenta dada de alta',
      message:
        'Has llegado desde tu Seller Central, pero tu cuenta no está aún dada de alta con nosotros, ' +
        `así que no podemos continuar por aquí. Escríbenos a ${CONTACTO} y te mandamos un enlace ` +
        'de autorización preparado para ti: se abre igual y en un clic queda conectada.',
    }
  }

  let state: string
  try {
    ;({ state } = await createOAuthState({
      clientId: cliente.id,
      region,
      userId: null,
      // Se ata el state al vendedor con el que se abre el flujo. Al volver por
      // /callback se comprueba que sea el mismo: ver el paso 4 bis de
      // handleCallback.
      sellingPartnerId,
    }))
  } catch (error) {
    console.error('Amazon OAuth: no se ha podido guardar el state del Appstore:', error)
    return {
      kind: 'error',
      title: 'No hemos podido continuar',
      message: `Ha fallado algo por nuestro lado antes de mandarte a Amazon. Inténtalo dentro de un rato o escríbenos a ${CONTACTO}.`,
      detail: null,
    }
  }

  const destino = new URL(callbackUri)
  // El de Amazon vuelve TAL CUAL, sin tocar ni un carácter: es su hilo, igual
  // que el nuestro es el nuestro.
  destino.searchParams.set('amazon_state', amazonState)
  destino.searchParams.set('state', state)

  // La dirección de vuelta es opcional aquí, y se lee del entorno directamente
  // en vez de por lwaConfig(): aquel exige además AMAZON_APP_ID, que este
  // camino no usa para nada. Si falta, Amazon usa la que tenga registrada.
  const redirectUri = process.env.AMAZON_OAUTH_REDIRECT_URI
  if (redirectUri) destino.searchParams.set('redirect_uri', redirectUri)

  // `version` se devuelve si llegó. La documentación NO lo lista entre los
  // parámetros que hay que propagar, así que esto es una precaución: cuando la
  // aplicación está en borrador, Amazon nos lo manda a nosotros con el valor
  // 'beta', y el error de no llevar esa marca donde toca (MD1000) es
  // exactamente el que queremos evitar. Si algún día se demuestra que estorba,
  // se quita esta línea y ya está.
  if (version) destino.searchParams.set('version', version)

  return { kind: 'redirect', url: destino.toString() }
}

/* ------------------------------------------------------------------ */
/* La vuelta (/callback), común a los dos caminos                      */
/* ------------------------------------------------------------------ */

/** La página que se le enseña a quien llega con un state que no cuadra */
function stateRechazado(motivo: string): OAuthError {
  // El motivo se registra pero NO se enseña: a quien está delante le da igual
  // si el state estaba caducado o ya usado, y decirlo solo le sirve a quien
  // esté probando a ver cuál de las dos cosas consigue.
  console.error(`Amazon OAuth: callback rechazado (${motivo})`)
  return {
    kind: 'error',
    title: 'No hemos podido comprobar este enlace',
    message:
      'No hemos podido confirmar que esta autorización venga de un enlace nuestro, así que la hemos rechazado y no hemos guardado nada. ' +
      'Suele pasar por dos motivos: el enlace ya se había usado una vez, o había caducado. ' +
      `Pídenos uno nuevo a ${CONTACTO} y ábrelo sin dejarlo para después.`,
    detail: null,
  }
}

/**
 * /callback — Amazon devuelve al vendedor después de autorizar.
 *
 * ORDEN DE LAS COMPROBACIONES, Y NINGUNA SOBRA:
 *
 *   1. ¿Viene Amazon diciendo que ha fallado? Entonces no hay nada que canjear.
 *   2. ¿Están los tres parámetros? Sin ellos no es una vuelta de Amazon.
 *   3. EL STATE. Se busca, se compara en tiempo constante, se comprueba que no
 *      esté ni caducado ni usado, y se QUEMA en la misma operación con un
 *      UPDATE condicionado a que siga sin usar. Si dos peticiones llegan a la
 *      vez con el mismo state, solo una gana. Si algo de esto no cuadra: se
 *      corta aquí y NO SE CANJEA EL CÓDIGO.
 *   4. Solo entonces se canjea el código por el refresh token y se guarda
 *      cifrado.
 *
 * Fíjate en que el `selling_partner_id` que manda Amazon NO decide a qué
 * cliente pertenece esto: eso lo dice el state, que es lo único que atamos
 * nosotros. El identificador solo se usa para saber de qué tienda es la llave.
 *
 * Y POR ESO MISMO HAY UN PASO 4 BIS. Cuando el flujo se abrió desde el
 * Appstore, el state se ató a una ficha de cliente USANDO ese identificador, así
 * que los dos datos tienen que seguir juntos al volver: si en el callback
 * apareciera otro vendedor, estaríamos guardando la llave de una tienda dentro
 * de la ficha de otro cliente. Se compara y se corta.
 */
export async function handleCallback(query: QueryParams): Promise<CallbackOutcome> {
  const errorCode = param(query, 'error', 128) ?? param(query, 'error_code', 128)
  const state = param(query, 'state')
  const sellingPartnerId = param(query, 'selling_partner_id', 64)
  const code = param(query, 'spapi_oauth_code', 2048)

  // ---- 1. Amazon dice que no ----
  if (errorCode) {
    // El texto largo va al log: nombra variables de entorno y el portal de
    // desarrollador, que es información para nosotros, no para el cliente.
    console.error(`Amazon OAuth: autorización rechazada — ${oauthErrorMessage(errorCode)}`)
    return {
      kind: 'error',
      title: 'Amazon no ha completado la autorización',
      message: mensajeParaElCliente(errorCode),
      detail: `Código de Amazon: ${errorCode}`,
    }
  }

  // ---- 2. ¿Es esto siquiera una vuelta de Amazon? ----
  if (!state && !code && !sellingPartnerId) {
    return {
      kind: 'info',
      title: 'Esta página la usa Amazon',
      message:
        'Aquí es donde Amazon nos devuelve tu cuenta después de que autorices nuestra aplicación. ' +
        `Si querías conectar tu cuenta con Liberty Seller, pídenos el enlace a ${CONTACTO}.`,
    }
  }

  // ---- 3. EL STATE ----
  if (!state) return stateRechazado('no venía state')

  let consumido
  try {
    consumido = await consumeOAuthState(state)
  } catch (error) {
    console.error('Amazon OAuth: fallo comprobando el state:', error)
    return {
      kind: 'error',
      title: 'No hemos podido continuar',
      message: `Ha fallado algo por nuestro lado al comprobar el enlace. Escríbenos a ${CONTACTO} y lo miramos.`,
      detail: null,
    }
  }
  // consumeOAuthState devuelve null si no existe, si ya se usó, si ha caducado
  // o si la comparación no cuadra. Los cuatro casos acaban igual: aquí.
  if (!consumido) return stateRechazado('no existe, ya estaba usado o había caducado')

  // ---- 4. Los otros dos parámetros ----
  // Se comprueban DESPUÉS del state, y a propósito: el state ya se ha quemado,
  // así que un enlace al que le falte el código no se puede reintentar tal
  // cual. Es lo correcto — un state usado no vuelve a valer, se pida lo que se
  // pida — y el mensaje dice que hay que pedir otro.
  if (!code || !sellingPartnerId) {
    console.error('Amazon OAuth: callback con state válido pero sin código o sin vendedor')
    return {
      kind: 'error',
      title: 'La autorización ha llegado incompleta',
      message: `Amazon no nos ha devuelto todo lo que hace falta. Pídenos un enlace nuevo a ${CONTACTO} y vuelve a intentarlo.`,
      detail: null,
    }
  }

  // ---- 4 bis. ¿VUELVE EL MISMO VENDEDOR QUE ABRIÓ EL FLUJO? ----
  //
  // Solo se puede comprobar cuando el state lo sabía, o sea en el camino del
  // Appstore: allí el `selling_partner_id` viene en la URL de /connect, que es
  // pública, y con él se decide a qué ficha de cliente del ERP se ata el state.
  //
  // Sin esta comprobación, ese par de datos se puede separar: se abre el flujo
  // con el identificador de un cliente REAL (para que el state quede atado a su
  // ficha) y se cierra con otro vendedor cualquiera. El token de esa otra
  // tienda quedaría archivado bajo la ficha del cliente de verdad y, como el
  // UNIQUE de la tabla es (selling_partner_id, region), ni siquiera sustituiría
  // a la conexión buena: se pondría al lado. A partir de ahí, un admin que
  // edite precios sobre esa tarjeta se los estaría mandando a la tienda del
  // otro, y el catálogo que ve «del cliente» sería el del otro.
  //
  // Hoy la aplicación está en borrador y solo deja autorizar a la cuenta del
  // propio desarrollador, así que no es explotable; el día que se publique, sí.
  //
  // En el camino A —el enlace que genera un admin— el campo va a NULL y no se
  // comprueba nada, que es lo correcto: ahí todavía no se sabía quién iba a
  // autorizar.
  if (consumido.sellingPartnerId && consumido.sellingPartnerId !== sellingPartnerId) {
    return stateRechazado('el vendedor que vuelve no es el que abrió el flujo')
  }

  // ---- 5. El canje. Va aquí y no en una cola: el código caduca en unos cinco
  //         minutos, así que un proceso diferido llega tarde ----
  try {
    const resultado = await completeAuthorization({
      spapiOauthCode: code,
      sellingPartnerId,
      clientId: consumido.clientId,
      region: consumido.region,
      userId: consumido.createdBy,
      fallbackName: consumido.clientName,
    })

    const paises = resultado.marketplaceIds.map((id) => marketplaceLabel(id))

    return {
      kind: 'ok',
      storeName: resultado.storeName,
      clientName: consumido.clientName,
      regionLabel: AMAZON_REGIONS[consumido.region].label,
      marketplaces: paises,
      warning:
        paises.length === 0
          ? 'Tu cuenta ha quedado conectada y funciona. Lo único que no hemos podido leer todavía es la lista de países en los que vendes, y eso lo resolvemos nosotros desde nuestro lado: no tienes que hacer nada.'
          : null,
    }
  } catch (error) {
    console.error('Amazon OAuth: fallo cerrando la autorización:', error)
    return {
      kind: 'error',
      title: 'No hemos podido guardar la conexión',
      message:
        'Amazon nos ha devuelto tu autorización, pero ha fallado algo por nuestro lado al guardarla. ' +
        `Escríbenos a ${CONTACTO} y lo resolvemos.`,
      // EL DETALLE SE ENSEÑA, PERO NO EL DE CONFIGURACIÓN.
      //
      // Esta página la lee un VENDEDOR DE AMAZON, no nosotros. Los mensajes de
      // AmazonApiError están en español y no llevan credenciales dentro, así
      // que en general se pueden enseñar y en una llamada de soporte ahorran
      // media conversación. Los de `kind: 'config'` son otra cosa: nombran
      // nuestras variables de entorno y nuestro portal de desarrollador
      // («Falta AMAZON_TOKEN_KEY… se genera con openssl rand -base64 32»,
      // «puede que el secreto haya caducado, dura 180 días»). Al cliente no le
      // dicen nada y a nosotros nos retratan la instalación.
      //
      // Y no es hipotético: la configuración a medias —LWA puesto y
      // AMAZON_TOKEN_KEY no— es un estado por el que pasa cualquier despliegue
      // nuevo. El motivo completo ya está en el console.error de arriba, que es
      // donde tiene que estar.
      detail:
        error instanceof AmazonApiError && error.kind === 'config'
          ? null
          : humanMessageOf(error),
    }
  }
}
