import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'crypto'

/**
 * CIFRADO DEL REFRESH TOKEN — SOLO SERVIDOR
 * =========================================
 * Un componente de cliente que importe este fichero se lleva al navegador la
 * forma de descifrar las llaves de las tiendas de los clientes. No se importa
 * desde `components/**` ni desde nada con 'use client'. La única puerta de
 * entrada legítima es lib/amazon/data.ts.
 *
 * QUÉ PROTEGE ESTO Y QUÉ NO
 * -------------------------
 * Protege el VOLCADO de la base de datos. Un refresh token de Amazon deja
 * cambiar el precio de todo el catálogo de un cliente, y en Supabase la base
 * la puede exportar cualquiera con la service key, con acceso al panel o con
 * una copia de seguridad vieja en un disco. Cifrando aquí, esa copia no
 * contiene nada utilizable: la clave está en AMAZON_TOKEN_KEY, en el entorno
 * del contenedor, y NO está en la base de datos.
 *
 * No protege de alguien que ya ejecuta código en nuestro servidor: ahí tiene la
 * clave y el ciphertext. No es el ataque que se está tapando.
 *
 * POR QUÉ node:crypto Y NO pgcrypto
 * ---------------------------------
 * pgcrypto (pgp_sym_encrypt) era la otra opción y parecía más cómoda, pero con
 * ella la clave viaja DENTRO DEL TEXTO DE LA CONSULTA SQL, y las consultas
 * acaban en los logs de Postgres de Supabase. La clave de cifrado en un log es
 * peor que no cifrar, porque además da sensación de estar cubierto. Con
 * node:crypto la clave no sale nunca del proceso de Next, y no hace falta
 * ninguna dependencia nueva: viene con Node.
 *
 * AES-256-GCM y no AES-CBC: GCM AUTENTICA además de cifrar. Si alguien
 * modificara un byte del valor guardado, el descifrado falla en vez de
 * devolver basura silenciosa que luego se mandaría a Amazon como si fuera un
 * token.
 */

/** Formato del valor guardado. Si algún día cambia el algoritmo, este prefijo
    es lo que permite descifrar lo viejo mientras se escribe lo nuevo */
const VERSION = 'v1'

/** GCM está especificado para IV de 96 bits. Uno distinto por cada cifrado */
const IV_BYTES = 12
const KEY_BYTES = 32
const TAG_BYTES = 16

/**
 * Dato adicional autenticado. No se cifra, se firma: ata el ciphertext a su
 * propósito, de forma que un valor cifrado de otro sitio (si algún día se cifra
 * otra cosa con la misma clave) no se pueda pegar en la columna del token y
 * descifrarse sin más.
 */
const AAD = Buffer.from('amazon.refresh_token.v1', 'utf8')

/** El mensaje de «falta la clave», completo, porque es lo primero que va a
    pasar en un despliegue nuevo y tiene que decir exactamente qué hacer */
const MISSING_KEY =
  'Falta AMAZON_TOKEN_KEY. Es la clave con la que se cifran los tokens de Amazon en la base de datos. ' +
  'Genera una con `openssl rand -base64 32` y ponla en .env.local y en las variables del contenedor. ' +
  'No se guarda en la base de datos: si se pierde, hay que pedir a cada cliente que vuelva a autorizar.'

/**
 * La clave, leída del entorno EN CADA LLAMADA y no capturada al importar el
 * módulo. Si se leyera arriba del fichero, `next build` la exigiría en tiempo
 * de compilación —donde no existe— y tumbaría el despliegue entero por un
 * módulo que quizá esa página ni usa.
 */
function tokenKey(): Buffer {
  const raw = process.env.AMAZON_TOKEN_KEY
  if (!raw || raw.trim() === '') throw new Error(MISSING_KEY)

  // base64 es como la escupe `openssl rand -base64 32`; se acepta también hex
  // por si alguien la genera con `openssl rand -hex 32`, que es el otro
  // comando que la gente tiene en la cabeza.
  const key = /^[0-9a-fA-F]{64}$/.test(raw.trim())
    ? Buffer.from(raw.trim(), 'hex')
    : Buffer.from(raw.trim(), 'base64')

  if (key.length !== KEY_BYTES) {
    throw new Error(
      `AMAZON_TOKEN_KEY tiene ${key.length} bytes y AES-256 necesita ${KEY_BYTES}. Genera una nueva con \`openssl rand -base64 32\`.`
    )
  }
  return key
}

