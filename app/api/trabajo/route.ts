import type { NextRequest } from 'next/server'
import { ErrorDeTareas } from '@/lib/tareas-clientes/servidor'
import { actorDe, conPermiso, cuerpoDe } from '@/lib/tareas-clientes/rutas'
import { crearTareaDesde, MODULOS, tareasEnlazadas, type ModuloDeTrabajo } from '@/lib/trabajo/servidor'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * EL TRABAJO DE LOS MÓDULOS COMO TAREAS (lib/trabajo/servidor.ts). Con el permiso de Tareas de clientes.
 *   POST { accion: 'leer', cliente, modulo, refs[] }  → las tareas ya enlazadas a esos elementos y quién puede llevarlas
 *   POST { accion: 'crear', cliente, modulo, ref, titulo, enlace, responsables?, fechaFin?, nota? } → crea (o devuelve) la tarea del elemento
 */
export async function POST(request: NextRequest) {
  const c = await cuerpoDe(request)
  return conPermiso(async (p) => {
    const cliente = typeof c.cliente === 'string' ? c.cliente : ''
    const modulo = (MODULOS as readonly string[]).includes(String(c.modulo)) ? (c.modulo as ModuloDeTrabajo) : null
    if (!cliente || !modulo) throw new ErrorDeTareas('Faltan el cliente o el módulo.')
    if (c.accion === 'leer') {
      const refs = Array.isArray(c.refs) ? c.refs.filter((r): r is string => typeof r === 'string').slice(0, 2000) : []
      const r = await tareasEnlazadas(cliente, modulo, refs)
      return { tcClienteId: r.tcClienteId, tareas: r.tareas, personas: r.personas.map((x) => ({ id: x.id, nombre: x.nombre })) }
    }
    if (c.accion === 'crear') {
      if (typeof c.ref !== 'string' || !c.ref || typeof c.titulo !== 'string' || !c.titulo.trim() || typeof c.enlace !== 'string') throw new ErrorDeTareas('Faltan datos de la tarea.')
      const base = request.headers.get('origin') ?? `https://${request.headers.get('host') ?? 'app.libertyseller.com'}`
      try {
        const tarea = await crearTareaDesde(
          actorDe(p),
          {
            amazonClientId: cliente,
            modulo,
            ref: c.ref,
            titulo: c.titulo,
            enlace: c.enlace,
            responsables: Array.isArray(c.responsables) ? c.responsables.filter((x): x is string => typeof x === 'string') : [],
            fechaFin: typeof c.fechaFin === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c.fechaFin) ? c.fechaFin : null,
            nota: typeof c.nota === 'string' ? c.nota.slice(0, 4000) : null,
          },
          base,
        )
        return { tarea }
      } catch (e) {
        if (e instanceof ErrorDeTareas) throw e
        throw new ErrorDeTareas(e instanceof Error ? e.message : String(e))
      }
    }
    throw new ErrorDeTareas('Acción desconocida.')
  })
}
