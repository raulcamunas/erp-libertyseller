/**
 * LAS CONTRASEÑAS DE LOS ORÍGENES — SOLO SERVIDOR.
 *
 * Un componente de cliente que importe este fichero se lleva al navegador la
 * forma de descifrar las contraseñas de los SFTP de los clientes. No se importa
 * desde `components/**`, ni desde nada con 'use client'. Las únicas puertas de
 * entrada legítimas son los conectores de esta misma carpeta y la ruta
 * app/api/stock-sync/perfiles/[id]/credencial.
 *
 *
 * DÓNDE ESTÁ EL SECRETO Y DÓNDE NO
 * --------------------------------
 * En `public.stock_origen_credenciales` (migración 124), cifrado con AES-256-GCM
 * por lib/amazon/crypto.ts. NO está en `stock_read_profiles.origen_config`, que
 * es el JSONB de configuración: ese campo se lee y se escribe desde la pantalla
 * y viaja entero al navegador en cada carga de la vista.
 *
 * La 124 explica por qué es una tabla aparte y no una columna más: porque
 * loadPerfiles() hace `select('*')` sobre stock_read_profiles, así que una
 * columna nueva nace, por omisión, dentro de la respuesta que recibe el
 * navegador. Con tabla aparte no hay nada que recordar excluir.
 *
 *
 * LAS TRES REGLAS QUE NO SE SALTAN
 * --------------------------------
 *   1. NUNCA sale al navegador. `estadoCredencial()` devuelve si HAY una y de
 *      qué tipo; el valor no tiene ninguna función que lo devuelva.
 *   2. NUNCA se escribe en un log. Por eso los errores de aquí no llevan el
 *      valor, ni un trozo, ni su longitud.
 *   3. NUNCA se cuela en un mensaje de error de otro sitio. Eso no se puede
 *      garantizar desde aquí —lo que ssh2 mete en sus errores lo decide ssh2—
 *      así que hay una función que lo tacha: `tacharSecreto()`, y los
 *      conectores la pasan por encima de TODO error antes de enseñarlo.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { createHash } from 'crypto'
import { decryptToken, encryptToken, hasTokenKey } from '@/lib/amazon/crypto'
import { OrigenError, SecretoOrigen } from './tipos'

const TABLA = 'stock_origen_credenciales'

/** Lo que la pantalla PUEDE saber de una credencial: que existe, y poco más */
export interface EstadoCredencial {
  hay: boolean
  tipo: 'password' | 'clave_privada' | null
  /** Huella corta, para poder ver que ha cambiado. No lleva a ningún sitio */
  huella: string | null
  actualizadaAt: string | null
  /** false = falta AMAZON_TOKEN_KEY en el servidor y no se puede ni guardar */
  cifradoConfigurado: boolean
}

/**
 * ¿Hay credencial guardada para este perfil?
 *
 * Se piden las columnas UNA A UNA y no con `select('*')`, aunque aquí estemos en
 * el servidor y no pase nada por leerla: es el mismo candado que DESTINO_FIELDS
 * en perfiles.ts. Lo que no se pide no se puede filtrar por descuido.
 */
export async function estadoCredencial(profileId: string): Promise<EstadoCredencial> {
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
      .eq('profile_id', profileId)
      .maybeSingle()

    if (error) throw error
    if (!data) return vacio

    const fila = data as { tipo: string; huella: string | null; updated_at: string }
    return {
      hay: true,
      tipo: fila.tipo === 'clave_privada' ? 'clave_privada' : 'password',
      huella: fila.huella,
      actualizadaAt: fila.updated_at,
      cifradoConfigurado: vacio.cifradoConfigurado,
    }
  } catch (error) {
    // La 124 se lanza a mano en el editor SQL de Supabase, así que el código
    // puede llegar desplegado antes que ella. Se devuelve «no hay» y quien
    // intente guardar se llevará el mensaje que dice qué fichero falta, en vez
    // de una pantalla en blanco.
    if (faltaLaTabla(error)) return vacio
    throw error
  }
}

