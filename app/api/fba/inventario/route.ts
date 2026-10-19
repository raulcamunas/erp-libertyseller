import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { requireFbaAccess } from '@/lib/fba/acceso'
import { diaEnEspana } from '@/lib/fba/fechas'
import { inventarioDeCliente } from '@/lib/fba/inventario-datos'

/**
 * EL INVENTARIO FBA DE UN CLIENTE, ENTERO.
 *
 * Todo lo que hay en Amazon de ese cliente, referencia a referencia: cuánto stock, cuánto se
 * vende, cuánto se devuelve, cuánto lleva parado y a qué ritmo se agota (ver
 * lib/fba/inventario.ts). Se pide cuando se abre la pestaña Inventario y no con la pantalla:
 * son los movimientos de varios meses de un cliente.
 *
 * El mismo filtro por cliente que el resto de /api/fba: quien no tenga acceso a ese cliente
 * recibe lo mismo que si no existiera. Solo LEE; no escribe nada ni llama a Amazon.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  try {
    const clienteId = request.nextUrl.searchParams.get('cliente') ?? ''
    if (!UUID.test(clienteId)) return fail(400, 'Hay que decir de qué cliente')

    const sesion = await requireFbaAccess('ver', clienteId)
    if (sesion instanceof NextResponse) return sesion

    const inventario = await inventarioDeCliente(clienteId, { hoy: diaEnEspana() })
    return NextResponse.json({ inventario }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return errorResponse(error, 'No se ha podido leer el inventario')
  }
}
