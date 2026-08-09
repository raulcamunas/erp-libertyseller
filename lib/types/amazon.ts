/**
 * AMAZON API — DOMINIO PURO
 * =========================
 * Tipos, tablas de regiones y marketplaces, y las cuentas que no necesitan ni
 * red ni base de datos. Sin React, sin Supabase, sin `fetch`: este fichero lo
 * pueden importar el servidor, el navegador y una prueba suelta.
 *
 * LO IMPORTANTE DE AQUÍ NO SON LAS INTERFACES, SON DOS COSAS:
 *
 *   1. AMAZON_REGIONS y AMAZON_MARKETPLACES. Región y marketplace NO son
 *      constantes empotradas en el código del cliente de la API: son datos de
 *      cada conexión, y se resuelven contra estas dos tablas. Un endpoint
 *      escrito a mano dentro de una función es lo que hace que el día que
 *      entre un cliente de Estados Unidos haya que buscar por todo el
 *      repositorio.
 *
 *   2. La distinción FBA / gestionado por el vendedor. Es la que decide si la
 *      celda de stock se puede escribir o no, y equivocarse ahí no da error:
 *      el cambio sale, Amazon lo ignora, y en pantalla parece aplicado.
 */

import type { ModeloNegocio, PoliticaBsr } from '@/lib/plataforma/modelo-negocio'

/* ------------------------------------------------------------------ */
/* Regiones y marketplaces                                             */
/* ------------------------------------------------------------------ */

/**
 * Las tres regiones de la Selling Partner API. Una autorización cubre una
 * región ENTERA: el mismo refresh token vale para España, Francia, Italia y
 * Alemania. Estados Unidos es otra región y necesita su propia autorización,
 * su propio token y su propia URL de consentimiento.
 */
export type AmazonRegion = 'eu' | 'na' | 'fe'

export interface AmazonRegionInfo {
  id: AmazonRegion
  label: string
  /** Contra este host van todas las llamadas de la API */
  endpoint: string
  /**
   * Dónde se manda al cliente a dar su consentimiento. Una sola URL para los
   * cuatro países europeos.
   *
   * NULL en Extremo Oriente a propósito: hoy no vende nadie allí y no está
   * comprobada. Antes que dejar puesta una URL a ojo —que fallaría en el
   * momento más caro, con un cliente delante— buildConsentUrl() corta con un
   * mensaje que dice qué falta.
   */
  sellerCentralUrl: string | null
}

export const AMAZON_REGIONS: Record<AmazonRegion, AmazonRegionInfo> = {
  eu: {
    id: 'eu',
    label: 'Europa',
    endpoint: 'https://sellingpartnerapi-eu.amazon.com',
    sellerCentralUrl: 'https://sellercentral-europe.amazon.com',
  },
  na: {
    id: 'na',
    label: 'Norteamérica',
    endpoint: 'https://sellingpartnerapi-na.amazon.com',
    sellerCentralUrl: 'https://sellercentral.amazon.com',
  },
  fe: {
    id: 'fe',
    label: 'Extremo Oriente',
    endpoint: 'https://sellingpartnerapi-fe.amazon.com',
    sellerCentralUrl: null,
  },
}

export const AMAZON_REGION_IDS: AmazonRegion[] = ['eu', 'na', 'fe']

export interface AmazonMarketplace {
  /** El identificador que viaja en marketplaceIds en cada llamada */
  id: string
  /** Bandera + país, que es como lo va a leer una persona */
  label: string
  countryCode: string
  region: AmazonRegion
  /** Divisa por defecto. Se usa para rellenar un precio nuevo cuando el
      listing todavía no tiene ninguno */
  currency: string
}

/**
 * Los marketplaces con los que trabaja la agencia. La mayoría de clientes
 * vende en España; algunos además en Francia, Italia, Alemania y Estados
 * Unidos.
 *
 * No es la lista completa de Amazon a propósito: una lista larga de países en
 * los que no vende nadie solo consigue que el selector de la pantalla sea
 * ilegible. Añadir uno es una línea aquí y nada más.
 */
