import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { faltaEsquema } from '@/lib/plataforma/pantallas'
import { FALTAN_MIGRACIONES_COSTES } from '@/lib/plataforma/costes/tipos'
import { coberturaDe } from '@/lib/plataforma/costes/pantalla'
import { esFechaIso } from '@/lib/plataforma/costes/vigencia'

/**
 * LA COBERTURA DE COSTES: DE QUÉ ANÁLISIS FIARSE.
 *
 * Solo admin y UN cliente por petición. Es la pantalla que contesta «¿el margen
 * que estoy mirando vale algo?»: sin ella, A3 y A4 dan un veredicto por SKU sin
 * que nadie sepa que la mitad del catálogo no tiene coste, y un veredicto sobre
 * datos que no están es peor que no tener veredicto.
 *
 * El recuento entero lo hace Postgres (plataforma_cobertura_costes, migración
 * 126) y el veredicto lo compone TypeScript con la misma función que juzga un
 * coste suelto. El porqué de esa separación está escrito en la migración.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const clientId = request.nextUrl.searchParams.get('clientId') ?? ''
    if (!UUID.test(clientId)) return fail(400, 'Elige el cliente cuya cobertura quieres ver')

    const fecha = request.nextUrl.searchParams.get('fecha')
    if (fecha && !esFechaIso(fecha)) return fail(400, 'La fecha tiene que ser AAAA-MM-DD')

    const cobertura = await coberturaDe(clientId, fecha ?? undefined)
    return NextResponse.json({ ...cobertura, leidoAt: new Date().toISOString() })
  } catch (error) {
    if (faltaEsquema(error)) return fail(503, FALTAN_MIGRACIONES_COSTES)
    return errorResponse(error, 'Error calculando la cobertura de costes')
  }
}
