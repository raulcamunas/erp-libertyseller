import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { requireFbaAccess } from '@/lib/fba/acceso'
import { leerFnskusDeAmazon } from '@/lib/fba/fnsku-amazon'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * «ACTUALIZAR FNSKU DE AMAZON»: leer ahora el FNSKU de las referencias de esta remesa.
 *
 * Las etiquetas salen del FNSKU que el ERP tiene guardado, y una referencia nueva no lo tiene hasta
 * que el refresco del catálogo o el libro de la noche lo rellenan. Aquí se le pregunta a Amazon en el
 * momento, por las referencias de ESTA remesa, y se dice qué ha contestado de cada una.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (!UUID.test(params.id)) return fail(400, 'Esa remesa no existe')

    const sesion = await requireFbaAccess('ver')
    if (sesion instanceof NextResponse) return sesion

    const service = createServiceClient()
    const { data: cabecera } = await service
      .from('fba_remesas')
      .select('id, client_id, connection_id, marketplace_id')
      .eq('id', params.id)
      .maybeSingle()
    const remesa = cabecera as { id: string; client_id: string; connection_id: string | null; marketplace_id: string } | null
    if (!remesa) return fail(404, 'Esa remesa ya no existe')
    if (sesion.clientesPermitidos && !sesion.clientesPermitidos.includes(remesa.client_id)) {
      return fail(404, 'Esa remesa ya no existe')
    }
    if (!remesa.connection_id) {
      return fail(409, 'Esta remesa no está ligada a una cuenta de Amazon, así que no hay dónde leer el FNSKU.')
    }

    const { data: lineas } = await service.from('fba_remesa_lineas').select('sku').eq('remesa_id', params.id)
    const skus = [...new Set(((lineas ?? []) as Array<{ sku: string }>).map((l) => l.sku))]
    if (skus.length === 0) return fail(400, 'Esta remesa no tiene ninguna referencia')

    const { leidos, error } = await leerFnskusDeAmazon(service, remesa.connection_id, remesa.marketplace_id, skus)
    if (error && leidos.length === 0) {
      return fail(502, `No se ha podido leer de Amazon: ${error}`)
    }
    return NextResponse.json({
      leidos,
      reales: leidos.filter((l) => l.estado === 'real').length,
      conAsin: leidos.filter((l) => l.estado === 'asin').length,
      sinFnsku: leidos.filter((l) => l.estado === 'ninguno').length,
    })
  } catch (error) {
    return errorResponse(error, 'No se ha podido leer el FNSKU de Amazon')
  }
}
