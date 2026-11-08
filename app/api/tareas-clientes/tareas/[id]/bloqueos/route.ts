import type { NextRequest } from 'next/server'
import { actorDe, conPermiso, cuerpoDe } from '@/lib/tareas-clientes/rutas'
import { fijarBloqueos } from '@/lib/tareas-clientes/subtareas-servidor'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** De qué tareas depende ésta: `{ ids: [...] }` sustituye la lista */
export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const c = await cuerpoDe(request)
  return conPermiso(async (p) => fijarBloqueos(actorDe(p), params.id, c.ids))
}
