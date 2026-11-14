import type { NextRequest } from 'next/server'
import { actorDe, conPermiso, cuerpoDe } from '@/lib/tareas-clientes/rutas'
import { borrarSubtarea, cambiarSubtarea } from '@/lib/tareas-clientes/subtareas-servidor'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function PATCH(request: NextRequest, { params }: { params: { id: string; subtareaId: string } }) {
  const c = await cuerpoDe(request)
  return conPermiso(async (p) => cambiarSubtarea(actorDe(p), params.id, params.subtareaId, c))
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string; subtareaId: string } }) {
  return conPermiso(async (p) => borrarSubtarea(actorDe(p), params.id, params.subtareaId))
}
