import type { NextRequest } from 'next/server'
import { diasConApuntes } from '@/lib/tareas-clientes/mi-dia-servidor'
import { conPermiso } from '@/lib/tareas-clientes/rutas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** El calendario de «Mi día»: los días con plan o anotaciones entre `?desde=` y `?hasta=` (con `?usuario=`, los de otra persona; solo administradores) */
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams
  return conPermiso(async (permiso) => diasConApuntes(permiso, p.get('desde'), p.get('hasta'), p.get('usuario')))
}