/**
 * La credencial en claro, para usarla AHORA MISMO.
 *
 * Devuelve null si no hay ninguna guardada — que no es un error: un perfil de
 * SFTP recién creado todavía no la tiene, y quien lo está configurando merece
 * un «falta la contraseña» y no una excepción.
 */
export async function leerCredencial(profileId: string): Promise<SecretoOrigen | null> {
  interface FilaCredencial {
    tipo: string
    secreto_enc: string
    passphrase_enc: string | null
  }

  let fila: FilaCredencial | null = null

  try {
    const service = createServiceClient()
    const { data, error } = await service
      .from(TABLA)
      .select('tipo, secreto_enc, passphrase_enc')
      .eq('profile_id', profileId)
      .maybeSingle()
    if (error) throw error
    fila = (data as FilaCredencial | null) ?? null
  } catch (error) {
    if (faltaLaTabla(error)) {
      throw new OrigenError(
        'Falta lanzar la migración 124_origenes_credenciales.sql en el editor SQL de Supabase: ' +
          'sin ella no hay dónde guardar la contraseña del origen.'
      )
    }
    throw error
  }

  if (!fila) return null

  try {
    return new SecretoOrigen(
      fila.tipo === 'clave_privada' ? 'clave_privada' : 'password',
      decryptToken(fila.secreto_enc),
      fila.passphrase_enc ? decryptToken(fila.passphrase_enc) : null
    )
  } catch (error) {
    /**
     * decryptToken solo falla por dos motivos, y los dos se arreglan igual: o
     * AMAZON_TOKEN_KEY no es la misma con la que se guardó, o alguien tocó la
     * columna a mano. Se dice eso y no se distingue, que además evita convertir
     * esto en un oráculo. El mensaje original NO se propaga porque no aporta
     * nada y viene de una función que habla de tokens de Amazon.
     */
    void error
    throw new OrigenError(
      'No se ha podido descifrar la credencial de este origen. Comprueba que AMAZON_TOKEN_KEY es la ' +
        'misma con la que se guardó; si se ha perdido, vuelve a escribir la contraseña en el perfil.'
    )
  }
}

/**
 * Guarda (o sustituye) la credencial de un perfil.
 *
 * Es un UPSERT por `profile_id`, que es la clave primaria: no hay forma de que
 * un perfil acabe con dos contraseñas ni de que la configuración de uno apunte
 * a la de otro. El valor entra por aquí en claro y sale cifrado; no se guarda en
 * ningún otro sitio, ni siquiera un registro de «se cambió a las 14:32 y era de
 * ocho caracteres».
 */
export async function guardarCredencial(params: {
  profileId: string
  tipo: 'password' | 'clave_privada'
  valor: string
  passphrase?: string | null
  userId: string | null
}): Promise<EstadoCredencial> {
  const valor = params.valor
  if (typeof valor !== 'string' || valor.trim() === '') {
    throw new OrigenError('No se puede guardar una credencial vacía.')
  }
  if (!hasTokenKey()) {
    throw new OrigenError(
      'Falta AMAZON_TOKEN_KEY en el servidor. Es la clave con la que se cifran las credenciales; ' +
        'sin ella no se guarda ninguna contraseña en claro, que es lo correcto. ' +
        'Génerala con `openssl rand -base64 32` y ponla en las variables del contenedor.'
    )
  }

  /**
   * La clave privada se guarda TAL CUAL, con sus saltos de línea y su línea
   * BEGIN. Solo se recortan los espacios de los extremos: un `trim()` por línea
   * o un `replace` de los saltos rompe el PEM y ssh2 contesta «Cannot parse
   * privateKey», que no dice qué pasó.
   *
   * La contraseña, en cambio, se guarda tal cual SIN recortar nada: hay
   * contraseñas que terminan en espacio, y recortarlas por educación es cómo se
   * consigue que la de un cliente deje de funcionar sin ninguna explicación.
   */
  const limpio = params.tipo === 'clave_privada' ? valor.trim() : valor

  if (params.tipo === 'clave_privada' && !limpio.includes('PRIVATE KEY')) {
    throw new OrigenError(
      'Eso no parece una clave privada: falta la línea «-----BEGIN … PRIVATE KEY-----». ' +
        'Pega el fichero entero, incluidas la primera y la última línea. ' +
        'Si lo que tienes es la clave PÚBLICA (la que termina en .pub), esa va en el servidor del cliente, no aquí.'
    )
  }

  const secretoEnc = encryptToken(limpio)
  const passphraseEnc =
    params.passphrase && params.passphrase !== '' ? encryptToken(params.passphrase) : null

  const service = createServiceClient()
  const { error } = await service.from(TABLA).upsert(
    {
      profile_id: params.profileId,
      tipo: params.tipo,
      secreto_enc: secretoEnc,
      passphrase_enc: passphraseEnc,
      huella: huellaCorta(secretoEnc),
      updated_by: params.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'profile_id' }
  )

  if (error) {
    if (faltaLaTabla(error)) {
      throw new OrigenError(
        'Falta lanzar la migración 124_origenes_credenciales.sql en el editor SQL de Supabase: ' +
          'sin ella no hay dónde guardar la contraseña del origen.'
      )
    }
    throw error
  }

  return estadoCredencial(params.profileId)
}