export const AMAZON_MARKETPLACES: AmazonMarketplace[] = [
  { id: 'A1RKKUPIHCS9HS', label: 'España', countryCode: 'ES', region: 'eu', currency: 'EUR' },
  { id: 'A13V1IB3VIYZZH', label: 'Francia', countryCode: 'FR', region: 'eu', currency: 'EUR' },
  { id: 'APJ6JRA9NG5V4', label: 'Italia', countryCode: 'IT', region: 'eu', currency: 'EUR' },
  { id: 'A1PA6795UKMFR9', label: 'Alemania', countryCode: 'DE', region: 'eu', currency: 'EUR' },
  { id: 'ATVPDKIKX0DER', label: 'Estados Unidos', countryCode: 'US', region: 'na', currency: 'USD' },

  // El resto no sale en el selector (ver SELECTABLE_MARKETPLACE_IDS), pero
  // tienen que estar para poder PONERLES NOMBRE. Amazon devuelve en las
  // participaciones todos los países en los que la cuenta está dada de alta,
  // y los que no estén aquí se pintan como «A1AM78C64UM0Y8» en la pantalla que
  // ve el cliente al conectar. Paso de mostrar códigos en bruto a alguien de
  // fuera de la agencia.
  { id: 'A2EUQ1WTGCTBG2', label: 'Canadá', countryCode: 'CA', region: 'na', currency: 'CAD' },
  { id: 'A1AM78C64UM0Y8', label: 'México', countryCode: 'MX', region: 'na', currency: 'MXN' },
  { id: 'A2Q3Y263D00KWC', label: 'Brasil', countryCode: 'BR', region: 'na', currency: 'BRL' },
  { id: 'A1F83G8C2ARO7P', label: 'Reino Unido', countryCode: 'GB', region: 'eu', currency: 'GBP' },
  { id: 'A1C3SOZRARQ6R3', label: 'Polonia', countryCode: 'PL', region: 'eu', currency: 'PLN' },
  { id: 'A2NODRKZP88ZB9', label: 'Suecia', countryCode: 'SE', region: 'eu', currency: 'SEK' },
  { id: 'AMEN7PMS3EDWL', label: 'Bélgica', countryCode: 'BE', region: 'eu', currency: 'EUR' },
  { id: 'A1805IZSGTT6HS', label: 'Países Bajos', countryCode: 'NL', region: 'eu', currency: 'EUR' },
  { id: 'ARBP9OOSHTCHU', label: 'Egipto', countryCode: 'EG', region: 'eu', currency: 'EGP' },
  { id: 'A33AVAJ2PDY3EV', label: 'Turquía', countryCode: 'TR', region: 'eu', currency: 'TRY' },
  { id: 'A17E79C6D8DWNP', label: 'Arabia Saudí', countryCode: 'SA', region: 'eu', currency: 'SAR' },
  { id: 'A2VIGQ35RCS4UG', label: 'Emiratos Árabes', countryCode: 'AE', region: 'eu', currency: 'AED' },
  { id: 'A21TJRUUN4KGV', label: 'India', countryCode: 'IN', region: 'eu', currency: 'INR' },
  { id: 'A19VAU5U5O7RUS', label: 'Singapur', countryCode: 'SG', region: 'fe', currency: 'SGD' },
  { id: 'A39IBJ37TRP1C6', label: 'Australia', countryCode: 'AU', region: 'fe', currency: 'AUD' },
  { id: 'A1VC38T7YXB528', label: 'Japón', countryCode: 'JP', region: 'fe', currency: 'JPY' },
]

/**
 * Los que salen en el selector al generar un enlace.
 *
 * La lista de arriba tiene que ser larga para poder poner nombres, pero un
 * desplegable con veinte países en los que no vende nadie de la cartera solo
 * consigue que cueste encontrar España. Añadir uno aquí es una línea.
 */
export const SELECTABLE_MARKETPLACE_IDS = new Set([
  'A1RKKUPIHCS9HS',
  'A13V1IB3VIYZZH',
  'APJ6JRA9NG5V4',
  'A1PA6795UKMFR9',
  'ATVPDKIKX0DER',
])

const MARKETPLACES_BY_ID = new Map(AMAZON_MARKETPLACES.map((m) => [m.id, m]))

/** El marketplace, o null si Amazon devuelve uno que no está en la lista */
export function marketplaceById(id: string | null | undefined): AmazonMarketplace | null {
  if (!id) return null
  return MARKETPLACES_BY_ID.get(id) ?? null
}

