import type { NextRequest } from 'next/server'
import { reaccionar } from '@/lib/chat/servidor'
import { conChat, cuerpoDe } from '@/lib/chat/rutas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Pone o quita tu reacción: `{ id, emoji }` */
export async function POST(request: NextRequest) {
  const c = await cuerpoDe(request)
  return conChat((quien) => reaccionar(quien, c.id, c.emoji))
}
