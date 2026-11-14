import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { connectionCredentials } from '@/lib/amazon/data'
import { SIN_CACHE, respuestaDeFallo, soloAdminConRemesa } from '@/lib/fba/envio-amazon-http'
import { sondaInbound } from '@/lib/fba/inbound-v2024'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * ¿DEJA AMAZON USAR LA API DE ENVÍOS 2024-03-20 CON ESTA CUENTA? SOLO LECTURA.
 * Lista un plan (listInboundPlans): no crea ni cambia nada. Sirve para saber, antes de mandar el primer
 * envío, si la conexión del cliente tiene el rol «Amazon Fulfillment» para la API nueva.
 */
export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const p = await soloAdminConRemesa(params.id)
    if (p instanceof NextResponse) return p
    const { data } = await createServiceClient().from('fba_remesas').select('connection_id').eq('id', params.id).maybeSingle()
    const conexion = (data as { connection_id: string | null } | null)?.connection_id
    if (!conexion) return fail(409, 'Este cliente no tiene la cuenta de Amazon conectada')
    const c = await connectionCredentials(conexion)
    if (!c) return fail(404, 'La conexión ya no existe')
    return NextResponse.json(await sondaInbound(c.credentials), { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFallo(error, 'No se ha podido probar el acceso a la API de envíos')
  }
}