/**
 * Nombre para pantalla. Devuelve el propio identificador cuando no se conoce:
 * un cliente puede participar en un marketplace que no está en la lista de
 * arriba, y enseñar «A2NODRKZP88ZB9» es mucho mejor que enseñar «—» o que
 * reventar.
 */
export function marketplaceLabel(id: string | null | undefined): string {
  if (!id) return '—'
  return MARKETPLACES_BY_ID.get(id)?.label ?? id
}

export function marketplacesForRegion(region: AmazonRegion): AmazonMarketplace[] {
  return AMAZON_MARKETPLACES.filter((m) => m.region === region)
}

/**
 * Los mercados de una región que se nombran en pantalla.
 *
 * La lista completa existe para poder PONER NOMBRE a lo que devuelva Amazon,
 * no para recitarla: «Una sola autorización cubre España, Francia, Italia,
 * Alemania, Reino Unido, Polonia, Suecia, Bélgica, Países Bajos, Egipto,
 * Turquía, Arabia Saudí, Emiratos Árabes e India» no lo lee nadie y esconde
 * justo el dato que importa, que es si está España.
 */
export function marketplacesPrincipales(region: AmazonRegion): AmazonMarketplace[] {
  return AMAZON_MARKETPLACES.filter(
    (m) => m.region === region && SELECTABLE_MARKETPLACE_IDS.has(m.id)
  )
}

/** A qué región pertenece un marketplace, o null si no se conoce */
export function regionForMarketplace(id: string): AmazonRegion | null {
  return MARKETPLACES_BY_ID.get(id)?.region ?? null
}

/* ------------------------------------------------------------------ */
/* Constantes de la aplicación de Amazon                               */
/* ------------------------------------------------------------------ */

/**
 * Autorizaciones que permite Amazon mientras la aplicación NO esté listada en
 * el Appstore. Al publicarla pasa a ilimitado.
 *
 * Está aquí, y la pantalla enseña cuántas quedan, porque es un tope que se
 * alcanza sin avisar: la autorización 26 falla con CONSENT_LIMIT_REACHED
 * delante del cliente.
 */
export const AMAZON_MAX_AUTHORIZATIONS = 25

/** Cada cuánto se refresca el catálogo. Ver el comentario de decisión en
    lib/amazon/sp-api.ts: con ~400 SKU sobra muchísimo margen */
export const AMAZON_REFRESH_MINUTES = 15

/**
 * Cada cuántos días tiene que volver a autorizar el vendedor. Lo fija Amazon.
 * Pasado ese plazo el refresh token deja de valer y el catálogo se congela, así
 * que conviene avisar antes de que ocurra.
 */
export const AMAZON_REAUTH_DAYS = 365

/** Días de antelación con los que la pantalla empieza a avisar de la renovación */
export const AMAZON_REAUTH_WARNING_DAYS = 30

/**
 * Canal de logística de un listing que gestiona el propio vendedor (MFN/FBM).
 * ES EL ÚNICO CUYO STOCK SE PUEDE ESCRIBIR. Los demás valores
 * ('AMAZON_EU', 'AMAZON_NA'...) son FBA: la cantidad la lleva Amazon.
 */
export const MFN_CHANNEL_CODE = 'DEFAULT'

/** true si el listing lo gestiona Amazon (FBA) y por tanto su stock NO se toca desde aquí */
export function isFbaChannel(code: string | null | undefined): boolean {
  return code != null && code !== '' && code !== MFN_CHANNEL_CODE
}

/**
 * true SOLO si consta expresamente que el stock lo gestiona el vendedor.
 *
 * ES LA FUNCIÓN QUE DECIDE SI SE PUEDE ESCRIBIR UNA CANTIDAD, y existe separada
 * de `!isFbaChannel()` por un motivo que ya mordió una vez: isFbaChannel
 * devuelve FALSE cuando el canal es null o cadena vacía, o sea que negarla daba
 * «es del vendedor» para un listing del que NO SABEMOS QUIÉN LO GESTIONA.
 *
 * Y no saberlo pasa de verdad: si Amazon devuelve un listing sin
 * fulfillmentAvailability —o el bloque llega vacío— normalizeListingItem deja
 * el canal a null. Con la regla vieja, la celda de stock quedaba editable, el
 * corte de sp-api.ts no saltaba, y salía un PATCH con
 * fulfillment_channel_code:'DEFAULT' contra un producto que puede perfectamente
 * gestionar Amazon. Ese cambio no da error: se ignora, y el registro lo guarda
 * como enviado y aceptado.
 *
 * Ante la duda, NO se escribe. Un stock que no se puede tocar hasta el
 * siguiente refresco es un incordio; un stock escrito en la tienda equivocada
 * no se ve hasta que lo dice el cliente.
 */
