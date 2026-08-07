import {
  AMAZON_REGIONS,
  MFN_CHANNEL_CODE,
  isFbaChannel,
  isMfnChannel,
  parseAmazonAmount,
  type AmazonRegion,
  type AmazonSubmissionField,
} from '@/lib/types/amazon'
import { decryptToken } from './crypto'
import {
  AmazonApiError,
  describeHttpError,
  describeIssues,
  describeNetworkError,
  hasBlockingIssues,
  type AmazonIssue,
} from './errors'
import { clearAccessToken, getAccessToken } from './lwa'
import { backoffDelay, bucketFor, sleep, type AmazonOperation } from './throttle'

/**
 * EL CLIENTE DE LA SELLING PARTNER API
 * ====================================
 * SOLO SERVIDOR. Todo lo que hay aquí necesita el refresh token de un cliente.
 *
 * Este fichero no sabe nada de Supabase ni de sesiones: recibe unas credenciales
 * ya resueltas y habla con Amazon. La parte que las saca de la base y guarda lo
 * que devuelve está en lib/amazon/data.ts. Es la misma separación que hay entre
 * lib/stock-sync/engine.ts (el motor, puro) y lib/stock-sync/api.ts (cookies y
 * base de datos): mezclarlos obliga a levantar media aplicación para comprobar
 * una llamada.
 *
 * LAS SEIS COSAS QUE HAY QUE SABER ANTES DE TOCAR ESTO
 * ---------------------------------------------------
 * 1. La cabecera es `x-amz-access-token`, NO `Authorization: Bearer`. Es el
 *    error clásico y da un 403 que parece un problema de permisos.
 *
 * 2. Ya no se firma nada con AWS. Desde octubre de 2023 basta el access token
 *    de LWA. Ni SDK de AWS, ni credenciales de IAM, ni SigV4.
 *
 * 3. UN DATO INVÁLIDO DEVUELVE HTTP 200. Un precio que Amazon no acepta llega
 *    como `{"status":"INVALID","issues":[…]}` dentro de un 200. Mirar solo
 *    `response.ok` da por bueno un cambio rechazado.
 *
 * 4. `ACCEPTED` no significa aplicado, significa aceptado para procesar. Lo
 *    que confirma un cambio es volver a leer el listing en el siguiente
 *    refresco.
 *
 * 5. `productType` es OBLIGATORIO en cada cambio y no se puede deducir: sale de
 *    leer el catálogo. Por eso se guarda en amazon_listings.
 *
 * 6. El stock de un listing FBA no se escribe por aquí. La cantidad la gestiona
 *    Amazon; un PATCH sobre fulfillment_availability o se ignora o genera un
 *    issue. Se corta antes de salir, en assertEditable().
 */

/* ------------------------------------------------------------------ */
/* Credenciales                                                        */
/* ------------------------------------------------------------------ */

/**
 * Lo que hace falta para hablar con la tienda de un cliente.
 *
 * El refresh token entra CIFRADO. No es una molestia: significa que el token en
 * claro solo existe dentro de getAccessToken(), durante la llamada, y que no
 * hay ninguna estructura viva en el proceso que lo contenga. Un objeto de
 * credenciales que se pasa entre funciones acaba en un `console.log` de
 * depuración tarde o temprano.
 */
export interface AmazonCredentials {
  connectionId: string
  sellingPartnerId: string
  region: AmazonRegion
  encryptedRefreshToken: string
}

/* ------------------------------------------------------------------ */
/* El ejecutor de peticiones                                           */
/* ------------------------------------------------------------------ */

type QueryValue = string | number | boolean | string[] | null | undefined

interface SpApiRequestInit {
  method: 'GET' | 'PATCH' | 'PUT' | 'POST'
  path: string
  query?: Record<string, QueryValue>
  body?: unknown
  /**
   * ¿Se puede repetir esta llamada sin consecuencias?
   *
   * Las lecturas, siempre. Las escrituras, SOLO si quien llama lo ha
   * comprobado: ver patchIsRepeatable(). Por defecto false, que es la opción
   * que no rompe nada.
   */
  repeatable?: boolean
  /** Cuántos intentos como mucho, contando el primero */
  maxAttempts?: number
}

export interface SpApiResult<T> {
  data: T
  httpStatus: number
  /** x-amzn-RequestId. Se guarda SIEMPRE, también cuando todo va bien: es lo
      único con lo que se puede abrir un caso con soporte de Amazon */
  requestId: string | null
  /** Intentos que costó */
  attempts: number
}

