/**
 * MARKETING API · LA CONEXIÓN GUARDADA Y CÓMO SE LLAMA A AMAZON
 * ============================================================
 * SOLO SERVIDOR: descifra refresh tokens.
 *
 * De momento hace tres cosas y ninguna más: guardar la autorización, tener
 * siempre un access token válido, y llamar a la API. Nada de campañas ni
 * informes todavía — eso viene cuando esté decidida la estructura.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { decryptToken, encryptToken, hasTokenKey } from '@/lib/amazon/crypto'
import { ENDPOINTS, credenciales, type RegionAds } from './config'
import { AdsError, caducado, renovarAccessToken, type TokensAds } from './oauth'

export interface ConexionAds {
  id: string
  clientId: string
  region: RegionAds
  estado: 'activa' | 'revocada' | 'error'
  ultimoError: string | null
  conectadoAt: string
  ultimoUsoAt: string | null
}

export interface PerfilAds {
  id: string
  profile_id: number
  pais: string | null
  moneda: string | null
  zona_horaria: string | null
  tipo: string | null
  nombre: string | null
  id_externo: string | null
  /** true = esta cuenta se trabaja. Nace en false: ver la migración 149 */
  en_uso: boolean
  visto_at: string
}

/* ------------------------------------------------------------------ */
/* Guardar                                                             */
/* ------------------------------------------------------------------ */

/**
 * Guarda —o sustituye— la autorización de un cliente.
 *
 * Es un upsert sobre (client_id, region) a propósito: volver a conectar tiene
 * que PISAR la autorización anterior, no dejar dos vivas. Con dos, nada dice
 * cuál se usa, y la que sobra sigue siendo un refresh token válido de la cuenta
 * de un cliente guardado en una fila que nadie mira.
 */
export async function guardarConexion(params: {
  clienteId: string
  region: RegionAds
  tokens: TokensAds
  userId: string | null
}): Promise<string> {
  if (!hasTokenKey()) {
    throw new AdsError(
      'El servidor no tiene AMAZON_TOKEN_KEY, así que no se puede cifrar el token. No se guarda ' +
        'nada: un refresh token en claro en la base es exactamente lo que esto existe para evitar.'
    )
  }

  const service = createServiceClient()
  const { data, error } = await service
    .from('ads_connections')
    .upsert(
      {
        client_id: params.clienteId,
        region: params.region,
        refresh_token_cifrado: encryptToken(params.tokens.refreshToken),
        access_token_cifrado: encryptToken(params.tokens.accessToken),
        access_token_expira_at: params.tokens.expiraEn,
        estado: 'activa',
        ultimo_error: null,
        conectado_por: params.userId,
        conectado_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'client_id,region' }
    )
    .select('id')
    .single()

  if (error) throw error
  return data.id as string
}

export async function leerConexion(clienteId: string): Promise<ConexionAds | null> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('ads_connections')
    .select('id, client_id, region, estado, ultimo_error, conectado_at, ultimo_uso_at')
    .eq('client_id', clienteId)
    .order('conectado_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  if (!data) return null
  return {
    id: data.id as string,
    clientId: data.client_id as string,
    region: (data.region as RegionAds) ?? 'eu',
    estado: data.estado as ConexionAds['estado'],
    ultimoError: (data.ultimo_error as string | null) ?? null,
    conectadoAt: data.conectado_at as string,
    ultimoUsoAt: (data.ultimo_uso_at as string | null) ?? null,
  }
}

/* ------------------------------------------------------------------ */
/* Llamar a Amazon                                                     */
/* ------------------------------------------------------------------ */

/**
 * Un access token válido, renovándolo si hace falta.
 *
 * El renovado se guarda porque duran una hora y el canje cuesta un viaje: sin
 * guardarlo, cada llamada al ERP haría dos a Amazon. Es cache, y por eso un
 * fallo al guardarlo no tumba la llamada — el token ya está en la mano.
 */
async function accessTokenDe(conexionId: string): Promise<{ token: string; region: RegionAds }> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('ads_connections')
    .select('region, refresh_token_cifrado, access_token_cifrado, access_token_expira_at, estado')
    .eq('id', conexionId)
    .single()

  if (error) throw error
  if (data.estado === 'revocada') {
    throw new AdsError(
      'Este cliente ha revocado la autorización de Amazon Ads. Hay que volver a conectar.',
      { esDeAutorizacion: true }
    )
  }

  const region = (data.region as RegionAds) ?? 'eu'

  if (data.access_token_cifrado && !caducado(data.access_token_expira_at as string | null)) {
    return { token: decryptToken(data.access_token_cifrado as string), region }
  }

  const tokens = await renovarAccessToken(
    decryptToken(data.refresh_token_cifrado as string),
    region
  )

  const { error: errorGuardado } = await service
    .from('ads_connections')
    .update({
      access_token_cifrado: encryptToken(tokens.accessToken),
      access_token_expira_at: tokens.expiraEn,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conexionId)

  if (errorGuardado) {
    console.error('[ads] no se ha podido guardar el access token renovado:', errorGuardado)
  }

  return { token: tokens.accessToken, region }
}

/**
 * Una llamada a la API de Ads.
 *
 * `perfilId` va en `Amazon-Advertising-API-Scope` y es OBLIGATORIO en casi todo
 * menos en `/v2/profiles`, que es justo el que lo devuelve. De ahí el orden: se
 * traen los perfiles primero y a partir de ahí ya se puede pedir cualquier cosa.
 */
