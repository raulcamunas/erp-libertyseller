import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { SIN_CACHE, requerirCorreo, respuestaDeFallo } from '@/lib/correo/rutas'
import { accesosDeBuzon, autorizarBuzon } from '@/lib/correo/servidor'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * QUIÉN HA MIRADO MI BUZÓN.
 *
 * GET ?buzon=<id>  Las últimas 50 veces que alguien que no es su dueño ha abierto una lista, un hilo, una búsqueda o un
 * adjunto de este buzón. Lo ve su dueño y un administrador. Supervisar no es secreto: quien tiene un buzón puede saber
 * quién lo ha mirado.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET(request: NextRequest) {
  const sesion = await requerirCorreo()
  if (sesion instanceof NextResponse) return sesion

  try {
    const service = createServiceClient()
    const auth = await autorizarBuzon(service, sesion, request.nextUrl.searchParams.get('buzon'), 'administrar')
    if (!auth.ok) return fail(auth.estado, auth.mensaje)
    return NextResponse.json({ accesos: await accesosDeBuzon(service, auth.buzon.id) }, { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFallo('Correo · accesos: fallo', error)
  }
}
