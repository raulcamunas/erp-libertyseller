/**
 * LAS CONTRASEÑAS DE LOS BUZONES — SOLO SERVIDOR.
 *
 * Hermano de ./credenciales.ts, con otra clave: allí la credencial cuelga del
 * PERFIL (un SFTP es de un cliente y de nadie más); aquí cuelga del BUZÓN.
 *
 * POR QUÉ ES OTRO FICHERO Y NO UN PARÁMETRO DE AQUEL
 * --------------------------------------------------
 * Porque aquel está en producción sosteniendo el SFTP y el FTPS de clientes
 * reales, y este encargo no tiene nada que ver con ellos. Parametrizar la tabla
 * habría metido la mano en el camino que hoy funciona para ahorrarse ochenta
 * líneas. La deuda queda escrita: son dos ficheros casi iguales y van a
 * divergir. El día que haya un tercero, se unifican los tres a la vez.
 *
 * POR QUÉ LA CONTRASEÑA ES DEL BUZÓN Y NO DEL PERFIL
 * --------------------------------------------------
 * Un buzón de la agencia sirve al perfil de diez clientes. Con la contraseña
 * colgando del perfil habría que teclearla diez veces, y cambiarla el día que
 * caduque serían diez sitios — nueve de los cuales se quedarían sin cambiar.
 *
 * LAS TRES REGLAS SON LAS MISMAS Y NO SE SALTAN
 * ---------------------------------------------
 *   1. NUNCA sale al navegador. `estadoCredencialBuzon()` dice si HAY una; el
 *      valor no tiene ninguna función que lo devuelva.
 *   2. NUNCA se escribe en un log. Por eso los errores de aquí no llevan el
 *      valor, ni un trozo, ni su longitud.
 *   3. NUNCA se cuela en un mensaje de error de otro sitio. Lo que imapflow
 *      mete en sus errores lo decide imapflow, así que los conectores pasan
 *      `tacharSecreto()` por encima de TODO error antes de enseñarlo.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { createHash } from 'crypto'
import { decryptToken, encryptToken, hasTokenKey } from '@/lib/amazon/crypto'
import type { EstadoCredencial } from './credenciales'
import { OrigenError, SecretoOrigen } from './tipos'

const TABLA = 'stock_buzon_credenciales'

/** Lo que la pantalla PUEDE saber: que existe, y poco más */
export async function estadoCredencialBuzon(buzonId: string): Promise<EstadoCredencial> {
  const vacio: EstadoCredencial = {
    hay: false,
    tipo: null,
    huella: null,
    actualizadaAt: null,
    cifradoConfigurado: hasTokenKey(),
  }

  try {
    const service = createServiceClient()
    const { data, error } = await service
      .from(TABLA)
      .select('tipo, huella, updated_at')
      .eq('buzon_id', buzonId)
      .maybeSingle()

    if (error) throw error
    if (!data) return vacio

    const fila = data as { tipo: string; huella: string | null; updated_at: string }
    return {
      hay: true,
      tipo: 'password',
      huella: fila.huella,
      actualizadaAt: fila.updated_at,
      cifradoConfigurado: vacio.cifradoConfigurado,
    }
  } catch (error) {
    // La 198 se lanza a mano en el editor SQL de Supabase, así que el código
    // puede llegar desplegado antes que ella. Se devuelve «no hay» y quien
    // intente guardar se llevará el mensaje que dice qué fichero falta.
    if (faltaLaTabla(error)) return vacio
    throw error
  }
}

/**
 * La contraseña en claro, para usarla AHORA MISMO.
 *
 * null si no hay ninguna, que no es un error: un buzón recién dado de alta
 * todavía no la tiene, y quien lo está configurando merece un «falta la
 * contraseña» y no una excepción.
 */
