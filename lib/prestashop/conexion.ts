import { createServiceClient } from '@/lib/supabase/service'
import { decryptToken, encryptToken, hasTokenKey } from '@/lib/amazon/crypto'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import type { ConexionPS } from './cliente'

/**
 * DÓNDE SE GUARDA LA CLAVE DE LA TIENDA.
 * SOLO SERVIDOR.
 *
 * La tabla `prestashop_conexiones` (migración 221) está cerrada del todo: RLS sin
 * ninguna política y sin permisos para `authenticated` ni `anon`. Solo se llega a
 * ella con la clave de servicio, y por aquí.
 *
 * Y NINGUNA función de este fichero devuelve la clave al navegador:
 * `estadoConexion` dice SI HAY una y de cuándo es la última prueba, pero el valor
 * solo sale de `claveDe`, que la usan los conectores del servidor y nada más.
 * Es el mismo criterio que lib/stock-sync/origenes/credenciales.ts.
 */

export interface EstadoConexion {
  /** false = falta lanzar la migración 221 */
  tabla: boolean
  /** false = en este entorno no hay clave de cifrado (AMAZON_TOKEN_KEY) */
  cifrado: boolean
  configurada: boolean
  url: string | null
  version: string | null
  ultimoTest: { at: string; ok: boolean; mensaje: string | null } | null
}

interface Fila {
  client_id: string
  url_base: string
  clave_cifrada: string
  version_prestashop: string | null
  ultimo_test_at: string | null
  ultimo_test_ok: boolean | null
  ultimo_test_mensaje: string | null
}

export async function estadoConexion(clientId: string): Promise<EstadoConexion> {
  const base: EstadoConexion = {
    tabla: true,
    cifrado: hasTokenKey(),
    configurada: false,
    url: null,
    version: null,
    ultimoTest: null,
  }

  const { data, error } = await createServiceClient()
    .from('prestashop_conexiones')
    // Las columnas se piden UNA A UNA, sin `*`, y la clave no está entre ellas.
    .select('client_id, url_base, version_prestashop, ultimo_test_at, ultimo_test_ok, ultimo_test_mensaje')
    .eq('client_id', clientId)
    .maybeSingle()

  if (error) {
    if (isMissingSchema(error)) return { ...base, tabla: false }
    throw error
  }
  const f = data as Omit<Fila, 'clave_cifrada'> | null
  if (!f) return base

  return {
    ...base,
    configurada: true,
    url: f.url_base,
    version: f.version_prestashop,
    ultimoTest: f.ultimo_test_at
      ? { at: f.ultimo_test_at, ok: f.ultimo_test_ok === true, mensaje: f.ultimo_test_mensaje }
      : null,
  }
}

/** La conexión COMPLETA, con la clave en claro. Solo para quien va a llamar a la tienda */
export async function claveDe(clientId: string): Promise<ConexionPS | null> {
  const { data, error } = await createServiceClient()
    .from('prestashop_conexiones')
    .select('url_base, clave_cifrada')
    .eq('client_id', clientId)
    .maybeSingle()
  if (error) {
    if (isMissingSchema(error)) return null
    throw error
  }
  const f = data as Pick<Fila, 'url_base' | 'clave_cifrada'> | null
  if (!f) return null
  return { url: f.url_base, clave: decryptToken(f.clave_cifrada) }
}

/**
 * Guarda la dirección y, si viene, la clave. Sin clave nueva se conserva la que
 * hay: cambiar solo la dirección no obliga a volver a escribirla.
 */
export async function guardarConexion(
  clientId: string,
  url: string,
  clave: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!hasTokenKey()) {
    return { ok: false, error: 'Este entorno no tiene clave de cifrado, así que no se puede guardar la clave.' }
  }
  const service = createServiceClient()

  if (clave === null) {
    const { data, error } = await service
      .from('prestashop_conexiones')
      .update({ url_base: url, actualizada_at: new Date().toISOString(), ultimo_test_at: null, ultimo_test_ok: null, ultimo_test_mensaje: null })
      .eq('client_id', clientId)
      .select('client_id')
    if (error) throw error
    if (!data || data.length === 0) return { ok: false, error: 'Falta la clave del Webservice.' }
    return { ok: true }
  }

  const { error } = await service.from('prestashop_conexiones').upsert(
    {
      client_id: clientId,
      url_base: url,
      clave_cifrada: encryptToken(clave),
      actualizada_at: new Date().toISOString(),
      // Una conexión nueva no ha pasado ninguna prueba: no se hereda el «conectada»
      // de la clave anterior.
      ultimo_test_at: null,
      ultimo_test_ok: null,
      ultimo_test_mensaje: null,
      version_prestashop: null,
    },
    { onConflict: 'client_id' }
  )
  if (error) throw error
  return { ok: true }
}

export async function anotarPrueba(
  clientId: string,
  ok: boolean,
  mensaje: string,
  version: string | null
): Promise<void> {
  await createServiceClient()
    .from('prestashop_conexiones')
    .update({
      ultimo_test_at: new Date().toISOString(),
      ultimo_test_ok: ok,
      // Recortado: es un mensaje para una pantalla, no un volcado.
      ultimo_test_mensaje: mensaje.slice(0, 500),
      version_prestashop: version,
    })
    .eq('client_id', clientId)
}

export async function quitarConexion(clientId: string): Promise<void> {
  const { error } = await createServiceClient().from('prestashop_conexiones').delete().eq('client_id', clientId)
  if (error) throw error
}