/** Idioma en el que se piden los mensajes de error a Amazon */
const ISSUE_LOCALE = 'es_ES'

const DEFAULT_MAX_ATTEMPTS = 4

function buildQuery(query: Record<string, QueryValue> | undefined): string {
  if (!query) return ''
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === '') continue
    // Los parámetros de tipo array van separados por comas (collectionFormat
    // csv en el modelo de Amazon), NO repitiendo la clave. Repetirla es el
    // otro error habitual y da un 400 poco descriptivo.
    params.set(key, Array.isArray(value) ? value.join(',') : String(value))
  }
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

/**
 * Lanza una petición contra la SP-API, respetando el cupo y reintentando lo que
 * se puede reintentar.
 *
 * El orden importa: primero se espera la ficha del cubo (para no provocar el
 * 429), y solo después se pide el token. Al revés se gastaría un token que
 * podría caducar mientras la petición espera en la cola.
 */
export async function spApiRequest<T>(
  creds: AmazonCredentials,
  operation: AmazonOperation,
  init: SpApiRequestInit
): Promise<SpApiResult<T>> {
  const endpoint = AMAZON_REGIONS[creds.region].endpoint
  const url = `${endpoint}${init.path}${buildQuery(init.query)}`
  const maxAttempts = init.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const bucket = bucketFor(creds.connectionId, operation)

  let ultimoError: AmazonApiError | null = null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await bucket.take()

    const accessToken = await getAccessToken({
      connectionId: creds.connectionId,
      encryptedRefreshToken: creds.encryptedRefreshToken,
      decrypt: decryptToken,
    })

    let response: Response
    try {
      response = await fetch(url, {
        method: init.method,
        headers: {
          // NO es `Authorization: Bearer`. Ver la nota 1 de arriba.
          'x-amz-access-token': accessToken,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        cache: 'no-store',
      })
    } catch (error) {
      const fallo = describeNetworkError(error, operation).withAttempts(attempt)
      // Una escritura que no se puede repetir NO se reintenta ante un fallo de
      // red: la petición pudo haber llegado. Aquí se para y se registra.
      if (!init.repeatable || attempt === maxAttempts) throw fallo
      ultimoError = fallo
      await sleep(backoffDelay(attempt))
      continue
    }

    const requestId =
      response.headers.get('x-amzn-RequestId') ?? response.headers.get('x-amzn-requestid')
    // Se le pasa el estado: en un 429 la cabecera trae el valor más castigado y
    // el cubo lo ignora a propósito. Ver observeLimitHeader().
    bucket.observeLimitHeader(response.headers.get('x-amzn-RateLimit-Limit'), response.status)

    if (response.ok) {
      const data = (await response.json().catch(() => ({}))) as T
      return { data, httpStatus: response.status, requestId, attempts: attempt }
    }

    const body = await response.json().catch(() => null)
    // Con el número de intentos que ha costado llegar hasta aquí: es lo que se
    // guarda luego en amazon_submissions.attempts.
    const fallo = describeHttpError({
      httpStatus: response.status,
      body,
      requestId,
      operation,
      region: creds.region,
    }).withAttempts(attempt)

    // Un 401 o un 403 puede ser un token que acaba de dejar de valer. Se tira el
    // de la caché para que el siguiente intento —aquí o dentro de un rato— pida
    // uno nuevo en vez de arrastrar el malo durante los cincuenta minutos que le
    // quedaban de vida.
    if (response.status === 401 || response.status === 403) {
      clearAccessToken(creds.connectionId)
    }

    // 403 y 400 son deterministas: reintentarlos solo gasta cupo y retrasa la
    // cola. Solo se repiten 429 y 5xx.
    const puedeReintentar = fallo.retryable && (init.repeatable || init.method === 'GET')
    if (!puedeReintentar || attempt === maxAttempts) throw fallo

    ultimoError = fallo
    await sleep(backoffDelay(attempt))
  }

  // Inalcanzable salvo que maxAttempts sea 0, pero el compilador quiere una
  // salida y un throw genérico aquí sería peor que el último error real.
  throw (
    ultimoError ??
    new AmazonApiError({
      kind: 'red',
      message: `${operation}: se agotaron los intentos`,
      humanMessage: 'No se ha podido completar la llamada a Amazon. Vuelve a intentarlo.',
      attempts: maxAttempts,
    })
  )
}

