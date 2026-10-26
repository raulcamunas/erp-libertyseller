import { NextResponse, type NextRequest } from 'next/server'
import { UUID, fail } from '@/lib/amazon/api'
import { leerJson, requerirConfigCorreos } from '@/lib/correo/laboratorio-rutas'
import { SIN_CACHE } from '@/lib/correo/rutas'
import { createServiceClient } from '@/lib/supabase/service'
import { actualizarVersion, publicarVersion } from '@/lib/whatsapp/ia-laboratorio-servidor'
import { respuestaDeFalloDeWhatsapp, vistaDeVersion } from '@/lib/whatsapp/ia-laboratorio-rutas'

/**
 * CAMBIAR UNA VERSIÓN DE LA IA DE WHATSAPP.
 *
 * PATCH { accion: 'publicar' }  la pone en producción: desde ese momento la usa todo el equipo, y la que estaba deja de estarlo (no se borra: se puede volver a ella).
 * PATCH { nombre?, notas?, perfil?, archivada? }
 *       El nombre, las notas y archivar se pueden siempre (menos en la original, que conserva el suyo). El perfil, solo mientras la versión no haya estado en producción: si no, 409
 *       («duplícala»). La que usa el equipo ahora no se puede archivar.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const sesion = await requerirConfigCorreos()
  if (sesion instanceof NextResponse) return sesion
  if (!UUID.test(params.id)) return fail(404, 'No se encuentra esa versión.')
  const cuerpo = await leerJson(request)
  if (!cuerpo) return fail(400, 'No se ha entendido lo que se ha mandado')
  try {
    const service = createServiceClient()
    if (cuerpo.accion === 'publicar') {
      const r = await publicarVersion(service, params.id.toLowerCase(), sesion.userId)
      if (!r.ok) return fail(r.estado, r.error)
      return NextResponse.json({ ok: true, versiones: r.valor.map(vistaDeVersion) }, { headers: SIN_CACHE })
    }
    const r = await actualizarVersion(service, params.id.toLowerCase(), cuerpo)
    if (!r.ok) return fail(r.estado, r.error)
    return NextResponse.json({ ok: true, version: vistaDeVersion(r.valor), avisos: r.avisos }, { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFalloDeWhatsapp('WhatsApp · versiones: fallo al guardar', error)
  }
}
