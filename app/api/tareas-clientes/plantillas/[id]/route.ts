import type { NextRequest } from 'next/server'
import { actorDe, conPermiso, cuerpoDe } from '@/lib/tareas-clientes/rutas'
import { borrarPlantilla, guardarPlantilla } from '@/lib/tareas-clientes/plantillas'
import { ErrorDeTareas, esUuid } from '@/lib/tareas-clientes/servidor'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const c = await cuerpoDe(request)
  return conPermiso(async (p) => {
    if (!esUuid(params.id)) throw new ErrorDeTareas('Esa plantilla no existe.', 404)
    return { plantilla: await guardarPlantilla(actorDe(p), params.id, c) }
  })
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  return conPermiso(async () => {
    if (!esUuid(params.id)) throw new ErrorDeTareas('Esa plantilla no existe.', 404)
    await borrarPlantilla(params.id)
    return { ok: true }
  })
}
