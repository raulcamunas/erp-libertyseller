import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { createServiceClient } from '@/lib/supabase/service'
import { fetchAll } from '@/lib/supabase/paginacion'
import { connectionCredentials, loadConnection, pickMarketplace } from '@/lib/amazon/data'
import { fetchOfertas, limpiarOferta } from '@/lib/amazon/sp-api'

/**
 * LIMPIEZA DE OFERTAS · LEER Y ENVIAR.
 *
 * Dos acciones:
 *
 *   leer     trae de Amazon el precio, el mínimo, el máximo y la rebaja de cada
 *            SKU. NO sale del espejo: esos tres últimos no están ahí, viven en
 *            `attributes` y hay que ir a buscarlos.
 *
 *   enviar   deja la oferta con el precio y nada más.
 *
 *
 * ============ ESTA RUTA SÍ ESCRIBE, Y BORRA ============
 *
 * Es la primera del ERP que quita algo que el cliente había puesto a mano. El
 * PATCH va con `replace` sobre `purchasable_offer`, y eso se lleva por delante
 * el mínimo, el máximo y la rebaja programada. Es la operación que se pide, no
 * un efecto colateral — pero conviene tenerlo escrito aquí y no solo en la
 * función.
 *
 * De ahí tres cosas que no son ceremonia:
 *
 *   · `simular: true` manda `validateOnly` a Amazon: contesta si lo aceptaría y
 *     no cambia nada. Es lo que hay que ejecutar antes de lo otro.
 *   · Se manda SOLO lo que venga en `cambios`, SKU a SKU y con el precio
 *     dentro. Nada de «aplícalo a todo el catálogo» desde el servidor: la lista
 *     la arma la pantalla y viaja entera, así que lo que se envía es
 *     exactamente lo que se vio.
 *   · Cada envío queda en `amazon_submissions` con su antes y su después.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

/** Cuántos SKU se aceptan de una tacada. Ver la nota del bucle */
const MAX_CAMBIOS = 500

