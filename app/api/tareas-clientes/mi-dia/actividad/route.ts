import type { NextRequest } from 'next/server'
import { actividadDelDia } from '@/lib/tareas-clientes/mi-dia-servidor'
import { conPermiso } from '@/lib/tareas-clientes/rutas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Lo que hizo esta persona ese día (`?dia=`): tareas cerradas y comentarios. Para el borrador de la revisión */
export async function GET(request: NextRequest) {
  return conPermiso(async (permiso) => actividadDelDia(permiso.userId, request.nextUrl.searchParams.get('dia')))
}
