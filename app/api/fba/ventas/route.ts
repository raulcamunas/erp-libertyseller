import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { diaEnEspana } from '@/lib/fba/fechas'
import { puedeVerCliente, sesionDeRemesas } from '@/lib/fba/resumen-servidor'
import type { DiasVentas } from '@/lib/fba/ventas-fba'
import { DIAS_VALIDOS, ventasDeCliente } from '@/lib/fba/ventas-servidor'

/**
 * LAS VENTAS FBA DE UN CLIENTE (sección «Ventas»).
 *
 * `GET /api/fba/ventas?cliente=<id>&dias=7|30|90|365` → `VentasFba` más de qué copia del libro sale
 * (`mercado`, `leidoHasta`, `leidoDesde`) y su `aviso`. Spec §9 y §11 D29, D35 y D36.
 * La agencia y el cliente externo (de sus propios clientes). Memoria de 3 min; `?refrescar=1` la salta.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  try {
    const clienteId = request.nextUrl.searchParams.get('cliente') ?? ''
    if (!UUID.test(clienteId)) return fail(400, 'Hay que decir de qué cliente')

    const diasPedidos = Number(request.nextUrl.searchParams.get('dias') ?? 30)
    if (!(DIAS_VALIDOS as readonly number[]).includes(diasPedidos)) return fail(400, 'Los días tienen que ser 7, 30, 90 o 365')

    const sesion = await sesionDeRemesas()
    if (sesion instanceof NextResponse) return sesion
    // Sin esto, quien ve un cliente podría pedir las ventas de otro cambiando el id de la URL
    if (!puedeVerCliente(sesion, clienteId)) return fail(403, 'No tienes acceso a este cliente')

    const refrescar = request.nextUrl.searchParams.get('refrescar') === '1'
    const ventas = await ventasDeCliente(clienteId, diasPedidos as DiasVentas, diaEnEspana(), { refrescar })
    return NextResponse.json(ventas)
  } catch (error) {
    return errorResponse(error, 'No se han podido leer las ventas FBA')
  }
}
