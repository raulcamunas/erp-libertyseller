import type { NextRequest } from 'next/server'
import { actorDe, conPermiso, cuerpoDe } from '@/lib/tareas-clientes/rutas'
import { crearSubtarea, listarSubtareas } from '@/lib/tareas-clientes/subtareas-servidor'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  return conPermiso(async (p) => listarSubtareas(actorDe(p), params.id))
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const c = await cuerpoDe(request)
  return conPermiso(async (p) => crearSubtarea(actorDe(p), params.id, c), 201)
}
