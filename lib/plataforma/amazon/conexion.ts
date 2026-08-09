/**
 * LAS CREDENCIALES DE UN TRABAJO
 * ==============================
 * SOLO SERVIDOR.
 *
 * Una tarea del motor tiene un `connection_id` y necesita hablar con la tienda
 * de ese cliente. Este fichero es el único punto por el que pasa esa traducción,
 * y hace tres cosas que no conviene repetir en cada tarea:
 *
 *   1. REUTILIZA connectionCredentials() de lib/amazon/data.ts, que es EL ÚNICO
 *      fichero del repositorio que lee `refresh_token_enc`. Aquí no se descifra
 *      nada: el token viaja cifrado dentro de AmazonCredentials y solo existe en
 *      claro dentro de getAccessToken(), durante la llamada.
 *
 *   2. COMPRUEBA QUE LA CONEXIÓN SIGUE VIVA antes de gastar cupo. Una cuenta
 *      revocada devuelve 403 en cada llamada, y un trabajo de 685 lotes contra
 *      una cuenta revocada son 685 forma distintas de decir lo mismo.
 *
 *   3. GUARDA EL RESULTADO POR PASADA. Un trabajo hace decenas de lotes por
 *      pasada y cada uno necesitaría las credenciales: sin caché serían decenas
 *      de lecturas de la fila que contiene el token, que es justo la fila que
 *      menos veces conviene leer.
 */

import { connectionCredentials } from '@/lib/amazon/data'
import { AmazonApiError } from '@/lib/amazon/errors'
import type { AmazonCredentials } from '@/lib/amazon/sp-api'

export interface ConexionResuelta {
  credenciales: AmazonCredentials
  sellingPartnerId: string
  nombre: string
  marketplaceIds: string[]
}

/**
 * La caché, indexada por conexión.
 *
 * Vive en memoria del proceso y no caduca por tiempo, igual que los cubos de
 * fichas: son unos pocos objetos diminutos. Lo que sí hace falta es poder
 * TIRARLA cuando una conexión cambia —al desconectar, al reautorizar— y de eso
 * se encarga olvidarConexion().
 *
 * OJO: aquí dentro hay un refresh token cifrado. Es exactamente el mismo
 * material que ya guarda la caché de access tokens de lib/amazon/lwa.ts, y por
 * eso este objeto NO se devuelve entero a nadie: se devuelve una copia sin más
 * campos de los necesarios.
 */
const cache = new Map<string, ConexionResuelta>()

export function olvidarConexion(connectionId: string): void {
  cache.delete(connectionId)
}

/** Vacía la caché entera. Existe para las pruebas, no para producción */
export function olvidarConexiones(): void {
  cache.clear()
}

/**
 * Resuelve las credenciales de una conexión, o explica en español por qué no.
 *
 * Lanza AmazonApiError en vez de Error a secas para que las rutas de API lo
 * traduzcan al código HTTP que toca (errorResponse de lib/amazon/api.ts) y para
 * que el mensaje que acabe en la tabla de eventos sea el que lee una persona,
 * no un texto de Postgres.
 */
export async function conexionDeTrabajo(connectionId: string | null): Promise<ConexionResuelta> {
  if (!connectionId) {
    throw new AmazonApiError({
      kind: 'peticion',
      message: 'trabajo sin connection_id',
      humanMessage:
        'Este trabajo habla con Amazon pero no dice con qué cuenta. No se puede ejecutar.',
    })
  }

  const guardada = cache.get(connectionId)
  if (guardada) return guardada

  const resuelta = await connectionCredentials(connectionId)
  if (!resuelta) {
    throw new AmazonApiError({
      kind: 'no_encontrado',
      message: `conexión ${connectionId} inexistente`,
      humanMessage:
        'La cuenta de Amazon de este trabajo ya no está conectada: alguien la desconectó mientras el trabajo estaba en la cola.',
    })
  }

  const { connection, credentials } = resuelta

  if (!connection.is_active || connection.status !== 'activa') {
    throw new AmazonApiError({
      kind: 'auth',
      message: `conexión ${connectionId} en estado ${connection.status}`,
      humanMessage:
        connection.status_detail ??
        'Esta cuenta de Amazon no está conectada ahora mismo, así que no se le puede leer nada. ' +
          'Insistir contra una cuenta que nos ha retirado el acceso no la recupera: hay que volver a autorizarla.',
    })
  }

  const salida: ConexionResuelta = {
    credenciales: credentials,
    sellingPartnerId: connection.selling_partner_id,
    nombre: connection.name,
    marketplaceIds: connection.marketplace_ids ?? [],
  }
  cache.set(connectionId, salida)
  return salida
}

/**
 * El marketplace de un trabajo, comprobado contra los que el cliente nos ha
 * autorizado.
 *
 * No es una formalidad: pedir datos de un país que el vendedor no tiene dado de
 * alta devuelve un 403 idéntico al de «te falta un rol», y ese 403 es el error
 * más difícil de diagnosticar de toda la Selling Partner API. Cortarlo aquí
 * convierte media hora de investigación en una frase.
 *
 * La lista puede estar vacía si la llamada de participaciones falló al
 * autorizar; en ese caso NO se corta —sería peor— y se deja pasar.
 */
export function marketplaceDeTrabajo(conexion: ConexionResuelta, marketplaceId: string | null): string {
  if (!marketplaceId) {
    throw new AmazonApiError({
      kind: 'peticion',
      message: 'trabajo sin marketplace_id',
      humanMessage: 'Este trabajo habla con Amazon pero no dice en qué país. No se puede ejecutar.',
    })
  }
  if (conexion.marketplaceIds.length > 0 && !conexion.marketplaceIds.includes(marketplaceId)) {
    throw new AmazonApiError({
      kind: 'permisos',
      message: `marketplace ${marketplaceId} fuera de la conexión`,
      humanMessage:
        `La cuenta «${conexion.nombre}» no nos ha autorizado a trabajar en ese país, así que ` +
        'Amazon rechazaría la lectura con un error de permisos que parece otra cosa.',
    })
  }
  return marketplaceId
}
