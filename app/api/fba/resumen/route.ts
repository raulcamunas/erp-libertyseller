import { NextResponse, type NextRequest } from 'next/server'
import { errorResponse, fail } from '@/lib/amazon/api'
import { diaEnEspana } from '@/lib/fba/fechas'
import { resumenGlobal, sesionDeRemesas } from '@/lib/fba/resumen-servidor'

/**
 * EL RESUMEN GLOBAL DE REMESAS (VISTA «HOY»).
 *
 * Spec remesas-pro §9 y §11 D26, D32, D34, D42. Solo agencia: KPI de Hoy, salud por cliente, salidas por
 * semana y envíos de camino de TODOS los clientes que la sesión puede ver. No calcula planes: lee la
 * última pasada. Memoria de 3 minutos en el proceso (clave = clientes permitidos); `?refrescar=1` la salta.
 * Sin la migración 316 contesta igual, con `migracion316: false` y el aviso.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  try {
    const sesion = await sesionDeRemesas()
    if (sesion instanceof NextResponse) return sesion
    // El cliente externo no ve lo de agencia (€ en juego, prioridades, otros clientes)
    if (sesion.actor !== 'agencia') return fail(403, 'Esta vista es solo para el equipo de Liberty Seller')

    const refrescar = request.nextUrl.searchParams.get('refrescar') === '1'
    const resumen = await resumenGlobal(sesion.clientesPermitidos, diaEnEspana(), { refrescar })
    return NextResponse.json(resumen)
  } catch (error) {
    return errorResponse(error, 'No se ha podido calcular el resumen de remesas')
  }
}
