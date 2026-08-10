import { randomBytes, randomUUID } from 'crypto'
import { createServiceClient } from '@/lib/supabase/service'
import {
  AMAZON_MAX_AUTHORIZATIONS,
  marketplaceById,
  resolveMarketplace,
  type AmazonChangeSource,
  type AmazonClient,
  type AmazonConnection,
  type AmazonListing,
  type AmazonRegion,
  type AmazonSubmission,
  type AmazonSubmissionField,
} from '@/lib/types/amazon'
import type { ModeloNegocio, PoliticaBsr } from '@/lib/plataforma/modelo-negocio'
import { MAX_PRICE, MAX_QUANTITY, marketplaceDeEntrada, marketplacesCubiertos } from './catalogo'
import { encryptToken, hasTokenKey, safeEqual } from './crypto'
import { AmazonApiError, humanMessageOf } from './errors'
import { clearAccessToken, exchangeAuthorizationCode, isAmazonConfigured } from './lwa'
import {
  applyChange,
  fetchCatalog,
  fetchFbaInventory,
  fetchMarketplaceParticipations,
  type AmazonCatalogItem,
  type AmazonCredentials,
  type ListingTarget,
} from './sp-api'

/**
 * DE DÓNDE SALEN Y A DÓNDE VAN LOS DATOS DEL MÓDULO DE AMAZON
 * ===========================================================
 * SOLO SERVIDOR: importa el cliente de service_role. Un componente de cliente
 * que importe esto se lleva la clave al navegador, y aquí además se descifran
 * las llaves de las tiendas de los clientes.
 *
 * ES EL ÚNICO FICHERO DEL REPOSITORIO QUE TOCA amazon_connections.refresh_token_enc.
 * Si algún día aparece un segundo, ese es el momento de parar y preguntarse por
 * qué. Todo lo que sale de aquí hacia arriba va sin token: el tipo
 * AmazonConnection de lib/types/amazon.ts ni siquiera declara esa columna, así
 * que devolverla por error no compila.
 *
 * Se lee con service_role a propósito y no con la sesión: las políticas RLS de
 * la migración 118 le NIEGAN a `authenticated` hasta el SELECT sobre la tabla
 * de conexiones. Lo que se controla es qué se DEVUELVE, y eso lo decide la
 * lista de columnas de aquí abajo, nunca la política.
 */

/** Supabase corta cualquier consulta a 1000 filas y un .limit() mayor NO lo salta */
const PAGE = 1000

/**
 * Consulta paginada. Copia deliberada de la de lib/employees/data.ts (que es la
 * canónica) en vez de importarla: aquel módulo arrastra el cálculo de nóminas
 * entero, y este no tiene por qué depender de él para paginar. Igual que hace
 * lib/stock-sync/api.ts.
 *
 * El orden lo fija quien llama y tiene que terminar SIEMPRE en una columna
 * única: .range() sobre un orden con empates repite filas o se las salta entre
 * tramos, y aquí una fila saltada es un listing que se queda sin refrescar.
 */
export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    // No se hace `break`: quedarse a medias devolvería medio catálogo sin dar
    // error visible, y medio catálogo es indistinguible de un catálogo entero
    // mirando la pantalla.
    if (error) throw error
    const chunk = (data as T[]) ?? []
    out.push(...chunk)
    if (chunk.length < PAGE) break
  }
  return out
}

/**
 * ¿Es «esa tabla o esa columna no existe» y no otra cosa?
 *
 * Solo esos cuatro códigos: un fallo de permisos, de red o de sintaxis TIENE
 * que seguir reventando. El código puede desplegarse antes de que alguien
 * lance la migración 118 a mano en el editor SQL de Supabase, y la pantalla
 * tiene que poder decir «falta lanzar esto» en vez de romperse.
 */
function isMissingSchema(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  return (
    code === 'PGRST205' || // PostgREST: la tabla no está en su caché de esquema
    code === '42P01' || // Postgres: undefined_table
    code === 'PGRST204' || // PostgREST: la columna no está en su caché
    code === '42703' // Postgres: undefined_column
  )
}

/**
 * Las columnas de una conexión que PUEDEN salir de este fichero.
 *
 * Escritas a mano y sin `*`, y esto es lo importante de todo el fichero: un
 * `select('*')` aquí metería refresh_token_enc en la respuesta de la pantalla.
 * Va cifrado, sí, pero un ciphertext en el navegador es material que no tiene
 * ninguna razón para salir del servidor.
 */
const CONNECTION_FIELDS =
  'id, client_id, name, selling_partner_id, region, marketplace_ids, marketplaces_activos, ' +
  'default_marketplace_id, ' +
  'status, status_detail, authorized_at, authorized_by, last_sync_at, last_sync_items, ' +
  'last_sync_attempt_at, last_sync_error, last_sync_truncated, last_sync_declared, ' +
  'is_active, notes, created_at, updated_at'

/** Lo mismo, MÁS el token. Solo se usa dentro de connectionCredentials() */
const CONNECTION_FIELDS_WITH_TOKEN = `${CONNECTION_FIELDS}, refresh_token_enc`

const LISTING_FIELDS =
  'id, connection_id, marketplace_id, sku, asin, title, product_type, condition_type, ' +
  'listing_status, price, currency, quantity, fulfillment_channel_code, is_fba, fba_quantity, ' +
  'fba_fulfillable_quantity, last_seen_at, amazon_last_updated_at, created_at, updated_at'

type Service = ReturnType<typeof createServiceClient>

/* ------------------------------------------------------------------ */
/* Carga de la pantalla                                                */
/* ------------------------------------------------------------------ */

export interface AmazonServerData {
  clients: AmazonClient[]
  /** SIN token. Ver CONNECTION_FIELDS */
  connections: AmazonConnection[]
  /** Cuántas líneas de catálogo tenemos de cada conexión */
  listingCounts: Record<string, number>
  /**
   * Cuántos cambios registrados tiene cada conexión.
   *
   * Se trae para que la pantalla pueda decir un número exacto al desconectar:
   * «se conservan 143 cambios registrados» es una promesa comprobable, y
   * «no se borra el historial» es una frase que hay que creerse.
   */
  submissionCounts: Record<string, number>
  /** Conexiones vivas, que es lo que consume del cupo de autorizaciones */
  activeConnections: number
  /** Cuántos clientes más se pueden conectar antes de tener que publicar la app */
  remainingAuthorizations: number
  /**
   * Faltan por lanzar las migraciones. Se devuelve como DATO y no se lanza:
   * la pantalla tiene que poder decir qué fichero hay que pegar en el editor
   * SQL de Supabase, igual que hace Control empleados.
   */
  missingTables: boolean
  /** Faltan variables de entorno (credenciales o clave de cifrado) */
  missingConfig: boolean
}

/**
 * Todo lo que hace falta para pintar la pantalla del módulo.
 *
 * No trae el catálogo: son cientos de líneas por cliente y solo se necesitan
 * las del que se elija. Eso lo pide la pantalla aparte con loadListings().
 */
export async function loadAmazonData(): Promise<AmazonServerData> {
  const service = createServiceClient()
  const vacio: AmazonServerData = {
    clients: [],
    connections: [],
    listingCounts: {},
    submissionCounts: {},
    activeConnections: 0,
    remainingAuthorizations: AMAZON_MAX_AUTHORIZATIONS,
    missingTables: true,
    missingConfig: !isAmazonConfigured() || !hasTokenKey(),
  }

  try {
    const clients = await fetchAll<AmazonClient>((a, b) =>
      service
        .from('amazon_clients')
        .select('*')
        // El orden termina en una columna única: .range() sobre un orden con
        // empates repite filas o se las salta entre tramos.
        .order('position', { ascending: true, nullsFirst: false })
        .order('name', { ascending: true })
        .order('id')
        .range(a, b)
    )

    const connections = await fetchAll<AmazonConnection>((a, b) =>
      service
        .from('amazon_connections')
        .select(CONNECTION_FIELDS)
        .order('name', { ascending: true })
        .order('id')
        .range(a, b)
    )

    const listingCounts: Record<string, number> = {}
    const submissionCounts: Record<string, number> = {}
    for (const conn of connections) {
      const { count } = await service
        .from('amazon_listings')
        .select('id', { count: 'exact', head: true })
        .eq('connection_id', conn.id)
      listingCounts[conn.id] = count ?? 0

      const { count: enviados } = await service
        .from('amazon_submissions')
        .select('id', { count: 'exact', head: true })
        .eq('connection_id', conn.id)
      submissionCounts[conn.id] = enviados ?? 0
    }

    const activeConnections = connections.filter((c) => c.is_active && c.status === 'activa').length

    return {
      clients,
      connections,
      listingCounts,
      submissionCounts,
      activeConnections,
      remainingAuthorizations: Math.max(0, AMAZON_MAX_AUTHORIZATIONS - activeConnections),
      missingTables: false,
      missingConfig: vacio.missingConfig,
    }
  } catch (error) {
    if (isMissingSchema(error)) return vacio
    throw error
  }
}

/** Una conexión suelta, SIN token. Devuelve null si ya no existe */
export async function loadConnection(connectionId: string): Promise<AmazonConnection | null> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('amazon_connections')
    .select(CONNECTION_FIELDS)
    .eq('id', connectionId)
    .maybeSingle()
  if (error) throw error
  return (data as AmazonConnection | null) ?? null
}

/**
 * SOBRE QUÉ MARKETPLACE SE VA A TRABAJAR, COMPROBADO.
 *
 * Devuelve null si el que se pide no está entre los que cubre la conexión. Esa
 * comprobación no es una formalidad: el marketplace llega desde el navegador y
 * es lo que decide EN QUÉ PAÍS se lee un catálogo y, sobre todo, en cuál se
 * escribe un precio. Sin validarlo, un identificador cambiado a mano en la
 * petición apuntaría a una tienda de otra región, que este cliente no nos ha
 * autorizado.
 *
 * Qué cuenta como «cubierto» lo decide marketplacesCubiertos(), que es la misma
 * función que usa la pantalla para pintar el selector de países. Tienen que ser
 * la misma o la pantalla ofrecería países que el servidor rechaza.
 */
export function pickMarketplace(
  connection: AmazonConnection,
  requested: string | null | undefined
): string | null {
  if (!requested) return marketplaceDeEntrada(connection)
  return marketplacesCubiertos(connection).includes(requested) ? requested : null
}

