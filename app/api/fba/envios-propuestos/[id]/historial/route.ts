import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { puedeVer } from '@/lib/fba/acceso'
import {
  AVISO_316,
  historialDeEnvio,
  leerFilaEnvio,
  respuestaDeErrorDeEnvio,
  sesionDeAgencia,
} from '@/lib/fba/envios-propuestos-servidor'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * EL HISTORIAL DE UN ENVÍO PROPUESTO (spec remesas-pro §4.5).
 *
 * GET → { eventos: Array<{ id, cuando, quien, quienNombre, accion, de, a, nota, datos }>, migracion316 }
 *
 * Lo más nuevo primero. Acciones: crear, actualizar_plan, estado, responsable, fecha_limite, nota, convertir,
 * ajuste_ia, caducar, remesa_borrada, desenlazar, remesa_enviada, remesa_vuelve_a_lista.
 * Solo la agencia; el rol `cliente` recibe 403 (D26).
 */
export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (!UUID.test(params.id)) return fail(400, 'Ese envío propuesto no existe')
    const sesion = await sesionDeAgencia('ver')
    if (sesion instanceof NextResponse) return sesion

    const service = createServiceClient()
    let fila: Awaited<ReturnType<typeof leerFilaEnvio>>
    try {
      fila = await leerFilaEnvio(service, params.id)
    } catch (error) {
      // Sin la 316 no hay historial que enseñar, y no es un error de la pantalla
      if (respuestaDeErrorDeEnvio(error)?.status === 409) return NextResponse.json({ eventos: [], migracion316: false, aviso: AVISO_316 })
      throw error
    }
    if (!fila || !puedeVer(sesion, fila.client_id)) return fail(404, 'Ese envío propuesto ya no existe')

    return NextResponse.json(await historialDeEnvio(service, params.id))
  } catch (error) {
    return respuestaDeErrorDeEnvio(error) ?? errorResponse(error, 'No se ha podido leer el historial del envío propuesto')
  }
}
