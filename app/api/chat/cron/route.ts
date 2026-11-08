import { NextResponse, type NextRequest } from 'next/server'
import { pasadaDeChat } from '@/lib/chat/extras-servidor'
import { conRegistro, lanzadoPorDe, tocaAhora } from '@/lib/sistema/cron'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * LA PASADA DEL CHAT (cada minuto; el reloj lo decide `tocaAhora()` desde cron_config): avisa de los recordatorios que ya tocan y envía los mensajes programados cuya hora ha llegado.
 * Solo se entra con la cabecera x-cron-secret (CRON_SECRET). Sin nada pendiente es una consulta pequeña.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('x-cron-secret') !== secret) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  if (request.nextUrl.searchParams.get('forzar') !== '1') {
    const veredicto = await tocaAhora('chat-avisos')
    if (!veredicto.toca) return NextResponse.json({ ok: true, saltado: veredicto.motivo })
  }
  const salida = await conRegistro('chat-avisos', lanzadoPorDe(request.headers), () => pasadaDeChat())
  return NextResponse.json(salida)
}