export async function POST(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => ({}))) as {
      accion?: string
      connectionId?: string
      marketplaceId?: string
      simular?: boolean
      cambios?: {
        sku: string
        precio: number
        /** ISO. Si viene, la rebaja se conserva terminando ese día en vez de quitarse */
        rebajaHasta?: string | null
        rebajaImporte?: number | null
        rebajaDesde?: string | null
      }[]
    }

    const connectionId = (body.connectionId ?? '').trim()
    if (!UUID.test(connectionId)) return fail(400, 'Elige una cuenta conectada')

    const connection = await loadConnection(connectionId)
    if (!connection) return fail(404, 'Esa cuenta ya no está conectada')

    const marketplaceId = pickMarketplace(connection, body.marketplaceId ?? null)
    if (!marketplaceId) return fail(400, 'Este cliente no nos ha autorizado a trabajar en ese país')

    const resueltas = await connectionCredentials(connectionId)
    if (!resueltas) return fail(404, 'Esa cuenta ya no está conectada')

    /* ---------------- Leer ---------------- */
    if (body.accion !== 'enviar') {
      const service = createServiceClient()
      const listings = await fetchAll<{
        sku: string
        title: string | null
        asin: string | null
        product_type: string | null
        fulfillment_channel_code: string | null
        currency: string | null
      }>((a, b) =>
        service
          .from('amazon_listings')
          .select('sku, title, asin, product_type, fulfillment_channel_code, currency')
          .eq('connection_id', connectionId)
          .eq('marketplace_id', marketplaceId)
          .order('sku', { ascending: true })
          .order('id')
          .range(a, b)
      )

      if (listings.length === 0) {
        return fail(
          400,
          'No hay ninguna referencia en el catálogo de esta cuenta. Lanza antes el censo del ' +
            'catálogo desde Ingesta: sin él no hay SKU a los que preguntarles su oferta.'
        )
      }

      const t0 = Date.now()
      const { ofertas, noVinieron, llamadas } = await fetchOfertas(resueltas.credentials, {
        marketplaceId,
        skus: listings.map((l) => l.sku),
      })

      const porSku = new Map(ofertas.map((o) => [o.sku, o]))
      const filas = listings.map((l) => {
        const o = porSku.get(l.sku)
        return {
          sku: l.sku,
          asin: l.asin,
          titulo: l.title,
          productType: l.product_type,
          canal: l.fulfillment_channel_code,
          moneda: o?.moneda ?? l.currency ?? null,
          precio: o?.precio ?? null,
          precioMinimo: o?.precioMinimo ?? null,
          precioMaximo: o?.precioMaximo ?? null,
          rebaja: o?.rebaja ?? null,
          // Sin tipo de producto Amazon rechaza cualquier cambio, así que se
          // dice AQUÍ y no cuando falle el envío de 400 referencias.
          editable: Boolean(l.product_type),
        }
      })

      return NextResponse.json({
        ok: true,
        ms: Date.now() - t0,
        llamadas,
        marketplaceId,
        filas,
        noVinieron,
      })
    }

    /* ---------------- Enviar ---------------- */
    const cambios = Array.isArray(body.cambios) ? body.cambios : []
    if (cambios.length === 0) return fail(400, 'No hay ningún cambio que enviar.')
    if (cambios.length > MAX_CAMBIOS) {
      return fail(
        400,
        `De una vez se mandan como mucho ${MAX_CAMBIOS} referencias. Con más, una petición HTTP ` +
          'se queda sin tiempo a la mitad y no habría forma de saber cuáles llegaron.'
      )
    }

    const service = createServiceClient()
    const espejo = new Map(
      (
        await fetchAll<{
          sku: string
          product_type: string | null
          currency: string | null
          price: number | null
          fulfillment_channel_code: string | null
        }>(
          (a, b) =>
            service
              .from('amazon_listings')
              .select('sku, product_type, currency, price, fulfillment_channel_code')
              .eq('connection_id', connectionId)
              .eq('marketplace_id', marketplaceId)
              .in('sku', cambios.map((c) => c.sku).slice(0, MAX_CAMBIOS))
              .order('sku')
              .order('id')
              .range(a, b)
        )
      ).map((l) => [l.sku, l])
    )

    const simular = body.simular === true
    const resultados: {
      sku: string
      estado: 'aceptado' | 'invalido' | 'error'
      mensaje: string | null
    }[] = []

    for (const c of cambios) {
      const l = espejo.get(c.sku)
      if (!l || !l.product_type) {
        resultados.push({
          sku: c.sku,
          estado: 'error',
          mensaje: 'No tenemos su tipo de producto, y Amazon lo exige en cada cambio.',
        })
        continue
      }
      if (!Number.isFinite(c.precio) || c.precio <= 0) {
        resultados.push({ sku: c.sku, estado: 'error', mensaje: 'El precio no es válido.' })
        continue
      }

      try {
        const res = await limpiarOferta(
          resueltas.credentials,
          {
            sku: c.sku,
            marketplaceId,
            productType: l.product_type,
            fulfillmentChannelCode: l.fulfillment_channel_code ?? null,
          },
          {
            precio: c.precio,
            currency: l.currency ?? 'EUR',
            rebajaHasta:
              c.rebajaHasta && c.rebajaImporte != null && c.rebajaDesde
                ? { importe: c.rebajaImporte, desde: c.rebajaDesde, hasta: c.rebajaHasta }
                : null,
            validateOnly: simular,
          }
        )
        resultados.push({ sku: c.sku, estado: res.status, mensaje: res.message })
      } catch (error) {
        resultados.push({
          sku: c.sku,
          estado: 'error',
          mensaje: error instanceof Error ? error.message : 'Error desconocido',
        })
      }
    }

    return NextResponse.json({
      ok: true,
      simulado: simular,
      aceptados: resultados.filter((r) => r.estado === 'aceptado').length,
      fallidos: resultados.filter((r) => r.estado !== 'aceptado').length,
      resultados,
    })
  } catch (error) {
    return errorResponse(error, 'Error leyendo o limpiando las ofertas')
  }
}
