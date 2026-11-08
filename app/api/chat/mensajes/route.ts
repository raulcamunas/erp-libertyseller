import type { NextRequest } from 'next/server'
import { borrarMensaje, editarMensaje, enviarMensaje, mensajesDe } from '@/lib/chat/servidor'
import { conChat, cuerpoDe } from '@/lib/chat/rutas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Los mensajes de un canal: `?canalId=…[&antes=<id>][&hilo=<id>][&alrededor=<id>]` (esta última da una ventana alrededor de un mensaje) */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams
  return conChat((quien) => mensajesDe(quien, { canalId: q.get('canalId'), antes: q.get('antes') ?? undefined, hilo: q.get('hilo') ?? undefined, alrededor: q.get('alrededor') ?? undefined }))
}

/** Escribe: `{ canalId, cuerpo, hiloDe?, respondeA?, adjuntos? }` (`respondeA` = el mensaje que se cita) */
export async function POST(request: NextRequest) {
  const c = await cuerpoDe(request)
  return conChat((quien) => enviarMensaje(quien, { canalId: c.canalId, cuerpo: c.cuerpo, hiloDe: c.hiloDe, respondeA: c.respondeA, adjuntos: c.adjuntos }), 201)
}

/** Edita lo tuyo: `{ id, cuerpo }` */
export async function PATCH(request: NextRequest) {
  const c = await cuerpoDe(request)
  return conChat((quien) => editarMensaje(quien, c.id, c.cuerpo))
}

/** Borra: `{ id }` */
export async function DELETE(request: NextRequest) {
  const c = await cuerpoDe(request)
  return conChat((quien) => borrarMensaje(quien, c.id))
}
