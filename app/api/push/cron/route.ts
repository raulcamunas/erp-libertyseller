import { NextResponse, type NextRequest } from 'next/server'
import { pasadaDePush } from '@/lib/push/servidor'
import { conRegistro, lanzadoPorDe, tocaAhora } from '@/lib/sistema/cron'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * LA PASADA DE LOS AVISOS PUSH (cada minuto; el reloj lo decide `tocaAhora()` desde cron_config). Manda a los dispositivos los avisos nuevos de la campana. Solo se entra con la
 * cabecera x-cron-secret (CRON_SECRET). Sin nadie con los avisos activados es una consulta pequeña.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('x-cron-secret') !== secret) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  if (request.nextUrl.searchParams.get('forzar') !== '1') {
    const veredicto = await tocaAhora('push-avisos')
    if (!veredicto.toca) return NextResponse.json({ ok: true, saltado: veredicto.motivo })
  }
  const salida = await conRegistro('push-avisos', lanzadoPorDe(request.headers), () => pasadaDePush())
  return NextResponse.json(salida)
}
