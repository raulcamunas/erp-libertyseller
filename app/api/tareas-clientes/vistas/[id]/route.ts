import type { NextRequest } from 'next/server'
import { conPermiso } from '@/lib/tareas-clientes/rutas'
import { borrarVista } from '@/lib/tareas-clientes/vistas-servidor'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  return conPermiso(async (p) => {
    await borrarVista(p, params.id)
    return { ok: true }
  })
}
