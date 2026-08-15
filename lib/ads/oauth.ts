/**
 * MARKETING API · EL BAILE DE OAUTH CON AMAZON
 * ============================================
 * SOLO SERVIDOR: aquí se tocan el client_secret y los refresh tokens.
 *
 * Tres pasos y ninguno es opcional:
 *
 *   1. `urlDeAutorizacion()` manda al cliente a Amazon con un `state` que
 *      acabamos de guardar.
 *   2. Amazon vuelve a nuestro callback con un `code` y ese mismo `state`.
 *   3. `canjearCodigo()` cambia el código por un refresh token, que es el que
 *      dura y el que se guarda cifrado.
 *
 *
 * ============ EL `state` NO ES BUROCRACIA ============
 *
 * Es lo único que garantiza que la vuelta corresponde a una ida NUESTRA. Sin
 * comprobarlo, cualquiera puede llamar a `/api/ads/oauth/callback` con un `code`
 * conseguido por su cuenta y dejar SU cuenta de anunciante conectada al cliente
 * que elija. A partir de ahí, todo lo que el ERP creyera estar haciendo sobre la
 * cuenta de ese cliente lo estaría haciendo sobre la del atacante.
 *
 * Por eso el state: se genera aquí, se guarda con su caducidad y su cliente, y
 * al volver se comprueba que existe, que no ha caducado y QUE NO SE HA USADO YA.
 */

import { randomUUID } from 'node:crypto'
import { createServiceClient } from '@/lib/supabase/service'
import { ENDPOINTS, SCOPE_ADS, credenciales, urlDeVuelta, type RegionAds } from './config'

/** Cuánto vale un `state`. Diez minutos es de sobra para autorizar y volver */
const STATE_VIVE_MS = 10 * 60_000

/**
 * Margen con el que se considera caducado un access token.
 *
 * Amazon los da con una hora de vida. Renovar un minuto antes evita el caso de
 * mandar una petición con un token que caduca mientras viaja, que contesta 401
 * y parece una autorización revocada.
 */
const MARGEN_CADUCIDAD_MS = 60_000

export class AdsError extends Error {
  readonly esDeAutorizacion: boolean
  constructor(mensaje: string, opciones: { esDeAutorizacion?: boolean } = {}) {
    super(mensaje)
    this.name = 'AdsError'
    this.esDeAutorizacion = opciones.esDeAutorizacion === true
  }
}

/* ------------------------------------------------------------------ */
/* Paso 1: mandar al cliente a Amazon                                  */
/* ------------------------------------------------------------------ */

export async function urlDeAutorizacion(params: {
  clienteId: string
  region: RegionAds
  userId: string | null
}): Promise<string> {
  const cred = credenciales()
  if (!cred) throw new AdsError('Faltan las credenciales de Amazon Ads en el servidor.')

  const state = randomUUID()
  const service = createServiceClient()

  const { error } = await service.from('ads_oauth_states').insert({
    state,
    client_id: params.clienteId,
    region: params.region,
    created_by: params.userId,
    expires_at: new Date(Date.now() + STATE_VIVE_MS).toISOString(),
  })
  if (error) throw error

  const url = new URL(ENDPOINTS[params.region].autorizar)
  url.searchParams.set('client_id', cred.clientId)
  url.searchParams.set('scope', SCOPE_ADS)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', urlDeVuelta())
  url.searchParams.set('state', state)
  return url.toString()
}

/* ------------------------------------------------------------------ */
/* Paso 2: comprobar la vuelta                                         */
/* ------------------------------------------------------------------ */

export interface EstadoOauth {
  clienteId: string
  region: RegionAds
  userId: string | null
}

/**
 * Comprueba el `state` y LO MARCA COMO USADO en el mismo movimiento.
 *
 * El `update ... is null` con `select` es lo que hace que dos llamadas
 * simultáneas con el mismo state no puedan pasar las dos: la primera se lo
 * lleva y la segunda no encuentra nada que actualizar. Comprobar y marcar por
 * separado dejaría esa ventana abierta.
 */
