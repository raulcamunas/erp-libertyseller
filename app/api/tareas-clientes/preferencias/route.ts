import type { NextRequest } from 'next/server'
import { guardarPreferencias } from '@/lib/tareas-clientes/servidor'
import { conPermiso, cuerpoDe } from '@/lib/tareas-clientes/rutas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Tu fondo, tu portada de inicio y tus clientes favoritos: son tuyos y de nadie más */
export async function PUT(request: NextRequest) {
  const cambios = await cuerpoDe(request)
  return conPermiso(async (p) => {
    await guardarPreferencias(p.userId, cambios)
    return { ok: true }
  })
}