export function isMfnChannel(code: string | null | undefined): boolean {
  return code === MFN_CHANNEL_CODE
}

/* ------------------------------------------------------------------ */
/* Estados                                                             */
/* ------------------------------------------------------------------ */

export type AmazonConnectionStatus = 'activa' | 'revocada' | 'caducada' | 'error'

export const AMAZON_CONNECTION_STATUS_LABELS: Record<AmazonConnectionStatus, string> = {
  activa: 'Conectada',
  revocada: 'Acceso retirado',
  caducada: 'Autorización caducada',
  error: 'Con problemas',
}

export const AMAZON_CONNECTION_STATUS_HINTS: Record<AmazonConnectionStatus, string> = {
  activa: 'Se puede leer el catálogo y enviar cambios',
  revocada:
    'El cliente ha quitado el acceso desde su Seller Central. Hay que pedirle que vuelva a autorizar',
  caducada:
    'Han pasado los 365 días que dura una autorización de Amazon. Hay que pedirle al cliente que vuelva a autorizar',
  error:
    'Amazon rechaza las llamadas de esta conexión. Mira el detalle: suele ser un permiso que falta o una cuenta suspendida',
}

/** Clases COMPLETAS, nunca fragmentos: Tailwind purga lo que se construye concatenando */
export const AMAZON_CONNECTION_STATUS_COLORS: Record<AmazonConnectionStatus, string> = {
  activa: 'bg-green-500/20 text-green-300 border-green-500/30',
  revocada: 'bg-red-500/20 text-red-300 border-red-500/30',
  caducada: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  error: 'bg-red-500/20 text-red-300 border-red-500/30',
}

/**
 * Estado de un cambio enviado.
 *
 * La distinción entre `aceptado` y `confirmado` es la que más se le escapa a
 * la gente: Amazon contesta ACCEPTED en cuanto entiende la petición, no cuando
 * la aplica. Lo que prueba que el cambio llegó de verdad es volver a leer el
 * listing, y eso pasa en el siguiente refresco.
 */
export type AmazonSubmissionStatus =
  | 'pendiente'
  | 'aceptado'
  | 'confirmado'
  | 'invalido'
  | 'error'

export const AMAZON_SUBMISSION_STATUS_LABELS: Record<AmazonSubmissionStatus, string> = {
  pendiente: 'Sin enviar',
  aceptado: 'Enviado',
  confirmado: 'Confirmado',
  invalido: 'Rechazado',
  error: 'Falló',
}

export const AMAZON_SUBMISSION_STATUS_HINTS: Record<AmazonSubmissionStatus, string> = {
  pendiente: 'Registrado, todavía no ha salido hacia Amazon',
  aceptado:
    'Amazon lo ha aceptado para procesar, pero todavía no consta aplicado. Se confirma solo en el siguiente refresco',
  confirmado: 'Se ha vuelto a leer el listing en Amazon y el valor nuevo está puesto',
  invalido: 'Amazon ha rechazado el dato. El motivo está en el detalle',
  error: 'No se pudo enviar. Ni siquiera llegó a Amazon o falló por el camino',
}

export const AMAZON_SUBMISSION_STATUS_COLORS: Record<AmazonSubmissionStatus, string> = {
  pendiente: 'bg-zinc-600/25 text-zinc-300 border-zinc-500/30',
  aceptado: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  confirmado: 'bg-green-500/20 text-green-300 border-green-500/30',
  invalido: 'bg-red-500/20 text-red-300 border-red-500/30',
  error: 'bg-red-500/20 text-red-300 border-red-500/30',
}

/** Las columnas de estado son TEXT en la base, así que puede llegar un valor
    que no esté en el mapa. Mismo patrón que matchMethodLabel() de stock-sync */
export function submissionStatusLabel(s: string): string {
  return AMAZON_SUBMISSION_STATUS_LABELS[s as AmazonSubmissionStatus] ?? s
}

