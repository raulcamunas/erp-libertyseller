import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { requireAppDeCuentas } from '@/lib/cuentas/acceso'
import { actividadDeCliente } from '@/lib/trabajo/actividad'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** La actividad de un cliente de todos los módulos juntos (lib/trabajo/actividad.ts). ?c=<amazon_client_id>&dias=30 */
export async function GET(request: NextRequest) {
  const sesion = await requireAppDeCuentas('cuentas')
  if (sesion instanceof NextResponse) return sesion
  const c = request.nextUrl.searchParams.get('c')
  if (!c || !/^[0-9a-f-]{36}$/i.test(c)) return fail(400, 'Falta el cliente.')
  const dias = Math.min(120, Math.max(1, Number(request.nextUrl.searchParams.get('dias')) || 30))
  try {
    return NextResponse.json({ entradas: await actividadDeCliente(c, dias) })
  } catch (e) {
    return fail(500, e instanceof Error ? e.message : 'No se ha podido leer la actividad.')
  }
}