/** El catálogo de una conexión en un marketplace, entero */
export async function loadListings(
  connectionId: string,
  marketplaceId: string
): Promise<AmazonListing[]> {
  const service = createServiceClient()
  return fetchAll<AmazonListing>((a, b) =>
    service
      .from('amazon_listings')
      .select(LISTING_FIELDS)
      .eq('connection_id', connectionId)
      .eq('marketplace_id', marketplaceId)
      // sku es único dentro de (conexión, marketplace), así que el orden ya
      // termina en columna única.
      .order('sku', { ascending: true })
      .range(a, b)
  )
}

/** Tope de filas del historial en una consulta. Ver el comentario de abajo */
export const SUBMISSIONS_PAGE = 200

export interface SubmissionsFilter {
  /** Coincidencia parcial sobre el SKU, sin distinguir mayúsculas */
  sku?: string | null
  /** Desde y hasta, en ISO. Se comparan contra created_at */
  from?: string | null
  to?: string | null
  limit?: number
}

/**
 * El historial de cambios de una conexión, de lo más reciente a lo más antiguo.
 *
 * FILTRA EN LA BASE Y NO EN LA PANTALLA, y no es un detalle: esta tabla no se
 * borra nunca —es la única forma de saber, dentro de un año, si un precio raro
 * salió de aquí— así que crece para siempre. Traérsela entera al navegador para
 * filtrarla allí funciona el primer mes y deja de funcionar justo cuando el
 * historial empieza a servir para algo.
 *
 * Se devuelve como mucho un tramo (`limit`) porque quien mira un historial mira
 * el final o busca un SKU concreto, nunca las diez mil filas. Los índices por
 * (connection_id, created_at DESC) y por sku de la migración 118 cubren las dos
 * consultas.
 */
export async function loadSubmissions(
  connectionId: string,
  filter: SubmissionsFilter | number = {}
): Promise<AmazonSubmission[]> {
  // Se aceptaba un número suelto como límite antes de que hubiera filtros. Se
  // mantiene para no obligar a tocar a quien ya llamaba así.
  const f: SubmissionsFilter = typeof filter === 'number' ? { limit: filter } : filter
  const service = createServiceClient()

  let q = service.from('amazon_submissions').select('*').eq('connection_id', connectionId)

  if (f.sku) {
    // Los comodines de LIKE que venga escribiendo la persona se escapan: un «%»
    // suelto en el buscador devolvería el historial entero haciéndose pasar por
    // una búsqueda.
    const termino = f.sku.replace(/[\\%_]/g, (c) => `\\${c}`)
    q = q.ilike('sku', `%${termino}%`)
  }
  if (f.from) q = q.gte('created_at', f.from)
  if (f.to) q = q.lte('created_at', f.to)

  const { data, error } = await q
    .order('created_at', { ascending: false })
    .order('id')
    .limit(f.limit ?? SUBMISSIONS_PAGE)
  if (error) throw error
  return (data ?? []) as AmazonSubmission[]
}

/**
 * QUIÉN MANDÓ CADA CAMBIO, resuelto a un nombre que se pueda leer.
 *
 * La decisión D del módulo pide registrar «quién lo mandó», y el dato estaba
 * guardado desde el primer día en amazon_submissions.created_by — pero era un
 * UUID, así que el historial lo tenía y no lo enseñaba. El día que un cliente
 * pregunta por un precio, el historial contestaba qué pasó y cuándo pero no
 * quién lo hizo, que es la mitad de la pregunta cuando en la agencia hay más de
 * un admin.
 *
 * Se resuelve aparte y no con un JOIN porque `profiles` no tiene relación
 * declarada con esta tabla en PostgREST, y son cuatro nombres: una consulta por
 * carga de historial no se nota.
 */
