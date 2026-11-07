import type { NextRequest } from 'next/server'
import { borrarComentario, editarComentario } from '@/lib/tareas-clientes/servidor'
import { actorDe, conPermiso, cuerpoDe } from '@/lib/tareas-clientes/rutas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const { cuerpo } = await cuerpoDe(request)
  return conPermiso(async (p) => ({ comentario: await editarComentario(actorDe(p), params.id, cuerpo) }))
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  return conPermiso(async (p) => {
    await borrarComentario({ ...actorDe(p), esAdmin: p.esAdmin }, params.id)
    return { ok: true }
  })
}
