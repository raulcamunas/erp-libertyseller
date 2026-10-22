import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { SIN_CACHE, requerirCorreo, respuestaDeFallo } from '@/lib/correo/rutas'
import { accesosDeBuzon, autorizarBuzon } from '@/lib/correo/servidor'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * QUIÉN HA MIRADO UN BUZÓN — SOLO PARA ADMINISTRADORES.
 *
 * GET ?buzon=<id>  Las últimas 50 veces que alguien que no es su dueño ha abierto una lista, un hilo, una búsqueda o un
 * adjunto de este buzón.
 *
 * ES EL REGISTRO DE AUDITORÍA DE LA EMPRESA Y NO SE ENSEÑA A QUIEN SE AUDITA. Antes lo veía también el dueño del buzón en los
 * ajustes; ya no: el rastro se sigue escribiendo en cada acceso (registrarAcceso) y lo lee un administrador, nadie más. Esto
 * NO se resuelve solo escondiendo el bloque en la pantalla: la ruta lo cierra igualmente, porque quien sepa abrir las
 * herramientas del navegador podría pedirla. A quien no es administrador se le contesta «no existe».
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET(request: NextRequest) {
  const sesion = await requerirCorreo()
  if (sesion instanceof NextResponse) return sesion
  if (sesion.role !== 'admin') return fail(404, 'No existe esa página.')

  try {
    const service = createServiceClient()
    const auth = await autorizarBuzon(service, sesion, request.nextUrl.searchParams.get('buzon'), 'administrar')
    if (!auth.ok) return fail(auth.estado, auth.mensaje)
    return NextResponse.json({ accesos: await accesosDeBuzon(service, auth.buzon.id) }, { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFallo('Correo · accesos: fallo', error)
  }
}
