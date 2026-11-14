import { NextRequest, NextResponse } from 'next/server'
import { errorResponse, fail, requireSession } from '@/lib/vacations/api'
import { errorDeRango } from '@/lib/vacations/calendario'
import { cargarEquipo } from '@/lib/vacations/servidor'

/**
 * QUIÉN ESTÁ FUERA EN LA EMPRESA ENTRE DOS FECHAS. GET ?desde=aaaa-mm-dd&hasta=aaaa-mm-dd
 * =====================================================================================
 * Lo puede leer CUALQUIERA con permiso del módulo de vacaciones (requireSession lo comprueba), no solo el admin: así
 * nadie pide encima de un compañero sin saberlo (Raúl, 14 nov 2026). Devuelve las pendientes y las aprobadas con
 * quién, color, fechas y estado. NI MOTIVOS NI SALDOS: eso sigue siendo de cada uno (y del admin).
 *
 * Se lee con service_role porque employees y vacation_requests tienen RLS de «solo lo tuyo»; esa RLS no se toca, y lo
 * que se publica lo decide cargarEquipo campo a campo.
 */

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const session = await requireSession()
    if (session instanceof NextResponse) return session

    const desde = request.nextUrl.searchParams.get('desde')
    const hasta = request.nextUrl.searchParams.get('hasta')
    const error = errorDeRango(desde, hasta)
    if (error) return fail(400, error)

    return NextResponse.json(await cargarEquipo(session.service, desde as string, hasta as string))
  } catch (error) {
    return errorResponse(error, 'Error cargando el calendario del equipo')
  }
}
