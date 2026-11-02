import { NextResponse, type NextRequest } from 'next/server'
import { exigirSoloAdmin } from '@/lib/comisiones-puente/acceso'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { enlazarConTesoreria, leerEstadoDelMes } from '@/lib/comisiones-puente/datos'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * EMPAREJA UN CLIENTE DE COMISIONES CON SU CLIENTE DE TESORERÍA.
 *
 * Es el dato que faltaba en todo el ERP: `public.clients` y
 * `public.treasury_clients` son dos listas del mismo negocio que hasta hoy solo
 * cuadraba una persona mirando los nombres. Y los nombres no ayudan — de once
 * clientes, solo cinco coinciden; Lenobotics es «Ocio Global Import S.L» y
 * ShoesF es «Zapaterias Basoco S.L».
 *
 * POR ESO ESTO ES UNA RUTA Y NO UNA SIEMBRA DE LA MIGRACIÓN. Un emparejado
 * automático por parecido acierta 5 de 11, y el precio de las otras 6 es
 * escribir la comisión de un cliente en la factura de otro. La pantalla propone
 * la más parecida y enseña los últimos importes de cada candidata; elegir lo
 * hace una persona, una vez, y ya queda guardado.
 *
 * `treasuryClientId: null` deshace la pareja. Tiene que poder hacerse: una
 * pareja equivocada que no se puede quitar desde la pantalla acaba corrigiéndose
 * a mano en la base, que es peor.
 */
export async function PATCH(request: NextRequest) {
  const permiso = await exigirSoloAdmin()
  if (!permiso.ok) return fail(permiso.estado, permiso.mensaje)

  try {
    const cuerpo = (await request.json().catch(() => null)) as {
      clienteId?: string
      treasuryClientId?: string | null
      /** Solo para devolver el estado repintado del mes que hay abierto */
      anio?: number
      mes?: number
    } | null

    if (!cuerpo) return fail(400, 'No ha llegado ningún cambio')

    const clienteId = cuerpo.clienteId ?? ''
    if (!UUID.test(clienteId)) return fail(400, 'Falta el cliente')

    const destino = cuerpo.treasuryClientId ?? null
    if (destino !== null && !UUID.test(destino)) {
      return fail(400, 'Ese cliente de Tesorería no vale')
    }

    const resultado = await enlazarConTesoreria(clienteId, destino)
    if (!resultado.ok) return fail(resultado.estado, resultado.mensaje)

    const anio = Number(cuerpo.anio)
    const mes = Number(cuerpo.mes)
    const puedeRepintar =
      Number.isInteger(anio) && anio >= 2000 && anio <= 2100 && Number.isInteger(mes) && mes >= 1 && mes <= 12

    if (!puedeRepintar) return NextResponse.json({ ok: true, estado: null })

    const estado = await leerEstadoDelMes(clienteId, anio, mes)

    return NextResponse.json({ ok: true, estado: 'noExiste' in estado ? null : estado })
  } catch (error) {
    return errorResponse(error, 'Error emparejando un cliente de comisiones con Tesorería')
  }
}
