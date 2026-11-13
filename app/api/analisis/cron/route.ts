import { NextResponse, type NextRequest } from 'next/server'
import { pasadaDeRecogida } from '@/lib/analisis-amazon/recogida'
import { conRegistro, lanzadoPorDe, tocaAhora } from '@/lib/sistema/cron'

/**
 * LA RECOGIDA DE KEEPA PARA LOS ANÁLISIS DE AMAZON (lib/analisis-amazon/recogida.ts).
 *
 * El cron la despierta cada minuto (scripts/analisis-keepa.sh). Si Keepa tiene saldo para una tienda entera, analiza la siguiente de la cola
 * y deja su informe en el ERP; si no, contesta enseguida. Solo lee de Keepa. Se apaga desde Sistema como cualquier otro proceso.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 360

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  if (request.nextUrl.searchParams.get('forzar') !== '1') {
    const veredicto = await tocaAhora('analisis-keepa')
    if (!veredicto.toca) return NextResponse.json({ ok: true, saltado: veredicto.motivo })
  }
  const salida = await conRegistro('analisis-keepa', lanzadoPorDe(request.headers), () => pasadaDeRecogida())
  return NextResponse.json({ ok: true, ...salida })
}