/* ------------------------------------------------------------------ */
/* Leer el catálogo                                                    */
/* ------------------------------------------------------------------ */

/** Una línea del catálogo, ya normalizada: esto es lo que entiende el ERP */
export interface AmazonCatalogItem {
  sku: string
  asin: string | null
  title: string | null
  /** Obligatorio para poder cambiar nada de este SKU */
  productType: string | null
  conditionType: string | null
  listingStatus: string[]
  price: number | null
  currency: string | null
  /** Solo significa algo si isFba es false */
  quantity: number | null
  fulfillmentChannelCode: string | null
  isFba: boolean
  /** lastUpdatedDate del propio Amazon, para el refresco incremental */
  amazonLastUpdatedAt: string | null
}

export interface CatalogFetchOptions {
  marketplaceId: string
  /**
   * Solo lo que haya cambiado desde esta fecha (ISO 8601). Es lo que convierte
   * el refresco de cada cuarto de hora en algo casi gratis: entre barridos
   * completos basta con preguntar por lo que se ha movido.
   */
  updatedAfter?: string | null
  /** Tope de páginas, por si un catálogo se descontrola. 20 por página */
  maxPages?: number
}

export interface CatalogFetchResult {
  items: AmazonCatalogItem[]
  /** Lo que declara Amazon que hay en total */
  totalDeclared: number
  /**
   * true cuando NO se ha podido recorrer el catálogo entero.
   *
   * searchListingsItems solo puede paginar 1000 SKU: por encima de eso deja de
   * devolver páginas y el barrido se queda corto SIN ERROR. Es exactamente el
   * tipo de fallo que nadie detecta mirando la pantalla —el catálogo parece
   * completo— así que se devuelve como dato para que la pantalla lo diga y
   * para que se sepa cuándo toca pasarse al informe de listings.
   */
  truncated: boolean
  pages: number
}

/** Tope real de la API. No es 100: son 20 */
const PAGE_SIZE = 20
/** Por encima de esto searchListingsItems no puede seguir paginando */
const MAX_PAGEABLE_ITEMS = 1000

interface ListingsSearchResponse {
  numberOfResults?: number
  pagination?: { nextToken?: string }
  items?: RawListingItem[]
}

interface RawListingItem {
  sku?: string
  summaries?: Array<{
    marketplaceId?: string
    asin?: string
    productType?: string
    conditionType?: string
    status?: string[]
    itemName?: string
    lastUpdatedDate?: string
  }>
  offers?: Array<{
    marketplaceId?: string
    offerType?: string
    price?: { currencyCode?: string; amount?: string | number }
  }>
  fulfillmentAvailability?: Array<{
    fulfillmentChannelCode?: string
    quantity?: number
  }>
}

/**
 * Lee el catálogo entero de una conexión para un marketplace.
 *
 * POR QUÉ searchListingsItems Y NO EL INFORME DE LISTINGS
 * ------------------------------------------------------
 * El informe GET_MERCHANT_LISTINGS_ALL_DATA da lo mismo, pero es asíncrono:
 * crear el informe, ir preguntando si está, descargar un fichero de una URL que
 * caduca a los cinco minutos. Y `createReport` solo admite una llamada cada
 * sesenta segundos. Para un refresco de quince minutos con varios clientes eso
 * es una máquina de estados que aquí no hace falta.
 *
 * Esta operación, en cambio, es síncrona, da SKU + ASIN + precio + cantidad en
 * una sola llamada, y es LA MISMA API con la que se escribe: mismos
 * `productType`, mismas rutas de atributos, un solo modelo mental.
 *
 * El informe se queda reservado para dos casos: catálogos de más de 1000 SKU
 * —donde esto no puede paginar entero— y una carga inicial masiva.
 */
