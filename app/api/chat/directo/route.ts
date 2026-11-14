import type { NextRequest } from 'next/server'
import { abrirDirecto } from '@/lib/chat/servidor'
import { conChat, cuerpoDe } from '@/lib/chat/rutas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Abre (o recupera) la conversación directa con alguien: `{ con }` → `{ canalId }` */
export async function POST(request: NextRequest) {
  const c = await cuerpoDe(request)
  return conChat((quien) => abrirDirecto(quien, c.con))
}
