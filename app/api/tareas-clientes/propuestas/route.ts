import type { NextRequest } from 'next/server'
import { contarPropuestas, decidirPropuestas, pasadaDeReuniones } from '@/lib/tareas-clientes/reuniones-servidor'
import { actorDe, conPermiso, cuerpoDe } from '@/lib/tareas-clientes/rutas'
import { ErrorDeTareas } from '@/lib/tareas-clientes/servidor'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

/** Cuántas tareas propuestas esperan en cada cliente: `{ porCliente: { <id>: n } }` */
export async function GET() {
  return conPermiso(async (p) => ({ porCliente: await contarPropuestas(p.clientes) }))
}

/**
 * Decide propuestas de un cliente: `{ clienteId, aceptar: [{ id, titulo?, columna?, departamento?, responsables?, fecha_inicio?, subtareas?, contexto? }], descartar: [id] }`.
 * Con `{ buscar: true }` lanza ahora una búsqueda de reuniones nuevas.
 */
export async function POST(request: NextRequest) {
  const c = await cuerpoDe(request)
  return conPermiso(async (p) => {
    if (c.buscar === true) return { resultado: await pasadaDeReuniones({ forzar: true }) }
    if (typeof c.clienteId !== 'string') throw new ErrorDeTareas('Falta el cliente.')
    const aceptar = Array.isArray(c.aceptar) ? (c.aceptar as Array<Record<string, unknown>>).filter((x) => x && typeof x.id === 'string').map((x) => ({ ...x, id: x.id as string })) : []
    const descartar = Array.isArray(c.descartar) ? c.descartar.filter((x): x is string => typeof x === 'string') : []
    if (aceptar.length > 50 || descartar.length > 200) throw new ErrorDeTareas('Demasiadas a la vez.')
    return decidirPropuestas(actorDe(p), c.clienteId, aceptar, descartar)
  })
}
