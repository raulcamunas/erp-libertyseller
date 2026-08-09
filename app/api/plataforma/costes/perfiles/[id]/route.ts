import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { FALTAN_MIGRACIONES, faltaEsquema } from '@/lib/plataforma/pantallas'
import {
  actualizarPerfil,
  borrarPerfil,
  filtrarCamposPerfil,
  perfilDe,
} from '@/lib/plataforma/costes/datos'

/**
 * EDITAR O BORRAR UN PERFIL DE COSTES.
 *
 * Solo admin. El cuerpo pasa por una LISTA BLANCA de columnas (filtrarCamposPerfil):
 * llega del navegador, y sin ella un `client_id` colado en el JSON movería el
 * perfil de un cliente a otro — que además de ser un error es exactamente la
 * clase de mezcla que prohíbe el compromiso firmado ante Amazon.
 */
export const dynamic = 'force-dynamic'

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session
    if (!UUID.test(params.id)) return fail(400, 'Identificador de perfil no válido')

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const patch = filtrarCamposPerfil(body)
    if (Object.keys(patch).length === 0) return fail(400, 'No hay nada que cambiar')

    // Las listas de alias llegan como texto separado por comas desde la pantalla
    // y se guardan como array: es lo que espera el lector.
    for (const clave of Object.keys(patch)) {
      if (clave.startsWith('col_')) patch[clave] = aLista(patch[clave])
    }

    const perfil = await actualizarPerfil(params.id, patch)
    if (!perfil) return fail(404, 'Ese perfil ya no existe')
    return NextResponse.json({ perfil })
  } catch (error) {
    if (faltaEsquema(error)) return fail(503, FALTAN_MIGRACIONES)
    if ((error as { code?: string } | null)?.code === '23505') {
      return fail(400, 'Ya hay un perfil con ese nombre para este cliente')
    }
    // Los CHECK de la 126 son mensajes útiles y hay que enseñarlos traducidos:
    // «te has quedado sin columna de coste» se arregla solo; «23514» no.
    if ((error as { code?: string } | null)?.code === '23514') {
      return fail(
        400,
        'El perfil no puede quedarse sin columna de coste, ni sin referencia ni SKU: sin eso no hay nada que importar ni a quién asignárselo'
      )
    }
    return errorResponse(error, 'Error guardando el perfil de costes')
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session
    if (!UUID.test(params.id)) return fail(400, 'Identificador de perfil no válido')

    // Se lee antes para poder decir QUÉ se ha borrado. Borrar un perfil no
    // borra ni un coste: las importaciones que hizo se quedan en el historial
    // con su nombre congelado.
    const perfil = await perfilDe(params.id)
    const borrado = await borrarPerfil(params.id)
    if (!borrado) return fail(404, 'Ese perfil ya no existe')

    return NextResponse.json({ borrado: true, nombre: perfil?.name ?? null })
  } catch (error) {
    if (faltaEsquema(error)) return fail(503, FALTAN_MIGRACIONES)
    return errorResponse(error, 'Error borrando el perfil de costes')
  }
}

/** «Coste, Coste de compra» -> ['Coste', 'Coste de compra'] */
function aLista(valor: unknown): string[] {
  if (Array.isArray(valor)) {
    return valor.map((v) => String(v).trim()).filter(Boolean)
  }
  if (typeof valor !== 'string') return []
  return valor
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
}
