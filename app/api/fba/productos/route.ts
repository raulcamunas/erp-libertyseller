import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { syncConnectionCatalog } from '@/lib/amazon/data'
import { requireFbaAccess } from '@/lib/fba/acceso'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * LOS PRODUCTOS DE FBA DE UN CLIENTE, PARA ELEGIRLOS.
 *
 * GET  · busca en el espejo del catálogo. Rápido, no toca Amazon.
 * POST · relee el catálogo de ese cliente contra Amazon. Es el botón de
 *        refrescar, para cuando se acaba de crear un producto a mano en Seller
 *        Central y todavía no ha entrado por el ciclo de quince minutos.
 *
 *
 * ============ SOLO LOS DE FBA ============
 *
 * `is_fba` filtra lo que está en la red logística de Amazon. Un producto que
 * gestiona el vendedor no se manda a un almacén de Amazon, así que ofrecerlo
 * aquí solo sirve para que alguien lo elija por error y el envío nazca mal.
 *
 * ShoesF tiene 42.737 referencias y 1.756 de FBA: la diferencia entre filtrar y
 * no filtrar es la diferencia entre un selector usable y una lista imposible.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const POR_PAGINA = 60

export async function GET(request: NextRequest) {
  try {
    const clienteId = request.nextUrl.searchParams.get('cliente') ?? ''
    if (!UUID.test(clienteId)) return fail(400, 'Hay que decir de qué cliente')

    const sesion = await requireFbaAccess('ver', clienteId)
    if (sesion instanceof NextResponse) return sesion

    const service = createServiceClient()
    const { data: conexion } = await service
      .from('amazon_connections')
      .select('id, default_marketplace_id, marketplace_ids')
      .eq('client_id', clienteId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()

    if (!conexion) {
      // Sin conexión no hay catálogo que ofrecer, y no es un error: hay clientes
      // que llevan sus remesas sin haber autorizado la API.
      return NextResponse.json({ productos: [], conectado: false, total: 0 })
    }

    const c = conexion as { id: string; default_marketplace_id: string | null; marketplace_ids: string[] }
    const marketplaceId = c.default_marketplace_id ?? c.marketplace_ids?.[0] ?? ''

    const busqueda = (request.nextUrl.searchParams.get('q') ?? '').trim()

    let consulta = service
      .from('amazon_listings')
      .select('sku, title, asin, fnsku, fba_quantity, fba_fulfillable_quantity', { count: 'exact' })
      .eq('connection_id', c.id)
      .eq('marketplace_id', marketplaceId)
      .eq('is_fba', true)

    if (busqueda) {
      // Por SKU o por título. El % va escapado para que un usuario que escriba
      // un porcentaje no se lleve por delante el filtro.
      const limpia = busqueda.replace(/[%_]/g, '\\$&')
      consulta = consulta.or(`sku.ilike.%${limpia}%,title.ilike.%${limpia}%,asin.ilike.%${limpia}%`)
    }

    const { data, error, count } = await consulta
      .order('title', { ascending: true, nullsFirst: false })
      .order('sku', { ascending: true })
      .limit(POR_PAGINA)
    if (error) throw error

    return NextResponse.json({
      conectado: true,
      total: count ?? 0,
      // Se dice si hay más de los que caben, para que la pantalla invite a
      // afinar la búsqueda en vez de dejar creer que eso es todo.
      hayMas: (count ?? 0) > POR_PAGINA,
      productos: ((data ?? []) as Array<Record<string, unknown>>).map((l) => ({
        sku: l.sku as string,
        titulo: (l.title as string | null) ?? null,
        asin: (l.asin as string | null) ?? null,
        fnsku: (l.fnsku as string | null) ?? null,
        stock: (l.fba_quantity as number | null) ?? null,
        vendible: (l.fba_fulfillable_quantity as number | null) ?? null,
      })),
    })
  } catch (error) {
    return errorResponse(error, 'No se han podido leer los productos')
  }
}

/**
 * RELEER EL CATÁLOGO CONTRA AMAZON.
 *
 * Solo admin: gasta cupo de la API del cliente, y un botón que cualquiera pueda
 * aporrear es un botón que alguien aporrea.
 */
export async function POST(request: NextRequest) {
  try {
    const clienteId = request.nextUrl.searchParams.get('cliente') ?? ''
    if (!UUID.test(clienteId)) return fail(400, 'Hay que decir de qué cliente')

    const sesion = await requireFbaAccess('ver', clienteId)
    if (sesion instanceof NextResponse) return sesion
    if (!sesion.esAdmin) {
      return fail(403, 'Refrescar el catálogo contra Amazon solo lo puede hacer Liberty Seller')
    }

    const service = createServiceClient()
    const { data: conexion } = await service
      .from('amazon_connections')
      .select('id, name')
      .eq('client_id', clienteId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()
    if (!conexion) return fail(400, 'Este cliente no tiene la API de Amazon conectada')

    const c = conexion as { id: string; name: string }

    // Sin `updatedAfter`: se relee ENTERO. El ciclo de quince minutos ya trae
    // lo que ha cambiado; este botón existe justo para cuando eso no basta,
    // porque el producto se acaba de crear y hay que encontrarlo ahora.
    const resultados = await syncConnectionCatalog(c.id, { updatedAfter: null })

    const leidas = resultados.reduce((s, r) => s + (r.items ?? 0), 0)
    const declaradas = resultados.reduce((s, r) => s + (r.declared ?? 0), 0)
    const fallos = resultados.filter((r) => r.error)

    /**
     * UNA PASADA NO LEE EL CATÁLOGO ENTERO, Y HAY QUE DECIRLO.
     *
     * La API de Amazon no pagina más allá de 1.000 referencias por mercado. Con
     * ShoesF —42.737 referencias— una pasada ve el 2 %: si el producto recién
     * creado no cae en ese tramo, el botón parece no haber hecho nada.
     *
     * Así que se devuelve `truncado` con los dos números. Callarlo sería dejar
     * a alguien pulsando un botón que no puede darle lo que busca, sin saber
     * por qué.
     */
    const truncado = resultados.some((r) => r.truncated)

    return NextResponse.json({
      ok: fallos.length === 0,
      cuenta: c.name,
      referencias: leidas,
      declaradas,
      truncado,
      mercados: resultados.length,
      errores: fallos.map((f) => f.error),
    })
  } catch (error) {
    return errorResponse(error, 'No se ha podido refrescar el catálogo')
  }
}
