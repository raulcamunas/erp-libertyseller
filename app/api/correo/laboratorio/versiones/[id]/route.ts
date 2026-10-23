import { NextResponse, type NextRequest } from 'next/server'
import { UUID, fail } from '@/lib/amazon/api'
import { actualizarVersion, declararGanadora } from '@/lib/correo/ia-laboratorio-servidor'
import { leerJson, requerirConfigCorreos, respuestaDeFalloDeConfiguracion } from '@/lib/correo/laboratorio-rutas'
import { SIN_CACHE } from '@/lib/correo/rutas'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * CAMBIAR UNA VERSIÓN DE LA IA.
 *
 * PATCH { accion: 'ganadora' }  la deja en marcha con todo el reparto y pausa las demás («que todos usen ésta»).
 * PATCH { nombre?, notas?, peso?, activa?, archivada?, secciones?, ejemplosIds?, usarGanadores?, modelo? }
 *       Lo primero (nombre, notas, peso, en marcha, archivar) se puede siempre. Las instrucciones, los ejemplos y el modelo, solo mientras
 *       la versión no haya escrito ningún borrador: si no, 409 («duplícala»). La versión original solo admite peso y en marcha.
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
    if (cuerpo.accion === 'ganadora') {
      const r = await declararGanadora(service, params.id.toLowerCase())
      if (!r.ok) return fail(r.estado, r.error)
      return NextResponse.json({ ok: true }, { headers: SIN_CACHE })
    }
    const r = await actualizarVersion(service, params.id.toLowerCase(), cuerpo)
    if (!r.ok) return fail(r.estado, r.error)
    return NextResponse.json({ ok: true, version: r.valor, avisos: r.avisos }, { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFalloDeConfiguracion('Correo · versiones: fallo al guardar', error)
  }
}
