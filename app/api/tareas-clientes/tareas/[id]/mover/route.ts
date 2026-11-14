import type { NextRequest } from 'next/server'
import { ErrorDeTareas, moverTarea } from '@/lib/tareas-clientes/servidor'
import { actorDe, conPermiso, cuerpoDe } from '@/lib/tareas-clientes/rutas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Arrastrar una tarjeta: `{ estado, despuesDe }` (la tarea que queda justo antes; null = la primera) */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const c = await cuerpoDe(request)
  return conPermiso(async (p) => {
    if (typeof c.estado !== 'string') throw new ErrorDeTareas('Falta la columna de destino.')
    return moverTarea(actorDe(p), params.id, { estado: c.estado, despuesDe: typeof c.despuesDe === 'string' ? c.despuesDe : null })
  })
}
