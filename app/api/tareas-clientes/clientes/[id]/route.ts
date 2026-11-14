import type { NextRequest } from 'next/server'
import { actualizarCliente, cargarCliente } from '@/lib/tareas-clientes/servidor'
import { conPermiso, cuerpoDe } from '@/lib/tareas-clientes/rutas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Un cliente con sus tareas (sin el cuerpo de cada una) */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  return conPermiso((p) => cargarCliente(params.id, p.userId, p.clientes))
}

/** Su nombre, icono, color, descripción, portada y fondo */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const cambios = await cuerpoDe(request)
  return conPermiso(async (p) => ({ cliente: await actualizarCliente({ userId: p.userId, nombre: p.nombre, esAdmin: p.esAdmin, clientes: p.clientes }, params.id, cambios) }))
}
