import type { NextRequest } from 'next/server'
import { resumirCanal } from '@/lib/chat/extras-servidor'
import { conChat, cuerpoDe } from '@/lib/chat/rutas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 90

/** «Ponme al día»: la IA resume lo que no has leído de un canal (o las últimas 24 h): `{ canalId }` */
export async function POST(request: NextRequest) {
  const c = await cuerpoDe(request)
  return conChat((quien) => resumirCanal(quien, c.canalId))
}
