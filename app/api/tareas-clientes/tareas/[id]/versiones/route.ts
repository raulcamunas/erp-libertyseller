import type { NextRequest } from 'next/server'
import { listarVersiones, leerVersion, restaurarVersion } from '@/lib/tareas-clientes/historial-lectura'
import { actorDe, conPermiso, cuerpoDe } from '@/lib/tareas-clientes/rutas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Las versiones guardadas del cuerpo de la tarea; con `?v=` una sola, con su contenido (para verla antes de restaurarla) */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const v = request.nextUrl.searchParams.get('v')
  return conPermiso(async (p) => (v ? { version: await leerVersion(actorDe(p), params.id, v) } : await listarVersiones(actorDe(p), params.id)))
}

/** Restaura una versión: `{ versionId }` */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const c = await cuerpoDe(request)
  return conPermiso(async (p) => ({ tarea: await restaurarVersion(actorDe(p), params.id, String(c.versionId ?? '')) }))
}
