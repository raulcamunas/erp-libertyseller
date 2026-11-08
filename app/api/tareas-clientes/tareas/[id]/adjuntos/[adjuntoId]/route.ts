import type { NextRequest } from 'next/server'
import { borrarAdjunto } from '@/lib/tareas-clientes/adjuntos-servidor'
import { actorDe, conPermiso } from '@/lib/tareas-clientes/rutas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function DELETE(_request: NextRequest, { params }: { params: { id: string; adjuntoId: string } }) {
  return conPermiso(async (p) => ({ total: await borrarAdjunto(actorDe(p), params.id, params.adjuntoId) }))
}
