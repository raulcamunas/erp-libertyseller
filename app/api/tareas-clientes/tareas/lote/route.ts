import type { NextRequest } from 'next/server'
import { actorDe, conPermiso, cuerpoDe } from '@/lib/tareas-clientes/rutas'
import { ejecutarLote } from '@/lib/tareas-clientes/lote'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/** Varias tareas a la vez: `{ ids: [...], accion: 'mover', estado: 'En progreso' }` o `{ ids: [...], accion: 'archivar' }` */
export async function POST(request: NextRequest) {
  const c = await cuerpoDe(request)
  return conPermiso(async (p) => ejecutarLote(actorDe(p), c))
}
