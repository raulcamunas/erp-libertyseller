import { NextResponse, type NextRequest } from 'next/server'
import { errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import {
  REFRESCO_POR_DEFECTO,
  guardarConfigRefresco,
  leerConfigRefrescos,
} from '@/lib/plataforma/refresco-config'
import type { AmazonJobTipo } from '@/lib/plataforma/tipos'

/**
 * CADA CUÁNTO LE TOCA A CADA REFRESCO.
 *
 * Ojo con no confundirlo con /api/sistema/cron, que es el OTRO reloj: aquel dice
 * cada cuánto se despierta el motor (minutos), este cada cuánto le toca a cada
 * cosa (horas o días). Que el motor entre cada 5 minutos no significa que se
 * relea el catálogo cada 5 minutos.
 */
export const dynamic = 'force-dynamic'

const TIPOS = Object.keys(REFRESCO_POR_DEFECTO) as AmazonJobTipo[]

export async function GET() {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session
    return NextResponse.json({ config: await leerConfigRefrescos(TIPOS) })
  } catch (error) {
    return errorResponse(error, 'No se ha podido leer el horario de los refrescos')
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => ({}))) as {
      tipo?: unknown
      cadaMinutos?: unknown
      soloDeNoche?: unknown
      activo?: unknown
    }
    const tipo = typeof body.tipo === 'string' ? (body.tipo as AmazonJobTipo) : null
    if (!tipo || !TIPOS.includes(tipo)) {
      return fail(400, `«${String(body.tipo)}» no es un refresco que el planificador sepa encolar`)
    }

    const config = await guardarConfigRefresco(
      tipo,
      {
        cadaMinutos: typeof body.cadaMinutos === 'number' ? body.cadaMinutos : undefined,
        soloDeNoche: typeof body.soloDeNoche === 'boolean' ? body.soloDeNoche : undefined,
        activo: typeof body.activo === 'boolean' ? body.activo : undefined,
      },
      session.userId
    )

    return NextResponse.json({ ok: true, config })
  } catch (error) {
    if (isMissingSchema(error)) {
      return fail(
        503,
        'Falta la tabla de horarios de refresco: lanza 139_refresco_config.sql en el editor SQL ' +
          'de Supabase. Mientras tanto todo corre con las cadencias de siempre.'
      )
    }
    return errorResponse(error, 'No se ha podido guardar el horario del refresco')
  }
}
