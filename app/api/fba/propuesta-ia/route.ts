import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { requireFbaAccess } from '@/lib/fba/acceso'
import { diaEnEspana } from '@/lib/fba/fechas'
import { enviosDelCliente } from '@/lib/fba/inventario-datos'
import { ErrorDePropuesta, generarPropuestaIa } from '@/lib/fba/propuesta-ia'
import { PARAMETROS_POR_DEFECTO, normalizarParametros, plazoDeEnvios } from '@/lib/fba/reposicion'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * LA PROPUESTA DE REPOSICIÓN CON IA.
 *
 * GET  · lo que la pantalla necesita para ofrecer los parámetros: los de siempre y el plazo que
 *        miden de verdad los envíos de este cliente. Barato: no llama a ninguna IA.
 * POST · genera la propuesta —inventario, cálculo, IA, comprobación— y la DEVUELVE. NO escribe
 *        nada en la base: crear la remesa es el paso siguiente, y es de quien revisa las líneas
 *        (POST /api/fba/remesas). Una IA que monta envíos sin que nadie los mire no es de fiar.
 *
 * SOLO LA AGENCIA. Cada propuesta es una llamada a un servicio de pago y analiza el inventario
 * entero del cliente: no es algo que un cliente deba poder lanzar en bucle. El mismo filtro por
 * cliente que el resto de /api/fba.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

export async function GET(request: NextRequest) {
  try {
    const clienteId = request.nextUrl.searchParams.get('cliente') ?? ''
    if (!UUID.test(clienteId)) return fail(400, 'Hay que decir de qué cliente')

    const sesion = await requireFbaAccess('editar', clienteId)
    if (sesion instanceof NextResponse) return sesion
    if (!sesion.esAdmin) return fail(403, 'La propuesta con IA la genera Liberty Seller')

    const plazo = plazoDeEnvios(await enviosDelCliente(createServiceClient(), clienteId))
    return NextResponse.json({ parametros: { ...PARAMETROS_POR_DEFECTO, plazoDias: plazo.sugerido }, plazo })
  } catch (error) {
    return errorResponse(error, 'No se han podido leer los ajustes de la propuesta')
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { clienteId?: unknown; parametros?: unknown; usarIa?: unknown }
    const clienteId = typeof body.clienteId === 'string' ? body.clienteId : ''
    if (!UUID.test(clienteId)) return fail(400, 'Hay que decir de qué cliente')

    const sesion = await requireFbaAccess('editar', clienteId)
    if (sesion instanceof NextResponse) return sesion
    if (!sesion.esAdmin) return fail(403, 'La propuesta con IA la genera Liberty Seller')

    const { data: cliente } = await createServiceClient().from('amazon_clients').select('name').eq('id', clienteId).maybeSingle()
    if (!cliente) return fail(404, 'Ese cliente no existe')

    const propuesta = await generarPropuestaIa({
      clienteId,
      clienteNombre: (cliente as { name: string }).name,
      parametros: normalizarParametros(body.parametros),
      hoy: diaEnEspana(),
      usarIa: body.usarIa !== false,
    })
    return NextResponse.json({ propuesta }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    // Lo que dice ErrorDePropuesta ya está escrito para que lo lea una persona
    if (error instanceof ErrorDePropuesta) return fail(error.estado, error.message)
    return errorResponse(error, 'No se ha podido generar la propuesta')
  }
}
