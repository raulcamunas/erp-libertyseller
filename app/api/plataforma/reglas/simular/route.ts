import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import type { CriterioActivos } from '@/lib/plataforma/activos'
import { FALTAN_MIGRACIONES, faltaEsquema } from '@/lib/plataforma/pantallas'
import { simularRegla } from '@/lib/plataforma/simulacro-activos'
import type { OrdenTope } from '@/lib/plataforma/tipos'

/**
 * QUÉ PASARÍA SI GUARDARA ESTE CRITERIO.
 *
 * Solo admin, como todo /api/plataforma. Y aquí importa igual: en middleware.ts
 * todo lo que empieza por /api/ está en la lista de rutas públicas, así que una
 * ruta que no comprueba nada contesta a cualquiera.
 *
 *
 * ============ POR QUÉ ESTA RUTA EXISTE ============
 *
 * Porque sin ella el criterio de «SKU en seguimiento» se configura a ciegas.
 * Trece interruptores y tres listas sobre un catálogo de 13.700 referencias: de
 * cabeza no se sabe cuántas entran al encender «todo lo de FBM», ni cuántas se
 * caen al bajar el tope. Y equivocarse cuesta caro en los dos sentidos —revienta
 * el cupo de Amazon de esa cuenta, o deja referencias sin histórico, que no se
 * recupera hacia atrás—.
 *
 * Así que se calcula sobre el catálogo de verdad, se cuenta cuántas entran y
 * cuántas salen respecto a hoy, y se enseña ANTES de guardar.
 *
 *
 * ============ NO ESCRIBE NADA, Y ES LO IMPORTANTE ============
 *
 * Ni en amazon_listings, ni en amazon_tracking_rules, ni contra Amazon. Se lee,
 * se decide en memoria y se devuelve. Se puede pulsar las veces que haga falta.
 *
 * Es POST y no GET aunque no cambie nada: el criterio son quince campos, con tres
 * listas dentro que pueden llevar quinientas entradas cada una. Eso no cabe en
 * una barra de direcciones, y trocearlo en `query params` haría que un SKU con
 * una coma rompiera la petición sin dar ningún error.
 */
export const dynamic = 'force-dynamic'

const ORDENES: OrdenTope[] = ['ventas', 'bsr', 'precio', 'sku']

/** Tope de entradas en una lista de marcas o de SKU, igual que al guardar */
const MAX_LISTA = 500

export async function POST(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

    const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : ''
    if (!UUID.test(clientId)) return fail(400, 'Elige el cliente cuyo criterio quieres probar')

    const connectionId = typeof body.connectionId === 'string' ? body.connectionId.trim() : ''
    if (connectionId !== '' && !UUID.test(connectionId)) {
      return fail(400, 'Esa cuenta no es válida')
    }

    const marketplaceId =
      typeof body.marketplaceId === 'string' && body.marketplaceId.trim() !== ''
        ? body.marketplaceId.trim()
        : null

    const criterio: CriterioActivos = {
      incluir_fba: booleano(body.incluir_fba, true),
      incluir_fbm: booleano(body.incluir_fbm, false),
      incluir_marca_propia: booleano(body.incluir_marca_propia, true),
      min_unidades: enteroOpcional(body.min_unidades),
      ventana_dias: entero(body.ventana_dias, 30, 1, 365),
      solo_listados_activos: booleano(body.solo_listados_activos, true),
      excluir_sin_precio: booleano(body.excluir_sin_precio, true),
      excluir_variacion_padre: booleano(body.excluir_variacion_padre, true),
      marcas_excluidas: lista(body.marcas_excluidas),
      skus_excluidos: lista(body.skus_excluidos),
      skus_incluidos: lista(body.skus_incluidos),
      tope_skus: entero(body.tope_skus, 2000, 1, 200000),
      orden_tope: orden(body.orden_tope),
    }

    /**
     * UN CRITERIO QUE NO DEJA ENTRAR NADA NO SE RECHAZA AQUÍ, SE SIMULA.
     *
     * Al guardar sí se rechaza —lo hace PATCH /api/plataforma/reglas y también un
     * CHECK de la migración 123—, porque una regla así deja al cliente sin
     * refresco diario sin dar ningún error. Pero el sitio donde alguien tiene que
     * VER que su criterio no selecciona nada es justo este, antes de guardar, con
     * el «0 en seguimiento» delante. Un error de validación en el simulacro
     * escondería el resultado que se ha ido a buscar.
     */
    const simulacro = await simularRegla({
      clientId,
      criterio,
      marketplaceIds: lista(body.marketplace_ids),
      connectionId: connectionId === '' ? null : connectionId,
      marketplaceId,
    })

    return NextResponse.json(simulacro)
  } catch (error) {
    if (faltaEsquema(error)) return fail(503, FALTAN_MIGRACIONES)
    return errorResponse(error, 'Error simulando el criterio de SKU activos')
  }
}

/* ------------------------------------------------------------------ */
/* Lectura del cuerpo                                                  */
/* ------------------------------------------------------------------ */

function booleano(valor: unknown, porOmision: boolean): boolean {
  return typeof valor === 'boolean' ? valor : porOmision
}

function entero(valor: unknown, porOmision: number, min: number, max: number): number {
  const n = Number(valor)
  if (!Number.isFinite(n)) return porOmision
  return Math.min(max, Math.max(min, Math.round(n)))
}

/**
 * Un entero que puede no estar.
 *
 * null y 0 NO son lo mismo y confundirlos cambia el resultado: null apaga la vía
 * de la rotación, y 0 la deja encendida dejando entrar todo lo que tenga datos de
 * ventas. Mismo criterio que al guardar.
 */
function enteroOpcional(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === '') return null
  const n = Number(valor)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n)
}

function orden(valor: unknown): OrdenTope {
  const pedido = typeof valor === 'string' ? (valor as OrdenTope) : null
  return pedido && ORDENES.includes(pedido) ? pedido : 'ventas'
}

function lista(valor: unknown): string[] {
  if (!Array.isArray(valor)) return []
  return [
    ...new Set(
      valor
        .filter((v): v is string => typeof v === 'string')
        .map((v) => v.trim())
        .filter((v) => v !== '')
    ),
  ].slice(0, MAX_LISTA)
}
