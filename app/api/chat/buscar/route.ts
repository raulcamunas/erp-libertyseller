import type { NextRequest } from 'next/server'
import { buscarMensajes } from '@/lib/chat/extras-servidor'
import { conChat } from '@/lib/chat/rutas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Busca texto en los mensajes que puedes leer: `?q=…[&canalId=…]` */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams
  return conChat((quien) => buscarMensajes(quien, { q: q.get('q'), canalId: q.get('canalId') ?? undefined }))
}
