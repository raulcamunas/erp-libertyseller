import type { NextRequest } from 'next/server'
import { listarAdjuntos, subirAdjunto } from '@/lib/tareas-clientes/adjuntos-servidor'
import { actorDe, conPermiso } from '@/lib/tareas-clientes/rutas'
import { ErrorDeTareas } from '@/lib/tareas-clientes/servidor'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  return conPermiso(async (p) => listarAdjuntos(actorDe(p), params.id))
}

/** Sube un archivo (`fichero` en un formulario) */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const formulario = await request.formData().catch(() => null)
  return conPermiso(async (p) => {
    const fichero = formulario?.get('fichero')
    if (!(fichero instanceof File)) throw new ErrorDeTareas('Falta el archivo.')
    return subirAdjunto(actorDe(p), params.id, fichero)
  }, 201)
}
