import { NextResponse, type NextRequest } from 'next/server'
import { UUID, fail } from '@/lib/amazon/api'
import { SIN_CACHE, requerirCorreo, textoDe } from '@/lib/correo/rutas'
import { almacenDeSecuencias } from '@/lib/correo/secuencias/almacen'
import { generarSeguimientosDeUnLead } from '@/lib/correo/secuencias/generar'
import { dentroDelLimite, respuestaDeFalloDeSecuencias } from '@/lib/correo/secuencias/rutas'
import { autorizarBuzon } from '@/lib/correo/servidor'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * ESCRIBIR CON IA LOS SEGUIMIENTOS DEL CORREO QUE SE ACABA DE REDACTAR.
 *
 * POST application/json  { leadId, buzonId, asunto, texto (con la firma, como está en el cuadro), indicaciones? }
 *
 * Contesta `{ ok, seguimientos: [{ orden, dias, diaAprox, asunto, texto }], modelo, aviso }`. Una sola llamada a la IA escribe todos. Solo el dueño del buzón
 * (de él saldrán los correos). Cada persona puede pedirlo 30 veces por hora: cuesta una fracción de céntimo cada vez, pero un bucle no debe poder gastar.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 90

export async function POST(request: NextRequest) {
  const sesion = await requerirCorreo()
  if (sesion instanceof NextResponse) return sesion
  if (!dentroDelLimite(`secuencia-generar:${sesion.userId}`, 30, 3_600_000)) return fail(429, 'Has pedido muchos seguimientos en la última hora: espera un rato.')

  let cuerpo: Record<string, unknown>
  try {
    cuerpo = ((await request.json()) ?? {}) as Record<string, unknown>
  } catch {
    return fail(400, 'No se ha entendido lo que se ha mandado')
  }
  const leadId = typeof cuerpo.leadId === 'string' && UUID.test(cuerpo.leadId) ? cuerpo.leadId.toLowerCase() : null
  if (!leadId) return fail(400, 'Falta el lead al que se escribe.')
  const asunto = textoDe(cuerpo.asunto, 300)
  const texto = typeof cuerpo.texto === 'string' ? cuerpo.texto.slice(0, 8000) : ''
  if (!asunto) return fail(400, 'Falta el asunto del correo.')

  try {
    const service = createServiceClient()
    const auth = await autorizarBuzon(service, sesion, cuerpo.buzonId, 'escribir')
    if (!auth.ok) return fail(auth.estado, auth.mensaje)
    const r = await generarSeguimientosDeUnLead({
      sesion: sesion.supabase,
      service,
      almacen: almacenDeSecuencias(service),
      buzon: auth.buzon,
      leadId,
      asunto,
      texto,
      indicaciones: textoDe(cuerpo.indicaciones, 600),
    })
    if (!r.ok) return fail(r.estado, r.mensaje)
    return NextResponse.json({ ok: true, seguimientos: r.seguimientos, modelo: r.modelo, aviso: r.aviso }, { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFalloDeSecuencias('Correo · secuencias: generar', error)
  }
}