export function connectionStatusLabel(s: string): string {
  return AMAZON_CONNECTION_STATUS_LABELS[s as AmazonConnectionStatus] ?? s
}

/** Qué se ha tocado. Hoy solo estos dos; el resto de atributos del listing se
    pueden cambiar con los permisos que ya tenemos, pero no desde aquí */
export type AmazonSubmissionField = 'precio' | 'cantidad'

export const AMAZON_FIELD_LABELS: Record<AmazonSubmissionField, string> = {
  precio: 'Precio',
  cantidad: 'Stock',
}

/**
 * DE DÓNDE VIENE UN CAMBIO — decisión de diseño, no un campo informativo.
 *
 *   'manual'  -> alguien lo tecleó en la tabla de la pantalla
 *   'fichero' -> lo produjo el procesado de un fichero del cliente
 *
 * La segunda opción NO ESTÁ IMPLEMENTADA todavía: es la fase 2, enchufar el
 * motor de cruce de lib/stock-sync/engine.ts a esta API para que subir el
 * fichero del cliente empuje los cambios solo. Está declarada desde el primer
 * día —aquí, en el CHECK de amazon_submissions.source y en SendChangesInput—
 * para que esa fase no tenga que tocar ni la tabla ni estos tipos.
 */
export type AmazonChangeSource = 'manual' | 'fichero'

export const AMAZON_SOURCE_LABELS: Record<AmazonChangeSource, string> = {
  manual: 'A mano',
  fichero: 'De un fichero',
}

/* ------------------------------------------------------------------ */
/* Filas de la base de datos                                           */
/* ------------------------------------------------------------------ */

export interface AmazonClient {
  id: string
  name: string
  slug: string
  is_active: boolean
  position: number | null
  notes: string | null

  /**
   * CÓMO VENDE ESTE CLIENTE, y con ello si se le mide el BSR a diario.
   *
   * Las tres columnas de aquí abajo existen en la base desde la migración 123
   * (las dos primeras) y la 128 (la tercera), y `loadAmazonData()` las trae ya
   * —hace `select('*')`—: lo que faltaba era declararlas, así que la pantalla no
   * podía leerlas sin castear.
   *
   * OPCIONALES AUNQUE EN LA BASE SEAN NOT NULL, y es deliberado: las migraciones
   * de este módulo se lanzan a mano en el editor SQL de Supabase, así que el
   * código puede estar desplegado antes que ellas y un `select('*')` devolver la
   * fila SIN estas columnas. Con el tipo mintiendo, la pantalla haría
   * `MODELO_NEGOCIO_LABELS[cliente.modelo_negocio]` sobre un `undefined` y se
   * caería entera en vez de caer al valor por defecto. Quien las lee lo hace con
   * `?? 'mix'` y `?? 'auto'`, que es lo que ya venía haciendo
   * lib/plataforma/planificador.ts.
   *
   * Opcionales y NO anulables: en cuanto la columna existe, el NOT NULL y el
   * CHECK de la migración 123 garantizan que hay un valor válido. `undefined`
   * significa una cosa muy concreta —«esta columna todavía no existe»— y meter
   * `null` en la unión la volvería un «no sé» de dos clases.
   */
  modelo_negocio?: ModeloNegocio
  bsr_politica?: PoliticaBsr
  /**
   * Cuándo se confirmó a mano esa clasificación. Migración 128.
   *
   * OPCIONAL, y ahí está toda la gracia: `undefined` significa «la columna
   * todavía no existe» y `null` significa «existe y nadie se ha pronunciado».
   * Sin esa distinción no se puede saber si un cliente en 'mix' lo está porque
   * alguien lo decidió o porque es el valor por defecto de la 123 — ver
   * clienteSinClasificar() en lib/plataforma/modelo-negocio.ts.
   */
  modelo_negocio_at?: string | null

  created_at: string
  updated_at: string
}

/**
 * Una conexión TAL Y COMO PUEDE SALIR DEL SERVIDOR.
 *
 * Fíjate en lo que NO está: `refresh_token_enc`. No es un olvido. Este es el
 * tipo que viaja a la pantalla, y que la columna del token no exista aquí hace
 * que un `select('*')` tipado como AmazonConnection no compile en cuanto
 * alguien intente leerla. El tipo que sí la lleva vive en lib/amazon/data.ts,
 * que es el único fichero del repositorio que la toca.
 */
