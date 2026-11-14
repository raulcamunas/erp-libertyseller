import type { NextRequest } from 'next/server'
import { ponerCandado } from '@/lib/chat/junta-servidor'
import { conChat, cuerpoDe } from '@/lib/chat/rutas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Poner o quitar el candado de la sala de un canal (solo quien está dentro): `{ canalId, bloqueada }` → `{ bloqueada }` */
export async function POST(request: NextRequest) {
  const c = await cuerpoDe(request)
  return conChat((quien) => ponerCandado(quien, c.canalId, c.bloqueada))
}