/**
 * ¿Está configurado el cifrado?
 *
 * Sirve para que la pantalla pueda decir «falta la clave» en vez de romperse al
 * intentar conectar un cliente. Devuelve false en vez de lanzar, y NO revela
 * nada de la clave.
 */
export function hasTokenKey(): boolean {
  try {
    tokenKey()
    return true
  } catch {
    return false
  }
}

/**
 * Cifra un refresh token. Devuelve 'v1.<iv>.<tag>.<ciphertext>' en base64url,
 * que es lo que se guarda en amazon_connections.refresh_token_enc.
 *
 * base64url y no base64 a secas: el valor viaja por JSON y por logs de
 * consultas, y así no lleva '+', '/' ni '=' que alguien pueda escapar mal por
 * el camino.
 */
export function encryptToken(plain: string): string {
  if (typeof plain !== 'string' || plain === '') {
    throw new Error('No se puede cifrar un token vacío')
  }
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', tokenKey(), iv)
  cipher.setAAD(AAD)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join(
    '.'
  )
}

/**
 * Descifra lo que hay en la base.
 *
 * Los mensajes de error de aquí NO llevan nunca el valor, ni un trozo, ni su
 * longitud. Un error se acaba imprimiendo en un log, y un log con material del
 * token deja de ser un log para convertirse en el problema.
 */
export function decryptToken(stored: string): string {
  if (typeof stored !== 'string' || stored === '') {
    throw new Error('La conexión no tiene token guardado')
  }
  const parts = stored.split('.')
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error(
      'El token guardado no tiene el formato esperado. O se escribió con otra versión del cifrado, o la columna se tocó a mano.'
    )
  }

  const [, ivB64, tagB64, ctB64] = parts
  const iv = Buffer.from(ivB64, 'base64url')
  const tag = Buffer.from(tagB64, 'base64url')
  const ct = Buffer.from(ctB64, 'base64url')

  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error('El token guardado está corrupto: el vector o la firma no miden lo que deben.')
  }

  try {
    const decipher = createDecipheriv('aes-256-gcm', tokenKey(), iv)
    decipher.setAAD(AAD)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
  } catch {
    // GCM falla aquí cuando la firma no cuadra: o la clave no es la que cifró,
    // o alguien modificó el valor. Las dos cosas se arreglan igual —volver a
    // autorizar— así que se dice eso y no se distingue, que además evita
    // convertir esta función en un oráculo.
    throw new Error(
      'No se ha podido descifrar el token de esta conexión. Comprueba que AMAZON_TOKEN_KEY es la misma con la que se guardó; si se ha perdido, el cliente tiene que volver a autorizar.'
    )
  }
}

/**
 * Huella corta y NO reversible de un token, para poder saber si el token de una
 * conexión ha cambiado sin tener que compararlo en claro.
 *
 * La usa la caché de access tokens: si el refresh token se sustituye porque el
 * cliente ha vuelto a autorizar, la huella cambia y la entrada cacheada se
 * descarta sola. Sin esto, seguiríamos usando durante una hora un access token
 * sacado del token viejo.
 *
 * Se calcula sobre el valor YA CIFRADO a propósito: el token en claro no entra
 * en esta función, así que no puede acabar en ningún sitio por descuido.
 */
export function tokenFingerprint(encrypted: string): string {
  return createHash('sha256').update(encrypted).digest('base64url').slice(0, 16)
}

/**
 * Comparación en tiempo constante de dos cadenas cortas (states de OAuth).
 *
 * El `===` de toda la vida corta en cuanto encuentra el primer byte distinto, y
 * con eso se puede adivinar un valor a base de medir. Para un state de un solo
 * uso y diez minutos de vida el riesgo es teórico, pero es una línea.
 */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}
