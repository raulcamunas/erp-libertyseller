import { NextResponse, type NextRequest } from 'next/server'
import { requireAmazonAdmin } from '@/lib/amazon/api'
import { gastoDeIa } from '@/lib/ia-gasto/servidor'

/**
 * CUÁNTO SE HA GASTADO EN IA, SEGÚN OPENAI.
 *
 * Solo un administrador (es la pantalla de Sistema). Lee el gasto real de OpenAI con la clave de administrador del servidor (OPENAI_ADMIN_KEY) y
 * lo devuelve ya resumido: hoy, este mes, el mes anterior, los últimos 30 días y 12 meses, por modelo y por día (lib/ia-gasto/resumen.ts). La clave
 * no sale nunca del servidor y la respuesta solo lleva cifras.
 *
 * `?refrescar=1` vuelve a leer de OpenAI aunque haya una lectura reciente guardada (con un mínimo de 20 s entre lecturas).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const sesion = await requireAmazonAdmin()
  if (sesion instanceof NextResponse) return sesion

  const respuesta = await gastoDeIa({ refrescar: request.nextUrl.searchParams.get('refrescar') === '1' })
  return NextResponse.json(respuesta, { headers: { 'Cache-Control': 'private, no-store' } })
}
