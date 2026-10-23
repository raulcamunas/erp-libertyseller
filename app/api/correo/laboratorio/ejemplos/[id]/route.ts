import { NextResponse, type NextRequest } from 'next/server'
import { UUID, fail } from '@/lib/amazon/api'
import { actualizarEjemplo, borrarEjemplo, ejemplosBloqueados, listarVersiones, usoDeVersiones } from '@/lib/correo/ia-laboratorio-servidor'
import { leerJson, requerirConfigCorreos, respuestaDeFalloDeConfiguracion } from '@/lib/correo/laboratorio-rutas'
import { SIN_CACHE } from '@/lib/correo/rutas'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * CAMBIAR O BORRAR UN CORREO DE EJEMPLO PROPIO.
 *
 * PATCH { titulo?, asunto, texto, tipo?, nota?, activo? }
 * DELETE
 * Si lo lee una versión que ya ha escrito borradores, su contenido (asunto, texto, tipo, activo) no se puede cambiar ni se puede borrar (409):
 * los resultados de esa versión dejarían de decir lo que dicen. El título y la nota sí se pueden cambiar.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function estaBloqueado(id: string): Promise<boolean> {
  const service = createServiceClient()
  const versiones = await listarVersiones(service)
  const uso = await usoDeVersiones(service, versiones)
  return ejemplosBloqueados(versiones, uso).has(id)
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const sesion = await requerirConfigCorreos()
  if (sesion instanceof NextResponse) return sesion
  if (!UUID.test(params.id)) return fail(404, 'No se encuentra ese ejemplo.')
  const cuerpo = await leerJson(request)
  if (!cuerpo) return fail(400, 'No se ha entendido lo que se ha mandado')
  try {
    const id = params.id.toLowerCase()
    const bloqueado = await estaBloqueado(id)
    const r = await actualizarEjemplo(createServiceClient(), id, cuerpo, bloqueado)
    if (!r.ok) return fail(r.estado, r.error)
    return NextResponse.json({ ok: true, ejemplo: { ...r.valor, bloqueado }, avisos: r.avisos }, { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFalloDeConfiguracion('Correo · ejemplos: fallo al guardar', error)
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const sesion = await requerirConfigCorreos()
  if (sesion instanceof NextResponse) return sesion
  if (!UUID.test(params.id)) return fail(404, 'No se encuentra ese ejemplo.')
  try {
    const id = params.id.toLowerCase()
    const r = await borrarEjemplo(createServiceClient(), id, await estaBloqueado(id))
    if (!r.ok) return fail(r.estado, r.error)
    return NextResponse.json({ ok: true }, { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFalloDeConfiguracion('Correo · ejemplos: fallo al borrar', error)
  }
}
