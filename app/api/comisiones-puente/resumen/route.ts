import { NextResponse, type NextRequest } from 'next/server'
import { exigirSoloAdmin } from '@/lib/comisiones-puente/acceso'
import { errorResponse, fail } from '@/lib/amazon/api'
import { leerResumenDelMes } from '@/lib/comisiones-puente/datos'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * TODOS LOS CLIENTES DE UN MES, PARA LA BARRA IZQUIERDA DEL PANEL DE COMISIONES.
 * Solo administradores (ver `lib/comisiones-puente/acceso.ts`): lleva el fee y la comisión de cada cliente, y middleware.ts declara
 * pública toda /api/, así que el guardia va aquí, en la primera línea.
 */
export async function GET(request: NextRequest) {
  const permiso = await exigirSoloAdmin()
  if (!permiso.ok) return fail(permiso.estado, permiso.mensaje)

  try {
    const params = request.nextUrl.searchParams
    const anio = Number(params.get('anio'))
    const mes = Number(params.get('mes'))
    if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) return fail(400, 'Ese año no vale')
    if (!Number.isInteger(mes) || mes < 1 || mes > 12) return fail(400, 'Ese mes no vale')

    return NextResponse.json(await leerResumenDelMes(anio, mes))
  } catch (error) {
    return errorResponse(error, 'Error leyendo el resumen del mes en el puente de comisiones')
  }
}
