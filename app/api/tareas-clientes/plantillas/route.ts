import type { NextRequest } from 'next/server'
import { actorDe, conPermiso, cuerpoDe } from '@/lib/tareas-clientes/rutas'
import { guardarPlantilla, listarPlantillas } from '@/lib/tareas-clientes/plantillas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Las plantillas de un cliente y las generales (`?clienteId=`); sin cliente, todas */
export async function GET(request: NextRequest) {
  const clienteId = request.nextUrl.searchParams.get('clienteId')
  return conPermiso(async () => ({ plantillas: await listarPlantillas(clienteId) }))
}

export async function POST(request: NextRequest) {
  const c = await cuerpoDe(request)
  return conPermiso(async (p) => ({ plantilla: await guardarPlantilla(actorDe(p), null, c) }), 201)
}
