import { NextResponse, type NextRequest } from 'next/server'
import { SIN_CACHE, respuestaDeFallo, soloAdminConRemesa } from '@/lib/fba/envio-amazon-http'
import { estadoDelEnvio, refrescarSeguimiento } from '@/lib/fba/envio-amazon-motor'

/** Lee de Amazon (solo lectura) el estado del plan y de sus envíos. Con un botón, no en bucle */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const p = await soloAdminConRemesa(params.id)
    if (p instanceof NextResponse) return p
    await refrescarSeguimiento(params.id)
    return NextResponse.json(await estadoDelEnvio(params.id), { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFallo(error, 'No se ha podido leer el seguimiento en Amazon')
  }
}
