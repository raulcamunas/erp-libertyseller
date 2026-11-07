import type { NextRequest } from 'next/server'
import { crearComentario } from '@/lib/tareas-clientes/servidor'
import { actorDe, conPermiso, cuerpoDe } from '@/lib/tareas-clientes/rutas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const { cuerpo } = await cuerpoDe(request)
  return conPermiso(async (p) => ({ comentario: await crearComentario(actorDe(p), params.id, cuerpo) }), 201)
}
