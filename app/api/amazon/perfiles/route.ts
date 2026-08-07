import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, readText, requireAmazonAdmin } from '@/lib/amazon/api'
import { slugify } from '@/lib/amazon/data'
import { createServiceClient } from '@/lib/supabase/service'
import { crearPerfil, loadPerfiles, perfilNuevo } from '@/lib/stock-sync/perfiles'

/**
 * DA DE ALTA UN PERFIL DE LECTURA.
 *
 * Solo admin, como todo /api/amazon: desde un perfil se decide qué precio y qué
 * stock se publican en la tienda de un cliente.
 *
 * Devuelve la vista entera recargada, como el resto de escrituras del módulo,
 * para que la pantalla no tenga que encadenar una segunda petición y no se
 * quede pintando un estado que ya no es el de la base.
 */
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => ({}))) as {
      clientId?: unknown
      nombre?: unknown
      tipo?: unknown
    }

    const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : ''
    if (!UUID.test(clientId)) return fail(400, 'Elige el cliente al que pertenece el perfil')

    const nombre = readText(body.nombre, 120)
    if (!nombre) return fail(400, 'Ponle un nombre al perfil')

    const tipo = body.tipo === 'ean' ? 'ean' : 'stock'

    // El cliente tiene que existir de verdad: la FK lo diría igual, pero con un
    // error de Postgres que no le sirve a nadie.
    const service = createServiceClient()
    const { data: cliente, error: errorCliente } = await service
      .from('stock_clients')
      .select('id, name')
      .eq('id', clientId)
      .maybeSingle()
    if (errorCliente) throw errorCliente
    if (!cliente) return fail(404, 'Ese cliente no existe en la sincronización de stock')

    const perfil = await crearPerfil(
      perfilNuevo({
        clientId,
        nombre,
        // El slug lleva el tipo detrás porque un cliente tiene normalmente dos
        // perfiles —el de stock y el de EAN— y sin eso el segundo choca contra
        // el UNIQUE (client_id, slug) con un mensaje incomprensible.
        slug: `${slugify(nombre)}-${tipo}`,
        tipo,
      })
    )

    const data = await loadPerfiles()
    return NextResponse.json({ ...data, creado: perfil.id })
  } catch (error) {
    // El 23505 es el UNIQUE (client_id, slug): pasa al crear dos perfiles del
    // mismo tipo con el mismo nombre, y el texto de Postgres no se lo explica a
    // nadie.
    if ((error as { code?: string })?.code === '23505') {
      return fail(409, 'Ese cliente ya tiene un perfil con ese nombre y ese tipo. Ponle otro nombre')
    }
    return errorResponse(error, 'Error creando un perfil de lectura')
  }
}