export async function fetchCatalog(
  creds: AmazonCredentials,
  options: CatalogFetchOptions
): Promise<CatalogFetchResult> {
  const items: AmazonCatalogItem[] = []
  const maxPages = options.maxPages ?? Math.ceil(MAX_PAGEABLE_ITEMS / PAGE_SIZE)

  let pageToken: string | undefined
  let totalDeclared = 0
  let pages = 0

  do {
    const { data } = await spApiRequest<ListingsSearchResponse>(creds, 'searchListingsItems', {
      method: 'GET',
      path: `/listings/2021-08-01/items/${encodeURIComponent(creds.sellingPartnerId)}`,
      query: {
        marketplaceIds: [options.marketplaceId],
        // Los tres bloques que necesita el ERP, de una sola vez. Pedir menos
        // obligaría a una segunda pasada por SKU, y pedir más (attributes,
        // relationships) trae cientos de campos que no se usan.
        includedData: ['summaries', 'offers', 'fulfillmentAvailability'],
        pageSize: PAGE_SIZE,
        pageToken,
        issueLocale: ISSUE_LOCALE,
        lastUpdatedAfter: options.updatedAfter ?? undefined,
        // Se ordena por SKU ascendente y NO por fecha de modificación, que es
        // lo que hace Amazon por defecto. Motivo: el catálogo se mueve mientras
        // se pagina —de hecho lo movemos nosotros al enviar cambios— y con un
        // orden por fecha un listing que cambia entre la página 3 y la 4 salta
        // a la primera y desaparece del barrido. Es el mismo razonamiento por
        // el que fetchAll() de este ERP exige terminar el orden en una columna
        // única.
        sortBy: 'sku',
        sortOrder: 'ASC',
      },
    })

    totalDeclared = data.numberOfResults ?? totalDeclared
    for (const raw of data.items ?? []) {
      const item = normalizeListingItem(raw, options.marketplaceId)
      if (item) items.push(item)
    }

    pageToken = data.pagination?.nextToken
    pages += 1
  } while (pageToken && pages < maxPages)

  return {
    items,
    totalDeclared,
    // Se queda corto si Amazon dice que hay más de lo que se puede paginar, o
    // si aún quedaba página y se alcanzó el tope de seguridad.
    truncated: totalDeclared > MAX_PAGEABLE_ITEMS || Boolean(pageToken),
    pages,
  }
}

/**
 * Aplana lo que devuelve Amazon a la línea que entiende el ERP.
 *
 * Dos decisiones dentro:
 *
 *   - Del bloque de ofertas se coge la B2C, que es el precio que ve un
 *     comprador normal. Si un listing tiene además precio B2B (para empresas)
 *     y se cogiera «la primera», el ERP enseñaría un precio que no es el de la
 *     ficha del producto y alguien lo «corregiría».
 *
 *   - La cantidad sale de fulfillment_availability, que es a nivel de listing y
 *     no por marketplace. Se coge la entrada del canal del vendedor si existe;
 *     si solo hay canales de Amazon, es un FBA y la cantidad de aquí no vale
 *     para nada (la de verdad viene de getInventorySummaries).
 */
function normalizeListingItem(raw: RawListingItem, marketplaceId: string): AmazonCatalogItem | null {
  const sku = raw.sku
  if (!sku) return null

  const summary =
    (raw.summaries ?? []).find((s) => s.marketplaceId === marketplaceId) ?? (raw.summaries ?? [])[0]

  const ofertas = (raw.offers ?? []).filter((o) => o.marketplaceId === marketplaceId)
  const oferta = ofertas.find((o) => o.offerType === 'B2C') ?? ofertas[0]

  const disponibilidad = raw.fulfillmentAvailability ?? []
  const propia = disponibilidad.find((f) => f.fulfillmentChannelCode === MFN_CHANNEL_CODE)
  const canal = propia ?? disponibilidad[0]
  const fulfillmentChannelCode = canal?.fulfillmentChannelCode ?? null

  return {
    sku,
    asin: summary?.asin ?? null,
    title: summary?.itemName ?? null,
    productType: summary?.productType ?? null,
    conditionType: summary?.conditionType ?? null,
    listingStatus: summary?.status ?? [],
    price: parseAmazonAmount(oferta?.price?.amount),
    currency: oferta?.price?.currencyCode ?? null,
    quantity: typeof canal?.quantity === 'number' ? canal.quantity : null,
    fulfillmentChannelCode,
    isFba: isFbaChannel(fulfillmentChannelCode),
    amazonLastUpdatedAt: summary?.lastUpdatedDate ?? null,
  }
}

/* ------------------------------------------------------------------ */
/* Stock FBA                                                           */
/* ------------------------------------------------------------------ */

export interface FbaQuantities {
  total: number | null
  fulfillable: number | null
}

