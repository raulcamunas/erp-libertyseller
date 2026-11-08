import type { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { limpiarAcceso } from '@/lib/tareas-clientes/permisos'
import { conPermiso, cuerpoDe } from '@/lib/tareas-clientes/rutas'
import { ErrorDeTareas, esUuid, personasConAcceso } from '@/lib/tareas-clientes/servidor'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * QUIÉN VE QUÉ CLIENTE (migración 277). Solo administradores. `GET` da las personas con acceso a Tareas de clientes (con los clientes que ven; `null` = todos) y los
 * clientes; `PUT { usuarioId, clientes: [...] | null }` limita a esa persona a esos clientes (`null` o vacío = todos). Los administradores ven siempre todos y no se tocan.
 */
export async function GET() {
  return conPermiso(async (p) => {
    if (!p.esAdmin) throw new ErrorDeTareas('Solo un administrador decide quién ve qué cliente.', 403)
    const service = createServiceClient()
    const [personas, clientes, admins] = await Promise.all([
      personasConAcceso(),
      service.from('tc_clientes').select('id, nombre, icono, color, grupo, orden').eq('activo', true).order('grupo').order('orden').order('nombre'),
      service.from('profiles').select('id').eq('role', 'admin'),
    ])
    return { personas, clientes: clientes.data ?? [], administradores: ((admins.data ?? []) as Array<{ id: string }>).map((a) => a.id) }
  })
}

export async function PUT(request: NextRequest) {
  const c = await cuerpoDe(request)
  return conPermiso(async (p) => {
    if (!p.esAdmin) throw new ErrorDeTareas('Solo un administrador decide quién ve qué cliente.', 403)
    if (!esUuid(c.usuarioId)) throw new ErrorDeTareas('Falta la persona.')
    const service = createServiceClient()
    const [personas, clientes] = await Promise.all([personasConAcceso(), service.from('tc_clientes').select('id')])
    const persona = personas.find((x) => x.id === c.usuarioId)
    if (!persona) throw new ErrorDeTareas('Esa persona no tiene acceso a Tareas de clientes (se le da en Gestión de usuarios).', 404)
    const { data: admin } = await service.from('profiles').select('role').eq('id', c.usuarioId).maybeSingle()
    if (admin?.role === 'admin') throw new ErrorDeTareas('Un administrador ve siempre todos los clientes.')
    const existentes = new Set(((clientes.data ?? []) as Array<{ id: string }>).map((x) => x.id))
    const lista = limpiarAcceso(c.clientes, existentes)

    const borrar = await service.from('tc_acceso_clientes').delete().eq('usuario_id', c.usuarioId)
    if (borrar.error) throw new ErrorDeTareas(`No se ha podido guardar: ${borrar.error.message}. ¿Está lanzada la migración 277?`, 500)
    if (lista) {
      const poner = await service.from('tc_acceso_clientes').insert(lista.map((cliente_id) => ({ usuario_id: c.usuarioId, cliente_id })))
      if (poner.error) throw new ErrorDeTareas(`No se ha podido guardar: ${poner.error.message}`, 500)
    }
    return { usuarioId: c.usuarioId, clientes: lista }
  })
}
