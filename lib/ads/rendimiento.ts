/**
 * AMAZON ADS · PEDIR Y LEER EL INFORME DIARIO DE CAMPAÑAS (Marketing Test: pestañas «Resumen» y «Campañas»).
 * SOLO SERVIDOR. Solo LEE: no escribe nada en la cuenta del cliente.
 *
 * Los informes de la v3 son asíncronos (de segundos a minutos): se PIDE, se pregunta si está listo y, cuando lo está, se DESCARGA de una URL firmada. Aquí no se guarda nada —ni el id ni las filas—: el
 * navegador se queda con los identificadores y pregunta cada pocos segundos, y las filas se descargan en el momento (la URL caduca a los minutos). Las cifras se calculan al vuelo en
 * rendimiento-calculo.ts.
 *
 * Se piden DOS informes —el periodo pedido y el anterior, para compararlos— y no uno de doble rango, porque Amazon limita el desglose DIARIO a unos 31 días por informe.
 */

import { gunzipSync } from 'node:zlib'
import { llamarAds } from './datos'
import { AdsError } from './oauth'
import { filasDeInforme, type FilaDiaria } from './rendimiento-calculo'

const TIPO_PETICION = 'application/vnd.createasyncreportrequest.v3+json'

/** Lo que se le pide a Amazon por campaña y día. Si alguna columna no existiera, Amazon contesta 400 diciendo cuál */
const COLUMNAS = ['date', 'campaignId', 'campaignName', 'campaignStatus', 'impressions', 'clicks', 'cost', 'purchases7d', 'sales7d', 'unitsSoldClicks7d'] as const

export interface Periodo {
  desde: string
  hasta: string
}

/** El día 'YYYY-MM-DD' desplazado `dias` días (UTC) */
function desplazar(dia: string, dias: number): string {
  return new Date(Date.parse(`${dia}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10)
}

/**
 * Los dos periodos de `dias` días que acaban AYER (hoy está a medias y Amazon aún no lo consolida): el actual y el inmediatamente anterior. `hoy` es 'YYYY-MM-DD' (se pasa para poder probarlo).
 */
export function periodosDe(hoy: string, dias: number): { actual: Periodo; anterior: Periodo } {
  const hasta = desplazar(hoy, -1)
  const desde = desplazar(hasta, -(dias - 1))
  return { actual: { desde, hasta }, anterior: { desde: desplazar(desde, -dias), hasta: desplazar(desde, -1) } }
}

export async function pedirInforme(conexionId: string, profileId: number, p: Periodo): Promise<string> {
  try {
    const res = await llamarAds<{ reportId?: string }>(conexionId, '/reporting/reports', {
      perfilId: profileId,
      metodo: 'POST',
      cabeceras: { Accept: TIPO_PETICION, 'Content-Type': TIPO_PETICION },
      cuerpo: {
        name: `marketing-test campañas ${p.desde} ${p.hasta}`,
        startDate: p.desde,
        endDate: p.hasta,
        configuration: { adProduct: 'SPONSORED_PRODUCTS', groupBy: ['campaign'], columns: [...COLUMNAS], reportTypeId: 'spCampaigns', timeUnit: 'DAILY', format: 'GZIP_JSON' },
      },
    })
    if (!res.reportId) throw new AdsError('Amazon ha aceptado la petición pero no ha dado id.')
    return res.reportId
  } catch (error) {
    // 425 = «eso ya me lo has pedido»: Amazon guarda los informes por su configuración y trae el id del que ya existe
    const es425 = error instanceof AdsError && (error.estado === 425 || /"425"/.test(error.cuerpo ?? ''))
    if (es425) {
      const ya = (error as AdsError).cuerpo?.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
      if (ya) return ya[0]
    }
    throw error
  }
}

export interface EstadoDeInforme {
  estado: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | string
  url?: string
  detalle?: string
}

export async function estadoDeInforme(conexionId: string, profileId: number, reportId: string): Promise<EstadoDeInforme> {
  const res = await llamarAds<{ status?: string; url?: string; failureReason?: string }>(conexionId, `/reporting/reports/${encodeURIComponent(reportId)}`, { perfilId: profileId })
  return { estado: (res.status ?? 'PENDING').toUpperCase(), url: res.url, detalle: res.failureReason }
}

/** Descarga un informe YA COMPLETADO y devuelve sus filas tal cual las manda Amazon */
export async function descargarCrudas(url: string): Promise<Array<Record<string, unknown>>> {
  // La URL es de S3 y va firmada: mandarle nuestras cabeceras la rechaza
  const res = await fetch(url)
  if (!res.ok) throw new AdsError(`No se ha podido descargar el informe (${res.status}).`)
  const crudo = Buffer.from(await res.arrayBuffer())
  let texto: string
  try {
    // Llega GZIP sin `Content-Encoding`, así que `fetch` no lo descomprime
    texto = gunzipSync(crudo).toString('utf8')
  } catch {
    texto = crudo.toString('utf8')
  }
  const filas = JSON.parse(texto) as unknown
  return Array.isArray(filas) ? (filas as Array<Record<string, unknown>>) : []
}

/** Descarga un informe de campañas YA COMPLETADO y lo convierte en filas diarias */
export async function descargarFilas(url: string): Promise<FilaDiaria[]> {
  return filasDeInforme(await descargarCrudas(url))
}

/** Los términos de búsqueda de un periodo, resumidos (sin desglose por día): la materia prima de las reglas del motor */
const COLUMNAS_TERMINOS = ['campaignId', 'campaignName', 'adGroupId', 'adGroupName', 'searchTerm', 'keyword', 'matchType', 'impressions', 'clicks', 'cost', 'purchases7d', 'sales7d'] as const

export async function pedirInformeDeTerminos(conexionId: string, profileId: number, p: Periodo): Promise<string> {
  try {
    const res = await llamarAds<{ reportId?: string }>(conexionId, '/reporting/reports', {
      perfilId: profileId,
      metodo: 'POST',
      cabeceras: { Accept: TIPO_PETICION, 'Content-Type': TIPO_PETICION },
      cuerpo: {
        name: `marketing-test terminos ${p.desde} ${p.hasta}`,
        startDate: p.desde,
        endDate: p.hasta,
        configuration: { adProduct: 'SPONSORED_PRODUCTS', groupBy: ['searchTerm'], columns: [...COLUMNAS_TERMINOS], reportTypeId: 'spSearchTerm', timeUnit: 'SUMMARY', format: 'GZIP_JSON' },
      },
    })
    if (!res.reportId) throw new AdsError('Amazon ha aceptado la petición pero no ha dado id.')
    return res.reportId
  } catch (error) {
    const es425 = error instanceof AdsError && (error.estado === 425 || /"425"/.test(error.cuerpo ?? ''))
    if (es425) {
      const ya = (error as AdsError).cuerpo?.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
      if (ya) return ya[0]
    }
    throw error
  }
}