interface InventorySummariesResponse {
  payload?: {
    inventorySummaries?: Array<{
      sellerSku?: string
      totalQuantity?: number
      inventoryDetails?: { fulfillableQuantity?: number }
    }>
    // El nextToken de esta API viene en el propio payload y CADUCA A LOS 30
    // SEGUNDOS: no se puede guardar para más tarde ni repartir el paginado
    // entre dos ejecuciones.
    nextToken?: string
  }
  pagination?: { nextToken?: string }
}

/**
 * Stock real en la red logística de Amazon, por SKU.
 *
 * Solo hace falta para los clientes que venden por FBA. En un listing FBA la
 * cantidad que devuelve el catálogo no sirve —la lleva Amazon— y esta es la
 * única fuente buena.
 *
 * Es la operación más lenta de todas: 2 peticiones por segundo, la mitad que
 * las demás. El cubo ya lo sabe (AMAZON_RATE_LIMITS), pero conviene tenerlo en
 * cuenta al planificar un refresco.
 */
export async function fetchFbaInventory(
  creds: AmazonCredentials,
  marketplaceId: string,
  maxPages = 50
): Promise<Map<string, FbaQuantities>> {
  const out = new Map<string, FbaQuantities>()
  let nextToken: string | undefined
  let pages = 0

  do {
    const { data } = await spApiRequest<InventorySummariesResponse>(
      creds,
      'getInventorySummaries',
      {
        method: 'GET',
        path: '/fba/inventory/v1/summaries',
        query: {
          granularityType: 'Marketplace',
          granularityId: marketplaceId,
          marketplaceIds: [marketplaceId],
          details: true,
          nextToken,
        },
      }
    )

    for (const s of data.payload?.inventorySummaries ?? []) {
      if (!s.sellerSku) continue
      out.set(s.sellerSku, {
        total: typeof s.totalQuantity === 'number' ? s.totalQuantity : null,
        fulfillable:
          typeof s.inventoryDetails?.fulfillableQuantity === 'number'
            ? s.inventoryDetails.fulfillableQuantity
            : null,
      })
    }

    nextToken = data.pagination?.nextToken ?? data.payload?.nextToken
    pages += 1
  } while (nextToken && pages < maxPages)

  return out
}

/* ------------------------------------------------------------------ */
/* Marketplaces del vendedor                                           */
/* ------------------------------------------------------------------ */

export interface MarketplaceParticipation {
  marketplaceId: string
  countryCode: string
  currency: string
  storeName: string
  isParticipating: boolean
}

interface ParticipationsResponse {
  payload?: Array<{
    marketplace?: { id?: string; countryCode?: string; defaultCurrencyCode?: string }
    participation?: { isParticipating?: boolean }
    storeName?: string
  }>
}

/**
 * En qué marketplaces vende este cliente.
 *
 * SE LLAMA UNA VEZ, AL AUTORIZAR, y el resultado se guarda en la conexión. No
 * se llama en cada refresco: su cupo es de una petición cada minuto largo, así
 * que meterlo en el ciclo de quince minutos con varios clientes lo convertiría
 * en el cuello de botella de todo el módulo.
 *
 * Es lo que permite que la pantalla diga «esta conexión cubre España, Francia e
 * Italia» sin que nadie lo teclee.
 */
