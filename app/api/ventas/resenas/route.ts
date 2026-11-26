import { NextResponse, type NextRequest } from 'next/server'
import { errorResponse, fail, requireAmazonAdmin, UUID } from '@/lib/amazon/api'
import { borrarCampana, cambiarEnvio, detalleResenas, guardarCampana, resumenResenas } from '@/lib/ventas/resenas-servidor'
import type { Campana } from '@/lib/ventas/resenas'

/**
 * RESEÑAS (Sellerboard propio) · LO QUE USA LA PANTALLA. Solo administradores.
 *
 *   GET                                  todas las cuentas: enviadas hoy, 7 y 30 días, en cola y campañas
 *   GET ?cuenta=                         una cuenta: campañas, cola por días y por estado, y los pedidos
 *   POST { accion: 'campana', cuenta, campana }      crea o cambia una campaña (con id, la cambia)
 *   POST { accion: 'borrar', cuenta, id }            borra una campaña (lo que tenía en cola se descarta)
 *   POST { accion: 'descartar'|'recuperar', cuenta, pedido }  saca un pedido de la cola o lo vuelve a meter
 * El envío de verdad lo hace el cron (/api/ventas/resenas/cron), nunca esta ruta.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const sesion = await requireAmazonAdmin()
    if (sesion instanceof NextResponse) return sesion
    const cuenta = request.nextUrl.searchParams.get('cuenta')
    if (!cuenta) return NextResponse.json(await resumenResenas())
    if (!UUID.test(cuenta)) return fail(400, 'Cuenta no válida.')
    return NextResponse.json(await detalleResenas(cuenta))
  } catch (error) {
    return errorResponse(error, 'Reseñas: leer')
  }
}

export async function POST(request: NextRequest) {
  try {
    const sesion = await requireAmazonAdmin()
    if (sesion instanceof NextResponse) return sesion
    const b = (await request.json().catch(() => ({}))) as { accion?: string; cuenta?: string; campana?: Partial<Campana>; id?: string; pedido?: string }
    if (typeof b.cuenta !== 'string' || !UUID.test(b.cuenta)) return fail(400, 'Falta la cuenta.')
    if (b.accion === 'campana' && b.campana) {
      if (b.campana.id && !UUID.test(b.campana.id)) return fail(400, 'Campaña no válida.')
      return NextResponse.json({ ok: true, id: await guardarCampana(b.cuenta, b.campana, sesion.userId) })
    }
    if (b.accion === 'borrar' && typeof b.id === 'string' && UUID.test(b.id)) {
      await borrarCampana(b.cuenta, b.id)
      return NextResponse.json({ ok: true })
    }
    if ((b.accion === 'descartar' || b.accion === 'recuperar') && typeof b.pedido === 'string' && b.pedido.length < 40) {
      await cambiarEnvio(b.cuenta, b.pedido, b.accion)
      return NextResponse.json({ ok: true })
    }
    return fail(400, 'Acción desconocida.')
  } catch (error) {
    return errorResponse(error, 'Reseñas: guardar')
  }
}
