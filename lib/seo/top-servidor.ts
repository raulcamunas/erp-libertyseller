/**
 * SEO · PEDIR Y LEER EL INFORME «TOP SEARCH TERMS» (la competencia de cada búsqueda). SOLO SERVIDOR. Solo LEE de Amazon.
 *
 * El fichero es de todo el país y muy grande: se descarga como flujo (sin cargarlo entero), se descomprime al vuelo y se filtra con LectorDeTop (top-terminos.ts). De cientos de MB se quedan unas
 * pocas miles de filas: las de las búsquedas que ya salen en el Search Query Performance de la cuenta.
 */

import { Readable } from 'node:stream'
import { createGunzip } from 'node:zlib'
import { spApiRequest, type AmazonCredentials } from '@/lib/amazon/sp-api'
import { LectorDeTop, unaPorPosicion, type FilaTop } from './top-terminos'
import type { RangoSqp } from './periodos'

export const TIPO_DE_INFORME_TOP = 'GET_BRAND_ANALYTICS_SEARCH_TERMS_REPORT'
/** Diez minutos de tope para descargar y recorrer el fichero entero */
const ESPERA_DESCARGA_MS = 10 * 60_000

export async function pedirTop(creds: AmazonCredentials, marketplaceId: string, rango: RangoSqp): Promise<string> {
  const { data } = await spApiRequest<{ reportId?: string }>(creds, 'createReport', {
    method: 'POST',
    path: '/reports/2021-06-30/reports',
    body: { reportType: TIPO_DE_INFORME_TOP, marketplaceIds: [marketplaceId], dataStartTime: rango.desde, dataEndTime: rango.hasta, reportOptions: { reportPeriod: rango.periodo } },
    repeatable: false,
    maxAttempts: 1,
  })
  if (!data.reportId) throw new Error('Amazon ha aceptado el informe de búsquedas pero no ha dado su identificador.')
  return data.reportId
}

/** Los trozos de una respuesta, como Buffers */
async function* trozosDe(body: ReadableStream<Uint8Array>): AsyncGenerator<Buffer> {
  const lector = body.getReader()
  for (;;) {
    const { done, value } = await lector.read()
    if (done) return
    if (value) yield Buffer.from(value)
  }
}

/** Descarga el documento del informe y devuelve solo las filas de las búsquedas que `quiere` */
export async function leerTopFiltrado(creds: AmazonCredentials, documentId: string, quiere: (consultaNormalizada: string) => boolean): Promise<{ filas: FilaTop[]; vistas: number }> {
  const { data } = await spApiRequest<{ url?: string; compressionAlgorithm?: string }>(creds, 'getReportDocument', {
    method: 'GET',
    path: `/reports/2021-06-30/documents/${encodeURIComponent(documentId)}`,
  })
  if (!data.url) throw new Error('Amazon no ha devuelto el enlace de descarga del informe de búsquedas.')
  // La URL va firmada: sin nuestras cabeceras
  const res = await fetch(data.url, { cache: 'no-store', signal: AbortSignal.timeout(ESPERA_DESCARGA_MS) })
  if (!res.ok || !res.body) throw new Error(`No se ha podido descargar el informe de búsquedas (${res.status}).`)

  // ¿Viene comprimido? Lo dice Amazon y lo dicen los dos primeros bytes (1f 8b). Se mira el primer trozo antes de decidir
  const origen = trozosDe(res.body)
  const primero = await origen.next()
  if (primero.done) return { filas: [], vistas: 0 }
  const esGzip = data.compressionAlgorithm === 'GZIP' || (primero.value[0] === 0x1f && primero.value[1] === 0x8b)
  async function* todo(): AsyncGenerator<Buffer> {
    yield primero.value as Buffer
    yield* origen
  }
  const flujo: AsyncIterable<Buffer> = esGzip ? Readable.from(todo()).pipe(createGunzip()) : todo()

  const lector = new LectorDeTop(quiere)
  const decodificador = new TextDecoder('utf-8')
  for await (const trozo of flujo) lector.empujar(decodificador.decode(trozo, { stream: true }))
  lector.empujar(decodificador.decode())
  return { filas: unaPorPosicion(lector.guardadas), vistas: lector.filasVistas }
}
