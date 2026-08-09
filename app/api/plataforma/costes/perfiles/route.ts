import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, readText, requireAmazonAdmin } from '@/lib/amazon/api'
import { FALTAN_MIGRACIONES, faltaEsquema } from '@/lib/plataforma/pantallas'
import {
  clientesDeStock,
  crearPerfil,
  importacionesDe,
  perfilNuevo,
  perfilesDeCliente,
  politicaDe,
} from '@/lib/plataforma/costes/datos'

/**
 * LOS PERFILES DE IMPORTACIÓN DE UN CLIENTE.
 *
 * Solo admin. El perfil es lo único que cambia de un cliente a otro: qué hoja,
 * qué columnas y de qué mapeo se toma la equivalencia referencia -> SKU. El
 * lector y el cruce son los mismos para todos, y son los de la sincronización de
 * stock.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const clientId = request.nextUrl.searchParams.get('clientId') ?? ''
    if (!UUID.test(clientId)) return fail(400, 'Elige el cliente')

    const [perfiles, politica, importaciones, stockClientes] = await Promise.all([
      perfilesDeCliente(clientId),
      politicaDe(clientId),
      importacionesDe(clientId),
      clientesDeStock(),
    ])

    return NextResponse.json({ perfiles, politica, importaciones, stockClientes })
  } catch (error) {
    if (faltaEsquema(error)) return fail(503, FALTAN_MIGRACIONES)
    return errorResponse(error, 'Error cargando los perfiles de costes')
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const clientId = typeof body.clientId === 'string' ? body.clientId : ''
    if (!UUID.test(clientId)) return fail(400, 'Falta el cliente')

    const nombre = readText(body.name, 120)
    if (!nombre) return fail(400, 'Ponle un nombre al perfil')

    // El slug se deriva del nombre y no se pide: un campo más que rellenar para
    // algo que nadie va a escribir a mano dos veces igual.
    const slug =
      readText(body.slug, 60) ??
      nombre
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60)

    if (!slug) return fail(400, 'El nombre del perfil tiene que tener alguna letra o número')

    const perfil = await crearPerfil(
      perfilNuevo({ clientId, nombre, slug, createdBy: session.userId })
    )
    return NextResponse.json({ perfil })
  } catch (error) {
    if (faltaEsquema(error)) return fail(503, FALTAN_MIGRACIONES)
    // El UNIQUE (client_id, slug) es el caso que más se va a dar: dos perfiles
    // con el mismo nombre. Se contesta con una frase, no con un 23505.
    if ((error as { code?: string } | null)?.code === '23505') {
      return fail(400, 'Ya hay un perfil con ese nombre para este cliente')
    }
    return errorResponse(error, 'Error creando el perfil de costes')
  }
}
