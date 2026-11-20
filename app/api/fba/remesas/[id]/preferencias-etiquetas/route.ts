import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { requireFbaAccess } from '@/lib/fba/acceso'
import { guardarPreferencias, preferenciasDe } from '@/lib/fba/preferencias-etiquetas'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * LA HOJA EN QUE IMPRIME EL CLIENTE DE ESTA REMESA (producto y caja). La lee quien ve la remesa; la fija la agencia.
 */
export const dynamic = 'force-dynamic'

async function clienteDe(id: string, nivel: 'ver' | 'editar') {
  if (!UUID.test(id)) return fail(400, 'Esa remesa no existe')
  const sesion = await requireFbaAccess(nivel)
  if (sesion instanceof NextResponse) return sesion
  const service = createServiceClient()
  const { data } = await service.from('fba_remesas').select('client_id').eq('id', id).maybeSingle()
  const clienteId = (data as { client_id: string } | null)?.client_id
  if (!clienteId || (sesion.clientesPermitidos && !sesion.clientesPermitidos.includes(clienteId))) return fail(404, 'Esa remesa ya no existe')
  return { sesion, clienteId, service }
}

export async function GET(_r: NextRequest, { params }: { params: { id: string } }) {
  try {
    const c = await clienteDe(params.id, 'ver')
    if (c instanceof NextResponse) return c
    return NextResponse.json(await preferenciasDe(c.clienteId, c.service), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return errorResponse(error, 'No se ha podido leer la hoja del cliente')
  }
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const c = await clienteDe(params.id, 'editar')
    if (c instanceof NextResponse) return c
    if (c.sesion.actor !== 'agencia') return fail(403, 'La hoja del cliente la fija Liberty Seller')
    const body = (await request.json().catch(() => ({}))) as { producto?: string | null; caja?: string | null }
    try {
      return NextResponse.json(await guardarPreferencias(c.clienteId, { producto: body.producto, caja: body.caja }, c.sesion.userId, c.service))
    } catch (e) {
      return fail(400, e instanceof Error ? e.message : 'No se ha podido guardar')
    }
  } catch (error) {
    return errorResponse(error, 'No se ha podido guardar la hoja del cliente')
  }
}