/** Borra la credencial. Idempotente: borrar la que no hay no es un error */
export async function borrarCredencial(profileId: string): Promise<void> {
  try {
    const service = createServiceClient()
    const { error } = await service.from(TABLA).delete().eq('profile_id', profileId)
    if (error) throw error
  } catch (error) {
    if (faltaLaTabla(error)) return
    throw error
  }
}

/* ------------------------------------------------------------------ */
/* Que no se escape por un mensaje de error                            */
/* ------------------------------------------------------------------ */

/**
 * TACHA LA CREDENCIAL DE UN TEXTO ANTES DE QUE ESE TEXTO SE VEA.
 *
 * No es paranoia de manual: `ssh2` mete el contenido de la clave privada en el
 * mensaje de algunos errores de autenticación («Cannot parse privateKey: …»), y
 * ese mensaje viaja tal cual al `OrigenError`, de ahí a la pantalla, y de ahí a
 * la fila del historial de ejecuciones, que NO se borra nunca. Una clave privada
 * de un cliente escrita para siempre en una tabla del ERP es exactamente lo que
 * el cifrado de al lado existe para impedir.
 *
 * Se tacha el valor entero y también sus primeros 12 caracteres, que es lo que
 * suelen recortar las librerías cuando «acortan» un valor para el error.
 */
export function tacharSecreto(texto: string, secreto: SecretoOrigen | null): string {
  if (!secreto) return texto

  let salida = texto
  const trozos = [secreto.valor, secreto.passphrase].filter(
    (v): v is string => typeof v === 'string' && v.length > 0
  )

  for (const trozo of trozos) {
    salida = salida.split(trozo).join('«credencial oculta»')
    // Y el prefijo, por si la librería recortó el valor antes de meterlo. Menos
    // de 8 caracteres no se tacha: sería tachar cualquier palabra del mensaje.
    if (trozo.length >= 8) {
      salida = salida.split(trozo.slice(0, 12)).join('«credencial oculta»')
    }
  }

  // Y por si acaso, el PEM entero: si algo ha metido una clave privada en el
  // texto por otro camino, aquí se queda.
  salida = salida.replace(
    /-----BEGIN[\s\S]*?PRIVATE KEY-----[\s\S]*?-----END[^-]*-----/g,
    '«clave privada oculta»'
  )

  return salida
}

/* ------------------------------------------------------------------ */

/** Huella corta y no reversible del valor YA CIFRADO. El claro no entra aquí */
function huellaCorta(cifrado: string): string {
  return createHash('sha256').update(cifrado).digest('base64url').slice(0, 8)
}

/** ¿Es que falta lanzar la 124? Los mismos códigos que usa isMissingSchema */
function faltaLaTabla(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  return code === 'PGRST205' || code === '42P01' || code === 'PGRST204' || code === '42703'
}
