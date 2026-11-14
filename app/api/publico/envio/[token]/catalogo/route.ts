import { NextResponse, type NextRequest } from 'next/server'
import { entrarConEnlace, respuestaDeFalloInterno } from '@/lib/fba/encaje-http'
import { buscarEnCatalogo } from '@/lib/fba/portal'

/**
 * BUSCAR EN EL CATÁLOGO DEL CLIENTE PARA AÑADIR A LA PROPUESTA.
 *
 * Solo sus productos FBA de la conexión del envío (amazon_listings), 30 como mucho por búsqueda. Lee el
 * espejo del catálogo del ERP: no llama a Amazon.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 20

export async function GET(request: NextRequest, { params }: { params: { token: string } }) {
  try {
    const r = await entrarConEnlace(request, params.token, 'catalogo')
    if (r instanceof NextResponse) return r
    const q = request.nextUrl.searchParams.get('q') ?? ''
    return NextResponse.json(await buscarEnCatalogo(r, q), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return respuestaDeFalloInterno(error, 'Portal del cliente: no se ha podido buscar en el catálogo')
  }
}
