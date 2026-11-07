import type { NextRequest } from 'next/server'
import { crearTarea, ErrorDeTareas } from '@/lib/tareas-clientes/servidor'
import { actorDe, conPermiso, cuerpoDe } from '@/lib/tareas-clientes/rutas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Una tarea nueva en un cliente */
export async function POST(request: NextRequest) {
  const cuerpo = await cuerpoDe(request)
  return conPermiso(async (p) => {
    if (typeof cuerpo.clienteId !== 'string') throw new ErrorDeTareas('Falta el cliente.')
    return { tarea: await crearTarea(actorDe(p), { ...cuerpo, clienteId: cuerpo.clienteId }) }
  }, 201)
}
