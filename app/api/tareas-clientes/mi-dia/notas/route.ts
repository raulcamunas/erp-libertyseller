import type { NextRequest } from 'next/server'
import { guardarNotas } from '@/lib/tareas-clientes/mi-dia-servidor'
import { conPermiso, cuerpoDe } from '@/lib/tareas-clientes/rutas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Las anotaciones personales: `{ texto }` */
export async function PUT(request: NextRequest) {
  const c = await cuerpoDe(request)
  return conPermiso(async (permiso) => {
    await guardarNotas(permiso.userId, c.texto)
    return { ok: true }
  })
}
