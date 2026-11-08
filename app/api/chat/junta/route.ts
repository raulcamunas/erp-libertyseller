import type { NextRequest } from 'next/server'
import { entrarEnJunta, juntasActivas } from '@/lib/chat/junta-servidor'
import { conChat, cuerpoDe } from '@/lib/chat/rutas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Qué juntas hay abiertas ahora en los canales que ves: `{ disponible, activas: [{ canalId, participantes, personas }] }` */
export async function GET() {
  return conChat((quien) => juntasActivas(quien))
}

/** La llave para entrar a la junta de un canal (si no hay nadie, la abre): `{ canalId }` → `{ token, url, sala }` */
export async function POST(request: NextRequest) {
  const c = await cuerpoDe(request)
  return conChat((quien) => entrarEnJunta(quien, c.canalId))
}
