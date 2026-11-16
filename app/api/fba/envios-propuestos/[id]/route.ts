import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { puedeVer } from '@/lib/fba/acceso'
import {
  cambiarEnvio,
  leerCambio,
  leerEnvio,
  respuestaDeErrorDeEnvio,
  sesionDeAgencia,
} from '@/lib/fba/envios-propuestos-servidor'
import { diaEnEspana } from '@/lib/fba/fechas'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * UN ENVÍO PROPUESTO: LEERLO Y GESTIONARLO (spec remesas-pro §4.1, §9 y D23).
 *
 * GET → { envio: EnvioPropuestoGuardado }
 *
 * PATCH { version, estado?, responsableId?, fechaLimite?, nota?, motivoDescarte?, aplicarAjuste?: AjusteIa }
 *   → { envio, aviso: string | null }
 *
 * - Las transiciones las decide `puedeCambiar` (trabajo-plan.ts). A «en preparación» solo se llega con
 *   «Convertir en remesa» (POST …/convertir), que crea la remesa y la enlaza.
 * - `version` es la que vio la pantalla: si alguien cambió el envío entre medias, 409 con el envío de ahora
 *   (`conflicto: true`). Cada cambio de una persona la sube; el plan nunca la toca.
 * - `aplicarAjuste` se valida y se recalcula con la aritmética del planificador (nunca se copia la cifra de la IA).
 * - Asignar a otra persona es de admin; uno se puede asignar o soltar a sí mismo.
 *
 * Solo la agencia con permiso de editar el cliente; el rol `cliente` recibe 403 (D26). Sin la 316, 409 con el aviso.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (!UUID.test(params.id)) return fail(400, 'Ese envío propuesto no existe')
    const sesion = await sesionDeAgencia('ver')
    if (sesion instanceof NextResponse) return sesion

    const envio = await leerEnvio(createServiceClient(), params.id, diaEnEspana())
    // El mismo mensaje que si no existiera: no se confirma que exista a quien no lo puede ver
    if (!envio || !puedeVer(sesion, envio.clienteId)) return fail(404, 'Ese envío propuesto ya no existe')
    return NextResponse.json({ envio })
  } catch (error) {
    return respuestaDeErrorDeEnvio(error) ?? errorResponse(error, 'No se ha podido leer el envío propuesto')
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (!UUID.test(params.id)) return fail(400, 'Ese envío propuesto no existe')
    const sesion = await sesionDeAgencia('editar')
    if (sesion instanceof NextResponse) return sesion

    const cuerpo = await request.json().catch(() => null)
    const leido = leerCambio(cuerpo)
    if (!leido.ok) return fail(400, leido.error)

    // cambiarEnvio comprueba que el cliente del envío sea editable para esta sesión (404 si no)
    const r = await cambiarEnvio(createServiceClient(), sesion, params.id, leido.cambio, diaEnEspana())
    return NextResponse.json(r)
  } catch (error) {
    return respuestaDeErrorDeEnvio(error) ?? errorResponse(error, 'No se ha podido cambiar el envío propuesto')
  }
}
