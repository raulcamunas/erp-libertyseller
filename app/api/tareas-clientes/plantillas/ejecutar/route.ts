import { conPermiso } from '@/lib/tareas-clientes/rutas'
import { ejecutarRecurrencias } from '@/lib/tareas-clientes/plantillas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Crea las tareas de las plantillas que ya tocan. Lo pide cada sesión abierta (al abrir y cada media hora); es seguro pedirlo a la vez desde varias */
export async function POST() {
  return conPermiso(async () => ejecutarRecurrencias())
}
