import type { NextRequest } from 'next/server'
import { borrarRecordatorio, crearRecordatorio, listarRecordatorios } from '@/lib/chat/extras-servidor'
import { conChat, cuerpoDe } from '@/lib/chat/rutas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  return conChat((quien) => listarRecordatorios(quien))
}

/** `{ mensajeId?, canalId?, texto?, avisarEn }`: te avisa por la campana a esa hora */
export async function POST(request: NextRequest) {
  const c = await cuerpoDe(request)
  return conChat((quien) => crearRecordatorio(quien, { mensajeId: c.mensajeId, canalId: c.canalId, texto: c.texto, avisarEn: c.avisarEn }), 201)
}

export async function DELETE(request: NextRequest) {
  const c = await cuerpoDe(request)
  return conChat((quien) => borrarRecordatorio(quien, c.id))
}
