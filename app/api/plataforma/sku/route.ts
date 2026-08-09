import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { cargarEventos } from '@/lib/plataforma/eventos'
import { FALTAN_MIGRACIONES, MAX_DIAS_FICHA, faltaEsquema, fichaSku } from '@/lib/plataforma/pantallas'

/**
 * LA FICHA DE UN SKU: LO QUE SABEMOS DE ÉL Y CÓMO HA IDO.
 *
 * Solo admin. Es la pantalla que la especificación describe así: «la que va a
 * usar el equipo cuando un cliente pregunte "¿qué pasa con este producto?"».
 *
 * Trae las dos series que A1 sabe llenar hoy —ranking de ventas e inventario— y
 * las incidencias abiertas de ese SKU. Precio, Buy Box y competidores son de A2
 * y todavía no existen: la tabla amazon_snapshots_precio está creada y vacía, y
 * la ficha lo dice en vez de dejar un hueco en blanco que parece un fallo.
 *
 * LA CUENTA SE COMPRUEBA CONTRA EL CLIENTE antes de leer nada. `connectionId`
 * viaja desde el navegador, y sin esa comprobación bastaría cambiarlo en la URL
 * para leer el catálogo de otro cliente desde la ficha de este.
 */
export const dynamic = 'force-dynamic'

/** Cuánto histórico se pinta por omisión. Tres meses son suficientes para ver
    una tendencia y no tantos que la serie se convierta en una mancha */
const DIAS_POR_OMISION = 90

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

    const sku = q.get('sku') ?? ''
    if (sku.trim() === '') return fail(400, 'Falta el SKU')

    const diasCrudo = Number(q.get('dias') ?? String(DIAS_POR_OMISION))
    const dias = Number.isFinite(diasCrudo)
      ? Math.min(MAX_DIAS_FICHA, Math.max(1, Math.round(diasCrudo)))
      : DIAS_POR_OMISION

    const ficha = await fichaSku({ clientId, connectionId, marketplaceId, sku, dias })
    if (!ficha) {
      return fail(404, 'Ese SKU no está en el espejo del catálogo de esta cuenta')
    }

    const eventos = await cargarEventos({ clientId, sku, soloAbiertos: true, limite: 20 })

    return NextResponse.json({ ...ficha, eventos, leidoAt: new Date().toISOString() })
  } catch (error) {
    if (faltaEsquema(error)) return fail(503, FALTAN_MIGRACIONES)
    return errorResponse(error, 'Error leyendo la ficha de un SKU')
  }
}
