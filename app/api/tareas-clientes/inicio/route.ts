import { cargarInicio } from '@/lib/tareas-clientes/servidor'
import { conPermiso } from '@/lib/tareas-clientes/rutas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** La pantalla de inicio: los clientes con sus cifras, las personas y las preferencias de quien mira */
export async function GET() {
  return conPermiso((p) => cargarInicio(p.userId))
}
