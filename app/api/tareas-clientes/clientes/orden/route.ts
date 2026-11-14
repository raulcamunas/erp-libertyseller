import type { NextRequest } from 'next/server'
import { ErrorDeTareas, reordenarClientes } from '@/lib/tareas-clientes/servidor'
import { conPermiso, cuerpoDe } from '@/lib/tareas-clientes/rutas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** El orden de las tarjetas de clientes tras arrastrarlas: `{ ids: [...] }` en el orden nuevo */
export async function POST(request: NextRequest) {
  const { ids } = await cuerpoDe(request)
  return conPermiso(async (p) => {
    // Es el orden de TODOS los clientes: quien solo ve unos cuantos no lo cambia
    if (p.clientes) throw new ErrorDeTareas('Solo quien ve todos los clientes puede reordenarlos.', 403)
    await reordenarClientes(ids)
    return { ok: true }
  })
}
