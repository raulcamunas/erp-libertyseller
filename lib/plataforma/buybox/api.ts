/**
 * PLATAFORMA · MÓDULO A2 — LAS DOS LLAMADAS A AMAZON
 * ==================================================
 * SOLO SERVIDOR.
 *
 * Este fichero solo habla con Amazon y devuelve el JSON crudo a lectura.ts. No
 * sabe qué es un diagnóstico ni que existe Postgres. Misma separación que
 * lib/plataforma/amazon/**.
 *
 *
 * ============ POR QUÉ getListingOffersBatch Y NO getItemOffersBatch ============
 *
 * LA ESPECIFICACIÓN DICE `getItemOffersBatch` (§3.3) Y ESTÁ EQUIVOCADA. Las dos
 * operaciones devuelven EL MISMO payload y aceptan los mismos 20 elementos por
 * llamada. La diferencia es el cupo:
 *
 *     getListingOffersBatch   0,5 peticiones/segundo   ->  1 llamada cada 2 s
 *     getItemOffersBatch      0,1 peticiones/segundo   ->  1 llamada cada 10 s
 *
 * Con 13.700 referencias son 685 llamadas: 22 minutos y 50 segundos con la
 * primera, UNA HORA Y CINCUENTA Y CUATRO MINUTOS con la segunda. Por marketplace
 * y por noche. Usar la que dice la especificación cuesta hora y media de ventana
 * nocturna cada noche a cambio de exactamente el mismo dato.
 *
 * `getItemOffersBatch` solo sirve para una cosa que aquí no hace falta: mirar un
 * ASIN en el que el cliente NO tiene oferta (prospección). Va por ASIN; esta va
 * por SKU propio.
 *
 *
 * ============ EL FOEP ES LA OPERACIÓN MÁS CARA DE TODA LA PLATAFORMA ============
 *
 * `getFeaturedOfferExpectedPriceBatch` va a 0,033 peticiones por segundo: UNA
 * CADA TREINTA SEGUNDOS Y PICO. Admite 40 SKU por llamada (solo en la prosa de
 * la documentación, no en el esquema, así que el troceado lo impone este
 * fichero). Para 13.700 referencias son 343 llamadas = 2 horas y 53 minutos.
 *
 * Eso es el 79 % del tiempo de un barrido completo. Por eso el FOEP va por
 * ROTACIÓN y no todas las noches sobre todo el catálogo — ver tarea.ts.
 *
 * Y solo acepta SKU PROPIO. No sirve para mirar el catálogo de otro.
 */

import { AmazonApiError } from '@/lib/amazon/errors'
import { spApiRequest, type AmazonCredentials } from '@/lib/amazon/sp-api'

/** Tope de elementos por llamada de ofertas. Es el número de toda la SP-API */
export const MAX_SKUS_OFERTAS = 20

/**
 * Tope de elementos por llamada de FOEP.
 *
 * Está en la PROSA de la documentación, no en el esquema OpenAPI, así que Amazon
 * no lo rechaza: lo trocea este fichero. Mandar más devolvería vete a saber qué.
 */
export const MAX_SKUS_FOEP = 40

/* ------------------------------------------------------------------ */
/* La memoria de «a esta cuenta le falta el rol»                       */
/* ------------------------------------------------------------------ */

/**
 * Cuentas a las que Amazon ya nos ha dicho 403 en esta operación.
 *
 * POR QUÉ EXISTE: un 403 por rol no concedido es DETERMINISTA. Sin esta memoria,
 * un barrido de 685 lotes se lleva 685 formas distintas de decir lo mismo, gasta
 * cupo, tarda una hora y deja la cola de incidencias con seiscientas ochenta y
 * cinco entradas idénticas. Con ella, el primer 403 corta el trabajo entero y
 * levanta UNA incidencia que dice qué hay que hacer: volver a autorizar.
 *
 * Vive en memoria del proceso y se olvida al reiniciar, que es exactamente lo
 * que se quiere: si alguien reautoriza y redespliega, se vuelve a intentar. Y
 * `olvidarRoles()` permite reintentar sin esperar al reinicio.
 */
