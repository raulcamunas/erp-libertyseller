import { NextResponse, type NextRequest } from 'next/server'
import { UUID, fail } from '@/lib/amazon/api'
import { SIN_CACHE, requerirCorreo } from '@/lib/correo/rutas'
import { almacenDeSecuencias } from '@/lib/correo/secuencias/almacen'
import { respuestaDeFalloDeSecuencias } from '@/lib/correo/secuencias/rutas'
import { estadoParaElCuadro, pantallaVisible, situacionDelLeadParaElCuadro } from '@/lib/correo/secuencias/servidor'
import { quienPide } from '@/lib/correo/servidor'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * LO QUE NECESITA EL CUADRO DE CORREO PARA OFRECER (O NO) LOS SEGUIMIENTOS AUTOMÁTICOS.
 *
 * GET ?buzonId=…  (un buzón que es de quien pregunta)
 * GET ?buzonId=…&leadId=…  lo mismo, y además `lead: { admite, motivo, mensaje }` con lo que se sabe de ESE lead (si es de antes de las automatizaciones, si ya está cerrado): ver
 *                          situacionDelLeadParaElCuadro. Solo se contesta por él cuando la función está disponible.
 * GET (sin buzón)  →  `{ ok, visible }`: si Correo ofrece el botón «Secuencias» a esta persona (un administrador siempre; el resto, con el motor en marcha)
 *
 * Devuelve `{ disponible, mensaje, activa, ensayo, pasos: [{ orden, dias, diaAprox }], diasHastaNoInteresa, topeHoy, enviadosHoy }`. Con el motor apagado la función es invisible
 * para el equipo (`disponible: false`); un fallo (por ejemplo, la migración sin lanzar) también devuelve `disponible: false` y no un error: el cuadro de
 * correo funciona exactamente igual sin los seguimientos.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 20

export async function GET(request: NextRequest) {
  const sesion = await requerirCorreo()
  if (sesion instanceof NextResponse) return sesion
  const buzon = request.nextUrl.searchParams.get('buzonId')
  if (!buzon) {
    try {
      const service = createServiceClient()
      const quien = await quienPide(service, sesion)
      return NextResponse.json({ ok: true, visible: await pantallaVisible(almacenDeSecuencias(service), quien) }, { headers: SIN_CACHE })
    } catch (error) {
      respuestaDeFalloDeSecuencias('Correo · secuencias: visible', error)
      return NextResponse.json({ ok: true, visible: false }, { headers: SIN_CACHE })
    }
  }
  if (!UUID.test(buzon)) return fail(400, 'Falta el buzón.')
  const leadId = request.nextUrl.searchParams.get('leadId')
  if (leadId !== null && !UUID.test(leadId)) return fail(400, 'El lead no es válido.')
  try {
    const service = createServiceClient()
    const quien = await quienPide(service, sesion)
    const almacen = almacenDeSecuencias(service)
    // Las lecturas del lead van a la vez que las del estado: el bloque del cuadro espera a las dos. Del lead solo se contesta si hay algo que ofrecer
    const [estado, lead] = await Promise.all([estadoParaElCuadro(almacen, quien, buzon.toLowerCase()), leadId !== null ? situacionDelLeadParaElCuadro(almacen, leadId.toLowerCase()) : null])
    return NextResponse.json({ ok: true, ...estado, ...(lead && estado.disponible ? { lead } : {}) }, { headers: SIN_CACHE })
  } catch (error) {
    respuestaDeFalloDeSecuencias('Correo · secuencias: estado', error)
    return NextResponse.json({ ok: true, disponible: false, mensaje: null, activa: false, ensayo: false, pasos: [], diasHastaNoInteresa: 0, topeHoy: 0, enviadosHoy: 0 }, { headers: SIN_CACHE })
  }
}
