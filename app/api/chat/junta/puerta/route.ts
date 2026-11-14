import type { NextRequest } from 'next/server'
import { responderALaPuerta, tocarLaPuerta } from '@/lib/chat/junta-servidor'
import { ErrorDeChat } from '@/lib/chat/servidor'
import { conChat, cuerpoDe } from '@/lib/chat/rutas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * La puerta de una sala de voz con candado. `{ canalId, accion: 'tocar' }` (quien quiere entrar) avisa a los de dentro; `{ canalId, accion: 'permitir' | 'denegar', usuarioId }` (uno de dentro) deja
 * entrar o no a quien llamó.
 */
export async function POST(request: NextRequest) {
  const c = await cuerpoDe(request)
  return conChat((quien) => {
    if (c.accion === 'tocar') return tocarLaPuerta(quien, c.canalId)
    if (c.accion === 'permitir' || c.accion === 'denegar') return responderALaPuerta(quien, c.canalId, c.usuarioId, c.accion === 'permitir')
    throw new ErrorDeChat('No entiendo qué quieres hacer con la puerta.')
  })
}