const rolesDenegados = new Map<string, string>()

function claveRol(connectionId: string, operacion: string): string {
  return `${connectionId}|${operacion}`
}

export function olvidarRoles(connectionId?: string): void {
  if (!connectionId) {
    rolesDenegados.clear()
    return
  }
  for (const clave of [...rolesDenegados.keys()]) {
    if (clave.startsWith(`${connectionId}|`)) rolesDenegados.delete(clave)
  }
}

export function rolDenegado(connectionId: string, operacion: string): string | null {
  return rolesDenegados.get(claveRol(connectionId, operacion)) ?? null
}

/**
 * Corta antes de gastar una ficha si ya sabemos que esta cuenta no tiene el rol.
 *
 * Lanza el MISMO mensaje que lanzó la primera vez, para que la incidencia diga
 * lo mismo y la huella la agrupe en vez de repetirla.
 */
function comprobarRol(connectionId: string, operacion: string): void {
  const motivo = rolesDenegados.get(claveRol(connectionId, operacion))
  if (!motivo) return
  throw new AmazonApiError({
    kind: 'permisos',
    message: `${operacion}: rol no concedido (memorizado)`,
    humanMessage: motivo,
  })
}

/** Apunta el 403 y traduce el error a algo que diga qué hacer */
function anotarRol(connectionId: string, operacion: string, error: unknown): never {
  if (error instanceof AmazonApiError && (error.httpStatus === 403 || error.httpStatus === 401)) {
    const mensaje =
      'Amazon ha rechazado la lectura de precios de esta cuenta por permisos. Con el rol de Precios ' +
      'concedido esto solo pasa cuando la autorización del cliente es anterior al rol o ha caducado, ' +
      'y NO se arregla reintentando: el cliente tiene que volver a autorizar la aplicación desde ' +
      '«Manage Your Apps» de Seller Central. Este trabajo se para aquí para no gastar el cupo de la ' +
      'cuenta repitiendo la misma negativa.'
    rolesDenegados.set(claveRol(connectionId, operacion), mensaje)
    throw new AmazonApiError({
      kind: 'permisos',
      message: `${operacion}: 403`,
      humanMessage: mensaje,
      requestId: error.requestId,
      httpStatus: error.httpStatus,
    })
  }
  throw error
}

/* ------------------------------------------------------------------ */
/* getListingOffersBatch                                               */
/* ------------------------------------------------------------------ */

export interface OpcionesOfertas {
  marketplaceId: string
  skus: string[]
  /**
   * La condición vigilada.
   *
   * `New` por defecto y NO es una regla de negocio inventada: es la condición en
   * la que vende el 100 % de la cartera. Si algún cliente vendiera usado, esto es
   * un parámetro y una segunda pasada, no un cambio de código.
   */
  condicion?: string
  /**
   * El segmento de comprador.
   *
   * `Consumer` por defecto. B2B ES UNA SEGUNDA PASADA, NO UN INTERRUPTOR: la
   * oferta destacada de B2B es otra, con otros precios, y mezclarlas en la misma
   * serie haría el histórico ininterpretable.
   */
  segmento?: string
}

export interface RespuestaCruda {
  /** El JSON tal cual, para que lo lea lectura.ts */
  datos: unknown
  requestId: string | null
  httpStatus: number
}

/**
 * Pide las ofertas de hasta 20 SKU propios.
 *
 * El SKU va DENTRO DE LA URI de cada sub-petición y por eso se codifica: hay SKU
 * con barras, espacios y símbolos, y uno con `/` sin codificar partiría la ruta
 * y preguntaría por otro producto. Es la misma trampa que ya tapa
 * `sendPatch()` en lib/amazon/sp-api.ts.
 */
