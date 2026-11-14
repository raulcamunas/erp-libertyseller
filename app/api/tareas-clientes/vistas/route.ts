import type { NextRequest } from 'next/server'
import { conPermiso, cuerpoDe } from '@/lib/tareas-clientes/rutas'
import { crearVista, listarVistas } from '@/lib/tareas-clientes/vistas-servidor'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Mis vistas guardadas y las que ha compartido el equipo */
export async function GET() {
  return conPermiso(async (p) => ({ vistas: await listarVistas(p.userId) }))
}

export async function POST(request: NextRequest) {
  const c = await cuerpoDe(request)
  return conPermiso(async (p) => ({ vista: await crearVista(p, c) }), 201)
}
