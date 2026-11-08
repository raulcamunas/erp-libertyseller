import type { NextRequest } from 'next/server'
import { guardarBriefing, leerMiDia } from '@/lib/tareas-clientes/mi-dia-servidor'
import { conPermiso, cuerpoDe } from '@/lib/tareas-clientes/rutas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Todo «Mi día»: el briefing del día (`?dia=`; con `?usuario=` el de otra persona, solo administradores), las anotaciones, comentarios, tareas nuevas, avisos y el equipo */
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams
  return conPermiso(async (permiso) => leerMiDia(permiso, p.get('dia'), p.get('usuario')))
}

/** Guarda el plan y/o la revisión de un día: `{ dia, plan?, revision? }`. Solo el briefing propio */
export async function PUT(request: NextRequest) {
  const c = await cuerpoDe(request)
  return conPermiso(async (permiso) => ({ briefing: await guardarBriefing(permiso, c.dia, c) }))
}
