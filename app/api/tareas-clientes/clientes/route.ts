import type { NextRequest } from 'next/server'
import { crearCliente } from '@/lib/tareas-clientes/servidor'
import { conPermiso, cuerpoDe } from '@/lib/tareas-clientes/rutas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Crea un cliente solo en el ERP (sin Notion). Solo administradores */
export async function POST(request: NextRequest) {
  const c = await cuerpoDe(request)
  return conPermiso(async (p) => ({ cliente: await crearCliente({ userId: p.userId, nombre: p.nombre, esAdmin: p.esAdmin, clientes: p.clientes }, c) }), 201)
}