export async function llamarAds<T>(
  conexionId: string,
  ruta: string,
  opciones: { perfilId?: number | string; metodo?: string; cuerpo?: unknown } = {}
): Promise<T> {
  const cred = credenciales()
  if (!cred) throw new AdsError('Faltan las credenciales de Amazon Ads en el servidor.')

  const { token, region } = await accessTokenDe(conexionId)

  const cabeceras: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Amazon-Advertising-API-ClientId': cred.clientId,
    'Content-Type': 'application/json',
  }
  if (opciones.perfilId != null) {
    cabeceras['Amazon-Advertising-API-Scope'] = String(opciones.perfilId)
  }

  const res = await fetch(`${ENDPOINTS[region].api}${ruta}`, {
    method: opciones.metodo ?? 'GET',
    headers: cabeceras,
    body: opciones.cuerpo === undefined ? undefined : JSON.stringify(opciones.cuerpo),
  })

  const texto = await res.text()

  if (!res.ok) {
    // El 401 se marca en la conexión: es la diferencia entre «Amazon está
    // pachucho» y «este cliente nos ha quitado el acceso», y solo el segundo
    // exige que alguien haga algo.
    if (res.status === 401 || res.status === 403) {
      const service = createServiceClient()
      await service
        .from('ads_connections')
        .update({
          estado: 'error',
          ultimo_error: `Amazon ha contestado ${res.status} a ${ruta}. Puede ser que el cliente haya revocado el acceso.`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', conexionId)
    }
    throw new AdsError(
      `Amazon Ads ha contestado ${res.status} a ${ruta}: ${texto.slice(0, 300) || 'sin cuerpo'}`,
      { esDeAutorizacion: res.status === 401 || res.status === 403 }
    )
  }

  const service = createServiceClient()
  await service
    .from('ads_connections')
    .update({ ultimo_uso_at: new Date().toISOString(), estado: 'activa', ultimo_error: null })
    .eq('id', conexionId)

  return (texto ? JSON.parse(texto) : null) as T
}

/* ------------------------------------------------------------------ */
/* Los perfiles: las cuentas de anunciante del cliente                 */
/* ------------------------------------------------------------------ */

/** Tal y como los devuelve `/v2/profiles`, con lo que se usa de cada uno */
interface PerfilCrudo {
  profileId: number
  countryCode?: string
  currencyCode?: string
  timezone?: string
  accountInfo?: { marketplaceStringId?: string; id?: string; type?: string; name?: string }
}

/**
 * Trae las cuentas de anunciante y las guarda.
 *
 * Es lo PRIMERO que hay que hacer después de conectar: sin un profileId no se
 * puede pedir absolutamente nada más, porque va en la cabecera de todas las
 * demás llamadas.
 *
 * Se guarda también la respuesta cruda. En esta fase es a propósito: todavía no
 * se sabe qué campos harán falta, y descubrirlo con el dato delante no cuesta
 * nada frente a volver a pedírselo a Amazon.
 */
export async function traerPerfiles(conexionId: string): Promise<PerfilAds[]> {
  const crudos = await llamarAds<PerfilCrudo[]>(conexionId, '/v2/profiles')
  const service = createServiceClient()
  const ahora = new Date().toISOString()

  const filas = (crudos ?? []).map((p) => ({
    connection_id: conexionId,
    profile_id: p.profileId,
    pais: p.countryCode ?? null,
    moneda: p.currencyCode ?? null,
    zona_horaria: p.timezone ?? null,
    tipo: p.accountInfo?.type ?? null,
    nombre: p.accountInfo?.name ?? null,
    id_externo: p.accountInfo?.id ?? null,
    crudo: p as unknown as Record<string, unknown>,
    visto_at: ahora,
    // `en_uso` NO va en el upsert a proposito: refrescar la lista de cuentas no
    // puede desmarcar las que ya se estaban trabajando. Al insertar una nueva,
    // el DEFAULT false de la columna hace su trabajo.
  }))

  if (filas.length > 0) {
    const { error } = await service
      .from('ads_profiles')
      .upsert(filas, { onConflict: 'connection_id,profile_id' })
    if (error) throw error
  }

  return await listarPerfiles(conexionId)
}

export async function listarPerfiles(conexionId: string): Promise<PerfilAds[]> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('ads_profiles')
    .select('id, profile_id, pais, moneda, zona_horaria, tipo, nombre, id_externo, en_uso, visto_at')
    .eq('connection_id', conexionId)
    .order('pais')
    .order('profile_id')

  if (error) throw error
  return (data ?? []) as PerfilAds[]
}

/**
 * Marca —o desmarca— una cuenta de anunciante como «se trabaja».
 *
 * Es lo único que decide si el ERP le va a pedir informes y guardar sus datos.
 * Ver la migración 149: nacen todas apagadas porque al conectar salen también
 * las cuentas de encargos viejos a las que el correo autorizado sigue llegando.
 */
export async function marcarPerfilEnUso(perfilId: string, enUso: boolean): Promise<void> {
  const service = createServiceClient()
  const { error } = await service
    .from('ads_profiles')
    .update({ en_uso: enUso })
    .eq('id', perfilId)
  if (error) throw error
}
