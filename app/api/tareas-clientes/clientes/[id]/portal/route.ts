import type { NextRequest } from 'next/server'
import { cambiarEnlace, estadoDelEnlace } from '@/lib/tareas-clientes/portal-servidor'
import { conPermiso, cuerpoDe } from '@/lib/tareas-clientes/rutas'
import { ErrorDeTareas, esUuid } from '@/lib/tareas-clientes/servidor'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** El estado del enlace del panel del cliente (para quien ve ese cliente). Cambiarlo es cosa de los administradores */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  return conPermiso(async (p) => {
    if (!esUuid(params.id)) throw new ErrorDeTareas('Ese cliente no existe.', 404)
    return estadoDelEnlace(params.id, p.clientes)
  })
}

/** `{ activo?: boolean, regenerar?: boolean }`: activa, desactiva o cambia el enlace */
export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const c = await cuerpoDe(request)
  return conPermiso(async (p) => {
    if (!p.esAdmin) throw new ErrorDeTareas('Solo un administrador puede compartir el panel con un cliente.', 403)
    if (!esUuid(params.id)) throw new ErrorDeTareas('Ese cliente no existe.', 404)
    return cambiarEnlace(params.id, p.userId, { ...(typeof c.activo === 'boolean' ? { activo: c.activo } : {}), ...(c.regenerar === true ? { regenerar: true } : {}) })
  })
}
