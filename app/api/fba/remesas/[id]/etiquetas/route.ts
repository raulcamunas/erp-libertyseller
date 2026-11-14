import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { requireFbaAccess } from '@/lib/fba/acceso'
import { generarEtiquetasDeRemesa, registrarImpresion, respuestaPdf } from '@/lib/fba/etiquetas-remesa'
import { registrarEnHistorial } from '@/lib/fba/historial'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * EL PDF DE ETIQUETAS DE PRODUCTO DE UNA REMESA, DESDE EL ERP.
 *
 * Una etiqueta por unidad. No antes de que se apruebe el envío. El FNSKU de la línea, del espejo del
 * catálogo o leído de Amazon en el momento. Todo eso vive en lib/fba/etiquetas-remesa.ts, que comparte con
 * el enlace del cliente (/api/publico/envio/[token]/etiquetas): aquí solo se comprueba la sesión y el
 * acceso al cliente, y se apunta la tirada (fba_impresiones + historial).
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (!UUID.test(params.id)) return fail(400, 'Esa remesa no existe')

    const sesion = await requireFbaAccess('ver')
    if (sesion instanceof NextResponse) return sesion

    const service = createServiceClient()
    const { data: cabecera } = await service.from('fba_remesas').select('client_id').eq('id', params.id).maybeSingle()
    const clienteId = (cabecera as { client_id: string } | null)?.client_id
    // El mismo 404 que si no existiera: a quien no tiene acceso no se le confirma ni que exista
    if (!clienteId || (sesion.clientesPermitidos && !sesion.clientesPermitidos.includes(clienteId))) {
      return fail(404, 'Esa remesa ya no existe')
    }

    const formato = request.nextUrl.searchParams.get('formato') ?? 'a4-21'
    const r = await generarEtiquetasDeRemesa(params.id, formato, service)
    if (!r.ok) return fail(r.estado, r.error)

    // Se apunta sin hacer esperar a la descarga: quedarse sin etiquetas por el apunte sería peor
    void registrarImpresion(r, { userId: sesion.userId, origen: 'erp' }, service)
    void registrarEnHistorial(
      { remesaId: params.id, actor: sesion.actor, userId: sesion.userId, accion: 'etiquetas', detalle: { etiquetas: r.impresas, formato, descartadas: r.descartadas.length } },
      service
    )

    return respuestaPdf(r) as NextResponse
  } catch (error) {
    return errorResponse(error, 'No se han podido generar las etiquetas')
  }
}
