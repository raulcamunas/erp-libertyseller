import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { puedeVer, requireFbaAccess } from '@/lib/fba/acceso'
import { historialDe } from '@/lib/fba/historial'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * EL HISTORIAL DE UNA REMESA: QUIÉN HIZO QUÉ (fba_remesa_historial, migración 309).
 *
 * Quien puede ver la remesa ve su historial. La IP del enlace solo la ve la agencia: a un cliente con
 * usuario del ERP no se le enseñan direcciones.
 */
export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (!UUID.test(params.id)) return fail(400, 'Esa remesa no existe')
    const sesion = await requireFbaAccess('ver')
    if (sesion instanceof NextResponse) return sesion
    const service = createServiceClient()
    const { data } = await service.from('fba_remesas').select('client_id').eq('id', params.id).maybeSingle()
    const clienteId = (data as { client_id: string } | null)?.client_id
    if (!clienteId || !puedeVer(sesion, clienteId)) return fail(404, 'Esa remesa ya no existe')

    const r = await historialDe(params.id, service)
    const eventos = sesion.actor === 'agencia' ? r.eventos : r.eventos.map((e) => ({ ...e, ip: null }))
    return NextResponse.json({ eventos, sinMigrar: r.sinMigrar }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return errorResponse(error, 'No se ha podido leer el historial')
  }
}
