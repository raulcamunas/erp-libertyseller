import { NextResponse, type NextRequest } from 'next/server'
import { fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { MiraklError, faltaConfigurarPcc } from '@/lib/pccomponentes/mirakl'
import { ventasDe } from '@/lib/pccomponentes/ventas-servidor'

/** LAS VENTAS DE ENTRAIS EN PCCOMPONENTES de un periodo: GET ?desde=AAAA-MM-DD&hasta=AAAA-MM-DD. Solo administradores. Solo lee. */
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const FECHA = /^\d{4}-\d{2}-\d{2}$/

export async function GET(request: NextRequest) {
  const sesion = await requireAmazonAdmin()
  if (sesion instanceof NextResponse) return sesion
  const falta = faltaConfigurarPcc()
  if (falta) return fail(503, falta)
  const q = request.nextUrl.searchParams
  const desde = q.get('desde') ?? ''
  const hasta = q.get('hasta') ?? ''
  if (!FECHA.test(desde) || !FECHA.test(hasta) || desde > hasta) return fail(400, 'Fechas no válidas')
  try {
    return NextResponse.json(await ventasDe(`${desde}T00:00:00Z`, `${hasta}T23:59:59Z`))
  } catch (e) {
    if (e instanceof MiraklError) return fail(e.estado === 429 ? 429 : 502, e.message)
    return fail(500, e instanceof Error ? e.message : 'Error')
  }
}
