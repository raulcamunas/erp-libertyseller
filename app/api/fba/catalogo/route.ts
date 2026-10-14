import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { puedeEditar, requireFbaAccess } from '@/lib/fba/acceso'
import { borrarFilas, corregirFilas, crearFilas, listarCatalogo, validarDatos } from '@/lib/fba/catalogo/servidor'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * LA BASE DE DATOS DE REFERENCIAS DE UN CLIENTE (ShoesF).
 *
 * REF, nombre y color, talla, EAN, FNSKU, ASIN y FBASKU de cada talla que se puede
 * mandar a Amazon: lo que antes era la hoja de cálculo, con la que las propuestas
 * montan sus líneas eligiendo en desplegables.
 *
 *   GET     leer todas las filas del cliente            nivel «ver»
 *   POST    dar de alta una o varias tallas             nivel «editar»
 *   PATCH   corregir una o varias filas (mismos cambios) «editar»
 *   DELETE  quitar filas                                SOLO admin
 *
 * Quitar es de la agencia por la misma razón que borrar una remesa: de estos datos
 * salen las etiquetas y los manifiestos, y una fila que desaparece sin que lo sepa
 * quien la usa se nota cuando ya está impresa.
 */
export const dynamic = 'force-dynamic'

const MAX_FILAS_POR_ALTA = 500
const MAX_IDS = 400

export async function GET(request: NextRequest) {
  try {
    const clienteId = request.nextUrl.searchParams.get('cliente') ?? ''
    if (!UUID.test(clienteId)) return fail(400, 'Hay que decir de qué cliente')

    const sesion = await requireFbaAccess('ver', clienteId)
    if (sesion instanceof NextResponse) return sesion

    const { filas, sinMigrar } = await listarCatalogo(createServiceClient(), clienteId)
    return NextResponse.json({
      filas,
      sinMigrar,
      // La pantalla lo usa para enseñar o esconder los botones; el permiso de verdad
      // se vuelve a comprobar en cada escritura.
      puedeEditar: puedeEditar(sesion, clienteId),
      puedeBorrar: sesion.esAdmin,
    })
  } catch (error) {
    return errorResponse(error, 'No se ha podido leer la base de datos de referencias')
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as { clienteId?: unknown; filas?: unknown } | null
    const clienteId = typeof body?.clienteId === 'string' ? body.clienteId : ''
    if (!UUID.test(clienteId)) return fail(400, 'Hay que decir de qué cliente')

    const sesion = await requireFbaAccess('editar', clienteId)
    if (sesion instanceof NextResponse) return sesion

    if (!Array.isArray(body?.filas) || body.filas.length === 0) return fail(400, 'No hay ninguna referencia que añadir')
    if (body.filas.length > MAX_FILAS_POR_ALTA) return fail(400, `Son demasiadas de golpe (máximo ${MAX_FILAS_POR_ALTA}). Para cargas grandes usa Importar.`)

    const limpias = []
    for (const [i, bruta] of body.filas.entries()) {
      const v = validarDatos(bruta, true)
      if ('error' in v) return fail(400, `Fila ${i + 1}: ${v.error}`)
      limpias.push(v.datos)
    }

    const r = await crearFilas(createServiceClient(), clienteId, sesion.userId, limpias)
    if (!r.ok) return fail(r.estado, r.error)
    return NextResponse.json({ ok: true, ...r.valor })
  } catch (error) {
    return errorResponse(error, 'No se han podido añadir las referencias')
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as { clienteId?: unknown; ids?: unknown; campos?: unknown } | null
    const clienteId = typeof body?.clienteId === 'string' ? body.clienteId : ''
    if (!UUID.test(clienteId)) return fail(400, 'Hay que decir de qué cliente')

    const sesion = await requireFbaAccess('editar', clienteId)
    if (sesion instanceof NextResponse) return sesion

    const ids = Array.isArray(body?.ids) ? body.ids : []
    if (ids.length === 0 || ids.length > MAX_IDS || !ids.every((x): x is string => typeof x === 'string' && UUID.test(x))) {
      return fail(400, 'Faltan las referencias que se quieren cambiar')
    }

    const v = validarDatos(body?.campos, false)
    if ('error' in v) return fail(400, v.error)

    const r = await corregirFilas(createServiceClient(), clienteId, Array.from(new Set(ids)), v.datos)
    if (!r.ok) return fail(r.estado, r.error)
    return NextResponse.json({ ok: true, ...r.valor })
  } catch (error) {
    return errorResponse(error, 'No se han podido guardar los cambios')
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const clienteId = request.nextUrl.searchParams.get('cliente') ?? ''
    if (!UUID.test(clienteId)) return fail(400, 'Hay que decir de qué cliente')

    const sesion = await requireFbaAccess('editar', clienteId)
    if (sesion instanceof NextResponse) return sesion
    if (!sesion.esAdmin) return fail(403, 'Quitar referencias de la base de datos solo lo puede hacer un administrador de la agencia')

    const ids = (request.nextUrl.searchParams.get('ids') ?? '').split(',').filter(Boolean)
    if (ids.length === 0 || ids.length > MAX_IDS || !ids.every((x) => UUID.test(x))) {
      return fail(400, 'Faltan las referencias que se quieren quitar')
    }

    const r = await borrarFilas(createServiceClient(), clienteId, Array.from(new Set(ids)))
    if (!r.ok) return fail(r.estado, r.error)
    return NextResponse.json({ ok: true, ...r.valor })
  } catch (error) {
    return errorResponse(error, 'No se han podido quitar las referencias')
  }
}
