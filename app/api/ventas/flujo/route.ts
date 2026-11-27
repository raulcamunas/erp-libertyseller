import { NextResponse, type NextRequest } from 'next/server'
import { errorResponse, fail, requireAmazonAdmin, UUID } from '@/lib/amazon/api'
import { apunteValido, borrarApunte, editarApunte, flujoDeCuenta, guardarApuntes, leerPagosDeAmazon, ocultarPago } from '@/lib/ventas/flujo-servidor'

/**
 * VENTAS · FLUJO DE CAJA. Solo administradores (como el resto del Sellerboard propio).
 *
 *   GET ?cuenta=                                         los pagos de Amazon (liquidaciones) y los apuntes a mano
 *   POST { accion: 'apunte', cuenta, apunte }            añade uno (fecha, descripcion, tipo, importe con signo)
 *   POST { accion: 'editar', cuenta, id, apunte }        lo cambia
 *   POST { accion: 'importar', cuenta, apuntes: [...] }  muchos de golpe (hasta 2.000)
 *   POST { accion: 'borrar', cuenta, id }                borra un apunte
 *   POST { accion: 'ocultar-pago', cuenta, grupo, oculto }  «borra» (o recupera) un pago de Amazon
 *   POST { accion: 'leer', cuenta }                      lee ahora las liquidaciones de Amazon (el cron lo hace cada 6 horas)
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const sesion = await requireAmazonAdmin()
    if (sesion instanceof NextResponse) return sesion
    const cuenta = request.nextUrl.searchParams.get('cuenta') ?? ''
    if (!UUID.test(cuenta)) return fail(400, 'Falta la cuenta.')
    return NextResponse.json(await flujoDeCuenta(cuenta))
  } catch (error) {
    return errorResponse(error, 'Flujo de caja: leer')
  }
}

export async function POST(request: NextRequest) {
  try {
    const sesion = await requireAmazonAdmin()
    if (sesion instanceof NextResponse) return sesion
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const cuenta = typeof b.cuenta === 'string' ? b.cuenta : ''
    if (!UUID.test(cuenta)) return fail(400, 'Falta la cuenta.')
    if (b.accion === 'apunte' || b.accion === 'editar') {
      const a = apunteValido(b.apunte)
      if (!a) return fail(400, 'Faltan la fecha, el tipo o el importe.')
      if (b.accion === 'editar') {
        if (typeof b.id !== 'string' || !UUID.test(b.id)) return fail(400, 'Falta el apunte.')
        await editarApunte(cuenta, b.id, a)
      } else await guardarApuntes(cuenta, [a], sesion.userId)
      return NextResponse.json({ ok: true })
    }
    if (b.accion === 'importar') {
      const lista = (Array.isArray(b.apuntes) ? b.apuntes : []).slice(0, 2000).map(apunteValido).filter((x): x is NonNullable<typeof x> => x !== null)
      if (lista.length === 0) return fail(400, 'El fichero no trae ningún apunte válido.')
      return NextResponse.json({ ok: true, guardados: await guardarApuntes(cuenta, lista, sesion.userId) })
    }
    if (b.accion === 'borrar') {
      if (typeof b.id !== 'string' || !UUID.test(b.id)) return fail(400, 'Falta el apunte.')
      await borrarApunte(cuenta, b.id)
      return NextResponse.json({ ok: true })
    }
    if (b.accion === 'ocultar-pago') {
      if (typeof b.grupo !== 'string' || !b.grupo || b.grupo.length > 200) return fail(400, 'Falta el pago.')
      await ocultarPago(cuenta, b.grupo, b.oculto !== false)
      return NextResponse.json({ ok: true })
    }
    if (b.accion === 'leer') {
      return NextResponse.json({ ok: true, liquidaciones: await leerPagosDeAmazon(cuenta) })
    }
    return fail(400, 'Acción desconocida.')
  } catch (error) {
    return errorResponse(error, 'Flujo de caja: guardar')
  }
}
