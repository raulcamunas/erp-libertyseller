/**
 * INFORMES DE AMAZON (Reports 2021-06-30)
 * =======================================
 * SOLO SERVIDOR.
 *
 * Un informe NO es una llamada: es una máquina de estados de cuatro pasos.
 *
 *   1. createReport            -> te da un reportId.        UNA LLAMADA POR MINUTO
 *   2. getReport (en bucle)    -> IN_QUEUE / IN_PROGRESS / DONE / CANCELLED / FATAL
 *   3. getReportDocument       -> una URL firmada.          UNA LLAMADA POR MINUTO
 *   4. descargar esa URL       -> el fichero. CADUCA A LOS CINCO MINUTOS
 *
 * Por eso existe: `searchListingsItems`, que es lo que usa el refresco de cada
 * quince minutos, NO PUEDE PASAR DE 1.000 SKU. Y no da error al quedarse corto:
 * devuelve mil líneas y calla. Con ShoesF y sus ~13.700 referencias eso es leer
 * el 7 % del catálogo creyendo que se ha leído entero. El informe es la única
 * operación capaz de enumerarlo, y además trae los listings suprimidos e
 * inactivos, que la búsqueda tampoco devuelve.
 *
 *
 * LAS TRES COSAS QUE HAY QUE SABER ANTES DE TOCAR ESTO
 * ---------------------------------------------------
 *
 * 1. UN INFORME = UN MARKETPLACE. `marketplaceIds` admite hasta 25 valores en el
 *    modelo, pero para este tipo de informe Amazon documenta que SOLO SE ACEPTA
 *    EL PRIMERO. Un cliente que vende en España, Alemania, Francia e Italia son
 *    cuatro informes, no uno; y como el cupo de createReport es por cuenta de
 *    vendedor, esos cuatro salen del mismo cubo de fichas.
 *
 * 2. `CANCELLED` NO ES UN FALLO. Amazon cancela solo los informes que no tienen
 *    datos que devolver. Un cliente sin listings en ese país devuelve CANCELLED,
 *    no un DONE con fichero vacío. Tratarlo como error genera una alerta falsa
 *    cada noche para cada cliente que sencillamente no vende en ese país, y una
 *    alerta que salta todos los días deja de mirarse.
 *
 * 3. LA URL DE DESCARGA CADUCA EN CINCO MINUTOS, así que pedirla y descargar van
 *    JUNTOS, en el mismo paso. Lo que sí sobrevive a una pausa entre pasadas del
 *    cron es el `reportDocumentId`: con él se vuelve a pedir una URL nueva. Por
 *    eso el trabajo guarda el identificador y nunca la URL.
 *
 * Y una regla de cumplimiento que Amazon escribe expresamente: el contenido de
 * un informe NUNCA se escribe en disco sin cifrar, ni siquiera temporalmente.
 * Aquí se descarga a memoria, se lee y se tira.
 */

import { gunzipSync } from 'zlib'
import { AmazonApiError } from '@/lib/amazon/errors'
import { spApiRequest, type AmazonCredentials } from '@/lib/amazon/sp-api'

/** El censo del catálogo. Roles: nos vale con «Listing de producto», que ya está concedido */
export const INFORME_LISTINGS = 'GET_MERCHANT_LISTINGS_ALL_DATA'

export type EstadoInforme = 'IN_QUEUE' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED' | 'FATAL'

/** Los que ya no van a cambiar */
export function esEstadoFinal(estado: EstadoInforme): boolean {
  return estado === 'DONE' || estado === 'CANCELLED' || estado === 'FATAL'
}

/* ------------------------------------------------------------------ */
/* 1) Pedirlo                                                          */
/* ------------------------------------------------------------------ */

export interface InformePedido {
  reportId: string
  requestId: string | null
}