export async function consumirEstado(state: string): Promise<EstadoOauth> {
  if (!state) throw new AdsError('La vuelta de Amazon no trae el identificador de la petición.')

  const service = createServiceClient()
  const { data, error } = await service
    .from('ads_oauth_states')
    .update({ consumed_at: new Date().toISOString() })
    .eq('state', state)
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('client_id, region, created_by')
    .maybeSingle()

  if (error) throw error
  if (!data) {
    throw new AdsError(
      'Esta autorización no vale: o ha caducado, o ya se ha usado, o no la ha empezado el ERP. ' +
        'Vuelve a pulsar «Conectar» desde la pantalla.'
    )
  }

  return {
    clienteId: data.client_id as string,
    region: (data.region as RegionAds) ?? 'eu',
    userId: (data.created_by as string | null) ?? null,
  }
}

/* ------------------------------------------------------------------ */
/* Paso 3: los tokens                                                  */
/* ------------------------------------------------------------------ */

export interface TokensAds {
  refreshToken: string
  accessToken: string
  /** ISO */
  expiraEn: string
}

async function pedirTokens(
  region: RegionAds,
  cuerpo: Record<string, string>
): Promise<TokensAds> {
  const cred = credenciales()
  if (!cred) throw new AdsError('Faltan las credenciales de Amazon Ads en el servidor.')

  const res = await fetch(ENDPOINTS[region].token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      ...cuerpo,
      client_id: cred.clientId,
      client_secret: cred.clientSecret,
    }),
  })

  const datos = (await res.json().catch(() => null)) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    error?: string
    error_description?: string
  } | null

  if (!res.ok || !datos?.access_token) {
    const codigo = datos?.error ?? String(res.status)
    /**
     * `invalid_client` se traduce en vez de dejarlo pasar, porque su causa real
     * no se parece en nada a lo que dice: casi siempre es que la URL de vuelta
     * no coincide con la registrada en la consola de Login with Amazon, o que se
     * está usando el servidor de otra región. El mensaje de Amazon no menciona
     * ninguna de las dos cosas.
     */
    if (codigo === 'invalid_client' || codigo === 'unauthorized_client') {
      throw new AdsError(
        `Amazon rechaza la aplicación (${codigo}). Casi siempre es una de dos: la URL de vuelta ` +
          `«${urlDeVuelta()}» no está registrada TAL CUAL en Login with Amazon, o el scope ` +
          'advertising no está asignado a este Client ID.',
        { esDeAutorizacion: true }
      )
    }
    if (codigo === 'invalid_grant') {
      throw new AdsError(
        'La autorización ya no vale: el cliente la ha revocado desde su cuenta de Amazon, o el ' +
          'código ha caducado. Hay que volver a conectar.',
        { esDeAutorizacion: true }
      )
    }
    throw new AdsError(
      `Amazon no ha dado el token (${codigo}): ${datos?.error_description ?? 'sin detalle'}`
    )
  }

  return {
    accessToken: datos.access_token,
    // En una renovación Amazon NO devuelve refresh_token: se conserva el que ya
    // había. Guardar '' aquí borraría la autorización del cliente al renovar.
    refreshToken: datos.refresh_token ?? '',
    expiraEn: new Date(Date.now() + (datos.expires_in ?? 3600) * 1000).toISOString(),
  }
}

export async function canjearCodigo(codigo: string, region: RegionAds): Promise<TokensAds> {
  const tokens = await pedirTokens(region, {
    grant_type: 'authorization_code',
    code: codigo,
    redirect_uri: urlDeVuelta(),
  })
  if (!tokens.refreshToken) {
    throw new AdsError(
      'Amazon ha dado un access token pero no un refresh token. Sin él la conexión duraría una ' +
        'hora, así que no se guarda. Vuelve a intentarlo.'
    )
  }
  return tokens
}

export async function renovarAccessToken(
  refreshToken: string,
  region: RegionAds
): Promise<TokensAds> {
  return await pedirTokens(region, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })
}

/** true si a este access token le queda menos del margen de seguridad */
export function caducado(expiraEn: string | null): boolean {
  if (!expiraEn) return true
  return new Date(expiraEn).getTime() - MARGEN_CADUCIDAD_MS <= Date.now()
}
