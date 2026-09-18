import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { panelDeCliente } from '@/lib/fba/datos'
import { diaEnEspana } from '@/lib/fba/fechas'

/**
 * EL PANEL DE REMESAS DE UN CLIENTE.
 *
 * Todo el cálculo pasa aquí, en el servidor, y la pantalla solo pinta. No es
 * pereza: el reparto necesita los movimientos enteros de cada SKU, que son miles
 * de filas, y mandárselos al navegador para que sume sería mover un histórico
 * por la red en cada visita.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const clienteId = request.nextUrl.searchParams.get('cliente') ?? ''
    if (!UUID.test(clienteId)) return fail(400, 'Hay que decir de qué cliente')

    const dias = Number(request.nextUrl.searchParams.get('dias') ?? 30)
    const diasDeVelocidad = Number.isFinite(dias) ? Math.min(90, Math.max(7, dias)) : 30

    const panel = await panelDeCliente(clienteId, { hoy: diaEnEspana(), diasDeVelocidad })
    return NextResponse.json(panel)
  } catch (error) {
    return errorResponse(error, 'No se ha podido calcular el panel de remesas')
  }
}
