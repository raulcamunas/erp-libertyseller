import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { panelDeCliente } from '@/lib/fba/datos'
import { diaEnEspana } from '@/lib/fba/fechas'
import { inventarioDeCliente } from '@/lib/fba/inventario-datos'
import { lotesDeEnvios } from '@/lib/fba/lotes-envio'
import { puedeVerCliente, sesionDeRemesas } from '@/lib/fba/resumen-servidor'
import { ritmoParaLotes } from '@/lib/fba/ventas-servidor'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * EL FIFO POR LOTES DE UN CLIENTE (sección «Lotes»).
 *
 * `GET /api/fba/lotes?cliente=<id>` → `{ lotes: LoteEnvio[], resumen: ResumenLotes, ritmo: { origen, calculadoAt } }`.
 * Spec §5 y §9. El reparto es el de siempre (`panelDeCliente` → `repartirSku`); `lotesDeEnvios` solo lo lee.
 * Lo que le queda a un lote vivo se estima con el ritmo de la última pasada del planificador (un único número por
 * pregunta) o, si no hay, con el `ritmoPlan` del inventario. La agencia y el cliente externo (de sus clientes).
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  try {
    const clienteId = request.nextUrl.searchParams.get('cliente') ?? ''
    if (!UUID.test(clienteId)) return fail(400, 'Hay que decir de qué cliente')

    const sesion = await sesionDeRemesas()
    if (sesion instanceof NextResponse) return sesion
    if (!puedeVerCliente(sesion, clienteId)) return fail(403, 'No tienes acceso a este cliente')

    const hoy = diaEnEspana()
    // D26: al cliente externo, el panel sin lo de agencia. Va en una variable para que compile también antes de
    // que `panelDeCliente` acepte la opción (S4a); de aquí solo salen lotes, nunca el análisis IA.
    const opcionesPanel = { hoy, paraCliente: sesion.actor === 'cliente' }
    const [panel, ritmo] = await Promise.all([
      panelDeCliente(clienteId, opcionesPanel),
      ritmoParaLotes(createServiceClient(), clienteId, hoy, async () => (await inventarioDeCliente(clienteId, { hoy })).skus),
    ])

    const { lotes, resumen } = lotesDeEnvios(panel, ritmo.ritmo, hoy)
    return NextResponse.json({ lotes, resumen, ritmo: { origen: ritmo.origen, calculadoAt: ritmo.calculadoAt } })
  } catch (error) {
    return errorResponse(error, 'No se han podido calcular los lotes de los envíos')
  }
}
