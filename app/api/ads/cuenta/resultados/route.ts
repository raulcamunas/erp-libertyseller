import { NextResponse, type NextRequest } from 'next/server'
import { resultadosDeCuenta } from '@/lib/ads/resultados'
import { abrirCuenta, errorDeRuta } from '@/lib/ads/ruta'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Los resultados medidos de los cambios del agente (lib/ads/resultados.ts). ?perfilId=&dias=60 */
export async function GET(request: NextRequest) {
  try {
    const p = request.nextUrl.searchParams
    const a = await abrirCuenta(p.get('perfilId'))
    if (a instanceof NextResponse) return a
    const dias = Math.min(180, Math.max(7, Number(p.get('dias')) || 60))
    return NextResponse.json(await resultadosDeCuenta(a.cuenta.id, dias))
  } catch (e) {
    return errorDeRuta(e, 'No se han podido leer los resultados')
  }
}