export async function leerOfertas(
  creds: AmazonCredentials,
  opciones: OpcionesOfertas
): Promise<RespuestaCruda> {
  const skus = limpiar(opciones.skus)
  if (skus.length === 0) return { datos: { responses: [] }, requestId: null, httpStatus: 200 }
  if (skus.length > MAX_SKUS_OFERTAS) {
    throw new Error(
      `getListingOffersBatch admite ${MAX_SKUS_OFERTAS} SKU por llamada y se le han pasado ${skus.length}`
    )
  }

  comprobarRol(creds.connectionId, 'getListingOffersBatch')

  try {
    const { data, requestId, httpStatus } = await spApiRequest<unknown>(
      creds,
      'getListingOffersBatch',
      {
        method: 'POST',
        path: '/batches/products/pricing/v0/listingOffers',
        body: {
          requests: skus.map((sku) => ({
            uri: `/products/pricing/v0/listings/${encodeURIComponent(sku)}/offers`,
            method: 'GET',
            MarketplaceId: opciones.marketplaceId,
            ItemCondition: opciones.condicion ?? 'New',
            CustomerType: opciones.segmento ?? 'Consumer',
          })),
        },
        // Es una LECTURA aunque vaya por POST: repetirla no cambia nada en la
        // tienda de nadie. Sin esto, spApiRequest no reintentaría un 429, que es
        // justo el error que hay que reintentar en un barrido de 685 lotes.
        repeatable: true,
      }
    )
    return { datos: data, requestId, httpStatus }
  } catch (error) {
    return anotarRol(creds.connectionId, 'getListingOffersBatch', error)
  }
}

/* ------------------------------------------------------------------ */
/* getFeaturedOfferExpectedPriceBatch                                  */
/* ------------------------------------------------------------------ */

export interface OpcionesFoep {
  marketplaceId: string
  skus: string[]
  /** El segmento. Ver la nota de OpcionesOfertas */
  segmento?: string
}

/**
 * Pide el FOEP de hasta 40 SKU propios.
 *
 * UNA LLAMADA CADA TREINTA SEGUNDOS. Quien la use tiene que saberlo: no es una
 * lectura más, es la que decide cuánto dura la ventana nocturna.
 */
export async function leerFoep(
  creds: AmazonCredentials,
  opciones: OpcionesFoep
): Promise<RespuestaCruda> {
  const skus = limpiar(opciones.skus)
  if (skus.length === 0) return { datos: { responses: [] }, requestId: null, httpStatus: 200 }
  if (skus.length > MAX_SKUS_FOEP) {
    throw new Error(
      `getFeaturedOfferExpectedPriceBatch admite ${MAX_SKUS_FOEP} SKU por llamada y se le han pasado ${skus.length}`
    )
  }

  comprobarRol(creds.connectionId, 'getFeaturedOfferExpectedPriceBatch')

  try {
    const { data, requestId, httpStatus } = await spApiRequest<unknown>(
      creds,
      'getFeaturedOfferExpectedPriceBatch',
      {
        method: 'POST',
        path: '/batches/products/pricing/2022-05-01/offer/featuredOfferExpectedPrice',
        body: {
          requests: skus.map((sku) => ({
            uri: '/products/pricing/2022-05-01/offer/featuredOfferExpectedPrice',
            method: 'GET',
            marketplaceId: opciones.marketplaceId,
            sku,
            segment: opciones.segmento ? { customerMembership: opciones.segmento } : undefined,
          })),
        },
        repeatable: true,
      }
    )
    return { datos: data, requestId, httpStatus }
  } catch (error) {
    return anotarRol(creds.connectionId, 'getFeaturedOfferExpectedPriceBatch', error)
  }
}

/* ------------------------------------------------------------------ */

/** Sin duplicados, sin vacíos: un SKU repetido gasta uno de los veinte que caben */
function limpiar(skus: string[]): string[] {
  return [...new Set(skus.map((s) => s.trim()).filter((s) => s !== ''))]
}
