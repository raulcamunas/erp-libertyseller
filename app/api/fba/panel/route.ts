import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { requireFbaAccess } from '@/lib/fba/acceso'
import { panelDeCliente } from '@/lib/fba/datos'
import { diaEnEspana } from '@/lib/fba/fechas'

/**
 * EL PANEL DE REMESAS DE UN CLIENTE.
 *
 * Todo el cálculo pasa aquí, en el servidor, y la pantalla solo pinta. No es
 * pereza: el reparto necesita los movimientos enteros de cada SKU, que son miles
 * de filas, y mandárselos al navegador para que sume sería mover un histórico
 * por la red en cada visita.
 *
 * Cambios (remesas-pro, 15 nov 2026):
 *   · Al cliente de fuera (actor `cliente`) el panel va sin `analisisIa` (spec §11 D26), como en la página.
 *   · `?cajasDe=<remesa>` trae también las cajas de esa remesa (como la página), para quien pida el panel desde el navegador.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  try {
    const clienteId = request.nextUrl.searchParams.get('cliente') ?? ''
    if (!UUID.test(clienteId)) return fail(400, 'Hay que decir de qué cliente')

    // El guardián comprueba que ESTE cliente esté entre los permitidos. Sin
    // esto, un usuario con acceso a un cliente podría pedir el panel de otro
    // cambiando el id de la URL.
    const session = await requireFbaAccess('ver', clienteId)
    if (session instanceof NextResponse) return session

    const dias = Number(request.nextUrl.searchParams.get('dias') ?? 30)
    const diasDeVelocidad = Number.isFinite(dias) ? Math.min(90, Math.max(7, dias)) : 30

    const cajasDe = request.nextUrl.searchParams.get('cajasDe')
    if (cajasDe && !UUID.test(cajasDe)) return fail(400, 'La remesa de las cajas no es válida')

    const panel = await panelDeCliente(clienteId, {
      hoy: diaEnEspana(),
      diasDeVelocidad,
      // Solo si es de este cliente: panelDeCliente lo comprueba contra sus remesas
      cajasDe: cajasDe || null,
      paraCliente: session.actor === 'cliente' || session.role === 'cliente',
    })
    return NextResponse.json(panel)
  } catch (error) {
    return errorResponse(error, 'No se ha podido calcular el panel de remesas')
  }
}
