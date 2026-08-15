/**
 * MARKETING · LOS INFORMES DE AMAZON ADS
 * ======================================
 * SOLO SERVIDOR.
 *
 * Aquí están las cifras que de verdad importan —impresiones, clics, gasto,
 * ventas— y NO se pueden pedir como todo lo demás. Van por un camino de tres
 * pasos que hay que entender antes de tocar nada:
 *
 *   1. PEDIR      POST /reporting/reports  -> devuelve un reportId al instante
 *   2. ESPERAR    GET  /reporting/reports/{id} -> PENDING → PROCESSING → COMPLETED
 *   3. DESCARGAR  la `url` que trae el paso 2, que es un fichero GZIP en S3
 *
 * Entre el 1 y el 3 pasan de diez segundos a varios minutos según el rango de
 * fechas. Por eso NO hay una función que «traiga el informe»: sería una llamada
 * que a veces tarda cinco segundos y a veces cinco minutos, y cualquier ruta que
 * la envolviera se pasaría de tiempo sin remedio. La pantalla pide, y después
 * pregunta cada pocos segundos.
 *
 *
 * ============ EL FICHERO VIENE COMPRIMIDO Y SIN CABECERA QUE LO DIGA ============
 *
 * La URL de S3 devuelve GZIP tal cual. `fetch` no lo descomprime solo porque no
 * llega `Content-Encoding: gzip` —es el contenido, no la codificación del
 * transporte— así que hay que pasarlo por gunzip a mano. Sin eso se recibe
 * binario y el JSON.parse falla con un error que no dice nada de compresión.
 */

import { gunzipSync } from 'node:zlib'
import { llamarAds } from './datos'
import { AdsError } from './oauth'

/** El tipo de contenido para pedir un informe en la v3 */
const TIPO_PETICION = 'application/vnd.createasyncreportrequest.v3+json'

export type EstadoInforme = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'

export interface FilaInforme {
  campaignId: string
  campaignName: string
  impressions: number
  clicks: number
  cost: number
  purchases: number
  sales: number
}

/**
 * Pide el informe de rendimiento por campaña.
 *
 * `timeUnit: SUMMARY` da UNA fila por campaña con el total del periodo, que es
 * lo que enseña la tabla. Con `DAILY` daría una fila por campaña y día — hace
 * falta para dibujar la evolución, y por eso el día que se monte el gráfico será
 * otra petición y no un parámetro de esta.
 *
 * `purchases7d` y `sales7d` son la atribución estándar de Amazon: una venta se
 * cuenta si ocurre dentro de los 7 días siguientes al clic. Es la ventana que
 * usa Seller Central por defecto, así que es la que hace que los números de aquí
 * cuadren con los que el cliente ve en su pantalla — que es lo único que evita
 * una conversación imposible.
 */
export async function pedirInformeCampanas(
  conexionId: string,
  profileId: number,
  desde: string,
  hasta: string
): Promise<string> {
  const res = await llamarAds<{ reportId?: string }>(conexionId, '/reporting/reports', {
    perfilId: profileId,
    metodo: 'POST',
    cabeceras: { Accept: TIPO_PETICION, 'Content-Type': TIPO_PETICION },
    cuerpo: {
      name: `campanas ${desde} ${hasta}`,
      startDate: desde,
      endDate: hasta,
      configuration: {
        adProduct: 'SPONSORED_PRODUCTS',
        groupBy: ['campaign'],
        columns: [
          'campaignId',
          'campaignName',
          'impressions',
          'clicks',
          'cost',
          'purchases7d',
          'sales7d',
        ],
        reportTypeId: 'spCampaigns',
        timeUnit: 'SUMMARY',
        format: 'GZIP_JSON',
      },
    },
  })

  if (!res.reportId) {
    throw new AdsError('Amazon ha aceptado la petición del informe pero no ha dado identificador.')
  }
  return res.reportId
}

export interface EstadoDelInforme {
  estado: EstadoInforme
  /** Solo cuando está COMPLETED */
  url?: string
  /** Lo que dice Amazon cuando falla */
  detalle?: string
}

export async function estadoInforme(
  conexionId: string,
  profileId: number,
  reportId: string
): Promise<EstadoDelInforme> {
  const res = await llamarAds<{
    status?: string
    url?: string
    failureReason?: string
  }>(conexionId, `/reporting/reports/${encodeURIComponent(reportId)}`, {
    perfilId: profileId,
  })

  return {
    estado: ((res.status ?? 'PENDING').toUpperCase() as EstadoInforme) ?? 'PENDING',
    url: res.url,
    detalle: res.failureReason,
  }
}

/**
 * Descarga el fichero y lo convierte en filas.
 *
 * LA URL NO LLEVA NUESTRAS CABECERAS. Es una dirección firmada de S3 con su
 * propia caducidad: mandarle el token de Amazon Ads la rechaza. Por eso este
 * `fetch` va pelado y no pasa por llamarAds().
 */
export async function descargarInforme(url: string): Promise<FilaInforme[]> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new AdsError(
      `No se ha podido descargar el informe (${res.status}). La URL de Amazon caduca a los pocos ` +
        'minutos: vuelve a pedirlo.'
    )
  }

  const comprimido = Buffer.from(await res.arrayBuffer())

  let texto: string
  try {
    texto = gunzipSync(comprimido).toString('utf8')
  } catch {
    // Amazon manda GZIP siempre en este formato, pero si algún día devolviera
    // JSON plano, tratarlo como comprimido tiraría la descarga entera. Se
    // intenta leerlo tal cual antes de rendirse.
    texto = comprimido.toString('utf8')
  }

  const crudo = JSON.parse(texto) as Array<Record<string, unknown>>

  return (Array.isArray(crudo) ? crudo : []).map((f) => ({
    campaignId: String(f.campaignId ?? ''),
    campaignName: String(f.campaignName ?? ''),
    impressions: Number(f.impressions ?? 0),
    clicks: Number(f.clicks ?? 0),
    cost: Number(f.cost ?? 0),
    purchases: Number(f.purchases7d ?? 0),
    sales: Number(f.sales7d ?? 0),
  }))
}
