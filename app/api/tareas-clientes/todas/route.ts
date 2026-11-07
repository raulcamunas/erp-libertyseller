import { cargarTodas } from '@/lib/tareas-clientes/servidor'
import { conPermiso } from '@/lib/tareas-clientes/rutas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Las tareas de todos los clientes, para «Todas las tareas» y «Mis tareas» */
export async function GET() {
  return conPermiso((p) => cargarTodas(p.userId))
}
