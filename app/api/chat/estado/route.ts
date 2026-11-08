import type { NextRequest } from 'next/server'
import { ponerEstado } from '@/lib/chat/extras-servidor'
import { conChat, cuerpoDe } from '@/lib/chat/rutas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Tu estado: `{ emoji, texto, duracion: '30min' | '1h' | '4h' | 'hoy' | 'semana' | 'siempre' }`. Sin emoji ni texto lo quita */
export async function PUT(request: NextRequest) {
  const c = await cuerpoDe(request)
  return conChat((quien) => ponerEstado(quien, { emoji: c.emoji, texto: c.texto, duracion: c.duracion }))
}
