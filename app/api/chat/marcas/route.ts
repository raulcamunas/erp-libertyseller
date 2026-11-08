import type { NextRequest } from 'next/server'
import { fijarMensaje, guardarMensaje } from '@/lib/chat/extras-servidor'
import { ErrorDeChat } from '@/lib/chat/servidor'
import { conChat, cuerpoDe } from '@/lib/chat/rutas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Guardar (solo para ti) o fijar (arriba del canal) un mensaje: `{ accion: 'guardar' | 'fijar', id, valor: true | false }` */
export async function POST(request: NextRequest) {
  const c = await cuerpoDe(request)
  return conChat((quien) => {
    if (c.accion === 'guardar') return guardarMensaje(quien, c.id, c.valor)
    if (c.accion === 'fijar') return fijarMensaje(quien, c.id, c.valor)
    throw new ErrorDeChat('Esa acción no existe.')
  })
}
