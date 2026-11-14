import type { NextRequest } from 'next/server'
import { ajustesDeCasos, borrarCaso, cambiarCaso, correoDeCaso, crearCaso, guardarAjustesDeCasos, listarCasos, resumenDeCasos } from '@/lib/tareas-clientes/casos-servidor'
import { actorDe, conPermiso, cuerpoDe } from '@/lib/tareas-clientes/rutas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * LOS CASOS DE CUMPLIMIENTO NORMATIVO DE CADA CLIENTE (Tareas de clientes → «Cumplimiento»).
 *
 *   GET ?clienteId=…              los casos del cliente, con sus correos (sin cuerpo)
 *   GET ?resumen=1                cuántos sin resolver tiene cada cliente (tarjetas del inicio)
 *   GET ?caso=…&correo=…          un correo entero, para la vista previa
 *   GET ?ajustes=1                qué buzones se vigilan y si existe el canal
 *   POST { clienteId, casoAmazon, titulo, estado?, responsable?, notas? }   dar de alta (el ID del caso de Amazon es obligatorio)
 *   PATCH { id, …cambios }  ·  DELETE { id }  ·  PUT { buzones: [id] } (solo administradores)
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams
  return conPermiso(async (p) => {
    if (q.get('resumen') === '1') return { porCliente: await resumenDeCasos(actorDe(p)) }
    if (q.get('ajustes') === '1') return ajustesDeCasos()
    if (q.get('correo')) return correoDeCaso(actorDe(p), q.get('caso'), q.get('correo'))
    return listarCasos(actorDe(p), q.get('clienteId'))
  })
}

export async function POST(request: NextRequest) {
  const c = await cuerpoDe(request)
  return conPermiso((p) => crearCaso(actorDe(p), c), 201)
}

export async function PATCH(request: NextRequest) {
  const c = await cuerpoDe(request)
  return conPermiso((p) => cambiarCaso(actorDe(p), c.id, c))
}

export async function DELETE(request: NextRequest) {
  const c = await cuerpoDe(request)
  return conPermiso((p) => borrarCaso(actorDe(p), c.id))
}

export async function PUT(request: NextRequest) {
  const c = await cuerpoDe(request)
  return conPermiso((p) => guardarAjustesDeCasos(p.esAdmin, c.buzones))
}
