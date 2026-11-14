import type { NextRequest } from 'next/server'
import { bandeja } from '@/lib/chat/extras-servidor'
import { conChat } from '@/lib/chat/rutas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Listas de mensajes: `?tipo=menciones | guardados | fijados[&canalId=…]` */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams
  return conChat((quien) => bandeja(quien, q.get('tipo'), q.get('canalId') ?? undefined))
}