/**
 * Pide un informe. Devuelve el identificador con el que se le pregunta luego.
 *
 * `dataStartTime` y `dataEndTime` NO se mandan a propósito: este informe es una
 * foto del catálogo actual, no un rango de fechas, y mandarlos devuelve un 400.
 *
 * `reportOptions` se deja vacío por defecto y tampoco es un descuido. La opción
 * `preferredReportDocumentLocale` existe, pero la propia documentación avisa de
 * que los informes NO se cachean por idioma: dentro de la ventana de caché
 * puedes pedir en_US y recibir la cabecera en español. O sea que no arregla el
 * problema que parece arreglar, y a cambio añade una forma de que createReport
 * falle con InvalidInput. La lectura ya sabe leer por posición
 * (lib/plataforma/amazon/informe-listings.ts), que sí funciona en cualquier país.
 *
 * Y `Custom` NO SE USA NUNCA: devuelve el juego de columnas personalizado que
 * tenga configurado ese vendedor, que es impredecible y distinto por cliente.
 */
export async function pedirInforme(
  creds: AmazonCredentials,
  params: {
    tipo: string
    marketplaceId: string
    reportOptions?: Record<string, string> | null
  }
): Promise<InformePedido> {
  const { data, requestId } = await spApiRequest<{ reportId?: string }>(creds, 'createReport', {
    method: 'POST',
    path: '/reports/2021-06-30/reports',
    body: {
      reportType: params.tipo,
      // UN SOLO MARKETPLACE. Ver la nota 1 de la cabecera.
      marketplaceIds: [params.marketplaceId],
      ...(params.reportOptions && Object.keys(params.reportOptions).length > 0
        ? { reportOptions: params.reportOptions }
        : {}),
    },
    // Un POST que crea algo NO se reintenta solo: si la petición llegó y la
    // respuesta se perdió, el reintento pide un segundo informe y quema otra
    // ficha de un cupo que se repone una vez por minuto.
    repeatable: false,
    maxAttempts: 1,
  })

  if (!data.reportId) {
    throw new AmazonApiError({
      kind: 'servidor',
      message: 'createReport sin reportId',
      humanMessage:
        'Amazon ha aceptado la petición del informe pero no ha devuelto su identificador, así que no hay forma de recogerlo. Se reintenta en la pasada siguiente.',
      requestId,
      retryable: true,
    })
  }

  return { reportId: data.reportId, requestId }
}

/* ------------------------------------------------------------------ */
/* 2) Preguntar si está                                                */
/* ------------------------------------------------------------------ */

export interface EstadoDelInforme {
  estado: EstadoInforme
  documentId: string | null
  requestId: string | null
  procesadoAt: string | null
}

interface RespuestaGetReport {
  reportId?: string
  processingStatus?: string
  reportDocumentId?: string
  processingEndTime?: string
  /** Las respuestas antiguas envolvían todo en `payload` */
  payload?: {
    processingStatus?: string
    reportDocumentId?: string
    processingEndTime?: string
  }
}

export async function consultarInforme(
  creds: AmazonCredentials,
  reportId: string
): Promise<EstadoDelInforme> {
  const { data, requestId } = await spApiRequest<RespuestaGetReport>(creds, 'getReport', {
    method: 'GET',
    path: `/reports/2021-06-30/reports/${encodeURIComponent(reportId)}`,
  })

  const cuerpo = data.payload ?? data
  const crudo = (cuerpo.processingStatus ?? '').toUpperCase()
  const estado: EstadoInforme =
    crudo === 'DONE' || crudo === 'CANCELLED' || crudo === 'FATAL' || crudo === 'IN_PROGRESS'
      ? (crudo as EstadoInforme)
      : 'IN_QUEUE'

  return {
    estado,
    // FATAL PUEDE TRAER DOCUMENTO, y ese documento explica por qué murió el
    // informe. Descartarlo es tirar la única pista.
    documentId: cuerpo.reportDocumentId ?? null,
    requestId,
    procesadoAt: cuerpo.processingEndTime ?? null,
  }
}

/* ------------------------------------------------------------------ */
/* 3) y 4) La URL y el fichero                                         */
/* ------------------------------------------------------------------ */

/**
 * Tope de lo que se acepta descargar, ya descomprimido.
 *
 * Un catálogo de 13.700 referencias son unos 6 MB. Cien megas es cinco veces el
 * catálogo más grande imaginable de la cartera, y el tope está para que un
 * fichero absurdo —o un gzip malicioso que se expande— no se lleve por delante
 * la memoria del contenedor, que es la misma que sirve el ERP a los cuatro
 * comerciales.
 */
const MAX_BYTES = 100 * 1024 * 1024

