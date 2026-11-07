import type { NextRequest } from 'next/server'
import { sincronizarTodo } from '@/lib/tareas-clientes/notion/sync'
import { conPermiso, cuerpoDe } from '@/lib/tareas-clientes/rutas'
import { ErrorDeTareas } from '@/lib/tareas-clientes/servidor'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

/** Sincronizar ya, a mano: `{ completa?: true, clienteId?: '...' }`. Solo administradores */
export async function POST(request: NextRequest) {
  const c = await cuerpoDe(request)
  return conPermiso(async (p) => {
    if (!p.esAdmin) throw new ErrorDeTareas('Solo un administrador puede sincronizar con Notion.', 403)
    return sincronizarTodo({ completa: c.completa === true, clienteId: typeof c.clienteId === 'string' ? c.clienteId : undefined, presupuestoMs: 100_000 })
  })
}
