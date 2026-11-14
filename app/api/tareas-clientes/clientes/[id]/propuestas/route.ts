import type { NextRequest } from 'next/server'
import { propuestasDeUnCliente } from '@/lib/tareas-clientes/reuniones-servidor'
import { conPermiso } from '@/lib/tareas-clientes/rutas'
import { ErrorDeTareas, esUuid } from '@/lib/tareas-clientes/servidor'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Las tareas propuestas que esperan decisión en un cliente, agrupadas por reunión */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  return conPermiso(async (p) => {
    if (!esUuid(params.id)) throw new ErrorDeTareas('Ese cliente no existe.', 404)
    return propuestasDeUnCliente(params.id, p.clientes)
  })
}
