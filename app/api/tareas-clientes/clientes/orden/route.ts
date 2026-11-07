import type { NextRequest } from 'next/server'
import { reordenarClientes } from '@/lib/tareas-clientes/servidor'
import { conPermiso, cuerpoDe } from '@/lib/tareas-clientes/rutas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** El orden de las tarjetas de clientes tras arrastrarlas: `{ ids: [...] }` en el orden nuevo */
export async function POST(request: NextRequest) {
  const { ids } = await cuerpoDe(request)
  return conPermiso(async () => {
    await reordenarClientes(ids)
    return { ok: true }
  })
}
