import type { NextRequest } from 'next/server'
import { avisarDeCambioEnLaSala } from '@/lib/chat/junta-servidor'
import { conChat, cuerpoDe } from '@/lib/chat/rutas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** «He entrado o salido de la sala de este canal»: el resto vuelve a leer quién está dentro. `{ canalId }` → `{ ok }` */
export async function POST(request: NextRequest) {
  const c = await cuerpoDe(request)
  return conChat((quien) => avisarDeCambioEnLaSala(quien, c.canalId))
}
