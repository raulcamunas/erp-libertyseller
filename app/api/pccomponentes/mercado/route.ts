import { NextResponse, type NextRequest } from 'next/server'
import { fail, errorResponse, requireAmazonAdmin } from '@/lib/amazon/api'
import { FALTA_LA_MIGRACION_270, actualizarTramo, leerMercado } from '@/lib/pccomponentes/mercado'
import { MiraklError, faltaConfigurarPcc } from '@/lib/pccomponentes/mirakl'

/**
 * ENTRAIS · PCCOMPONENTES: EL MERCADO Y EL MARGEN. SOLO ADMIN.
 *
 *   GET                 lo guardado: cada producto del proveedor que existe en PcComponentes, con su coste y lo que hay en el mercado
 *   POST { desde }      pregunta a PcComponentes por un tramo de 1.000 EAN y lo guarda. Devuelve por dónde seguir
 *
 * Nada de aquí escribe en la tienda de PcComponentes: solo lee su catálogo y guarda en `pcc_mercado`.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

function problema(error: unknown): NextResponse {
  if (error instanceof Error && error.message === FALTA_LA_MIGRACION_270) return fail(503, error.message)
  if (error instanceof MiraklError) return fail(error.estado >= 400 && error.estado < 600 ? error.estado : 502, error.message)
  return errorResponse(error, 'No se ha podido leer el mercado de PcComponentes')
}

export async function GET() {
  try {
    const sesion = await requireAmazonAdmin()
    if (sesion instanceof NextResponse) return sesion
    return NextResponse.json(await leerMercado())
  } catch (error) {
    return problema(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const sesion = await requireAmazonAdmin()
    if (sesion instanceof NextResponse) return sesion
    const falta = faltaConfigurarPcc()
    if (falta) return fail(503, falta)
    const cuerpo = (await request.json().catch(() => null)) as { desde?: unknown } | null
    const desde = Math.max(0, Math.floor(Number(cuerpo?.desde ?? 0)) || 0)
    return NextResponse.json(await actualizarTramo(desde))
  } catch (error) {
    return problema(error)
  }
}
