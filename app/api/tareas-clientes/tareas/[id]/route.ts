import type { NextRequest } from 'next/server'
import { notionConfigurado } from '@/lib/tareas-clientes/notion/cliente'
import { traerComentarios, traerContenido } from '@/lib/tareas-clientes/notion/sync'
import { actualizarTarea, cargarTarea } from '@/lib/tareas-clientes/servidor'
import { actorDe, conPermiso, cuerpoDe } from '@/lib/tareas-clientes/rutas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Una tarea entera: su cuerpo, sus comentarios y su historial. Al abrirla se mira en Notion si ha cambiado su cuerpo o ha llegado un comentario, para que lo que se ve
 * sea lo de ahora y no lo de la última pasada. Si Notion no contesta se enseña lo que hay aquí, sin error.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const fresca = request.nextUrl.searchParams.get('fresca') !== '0'
  return conPermiso(async () => {
    let datos = await cargarTarea(params.id)
    if (fresca && notionConfigurado() && datos.tarea.notion_page_id) {
      const antes = Date.parse(datos.tarea.notion_contenido_revisado ?? '') || 0
      if (Date.now() - antes > 20_000) {
        const [cuerpo, comentarios] = await Promise.all([traerContenido(params.id).catch(() => false), traerComentarios(params.id, new Map()).catch(() => 0)])
        if (cuerpo || comentarios > 0) datos = await cargarTarea(params.id)
      }
    }
    return datos
  })
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const cambios = await cuerpoDe(request)
  return conPermiso(async (p) => ({ tarea: await actualizarTarea(actorDe(p), params.id, cambios) }))
}

/** Borrar una tarea es archivarla: no se pierde nada y se puede recuperar */
export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  return conPermiso(async (p) => ({ tarea: await actualizarTarea(actorDe(p), params.id, { archivada: true }) }))
}