export interface DocumentoInforme {
  texto: string
  bytes: number
  /** true si el fichero venía comprimido y se ha descomprimido aquí */
  comprimido: boolean
  requestId: string | null
}

/**
 * Pide la URL del documento y lo descarga, EN EL MISMO PASO.
 *
 * No se puede partir en dos: la URL caduca a los cinco minutos y una pausa entre
 * pasadas del cron es de cinco. Si esto falla, se vuelve a llamar entero con el
 * mismo `documentId`, que sí sobrevive.
 *
 * Sobre el gzip: se pide `enableContentEncodingUrlHeader=true`, que hace que
 * Amazon marque la respuesta con `Content-Encoding: gzip` y que `fetch` la
 * descomprima sola. Pero no se confía en eso: se miran los DOS PRIMEROS BYTES
 * del fichero y, si son los de un gzip, se descomprime aquí. Las dos vías
 * cubiertas cuestan cuatro líneas; fiarse solo de la cabecera cuesta un informe
 * ilegible el día que cambie el cliente HTTP de Node.
 */
export async function descargarInforme(
  creds: AmazonCredentials,
  documentId: string
): Promise<DocumentoInforme> {
  const { data, requestId } = await spApiRequest<{
    url?: string
    compressionAlgorithm?: string
  }>(creds, 'getReportDocument', {
    method: 'GET',
    path: `/reports/2021-06-30/documents/${encodeURIComponent(documentId)}`,
    query: { enableContentEncodingUrlHeader: true },
  })

  if (!data.url) {
    throw new AmazonApiError({
      kind: 'servidor',
      message: 'getReportDocument sin url',
      humanMessage:
        'Amazon no ha devuelto el enlace de descarga del informe. Se reintenta en la pasada siguiente con el mismo documento.',
      requestId,
      retryable: true,
    })
  }

  // La descarga va contra CloudFront, no contra la Selling Partner API: NO gasta
  // ficha del cupo y no lleva el token de acceso. Meterle la cabecera de
  // autorización a una URL ya firmada es, además, una forma de que la firma
  // deje de cuadrar.
  let respuesta: Response
  try {
    respuesta = await fetch(data.url, { cache: 'no-store' })
  } catch (error) {
    throw new AmazonApiError({
      kind: 'red',
      message: `descarga del informe: ${error instanceof Error ? error.message : 'error de red'}`,
      humanMessage:
        'No se ha podido descargar el fichero del informe. Se reintenta en la pasada siguiente.',
      requestId,
      retryable: true,
    })
  }

  if (!respuesta.ok) {
    throw new AmazonApiError({
      kind: respuesta.status === 403 ? 'auth' : 'servidor',
      message: `descarga del informe: HTTP ${respuesta.status}`,
      humanMessage:
        respuesta.status === 403
          ? 'El enlace de descarga del informe ha caducado (dura cinco minutos). Se vuelve a pedir uno nuevo en la pasada siguiente.'
          : `Amazon ha devuelto ${respuesta.status} al descargar el fichero del informe.`,
      requestId,
      httpStatus: respuesta.status,
      retryable: true,
    })
  }

  const crudo = Buffer.from(await respuesta.arrayBuffer())
  if (crudo.length > MAX_BYTES) {
    throw new AmazonApiError({
      kind: 'peticion',
      message: `informe de ${crudo.length} bytes`,
      humanMessage:
        `El informe de Amazon ocupa ${Math.round(crudo.length / 1024 / 1024)} MB, muy por encima de lo ` +
        'razonable para un catálogo. No se procesa: revisa qué se ha pedido antes de subir el tope.',
    })
  }

  const esGzip = crudo.length > 2 && crudo[0] === 0x1f && crudo[1] === 0x8b
  let bytes = crudo
  if (esGzip) {
    bytes = gunzipSync(crudo, { maxOutputLength: MAX_BYTES })
  }

  // `ignoreBOM` no se toca: por defecto es false, que significa que el
  // decodificador SE COME la marca de orden. La lectura del informe la vuelve a
  // quitar por si acaso, porque recibe una cadena y no sabe de dónde viene.
  const texto = new TextDecoder('utf-8').decode(bytes)

  return { texto, bytes: bytes.length, comprimido: esGzip, requestId }
}
