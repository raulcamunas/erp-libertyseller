import type { NextRequest } from 'next/server'
import { buscarTareas } from '@/lib/tareas-clientes/busqueda-servidor'
import { conPermiso } from '@/lib/tareas-clientes/rutas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Busca en el cuerpo y en los comentarios de las tareas: `?q=texto` y, si se quiere, `&clienteId=...`. Solo en los clientes que ve quien busca */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q')
  const clienteId = request.nextUrl.searchParams.get('clienteId')
  return conPermiso(async (p) => ({ resultados: await buscarTareas(q, p.clientes, clienteId) }))
}
