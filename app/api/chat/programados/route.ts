import type { NextRequest } from 'next/server'
import { cancelarProgramado, listarProgramados, programarMensaje } from '@/lib/chat/extras-servidor'
import { conChat, cuerpoDe } from '@/lib/chat/rutas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  return conChat((quien) => listarProgramados(quien))
}

/** `{ canalId, cuerpo, hiloDe?, respondeA?, adjuntos?, enviarEn }`: el mensaje sale solo a esa hora */
export async function POST(request: NextRequest) {
  const c = await cuerpoDe(request)
  return conChat((quien) => programarMensaje(quien, { canalId: c.canalId, cuerpo: c.cuerpo, hiloDe: c.hiloDe, respondeA: c.respondeA, adjuntos: c.adjuntos, enviarEn: c.enviarEn }), 201)
}

export async function DELETE(request: NextRequest) {
  const c = await cuerpoDe(request)
  return conChat((quien) => cancelarProgramado(quien, c.id))
}
