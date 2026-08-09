import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { DIAS_POR_OMISION, MAX_DIAS, vistaBsr } from '@/lib/plataforma/bsr-vista'
import { FALTAN_MIGRACIONES, faltaEsquema } from '@/lib/plataforma/pantallas'
import type { TipoRankBsr } from '@/lib/plataforma/tipos'

/**
 * LOS RANKINGS DE UN CLIENTE, DE CONJUNTO.
 *
 * Solo admin. La ficha de SKU ya da la serie de UNA referencia; esto da la vista
 * de todas: qué se mueve, qué lleva semanas cayendo, y de qué NO tenemos ranking
 * y por qué.
 *
 * UN CLIENTE POR PETICIÓN, SIEMPRE. `clientId` es obligatorio y la conexión se
 * comprueba contra él antes de leer nada. No hay ningún modo «todos»: el
 * compromiso firmado ante Amazon prohíbe agregar o comparar datos entre
 * clientes, y una tabla de rankings de dieciséis cuentas juntas sería exactamente
 * eso. Si algún día alguien lo pide, hay que pararse y decirlo.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const q = request.nextUrl.searchParams

    const clientId = q.get('clientId') ?? ''
    if (!UUID.test(clientId)) return fail(400, 'Ese cliente no es válido')

    const connectionId = q.get('connectionId') ?? ''
    if (!UUID.test(connectionId)) return fail(400, 'Esa cuenta no es válida')

    const marketplaceId = (q.get('marketplaceId') ?? '').trim()
    if (marketplaceId === '') return fail(400, 'Falta el país')

    const diasCrudo = Number(q.get('dias') ?? String(DIAS_POR_OMISION))
    const dias = Number.isFinite(diasCrudo)
      ? Math.min(MAX_DIAS, Math.max(1, Math.round(diasCrudo)))
      : DIAS_POR_OMISION

    const tipo: TipoRankBsr = q.get('tipo') === 'categoria' ? 'categoria' : 'grupo'

    const vista = await vistaBsr({ clientId, connectionId, marketplaceId, dias, tipo })
    if (!vista) return fail(404, 'Esa cuenta no es de este cliente')

    return NextResponse.json(vista)
  } catch (error) {
    if (faltaEsquema(error)) return fail(503, FALTAN_MIGRACIONES)
    return errorResponse(error, 'Error leyendo los rankings')
  }
}
