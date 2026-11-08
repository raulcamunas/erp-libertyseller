import type { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { actorDe, conPermiso, cuerpoDe } from '@/lib/tareas-clientes/rutas'
import { usarPlantilla } from '@/lib/tareas-clientes/plantillas'
import { ErrorDeTareas, esUuid } from '@/lib/tareas-clientes/servidor'
import type { PlantillaTC } from '@/lib/tareas-clientes/tipos'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Una tarea nueva con lo de la plantilla: `{ clienteId }` */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const c = await cuerpoDe(request)
  return conPermiso(async (p) => {
    if (!esUuid(params.id) || !esUuid(c.clienteId)) throw new ErrorDeTareas('Falta la plantilla o el cliente.')
    const { data } = await createServiceClient().from('tc_plantillas').select('*').eq('id', params.id).maybeSingle()
    if (!data) throw new ErrorDeTareas('Esa plantilla no existe.', 404)
    return { tarea: await usarPlantilla(actorDe(p), data as PlantillaTC, c.clienteId) }
  }, 201)
}