export async function leerCredencialBuzon(buzonId: string): Promise<SecretoOrigen | null> {
  let fila: { secreto_enc: string } | null = null

  try {
    const service = createServiceClient()
    const { data, error } = await service
      .from(TABLA)
      .select('secreto_enc')
      .eq('buzon_id', buzonId)
      .maybeSingle()
    if (error) throw error
    fila = (data as { secreto_enc: string } | null) ?? null
  } catch (error) {
    if (faltaLaTabla(error)) throw new OrigenError(FALTA_LA_198)
    throw error
  }

  if (!fila) return null

  try {
    return new SecretoOrigen('password', decryptToken(fila.secreto_enc), null)
  } catch (error) {
    /**
     * decryptToken solo falla por dos motivos, y los dos se arreglan igual: o
     * AMAZON_TOKEN_KEY no es la misma con la que se guardó, o alguien tocó la
     * columna a mano. Se dice eso y no se distingue, que además evita convertir
     * esto en un oráculo.
     */
    void error
    throw new OrigenError(
      'No se ha podido descifrar la contraseña de este buzón. Comprueba que AMAZON_TOKEN_KEY es la ' +
        'misma con la que se guardó; si se ha perdido, vuelve a escribirla en Amazon API › Buzones.'
    )
  }
}

/**
 * Guarda (o sustituye) la contraseña de un buzón.
 *
 * UPSERT por `buzon_id`, que es la clave primaria: no hay forma de que un buzón
 * acabe con dos contraseñas ni de que apunte a la de otro. El valor entra en
 * claro y sale cifrado; no se guarda en ningún otro sitio, ni siquiera un
 * registro de «se cambió a las 14:32 y era de ocho caracteres».
 */
export async function guardarCredencialBuzon(params: {
  buzonId: string
  valor: string
  userId: string | null
}): Promise<EstadoCredencial> {
  if (typeof params.valor !== 'string' || params.valor.trim() === '') {
    throw new OrigenError('No se puede guardar una contraseña vacía.')
  }
  if (!hasTokenKey()) {
    throw new OrigenError(
      'Falta AMAZON_TOKEN_KEY en el servidor. Es la clave con la que se cifran las contraseñas; ' +
        'sin ella no se guarda ninguna en claro, que es lo correcto. ' +
        'Génerala con `openssl rand -base64 32` y ponla en las variables del contenedor.'
    )
  }

  /**
   * NO se recorta nada: hay contraseñas que terminan en espacio, y recortarlas
   * por educación es cómo se consigue que la de un buzón deje de funcionar sin
   * ninguna explicación. Es la misma decisión que en ./credenciales.ts.
   */
  const secretoEnc = encryptToken(params.valor)

  const service = createServiceClient()
  const { error } = await service.from(TABLA).upsert(
    {
      buzon_id: params.buzonId,
      tipo: 'password',
      secreto_enc: secretoEnc,
      huella: huellaCorta(secretoEnc),
      updated_by: params.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'buzon_id' }
  )

  if (error) {
    if (faltaLaTabla(error)) throw new OrigenError(FALTA_LA_198)
    throw error
  }

  return estadoCredencialBuzon(params.buzonId)
}

/** Borra la contraseña. Idempotente: borrar la que no hay no es un error */
export async function borrarCredencialBuzon(buzonId: string): Promise<void> {
  try {
    const service = createServiceClient()
    const { error } = await service.from(TABLA).delete().eq('buzon_id', buzonId)
    if (error) throw error
  } catch (error) {
    if (faltaLaTabla(error)) return
    throw error
  }
}

/* ------------------------------------------------------------------ */

const FALTA_LA_198 =
  'Falta lanzar la migración 198_buzones_correo.sql en el editor SQL de Supabase: sin ella no hay ' +
  'dónde guardar la contraseña del buzón.'

/** Huella corta y no reversible del valor YA CIFRADO. El claro no entra aquí */
function huellaCorta(cifrado: string): string {
  return createHash('sha256').update(cifrado).digest('base64url').slice(0, 8)
}

/** ¿Es que falta lanzar la 198? Los mismos códigos que usa isMissingSchema */
function faltaLaTabla(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  return code === 'PGRST205' || code === '42P01' || code === 'PGRST204' || code === '42703'
}