export interface AmazonConnection {
  id: string
  client_id: string
  name: string
  selling_partner_id: string
  region: AmazonRegion
  marketplace_ids: string[]
  default_marketplace_id: string | null
  status: AmazonConnectionStatus
  status_detail: string | null
  authorized_at: string
  authorized_by: string | null
  last_sync_at: string | null
  last_sync_items: number | null
  last_sync_attempt_at: string | null
  last_sync_error: string | null
  /**
   * El último barrido NO pudo recorrer el catálogo entero.
   *
   * searchListingsItems deja de paginar a los 1000 SKU y no da ningún error al
   * quedarse corto, así que sin esta bandera un cliente de 1.500 referencias
   * aparece con 1.000 y la pantalla las presenta como si fueran todas.
   */
  last_sync_truncated: boolean
  /** Cuántas referencias declaró Amazon que hay (numberOfResults). Con
      last_sync_items al lado, es lo que permite decir cuántas faltan */
  last_sync_declared: number | null
  is_active: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

export interface AmazonListing {
  id: string
  connection_id: string
  marketplace_id: string
  sku: string
  asin: string | null
  title: string | null
  /** Obligatorio para poder cambiar nada de este SKU. NULL = no se puede tocar */
  product_type: string | null
  condition_type: string | null
  listing_status: string[]
  price: number | null
  currency: string | null
  /** Solo significa algo si is_fba es false */
  quantity: number | null
  fulfillment_channel_code: string | null
  /** Generada por la base a partir del canal. Si es true, el stock es de solo lectura */
  is_fba: boolean
  fba_quantity: number | null
  fba_fulfillable_quantity: number | null
  last_seen_at: string
  amazon_last_updated_at: string | null
  created_at: string
  updated_at: string
}

export interface AmazonSubmission {
  id: string
  connection_id: string | null
  selling_partner_id: string
  marketplace_id: string
  sku: string
  asin: string | null
  field: AmazonSubmissionField
  previous_value: string | null
  new_value: string
  currency: string | null
  source: AmazonChangeSource
  source_ref: string | null
  batch_id: string
  created_by: string | null
  status: AmazonSubmissionStatus
  submission_id: string | null
  request_id: string | null
  http_status: number | null
  issues: unknown
  error_message: string | null
  attempts: number
  sent_at: string | null
  confirmed_at: string | null
  created_at: string
  updated_at: string
}

/* ------------------------------------------------------------------ */
/* Cambios pendientes de enviar (decisión C: nada sale por teclear)     */
/* ------------------------------------------------------------------ */

/**
 * Una celda editada que todavía NO ha salido hacia Amazon.
 *
 * Existe porque el envío es en lote y con confirmación: se editan las celdas
 * que haga falta, quedan marcadas, y un botón enseña la lista completa antes
 * de mandarla. Nada viaja por teclear en una celda — un 1499 donde se quería
 * 14,99 llegaría a la tienda de un cliente.
 *
 * `previousValue` va dentro y no se busca al enviar: es el valor que la persona
 * TENÍA DELANTE cuando decidió el cambio. Si entre la edición y el envío ha
 * entrado un refresco, esa diferencia es justo lo que hay que poder enseñar.
 */
export interface AmazonPendingChange {
  listingId: string
  sku: string
  marketplaceId: string
  field: AmazonSubmissionField
  previousValue: number | null
  newValue: number
  currency: string | null
}

/** Clave estable de una edición pendiente: un SKU puede tener a la vez un
    cambio de precio y uno de stock, y son dos cosas distintas */
export function pendingChangeKey(c: {
  marketplaceId: string
  sku: string
  field: AmazonSubmissionField
}): string {
  return `${c.marketplaceId}|${c.sku}|${c.field}`
}

/* ------------------------------------------------------------------ */
/* Cuentas puras                                                       */
/* ------------------------------------------------------------------ */

/**
 * Pasa a número el importe que devuelve Amazon.
 *
 * Amazon manda los importes como CADENA («14.99») precisamente para que nadie
 * pierda precisión por el camino. Aquí se convierte una sola vez, al entrar, y
 * se devuelve null ante cualquier cosa que no sea un número finito: un NaN
 * suelto acaba escribiéndose en la base y pintando «—» donde había un precio.
 */
export function parseAmazonAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/** Cuándo caduca la autorización de una conexión */
export function reauthDueDate(authorizedAt: string): Date {
  const d = new Date(authorizedAt)
  d.setDate(d.getDate() + AMAZON_REAUTH_DAYS)
  return d
}

/**
 * Días que faltan para que el cliente tenga que volver a autorizar. Negativo
 * si ya pasó. `now` se pasa por parámetro para que la cuenta sea comprobable
 * sin tocar el reloj del sistema.
 */
export function daysUntilReauth(authorizedAt: string, now: Date = new Date()): number {
  const due = reauthDueDate(authorizedAt).getTime()
  return Math.floor((due - now.getTime()) / 86_400_000)
}

/** true cuando toca avisar de la renovación en pantalla */
export function needsReauthWarning(authorizedAt: string, now: Date = new Date()): boolean {
  return daysUntilReauth(authorizedAt, now) <= AMAZON_REAUTH_WARNING_DAYS
}

/**
 * Con qué marketplace se abre una conexión.
 *
 * Nunca devuelve «el primero que haya» sin más: primero el que esté marcado
 * por defecto, luego España —que es donde vende la mayoría— y solo después el
 * primero del array. Que la pantalla abra en un país u otro según el orden en
 * que Amazon devolvió la lista es lo que hace que alguien escriba un precio en
 * la tienda equivocada.
 */
export function resolveMarketplace(conn: {
  default_marketplace_id: string | null
  marketplace_ids: string[]
}): string | null {
  if (conn.default_marketplace_id) return conn.default_marketplace_id
  const spain = AMAZON_MARKETPLACES[0].id
  if (conn.marketplace_ids.includes(spain)) return spain
  return conn.marketplace_ids[0] ?? null
}

/**
 * ¿Se puede escribir el stock de este listing?
 *
 * Un FBA no: la cantidad la gestiona Amazon y un PATCH sobre
 * fulfillment_availability o se ignora o genera un issue. La pantalla tiene que
 * pintar esa celda de solo lectura, y esta es la única función que lo decide.
 *
 * SE MIRA EL CANAL, NO `is_fba`. La columna generada de la migración 118 es
 * `canal IS NOT NULL AND canal <> 'DEFAULT'`, así que para un listing SIN canal
 * conocido vale false — o sea, «no es FBA»— y con eso la celda quedaba
 * editable sin que nadie supiera quién gestiona ese stock. Se exige que conste
 * el canal del vendedor: ver isMfnChannel().
 */
export function canEditQuantity(
  listing: Pick<AmazonListing, 'is_fba' | 'product_type' | 'fulfillment_channel_code'>
): boolean {
  return isMfnChannel(listing.fulfillment_channel_code) && !!listing.product_type
}

/** ¿Y el precio? En FBA también se puede: lo que gestiona Amazon es el stock */
export function canEditPrice(listing: Pick<AmazonListing, 'product_type'>): boolean {
  return !!listing.product_type
}

/**
 * Por qué NO se puede editar, en español y para enseñar en un `title`. null
 * cuando sí se puede.
 */
export function whyNotEditable(
  listing: Pick<AmazonListing, 'is_fba' | 'product_type' | 'fulfillment_channel_code'>,
  field: AmazonSubmissionField
): string | null {
  if (!listing.product_type) {
    return 'No conocemos el tipo de producto de este listing, y Amazon lo exige en cada cambio. Se rellenará en el próximo refresco del catálogo'
  }
  if (field === 'cantidad' && !isMfnChannel(listing.fulfillment_channel_code)) {
    // Dos motivos distintos y hay que separarlos: «lo lleva Amazon» es una
    // situación normal y definitiva; «no sabemos quién lo lleva» es un dato que
    // nos falta y que se arregla refrescando.
    return listing.fulfillment_channel_code
      ? 'El stock de este producto lo gestiona Amazon (FBA). Se cambia enviando o retirando unidades de sus almacenes, no desde aquí'
      : 'No sabemos quién gestiona el stock de este producto: Amazon no nos ha dicho su canal de logística. Refresca el catálogo; hasta entonces no se toca, porque si lo lleva Amazon el cambio se ignoraría en silencio'
  }
  return null
}