export async function loadSubmissionAuthors(
  submissions: AmazonSubmission[]
): Promise<Record<string, string>> {
  const ids = Array.from(
    new Set(submissions.map((s) => s.created_by).filter((v): v is string => Boolean(v)))
  )
  if (ids.length === 0) return {}

  const service = createServiceClient()
  const { data, error } = await service
    .from('profiles')
    .select('id, full_name, email')
    .in('id', ids)
  if (error) throw error

  const out: Record<string, string> = {}
  for (const p of (data ?? []) as Array<{
    id: string
    full_name: string | null
    email: string | null
  }>) {
    // Mismo orden de preferencia que en el módulo de vacaciones: el nombre, y
    // si no hay, el correo. Nunca el UUID: no le dice nada a nadie.
    out[p.id] = p.full_name || p.email || 'Alguien que ya no está en el ERP'
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Credenciales                                                        */
/* ------------------------------------------------------------------ */

/** La fila completa, token incluido. No sale de este fichero */
type ConnectionWithToken = AmazonConnection & { refresh_token_enc: string }

export interface ResolvedConnection {
  connection: AmazonConnection
  credentials: AmazonCredentials
}

/**
 * Saca de la base lo necesario para hablar con la tienda de un cliente.
 *
 * El token NO se descifra aquí: se pasa cifrado a las credenciales y solo se
 * descifra dentro de getAccessToken(), en el instante de pedir el acceso. Así el
 * valor en claro no existe en ninguna variable que sobreviva a esa llamada.
 */
export async function connectionCredentials(
  connectionId: string
): Promise<ResolvedConnection | null> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('amazon_connections')
    .select(CONNECTION_FIELDS_WITH_TOKEN)
    .eq('id', connectionId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null

  const row = data as unknown as ConnectionWithToken
  const { refresh_token_enc, ...connection } = row

  return {
    connection,
    credentials: {
      connectionId: row.id,
      sellingPartnerId: row.selling_partner_id,
      region: row.region,
      encryptedRefreshToken: refresh_token_enc,
    },
  }
}

/* ------------------------------------------------------------------ */
/* Flujo de autorización                                               */
/* ------------------------------------------------------------------ */

/**
 * CUÁNTO VIVE UN `state`, Y POR QUÉ SON DOS NÚMEROS DISTINTOS
 * ==========================================================
 * El `state` es de un solo uso y son 32 bytes aleatorios, así que lo que fija
 * la caducidad no es «cuánto se tarda en adivinarlo» —no se adivina— sino
 * cuánto tiempo dejamos abierta la ventana en la que ese valor, si se filtrara,
 * serviría para enganchar una cuenta de Amazon a una ficha de cliente nuestra.
 * Cuanto más corta, mejor. Pero tiene que caber el flujo real, y hay dos:
 *
 *   STATE_TTL_MINUTES (10 min) — el salto desde el Appstore de Seller Central.
 *     Lo genera /connect y se gasta en el segundo siguiente, en la misma
 *     navegación. No hay ninguna razón para que viva más.
 *
 *   CONSENT_LINK_TTL_MINUTES (24 h) — el enlace que un admin genera en la
 *     pantalla para MANDÁRSELO al cliente. Aquí quien empieza el flujo y quien
 *     lo termina no son la misma persona ni el mismo día: se manda por correo o
 *     por WhatsApp y el cliente lo abre cuando puede. Con diez minutos ese
 *     enlace llega muerto SIEMPRE, y lo que pasa entonces es peor que la
 *     ventana que se ahorra: alguien acaba desactivando la comprobación porque
 *     «no funciona».
 *
 * Las dos siguen siendo de un solo uso y las dos se queman al usarse. Y como
 * generar otro enlace es un clic, si algún día hace falta acortarlo, se acorta
 * aquí y ya está.
 */
const STATE_TTL_MINUTES = 10

/** El enlace que se le manda al cliente. Ver el comentario de arriba */
export const CONSENT_LINK_TTL_MINUTES = 24 * 60

/**
 * Genera y guarda el `state` con el que se manda a un cliente a Amazon.
 *
 * Hace dos cosas a la vez y las dos son imprescindibles:
 *   - protege de CSRF (es el requisito que pone la documentación de Amazon:
 *     uno por petición, se valida al volver, y si no coincide se rechaza);
 *   - es EL ÚNICO HILO que conecta el código que llega a /callback con el
 *     cliente del ERP que inició el flujo, porque Amazon no nos devuelve nada
 *     nuestro.
 *
 * 32 bytes aleatorios en base64url: suficiente para que no se pueda adivinar y
 * corto para que quepa en una URL sin ensuciarla.
 */
export async function createOAuthState(params: {
  clientId: string
  region: AmazonRegion
  userId: string | null
  /**
   * El vendedor con el que se ABRE el flujo, cuando ya se sabe.
   *
   * Solo lo hay en el camino del Appstore, donde Amazon nos manda el
   * `selling_partner_id` en /connect. Se guarda para poder comprobar al volver
   * que el que aparece en el callback es EL MISMO: sin eso, se puede abrir el
   * flujo diciendo que se es el vendedor de un cliente nuestro —para que el
   * state quede atado a su ficha— y cerrarlo con otro vendedor distinto, y el
   * token de esa otra tienda acaba archivado bajo la ficha del cliente real.
   *
   * En el camino del enlace que genera un admin va a null a propósito: ahí
   * todavía no se sabe quién va a autorizar, así que no hay nada que comparar.
   */
  sellingPartnerId?: string | null
  /** Por defecto, el salto corto. La pantalla pasa CONSENT_LINK_TTL_MINUTES */
  ttlMinutes?: number
}): Promise<{ state: string; expiresAt: string }> {
  const service = createServiceClient()
  const state = randomBytes(32).toString('base64url')
  const ttl = params.ttlMinutes ?? STATE_TTL_MINUTES
  const expiresAt = new Date(Date.now() + ttl * 60_000).toISOString()

  const { error } = await service.from('amazon_oauth_states').insert({
    state,
    client_id: params.clientId,
    region: params.region,
    created_by: params.userId,
    selling_partner_id: params.sellingPartnerId ?? null,
    expires_at: expiresAt,
  })
  if (error) throw error

  // Barrido de los que ya no valen. Va DESPUÉS de insertar y sin `await` sobre
  // el resultado del que dependa nada: que la limpieza falle no puede impedir
  // que se genere un enlace. Se borran los caducados hace más de un día, no los
  // de hace un minuto: si alguien está mirando por qué le rechazan un enlace,
  // la fila tiene que seguir ahí para poder verlo.
  const corte = new Date(Date.now() - 24 * 60 * 60_000).toISOString()
  const { error: purgaError } = await service
    .from('amazon_oauth_states')
    .delete()
    .lt('expires_at', corte)
  if (purgaError) {
    console.error('No se han podido limpiar los states de OAuth caducados:', purgaError)
  }

  return { state, expiresAt }
}

export interface ConsumedState {
  clientId: string
  clientName: string
  region: AmazonRegion
  /** Quién de nosotros lanzó el flujo. Va a authorized_by de la conexión */
  createdBy: string | null
  /**
   * Con qué vendedor se abrió el flujo, si se sabía. Quien llama TIENE que
   * comprobar que coincide con el que devuelve Amazon en el callback. null =
   * no se sabía (el enlace que genera un admin) y no hay nada que comprobar.
   */
  sellingPartnerId: string | null
}

/**
 * Valida el state que vuelve de Amazon y lo quema.
 *
 * Devuelve null ante cualquier problema —no existe, ha caducado, ya se usó— y
 * quien llama tiene que RECHAZAR la autorización. Sin esta comprobación,
 * alguien puede inducir a un admin a completar un flujo que engancha una cuenta
 * de Amazon que no es la del cliente que se creía.
 *
 * El `UPDATE ... WHERE consumed_at IS NULL` es lo que hace que sea de un solo
 * uso de verdad: si dos peticiones llegan a la vez con el mismo state, solo una
 * actualiza una fila.
 */
export async function consumeOAuthState(state: string): Promise<ConsumedState | null> {
  if (!state || state.length > 200) return null
  const service = createServiceClient()

  const { data, error } = await service
    .from('amazon_oauth_states')
    .select('id, state, client_id, region, expires_at, consumed_at, created_by, selling_partner_id')
    .eq('state', state)
    .maybeSingle()
  if (error) throw error
  if (!data) return null

  const row = data as {
    id: string
    state: string
    client_id: string
    region: AmazonRegion
    expires_at: string
    consumed_at: string | null
    created_by: string | null
    selling_partner_id: string | null
  }

  // Comparación en tiempo constante aunque el `eq` de arriba ya haya casado:
  // cuesta una línea y quita del medio la duda.
  if (!safeEqual(row.state, state)) return null
  if (row.consumed_at) return null
  if (new Date(row.expires_at).getTime() < Date.now()) return null

  const { data: quemado, error: updateError } = await service
    .from('amazon_oauth_states')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', row.id)
    .is('consumed_at', null)
    .select('id')
  if (updateError) throw updateError
  if (!quemado || quemado.length === 0) return null

  // El nombre del cliente, para poder llamar a algo a la conexión antes de que
  // Amazon nos diga cómo se llama su tienda. Se lee DESPUÉS de quemar el state:
  // si el cliente se hubiera borrado entre medias, el flujo tiene que caerse
  // con el state ya gastado, no dejarlo vivo para un segundo intento.
  const { data: cliente, error: clienteError } = await service
    .from('amazon_clients')
    .select('name')
    .eq('id', row.client_id)
    .maybeSingle()
  if (clienteError) throw clienteError
  if (!cliente) return null

  return {
    clientId: row.client_id,
    clientName: (cliente as { name: string }).name,
    region: row.region,
    createdBy: row.created_by,
    sellingPartnerId: row.selling_partner_id,
  }
}

export interface AuthorizationResult {
  connectionId: string
  storeName: string
  marketplaceIds: string[]
}

/**
 * Cierra el flujo: canjea el código, cifra el token y deja la conexión lista.
 *
 * TIENE QUE EJECUTARSE DENTRO DEL PROPIO HANDLER DE /callback. El código de
 * autorización caduca en unos cinco minutos, así que no cabe una cola ni un
 * trabajo diferido: si se retrasa, el cliente se queda sin conectar y el
 * síntoma (un canje que falla) no señala a la causa.
 *
 * El `upsert` por (selling_partner_id, region) es lo que hace que volver a
 * autorizar SUSTITUYA el token en vez de crear una conexión duplicada. Y se
 * limpia el access token cacheado: el de antes se generó con la llave vieja.
 */
export async function completeAuthorization(params: {
  spapiOauthCode: string
  sellingPartnerId: string
  clientId: string
  region: AmazonRegion
  userId: string | null
  fallbackName: string
}): Promise<AuthorizationResult> {
  const service = createServiceClient()

  // 1. El código por la llave de larga vida, y a cifrar inmediatamente. El
  //    valor en claro no se guarda en ninguna variable que viva más que esto.
  const encrypted = encryptToken(await exchangeAuthorizationCode(params.spapiOauthCode))

  // 2. Fila mínima, para tener dónde apoyarse antes de preguntarle nada a
  //    Amazon. Si el descubrimiento de marketplaces falla, la conexión existe y
  //    se puede reintentar; al revés se habría perdido el token y habría que
  //    pedirle al cliente que volviera a autorizar.
  const { data: inserted, error } = await service
    .from('amazon_connections')
    .upsert(
      {
        client_id: params.clientId,
        name: params.fallbackName,
        selling_partner_id: params.sellingPartnerId,
        region: params.region,
        refresh_token_enc: encrypted,
        status: 'activa',
        status_detail: null,
        authorized_at: new Date().toISOString(),
        authorized_by: params.userId,
        is_active: true,
        // Se reinician los avisos del refresco anterior: la conexión es nueva.
        last_sync_error: null,
      },
      { onConflict: 'selling_partner_id,region' }
    )
    .select('id')
    .single()
  if (error) throw error

  const connectionId = (inserted as { id: string }).id
  clearAccessToken(connectionId)

  // 3. En qué marketplaces vende. Se pregunta UNA vez, aquí, y se guarda: su
  //    cupo es de una petición cada minuto largo y no cabe en el refresco.
  let marketplaceIds: string[] = []
  let storeName = params.fallbackName
  try {
    const participaciones = await fetchMarketplaceParticipations({
      connectionId,
      sellingPartnerId: params.sellingPartnerId,
      region: params.region,
      encryptedRefreshToken: encrypted,
    })
    const activas = participaciones.filter((p) => p.isParticipating)
    marketplaceIds = activas.map((p) => p.marketplaceId)
    storeName = activas.find((p) => p.storeName)?.storeName || params.fallbackName

    const conocidos = marketplaceIds.filter((id) => marketplaceById(id))
    await service
      .from('amazon_connections')
      .update({
        name: storeName,
        marketplace_ids: marketplaceIds,
        // Por defecto, el primero que conozcamos de los suyos. resolveMarketplace
        // prefiere España, que es donde vende la mayoría.
        default_marketplace_id: resolveMarketplace({
          default_marketplace_id: null,
          marketplace_ids: conocidos.length > 0 ? conocidos : marketplaceIds,
        }),
      })
      .eq('id', connectionId)
  } catch (error) {
    // LA CONEXIÓN SE QUEDA ACTIVA. Antes esto la marcaba `status:'error'`, y
    // eso la mataba para siempre: syncAllConnections solo barre las activas,
    // /api/amazon/sync devuelve 409, sendChanges lanza, y el único sitio de
    // todo el módulo que vuelve a poner 'activa' es esta misma función. O sea
    // que un 403 pasajero de la operación con MENOS cupo de todas (una petición
    // por minuto largo) dejaba inutilizable la cuenta de un cliente que acababa
    // de autorizar correctamente — mientras a él se le decía en /callback que no
    // tenía que hacer nada.
    //
    // Y no hace falta: el token está guardado y funciona. Lo único que falta es
    // la lista de países, y marketplacesCubiertos() ya cae a los de la región,
    // que es lo que la autorización cubre de verdad. Así que se deja activa y el
    // motivo va a last_sync_error, que la pantalla ya pinta —en la tarjeta de la
    // conexión y arriba del catálogo— y que además tiene botón para reintentar.
    await service
      .from('amazon_connections')
      .update({
        last_sync_error: `Conexión hecha y funcionando, pero no se ha podido leer en qué países vende: ${humanMessageOf(
          error
        )}. Se puede reintentar desde «Conexiones y accesos».`,
      })
      .eq('id', connectionId)
  }

  return { connectionId, storeName, marketplaceIds }
}

/**
 * VUELVE A INTENTAR LO QUE FALLÓ AL AUTORIZAR, Y REVIVE UNA CONEXIÓN MARCADA.
 *
 * Existe porque hasta ahora no había NINGÚN camino de vuelta. Una conexión que
 * caía en 'error' —por ejemplo con un 403 pasajero de Amazon, que
 * syncConnectionCatalog traduce a `permisos`— se quedaba así: el cron no la
 * barre, el botón de refrescar contesta 409, enviar cambios lanza, y en la
 * tarjeta solo había «Desconectar». La única salida era desconectar y pedirle
 * al cliente que volviera a autorizar, que es exactamente lo que /callback le
 * había prometido que no haría falta.
 *
 * Lo que hace es la prueba de fuego más barata que hay: preguntar a Amazon en
 * qué marketplaces vende. Si contesta, el token vale y los permisos están, así
 * que la conexión se reactiva y de paso se rellena la lista de países que quizá
 * faltaba. Si no contesta, se deja el estado como está y se devuelve el motivo:
 * un botón que dice «no ha podido ser, y por esto» es información; uno que
 * reactiva a ciegas solo mueve el fallo al siguiente envío de precios.
 */
export async function retryConnection(connectionId: string): Promise<{
  connection: AmazonConnection
  ok: boolean
  message: string
}> {
  const service = createServiceClient()
  const resolved = await connectionCredentials(connectionId)
  if (!resolved) throw new Error('Esa conexión de Amazon ya no existe')
  const { connection, credentials } = resolved

  try {
    const participaciones = await fetchMarketplaceParticipations(credentials)
    const activas = participaciones.filter((p) => p.isParticipating)
    const marketplaceIds = activas.map((p) => p.marketplaceId)
    const conocidos = marketplaceIds.filter((id) => marketplaceById(id))

    const cambios: Record<string, unknown> = {
      status: 'activa',
      status_detail: null,
      is_active: true,
      last_sync_error: null,
    }

    // La lista de países solo se toca si Amazon ha devuelto alguno: si vuelve
    // vacía, machacar la que ya había sería perder información por un intento
    // que salió bien.
    if (marketplaceIds.length > 0) {
      cambios.marketplace_ids = marketplaceIds
      cambios.default_marketplace_id = resolveMarketplace({
        default_marketplace_id: connection.default_marketplace_id,
        marketplace_ids: conocidos.length > 0 ? conocidos : marketplaceIds,
      })
      const nombre = activas.find((p) => p.storeName)?.storeName
      if (nombre) cambios.name = nombre
    }

    const { error } = await service
      .from('amazon_connections')
      .update(cambios)
      .eq('id', connectionId)
    if (error) throw error

    // El access token cacheado se generó quizá antes de que se arreglara nada:
    // que el siguiente pida uno limpio.
    clearAccessToken(connectionId)

    const fresca = await loadConnection(connectionId)
    return {
      connection: fresca ?? connection,
      ok: true,
      message:
        marketplaceIds.length > 0
          ? 'Conexión recuperada. Amazon responde y ya sabemos en qué países vende.'
          : 'Conexión recuperada. Amazon responde, aunque no ha devuelto ningún país activo.',
    }
  } catch (error) {
    const motivo = humanMessageOf(error)
    await service
      .from('amazon_connections')
      .update({ last_sync_error: motivo })
      .eq('id', connectionId)

    const fresca = await loadConnection(connectionId)
    return { connection: fresca ?? connection, ok: false, message: motivo }
  }
}

/* ------------------------------------------------------------------ */
/* Alta de clientes y baja de conexiones                               */
/* ------------------------------------------------------------------ */

/**
 * Nombre -> slug, con la misma forma que exige el CHECK de la tabla
 * (`^[a-z0-9-]+$`) y que la que usa stock_clients.
 *
 * Se quitan los acentos ANTES de filtrar: sin eso «Ferretería Muñoz» perdería
 * la í y la ñ enteras y quedaría «ferreter-a-mu-oz», que no se parece a nada.
 */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    // Los signos diacríticos que NFD ha separado de su letra
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

/**
 * Da de alta un cliente al que todavía no hemos conectado nada.
 *
 * El slug se deriva del nombre y se desempata con un sufijo: dos clientes que
 * se llamen «Muebles Sur» y «Muebles Súr» producen el mismo slug, y el UNIQUE
 * de la tabla haría fallar el alta con un error de Postgres que no le dice
 * nada a nadie.
 */
export async function createAmazonClient(params: {
  name: string
  notes?: string | null
}): Promise<AmazonClient> {
  const service = createServiceClient()
  const name = params.name.trim()
  const base = slugify(name)
  if (!base) {
    throw new Error('Ese nombre no tiene ninguna letra ni número con la que formar un identificador')
  }

  for (let intento = 0; intento < 20; intento++) {
    const slug = intento === 0 ? base : `${base}-${intento + 1}`
    const { data, error } = await service
      .from('amazon_clients')
      .insert({ name, slug, notes: params.notes ?? null })
      .select('*')
      .single()

    if (!error) return data as AmazonClient

    // 23505 = unique_violation. Si choca el NOMBRE no hay nada que desempatar
    // —ese cliente ya existe— y hay que decirlo; si choca el slug, se reintenta.
    if ((error as { code?: string }).code !== '23505') throw error
    const detalle = String((error as { message?: string }).message ?? '')
    if (detalle.includes('name')) {
      throw new Error(`Ya hay un cliente que se llama «${name}»`)
    }
  }

  throw new Error('No se ha podido generar un identificador libre para ese nombre')
}

export interface QueSePierde {
  conexiones: number
  referencias: number
  observacionesBsr: number
  trabajos: number
}

/**
 * QUÉ SE LLEVA POR DELANTE BORRAR A ESTE CLIENTE.
 *
 * Todo lo que cuelga de `amazon_clients` está en ON DELETE CASCADE, así que
 * borrar la fila del cliente borra su catálogo, sus trabajos, sus costes, su
 * configuración de Buy Box y SU HISTÓRICO DE BSR. Ese último es el que importa:
 * los demás se vuelven a leer de Amazon en una noche, y el BSR no —es una serie
 * que se construye día a día y que Amazon no sirve hacia atrás—.
 *
 * Se cuenta ANTES de borrar y se enseña en el diálogo. Un «¿seguro?» a secas no
 * es una confirmación: es un botón de «vale» con un paso más.
 *
 * Los recuentos van con `head: true`, o sea que Postgres devuelve el número sin
 * mandar ni una fila.
 */
export async function queSePierdeAlBorrarCliente(clientId: string): Promise<QueSePierde> {
  const service = createServiceClient()

  const contar = async (tabla: string): Promise<number> => {
    try {
      const { count, error } = await service
        .from(tabla)
        .select('id', { count: 'exact', head: true })
        .eq('client_id', clientId)
      if (error) throw error
      return count ?? 0
    } catch {
      // Una tabla que todavía no existe —las migraciones se lanzan a mano— no
      // puede impedir que se cuente el resto ni bloquear el borrado.
      return 0
    }
  }

  const [conexiones, referencias, observacionesBsr, trabajos] = await Promise.all([
    contar('amazon_connections'),
    contar('amazon_listings'),
    contar('amazon_snapshots_bsr'),
    contar('amazon_jobs'),
  ])

  return { conexiones, referencias, observacionesBsr, trabajos }
}

/**
 * BORRA UN CLIENTE. NO SE PUEDE DESHACER.
 *
 * SE NIEGA SI TODAVÍA TIENE UNA CUENTA DE AMAZON CONECTADA, y no por prudencia
 * genérica: la conexión guarda el refresh token del vendedor y está en CASCADE,
 * así que borrar el cliente destruiría esa llave de paso sin que nadie haya
 * pulsado «Desconectar». Son dos actos distintos —romper la autorización de un
 * cliente y darlo de baja— y mezclarlos hace que uno ocurra sin querer.
 *
 * El nombre tiene que venir escrito tal cual. Es lo que separa un borrado de un
 * clic mal dado en una lista, y es barato: quien de verdad quiere borrar a un
 * cliente lo teclea sin pensarlo.
 */
export async function eliminarCliente(params: {
  clientId: string
  nombreEscrito: string
}): Promise<{ nombre: string; perdido: QueSePierde }> {
  const service = createServiceClient()

  const { data: cliente, error: errorLectura } = await service
    .from('amazon_clients')
    .select('id, name')
    .eq('id', params.clientId)
    .maybeSingle()
  if (errorLectura) throw errorLectura
  if (!cliente) throw new Error('Ese cliente ya no existe')

  const nombre = (cliente as { name: string }).name
  if (params.nombreEscrito.trim() !== nombre.trim()) {
    throw new Error(
      `Para borrarlo hay que escribir su nombre exacto: «${nombre}». Así no se borra a nadie de un clic mal dado.`
    )
  }

  const perdido = await queSePierdeAlBorrarCliente(params.clientId)
  if (perdido.conexiones > 0) {
    throw new Error(
      `«${nombre}» todavía tiene ${perdido.conexiones === 1 ? 'una cuenta de Amazon conectada' : `${perdido.conexiones} cuentas de Amazon conectadas`}. ` +
        'Desconéctala primero: ahí es donde se destruye la llave de acceso a su tienda, y eso tiene que ser una decisión aparte.'
    )
  }

  const { error } = await service.from('amazon_clients').delete().eq('id', params.clientId)
  if (error) throw error

  return { nombre, perdido }
}

/**
 * GUARDA EL MODELO DE NEGOCIO Y LA POLÍTICA DE BSR DE UN CLIENTE.
 *
 * Es la escritura más barata del módulo y la que más cupo ahorra: decide si al
 * catálogo de ese cliente se le pide el ranking cada noche. En un catálogo de
 * reventa de 13.700 SKU eso son ~44.000 llamadas a dos por segundo, o sea unas
 * seis horas de ventana nocturna midiendo el producto de otro.
 *
 * ESCRIBE TRES COLUMNAS, NO DOS. La tercera —`modelo_negocio_at`— es la que
 * convierte «este cliente es mixto» en una decisión y no en el valor por defecto
 * de la migración 123, y sin ella el contador de «sin clasificar» de la pantalla
 * no puede llegar nunca a cero. Ver clienteSinClasificar().
 *
 * EL REINTENTO SIN LA TERCERA COLUMNA NO ES DEFENSA A CIEGAS. Las migraciones de
 * este módulo se lanzan a mano en el editor SQL de Supabase, así que este código
 * puede estar desplegado antes que la 128. Si falta esa columna, lo que hay que
 * hacer es guardar igualmente el modelo y la política —que es lo que de verdad
 * cambia el comportamiento del planificador— y devolver el aviso, no negarse a
 * clasificar a nadie hasta que alguien pegue un fichero SQL. Si lo que faltan
 * son las otras dos, ahí sí se corta: no hay nada que guardar.
 */
export async function actualizarClasificacionCliente(params: {
  clientId: string
  modelo: ModeloNegocio
  politica: PoliticaBsr
}): Promise<{ client: AmazonClient; sinColumnaFecha: boolean }> {
  const service = createServiceClient()
  const base = { modelo_negocio: params.modelo, bsr_politica: params.politica }

  const escribir = async (patch: Record<string, unknown>) =>
    service.from('amazon_clients').update(patch).eq('id', params.clientId).select('*').single()

  let sinColumnaFecha = false
  let { data, error } = await escribir({ ...base, modelo_negocio_at: new Date().toISOString() })

  if (error && isMissingSchema(error)) {
    sinColumnaFecha = true
    ;({ data, error } = await escribir(base))
  }

  if (error) {
    if (isMissingSchema(error)) {
      throw new Error(
        'Falta lanzar la migración 123_plataforma_a1.sql en el editor SQL de Supabase: sin ella ' +
          'no existen las columnas del modelo de negocio ni de la política de BSR.'
      )
    }
    throw error
  }
  if (!data) throw new Error('Ese cliente ya no existe')

  return { client: data as AmazonClient, sinColumnaFecha }
}

/**
 * DESCONECTA A UN CLIENTE: BORRA LA FILA DE LA CONEXIÓN.
 *
 * Y sí, se borra de verdad. Marcar un `is_active = false` y quedarse el token
 * guardado no es desconectar: seguiríamos teniendo la llave de la tienda de
 * alguien que ha dicho que no. Lo que hay que destruir es la llave, y la única
 * forma de que no quede en ninguna copia es que la fila no exista.
 *
 * LO QUE SE PIERDE Y LO QUE NO — la tabla se diseñó para esto:
 *   amazon_listings  -> CASCADE. Es un espejo de lo que hay en Amazon, se
 *                       vuelve a leer entero en cuanto se reconecte.
 *   amazon_submissions -> ON DELETE SET NULL, con `selling_partner_id` y
 *                       `marketplace_id` congelados en cada fila. EL HISTORIAL
 *                       DE CAMBIOS SOBREVIVE, y se sigue sabiendo a qué tienda
 *                       fue cada uno. Es contabilidad de lo que hemos tocado en
 *                       la tienda de otro: el día que un cliente pregunte por
 *                       qué su producto salió a otro precio, esto es lo único
 *                       que lo puede contestar.
 *   amazon_clients   -> se queda. La ficha del cliente sigue en la pantalla,
 *                       lista para volver a conectarse.
 *
 * Devuelve cuántos cambios registrados se conservan, para poder enseñar un
 * número exacto en vez de una promesa.
 */
export async function disconnectConnection(connectionId: string): Promise<{
  sellingPartnerId: string
  keptSubmissions: number
}> {
  const service = createServiceClient()

  const { data, error } = await service
    .from('amazon_connections')
    .select('id, selling_partner_id')
    .eq('id', connectionId)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Esa conexión de Amazon ya no existe')

  const sellingPartnerId = (data as { selling_partner_id: string }).selling_partner_id

  const { count } = await service
    .from('amazon_submissions')
    .select('id', { count: 'exact', head: true })
    .eq('connection_id', connectionId)

  const { error: deleteError } = await service
    .from('amazon_connections')
    .delete()
    .eq('id', connectionId)
  if (deleteError) throw deleteError

  // El access token cacheado en memoria dura una hora. Sin esto, durante ese
  // rato el proceso seguiría teniendo un acceso válido a una tienda de la que
  // ya no tenemos autorización.
  clearAccessToken(connectionId)

  return { sellingPartnerId, keptSubmissions: count ?? 0 }
}

/**
 * A qué ficha de cliente pertenece un vendedor que llega desde el Appstore.
 *
 * En ese camino Amazon nos manda un `selling_partner_id` y nada más: no hay
 * ningún dato del ERP, así que hay que averiguarlo aquí. Se mira si ese
 * vendedor ya tiene alguna conexión, que es el caso real de este camino: la
 * re-autorización de los 365 días, donde el cliente ya existe.
 *
 * NO SE ABRE NINGUNA FICHA. Antes, cuando el vendedor no cuadraba con ninguna
 * conexión, esto creaba una ficha provisional «Sin identificar (ID)». El
 * problema es que /connect es PÚBLICA y sin sesión, y en toda la aplicación no
 * hay ningún límite de peticiones: cualquiera podía inventarse identificadores
 * que pasaran el `^[A-Z0-9]{6,24}$` y llenar amazon_clients de basura. Al
 * llegar a 25 fichas provisionales —el tope que había— la función devolvía null
 * y /connect empezaba a contestarle a TODO EL MUNDO «no podemos conectar más
 * cuentas ahora mismo», incluido un cliente de verdad. Y limpiarlo no se podía
 * hacer desde el ERP: no hay ninguna ruta que borre de amazon_clients y la
 * migración 118 le retira el DELETE a `authenticated`, así que había que entrar
 * al editor SQL de Supabase.
 *
 * Devolver null aquí NO es un error: es «a este vendedor no lo conocemos».
 * handleAppstoreEntry le enseña la página que le dice que nos pida el enlace,
 * que es además el camino que se usa de verdad para dar de alta a alguien nuevo
 * (el admin crea la ficha con nombre y todo, y genera el enlace).
 */
export async function resolveAppstoreClient(sellingPartnerId: string): Promise<AmazonClient | null> {
  const service = createServiceClient()

  const { data: existente, error } = await service
    .from('amazon_connections')
    .select('client_id')
    .eq('selling_partner_id', sellingPartnerId)
    .limit(1)
  if (error) throw error

  const clientId = (existente ?? [])[0]?.client_id as string | undefined
  if (!clientId) return null

  const { data, error: clientError } = await service
    .from('amazon_clients')
    .select('*')
    .eq('id', clientId)
    .maybeSingle()
  if (clientError) throw clientError
  return (data as AmazonClient | null) ?? null
}

/* ------------------------------------------------------------------ */
/* Refresco del catálogo                                               */
/* ------------------------------------------------------------------ */

export interface SyncResult {
  connectionId: string
  marketplaceId: string
  items: number
  /** El barrido se quedó corto: hay más de 1000 SKU y esta API no puede paginar más */
  truncated: boolean
  /** Cuántas dice Amazon que hay en total (numberOfResults). Con `items` al
      lado, es lo que permite decir cuántas se han quedado sin leer */
  declared: number
  confirmed: number
  /** Listings que Amazon ya no devuelve y se han quitado del espejo */
  removed: number
  error: string | null
}

/** Cuántas filas se escriben de una vez. Ni una a una (400 viajes) ni todas
    juntas (una consulta enorme que Postgres tiene que parsear entera) */
const UPSERT_CHUNK = 250

/**
 * Refresca el espejo del catálogo de una conexión.
 *
 * Es lo que llama el ciclo de cada quince minutos y también el botón de
 * «refrescar» de la pantalla.
 *
 * OJO CON UNA COSA QUE NO SE VE AQUÍ: este refresco NO puede pisar lo que
 * alguien esté editando en pantalla. Aquí se escribe la base; que la pantalla
 * avise de que hay datos nuevos en vez de recargar por encima es decisión de
 * la pantalla, y está escrito en la decisión E del módulo.
 */
export async function syncConnectionCatalog(
  connectionId: string,
  options: { marketplaceId?: string; updatedAfter?: string | null } = {}
): Promise<SyncResult[]> {
  const service = createServiceClient()
  const resolved = await connectionCredentials(connectionId)
  if (!resolved) {
    throw new Error('Esa conexión de Amazon ya no existe')
  }
  const { connection, credentials } = resolved

  /**
   * Sin país concreto se barren los suyos, PASADOS POR marketplacesCubiertos().
   *
   * NO se usa `connection.marketplace_ids` en crudo, y este es el punto entero:
   * Amazon devuelve ahí mercados que no son tiendas de esta aplicación —cuatro
   * de sandbox en la cuenta de Norteamérica— y al pedirles el catálogo
   * contestan 403 «falta el permiso necesario». Ese 403 caía en el `catch` de
   * abajo y marcaba la CONEXIÓN ENTERA como «con problemas» aunque Estados
   * Unidos hubiera ido perfecto.
   *
   * De ahí los tres síntomas que se veían a la vez y parecían tres problemas:
   *   · la cuenta salía «Con problemas» cada cuarto de hora;
   *   · «Reintentar» la arreglaba —esa ruta llama a getMarketplaceParticipations,
   *     una sola vez y sin país, así que nunca tocaba el mercado que fallaba—;
   *   · y decía «refrescado nunca» para siempre, porque `last_sync_at` solo se
   *     escribe si NO falló ninguno, y siempre fallaba alguno.
   *
   * Es además la misma lista que ya respetan Ingesta, Cobertura y la pantalla
   * del catálogo, así que incluye la elección de países hecha en Cuentas: lo
   * que no se ha marcado, no se pide.
   *
   * Si todavía no sabemos cuáles son —la lista se rellena al autorizar y puede
   * quedarse vacía si esa llamada falló— se barre UNO solo, el de entrada, en
   * vez de los cuatro de la región: multiplicar por cuatro las peticiones de
   * cada cuarto de hora contra países en los que probablemente no vende es un
   * precio alto por una lista que se va a rellenar sola. Desde la pantalla se
   * puede elegir cualquier otro y refrescarlo a mano.
   */
  const marketplaces = options.marketplaceId
    ? [options.marketplaceId]
    : connection.marketplace_ids.length > 0
      ? marketplacesCubiertos(connection)
      : [marketplaceDeEntrada(connection)].filter((m): m is string => Boolean(m))

  const results: SyncResult[] = []
  const ahora = new Date().toISOString()
  await service
    .from('amazon_connections')
    .update({ last_sync_attempt_at: ahora })
    .eq('id', connectionId)

  for (const marketplaceId of marketplaces) {
    // Se anota ANTES de pedir nada: todo lo que el barrido vea se va a escribir
    // con un last_seen_at posterior a este instante, así que lo que se quede por
    // debajo es lo que Amazon ya no devuelve. Ver purgeMissingListings().
    const inicioBarrido = new Date().toISOString()

    try {
      const catalogo = await fetchCatalog(credentials, {
        marketplaceId,
        updatedAfter: options.updatedAfter ?? null,
      })

      // El stock FBA solo se pide si hay algún listing FBA. Es la operación más
      // lenta de todas (2 peticiones por segundo) y pedirla para un cliente que
      // no usa FBA sería regalar la mitad del tiempo del refresco.
      const fba = catalogo.items.some((i) => i.isFba)
        ? await fetchFbaInventory(credentials, marketplaceId)
        : new Map()

      await upsertListings(service, connectionId, marketplaceId, catalogo.items, fba)
      const confirmed = await confirmSubmissions(
        service,
        connectionId,
        marketplaceId,
        catalogo.items
      )

      // Solo tras un barrido COMPLETO. Ver las tres condiciones dentro.
      const removed = await purgeMissingListings(service, {
        connectionId,
        marketplaceId,
        desde: inicioBarrido,
        completo: !options.updatedAfter && !catalogo.truncated,
        leidos: catalogo.items.length,
      })

      results.push({
        connectionId,
        marketplaceId,
        items: catalogo.items.length,
        truncated: catalogo.truncated,
        declared: catalogo.totalDeclared,
        confirmed,
        removed,
        error: null,
      })
    } catch (error) {
      results.push({
        connectionId,
        marketplaceId,
        items: 0,
        truncated: false,
        declared: 0,
        confirmed: 0,
        removed: 0,
        error: humanMessageOf(error),
      })

      // Un token que ya no vale no es un fallo pasajero: la conexión se marca y
      // deja de intentarse hasta que el cliente vuelva a autorizar. Si no, cada
      // quince minutos se repetiría el mismo error para siempre.
      //
      // SE COMPRUEBA EL ERROR A PROPÓSITO. supabase-js NO lanza cuando una
      // escritura falla: devuelve `{ error }` y sigue. Justo aquí eso importa
      // más que en ningún otro sitio de este fichero, porque esta escritura es
      // EL FRENO: si se pierde en silencio, la conexión se queda en 'activa' y
      // el cron vuelve a intentarlo cada quince minutos contra un token
      // revocado, para siempre y sin que quede rastro de por qué. Registrar no
      // cambia lo que se devuelve ni lo que ve nadie en pantalla.
      if (error instanceof AmazonApiError && error.kind === 'auth') {
        const { error: errorMarca } = await service
          .from('amazon_connections')
          .update({ status: 'revocada', status_detail: error.humanMessage })
          .eq('id', connectionId)
        if (errorMarca) {
          console.error(
            `[amazon] no se pudo marcar como revocada la conexión ${connectionId}; el cron va a seguir reintentándola cada 15 minutos:`,
            errorMarca
          )
        }
      } else if (error instanceof AmazonApiError && error.kind === 'permisos') {
        const { error: errorMarca } = await service
          .from('amazon_connections')
          .update({ status: 'error', status_detail: error.humanMessage })
          .eq('id', connectionId)
        if (errorMarca) {
          console.error(
            `[amazon] no se pudo marcar con error de permisos la conexión ${connectionId}; el cron va a seguir reintentándola cada 15 minutos:`,
            errorMarca
          )
        }
      }
    }
  }

  const fallo = results.find((r) => r.error)
  const total = results.reduce((sum, r) => sum + r.items, 0)
  // Si CUALQUIERA de los países se quedó corto, el catálogo de esta conexión no
  // está entero. Se guarda en la conexión y no solo en el resultado: quien
  // refresca de verdad es el cron, que no tiene a nadie delante a quien
  // enseñarle un aviso, y sin persistirlo la pantalla presentaba 1.000
  // referencias como si fueran todas.
  const truncado = results.some((r) => r.truncated)
  const declarado = results.reduce((sum, r) => sum + r.declared, 0)

  // SE COMPRUEBA EL ERROR A PROPÓSITO: supabase-js no lanza si falla. Esta
  // escritura es la que deja constancia de que el catálogo se quedó corto
  // (`last_sync_truncated`), que es lo que evita que la pantalla presente 1.000
  // referencias como si fueran todas. Perderla en silencio devuelve justo el
  // problema que ese campo existe para evitar.
  const { error: errorResumen } = await service
    .from('amazon_connections')
    .update(
      fallo
        ? { last_sync_error: fallo.error }
        : {
            last_sync_at: new Date().toISOString(),
            last_sync_items: total,
            last_sync_error: null,
            last_sync_truncated: truncado,
            last_sync_declared: declarado,
          }
    )
    .eq('id', connectionId)
  if (errorResumen) {
    console.error(
      `[amazon] el refresco de la conexión ${connectionId} terminó pero no se pudo anotar su resultado:`,
      errorResumen
    )
  }

  return results
}

/**
 * Quita del espejo los listings que Amazon ya no devuelve.
 *
 * POR QUÉ HACE FALTA. upsertListings solo hace UPSERT, así que un SKU que el
 * cliente cierra o borra en Seller Central se quedaba en amazon_listings PARA
 * SIEMPRE: en la pantalla, con su precio y su stock viejos, con la celda
 * editable, contando en «N referencias» y en el recuento del botón del cliente.
 * Si alguien le cambiaba el precio, el cambio salía y Amazon lo rechazaba. Y de
 * paso dejaba muerta la rama `gone` de mergeRefresh: el aviso «el SKU X ya no
 * está en el catálogo» no se disparaba nunca por una baja real, porque el
 * espejo siempre devolvía la fila.
 *
 * `last_seen_at` estaba ahí desde el primer día para esto —la migración 118 lo
 * dice en el comentario del índice idx_amazon_listings_frescura— y no lo leía
 * nadie.
 *
 * LAS TRES CONDICIONES, Y NINGUNA SOBRA:
 *
 *   - Barrido COMPLETO, o sea sin `updatedAfter`. Un incremental solo trae lo
 *     que ha cambiado, así que «no visto» ahí significa «no ha cambiado», no
 *     «ya no está»: purgar tras un incremental borra el catálogo entero menos
 *     lo que se movió esta vez.
 *   - Que NO se haya quedado corto. Si Amazon dejó de paginar a los 1000 SKU,
 *     lo que falta no es que no exista: es que no se ha llegado a leer.
 *   - Que el barrido haya traído ALGO. Un cero puede ser un catálogo vacío de
 *     verdad, pero también un hueco raro; y borrar el espejo entero se lleva
 *     por delante los `product_type`, que son lo que permite enviar cambios. Un
 *     puñado de filas viejas de más es infinitamente más barato que eso.
 */
async function purgeMissingListings(
  service: Service,
  params: {
    connectionId: string
    marketplaceId: string
    desde: string
    completo: boolean
    leidos: number
  }
): Promise<number> {
  if (!params.completo || params.leidos === 0) return 0

  const { data, error } = await service
    .from('amazon_listings')
    .delete()
    .eq('connection_id', params.connectionId)
    .eq('marketplace_id', params.marketplaceId)
    .lt('last_seen_at', params.desde)
    .select('id')
  if (error) throw error

  return (data ?? []).length
}

/* ------------------------------------------------------------------ */
/* El ciclo de cada quince minutos                                     */
/* ------------------------------------------------------------------ */

export interface SyncCycleResult {
  connections: number
  marketplaces: number
  items: number
  confirmed: number
  errors: number
  /** Qué falló y en qué conexión, para que el registro del cron diga algo */
  failures: Array<{ connectionId: string; marketplaceId: string; error: string }>
}

/**
 * Pausa entre conexiones.
 *
 * NO es por el cupo de Amazon: ese va por vendedor y por aplicación, así que
 * dos clientes distintos no compiten entre sí. Es por nosotros. Sin esta pausa,
 * veinte clientes arrancan veinte barridos a la vez en el mismo proceso de
 * Node, y el contenedor que además está sirviendo el ERP se queda sin aire justo
 * cada cuarto de hora, en punto. Medio segundo entre clientes reparte el
 * trabajo dentro de una ventana en la que sobran catorce minutos.
 */
const STAGGER_MS = 500

/**
 * Refresca el catálogo de TODAS las conexiones vivas.
 *
 * Es lo que llama el cron del contenedor cada quince minutos
 * (scripts/amazon-sync.sh). Que exista este ciclo del lado del servidor y no un
 * temporizador en el navegador es lo que hace que el espejo esté al día cuando
 * alguien abre la pantalla, en vez de empezar a estarlo entonces.
 *
 * NUNCA LANZA. Un cliente cuyo token ha caducado no puede impedir que se
 * refresquen los otros diecinueve: syncConnectionCatalog ya devuelve el fallo
 * como dato y marca la conexión, y aquí solo se cuenta.
 *
 * Las conexiones que no están activas se saltan sin más. Insistir cada quince
 * minutos contra una cuenta que ya nos ha retirado el acceso no la recupera:
 * eso lo arregla el cliente volviendo a autorizar.
 */
export async function syncAllConnections(): Promise<SyncCycleResult> {
  const service = createServiceClient()
  const salida: SyncCycleResult = {
    connections: 0,
    marketplaces: 0,
    items: 0,
    confirmed: 0,
    errors: 0,
    failures: [],
  }

  let conexiones: AmazonConnection[]
  try {
    conexiones = await fetchAll<AmazonConnection>((a, b) =>
      service
        .from('amazon_connections')
        .select(CONNECTION_FIELDS)
        .eq('is_active', true)
        .eq('status', 'activa')
        .order('id')
        .range(a, b)
    )
  } catch (error) {
    // Sin tablas todavía (la migración se lanza a mano en Supabase) el cron no
    // tiene nada que hacer, y desde luego no tiene que dejar un error cada
    // cuarto de hora en el registro del contenedor.
    if (isMissingSchema(error)) return salida
    throw error
  }

  for (const conn of conexiones) {
    salida.connections += 1
    try {
      const resultados = await syncConnectionCatalog(conn.id)
      for (const r of resultados) {
        salida.marketplaces += 1
        salida.items += r.items
        salida.confirmed += r.confirmed
        if (r.error) {
          salida.errors += 1
          salida.failures.push({
            connectionId: r.connectionId,
            marketplaceId: r.marketplaceId,
            error: r.error,
          })
        }
      }
    } catch (error) {
      salida.errors += 1
      salida.failures.push({
        connectionId: conn.id,
        marketplaceId: '—',
        error: humanMessageOf(error),
      })
    }

    if (STAGGER_MS > 0) {
      await new Promise((resolve) => setTimeout(resolve, STAGGER_MS))
    }
  }

  return salida
}

/**
 * Vuelca el catálogo leído en amazon_listings.
 *
 * `is_fba` NO se escribe y no es un olvido: la genera la base a partir del
 * canal de logística. Mandarla en el upsert daría un error de Postgres
 * («cannot insert into a generated column») que tumbaría el refresco entero.
 */
async function upsertListings(
  service: Service,
  connectionId: string,
  marketplaceId: string,
  items: AmazonCatalogItem[],
  fba: Map<string, { total: number | null; fulfillable: number | null }>
): Promise<void> {
  if (items.length === 0) return
  const ahora = new Date().toISOString()

  const filas = items.map((item) => {
    const stockFba = fba.get(item.sku)
    return {
      connection_id: connectionId,
      marketplace_id: marketplaceId,
      sku: item.sku,
      asin: item.asin,
      title: item.title,
      product_type: item.productType,
      condition_type: item.conditionType,
      listing_status: item.listingStatus,
      price: item.price,
      currency: item.currency,
      quantity: item.quantity,
      fulfillment_channel_code: item.fulfillmentChannelCode,
      fba_quantity: stockFba?.total ?? null,
      fba_fulfillable_quantity: stockFba?.fulfillable ?? null,
      last_seen_at: ahora,
      amazon_last_updated_at: item.amazonLastUpdatedAt,
    }
  })

  for (let i = 0; i < filas.length; i += UPSERT_CHUNK) {
    const { error } = await service
      .from('amazon_listings')
      .upsert(filas.slice(i, i + UPSERT_CHUNK), {
        onConflict: 'connection_id,marketplace_id,sku',
      })
    if (error) throw error
  }
}

/** Margen para comparar precios. Amazon puede devolver 14.99 o 14.990 */
const PRICE_EPSILON = 0.005

/**
 * Pasa a «confirmado» lo que Amazon ya ha aplicado de verdad.
 *
 * Existe porque ACCEPTED no significa aplicado: Amazon acepta la petición y la
 * procesa después. Lo único que prueba que el cambio llegó es volver a leer el
 * listing y ver el valor nuevo — y eso es exactamente lo que acaba de hacer el
 * refresco, así que sale gratis.
 *
 * Lo que se queda en «aceptado» varios refrescos seguidos es la señal de que
 * algo no cuadra, y ahora se puede ver.
 */
async function confirmSubmissions(
  service: Service,
  connectionId: string,
  marketplaceId: string,
  items: AmazonCatalogItem[]
): Promise<number> {
  // PAGINADO A PROPÓSITO. Antes esto era un select suelto: PostgREST lo habría
  // cortado a 1000 filas SIN dar error, y lo que cae fuera del corte no se
  // confirma NUNCA. Este módulo es el que va a empujar precio y stock de 13.700
  // referencias, así que en cuanto se use para lo que está hecho, un envío
  // masivo dejaría miles de cambios eternamente en «aceptado» aunque Amazon ya
  // los hubiera aplicado. Hoy la tabla tiene 3 filas y devuelve las mismas 3.
  //
  // El `.order('id')` es imprescindible, no decorativo: sin ORDER BY, qué 1000
  // filas vuelven en cada tramo lo decide el planificador de Postgres, así que
  // paginar sin orden repite unas filas y se salta otras para siempre.
  const pendientes = await fetchAll<{
    id: string
    sku: string
    field: AmazonSubmissionField
    new_value: string
  }>((desde, hasta) =>
    service
      .from('amazon_submissions')
      .select('id, sku, field, new_value')
      .eq('connection_id', connectionId)
      .eq('marketplace_id', marketplaceId)
      .in('status', ['pendiente', 'aceptado'])
      .order('id', { ascending: true })
      .range(desde, hasta)
  )
  if (pendientes.length === 0) return 0

  const porSku = new Map(items.map((i) => [i.sku, i]))
  const confirmados: string[] = []

  for (const p of pendientes) {
    const item = porSku.get(p.sku)
    if (!item) continue
    const esperado = Number(p.new_value)
    if (!Number.isFinite(esperado)) continue

    if (p.field === 'precio') {
      if (item.price !== null && Math.abs(item.price - esperado) < PRICE_EPSILON) {
        confirmados.push(p.id)
      }
    } else if (item.quantity !== null && item.quantity === esperado) {
      confirmados.push(p.id)
    }
  }

  if (confirmados.length === 0) return 0

  const { error: updateError } = await service
    .from('amazon_submissions')
    .update({ status: 'confirmado', confirmed_at: new Date().toISOString() })
    .in('id', confirmados)
  if (updateError) throw updateError

  return confirmados.length
}

/* ------------------------------------------------------------------ */
/* Enviar cambios                                                      */
/* ------------------------------------------------------------------ */

export interface ChangeToSend {
  sku: string
  marketplaceId: string
  field: AmazonSubmissionField
  /** Precio en la divisa del listing, o unidades enteras */
  newValue: number
}

export interface SendChangesInput {
  connectionId: string
  changes: ChangeToSend[]
  /**
   * DE DÓNDE VIENE ESTE LOTE. Ver la decisión I del módulo:
   *   'manual'  -> alguien lo tecleó en la pantalla (lo único implementado hoy)
   *   'fichero' -> lo produjo el procesado de un fichero del cliente (fase 2)
   *
   * El parámetro existe desde el primer día para que la fase 2 —enchufar el
   * motor de cruce de lib/stock-sync/engine.ts a esta API— no tenga que tocar
   * ni esta firma ni la tabla del registro. Cuando llegue, quien procese el
   * fichero llamará aquí con source:'fichero' y el nombre del fichero en
   * sourceRef, y todo lo demás (cupo, reintentos, registro, confirmación) ya
   * funciona.
   */
  source: AmazonChangeSource
  /** Obligatorio cuando source es 'fichero': de qué fichero o proceso salió */
  sourceRef?: string | null
  userId: string | null
  /**
   * Con qué identificador se agrupa este envío en el registro.
   *
   * Existe porque la pantalla NO manda un lote grande en una sola petición: lo
   * parte en tramos para poder enseñar una barra de progreso de verdad, y
   * porque cuatrocientos cambios en una sola llamada son minuto y medio de HTTP
   * abierto, que cualquier proxy corta por el camino dejando el envío a medias
   * y sin saber por dónde iba.
   *
   * Partirlo sin esto rompería lo único que hace que `batch_id` sirva para
   * algo: que las filas que salieron juntas se puedan reconocer juntas —y, el
   * día que se implemente deshacer, revertir juntas—. Así que el primer tramo
   * lo genera y los siguientes lo reciben. Si no viene, se genera uno.
   */
  batchId?: string | null
  /**
   * Solo pregunta a Amazon si el dato valdría, sin aplicarlo. No deja registro:
   * una validación no es un cambio, y meterla en el histórico haría ilegible lo
   * único para lo que ese histórico existe.
   */
  validateOnly?: boolean
}

export interface SentChange {
  sku: string
  marketplaceId: string
  field: AmazonSubmissionField
  previousValue: number | null
  newValue: number
  /** Divisa del cambio de precio; null en los de stock. Viaja hasta la pantalla
      de resultado para que allí también se lea «14,99 €» y no un «14,99» pelado
      —con un cliente que vende en euros y en dólares a la vez, un número sin
      divisa en la pantalla que confirma lo que se ha mandado no es un dato */
  currency: string | null
  status: 'aceptado' | 'invalido' | 'error'
  message: string | null
  submissionId: string | null
}

export interface SendChangesResult {
  batchId: string
  results: SentChange[]
  accepted: number
  failed: number
  /**
   * POR QUÉ SE CORTÓ EL LOTE ANTES DE TERMINAR, si es que se cortó.
   *
   * Se rellena cuando Amazon contesta que la autorización ya no vale o que
   * faltan permisos: eso no es el fallo de UN cambio, es el fallo de la
   * conexión entera, y seguir mandando los 395 restantes solo consigue 395
   * canjes de token fallidos contra Amazon y 395 filas de error idénticas.
   *
   * La pantalla lo usa para NO ofrecer el botón de reintentar: reintentar
   * contra una conexión revocada vuelve a dispararlo todo para nada.
   */
  abortReason: string | null
}

/**
 * Envía un lote de cambios a Amazon y lo deja todo registrado.
 *
 * EL ORDEN DE LAS COSAS ES LO IMPORTANTE:
 *
 *   1. Se leen los listings del espejo. De ahí salen tres datos sin los que no
 *      se puede enviar nada: el `product_type` (obligatorio en cada PATCH), el
 *      canal de logística (para no intentar escribir el stock de un FBA) y el
 *      VALOR ANTERIOR, que es lo que hace que este registro sirva para algo.
 *
 *   2. Se escribe el registro ANTES de llamar a Amazon, con `sent_at` puesto.
 *      Si el proceso se cayera justo después de enviar, la fila se queda en
 *      «pendiente» CON hora de salida, que es exactamente la verdad: salió y no
 *      sabemos qué contestaron. Al revés —registrar después— un cambio que
 *      llegó a la tienda del cliente no dejaría ni rastro, y ese es el caso que
 *      este módulo no se puede permitir.
 *
 *   3. Se envían de uno en uno. El cupo (5 por segundo y por vendedor) lo
 *      gestiona el cubo de fichas, así que 40 cambios son unos 8 segundos.
 *      Un feed de Amazon iría en un solo envío, pero se perdería el resultado
 *      por SKU y el identificador de envío de cada uno: por debajo de un par de
 *      miles de SKU, uno a uno gana en tiempo y por goleada en trazabilidad.
 */
export async function sendChanges(input: SendChangesInput): Promise<SendChangesResult> {
  const service = createServiceClient()
  const resolved = await connectionCredentials(input.connectionId)
  if (!resolved) throw new Error('Esa conexión de Amazon ya no existe')
  const { connection, credentials } = resolved

  if (connection.status !== 'activa' || !connection.is_active) {
    throw new AmazonApiError({
      kind: 'auth',
      message: `conexión ${connection.id} en estado ${connection.status}`,
      humanMessage:
        connection.status_detail ??
        'Esta conexión no está activa, así que no se puede enviar nada a la tienda del cliente.',
    })
  }

  if (input.source === 'fichero' && !input.sourceRef) {
    throw new Error('Un cambio que viene de un fichero tiene que decir de qué fichero')
  }

  /**
   * LA COTA DE CORDURA, AQUÍ Y NO SOLO EN LA RUTA HTTP.
   *
   * validateIncomingChange() (lib/amazon/catalogo.ts) ya comprueba esto, pero
   * es la puerta de la petición del navegador: el ciclo automático llama a
   * sendChanges() directamente y no la atraviesa. Un precio de 0,00 € o un
   * stock negativo llegado por ahí se publicaba sin que nada lo mirara.
   *
   * Se comprueba el LOTE ENTERO y se rechaza entero, igual que un freno: si un
   * solo valor es imposible, lo que está mal es el cálculo que lo produjo, y
   * mandar los otros 394 «porque esos sí valen» es exactamente cómo se publica
   * media verdad.
   */
  for (const c of input.changes) {
    if (typeof c.newValue !== 'number' || !Number.isFinite(c.newValue)) {
      throw new Error(`El valor que se quiere poner en el SKU ${c.sku} no es un número`)
    }
    if (c.field === 'precio' && (c.newValue <= 0 || c.newValue > MAX_PRICE)) {
      throw new Error(
        `El precio ${c.newValue} del SKU ${c.sku} está fuera de lo que se puede enviar ` +
          `(mayor que 0 y hasta ${MAX_PRICE}). No se manda nada del lote.`
      )
    }
    if (
      c.field === 'cantidad' &&
      (!Number.isInteger(c.newValue) || c.newValue < 0 || c.newValue > MAX_QUANTITY)
    ) {
      throw new Error(
        `El stock ${c.newValue} del SKU ${c.sku} no es un número entero de unidades entre 0 y ` +
          `${MAX_QUANTITY}. No se manda nada del lote.`
      )
    }
  }

  const batchId = input.batchId ?? randomUUID()

  // ---- 1. El espejo, para el product_type, el canal y el valor anterior ----
  const skus = Array.from(new Set(input.changes.map((c) => c.sku)))
  const marketplaces = Array.from(new Set(input.changes.map((c) => c.marketplaceId)))

  const espejo = await fetchAll<AmazonListing>((a, b) =>
    service
      .from('amazon_listings')
      .select(LISTING_FIELDS)
      .eq('connection_id', input.connectionId)
      .in('marketplace_id', marketplaces)
      .in('sku', skus)
      .order('sku', { ascending: true })
      .order('marketplace_id', { ascending: true })
      .order('id')
      .range(a, b)
  )
  const porClave = new Map(espejo.map((l) => [`${l.marketplace_id}|${l.sku}`, l]))

  // ---- 2. El registro, antes de llamar a nadie ----
  const ahora = new Date().toISOString()
  interface Preparado {
    change: ChangeToSend
    listing: AmazonListing | undefined
    previousValue: number | null
    currency: string | null
  }

  const preparados: Preparado[] = input.changes.map((change) => {
    const listing = porClave.get(`${change.marketplaceId}|${change.sku}`)
    const previousValue =
      change.field === 'precio' ? (listing?.price ?? null) : (listing?.quantity ?? null)
    // La divisa sale del listing; si aún no tiene precio, la del marketplace.
    const currency =
      change.field === 'precio'
        ? (listing?.currency ?? marketplaceById(change.marketplaceId)?.currency ?? null)
        : null
    return { change, listing, previousValue, currency }
  })

  let filas: Array<{ id: string }> = []
  if (!input.validateOnly) {
    const { data, error } = await service
      .from('amazon_submissions')
      .insert(
        preparados.map((p) => ({
          connection_id: input.connectionId,
          selling_partner_id: connection.selling_partner_id,
          marketplace_id: p.change.marketplaceId,
          sku: p.change.sku,
          asin: p.listing?.asin ?? null,
          field: p.change.field,
          previous_value: p.previousValue === null ? null : String(p.previousValue),
          new_value: String(p.change.newValue),
          currency: p.currency,
          source: input.source,
          source_ref: input.sourceRef ?? null,
          batch_id: batchId,
          created_by: input.userId,
          status: 'pendiente',
          sent_at: ahora,
        }))
      )
      .select('id')
    if (error) throw error
    filas = (data ?? []) as Array<{ id: string }>
  }

  // ---- 3. A Amazon, de uno en uno ----
  const results: SentChange[] = []
  /**
   * Se rellena en cuanto Amazon dice que la autorización no vale o que faltan
   * permisos. A partir de ahí NO SE VUELVE A LLAMAR: lo que queda del lote se
   * marca de una sola vez y se sale. Ver el comentario de abortReason.
   */
  let abortReason: string | null = null

  for (let i = 0; i < preparados.length; i++) {
    const { change, listing, previousValue, currency } = preparados[i]
    const submissionId = filas[i]?.id ?? null

    let outcome: SentChange = {
      sku: change.sku,
      marketplaceId: change.marketplaceId,
      field: change.field,
      previousValue,
      newValue: change.newValue,
      currency,
      status: 'error',
      message: null,
      submissionId: null,
    }

    if (!listing || !listing.product_type) {
      outcome.message =
        'No tenemos este SKU en el catálogo leído, o no conocemos su tipo de producto. Refresca el catálogo antes de enviarlo.'
    } else {
      const target: ListingTarget = {
        sku: listing.sku,
        marketplaceId: listing.marketplace_id,
        productType: listing.product_type,
        fulfillmentChannelCode: listing.fulfillment_channel_code,
      }

      try {
        const res = await applyChange(credentials, target, {
          field: change.field,
          value: change.newValue,
          currency,
          validateOnly: input.validateOnly,
        })
        outcome = {
          ...outcome,
          status: res.status,
          message: res.message,
          submissionId: res.submissionId,
        }

        if (submissionId) {
          // SE COMPRUEBA EL ERROR A PROPÓSITO. supabase-js NO lanza cuando una
          // escritura falla: devuelve `{ error }` y sigue. Comprobado contra la
          // base real que un `.update()` contra una columna inexistente NO tira
          // excepción, solo trae PGRST204 dentro de `error`.
          //
          // Esta escritura concreta ocurre DESPUÉS de que el precio o el stock
          // ya hayan salido hacia la tienda del cliente. Si se pierde en
          // silencio, el cambio está aplicado en Amazon y aquí sigue constando
          // como pendiente: el siguiente refresco lo vuelve a mandar. Registrar
          // no cambia lo que se le devuelve a la pantalla; solo deja rastro.
          const { error: errorSubmission } = await service
            .from('amazon_submissions')
            .update({
              status: res.status,
              submission_id: res.submissionId,
              request_id: res.requestId,
              http_status: res.httpStatus,
              issues: res.issues.length > 0 ? res.issues : null,
              // El CHECK de la migración exige motivo en todo lo que falla, así
              // que aquí nunca puede quedar a null en 'invalido' ni en 'error'.
              error_message:
                res.status === 'aceptado'
                  ? res.message
                  : (res.message ?? 'Amazon ha rechazado el cambio sin decir por qué.'),
              attempts: res.attempts,
            })
            .eq('id', submissionId)
          if (errorSubmission) {
            console.error(
              `[amazon] el cambio de ${change.field} en ${change.sku} salió hacia Amazon con estado "${res.status}" pero NO se pudo anotar en amazon_submissions ${submissionId}:`,
              errorSubmission
            )
          }
        }
      } catch (error) {
        outcome.message = humanMessageOf(error)
        if (submissionId) {
          // Mismo motivo que arriba: supabase-js no lanza si la escritura falla.
          // Perder ESTA en silencio deja el cambio marcado como pendiente
          // cuando en realidad ya se intentó y falló.
          const { error: errorSubmission } = await service
            .from('amazon_submissions')
            .update({
              status: 'error',
              error_message: outcome.message,
              // El número real de intentos que costó, no un 1 fijo: un cambio
              // que salió tres veces hacia Amazon y falló tiene que poder
              // distinguirse de uno que salió una. Ver AmazonApiError.attempts.
              attempts: error instanceof AmazonApiError ? error.attempts : 1,
            })
            .eq('id', submissionId)
          if (errorSubmission) {
            console.error(
              `[amazon] no se pudo anotar el fallo del cambio de ${change.field} en ${change.sku} en amazon_submissions ${submissionId}:`,
              errorSubmission
            )
          }
        }

        // UN FALLO DE LA CONEXIÓN NO ES UN FALLO DE ESTE CAMBIO.
        //
        // Si el cliente ha retirado el acceso, el cambio 6 va a fallar igual
        // que el 5, y el 400 igual que el 6. Sin este corte, un lote de 400 SKU
        // contra una autorización revocada son ~395 canjes de token fallidos
        // seguidos contra api.amazon.com, 395 filas de error idénticas y —lo
        // peor— la conexión sigue en verde en la pantalla hasta que pase el
        // cron de quince minutos. Se corta aquí, se marca la conexión igual que
        // hace syncConnectionCatalog, y se dice por qué.
        if (
          error instanceof AmazonApiError &&
          (error.kind === 'auth' || error.kind === 'permisos')
        ) {
          abortReason = error.humanMessage
          await service
            .from('amazon_connections')
            .update({
              status: error.kind === 'auth' ? 'revocada' : 'error',
              status_detail: error.humanMessage,
            })
            .eq('id', input.connectionId)
        }
      }
    }

    if (outcome.status === 'error' && submissionId && outcome.message) {
      // Los cortes de antes de llamar (sin product_type) también se registran:
      // un cambio que la persona dio por enviado y no salió tiene que constar.
      await service
        .from('amazon_submissions')
        .update({ status: 'error', error_message: outcome.message })
        .eq('id', submissionId)
    }

    results.push(outcome)

    if (abortReason) {
      // Lo que queda se marca DE UNA VEZ y sin volver a llamar a Amazon. El
      // mensaje dice que ni se intentó, que es distinto de «se intentó y
      // falló»: sobre lo primero se sabe con certeza que no ha llegado a la
      // tienda del cliente.
      const restantes = preparados.slice(i + 1)
      const motivo = `No se ha intentado: el envío se cortó antes de llegar a este cambio. ${abortReason}`

      const idsRestantes = filas
        .slice(i + 1, preparados.length)
        .map((f) => f.id)
        .filter(Boolean)
      if (idsRestantes.length > 0) {
        await service
          .from('amazon_submissions')
          .update({ status: 'error', error_message: motivo })
          .in('id', idsRestantes)
      }

      for (const p of restantes) {
        results.push({
          sku: p.change.sku,
          marketplaceId: p.change.marketplaceId,
          field: p.change.field,
          previousValue: p.previousValue,
          newValue: p.change.newValue,
          currency: p.currency,
          status: 'error',
          message: motivo,
          submissionId: null,
        })
      }
      break
    }
  }

  return {
    batchId,
    results,
    accepted: results.filter((r) => r.status === 'aceptado').length,
    failed: results.filter((r) => r.status !== 'aceptado').length,
    abortReason,
  }
}

/**
 * Deshace un lote: vuelve a poner los valores anteriores.
 *
 * NO ESTÁ IMPLEMENTADO todavía, y la firma está aquí para que se vea que el
 * modelo lo admite: amazon_submissions guarda `previous_value` precisamente
 * para esto, y `batch_id` agrupa lo que salió junto. Deshacer es mandar otro
 * lote con los valores de vuelta, que quedará registrado como cualquier otro
 * cambio — nunca borrar filas del histórico.
 *
 * Los dos parámetros no se usan, y se quedan: son la firma con la que va a
 * nacer esto, y borrarlos para callar al linter obligaría a que quien lo
 * implemente vuelva a averiguar qué hacía falta.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function undoBatch(_batchId: string, _userId: string | null): Promise<never> {
  throw new Error('Deshacer un envío todavía no está implementado')
}
