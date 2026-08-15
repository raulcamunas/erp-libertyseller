import { NextResponse, type NextRequest } from 'next/server'
import { UUID, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { AdsError } from '@/lib/ads/oauth'
import { perfilParaLlamar } from '@/lib/ads/datos'
import {
  descargarInforme,
  estadoInforme,
  pedirInformeCampanas,
} from '@/lib/ads/informes'

/**
 * EL INFORME DE RENDIMIENTO, EN DOS LLAMADAS.
 *
 *   POST  → lo pide y devuelve el identificador
 *   PATCH → pregunta si está, y si lo está lo descarga y devuelve las filas
 *
 * SON DOS RUTAS Y NO UNA porque Amazon tarda de diez segundos a varios minutos
 * en generarlo. Una sola llamada que esperase dentro se pasaría del tiempo
 * máximo de la ruta y moriría justo en los informes grandes, que son los que más
 * falta hacen. Así la pantalla pide, y después pregunta cada pocos segundos.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/** Cuántos días atrás se pide por defecto */
const DIAS = 30

function dia(offset: number): string {
  return new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10)
}

async function cuenta(perfilId: string | undefined) {
  if (!perfilId || !UUID.test(perfilId)) throw new AdsError('Falta la cuenta.')
  const perfil = await perfilParaLlamar(perfilId)
  if (!perfil) throw new AdsError('Esa cuenta ya no existe.')
  if (!perfil.enUso) throw new AdsError(`«${perfil.nombre}» está apagada.`)
  return perfil
}

/* ---------------- Pedirlo ---------------- */

export async function POST(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => ({}))) as {
      perfilId?: string
      desde?: string
      hasta?: string
    }
    const perfil = await cuenta(body.perfilId)

    /**
     * AYER Y NO HOY como fecha final, a propósito.
     *
     * Amazon no cierra el día hasta pasadas unas horas: pedir hasta hoy devuelve
     * un día a medias que hace que el ACOS de la última jornada salga disparado
     * —el gasto ya está contado y las ventas todavía no—. Es la clase de cifra
     * que provoca una llamada de un cliente por un problema que no existe.
     */
    const hasta = body.hasta ?? dia(1)
    const desde = body.desde ?? dia(DIAS)

    const reportId = await pedirInformeCampanas(
      perfil.conexionId,
      perfil.profileId,
      desde,
      hasta
    )
    return NextResponse.json({ reportId, desde, hasta })
  } catch (error) {
    if (error instanceof AdsError) return fail(400, error.message)
    console.error('Error pidiendo el informe de Amazon Ads:', error)
    return fail(500, 'No se ha podido pedir el informe')
  }
}

/* ---------------- Preguntar y descargar ---------------- */

// PATCH y no PUT porque es el verbo que lib/amazon/client.ts ya sabe mandar, y
// añadir un `putAmazon` solo para esto sería una función más que mantener.
export async function PATCH(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => ({}))) as {
      perfilId?: string
      reportId?: string
    }
    const perfil = await cuenta(body.perfilId)
    if (!body.reportId) return fail(400, 'Falta el identificador del informe.')

    const estado = await estadoInforme(perfil.conexionId, perfil.profileId, body.reportId)

    if (estado.estado === 'FAILED') {
      return fail(
        400,
        `Amazon no ha podido generar el informe: ${estado.detalle ?? 'sin detalle'}. ` +
          'Suele ser un rango de fechas donde esa cuenta no tenía actividad.'
      )
    }
    if (estado.estado !== 'COMPLETED' || !estado.url) {
      return NextResponse.json({ listo: false, estado: estado.estado })
    }

    return NextResponse.json({ listo: true, filas: await descargarInforme(estado.url) })
  } catch (error) {
    if (error instanceof AdsError) return fail(400, error.message)
    console.error('Error descargando el informe de Amazon Ads:', error)
    return fail(500, 'No se ha podido descargar el informe')
  }
}