export async function fetchMarketplaceParticipations(
  creds: AmazonCredentials
): Promise<MarketplaceParticipation[]> {
  const { data } = await spApiRequest<ParticipationsResponse>(
    creds,
    'getMarketplaceParticipations',
    { method: 'GET', path: '/sellers/v1/marketplaceParticipations' }
  )

  const out: MarketplaceParticipation[] = []
  for (const row of data.payload ?? []) {
    const id = row.marketplace?.id
    if (!id) continue
    out.push({
      marketplaceId: id,
      countryCode: row.marketplace?.countryCode ?? '',
      currency: row.marketplace?.defaultCurrencyCode ?? '',
      storeName: row.storeName ?? '',
      isParticipating: row.participation?.isParticipating ?? false,
    })
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Escribir: precio y cantidad                                         */
/* ------------------------------------------------------------------ */

/** Una operación de las que van dentro de un PATCH */
export interface PatchOperation {
  op: 'add' | 'replace' | 'merge' | 'delete'
  path: string
  value?: unknown[]
}

/**
 * ¿SE PUEDE REPETIR ESTE PATCH SIN QUE SE APLIQUE DOS VECES?
 *
 * Esta función es la que autoriza los reintentos de una escritura, y por eso no
 * devuelve `true` a secas aunque «se sepa» que estos dos atributos son seguros:
 * lo COMPRUEBA sobre las operaciones que se van a mandar de verdad.
 *
 * El razonamiento: `replace` y `merge` fijan un VALOR ABSOLUTO —«pon la
 * cantidad a 10», no «suma 10»—, así que mandarlo dos veces deja exactamente el
 * mismo estado final. Con `add` sobre un array no está documentado si una
 * repetición duplica entradas, y con `delete` un segundo intento actúa sobre un
 * estado distinto del primero. Ninguno de los dos se usa en este módulo, pero
 * el día que alguien añada uno, esta comprobación apaga los reintentos sola en
 * vez de duplicarle el precio a un cliente.
 *
 * Lo que esto NO evita es la actualización perdida: si entre el envío original
 * (que quizá sí llegó) y el reintento alguien cambió el precio por otra vía, el
 * reintento lo pisa. Con una ventana de segundos el riesgo es bajo, pero existe
 * y por eso todo queda registrado con su valor anterior.
 */
export function patchIsRepeatable(patches: PatchOperation[]): boolean {
  return patches.length > 0 && patches.every((p) => p.op === 'replace' || p.op === 'merge')
}

/** El resultado de intentar cambiar algo */
export interface SubmissionOutcome {
  /** 'aceptado' | 'invalido' | 'error', en el vocabulario de amazon_submissions */
  status: 'aceptado' | 'invalido' | 'error'
  submissionId: string | null
  requestId: string | null
  httpStatus: number | null
  issues: AmazonIssue[]
  /** Ya en español, listo para enseñar y para guardar en el registro */
  message: string | null
  attempts: number
}

interface PatchResponse {
  sku?: string
  status?: 'ACCEPTED' | 'INVALID' | 'VALID'
  submissionId?: string
  issues?: AmazonIssue[]
}

/** Lo que hay que saber del listing para poder cambiarlo */
export interface ListingTarget {
  sku: string
  marketplaceId: string
  /** De summaries[].productType. Sin esto no se puede cambiar nada */
  productType: string
  /** Canal de logística, para no intentar escribir el stock de un FBA */
  fulfillmentChannelCode?: string | null
}

/**
 * Comprueba, ANTES de gastar una llamada, que el cambio tiene sentido.
 *
 * Las tres cosas que se cortan aquí darían un error de Amazon confuso o —peor—
 * un 200 que no cambia nada:
 *   - sin productType, un 400;
 *   - escribir stock en un FBA, un cambio que se ignora en silencio;
 *   - un número que no es un número, que llegaría como "null" o "NaN".
 */
function assertEditable(target: ListingTarget, field: AmazonSubmissionField, value: number): void {
  if (!target.productType) {
    throw new AmazonApiError({
      kind: 'peticion',
      message: `${target.sku}: falta productType`,
      humanMessage:
        'No conocemos el tipo de producto de este listing y Amazon lo exige en cada cambio. Refresca el catálogo antes de volver a intentarlo.',
    })
  }

  if (!Number.isFinite(value) || value < 0) {
    throw new AmazonApiError({
      kind: 'peticion',
      message: `${target.sku}: valor no válido (${value})`,
      humanMessage: 'El valor que se quiere enviar no es un número válido.',
    })
  }

  if (field === 'cantidad') {
    if (!Number.isInteger(value)) {
      throw new AmazonApiError({
        kind: 'peticion',
        message: `${target.sku}: cantidad no entera (${value})`,
        humanMessage: 'El stock tiene que ser un número entero de unidades.',
      })
    }
    // SE EXIGE EL CANAL DEL VENDEDOR, no «que no sea FBA». isFbaChannel()
    // devuelve false para null y para cadena vacía, así que la comprobación
    // vieja dejaba pasar los listings de los que NO SABEMOS quién gestiona el
    // stock —los que llegan sin fulfillmentAvailability— y salía un PATCH con
    // fulfillment_channel_code:'DEFAULT' contra un producto que puede ser de
    // Amazon. Ese cambio no da error: se ignora, y queda registrado como
    // aceptado. Ante la duda no se escribe.
    if (!isMfnChannel(target.fulfillmentChannelCode)) {
      throw new AmazonApiError({
        kind: 'peticion',
        message: `${target.sku}: stock no editable (canal ${
          target.fulfillmentChannelCode ?? 'desconocido'
        })`,
        humanMessage: target.fulfillmentChannelCode
          ? 'El stock de este producto lo gestiona Amazon (FBA): se cambia enviando o retirando unidades de sus almacenes, no desde aquí. El cambio no se ha enviado.'
          : 'No sabemos quién gestiona el stock de este producto: Amazon no nos ha devuelto su canal de logística. Refresca el catálogo y vuelve a intentarlo. El cambio no se ha enviado.',
      })
    }
  }
}

/**
 * Manda un PATCH y traduce la respuesta.
 *
 * Aquí está el punto 3 de la cabecera: se mira `status`, no `response.ok`. Un
 * 200 con `INVALID` es un cambio RECHAZADO, y devolverlo como éxito haría que
 * la pantalla enseñara el precio nuevo mientras la tienda sigue con el viejo.
 */
async function sendPatch(
  creds: AmazonCredentials,
  target: ListingTarget,
  patches: PatchOperation[],
  validateOnly: boolean
): Promise<SubmissionOutcome> {
  try {
    const { data, httpStatus, requestId, attempts } = await spApiRequest<PatchResponse>(
      creds,
      'patchListingsItem',
      {
        method: 'PATCH',
        // El SKU va en la ruta y hay SKU con barras, espacios y símbolos: sin
        // codificar, uno con '/' partiría la URL y el cambio acabaría en otro
        // sitio o en un 404.
        path: `/listings/2021-08-01/items/${encodeURIComponent(
          creds.sellingPartnerId
        )}/${encodeURIComponent(target.sku)}`,
        query: {
          marketplaceIds: [target.marketplaceId],
          issueLocale: ISSUE_LOCALE,
          // VALIDATION_PREVIEW valida sin persistir y devuelve los mismos
          // issues. Gasta cupo igual, pero para un «revisar antes de enviar»
          // es exactamente lo que hace falta.
          mode: validateOnly ? 'VALIDATION_PREVIEW' : undefined,
        },
        body: { productType: target.productType, patches },
        // Solo se permite repetir si TODAS las operaciones son de valor
        // absoluto. Ver patchIsRepeatable().
        repeatable: patchIsRepeatable(patches),
        maxAttempts: 3,
      }
    )

    const issues = data.issues ?? []

    if (data.status === 'INVALID' || (issues.length > 0 && hasBlockingIssues(issues))) {
      return {
        status: 'invalido',
        submissionId: data.submissionId ?? null,
        requestId,
        httpStatus,
        issues,
        message: describeIssues(issues),
        attempts,
      }
    }

    return {
      status: 'aceptado',
      submissionId: data.submissionId ?? null,
      requestId,
      httpStatus,
      issues,
      // Los avisos no bloquean, pero se guardan: son la pista de por qué un
      // cambio «aceptado» no acaba de aparecer en la tienda.
      message: issues.length > 0 ? describeIssues(issues) : null,
      attempts,
    }
  } catch (error) {
    if (error instanceof AmazonApiError) {
      return {
        status: 'error',
        submissionId: null,
        requestId: error.requestId,
        httpStatus: error.httpStatus,
        issues: error.issues,
        message: error.humanMessage,
        // Los intentos REALES, que los cuenta spApiRequest y los mete en el
        // error. Antes iba un 1 fijo y el registro decía «1 intento» de cambios
        // que habían salido tres veces hacia la tienda de un cliente.
        attempts: error.attempts,
      }
    }
    throw error
  }
}

/**
 * Cambia el PRECIO de un listing.
 *
 * La ruta del atributo es larga y hay que respetarla entera:
 * `purchasable_offer[].our_price[].schedule[].value_with_tax`. Y `value_with_tax`
 * es el precio CON IMPUESTOS INCLUIDOS, que es justo como se trabaja en España:
 * el número que se teclea en la pantalla es el que ve el comprador.
 *
 * `merge` Y NO `replace`, POR LA MISMA RAZÓN QUE EN updateQuantity.
 * `purchasable_offer` no es «el precio»: es el bloque de oferta entero, y ahí
 * dentro conviven, para el MISMO marketplace, cosas que no estamos mandando —
 * la entrada de otra audiencia (B2B; de hecho la lectura filtra por
 * offerType 'B2C' precisamente porque coexisten, ver normalizeListingItem), el
 * precio de rebaja programado con sus ventanas start_at/end_at, y los límites
 * mínimo y máximo que el vendedor tenga puestos.
 *
 * Con `replace` y un valor que no los incluya, TODO ESO SE PIERDE: el cliente
 * cambia de precio y se le desactiva la rebaja o los límites, sin ningún error
 * — el envío responde ACCEPTED igual. Es exactamente la pérdida que el stock ya
 * evitaba a conciencia veinte líneas más abajo, y la regla vale para los dos.
 *
 * Sigue siendo de valor absoluto, así que patchIsRepeatable() lo da por
 * repetible y los reintentos no cambian: mandarlo dos veces deja el mismo
 * precio.
 *
 * PENDIENTE DE COMPROBAR CONTRA UNA CUENTA DE VERDAD: el ejemplo que publica
 * Amazon para cambiar precio usa `replace`, y en `merge` los selectores de este
 * atributo son marketplace_id + audience. Aquí no se manda `audience` (el
 * ejemplo de Amazon tampoco). Si en las pruebas se viera que el precio no llega
 * a aplicarse —el cambio se quedaría en «enviado» sin pasar nunca a
 * «confirmado», que es justo la señal para la que existe confirmSubmissions—,
 * la alternativa buena NO es volver a `replace` a secas: es leer el
 * purchasable_offer actual con getListingsItem (includedData=attributes) y
 * reenviarlo entero cambiando solo el value_with_tax de la entrada B2C. Cuesta
 * una llamada por SKU y conserva el resto de la oferta igual.
 */
export async function updatePrice(
  creds: AmazonCredentials,
  target: ListingTarget,
  params: { price: number; currency: string; validateOnly?: boolean }
): Promise<SubmissionOutcome> {
  assertEditable(target, 'precio', params.price)

  const patches: PatchOperation[] = [
    {
      op: 'merge',
      path: '/attributes/purchasable_offer',
      value: [
        {
          marketplace_id: target.marketplaceId,
          currency: params.currency,
          our_price: [{ schedule: [{ value_with_tax: params.price }] }],
        },
      ],
    },
  ]

  return sendPatch(creds, target, patches, params.validateOnly ?? false)
}

/**
 * Cambia el STOCK de un listing gestionado por el vendedor.
 *
 * `merge` y NO `replace`, y la diferencia es real: el bloque
 * fulfillment_availability puede llevar además `restock_date` y
 * `lead_time_to_ship_max_days`. Con `replace` y un valor que no los incluya,
 * ESOS CAMPOS SE PIERDEN — se le borraría al cliente el plazo de envío que
 * tenía configurado sin que nadie se entere. `merge` cambia solo la cantidad.
 *
 * Sigue siendo de valor absoluto, así que se puede repetir sin sumar dos veces.
 */
export async function updateQuantity(
  creds: AmazonCredentials,
  target: ListingTarget,
  params: { quantity: number; validateOnly?: boolean }
): Promise<SubmissionOutcome> {
  assertEditable(target, 'cantidad', params.quantity)

  const patches: PatchOperation[] = [
    {
      op: 'merge',
      path: '/attributes/fulfillment_availability',
      value: [
        {
          // Siempre el canal del vendedor: es el único cuyo stock se puede
          // escribir, y assertEditable() ya ha cortado si el listing es FBA.
          fulfillment_channel_code: MFN_CHANNEL_CODE,
          quantity: params.quantity,
        },
      ],
    },
  ]

  return sendPatch(creds, target, patches, params.validateOnly ?? false)
}

/**
 * Aplica un cambio, sea del campo que sea.
 *
 * Es la puerta única que usa el envío en lote: así el día que se añada un tercer
 * campo, quien manda los lotes no cambia.
 */
export async function applyChange(
  creds: AmazonCredentials,
  target: ListingTarget,
  change: {
    field: AmazonSubmissionField
    value: number
    currency?: string | null
    validateOnly?: boolean
  }
): Promise<SubmissionOutcome> {
  if (change.field === 'precio') {
    if (!change.currency) {
      throw new AmazonApiError({
        kind: 'peticion',
        message: `${target.sku}: cambio de precio sin divisa`,
        humanMessage:
          'No se puede enviar un precio sin saber en qué moneda va. Refresca el catálogo para que se rellene.',
      })
    }
    return updatePrice(creds, target, {
      price: change.value,
      currency: change.currency,
      validateOnly: change.validateOnly,
    })
  }

  return updateQuantity(creds, target, {
    quantity: change.value,
    validateOnly: change.validateOnly,
  })
}
