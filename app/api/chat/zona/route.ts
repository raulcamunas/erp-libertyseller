import type { NextRequest } from 'next/server'
import { ponerZona } from '@/lib/chat/servidor'
import { conChat, cuerpoDe } from '@/lib/chat/rutas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Tu zona horaria: `{ zona: 'Europe/Madrid' }` */
export async function PUT(request: NextRequest) {
  const c = await cuerpoDe(request)
  return conChat((quien) => ponerZona(quien, c.zona))
}
